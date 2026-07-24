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
import bcrypt from "bcryptjs";
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
import mentorshipRoutes from "./mentorship/routes.js";
import subscriptionRoutes from "./subscription/routes.js";
import helpRoutes from "./help/routes.js";
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
import { buildUserContext } from "./aptitude/utils/userContext.js";
import { Op, User, InterviewSession, InterviewReport, AptitudeQuestion, AptitudeResult, getSequelize, syncDatabase } from "./database/index.js";

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
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-CSRF-Token'],
  maxAge: 86400,
}));

app.options('*', cors());

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
    const result = await User.create({
      email: normalizedEmail,
      name: displayName,
      password_hash: hash,
      password_salt: salt,
      auth_token: authToken,
      auth_expires_at: expiresAt,
      is_active: true,
      role: 'student',
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
  const userRow = await User.findOne({ where: { email: normalizedEmail } });
  if (!userRow) {
    throw new HttpError(401, "Invalid email or password");
  }

  const isBcryptHash = String(userRow.password_hash || '').startsWith('$2');
  const isValid = isBcryptHash
    ? await bcrypt.compare(password, userRow.password_hash)
    : userRow.password_salt
      ? await verifyPassword(password, userRow.password_salt, userRow.password_hash)
      : false;

  if (!isValid) {
    throw new HttpError(401, "Invalid email or password");
  }

  if (userRow.is_active === false) {
    throw new HttpError(403, "Account is deactivated");
  }

  const authToken = createAuthToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  userRow.auth_token = authToken;
  userRow.auth_expires_at = expiresAt;
  await userRow.save();

  res.json({
    user: {
      user_id: userRow._id,
      email: userRow.email,
      name: userRow.name || ""
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

  const userRow = await User.findOne({
    where: {
      auth_token: token,
      auth_expires_at: { [Op.gt]: new Date() }
    }
  });

  if (!userRow) {
    throw new HttpError(401, "Invalid or expired auth token");
  }

  if (userRow.is_active === false) {
    throw new HttpError(403, "Account is deactivated");
  }

  res.json({
    user: {
      user_id: userRow._id,
      email: userRow.email,
      name: userRow.name || ""
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
app.use("/api/mentorship", mentorshipRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/help", helpRoutes);

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
    await sequelize.query(`ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assigned_student_ids JSONB DEFAULT NULL`);
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

  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        provider VARCHAR(50) NOT NULL UNIQUE,
        api_key TEXT NOT NULL,
        updated_by VARCHAR(255) DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('API keys table ready');
  } catch (_err) {
    console.log('API keys table migration skipped', _err.message);
  }

  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS journey_blueprints (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        interview_number INTEGER UNIQUE NOT NULL,
        title VARCHAR(255) NOT NULL,
        level INTEGER NOT NULL,
        objective TEXT NOT NULL,
        focus_areas JSONB DEFAULT '[]',
        difficulty VARCHAR(20) DEFAULT 'Medium',
        ai_prompt TEXT NOT NULL,
        follow_up_guidelines JSONB DEFAULT '[]',
        evaluation_criteria JSONB DEFAULT '{}',
        domain VARCHAR(100) DEFAULT 'General',
        role VARCHAR(100) DEFAULT 'Software Engineer',
        category VARCHAR(100) DEFAULT 'Technical',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_jb_interview_number ON journey_blueprints (interview_number)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_jb_level ON journey_blueprints (level)`);
    console.log('Journey blueprints table ready');
  } catch (_err) {
    console.log('Journey blueprints table migration skipped', _err.message);
  }

  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS student_journeys (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id VARCHAR(64) UNIQUE NOT NULL,
        student_name VARCHAR(255) DEFAULT '',
        student_email VARCHAR(255) DEFAULT '',
        institution_id UUID DEFAULT NULL,
        journey_access_level INTEGER DEFAULT 0,
        current_level INTEGER DEFAULT 1,
        current_interview_number INTEGER DEFAULT 1,
        completed_interviews INTEGER DEFAULT 0,
        total_interviews INTEGER DEFAULT 24,
        overall_score FLOAT DEFAULT 0,
        readiness_score FLOAT DEFAULT 0,
        status VARCHAR(20) DEFAULT 'not_started',
        started_at TIMESTAMPTZ DEFAULT NULL,
        completed_at TIMESTAMPTZ DEFAULT NULL,
        last_interview_at TIMESTAMPTZ DEFAULT NULL,
        target_career_goal VARCHAR(255) DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_sj_student_id ON student_journeys (student_id)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_sj_institution ON student_journeys (institution_id)`);
    console.log('Student journeys table ready');
  } catch (_err) {
    console.log('Student journeys table migration skipped', _err.message);
  }

  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS journey_interviews (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id VARCHAR(64) NOT NULL,
        interview_number INTEGER NOT NULL,
        blueprint_id UUID DEFAULT NULL,
        blueprint_title VARCHAR(255) DEFAULT '',
        level INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'locked',
        session_id VARCHAR(64) DEFAULT NULL,
        report_id VARCHAR(100) DEFAULT NULL,
        overall_score FLOAT DEFAULT 0,
        grade VARCHAR(5) DEFAULT '',
        started_at TIMESTAMPTZ DEFAULT NULL,
        completed_at TIMESTAMPTZ DEFAULT NULL,
        level_at_time INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ji_student_interview ON journey_interviews (student_id, interview_number)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ji_student_status ON journey_interviews (student_id, status)`);
    console.log('Journey interviews table ready');
  } catch (_err) {
    console.log('Journey interviews table migration skipped', _err.message);
  }

  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID NOT NULL,
        plan_key VARCHAR(50) NOT NULL,
        plan_name VARCHAR(100) NOT NULL,
        access_level INTEGER NOT NULL DEFAULT 0,
        interviews_total INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        razorpay_order_id VARCHAR(255),
        razorpay_payment_id VARCHAR(255),
        razorpay_subscription_id VARCHAR(255),
        amount_paid INTEGER DEFAULT 0,
        currency VARCHAR(10) DEFAULT 'INR',
        gst_amount INTEGER DEFAULT 0,
        start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        end_date TIMESTAMP WITH TIME ZONE,
        invoices JSONB DEFAULT '[]',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_sub_student ON subscriptions (student_id)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_sub_status ON subscriptions (status)`);
    console.log('Subscriptions table ready');
  } catch (_err) {
    console.log('Subscriptions table migration skipped', _err.message);
  }

  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS payment_transactions (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_id UUID NOT NULL,
        subscription_id UUID,
        amount INTEGER NOT NULL,
        currency VARCHAR(10) DEFAULT 'INR',
        gst_amount INTEGER DEFAULT 0,
        total_amount INTEGER DEFAULT 0,
        payment_method VARCHAR(50),
        payment_id VARCHAR(255),
        order_id VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        invoice_number VARCHAR(50),
        invoice_date TIMESTAMP WITH TIME ZONE,
        invoice_items JSONB DEFAULT '[]',
        plan_key VARCHAR(50),
        plan_name VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pt_student ON payment_transactions (student_id)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pt_subscription ON payment_transactions (subscription_id)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pt_payment_id ON payment_transactions (payment_id)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_pt_invoice ON payment_transactions (invoice_number)`);
    console.log('Payment transactions table ready');
  } catch (_err) {
    console.log('Payment transactions table migration skipped', _err.message);
  }

  try {
    const { loadApiKeysFromDb } = await import("./services/apiKeyService.js");
    await loadApiKeysFromDb();
    console.log('API keys loaded from database');
  } catch (_err) {
    console.log('API keys load skipped, using env vars:', _err.message);
  }

  // ── Phase 2: Unified user hierarchy migration ──────────────────────────
  // Create profile tables and migrate existing admins/students into the
  // unified `users` table.  Old tables are kept intact for safety.
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS enterprise_students (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID UNIQUE NOT NULL,
        institution_id UUID DEFAULT NULL,
        department_id UUID DEFAULT NULL,
        journey_access INTEGER DEFAULT 0,
        current_level INTEGER DEFAULT 1,
        current_interview INTEGER DEFAULT 1,
        student_status VARCHAR(20) DEFAULT 'active',
        usn VARCHAR(50) DEFAULT NULL,
        year VARCHAR(20) DEFAULT NULL,
        assigned_admin UUID DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_es_user ON enterprise_students (user_id)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_es_institution ON enterprise_students (institution_id)`);
    console.log('Enterprise students profile table ready');
  } catch (_err) {
    console.log('Enterprise students table migration skipped:', _err.message);
  }

  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS individual_students (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID UNIQUE NOT NULL,
        subscription_id UUID DEFAULT NULL,
        journey_access INTEGER DEFAULT 0,
        current_level INTEGER DEFAULT 1,
        current_interview INTEGER DEFAULT 1,
        subscription_status VARCHAR(20) DEFAULT 'inactive',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_is_user ON individual_students (user_id)`);
    console.log('Individual students profile table ready');
  } catch (_err) {
    console.log('Individual students table migration skipped:', _err.message);
  }

  // Add status + assigned_admin columns to users table if missing
  try {
    await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`);
    await sequelize.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS assigned_admin UUID DEFAULT NULL`);
    console.log('Users table columns updated');
  } catch (_err) {
    console.log('Users table column migration skipped:', _err.message);
  }

  // Migrate admins → users
  try {
    const adminCount = await sequelize.query(`SELECT COUNT(*)::int AS cnt FROM admins`, { plain: true });
    const userCount = await sequelize.query(`SELECT COUNT(*)::int AS cnt FROM users`, { plain: true });
    if (adminCount.cnt > 0 && userCount.cnt <= adminCount.cnt) {
      await sequelize.query(`
        INSERT INTO users (_id, name, email, phone, organization, admin_role, department_id, role, modules_access, "institutionId", must_change_password, password_hash, password_salt, email_verified, is_active, auth_token, auth_expires_at, assigned_admin, status, created_at, updated_at)
        SELECT _id, name, email, phone, organization, admin_role, department_id, role, modules_access, "institutionId", must_change_password, password_hash, password_salt, email_verified, is_active, auth_token, auth_expires_at, NULL AS assigned_admin, 'active' AS status, created_at, updated_at
        FROM admins
        ON CONFLICT (_id) DO NOTHING
      `);
      console.log(`Migrated ${adminCount.cnt} admins → users`);
    }
  } catch (_err) {
    console.log('Admin → users migration skipped:', _err.message);
  }

  // Migrate enterprise students → users + enterprise_students
  try {
    const entCount = await sequelize.query(`SELECT COUNT(*)::int AS cnt FROM students WHERE role = 'student'`, { plain: true });
    await sequelize.query(`
      INSERT INTO users (_id, name, email, phone, organization, usn, department_id, year, interested_role, profile_headline, profile_bio, location, modules_access, role, "institutionId", assigned_admin, must_change_password, password_hash, password_salt, email_verified, is_active, auth_token, auth_expires_at, status, created_at, updated_at)
      SELECT _id, name, email, phone, organization, usn, department_id, year, interested_role, profile_headline, profile_bio, location, modules_access, role, "institutionId", assigned_admin, must_change_password, password_hash, password_salt, email_verified, is_active, auth_token, auth_expires_at, 'active' AS status, created_at, updated_at
      FROM students
      WHERE role = 'student'
      ON CONFLICT (_id) DO NOTHING
    `);
    await sequelize.query(`
      INSERT INTO enterprise_students (_id, user_id, institution_id, department_id, usn, year, assigned_admin, created_at, updated_at)
      SELECT gen_random_uuid(), s._id, s."institutionId", s.department_id, s.usn, s.year, s.assigned_admin, s.created_at, s.updated_at
      FROM students s
      WHERE s.role = 'student'
      ON CONFLICT (user_id) DO NOTHING
    `);
    console.log(`Migrated ${entCount.cnt} enterprise students → users + enterprise_students`);
  } catch (_err) {
    console.log('Enterprise student migration skipped:', _err.message);
  }

  // Migrate individual students → users + individual_students
  try {
    const indCount = await sequelize.query(`SELECT COUNT(*)::int AS cnt FROM students WHERE role = 'individual_student'`, { plain: true });
    await sequelize.query(`
      INSERT INTO users (_id, name, email, phone, organization, usn, department_id, year, interested_role, profile_headline, profile_bio, location, modules_access, role, "institutionId", assigned_admin, must_change_password, password_hash, password_salt, email_verified, is_active, auth_token, auth_expires_at, status, created_at, updated_at)
      SELECT _id, name, email, phone, organization, usn, department_id, year, interested_role, profile_headline, profile_bio, location, modules_access, role, "institutionId", assigned_admin, must_change_password, password_hash, password_salt, email_verified, is_active, auth_token, auth_expires_at, 'active' AS status, created_at, updated_at
      FROM students
      WHERE role = 'individual_student'
      ON CONFLICT (_id) DO NOTHING
    `);
    await sequelize.query(`
      INSERT INTO individual_students (_id, user_id, subscription_id, journey_access, current_level, current_interview, subscription_status, created_at, updated_at)
      SELECT gen_random_uuid(), s._id, NULL AS subscription_id,
        COALESCE(sj.journey_access_level, 0) AS journey_access,
        COALESCE(sj.current_level, 1) AS current_level,
        COALESCE(sj.current_interview_number, 1) AS current_interview,
        'inactive' AS subscription_status,
        s.created_at, s.updated_at
      FROM students s
      LEFT JOIN student_journeys sj ON sj.student_id = s._id::text
      WHERE s.role = 'individual_student'
      ON CONFLICT (user_id) DO NOTHING
    `);
    console.log(`Migrated ${indCount.cnt} individual students → users + individual_students`);
  } catch (_err) {
    console.log('Individual student migration skipped:', _err.message);
  }

  // Sync subscription_id into individual_students from active subscriptions
  try {
    await sequelize.query(`
      UPDATE individual_students is2 SET
        subscription_id = sub._id,
        subscription_status = sub.status,
        journey_access = sub.access_level,
        updated_at = NOW()
      FROM subscriptions sub
      WHERE is2.user_id = sub.student_id
        AND sub.status = 'active'
    `);
    console.log('Linked subscriptions to individual_students');
  } catch (_err) {
    console.log('Subscription linking skipped:', _err.message);
  }
  // ── End Phase 2 migration ─────────────────────────────────────────────

  // ── Phase 3 normalization: new tables + data migration ─────────────────
  // Each table is in its own try/catch so one failure doesn't block the rest.

  // Plans table — drop old incompatible schema if it exists, then recreate
  try {
    const [[existing]] = await sequelize.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'plans' AND column_name = 'plan_key'
    `);
    if (!existing) {
      console.log('Recreating plans table with normalized schema...');
      await sequelize.query(`DROP TABLE IF EXISTS plans CASCADE`);
      await sequelize.query(`
        CREATE TABLE plans (
          _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          plan_key VARCHAR(50) NOT NULL UNIQUE,
          plan_name VARCHAR(100) NOT NULL,
          duration_months INTEGER NOT NULL DEFAULT 1,
          max_level INTEGER NOT NULL DEFAULT 1,
          journey_access INTEGER NOT NULL DEFAULT 0,
          total_interviews INTEGER NOT NULL DEFAULT 0,
          price INTEGER NOT NULL DEFAULT 0,
          gst_percentage FLOAT NOT NULL DEFAULT 18,
          status VARCHAR(20) DEFAULT 'active',
          features JSONB DEFAULT '[]',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await sequelize.query(`CREATE INDEX idx_plans_key ON plans (plan_key)`);
      console.log('Plans table recreated with normalized schema');
    } else {
      console.log('Plans table already has normalized schema');
    }
  } catch (_err) {
    console.log('Plans table migration error:', _err.message);
  }

  // Assessment assignments junction table
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS assessment_assignments (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assessment_id UUID NOT NULL,
        student_id UUID NOT NULL,
        assigned_by UUID,
        assigned_at TIMESTAMPTZ DEFAULT NOW(),
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(assessment_id, student_id)
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_aa_assessment ON assessment_assignments (assessment_id)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_aa_student ON assessment_assignments (student_id)`);
    console.log('Assessment assignments junction table ready');
  } catch (_err) {
    console.log('Assessment assignments table migration error:', _err.message);
  }

  // Assessment departments junction table
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS assessment_departments (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        assessment_id UUID NOT NULL,
        department_id UUID NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(assessment_id, department_id)
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_ad_assessment ON assessment_departments (assessment_id)`);
    console.log('Assessment departments junction table ready');
  } catch (_err) {
    console.log('Assessment departments table migration error:', _err.message);
  }

  // Institution modules junction table
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS institution_modules (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institution_id UUID NOT NULL,
        module_name VARCHAR(50) NOT NULL,
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(institution_id, module_name)
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_im_institution ON institution_modules (institution_id)`);
    console.log('Institution modules junction table ready');
  } catch (_err) {
    console.log('Institution modules table migration error:', _err.message);
  }

  // Seed plans from hardcoded PLANS constant
  try {
    const { Plan } = await import('./database/index.js');
    const planCount = await Plan.count();
    if (planCount === 0) {
      const SEED_PLANS = [
        {
          plan_key: 'basic', plan_name: 'Basic', duration_months: 1,
          max_level: 1, journey_access: 1, total_interviews: 4,
          price: 499, gst_percentage: 18, status: 'active',
          features: ['Level 1 Journey Access', '4 AI Interviews', 'Resume Builder', 'Reports & Analytics'],
        },
        {
          plan_key: 'advanced', plan_name: 'Advanced', duration_months: 3,
          max_level: 3, journey_access: 3, total_interviews: 12,
          price: 1199, gst_percentage: 18, status: 'active',
          features: ['Levels 1-3 Journey Access', '12 AI Interviews', 'Resume Builder', 'Reports & Analytics', 'Programming Practice', 'Communication Skills'],
        },
        {
          plan_key: 'professional', plan_name: 'Professional', duration_months: 6,
          max_level: 6, journey_access: 6, total_interviews: 24,
          price: 1999, gst_percentage: 18, status: 'active',
          features: ['All 6 Levels Journey Access', '24 AI Interviews', 'Resume Builder', 'Reports & Analytics', 'Programming Practice', 'Communication Skills', 'Certificates', 'Priority Support'],
        },
      ];
      for (const p of SEED_PLANS) await Plan.upsert(p);
      console.log('Seeded 3 subscription plans');
    } else {
      console.log(`Plans already exist (${planCount} found)`);
    }
  } catch (_err) {
    console.log('Plan seeding skipped:', _err.message);
  }

  // Migrate existing JSONB assigned_student_ids → assessment_assignments junction table
  try {
    const [assessments] = await sequelize.query(
      `SELECT _id, assigned_student_ids FROM assessments WHERE assigned_student_ids IS NOT NULL AND assigned_student_ids != '[]'::jsonb`
    );
    let inserted = 0;
    for (const a of assessments) {
      const ids = Array.isArray(a.assigned_student_ids) ? a.assigned_student_ids : [];
      for (const sid of ids) {
        await sequelize.query(
          `INSERT INTO assessment_assignments (assessment_id, student_id) VALUES (:aid, :sid) ON CONFLICT (assessment_id, student_id) DO NOTHING`,
          { replacements: { aid: a._id, sid } }
        );
        inserted++;
      }
    }
    if (inserted > 0) console.log(`Migrated ${inserted} assessment assignments from JSON to junction table`);
    else console.log('Assessment assignments already normalized');
  } catch (_err) {
    console.log('Assessment assignment migration skipped:', _err.message);
  }

  // Migrate existing JSONB department_ids → assessment_departments junction table
  try {
    const [assessments] = await sequelize.query(
      `SELECT _id, department_ids FROM assessments WHERE department_ids IS NOT NULL AND department_ids != '[]'::jsonb`
    );
    let inserted = 0;
    for (const a of assessments) {
      const ids = Array.isArray(a.department_ids) ? a.department_ids : [];
      for (const did of ids) {
        await sequelize.query(
          `INSERT INTO assessment_departments (assessment_id, department_id) VALUES (:aid, :did) ON CONFLICT (assessment_id, department_id) DO NOTHING`,
          { replacements: { aid: a._id, did } }
        );
        inserted++;
      }
    }
    if (inserted > 0) console.log(`Migrated ${inserted} assessment departments from JSON to junction table`);
    else console.log('Assessment departments already normalized');
  } catch (_err) {
    console.log('Assessment department migration skipped:', _err.message);
  }

  // Migrate institution modules from JSON → institution_modules table
  try {
    const [institutions] = await sequelize.query(
      `SELECT _id, modules FROM institutions WHERE modules IS NOT NULL`
    );
    let inserted = 0;
    for (const inst of institutions) {
      const modules = inst.modules || {};
      const moduleNames = Array.isArray(modules) ? modules : Object.keys(modules);
      for (const mod of moduleNames) {
        const enabled = typeof modules[mod] === 'boolean' ? modules[mod] : true;
        await sequelize.query(
          `INSERT INTO institution_modules (institution_id, module_name, enabled) VALUES (:iid, :mod, :enabled) ON CONFLICT (institution_id, module_name) DO NOTHING`,
          { replacements: { iid: inst._id, mod, enabled } }
        );
        inserted++;
      }
    }
    if (inserted > 0) console.log(`Migrated ${inserted} institution modules to junction table`);
    else console.log('Institution modules already normalized');
  } catch (_err) {
    console.log('Institution module migration skipped:', _err.message);
  }
  // ── End Phase 3 normalization ──────────────────────────────────────────

  // ── Phase 3B: Add plan_id FK to subscriptions ──────────────────────────
  try {
    await sequelize.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan_id UUID DEFAULT NULL`);
    // Back-fill plan_id from plan_key
    await sequelize.query(`
      UPDATE subscriptions sub SET plan_id = p._id
      FROM plans p WHERE sub.plan_key = p.plan_key AND sub.plan_id IS NULL
    `);
    console.log('Subscriptions plan_id column ready');
  } catch (_err) {
    console.log('Subscriptions plan_id migration skipped:', _err.message);
  }

  // ── Phase 3C: Remove branch_name from enterprise_students ──────────────
  try {
    await sequelize.query(`ALTER TABLE enterprise_students DROP COLUMN IF EXISTS branch_name`);
    console.log('Removed branch_name from enterprise_students');
  } catch (_err) {
    console.log('branch_name removal skipped:', _err.message);
  }

  try {
    const { BLUEPRINTS } = await import("./mentorship/blueprints.js");
    const { JourneyBlueprint } = await import("./database/index.js");
    const existingCount = await JourneyBlueprint.count();
    if (existingCount === 0) {
      for (const bp of BLUEPRINTS) {
        await JourneyBlueprint.upsert({
          interview_number: bp.interview_number,
          title: bp.title,
          level: bp.level,
          objective: bp.objective,
          focus_areas: bp.focus_areas,
          difficulty: bp.difficulty,
          ai_prompt: bp.ai_prompt,
          follow_up_guidelines: bp.follow_up_guidelines,
          evaluation_criteria: bp.evaluation_criteria,
          domain: bp.domain,
          role: bp.role,
          category: bp.category,
        });
      }
      console.log(`Seeded ${BLUEPRINTS.length} journey blueprints`);
    } else {
      console.log(`Journey blueprints already exist (${existingCount} found)`);
    }
  } catch (_err) {
    console.log('Blueprint seeding skipped:', _err.message);
  }

  // ── Help Requests table ─────────────────────────────────────────────────
  try {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS help_requests (
        _id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID DEFAULT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50) DEFAULT '',
        institution VARCHAR(255) DEFAULT '',
        issue TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'open',
        response TEXT DEFAULT NULL,
        responded_by VARCHAR(255) DEFAULT NULL,
        responded_at TIMESTAMPTZ DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_hr_user ON help_requests (user_id)`);
    await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_hr_status ON help_requests (status)`);
    console.log('Help requests table ready');
  } catch (_err) {
    console.log('Help requests table migration skipped:', _err.message);
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
