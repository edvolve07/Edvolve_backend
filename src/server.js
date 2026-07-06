import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { v4 as uuidv4 } from "uuid";
import cookieParser from 'cookie-parser';
import { config, ALLOWED_ORIGINS } from "./config.js";
import { closeDatabase, collections, connectDatabase } from "./db.js";
import { hashPassword, verifyPassword, createAuthToken, validateEmail, validatePassword } from "./utils/auth.js";
import { apiLimiter, strictLimiter } from "./middleware/rateLimiter.js";
import authRoutes from "./aptitude/routes/authRoutes.js";
import adminRoutes from "./aptitude/routes/adminRoutes.js";
import masterAdminRoutes from "./aptitude/routes/masterAdminRoutes.js";
import institutionRoutes from "./aptitude/routes/institutionRoutes.js";
import studentRoutes from "./aptitude/routes/studentRoutes.js";
import programmingStudentRoutes from "./programming/routes/studentRoutes.js";
import programmingAdminRoutes from "./programming/routes/adminRoutes.js";
import programmingMasterAdminRoutes from "./programming/routes/masterAdminRoutes.js";
import assessmentStudentRoutes from "./programming/routes/assessmentStudentRoutes.js";
import assessmentAdminRoutes from "./programming/routes/assessmentAdminRoutes.js";
import assessmentMasterAdminRoutes from "./programming/routes/assessmentMasterAdminRoutes.js";
import communicationStudentRoutes from "./communication/routes/studentRoutes.js";
import communicationAdminRoutes from "./communication/routes/adminRoutes.js";
import livekitRoutes from "./livekit/routes.js";
import { getCodeRunnerHealth } from "./programming/services/executionService.js";
import { aiService } from "./services/aiService.js";
import { extractTextFromPdf } from "./services/resumeParser.js";
import { transcriber } from "./services/transcriber.js";

import {
  analyzeVideo,
  cleanupFiles,
  extractAudio,
  hasVideoStream,
  lowQualityMetrics
} from "./services/mediaService.js";
import { generateAtsPdf, generatePerformancePdf } from "./services/pdfReports.js";
import { HttpError, asyncHandler } from "./utils/httpError.js";
import { requireAuth, requireModuleAccess, requireRole } from "./aptitude/middleware/auth.js";
import { formatDisplayName } from "./aptitude/utils/nameFormat.js";
import { validateFileType } from "./utils/fileValidation.js";
import { Op, InterviewSession, InterviewReport, Admin, Student, AptitudeQuestion, AptitudeResult, getSequelize, syncDatabase } from "./database/index.js";

const app = express();
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: config.maxVideoSize }
});

app.set('trust proxy', 1);

const ALLOWED_ORIGINS_SET = new Set(ALLOWED_ORIGINS);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS_SET.has(origin)) return cb(null, true);
    cb(null, origin);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-CSRF-Token'],
  maxAge: 86400,
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", ...ALLOWED_ORIGINS],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  xFrameOptions: { action: 'deny' },
  referrerPolicy: { policy: 'same-origin' },
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
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
  const session = await InterviewSession.findOne({ where: { session_id: sessionId } });
  if (!session) {
    throw new HttpError(404, "Session not found");
  }
  return session;
}

function canAccessStudentRecord(user, studentId) {
  if (!user || !studentId) return false;
  if (["admin", "master_admin"].includes(user.role)) return true;
  return studentId === user._id;
}

function assertCanAccessSession(user, session) {
  if (!canAccessStudentRecord(user, session.student_id)) {
    throw new HttpError(403, "You do not have permission to access this interview session");
  }
}

async function updateSessionAtomic(sessionId, update) {
  const [affected] = await InterviewSession.update(update, { where: { session_id: sessionId } });
  if (affected === 0) {
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
    message: "AI Interview System (Node.js + Postgres)",
    version: "1.0-node"
  });
});

app.get("/api/health", asyncHandler(async (req, res) => {
  const codeRunner = await getCodeRunnerHealth();
  res.json({
    status: "healthy",
    version: "1.0-node",
    database: "postgresql",
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

app.post("/api/signup", strictLimiter, asyncHandler(async (req, res) => {
  const { email, password, name } = req.body || {};

  if (!validateEmail(email) || !validatePassword(password)) {
    throw new HttpError(400, "Valid email and password (min 8 characters) are required");
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (config.masterAdminEmails.has(normalizedEmail) || config.adminEmails.has(normalizedEmail)) {
    throw new HttpError(403, "Registration is not available for this email");
  }

  const displayName = formatDisplayName(name);
  const { salt, hash } = await hashPassword(password);
  const authToken = createAuthToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  try {
    const result = await Student.create({
      email: normalizedEmail,
      name: displayName,
      password_hash: hash,
      password_salt: salt,
      auth_token: authToken,
      auth_expires_at: expiresAt,
      is_active: true,
    });

    res.status(201).json({
      user: {
        user_id: result._id,
        email: normalizedEmail,
        name: displayName
      },
      access_token: authToken,
      expires_at: expiresAt
    });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
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
  let user = await Student.findOne({ where: { email: normalizedEmail } });
  if (!user) {
    user = await Admin.findOne({ where: { email: normalizedEmail } });
  }

  if (!user) {
    throw new HttpError(401, "Invalid email or password");
  }

  const isValid = await verifyPassword(password, user.password_salt, user.password_hash);

  if (!isValid) {
    throw new HttpError(401, "Invalid email or password");
  }

  if (user.is_active === false) {
    throw new HttpError(403, "Account is deactivated");
  }

  const authToken = createAuthToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  user.auth_token = authToken;
  user.auth_expires_at = expiresAt;
  await user.save();

  res.json({
    user: {
      user_id: user._id,
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

  let user = await Student.findOne({
    where: {
      auth_token: token,
      auth_expires_at: { [Op.gt]: new Date() }
    }
  });
  if (!user) {
    user = await Admin.findOne({
      where: {
        auth_token: token,
        auth_expires_at: { [Op.gt]: new Date() }
      }
    });
  }

  if (!user) {
    throw new HttpError(401, "Invalid or expired auth token");
  }

  if (user.is_active === false) {
    throw new HttpError(403, "Account is deactivated");
  }

  res.json({
    user: {
      user_id: user._id,
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

  const fileBuffer = await fs.readFile(req.file.path);
  const typeCheck = validateFileType(fileBuffer, req.file.originalname);
  if (!typeCheck.valid) {
    throw new HttpError(400, typeCheck.error);
  }

  const resumeText = await extractTextFromPdf(fileBuffer);
  const ats = await aiService.analyzeResume(resumeText);
  const firstQuestion = await aiService.generateFirstQuestion(resumeText, domain, role);
  const sessionId = uuidv4();

  const session = {
    session_id: sessionId,
    student_id: req.user._id,
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
  };

  await InterviewSession.create(session);

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



app.post("/api/answer_video", requireAuth, requireModuleAccess('ai_interview'), upload.single("video"), asyncHandler(async (req, res) => {
  const { session_id: sessionId } = req.body;

  if (!sessionId || !req.file) {
    throw new HttpError(400, "session_id and video are required");
  }

  if (req.file.size > config.maxVideoSize) {
    throw new HttpError(400, `Video exceeds ${Math.floor(config.maxVideoSize / 1024 / 1024)}MB`);
  }

  const rawPath = req.file.path;
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

app.post("/api/answer_video_with_audio", requireAuth, requireModuleAccess('ai_interview'), upload.fields([
  { name: "video", maxCount: 1 },
  { name: "audio", maxCount: 1 }
]), asyncHandler(async (req, res) => {
  const { session_id: sessionId } = req.body;
  const videoFile = req.files?.video?.[0];
  const audioFile = req.files?.audio?.[0];

  if (!sessionId || !videoFile || !audioFile) {
    throw new HttpError(400, "session_id, video, and audio are required");
  }
  if (videoFile.size > config.maxVideoSize) {
    throw new HttpError(400, `Video exceeds ${Math.floor(config.maxVideoSize / 1024 / 1024)}MB`);
  }
  if (audioFile.size > 50 * 1024 * 1024) {
    throw new HttpError(400, "Audio exceeds 50MB");
  }

  let videoPath = videoFile.path;
  let rawAudioPath = audioFile.path;

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

  const existing = await InterviewReport.findOne({ where: { session_id: sessionId } });
  if (existing) {
    await updateSessionAtomic(sessionId, { status: "ended" });
    res.json(existing);
    return;
  }

  const history = (session.history || []).map(item => ({
    ...item,
    answer: item.answer || "Not Answered"
  }));

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

  const count = history.length || 1;
  const avg = Object.fromEntries(
    metricKeys.map((key) => [key, Number((metricSums[key] / count).toFixed(1))])
  );
  const totalScore = Object.values(metricSums).reduce((sum, value) => sum + value, 0);
  const maxPossible = (history.length || 1) * 50;
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
  let summary;
  try {
    summary = await aiService.generateOverallReport(ats, evaluations);
  } catch {
    summary = {};
  }
  const reportId = `FB-${new Date().toISOString().slice(0, 10)}-${uuidv4().slice(0, 3).toUpperCase()}`;

  const questionBreakdown = history.length
    ? history.map((item, index) => ({
        number: index + 1,
        question: item.question,
        answer: item.answer && item.answer !== "Not Answered" && item.answer.length > 200
          ? `${item.answer.slice(0, 200)}...`
          : item.answer || "Not Answered",
        evaluation: item.evaluation || {}
      }))
    : [{
        number: 1,
        question: session.current_question || "No question was asked",
        answer: "Not Answered",
        evaluation: {}
      }];

  const report = {
    session_id: sessionId,
    student_id: session.student_id,
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
    question_breakdown: questionBreakdown,
    strengths: Array.isArray(summary.strengths) ? summary.strengths : [],
    areas_to_improve: Array.isArray(summary.areas_to_improve) ? summary.areas_to_improve : [],
    interview_tips: Array.isArray(summary.interview_tips) ? summary.interview_tips : []
  };

  await InterviewReport.upsert({
    session_id: sessionId,
    ...report,
  });
  await updateSessionAtomic(sessionId, { status: "ended" });

  res.json(report);
}));

app.get("/api/reports", requireAuth, requireModuleAccess('ai_interview'), asyncHandler(async (req, res) => {
  const query = ["admin", "master_admin"].includes(req.user.role)
    ? {}
    : { student_id: req.user._id };

  const items = await InterviewReport.findAll({
    where: query,
    attributes: [
      'session_id', 'report_id', 'generated_date', 'student_name',
      'student_email', 'interview_domain', 'interview_role',
      'overall', 'created_at'
    ],
    order: [['created_at', 'DESC']],
    limit: 100,
  });

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
  const report = await InterviewReport.findOne({
    where: { session_id: req.params.session_id },
    attributes: { exclude: ['_id'] },
  });

  if (!report) {
    throw new HttpError(404, "Report not found");
  }
  if (!canAccessStudentRecord(req.user, report.student_id)) {
    throw new HttpError(403, "You do not have permission to access this report");
  }

  res.json(report);
}));

app.get("/api/report/:session_id/pdf", requireAuth, requireModuleAccess('ai_interview'), asyncHandler(async (req, res) => {
  const report = await InterviewReport.findOne({
    where: { session_id: req.params.session_id },
    attributes: { exclude: ['_id'] },
  });

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
  const report = await InterviewReport.findOne({
    where: { session_id: req.params.session_id },
    attributes: { exclude: ['_id'] },
  });

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

app.get("/api/aptitude/questions", requireAuth, asyncHandler(async (req, res) => {
  const { domain, count = 20 } = req.query;

  if (!["engineering", "bca"].includes(domain)) {
    throw new HttpError(400, "Domain must be 'engineering' or 'bca'");
  }

  const sampleSize = Math.min(Number(count) || 20, 100);
  const questions = await AptitudeQuestion.findAll({
    where: { domain },
    order: [['_id', 'ASC']],
    limit: sampleSize,
    attributes: { exclude: ['correct_answer', 'explanation', '_id'] },
  });

  res.json({
    questions: questions.map((question) => ({
      ...question.toJSON(),
    }))
  });
}));

app.post("/api/aptitude/submit", requireAuth, asyncHandler(async (req, res) => {
  const { domain, answers } = req.body || {};

  if (!domain || !answers || typeof answers !== "object") {
    throw new HttpError(400, "domain and answers are required");
  }

  const ids = Object.keys(answers);
  const questions = await AptitudeQuestion.findAll({
    where: { _id: { [Op.in]: ids } }
  });

  let correct = 0;
  const detailed = questions.map((question) => {
    const questionId = question._id;
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

  await AptitudeResult.create({
    user_id: null,
    domain,
    result,
  });

  res.json(result);
}));

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/master", masterAdminRoutes);
app.use("/api/institutions", institutionRoutes);
app.use("/api/student", studentRoutes);
app.use("/api/programming/student", programmingStudentRoutes);
app.use("/api/programming/admin", programmingAdminRoutes);
app.use("/api/programming/master", programmingMasterAdminRoutes);
app.use("/api/programming-assessment/student", assessmentStudentRoutes);
app.use("/api/programming-assessment/admin", assessmentAdminRoutes);
app.use("/api/programming-assessment/master", assessmentMasterAdminRoutes);
app.use("/api/communication/student", communicationStudentRoutes);
app.use("/api/communication/admin", communicationAdminRoutes);
app.use("/api/livekit", livekitRoutes);

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
  if (!config.isProduction) {
    await syncDatabase({ alter: false });
    console.log('Database tables synced');
  }

  const sequelize = getSequelize();
  try {
    await sequelize.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS target_audience VARCHAR(20) DEFAULT 'all'`);
    await sequelize.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS department_ids JSONB DEFAULT NULL`);
    console.log('Assessment schema migration applied');
  } catch (_err) {
    console.log('Assessment schema migration skipped (table may not exist yet)');
  }

  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS communication_scenarios (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title VARCHAR(255) NOT NULL,
        description TEXT DEFAULT '',
        category VARCHAR(100) DEFAULT '',
        context TEXT DEFAULT '',
        difficulty VARCHAR(20) DEFAULT 'Medium',
        status VARCHAR(20) DEFAULT 'draft',
        created_by VARCHAR(64) DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS communication_sessions (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id VARCHAR(64) UNIQUE NOT NULL,
        student_id VARCHAR(64) NOT NULL,
        student_name VARCHAR(255) DEFAULT '',
        student_email VARCHAR(255) DEFAULT '',
        scenario_id VARCHAR(64) DEFAULT '',
        category VARCHAR(100) DEFAULT '',
        context TEXT DEFAULT '',
        history JSONB DEFAULT '[]',
        current_prompt TEXT DEFAULT '',
        exchange_count INTEGER DEFAULT 0,
        max_exchanges INTEGER DEFAULT 6,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_comm_sessions_student ON communication_sessions (student_id, created_at)
    `);
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS communication_reports (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id VARCHAR(64) UNIQUE NOT NULL,
        student_id VARCHAR(64) NOT NULL,
        student_name VARCHAR(255) DEFAULT '',
        student_email VARCHAR(255) DEFAULT '',
        category VARCHAR(100) DEFAULT '',
        report_id VARCHAR(100) DEFAULT '',
        generated_date VARCHAR(100) DEFAULT '',
        overall JSONB DEFAULT '{}',
        exchange_breakdown JSONB DEFAULT '[]',
        strengths JSONB DEFAULT '[]',
        areas_to_improve JSONB DEFAULT '[]',
        tips JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_comm_reports_student ON communication_reports (student_id, created_at)
    `);
    // Add new scoring system columns if they don't exist
    const newColumns = [
      'conversation_log JSONB DEFAULT \'[]\'',
      'category_insights JSONB DEFAULT \'{}\'',
      'real_world_preparation JSONB DEFAULT \'[]\'',
      'competency_analysis JSONB DEFAULT \'{}\'',
    ];
    for (const colDef of newColumns) {
      const colName = colDef.split(' ')[0];
      try {
        await sequelize.query(`ALTER TABLE communication_reports ADD COLUMN IF NOT EXISTS ${colDef}`);
      } catch (_e) {
        // column might already exist
      }
    }
    console.log('Communication module schema migration applied');
  } catch (_err) {
    console.log('Communication module schema migration skipped', _err.message);
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
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeDatabase();
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
