import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { journeyService } from './journeyService.js';
import { requireAuth, requireRole } from '../aptitude/middleware/auth.js';
import { asyncHandler } from '../utils/httpError.js';
import { HttpError } from '../utils/httpError.js';
import { InterviewReport, StudentJourney, User, Subscription, getSequelize } from '../database/index.js';
import { buildStudentWhere } from '../aptitude/utils/adminScope.js';

const router = Router();

function getStudentId(req) {
  return req.user?._id || req.user?.user_id;
}

function getStudentInfo(req) {
  return {
    id: req.user?._id || req.user?.user_id,
    name: req.user?.name || '',
    email: req.user?.email || '',
    institutionId: req.user?.institutionId || null,
  };
}

// ═══════════════════════════════════════════════════════
// STUDENT ENDPOINTS
// ═══════════════════════════════════════════════════════

router.get('/journey', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const info = getStudentInfo(req);
  await journeyService.getOrCreateJourney(studentId, info.name, info.email, info.institutionId);
  const journey = await journeyService.getJourney(studentId);
  res.json({ journey });
}));

router.get('/levels', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const result = await journeyService.getLevels(studentId);
  res.json(result);
}));

router.get('/journey/interviews', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const interviews = await journeyService.getJourneyInterviews(studentId);
  res.json({ interviews });
}));

router.get('/progress', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const progress = await journeyService.getProgress(studentId);
  res.json({ progress: progress || {} });
}));

router.get('/progress/trends', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const trends = await journeyService.getTrends(studentId);
  res.json(trends);
}));

router.get('/progress/readiness', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const readiness = await journeyService.getReadiness(studentId);
  res.json({ readiness });
}));

router.get('/resume/comparisons', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const result = await journeyService.getResumeComparisons(studentId);
  res.json(result);
}));

router.get('/interview/replays', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const result = await journeyService.getReplays(studentId);
  res.json(result);
}));

router.get('/interview/replay/:sessionId', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const replay = await journeyService.getReplayDetail(studentId, req.params.sessionId);
  if (!replay) throw new HttpError(404, 'Replay not found');
  res.json({ replay });
}));

router.get('/subscription', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const result = await journeyService.getSubscription(studentId);
  res.json(result);
}));

router.get('/lock-status', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const result = await journeyService.getLockStatus(studentId);
  res.json(result);
}));

router.post('/subscribe', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const { plan_key } = req.body || {};
  const result = await journeyService.subscribe(studentId, plan_key);
  res.json(result);
}));

router.post('/interview/start', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const info = getStudentInfo(req);
  const result = await journeyService.startInterview(studentId, info.name, info.email);
  res.json(result);
}));

router.post('/interview/start/:interviewNumber', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const interviewNumber = parseInt(req.params.interviewNumber);
  const result = await journeyService.startInterviewById(studentId, interviewNumber);
  res.json(result);
}));

router.get('/interview/blueprint/:sessionId', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const result = await journeyService.generateBlueprintQuestion(req.params.sessionId, studentId);
  res.json(result);
}));

router.post('/interview/answer', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const { session_id, answer } = req.body || {};
  if (!session_id || !answer) throw new HttpError(400, 'session_id and answer are required');

  const existingReport = await InterviewReport.findOne({ where: { session_id } });
  if (existingReport) {
    await journeyService.completeInterview(studentId, session_id, existingReport.overall?.percentage || 0, existingReport.overall?.grade || '');
    return res.json({ completed: true, report: existingReport });
  }

  res.json({ completed: false, message: 'Use the existing interview engine to answer questions' });
}));

router.post('/interview/end', requireAuth, asyncHandler(async (req, res) => {
  const studentId = getStudentId(req);
  const { session_id } = req.body || {};
  if (!session_id) throw new HttpError(400, 'session_id is required');

  const report = await InterviewReport.findOne({ where: { session_id } });
  if (!report) throw new HttpError(404, 'Report not found. Complete the interview first.');

  const result = await journeyService.completeInterview(studentId, session_id, report.overall?.percentage || 0, report.overall?.grade || '');
  res.json(result);
}));

// ═══════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════

router.get('/admin/dashboard', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const result = await journeyService.getAdminDashboard(req.user);
  res.json(result);
}));

router.get('/admin/students', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const { institution_id, search, page = 1, limit = 20 } = req.query;
  const result = await journeyService.getAdminStudents(req.user, institution_id, search, parseInt(page), parseInt(limit));
  res.json(result);
}));

router.get('/admin/students/:studentId', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const result = await journeyService.getAdminStudentDetail(req.user, req.params.studentId);
  if (!result) throw new HttpError(404, 'Student not found');
  res.json(result);
}));

router.get('/admin/plans', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const result = await journeyService.getAdminPlans();
  res.json(result);
}));

router.post('/admin/subscriptions', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const { student_id, plan_key } = req.body || {};
  if (!student_id || !plan_key) throw new HttpError(400, 'student_id and plan_key are required');
  const result = await journeyService.assignSubscription(student_id, plan_key);
  res.json(result);
}));

router.post('/admin/subscriptions/bulk', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const { student_ids, plan_key } = req.body || {};
  if (!student_ids?.length || !plan_key) throw new HttpError(400, 'student_ids and plan_key are required');
  const result = await journeyService.bulkAssignSubscription(student_ids, plan_key);
  res.json({ results: result });
}));

router.post('/admin/subscriptions/:id/extend', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const { days } = req.body || {};
  const result = await journeyService.extendSubscription(req.params.id, days);
  res.json({ subscription: result });
}));

router.patch('/admin/subscriptions/:id/extend', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const { days } = req.body || {};
  const result = await journeyService.extendSubscription(req.params.id, days);
  res.json({ subscription: result });
}));

router.post('/admin/subscriptions/:id/cancel', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const result = await journeyService.cancelSubscription(req.params.id);
  res.json({ subscription: result });
}));

router.patch('/admin/subscriptions/:id/cancel', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const result = await journeyService.cancelSubscription(req.params.id);
  res.json({ subscription: result });
}));

router.get('/admin/subscription-impact', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const { institution_id, plan_key } = req.query;
  const result = await journeyService.getSubscriptionImpact(institution_id, plan_key);
  res.json(result);
}));

router.post('/admin/subscriptions/institution/:institutionId', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const { plan_key } = req.body || {};
  const result = await journeyService.assignInstitutionSubscription(req.params.institutionId, plan_key);
  res.json(result);
}));

router.get('/admin/student-users/:studentId', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const result = await journeyService.getStudentUsers(req.params.studentId);
  if (!result) throw new HttpError(404, 'Student not found');
  res.json(result);
}));

router.patch('/admin/student-users/:studentId', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const result = await journeyService.updateStudentProfile(req.params.studentId, req.body || {}, req.user);
  res.json(result);
}));

router.post('/admin/student-users/:studentId/assign', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const { admin_id } = req.body || {};
  const result = await journeyService.assignStudentAdmin(req.params.studentId, admin_id);
  res.json(result);
}));

router.patch('/admin/student-users/:studentId/assign', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const { admin_id } = req.body || {};
  const result = await journeyService.assignStudentAdmin(req.params.studentId, admin_id);
  res.json(result);
}));

router.get('/admin/departments', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const result = await journeyService.getAdminDepartments();
  res.json(result);
}));

// ═══════════════════════════════════════════════════════
// MASTER ADMIN ENDPOINTS
// ═══════════════════════════════════════════════════════

router.post('/admin/journey-access', requireAuth, requireRole('master_admin'), asyncHandler(async (req, res) => {
  const { student_id, access_level } = req.body || {};
  if (!student_id || access_level === undefined) throw new HttpError(400, 'student_id and access_level are required');
  const result = await journeyService.assignJourneyAccess(student_id, access_level, req.user?._id);
  res.json(result);
}));

router.post('/admin/journey-access/upgrade', requireAuth, requireRole('master_admin'), asyncHandler(async (req, res) => {
  const { student_id, new_level } = req.body || {};
  if (!student_id || !new_level) throw new HttpError(400, 'student_id and new_level are required');
  const result = await journeyService.upgradeJourneyAccess(student_id, new_level, req.user?._id);
  res.json(result);
}));

router.post('/admin/journey-access/downgrade', requireAuth, requireRole('master_admin'), asyncHandler(async (req, res) => {
  const { student_id, new_level } = req.body || {};
  if (!student_id || new_level === undefined) throw new HttpError(400, 'student_id and new_level are required');
  const result = await journeyService.downgradeJourneyAccess(student_id, new_level, req.user?._id);
  res.json(result);
}));

router.post('/admin/journey-access/bulk', requireAuth, requireRole('master_admin'), asyncHandler(async (req, res) => {
  const { student_ids, access_level } = req.body || {};
  if (!student_ids?.length || access_level === undefined) throw new HttpError(400, 'student_ids and access_level are required');
  const result = await journeyService.bulkAssignAccess(student_ids, access_level, req.user?._id);
  res.json({ results: result });
}));

router.post('/admin/journey-access/institution/:institutionId', requireAuth, requireRole('master_admin'), asyncHandler(async (req, res) => {
  const { access_level, department_id, year } = req.body || {};
  if (access_level === undefined) throw new HttpError(400, 'access_level is required');
  const result = await journeyService.assignInstitutionJourneyAccess(
    req.params.institutionId, access_level, req.user?._id, { department_id, year }
  );
  res.json({ results: result });
}));

router.get('/admin/journey-access/impact', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const { institution_id, department_id, year } = req.query;
  const result = await journeyService.getJourneyAccessImpact(institution_id, { department_id, year });
  res.json(result);
}));

// ═══════════════════════════════════════════════════════
// ADMIN REPORT PDF ENDPOINTS
// ═══════════════════════════════════════════════════════

router.get('/admin/reports/overview', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const studentWhere = buildStudentWhere(req.user);
  if (req.query.department_id && req.user.role === 'admin') {
    studentWhere.department_id = req.query.department_id;
  }

  const students = await User.findAll({
    where: studentWhere,
    attributes: ['_id', 'name', 'email', 'department_id', 'institutionId'],
    raw: true,
  });

  const studentIds = students.map(s => s._id);
  const journeys = studentIds.length
    ? await StudentJourney.findAll({ where: { student_id: studentIds }, raw: true })
    : [];
  const journeyMap = {};
  for (const j of journeys) journeyMap[j.student_id] = j;

  const subs = studentIds.length
    ? await Subscription.findAll({ where: { student_id: studentIds, status: 'active' }, raw: true })
    : [];
  const subMap = {};
  for (const s of subs) subMap[s.student_id] = s;

  const rows = students.map(s => {
    const j = journeyMap[s._id] || {};
    const sub = subMap[s._id] || {};
    return {
      name: s.name,
      email: s.email,
      level: j.current_level || 0,
      completed: j.completed_interviews || 0,
      readiness: j.readiness_score || 0,
      status: j.status || 'not_started',
      plan: sub.plan_name || '—',
    };
  });

  const doc = new PDFDocument({ margin: 42, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename=branch_overview_report.pdf');
  doc.pipe(res);

  doc.fontSize(18).font('Helvetica-Bold').text('Branch Overview Report');
  doc.fontSize(9).font('Helvetica').text(`Generated: ${new Date().toISOString().slice(0, 10)}  |  Total students: ${rows.length}`);
  doc.moveDown();

  const headers = ['Name', 'Email', 'Level', 'Done', 'Readiness', 'Status', 'Plan'];
  const widths = [100, 120, 40, 40, 55, 65, 80];
  let y = doc.y;
  let x = 42;
  doc.font('Helvetica-Bold').fontSize(8);
  headers.forEach((h, i) => { doc.text(h, x, y, { width: widths[i], continued: true }); x += widths[i]; });
  y += 16;
  doc.moveTo(42, y).lineTo(570, y).stroke();
  y += 4;

  doc.font('Helvetica').fontSize(7);
  for (const row of rows) {
    if (y > 760) { doc.addPage(); y = 42; }
    x = 42;
    const vals = [row.name, row.email, String(row.level), String(row.completed), `${row.readiness}%`, row.status, row.plan];
    vals.forEach((v, i) => { doc.text(String(v || '—').slice(0, 30), x, y, { width: widths[i], continued: true }); x += widths[i]; });
    y += 14;
  }

  doc.end();
}));

router.get('/admin/reports/student/:studentId', requireAuth, requireRole('admin', 'master_admin'), asyncHandler(async (req, res) => {
  const student = await User.findByPk(req.params.studentId, {
    attributes: ['_id', 'name', 'email', 'department_id', 'institutionId'],
    raw: true,
  });
  if (!student) throw new HttpError(404, 'Student not found');

  const journey = await StudentJourney.findOne({ where: { student_id: student._id }, raw: true });
  const interviews = await InterviewReport.findAll({
    where: { student_id: student._id },
    order: [['created_at', 'DESC']],
    raw: true,
  });

  const doc = new PDFDocument({ margin: 42, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=student_report_${student._id}.pdf`);
  doc.pipe(res);

  doc.fontSize(18).font('Helvetica-Bold').text('Student Report');
  doc.moveDown(0.5);
  doc.fontSize(11).font('Helvetica-Bold').text(`Name: ${student.name}`);
  doc.font('Helvetica').fontSize(10).text(`Email: ${student.email}`);
  if (journey) {
    doc.text(`Level: ${journey.current_level}  |  Completed: ${journey.completed_interviews} interviews  |  Readiness: ${journey.readiness_score}%`);
    doc.text(`Status: ${journey.status}`);
  }
  doc.moveDown();

  if (interviews.length) {
    doc.fontSize(13).font('Helvetica-Bold').text('Interview History');
    doc.moveDown(0.3);
    const iHeaders = ['#', 'Role', 'Domain', 'Score', 'Grade', 'Date'];
    const iWidths = [25, 100, 100, 50, 60, 100];
    let y = doc.y;
    let x = 42;
    doc.font('Helvetica-Bold').fontSize(8);
    iHeaders.forEach((h, i) => { doc.text(h, x, y, { width: iWidths[i], continued: true }); x += iWidths[i]; });
    y += 14;
    doc.moveTo(42, y).lineTo(570, y).stroke();
    y += 4;
    doc.font('Helvetica').fontSize(7);
    interviews.slice(0, 50).forEach((iv, idx) => {
      if (y > 760) { doc.addPage(); y = 42; }
      x = 42;
      const pct = iv.overall?.percentage || 0;
      const grade = iv.overall?.grade_label || iv.overall?.grade || '—';
      const date = iv.created_at ? new Date(iv.created_at).toLocaleDateString() : '—';
      const vals = [String(idx + 1), iv.interview_role || '—', iv.interview_domain || '—', `${pct}%`, grade, date];
      vals.forEach((v, i) => { doc.text(String(v).slice(0, 25), x, y, { width: iWidths[i], continued: true }); x += iWidths[i]; });
      y += 14;
    });
  } else {
    doc.fontSize(10).font('Helvetica').text('No interviews completed yet.');
  }

  doc.end();
}));

export default router;
