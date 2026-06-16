import express from 'express';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import { requireAuth, requireModuleAccess, requireRole } from '../middleware/auth.js';
import { Assessment } from '../models/Assessment.js';
import { AssessmentAttempt } from '../models/AssessmentAttempt.js';
import { ProctoringEvent } from '../models/ProctoringEvent.js';
import { Question } from '../models/Question.js';
import { StudentAnswer } from '../models/StudentAnswer.js';
import { StudentCertificate } from '../models/StudentCertificate.js';
import { User } from '../models/User.js';
import { collections } from '../../db.js';
import { extractFileText } from '../services/fileTextService.js';
import { generateAssessmentJson } from '../services/aiService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { CONCEPTS, DIFFICULTIES, STATUSES } from '../utils/constants.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { toReviewQuestion, validateQuestions } from '../utils/questionValidation.js';
import { ROLES } from '../utils/roles.js';
import {
  isEmailServiceConfigured,
  sendAssessmentPublishedEmail,
} from '../../services/emailService.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

router.use(requireAuth, requireRole(ROLES.ADMIN));

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toUtcDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (/Z$|[+-]\d{2}:\d{2}$/.test(str)) {
    return new Date(str);
  }
  return new Date(str + 'Z');
}

function parseAssessmentPayload(body) {
  const title = String(body.title || '').trim();
  const concept = String(body.concept || '').trim();
  const difficulty = String(body.difficulty || '').trim();
  const duration = parseNumber(body.duration_minutes);
  const marks = parseNumber(body.marks_per_question ?? body.marks, 1);
  const negativeMarks = parseNumber(body.negative_marks, 0.25);
  const passingMarks = parseNumber(body.passing_marks);
  const status = String(body.status || 'draft').toLowerCase();
  const questionCount = parseNumber(body.question_count);
  const generationMode = String(
    body.generation_mode || process.env.AI_DEFAULT_GENERATION_MODE || 'fast',
  ).toLowerCase();

  const errors = [];
  if (!title) errors.push('Assessment title is required');
  if (![...CONCEPTS, 'All Concepts'].includes(concept)) errors.push('Invalid concept');
  if (!DIFFICULTIES.includes(difficulty)) errors.push('Invalid difficulty');
  if (duration < 1) errors.push('Duration must be at least 1 minute');
  if (marks <= 0) errors.push('Marks per question must be greater than 0');
  if (negativeMarks < 0) errors.push('Negative marks cannot be less than 0');
  if (passingMarks < 0) errors.push('Passing marks cannot be less than 0');
  if (!STATUSES.includes(status)) errors.push('Invalid status');
  if (!['fast', 'ai'].includes(generationMode)) errors.push('Invalid generation mode');
  if (questionCount < 1) errors.push('Question count must be at least 1');
  if (errors.length) throw badRequest('Validation failed', errors);

  return {
    title,
    concept,
    difficulty,
    duration_minutes: duration,
    marks,
    negative_marks: negativeMarks,
    passing_marks: passingMarks,
    status,
    start_time: toUtcDate(body.start_time),
    end_time: toUtcDate(body.end_time),
    question_count: questionCount,
    generation_mode: generationMode,
  };
}

function serializeAttemptAnalytics(attempt) {
  const assessment = attempt.assessment_id;
  const started = attempt.started_at ? new Date(attempt.started_at).getTime() : null;
  const submitted = attempt.submitted_at ? new Date(attempt.submitted_at).getTime() : null;
  const timeTakenSeconds = started && submitted ? Math.max(0, Math.round((submitted - started) / 1000)) : 0;

  return {
    id: attempt._id.toString(),
    student_id: attempt.student_id?._id?.toString() || '',
    student_name: attempt.student_id?.name || 'Unknown',
    email: attempt.student_id?.email || '',
    assessment_title: assessment?.title || 'Assessment',
    concept: assessment?.concept || '',
    difficulty: assessment?.difficulty || '',
    score: attempt.score,
    total_marks: assessment?.total_marks || 0,
    percentage: attempt.percentage,
    passing_marks: assessment?.passing_marks || 0,
    passed: attempt.score >= (assessment?.passing_marks || 0),
    time_taken_seconds: timeTakenSeconds,
    duration_minutes: assessment?.duration_minutes || 0,
    started_at: attempt.started_at,
    submitted_at: attempt.submitted_at,
  };
}

function sendExcel(res, filename, rows) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Report');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}.xlsx`);
  res.send(buffer);
}

function sendReportPdf(res, filename, title, rows) {
  const doc = new PDFDocument({ margin: 42 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}.pdf`);
    res.send(Buffer.concat(chunks));
  });
  doc.font('Helvetica-Bold').fontSize(18).text(title);
  doc.font('Helvetica').fontSize(9).text(`Generated: ${new Date().toISOString()}`);
  doc.moveDown();
  for (const row of rows.slice(0, 120)) {
    doc.font('Helvetica-Bold').fontSize(10).text(row.name || row.student_name || row.title || row.report || 'Record');
    doc.font('Helvetica').fontSize(8).text(
      Object.entries(row)
        .map(([key, value]) => `${key}: ${value ?? ''}`)
        .join(' | '),
    );
    doc.moveDown(0.6);
  }
  doc.end();
}

async function serializeAssessment(assessment) {
  const totalQuestions = await Question.countDocuments({ assessment_id: assessment._id });
  return {
    id: assessment._id.toString(),
    title: assessment.title,
    description: assessment.description,
    concept: assessment.concept,
    difficulty: assessment.difficulty,
    duration_minutes: assessment.duration_minutes,
    total_marks: assessment.total_marks,
    passing_marks: assessment.passing_marks,
    start_time: assessment.start_time,
    end_time: assessment.end_time,
    status: assessment.status,
    is_deleted: assessment.is_deleted || false,
    deleted_at: assessment.deleted_at,
    total_questions: totalQuestions,
    created_at: assessment.created_at,
    updated_at: assessment.updated_at,
  };
}

async function notifyAssignedStudentsAssessmentPublished(assessment, admin) {
  if (!isEmailServiceConfigured()) {
    return {
      configured: false,
      total_recipients: 0,
      sent: 0,
      failed: 0,
      message: 'SMTP is not configured.',
    };
  }

  const students = await User.find({
    role: ROLES.STUDENT,
    assigned_admin: admin._id,
    is_active: { $ne: false },
  }).select('name email');

  const recipients = students.filter((student) => student.email);
  const summary = {
    configured: true,
    total_recipients: recipients.length,
    sent: 0,
    failed: 0,
  };

  for (const student of recipients) {
    try {
      await sendAssessmentPublishedEmail({
        to: student.email,
        name: student.name,
        assessment,
        adminName: admin.name,
      });
      summary.sent += 1;
    } catch (error) {
      summary.failed += 1;
      console.error('[assessment-publish-email] Email failed:', {
        assessment_id: assessment._id?.toString(),
        student_id: student._id?.toString(),
        email: student.email,
        error: error.message,
      });
    }
  }

  return summary;
}

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseNumber(req.query.limit, 25), 1), 100);
    const userModules = req.user.modules_access || ['both'];
    const hasAptitude = userModules.includes('aptitude') || userModules.includes('both');
    const hasInterview = userModules.includes('ai_interview') || userModules.includes('both');

    const assignedStudents = await User.find({ role: 'student', assigned_admin: req.user._id }).select('_id');
    const assignedStudentIds = assignedStudents.map((s) => s._id);

    let assessments = 0, published = 0, students = 0, submittedCount = 0, inProgressCount = 0;
    let submissions = [], interviewReports = [];

    if (hasAptitude) {
      const studentFilter = assignedStudentIds.length ? { student_id: { $in: assignedStudentIds } } : { student_id: null };
      const aptitudeResults = await Promise.all([
        Assessment.countDocuments({ is_deleted: { $ne: true } }),
        Assessment.countDocuments({ status: 'published', is_deleted: { $ne: true } }),
        AssessmentAttempt.countDocuments({ ...studentFilter, status: 'submitted' }),
        AssessmentAttempt.countDocuments({ ...studentFilter, status: 'in_progress' }),
        AssessmentAttempt.find({ ...studentFilter, status: 'submitted' })
          .populate('student_id', 'name email')
          .populate('assessment_id', 'title concept difficulty total_marks passing_marks duration_minutes')
          .sort({ submitted_at: -1 })
          .limit(limit),
      ]);
      assessments = aptitudeResults[0];
      published = aptitudeResults[1];
      submittedCount = aptitudeResults[2];
      inProgressCount = aptitudeResults[3];
      submissions = aptitudeResults[4];
    }

    students = assignedStudentIds.length;

    if (hasInterview) {
      const { reports } = collections();
      const assignedStudentIdStrings = assignedStudents.map((s) => s._id.toString());
      const reportFilter = assignedStudentIdStrings.length ? { student_id: { $in: assignedStudentIdStrings } } : { student_id: null };
      interviewReports = await reports.find(reportFilter, {
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
          ats_analysis: 1,
        }
      }).sort({ generated_date: -1 }).limit(limit).toArray();
    }

    const analytics = submissions.map(serializeAttemptAnalytics);

    const passedCount = analytics.filter((item) => item.passed).length;
    const averagePercentage = analytics.length
      ? Number((analytics.reduce((sum, item) => sum + item.percentage, 0) / analytics.length).toFixed(2))
      : 0;
    const interviewPercentages = interviewReports
      .map((report) => Number(report.overall?.percentage || 0))
      .filter((value) => Number.isFinite(value));
    const averageInterviewPercentage = interviewPercentages.length
      ? Number((interviewPercentages.reduce((sum, value) => sum + value, 0) / interviewPercentages.length).toFixed(2))
      : 0;

    res.json({
      assessments,
      published,
      students,
      submitted_attempts: submittedCount,
      in_progress_attempts: inProgressCount,
      pass_rate: analytics.length ? Math.round((passedCount / analytics.length) * 100) : 0,
      average_percentage: averagePercentage,
      submissions: analytics,
      interview_analytics: {
        reports: interviewReports.length,
        average_percentage: averageInterviewPercentage,
        recent_reports: interviewReports.map((report) => ({
          session_id: report.session_id,
          report_id: report.report_id,
          student_name: report.student_name || '',
          student_email: report.student_email || '',
          domain: report.interview_domain || '',
          role: report.interview_role || '',
          generated_date: report.generated_date,
          percentage: report.overall?.percentage || 0,
          grade: report.overall?.grade || '',
          grade_label: report.overall?.grade_label || '',
          ats_score: report.ats_analysis?.ats_score || 0,
        })),
      },
    });
  }),
);

router.get(
  '/exports/:type',
  asyncHandler(async (req, res) => {
    const type = String(req.params.type || '');
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const assignedStudents = await User.find({ role: 'student', assigned_admin: req.user._id }).select('_id name email is_active updated_at');
    const assignedStudentIds = assignedStudents.map((student) => student._id);
    const assignedStudentIdStrings = assignedStudents.map((student) => student._id.toString());
    let rows = [];
    let title = 'Edvolve Report';

    if (type === 'student-performance') {
      title = 'Student Performance Report';
      const attempts = await AssessmentAttempt.find({ student_id: { $in: assignedStudentIds }, status: 'submitted' })
        .populate('student_id', 'name email')
        .populate('assessment_id', 'title concept difficulty passing_marks total_marks')
        .sort({ submitted_at: -1 });
      const grouped = new Map();
      for (const attempt of attempts.map(serializeAttemptAnalytics)) {
        const current = grouped.get(attempt.student_id) || {
          student_name: attempt.student_name,
          email: attempt.email,
          attempts: 0,
          passed: 0,
          average_percentage: 0,
        };
        current.attempts += 1;
        current.passed += attempt.passed ? 1 : 0;
        current.average_percentage += Number(attempt.percentage || 0);
        grouped.set(attempt.student_id, current);
      }
      rows = Array.from(grouped.values()).map((row) => ({
        ...row,
        average_percentage: row.attempts ? Math.round(row.average_percentage / row.attempts) : 0,
      }));
    } else if (type === 'assessment-results') {
      title = 'Assessment Result Report';
      const attempts = await AssessmentAttempt.find({ student_id: { $in: assignedStudentIds }, status: 'submitted' })
        .populate('student_id', 'name email')
        .populate('assessment_id', 'title concept difficulty passing_marks total_marks duration_minutes')
        .sort({ submitted_at: -1 });
      rows = attempts.map(serializeAttemptAnalytics).map((attempt) => ({
        student_name: attempt.student_name,
        email: attempt.email,
        assessment: attempt.assessment_title,
        concept: attempt.concept,
        difficulty: attempt.difficulty,
        score: attempt.score,
        total_marks: attempt.total_marks,
        percentage: attempt.percentage,
        result: attempt.passed ? 'Passed' : 'Failed',
        submitted_at: attempt.submitted_at,
      }));
    } else if (type === 'interview-readiness') {
      title = 'Interview Readiness Report';
      const interviewReports = await collections().reports.find(
        assignedStudentIdStrings.length ? { student_id: { $in: assignedStudentIdStrings } } : { student_id: null },
        { projection: { student_name: 1, student_email: 1, interview_role: 1, interview_domain: 1, overall: 1, ats_analysis: 1, created_at: 1 } },
      ).sort({ created_at: -1 }).limit(1000).toArray();
      rows = interviewReports.map((report) => ({
        student_name: report.student_name || '',
        email: report.student_email || '',
        role: report.interview_role || '',
        domain: report.interview_domain || '',
        interview_percentage: report.overall?.percentage || 0,
        grade: report.overall?.grade_label || report.overall?.grade || '',
        ats_score: report.ats_analysis?.ats_score || 0,
        created_at: report.created_at,
      }));
    } else if (type === 'inactive-students') {
      title = 'Inactive Students Report';
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      rows = assignedStudents
        .filter((student) => student.is_active === false || !student.updated_at || new Date(student.updated_at) < thirtyDaysAgo)
        .map((student) => ({
          name: student.name,
          email: student.email,
          status: student.is_active === false ? 'Access revoked' : 'No recent updates',
          last_updated: student.updated_at,
        }));
    } else {
      throw badRequest('Unsupported export type');
    }

    if (format === 'pdf') {
      sendReportPdf(res, type, title, rows);
      return;
    }
    sendExcel(res, type, rows);
  }),
);

router.get(
  '/question-bank',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const { tag, difficulty, review_status, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (tag) filter.tags = tag;
    if (difficulty) filter.difficulty = difficulty;
    if (review_status) filter.review_status = review_status;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const [questions, total] = await Promise.all([
      Question.find(filter)
        .populate('assessment_id', 'title')
        .sort({ created_at: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Question.countDocuments(filter),
    ]);
    res.json({
      questions: questions.map((question) => ({
        id: question._id.toString(),
        assessment_title: question.assessment_id?.title || '',
        question_text: question.question_text,
        concept: question.concept,
        difficulty: question.difficulty,
        tags: question.tags || [],
        review_status: question.review_status || 'approved',
        is_private_bank: Boolean(question.is_private_bank),
        created_at: question.created_at,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.ceil(total / limitNum),
      },
    });
  }),
);

router.get(
  '/question-bank/duplicates',
  requireModuleAccess('aptitude'),
  asyncHandler(async (_req, res) => {
    const duplicates = await Question.aggregate([
      {
        $addFields: {
          normalized: {
            $trim: {
              input: {
                $regexReplace: {
                  input: { $toLower: '$question_text' },
                  regex: '[^a-z0-9]+',
                  replacement: ' ',
                },
              },
            },
          },
        },
      },
      { $group: { _id: '$normalized', count: { $sum: 1 }, ids: { $push: '$_id' }, samples: { $push: '$question_text' } } },
      { $match: { count: { $gt: 1 }, _id: { $ne: '' } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]);
    res.json({
      duplicates: duplicates.map((item) => ({
        fingerprint: item._id,
        count: item.count,
        question_ids: item.ids.map((id) => id.toString()),
        sample: item.samples[0],
      })),
    });
  }),
);

router.patch(
  '/question-bank/:id/review',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const reviewStatus = String(req.body.review_status || '');
    if (!['draft', 'in_review', 'approved', 'rejected'].includes(reviewStatus)) {
      throw badRequest('Invalid review status');
    }
    const question = await Question.findByIdAndUpdate(
      req.params.id,
      {
        review_status: reviewStatus,
        tags: Array.isArray(req.body.tags) ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean) : undefined,
        is_private_bank: Boolean(req.body.is_private_bank),
        institution_id: req.body.is_private_bank ? req.user._id : null,
      },
      { new: true },
    );
    if (!question) throw notFound('Question not found');
    res.json({ question: { id: question._id.toString(), review_status: question.review_status, tags: question.tags || [] } });
  }),
);

router.get(
  '/proctoring/events',
  asyncHandler(async (req, res) => {
    const assignedStudents = await User.find({ role: 'student', assigned_admin: req.user._id }).select('_id');
    const studentIds = assignedStudents.map((student) => student._id);
    const events = await ProctoringEvent.find(studentIds.length ? { student_id: { $in: studentIds } } : { student_id: null })
      .populate('student_id', 'name email')
      .sort({ occurred_at: -1 })
      .limit(200);
    res.json({
      events: events.map((event) => ({
        id: event._id.toString(),
        student_name: event.student_id?.name || 'Unknown',
        student_email: event.student_id?.email || '',
        assessment_type: event.assessment_type,
        event_type: event.event_type,
        severity: event.severity,
        metadata: event.metadata || {},
        occurred_at: event.occurred_at,
      })),
    });
  }),
);

router.post(
  '/students/:studentId/certificates/:milestone',
  asyncHandler(async (req, res) => {
    const student = await User.findOne({ _id: req.params.studentId, role: ROLES.STUDENT, assigned_admin: req.user._id });
    if (!student) throw notFound('Student not found');
    const milestone = String(req.params.milestone || '');
    const titles = {
      coding_50: '50 Coding Problems Solved',
      aptitude_passed: 'Aptitude Assessment Passed',
      interview_readiness_75: 'Interview Readiness Certificate',
      placement_track_complete: 'Full Placement Preparation Track',
    };
    if (!titles[milestone]) throw badRequest('Invalid certificate milestone');
    const certificate = await StudentCertificate.findOneAndUpdate(
      { student_id: student._id, milestone },
      {
        student_id: student._id,
        milestone,
        title: titles[milestone],
        description: `${student.name} was certified by ${req.user.name || 'the institution'} for ${titles[milestone]}.`,
        score: parseNumber(req.body.score, 0),
        issued_by: req.user._id,
        issued_at: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.status(201).json({ certificate });
  }),
);

router.get(
  '/analytics/aptitude',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const assignedStudents = await User.find({ role: 'student', assigned_admin: req.user._id }).select('_id');
    const assignedStudentIds = assignedStudents.map((s) => s._id);
    const studentFilter = assignedStudentIds.length ? { student_id: { $in: assignedStudentIds } } : { student_id: null };

    const attempts = await AssessmentAttempt.find({ ...studentFilter, status: 'submitted' })
      .populate('student_id', 'name email')
      .populate('assessment_id', 'title concept difficulty total_marks passing_marks duration_minutes')
      .sort({ submitted_at: -1 });

    const attemptAnalytics = attempts.map(serializeAttemptAnalytics);
    const studentMap = new Map();

    for (const attempt of attemptAnalytics) {
      const key = attempt.student_id || attempt.email || 'unknown';
      const current = studentMap.get(key) || {
        student_id: attempt.student_id,
        student_name: attempt.student_name,
        email: attempt.email,
        attempts: [],
      };
      current.attempts.push(attempt);
      studentMap.set(key, current);
    }

    const students = Array.from(studentMap.values()).map((student) => {
      const percentages = student.attempts
        .map((attempt) => Number(attempt.percentage || 0))
        .filter((value) => Number.isFinite(value));
      const passedAttempts = student.attempts.filter((attempt) => attempt.passed).length;

      return {
        ...student,
        latest_attempt: student.attempts[0] || null,
        attempt_count: student.attempts.length,
        passed_attempts: passedAttempts,
        average_percentage: percentages.length
          ? Number((percentages.reduce((sum, value) => sum + value, 0) / percentages.length).toFixed(2))
          : 0,
      };
    });

    res.json({
      students,
      total_students: students.length,
      total_attempts: attemptAnalytics.length,
    });
  }),
);

router.get(
  '/analytics/interviews',
  requireModuleAccess('ai_interview'),
  asyncHandler(async (req, res) => {
    const { reports } = collections();
    const assignedStudents = await User.find({ role: 'student', assigned_admin: req.user._id }).select('_id');
    const assignedStudentIdStrings = assignedStudents.map((s) => s._id.toString());
    const reportFilter = assignedStudentIdStrings.length ? { student_id: { $in: assignedStudentIdStrings } } : { student_id: null };

    const interviewReports = await reports.find(reportFilter, {
      projection: {
        _id: 0,
        session_id: 1,
        report_id: 1,
        generated_date: 1,
        student_id: 1,
        student_name: 1,
        student_email: 1,
        interview_domain: 1,
        interview_role: 1,
        overall: 1,
        ats_analysis: 1,
        created_at: 1,
      }
    }).sort({ created_at: -1 }).limit(500).toArray();

    const mappedReports = interviewReports.map((report) => ({
      session_id: report.session_id,
      report_id: report.report_id,
      student_id: report.student_id || '',
      student_name: report.student_name || '',
      student_email: report.student_email || '',
      domain: report.interview_domain || '',
      role: report.interview_role || '',
      generated_date: report.generated_date,
      percentage: report.overall?.percentage || 0,
      grade: report.overall?.grade || '',
      grade_label: report.overall?.grade_label || '',
      ats_score: report.ats_analysis?.ats_score || 0,
      created_at: report.created_at,
    }));
    const percentages = mappedReports
      .map((report) => Number(report.percentage || 0))
      .filter((value) => Number.isFinite(value));

    res.json({
      reports: mappedReports,
      total_reports: mappedReports.length,
      average_percentage: percentages.length
        ? Number((percentages.reduce((sum, value) => sum + value, 0) / percentages.length).toFixed(2))
        : 0,
    });
  }),
);

router.post(
  '/assessments/generate',
  requireModuleAccess('aptitude'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const config = parseAssessmentPayload(req.body);
    const fileContext = await extractFileText(req.file);
    const aiJson = await generateAssessmentJson(config, fileContext);
    if (!Array.isArray(aiJson.questions) || aiJson.questions.length === 0) {
      throw badRequest('AI did not return any questions. Try a smaller question count or lower batch concurrency.');
    }

    const validation = validateQuestions(aiJson.questions, {
      concept: config.concept,
      difficulty: config.difficulty,
      marks: config.marks,
      negative_marks: config.negative_marks,
    });

    if (!validation.valid) {
      throw badRequest(
        `Generated questions failed validation (${validation.questions.length}/${config.question_count} returned)`,
        validation.errors.slice(0, 12),
      );
    }

    const totalMarks = validation.questions.reduce((sum, question) => sum + question.marks, 0);
    const assessment = await Assessment.create({
      title: config.title || aiJson.assessment_title,
      description: fileContext ? 'Generated using uploaded source material.' : '',
      concept: config.concept,
      difficulty: config.difficulty,
      duration_minutes: config.duration_minutes,
      total_marks: totalMarks,
      passing_marks: config.passing_marks,
      start_time: config.start_time,
      end_time: config.end_time,
      status: config.status,
      created_by: req.user._id,
    });

    console.log(`Created assessment ${assessment.start_time} with title "${assessment.title}" and ${validation.questions.length} questions`);

    await Question.insertMany(
      validation.questions.map((question) => ({
        ...question,
        assessment_id: assessment._id,
      })),
    );

    const emailNotification = assessment.status === 'published'
      ? await notifyAssignedStudentsAssessmentPublished(assessment, req.user)
      : null;

    res.status(201).json({
      assessment: await serializeAssessment(assessment),
      questions: validation.questions,
      email_notification: emailNotification,
    });
  }),
);

router.get(
  '/assessments',
  requireModuleAccess('aptitude'),
  asyncHandler(async (_req, res) => {
    const assessments = await Assessment.find({ is_deleted: { $ne: true } }).sort({ created_at: -1 });
    res.json({ assessments: await Promise.all(assessments.map(serializeAssessment)) });
  }),
);

router.post(
  '/assessments',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const config = parseAssessmentPayload(req.body);
    const assessment = await Assessment.create({
      title: config.title,
      concept: config.concept,
      difficulty: config.difficulty,
      duration_minutes: config.duration_minutes,
      total_marks: 0,
      passing_marks: config.passing_marks,
      start_time: config.start_time,
      end_time: config.end_time,
      status: config.status,
      created_by: req.user._id,
    });
    const emailNotification = assessment.status === 'published'
      ? await notifyAssignedStudentsAssessmentPublished(assessment, req.user)
      : null;

    res.status(201).json({
      assessment: await serializeAssessment(assessment),
      email_notification: emailNotification,
    });
  }),
);

router.get(
  '/assessments/:id',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');
    const questions = await Question.find({ assessment_id: assessment._id }).sort({ created_at: 1 });
    res.json({
      assessment: await serializeAssessment(assessment),
      questions: questions.map(toReviewQuestion),
    });
  }),
);

router.patch(
  '/assessments/:id',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');
    const previousStatus = assessment.status;

    const allowed = [
      'title',
      'description',
      'concept',
      'difficulty',
      'duration_minutes',
      'passing_marks',
      'start_time',
      'end_time',
      'status',
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        if (['start_time', 'end_time'].includes(key)) {
          assessment[key] = toUtcDate(req.body[key]);
        } else if (key === 'status') {
          assessment[key] = String(req.body[key]).toLowerCase();
        } else {
          assessment[key] = req.body[key];
        }
      }
    }
    await assessment.save();
    const emailNotification = previousStatus !== 'published' && assessment.status === 'published'
      ? await notifyAssignedStudentsAssessmentPublished(assessment, req.user)
      : null;

    res.json({
      assessment: await serializeAssessment(assessment),
      email_notification: emailNotification,
    });
  }),
);

router.delete(
  '/assessments/:id',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');

    assessment.is_deleted = true;
    assessment.deleted_at = new Date();
    assessment.status = 'draft';
    await assessment.save();
    res.status(204).end();
  }),
);

router.patch(
  '/assessments/:id/status',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');
    const previousStatus = assessment.status;
    const status = String(req.body.status || '').toLowerCase();
    if (!STATUSES.includes(status)) throw badRequest('Invalid status');
    assessment.status = status;
    await assessment.save();
    const emailNotification = previousStatus !== 'published' && assessment.status === 'published'
      ? await notifyAssignedStudentsAssessmentPublished(assessment, req.user)
      : null;

    res.json({
      assessment: await serializeAssessment(assessment),
      email_notification: emailNotification,
    });
  }),
);

router.patch(
  '/assessments/:id/extend-duration',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const minutes = parseNumber(req.body.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) {
      throw badRequest('Extension must be a whole number from 1 to 180 minutes');
    }

    const assessment = await Assessment.findById(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');

    assessment.duration_minutes += minutes;
    await assessment.save();

    res.json({ assessment: await serializeAssessment(assessment) });
  }),
);

router.put(
  '/assessments/:id/questions',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');
    const validation = validateQuestions(req.body.questions, {
      concept: assessment.concept,
      difficulty: assessment.difficulty,
    });
    if (!validation.valid) throw badRequest('Question validation failed', validation.errors);

    await Question.deleteMany({ assessment_id: assessment._id });
    const docs = await Question.insertMany(
      validation.questions.map((question) => ({
        ...question,
        assessment_id: assessment._id,
      })),
    );
    assessment.total_marks = validation.questions.reduce((sum, question) => sum + question.marks, 0);
    await assessment.save();
    res.json({
      assessment: await serializeAssessment(assessment),
      questions: docs.map(toReviewQuestion),
    });
  }),
);

router.get(
  '/assessments/:id/results',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) throw notFound('Assessment not found');

    const assignedStudents = await User.find({ role: 'student', assigned_admin: req.user._id }).select('_id');
    const assignedStudentIds = assignedStudents.map((s) => s._id);
    const studentFilter = assignedStudentIds.length ? { student_id: { $in: assignedStudentIds } } : { student_id: null };

    const attempts = await AssessmentAttempt.find({ ...studentFilter, assessment_id: assessment._id })
      .populate('student_id', 'name email')
      .sort({ submitted_at: -1, started_at: -1 });

    res.json({
      results: attempts.map((attempt) => ({
        id: attempt._id.toString(),
        student_name: attempt.student_id?.name || 'Unknown',
        email: attempt.student_id?.email || '',
        score: attempt.score,
        percentage: attempt.percentage,
        status: attempt.status,
        passed: attempt.status === 'submitted' && attempt.score >= assessment.passing_marks,
        extra_time_minutes: attempt.extra_time_minutes || 0,
        started_at: attempt.started_at,
        submitted_at: attempt.submitted_at,
      })),
    });
  }),
);

router.patch(
  '/attempts/:attemptId/extend',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const minutes = parseNumber(req.body.minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) {
      throw badRequest('Extension must be a whole number from 1 to 180 minutes');
    }

    const attempt = await AssessmentAttempt.findById(req.params.attemptId).populate(
      'student_id',
      'name email',
    );
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.status !== 'in_progress') {
      throw badRequest('Only in-progress attempts can be extended');
    }

    attempt.extra_time_minutes = (attempt.extra_time_minutes || 0) + minutes;
    await attempt.save();

    res.json({
      attempt: {
        id: attempt._id.toString(),
        student_name: attempt.student_id?.name || 'Unknown',
        email: attempt.student_id?.email || '',
        status: attempt.status,
        extra_time_minutes: attempt.extra_time_minutes,
        started_at: attempt.started_at,
      },
    });
  }),
);

export default router;
