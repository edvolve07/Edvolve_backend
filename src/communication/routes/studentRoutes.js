import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { requireAuth, requireModuleAccess } from '../../aptitude/middleware/auth.js';
import { HttpError, asyncHandler } from '../../utils/httpError.js';
import { CommunicationSession } from '../../database/models/CommunicationSession.js';
import { CommunicationReport } from '../../database/models/CommunicationReport.js';
import { CommunicationScenario } from '../../database/models/CommunicationScenario.js';
import { nimService } from '../../services/nimService.js';
import { aiService } from '../../services/aiService.js';
import { transcriber } from '../../services/transcriber.js';
import { config } from '../../config.js';

const uploadDir = path.join(os.tmpdir(), 'edvolve-audio');
const upload = multer({ dest: uploadDir });
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const commAi = config.nvidiaApiKey ? nimService : aiService;

const router = Router();

const COMMUNICATION_CATEGORIES = [
  'Tell Me About Yourself',
  'Behavioral Questions (STAR)',
  'Strengths & Weaknesses',
  'Why This Role / Company',
  'Technical Explanations',
  'Handling Difficult Questions',
  'Career Goals & Aspirations',
  'Salary & Negotiation Talk',
];

router.post('/start', requireAuth, requireModuleAccess('communication'), asyncHandler(async (req, res) => {
  const { category, scenario_id } = req.body || {};
  const resolvedCategory = category || 'Tell Me About Yourself';
  let title = '',
    context = '',
    opening = '';

  if (scenario_id) {
    const scenario = await CommunicationScenario.findByPk(scenario_id);
    if (!scenario || scenario.status !== 'published') {
      throw new HttpError(404, 'Scenario not found');
    }
    title = scenario.title;
    context = scenario.context;
    opening = scenario.context;
  } else {
    const scenario = await commAi.generateScenario(resolvedCategory);
    title = scenario.title;
    context = scenario.context;
    opening = scenario.opening;
  }

  const sessionId = uuidv4();
  const session = {
    session_id: sessionId,
    student_id: req.user._id,
    student_name: req.user.name || '',
    student_email: req.user.email || '',
    scenario_id: scenario_id || '',
    category: resolvedCategory,
    context,
    history: [],
    current_prompt: opening,
    exchange_count: 0,
    max_exchanges: 6,
    status: 'active',
  };

  await CommunicationSession.create(session);

  res.json({
    session_id: sessionId,
    category: resolvedCategory,
    title,
    context,
    prompt: opening,
    exchange_count: 0,
    max_exchanges: 6,
  });
}));

router.post('/respond', requireAuth, requireModuleAccess('communication'), asyncHandler(async (req, res) => {
  const { session_id: sessionId, answer } = req.body || {};

  if (!sessionId || typeof answer !== 'string' || !answer.trim()) {
    throw new HttpError(400, 'session_id and answer are required');
  }

  const session = await CommunicationSession.findOne({ where: { session_id: sessionId } });
  if (!session) throw new HttpError(404, 'Session not found');
  if (session.student_id !== req.user._id) throw new HttpError(403, 'Not your session');
  if (session.status !== 'active') throw new HttpError(400, 'Session is already completed');

  const category = session.category || 'General';
  const evaluation = await commAi.evaluateResponse(session.current_prompt, answer, category);
  const history = session.history || [];
  const exchangeCount = (session.exchange_count || 0) + 1;
  const isLastExchange = exchangeCount >= session.max_exchanges;

  history.push({
    prompt: session.current_prompt,
    answer,
    evaluation: {
      clarity: evaluation.clarity,
      structure: evaluation.structure,
      conciseness: evaluation.conciseness,
      relevance: evaluation.relevance,
      confidence_tone: evaluation.confidence_tone,
    },
    strengths: evaluation.strengths,
    improvements: evaluation.improvements,
    feedback: evaluation.feedback,
    real_world_tip: evaluation.real_world_tip || '',
  });

  const nextPrompt = isLastExchange ? '' : (evaluation.next_prompt || 'Can you tell me more about a specific example from your experience?');

  await CommunicationSession.update({
    history,
    current_prompt: nextPrompt,
    exchange_count: exchangeCount,
    status: isLastExchange ? 'completed' : 'active',
  }, { where: { session_id: sessionId } });

  res.json({
    exchange_number: exchangeCount,
    max_exchanges: session.max_exchanges,
    is_last: isLastExchange,
    evaluation: {
      clarity: evaluation.clarity,
      structure: evaluation.structure,
      conciseness: evaluation.conciseness,
      relevance: evaluation.relevance,
      confidence_tone: evaluation.confidence_tone,
    },
    strengths: evaluation.strengths,
    improvements: evaluation.improvements,
    feedback: evaluation.feedback,
    real_world_tip: evaluation.real_world_tip || '',
    next_prompt: nextPrompt,
  });
}));

router.post('/respond-audio', requireAuth, requireModuleAccess('communication'), upload.single('audio'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'audio file is required');

  const { session_id: sessionId } = req.body || {};
  if (!sessionId) throw new HttpError(400, 'session_id is required');

  const session = await CommunicationSession.findOne({ where: { session_id: sessionId } });
  if (!session) throw new HttpError(404, 'Session not found');
  if (session.student_id !== req.user._id) throw new HttpError(403, 'Not your session');
  if (session.status !== 'active') throw new HttpError(400, 'Session is already completed');

  let answer;
  try {
    answer = await transcriber.transcribe(req.file.path);
  } catch (err) {
    throw new HttpError(502, `Transcription failed: ${err.message}`);
  } finally {
    fs.unlink(req.file.path).catch(() => {});
  }

  if (!answer) throw new HttpError(400, 'Could not transcribe audio — please try again');

  const category = session.category || 'General';
  const evaluation = await commAi.evaluateResponse(session.current_prompt, answer, category);
  const history = session.history || [];
  const exchangeCount = (session.exchange_count || 0) + 1;
  const isLastExchange = exchangeCount >= session.max_exchanges;

  history.push({
    prompt: session.current_prompt,
    answer,
    evaluation: {
      clarity: evaluation.clarity,
      structure: evaluation.structure,
      conciseness: evaluation.conciseness,
      relevance: evaluation.relevance,
      confidence_tone: evaluation.confidence_tone,
    },
    strengths: evaluation.strengths,
    improvements: evaluation.improvements,
    feedback: evaluation.feedback,
    real_world_tip: evaluation.real_world_tip || '',
  });

  const nextPrompt = isLastExchange ? '' : (evaluation.next_prompt || 'Can you tell me more about a specific example from your experience?');

  await CommunicationSession.update({
    history,
    current_prompt: nextPrompt,
    exchange_count: exchangeCount,
    status: isLastExchange ? 'completed' : 'active',
  }, { where: { session_id: sessionId } });

  res.json({
    transcript: answer,
    exchange_number: exchangeCount,
    max_exchanges: session.max_exchanges,
    is_last: isLastExchange,
    evaluation: {
      clarity: evaluation.clarity,
      structure: evaluation.structure,
      conciseness: evaluation.conciseness,
      relevance: evaluation.relevance,
      confidence_tone: evaluation.confidence_tone,
    },
    strengths: evaluation.strengths,
    improvements: evaluation.improvements,
    feedback: evaluation.feedback,
    next_prompt: nextPrompt,
  });
}));

router.get('/session/:session_id', requireAuth, requireModuleAccess('communication'), asyncHandler(async (req, res) => {
  const session = await CommunicationSession.findOne({ where: { session_id: req.params.session_id } });
  if (!session) throw new HttpError(404, 'Session not found');
  if (session.student_id !== req.user._id && !['admin', 'master_admin'].includes(req.user.role)) {
    throw new HttpError(403, 'Not your session');
  }

  res.json({
    session_id: session.session_id,
    category: session.category,
    context: session.context,
    prompt: session.current_prompt,
    exchange_count: session.exchange_count,
    max_exchanges: session.max_exchanges,
    status: session.status,
    history: session.history || [],
  });
}));

router.post('/end', requireAuth, requireModuleAccess('communication'), asyncHandler(async (req, res) => {
  const { session_id: sessionId } = req.body || {};
  if (!sessionId) throw new HttpError(400, 'session_id is required');

  const session = await CommunicationSession.findOne({ where: { session_id: sessionId } });
  if (!session) throw new HttpError(404, 'Session not found');
  if (session.student_id !== req.user._id) throw new HttpError(403, 'Not your session');

  const history = session.history || [];
  const category = session.category || 'General';
  const exchangeBreakdown = history.map((item, index) => ({
    number: index + 1,
    prompt: item.prompt,
    answer: item.answer,
    evaluation: item.evaluation,
    strengths: item.strengths || [],
    improvements: item.improvements || [],
    feedback: item.feedback || '',
    real_world_tip: item.real_world_tip || '',
  }));

  const metricKeys = ['clarity', 'structure', 'conciseness', 'relevance', 'confidence_tone'];
  const metricSums = Object.fromEntries(metricKeys.map((k) => [k, 0]));
  for (const item of history) {
    const ev = item.evaluation || {};
    for (const key of metricKeys) {
      metricSums[key] += Number(ev[key] || 0);
    }
  }
  const count = history.length || 1;
  const avg = Object.fromEntries(metricKeys.map((k) => [k, Number((metricSums[k] / count).toFixed(1))]));

  const totalScore = Object.values(metricSums).reduce((s, v) => s + v, 0);
  const maxPossible = count * 50;
  const percentage = maxPossible ? (totalScore / maxPossible) * 100 : 0;
  let grade = 'F', label = 'Needs Improvement';
  if (percentage >= 85) { grade = 'A'; label = 'Excellent'; }
  else if (percentage >= 70) { grade = 'B'; label = 'Good'; }
  else if (percentage >= 55) { grade = 'C'; label = 'Average'; }
  else if (percentage >= 40) { grade = 'D'; label = 'Fair'; }

  const conversation_log = history.map((item, index) => ({
    exchange: index + 1,
    interviewer: item.prompt,
    student: item.answer,
    scores: item.evaluation || {},
    feedback: item.feedback || '',
    real_world_tip: item.real_world_tip || '',
  }));

  const summary = await commAi.generateReport(history, category);
  const reportId = `CR-${new Date().toISOString().slice(0, 10)}-${uuidv4().slice(0, 3).toUpperCase()}`;

  const report = {
    session_id: sessionId,
    student_id: session.student_id,
    student_name: session.student_name || '',
    student_email: session.student_email || '',
    category,
    report_id: reportId,
    generated_date: new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: '2-digit', timeZone: 'UTC',
    }),
    overall: {
      total_score: totalScore,
      max_score: maxPossible,
      percentage: Number(percentage.toFixed(2)),
      grade,
      grade_label: label,
      metrics: avg,
    },
    exchange_breakdown: exchangeBreakdown,
    conversation_log,
    strengths: Array.isArray(summary.strengths) ? summary.strengths : [],
    areas_to_improve: Array.isArray(summary.areas_to_improve) ? summary.areas_to_improve : [],
    tips: Array.isArray(summary.tips) ? summary.tips : [],
    category_insights: summary.category_insights || {},
    real_world_preparation: Array.isArray(summary.real_world_preparation) ? summary.real_world_preparation : [],
    competency_analysis: summary.competency_analysis || {},
  };

  await CommunicationReport.upsert(report);
  await CommunicationSession.update({ status: 'completed' }, { where: { session_id: sessionId } });

  res.json(report);
}));

router.get('/reports', requireAuth, requireModuleAccess('communication'), asyncHandler(async (req, res) => {
  const reports = await CommunicationReport.findAll({
    where: ['admin', 'master_admin'].includes(req.user.role) ? {} : { student_id: req.user._id },
    attributes: [
      'session_id', 'report_id', 'generated_date', 'student_name',
      'student_email', 'category', 'overall', 'created_at',
    ],
    order: [['created_at', 'DESC']],
    limit: 100,
  });

  res.json({
    reports: reports.map((r) => ({
      session_id: r.session_id,
      report_id: r.report_id,
      generated_date: r.generated_date,
      student_name: r.student_name || '',
      student_email: r.student_email || '',
      category: r.category || '',
      grade: r.overall?.grade || '',
      percentage: r.overall?.percentage || 0,
      total_score: r.overall?.total_score || 0,
      max_score: r.overall?.max_score || 0,
      created_at: r.created_at,
    })),
  });
}));

router.get('/reports/:session_id', requireAuth, requireModuleAccess('communication'), asyncHandler(async (req, res) => {
  const report = await CommunicationReport.findOne({
    where: { session_id: req.params.session_id },
    attributes: { exclude: ['_id'] },
  });
  if (!report) throw new HttpError(404, 'Report not found');
  if (!['admin', 'master_admin'].includes(req.user.role) && report.student_id !== req.user._id) {
    throw new HttpError(403, 'Not your report');
  }
  res.json(report);
}));

router.get('/categories', requireAuth, requireModuleAccess('communication'), asyncHandler(async (req, res) => {
  res.json({ categories: COMMUNICATION_CATEGORIES });
}));

export default router;
