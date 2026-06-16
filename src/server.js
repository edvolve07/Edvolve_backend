import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { ObjectId } from "mongodb";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import { closeDatabase, collections, connectDatabase } from "./db.js";
import { hashPassword, verifyPassword, createAuthToken, validateEmail, validatePassword } from "./utils/auth.js";
import mongoose from "mongoose";
import authRoutes from "./aptitude/routes/authRoutes.js";
import adminRoutes from "./aptitude/routes/adminRoutes.js";
import masterAdminRoutes from "./aptitude/routes/masterAdminRoutes.js";
import studentRoutes from "./aptitude/routes/studentRoutes.js";
import programmingStudentRoutes from "./programming/routes/studentRoutes.js";
import programmingAdminRoutes from "./programming/routes/adminRoutes.js";
import programmingMasterAdminRoutes from "./programming/routes/masterAdminRoutes.js";
import assessmentStudentRoutes from "./programming/routes/assessmentStudentRoutes.js";
import assessmentAdminRoutes from "./programming/routes/assessmentAdminRoutes.js";
import assessmentMasterAdminRoutes from "./programming/routes/assessmentMasterAdminRoutes.js";
import { getCodeRunnerHealth } from "./programming/services/executionService.js";
import { aiService } from "./services/aiService.js";
import { extractTextFromPdf } from "./services/resumeParser.js";
import { transcriber } from "./services/transcriber.js";
import { handleUpload } from "@vercel/blob/client";
import {
  analyzeVideo,
  cleanupFiles,
  extractAudio,
  hasVideoStream,
  lowQualityMetrics,
  writeTempFile
} from "./services/mediaService.js";
import { generateAtsPdf, generatePerformancePdf } from "./services/pdfReports.js";
import { HttpError, asyncHandler } from "./utils/httpError.js";
import { requireAuth, requireModuleAccess, requireRole } from "./aptitude/middleware/auth.js";
import { formatDisplayName } from "./aptitude/utils/nameFormat.js";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxVideoSize }
});

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  maxAge: 86400,
}));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

function pickMetrics(evaluation) {
  return Object.fromEntries(
    ["confidence", "body_language", "knowledge", "fluency", "skill_relevance"]
      .map((key) => [key, evaluation?.[key] || 0])
  );
}

function fileExtension(file, fallback) {
  return path.extname(file?.originalname || "") || fallback;
}

async function getSession(sessionId) {
  const { sessions } = collections();
  const session = await sessions.findOne({ session_id: sessionId });

  if (!session) {
    throw new HttpError(404, "Session not found");
  }

  return session;
}

function canAccessStudentRecord(user, studentId) {
  if (!user || !studentId) return false;
  if (["admin", "master_admin"].includes(user.role)) return true;
  return studentId === user._id.toString();
}

function assertCanAccessSession(user, session) {
  if (!canAccessStudentRecord(user, session.student_id)) {
    throw new HttpError(403, "You do not have permission to access this interview session");
  }
}

async function updateSessionAtomic(sessionId, update) {
  const { sessions } = collections();
  const result = await sessions.updateOne({ session_id: sessionId }, { $set: update });

  if (result.matchedCount === 0) {
    throw new HttpError(404, "Session not found");
  }
}

async function handleAnswer({ sessionId, answer, user, videoMetrics = null }) {
  const session = await getSession(sessionId);
  assertCanAccessSession(user, session);

  if (session.status !== "active") {
    throw new HttpError(400, "Interview completed");
  }

  const evaluation = await aiService.evaluateAnswer(session.current_question, answer, videoMetrics);
  const historyEntry = {
    question_number: session.question_count,
    question: session.current_question,
    answer,
    evaluation,
    timestamp: new Date()
  };

  if (videoMetrics) {
    historyEntry.video_metrics = videoMetrics;
  }

  const updatedHistory = [...(session.history || []), historyEntry];

  if (session.question_count >= config.maxQuestions) {
    await updateSessionAtomic(sessionId, {
      history: updatedHistory,
      status: "completed"
    });

    return {
      completed: true,
      message: "Interview completed. Call /api/end",
      feedback: evaluation.feedback || "",
      metrics: pickMetrics(evaluation)
    };
  }

  const nextQuestion = await aiService.generateNextQuestion(
    session.resume_text,
    updatedHistory,
    session.domain,
    session.role
  );

  await updateSessionAtomic(sessionId, {
    history: updatedHistory,
    current_question: nextQuestion,
    question_count: session.question_count + 1
  });

  return {
    next_question: nextQuestion,
    question_number: session.question_count + 1,
    feedback: evaluation.feedback || "",
    metrics: pickMetrics(evaluation),
    completed: false
  };
}

app.get("/", (req, res) => {
  res.json({
    message: "AI Interview System (Node.js + Groq)",
    version: "1.0-node"
  });
});

app.get("/api/health", asyncHandler(async (req, res) => {
  const codeRunner = await getCodeRunnerHealth();
  res.json({
    status: "healthy",
    version: "1.0-node",
    mongodb: "connected",
    stt: "groq-whisper-large-v3-turbo",
    code_runner: {
      provider: codeRunner.provider,
      configured: codeRunner.configured,
      healthy: codeRunner.healthy,
    },
  });
}));

app.get("/api/health/runner", requireAuth, requireRole("admin", "master_admin"), asyncHandler(async (req, res) => {
  res.json({
    code_runner: await getCodeRunnerHealth({
      deep: req.query.deep === "1" || req.query.deep === "true",
    }),
  });
}));

app.post("/api/signup", asyncHandler(async (req, res) => {
  const { email, password, name } = req.body || {};

  if (!validateEmail(email) || !validatePassword(password)) {
    throw new HttpError(400, "Valid email and password (min 8 characters) are required");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const displayName = formatDisplayName(name);
  const { salt, hash } = await hashPassword(password);
  const authToken = createAuthToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const { users } = collections();

  try {
    const result = await users.insertOne({
      email: normalizedEmail,
      name: displayName,
      password_hash: hash,
      password_salt: salt,
      auth_token: authToken,
      auth_expires_at: expiresAt,
      created_at: new Date()
    });

    res.status(201).json({
      user: {
        user_id: String(result.insertedId),
        email: normalizedEmail,
        name: displayName
      },
      access_token: authToken,
      expires_at: expiresAt
    });
  } catch (error) {
    if (error.code === 11000) {
      throw new HttpError(409, "Email is already registered");
    }
    throw error;
  }
}));

app.post("/api/login", asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};

  if (!validateEmail(email) || !validatePassword(password)) {
    throw new HttpError(400, "Valid email and password are required");
  }

  const normalizedEmail = email.trim().toLowerCase();
  const { users } = collections();
  const user = await users.findOne({ email: normalizedEmail });

  if (!user) {
    throw new HttpError(401, "Invalid email or password");
  }

  const isValid = await verifyPassword(password, user.password_salt, user.password_hash);

  if (!isValid) {
    throw new HttpError(401, "Invalid email or password");
  }

  const authToken = createAuthToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await users.updateOne({ _id: user._id }, { $set: { auth_token: authToken, auth_expires_at: expiresAt } });

  res.json({
    user: {
      user_id: String(user._id),
      email: user.email,
      name: user.name || ""
    },
    access_token: authToken,
    expires_at: expiresAt
  });
}));

app.get("/api/me", asyncHandler(async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const [scheme, token] = authHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new HttpError(401, "Missing or invalid authorization header");
  }

  const { users } = collections();
  const user = await users.findOne({ auth_token: token, auth_expires_at: { $gt: new Date() } });

  if (!user) {
    throw new HttpError(401, "Invalid or expired auth token");
  }

  res.json({
    user: {
      user_id: String(user._id),
      email: user.email,
      name: user.name || ""
    }
  });
}));

app.post("/api/start", requireAuth, requireModuleAccess('ai_interview'), upload.single("file"), asyncHandler(async (req, res) => {
  const { domain, role } = req.body;

  if (!domain || !role) {
    throw new HttpError(400, "domain and role are required");
  }

  if (!req.file) {
    throw new HttpError(400, "Resume PDF required");
  }

  if (!req.file.originalname.toLowerCase().endsWith(".pdf")) {
    throw new HttpError(400, "PDF required");
  }

  const resumeText = await extractTextFromPdf(req.file.buffer);
  const ats = await aiService.analyzeResume(resumeText);
  const firstQuestion = await aiService.generateFirstQuestion(resumeText, domain, role);
  const sessionId = uuidv4();

  const session = {
    session_id: sessionId,
    student_id: req.user._id.toString(),
    student_name: req.user.name || "",
    student_email: req.user.email || "",
    student_role: req.user.role || "student",
    domain,
    role,
    resume_text: resumeText,
    ats_analysis: ats,
    history: [],
    current_question: firstQuestion,
    question_count: 1,
    status: "active",
    created_at: new Date()
  };

  const { sessions } = collections();
  await sessions.insertOne(session);

  res.json({
    session_id: sessionId,
    question: firstQuestion,
    question_number: 1,
    ats_score: ats.ats_score,
    skills_found: (ats.skills_found || []).slice(0, 5),
    improvements: (ats.improvements || []).slice(0, 3)
  });
}));

app.post("/api/answer_text", requireAuth, requireModuleAccess('ai_interview'), asyncHandler(async (req, res) => {
  const { session_id: sessionId, answer } = req.body || {};

  if (!sessionId || typeof answer !== "string") {
    throw new HttpError(400, "session_id and answer are required");
  }

  res.json(await handleAnswer({ sessionId, answer, user: req.user }));
}));

app.post("/api/handle-upload", requireAuth, requireModuleAccess('ai_interview'), asyncHandler(async (req, res) => {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) throw new HttpError(501, "Vercel Blob not configured");
  const result = await handleUpload({
    token: blobToken,
    request: req,
    body: req.body,
    onBeforeGenerateToken: async () => ({
      allowedContentTypes: ['audio/webm', 'video/webm', 'audio/ogg', 'video/mp4', 'audio/mp4'],
      maximumSizeInBytes: config.maxVideoSize,
    }),
  });
  res.json(result);
}));

app.post("/api/answer_video", requireAuth, requireModuleAccess('ai_interview'), upload.single("video"), asyncHandler(async (req, res) => {
  const { session_id: sessionId } = req.body;

  if (!sessionId || !req.file) {
    throw new HttpError(400, "session_id and video are required");
  }

  if (req.file.size > config.maxVideoSize) {
    throw new HttpError(400, `Video exceeds ${Math.floor(config.maxVideoSize / 1024 / 1024)}MB`);
  }

  const rawPath = await writeTempFile(req.file, fileExtension(req.file, ".mp4"));
  let audioPath;

  try {
    audioPath = await extractAudio(rawPath);
    const transcript = await transcriber.transcribe(audioPath);
    const videoMetrics = await hasVideoStream(rawPath) ? await analyzeVideo(rawPath) : lowQualityMetrics();
    const response = await handleAnswer({ sessionId, answer: transcript, user: req.user, videoMetrics });
    res.json({ ...response, transcript });
  } finally {
    await cleanupFiles([rawPath, audioPath]);
  }
}));

async function downloadAndSave(url, suffix) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new HttpError(502, `Failed to download blob: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const safeSuffix = suffix || "";
  const tempPath = `/tmp/edvolve-${Date.now()}-${Math.random().toString(16).slice(2)}${safeSuffix}`;
  await fs.writeFile(tempPath, buffer);
  return tempPath;
}

app.post("/api/answer_video_with_audio", requireAuth, requireModuleAccess('ai_interview'), (req, res, next) => {
  if (req.body?.videoUrl || req.body?.audioUrl) return next();
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 }
  ])(req, res, next);
}, asyncHandler(async (req, res) => {
  const { session_id: sessionId } = req.body;
  const videoUrl = req.body?.videoUrl;
  const audioUrl = req.body?.audioUrl;
  const videoFile = req.files?.video?.[0];
  const audioFile = req.files?.audio?.[0];

  let videoPath, rawAudioPath;

  if (videoUrl && audioUrl) {
    if (!sessionId) throw new HttpError(400, "session_id is required");
    videoPath = await downloadAndSave(videoUrl, ".webm");
    rawAudioPath = await downloadAndSave(audioUrl, ".webm");
  } else {
    if (!sessionId || !videoFile || !audioFile) {
      throw new HttpError(400, "session_id, video, and audio are required");
    }
    if (videoFile.size > config.maxVideoSize) {
      throw new HttpError(400, `Video exceeds ${Math.floor(config.maxVideoSize / 1024 / 1024)}MB`);
    }
    if (audioFile.size > 50 * 1024 * 1024) {
      throw new HttpError(400, "Audio exceeds 50MB");
    }
    videoPath = await writeTempFile(videoFile, fileExtension(videoFile, ".webm"));
    rawAudioPath = await writeTempFile(audioFile, fileExtension(audioFile, ".webm"));
  }

  try {
    const transcript = await transcriber.transcribe(rawAudioPath);
    const videoMetrics = await hasVideoStream(videoPath) ? await analyzeVideo(videoPath) : lowQualityMetrics();
    const response = await handleAnswer({ sessionId, answer: transcript, user: req.user, videoMetrics });
    res.json({ ...response, transcript });
  } finally {
    await cleanupFiles([videoPath, rawAudioPath]);
  }
}));

app.get("/api/session/:session_id", requireAuth, requireModuleAccess('ai_interview'), asyncHandler(async (req, res) => {
  const session = await getSession(req.params.session_id);
  assertCanAccessSession(req.user, session);
  res.json({
    session_id: session.session_id,
    question: session.current_question || "",
    question_number: session.question_count || 1,
    status: session.status,
    domain: session.domain,
    role: session.role,
    ats_score: session.ats_analysis?.ats_score,
    skills_found: (session.ats_analysis?.skills_found || []).slice(0, 5),
    improvements: (session.ats_analysis?.improvements || []).slice(0, 3),
  });
}));

app.post("/api/end", requireAuth, requireModuleAccess('ai_interview'), asyncHandler(async (req, res) => {
  const { session_id: sessionId } = req.body || {};

  if (!sessionId) {
    throw new HttpError(400, "session_id is required");
  }

  const session = await getSession(sessionId);
  assertCanAccessSession(req.user, session);
  const history = session.history || [];

  if (!history.length) {
    throw new HttpError(400, "No answers");
  }

  const metricKeys = ["confidence", "body_language", "knowledge", "fluency", "skill_relevance"];
  const metricSums = Object.fromEntries(metricKeys.map((key) => [key, 0]));
  const evaluations = [];

  for (const item of history) {
    const evaluation = item.evaluation || {};
    for (const key of metricKeys) {
      metricSums[key] += Number(evaluation[key] || 0);
    }
    evaluations.push(evaluation);
  }

  const count = history.length;
  const avg = Object.fromEntries(
    metricKeys.map((key) => [key, Number((metricSums[key] / count).toFixed(1))])
  );
  const totalScore = Object.values(metricSums).reduce((sum, value) => sum + value, 0);
  const maxPossible = count * 50;
  const percentage = maxPossible ? (totalScore / maxPossible) * 100 : 0;
  let grade = "F";
  let label = "Re-take";

  if (percentage >= 85) {
    grade = "A";
    label = "Excellent";
  } else if (percentage >= 70) {
    grade = "B";
    label = "Good";
  } else if (percentage >= 55) {
    grade = "C";
    label = "Average";
  } else if (percentage >= 40) {
    grade = "D";
    label = "Needs Improvement";
  }

  const ats = session.ats_analysis || {};
  const summary = await aiService.generateOverallReport(ats, evaluations);
  const reportId = `FB-${new Date().toISOString().slice(0, 10)}-${uuidv4().slice(0, 3).toUpperCase()}`;

  const report = {
    session_id: sessionId,
    student_id: session.student_id || req.user._id.toString(),
    student_name: session.student_name || req.user.name || "",
    student_email: session.student_email || req.user.email || "",
    interview_domain: session.domain,
    interview_role: session.role,
    report_id: reportId,
    generated_date: new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "2-digit",
      timeZone: "UTC"
    }),
    overall: {
      total_score: totalScore,
      max_score: maxPossible,
      percentage: Number(percentage.toFixed(2)),
      grade,
      grade_label: label,
      metrics: avg
    },
    ats_analysis: {
      ats_score: ats.ats_score || 0,
      skills_found: ats.skills_found || [],
      improvements: ats.improvements || []
    },
    question_breakdown: history.map((item, index) => ({
      number: index + 1,
      question: item.question,
      answer: item.answer?.length > 200 ? `${item.answer.slice(0, 200)}...` : item.answer,
      evaluation: item.evaluation
    })),
    strengths: Array.isArray(summary.strengths) ? summary.strengths : [],
    areas_to_improve: Array.isArray(summary.areas_to_improve) ? summary.areas_to_improve : [],
    interview_tips: Array.isArray(summary.interview_tips) ? summary.interview_tips : []
  };

  const { reports } = collections();
  await reports.updateOne(
    { session_id: sessionId },
    {
      $set: report,
      $setOnInsert: {
        created_at: new Date()
      }
    },
    { upsert: true }
  );
  await updateSessionAtomic(sessionId, { status: "ended" });

  res.json(report);
}));

app.get("/api/reports", requireAuth, requireModuleAccess('ai_interview'), asyncHandler(async (req, res) => {
  const { reports } = collections();
  const query = ["admin", "master_admin"].includes(req.user.role)
    ? {}
    : { student_id: req.user._id.toString() };

  const items = await reports
    .find(query, {
      projection: {
        _id: 0,
        session_id: 1,
        report_id: 1,
        generated_date: 1,
        student_name: 1,
        student_email: 1,
        interview_domain: 1,
        interview_role: 1,
        overall: 1,
        created_at: 1,
      },
    })
    .sort({ created_at: -1 })
    .limit(100)
    .toArray();

  res.json({
    reports: items.map((report) => ({
      session_id: report.session_id,
      report_id: report.report_id,
      generated_date: report.generated_date,
      student_name: report.student_name || "",
      student_email: report.student_email || "",
      domain: report.interview_domain || "",
      role: report.interview_role || "",
      grade: report.overall?.grade || "",
      percentage: report.overall?.percentage || 0,
      total_score: report.overall?.total_score || 0,
      max_score: report.overall?.max_score || 0,
      created_at: report.created_at,
    })),
  });
}));

app.get("/api/report/:session_id", requireAuth, requireModuleAccess('ai_interview'), asyncHandler(async (req, res) => {
  const { reports } = collections();
  const report = await reports.findOne({ session_id: req.params.session_id }, { projection: { _id: 0 } });

  if (!report) {
    throw new HttpError(404, "Report not found");
  }
  if (!canAccessStudentRecord(req.user, report.student_id)) {
    throw new HttpError(403, "You do not have permission to access this report");
  }

  res.json(report);
}));

app.get("/api/report/:session_id/pdf", requireAuth, requireModuleAccess('ai_interview'), asyncHandler(async (req, res) => {
  const { reports } = collections();
  const report = await reports.findOne({ session_id: req.params.session_id }, { projection: { _id: 0 } });

  if (!report) {
    throw new HttpError(404, "Report not found");
  }
  if (!canAccessStudentRecord(req.user, report.student_id)) {
    throw new HttpError(403, "You do not have permission to access this report");
  }

  const pdf = await generatePerformancePdf(report);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=report_${req.params.session_id}.pdf`);
  res.send(pdf);
}));

app.get("/api/report/:session_id/ats", requireAuth, requireModuleAccess('ai_interview'), asyncHandler(async (req, res) => {
  const { reports } = collections();
  const report = await reports.findOne({ session_id: req.params.session_id }, { projection: { _id: 0 } });

  if (!report) {
    throw new HttpError(404, "Report not found");
  }
  if (!canAccessStudentRecord(req.user, report.student_id)) {
    throw new HttpError(403, "You do not have permission to access this report");
  }

  const pdf = await generateAtsPdf(report);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=ats_report_${req.params.session_id}.pdf`);
  res.send(pdf);
}));

app.get("/api/aptitude/questions", asyncHandler(async (req, res) => {
  const { domain, count = 20 } = req.query;

  if (!["engineering", "bca"].includes(domain)) {
    throw new HttpError(400, "Domain must be 'engineering' or 'bca'");
  }

  const sampleSize = Math.min(Number(count) || 20, 100);
  const { aptitudeQuestions } = collections();
  const questions = await aptitudeQuestions.aggregate([
    { $match: { domain } },
    { $sample: { size: sampleSize } },
    { $project: { correct_answer: 0, explanation: 0 } }
  ]).toArray();

  res.json({
    questions: questions.map((question) => ({
      ...question,
      _id: String(question._id)
    }))
  });
}));

app.post("/api/aptitude/submit", asyncHandler(async (req, res) => {
  const { domain, answers } = req.body || {};

  if (!domain || !answers || typeof answers !== "object") {
    throw new HttpError(400, "domain and answers are required");
  }

  const ids = Object.keys(answers);
  const objectIds = ids.filter(ObjectId.isValid).map((id) => new ObjectId(id));
  const { aptitudeQuestions, aptitudeResults } = collections();
  const questions = await aptitudeQuestions.find({
    $or: [
      { _id: { $in: objectIds } },
      { _id: { $in: ids } }
    ]
  }).toArray();

  let correct = 0;
  const detailed = questions.map((question) => {
    const questionId = String(question._id);
    const isCorrect = answers[questionId] === question.correct_answer;
    if (isCorrect) {
      correct += 1;
    }

    return {
      question_id: questionId,
      question: question.question_text,
      user_answer: answers[questionId],
      correct_answer: question.correct_answer,
      is_correct: isCorrect,
      explanation: question.explanation || ""
    };
  });

  const percentage = questions.length ? (correct / questions.length) * 100 : 0;
  const result = {
    domain,
    score: correct,
    total: questions.length,
    percentage: Number(percentage.toFixed(2)),
    detailed
  };

  await aptitudeResults.insertOne({
    user_id: null,
    domain,
    result,
    timestamp: new Date()
  });

  res.json(result);
}));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/master", masterAdminRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/programming/student", programmingStudentRoutes);
app.use("/api/programming/admin", programmingAdminRoutes);
app.use("/api/programming/master", programmingMasterAdminRoutes);
app.use("/api/programming-assessment/student", assessmentStudentRoutes);
app.use("/api/programming-assessment/admin", assessmentAdminRoutes);
app.use("/api/programming-assessment/master", assessmentMasterAdminRoutes);

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ detail: error.message, message: error.message });
    return;
  }

  const status = error.status || error.statusCode || 500;
  const message = status === 500 ? "Internal server error" : error.message || "Internal server error";
  const payload = {
    detail: message,
    message,
    details: []
  };

  if (error.details) {
    payload.details = Array.isArray(error.details) ? error.details : [String(error.details)];
  }

  if (process.env.NODE_ENV !== "production" && status >= 400) {
    console.error("[api-error]", {
      status,
      message: error.message,
      details: error.details,
      cause: error.cause?.message
    });
  }

  res.status(status).json(payload);
});

async function start() {
  await connectDatabase();

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || config.mongoUri;
  if (!mongoUri) {
    throw new Error("MONGODB_URI or MONGO_URI is required for integrated routes");
  }

  if (mongoose.connection.readyState === 0) {
    mongoose.set("strictQuery", true);
    await mongoose.connect(mongoUri);
    console.log("Mongoose connected");
  }

  const server = app.listen(config.port, "0.0.0.0", () => {
    console.log(`Server running on 0.0.0.0:${config.port}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${config.port} is already in use. Set PORT to another value in .env.`);
      process.exit(1);
    }

    console.error(error);
    process.exit(1);
  });
}

process.on("SIGINT", async () => {
  await closeDatabase();
  await mongoose.disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeDatabase();
  await mongoose.disconnect();
  process.exit(0);
});

export default app;

const isVercel = process.env.VERCEL === '1';
if (!isVercel) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
