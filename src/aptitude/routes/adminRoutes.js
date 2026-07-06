import express from 'express';
import multer from 'multer';
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import { requireAuth, requireModuleAccess, requireRole } from '../middleware/auth.js';
import { Admin, Student, Assessment, AssessmentAttempt, ProctoringEvent, Question, StudentAnswer, StudentCertificate, InterviewReport, ResumeVersion, ProgrammingSubmission, ProgrammingProblem, Department, Op } from '../../database/index.js';
import { extractFileText } from '../services/fileTextService.js';
import { generateAssessmentJson } from '../services/aiService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { CONCEPTS, DIFFICULTIES, STATUSES } from '../utils/constants.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { toReviewQuestion, validateQuestions } from '../utils/questionValidation.js';
import { ROLES } from '../utils/roles.js';
import { validateFileType } from '../../utils/fileValidation.js';
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
  const targetAudience = String(body.target_audience || 'all').toLowerCase();
  let departmentIds = null;
  if (body.department_ids) {
    try {
      departmentIds = typeof body.department_ids === 'string'
        ? JSON.parse(body.department_ids)
        : body.department_ids;
      if (!Array.isArray(departmentIds)) departmentIds = null;
    } catch {
      departmentIds = null;
    }
  }

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
  if (!['all', 'department'].includes(targetAudience)) errors.push('Invalid target audience');
  if (targetAudience === 'department' && (!departmentIds || departmentIds.length === 0)) {
    errors.push('At least one department must be selected when targeting departments');
  }
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
    target_audience: targetAudience,
    department_ids: departmentIds,
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
  const totalQuestions = await Question.count({ where: { assessment_id: assessment._id } });
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
    target_audience: assessment.target_audience || 'all',
    department_ids: assessment.department_ids || null,
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

  const studentWhere = {
    assigned_admin: admin._id,
    is_active: { [Op.ne]: false },
  };

  if (assessment.target_audience === 'department' && Array.isArray(assessment.department_ids) && assessment.department_ids.length) {
    studentWhere.department_id = { [Op.in]: assessment.department_ids };
  }

  const students = await Student.findAll({
    where: studentWhere,
    attributes: ['name', 'email'],
  });

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

async function populateAttempts(attempts) {
  if (!attempts.length) return attempts;
  const studentIds = [...new Set(attempts.map((a) => a.student_id).filter(Boolean))];
  const assessmentIds = [...new Set(attempts.map((a) => a.assessment_id).filter(Boolean))];
  const [students, assessments] = await Promise.all([
    Student.findAll({ where: { _id: { [Op.in]: studentIds } }, attributes: ['_id', 'name', 'email'] }),
    Assessment.findAll({
      where: { _id: { [Op.in]: assessmentIds } },
      attributes: ['_id', 'title', 'concept', 'difficulty', 'total_marks', 'passing_marks', 'duration_minutes'],
    }),
  ]);
  const studentMap = Object.fromEntries(students.map((s) => [s._id, s]));
  const assessmentMap = Object.fromEntries(assessments.map((a) => [a._id, a]));
  for (const attempt of attempts) {
    attempt.student_id = studentMap[attempt.student_id] || attempt.student_id;
    attempt.assessment_id = assessmentMap[attempt.assessment_id] || attempt.assessment_id;
  }
  return attempts;
}

const YEAR_LABELS = ['1st', '2nd', '3rd', '4th'];

async function getStudentProfile(studentId) {
  return Student.findOne({
    where: { _id: studentId },
    attributes: ['_id', 'name', 'email', 'phone', 'usn', 'department_id', 'year', 'modules_access', 'institutionId', 'assigned_admin', 'is_active', 'created_at'],
  });
}

async function getStudentAptitudeStats(studentId) {
  const attempts = await AssessmentAttempt.findAll({
    where: { student_id: studentId, status: 'submitted' },
    order: [['submitted_at', 'DESC']],
  });
  await populateAttempts(attempts);
  const total = attempts.length;
  if (!total) return { total_attempts: 0, passed: 0, average_percentage: 0, attempts: [] };
  const passed = attempts.filter((a) => {
    const assessment = a.assessment_id;
    return a.score >= (assessment?.passing_marks || 0);
  }).length;
  const avgPct = Number((attempts.reduce((s, a) => s + a.percentage, 0) / total).toFixed(2));
  return { total_attempts: total, passed, average_percentage: avgPct, attempts };
}

async function getStudentProgrammingStats(studentId) {
  const [totalSubmissions, accepted, solvedSubmissions, recent] = await Promise.all([
    ProgrammingSubmission.count({ where: { student_id: studentId } }),
    ProgrammingSubmission.count({ where: { student_id: studentId, status: 'accepted' } }),
    ProgrammingSubmission.findAll({ where: { student_id: studentId, status: 'accepted' }, attributes: ['problem_id'] }),
    ProgrammingSubmission.findAll({ where: { student_id: studentId }, order: [['submitted_at', 'DESC']], limit: 10 }),
  ]);
  const solvedUnique = [...new Set(solvedSubmissions.map((s) => s.problem_id))].length;
  const problemIds = [...new Set(recent.map((s) => s.problem_id).filter(Boolean))];
  if (problemIds.length) {
    const problems = await ProgrammingProblem.findAll({
      where: { _id: problemIds }, attributes: ['_id', 'title', 'concept', 'difficulty'],
    });
    const problemMap = Object.fromEntries(problems.map((p) => [p._id, p]));
    recent.forEach((s) => { if (problemMap[s.problem_id]) s.setDataValue('problem_id', problemMap[s.problem_id]); });
  }
  return { total_submissions: totalSubmissions, accepted, solved_unique: solvedUnique, recent_submissions: recent };
}

async function getStudentInterviewStats(studentId) {
  const reports = await InterviewReport.findAll({
    where: { student_id: studentId },
    attributes: ['session_id', 'report_id', 'generated_date', 'interview_domain', 'interview_role', 'overall', 'ats_analysis'],
    order: [['generated_date', 'DESC']],
    limit: 10,
  });
  const pcts = reports.map((r) => Number(r.overall?.percentage || 0)).filter(Number.isFinite);
  const avg = pcts.length ? Number((pcts.reduce((s, v) => s + v, 0) / pcts.length).toFixed(2)) : 0;
  return { total_reports: reports.length, average_percentage: avg, reports };
}

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseNumber(req.query.limit, 25), 1), 100);
    const userModules = req.user.modules_access || ['both'];
    const hasAptitude = userModules.includes('aptitude') || userModules.includes('both');
    const hasInterview = userModules.includes('ai_interview') || userModules.includes('both');

    const isDepartmentAdmin = req.user.admin_role === 'hod' && req.user.department_id;

    const studentWhere = {};
    if (isDepartmentAdmin) {
      studentWhere.department_id = req.user.department_id;
    } else if (req.user.institutionId) {
      studentWhere.institutionId = req.user.institutionId;
    } else {
      studentWhere.assigned_admin = req.user._id;
    }

    const assignedStudents = await Student.findAll({
      where: studentWhere,
      attributes: ['_id', 'name', 'email', 'usn', 'department_id', 'year', 'modules_access', 'is_active'],
    });
    const assignedStudentIds = assignedStudents.map((s) => s._id);

    let assessments = 0, published = 0, students = 0, submittedCount = 0, inProgressCount = 0;
    let submissions = [], interviewReports = [];

    if (hasAptitude) {
      const assessmentFilter = { is_deleted: { [Op.ne]: true } };
      if (req.user.institutionId) assessmentFilter.institutionId = req.user.institutionId;
      const attemptFilter = assignedStudentIds.length ? { student_id: { [Op.in]: assignedStudentIds } } : { student_id: null };
      const aptitudeResults = await Promise.all([
        Assessment.count({ where: assessmentFilter }),
        Assessment.count({ where: { ...assessmentFilter, status: 'published' } }),
        AssessmentAttempt.count({ where: { ...attemptFilter, status: 'submitted' } }),
        AssessmentAttempt.count({ where: { ...attemptFilter, status: 'in_progress' } }),
        AssessmentAttempt.findAll({
          where: { ...attemptFilter, status: 'submitted' },
          order: [['submitted_at', 'DESC']], limit,
        }),
      ]);
      assessments = aptitudeResults[0];
      published = aptitudeResults[1];
      submittedCount = aptitudeResults[2];
      inProgressCount = aptitudeResults[3];
      submissions = aptitudeResults[4];
    }

    students = assignedStudentIds.length;

    if (hasInterview) {
      const assignedStudentIdStrings = assignedStudents.map((s) => s._id.toString());
      const reportFilter = assignedStudentIdStrings.length ? { student_id: { [Op.in]: assignedStudentIdStrings } } : { student_id: null };
      interviewReports = await InterviewReport.findAll({
        where: reportFilter,
        attributes: ['session_id', 'report_id', 'generated_date', 'student_name', 'student_email', 'interview_domain', 'interview_role', 'overall', 'ats_analysis'],
        order: [['generated_date', 'DESC']], limit,
      });
    }

    await populateAttempts(submissions);
    const analytics = submissions.map(serializeAttemptAnalytics);
    const passedCount = analytics.filter((item) => item.passed).length;
    const averagePercentage = analytics.length
      ? Number((analytics.reduce((sum, item) => sum + item.percentage, 0) / analytics.length).toFixed(2))
      : 0;
    const interviewPercentages = interviewReports
      .map((report) => Number(report.overall?.percentage || 0)).filter((v) => Number.isFinite(v));
    const averageInterviewPercentage = interviewPercentages.length
      ? Number((interviewPercentages.reduce((s, v) => s + v, 0) / interviewPercentages.length).toFixed(2))
      : 0;

    let departmentName = null;
    if (isDepartmentAdmin) {
      const dept = await Department.findByPk(req.user.department_id, { attributes: ['name'] });
      departmentName = dept?.name || null;
    }

    const attemptMap = {};
    for (const a of submissions) {
      const sid = a.student_id?._id?.toString() || a.student_id?.toString();
      if (!attemptMap[sid]) attemptMap[sid] = [];
      attemptMap[sid].push(a);
    }

    const studentsWithStats = assignedStudents.map((s) => {
      const sid = s._id.toString();
      const studentAttempts = attemptMap[sid] || [];
      const passed = studentAttempts.filter((a) => a.score >= ((a.assessment_id?.passing_marks) || 0)).length;
      const avgPct = studentAttempts.length
        ? Number((studentAttempts.reduce((sum, a) => sum + a.percentage, 0) / studentAttempts.length).toFixed(2))
        : 0;
      return {
        id: s._id,
        name: s.name,
        email: s.email,
        usn: s.usn || '',
        year: s.year || '',
        modules_access: s.modules_access || ['both'],
        is_active: s.is_active !== false,
        submitted_attempts: studentAttempts.length,
        passed_attempts: passed,
        average_percentage: avgPct,
      };
    });

    const yearGroups = {};
    for (const label of YEAR_LABELS) {
      yearGroups[label] = studentsWithStats.filter((s) => s.year === label);
    }

    res.json({
      department_name: departmentName,
      admin_role: req.user.admin_role || '',
      students,
      year_groups: yearGroups,
      assessments,
      published,
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
  '/students/:studentId/analytics',
  asyncHandler(async (req, res) => {
    const { studentId } = req.params;

    const student = await getStudentProfile(studentId);
    if (!student) throw notFound('Student not found');

    const isDepartmentAdmin = req.user.admin_role === 'hod' && req.user.department_id;
    if (isDepartmentAdmin && student.department_id !== req.user.department_id) {
      throw notFound('Student not found');
    }

    const [aptitudeStats, programmingStats, interviewStats, resumeVersion] = await Promise.all([
      getStudentAptitudeStats(studentId),
      getStudentProgrammingStats(studentId),
      getStudentInterviewStats(studentId),
      ResumeVersion.findOne({ where: { student_id: studentId }, order: [['version', 'DESC']] }),
    ]);

    res.json({
      profile: {
        id: student._id,
        name: student.name,
        email: student.email,
        phone: student.phone || '',
        usn: student.usn || '',
        year: student.year || '',
        modules_access: student.modules_access || ['both'],
        is_active: student.is_active !== false,
        created_at: student.created_at,
      },
      aptitude: {
        total_attempts: aptitudeStats.total_attempts,
        passed: aptitudeStats.passed,
        average_percentage: aptitudeStats.average_percentage,
        attempts: aptitudeStats.attempts.map((a) => {
          const asm = a.assessment_id;
          return {
            id: a._id,
            assessment_id: asm?._id || a.assessment_id,
            assessment_title: asm?.title || '',
            concept: asm?.concept || '',
            difficulty: asm?.difficulty || '',
            score: a.score,
            percentage: a.percentage,
            passing_marks: asm?.passing_marks || 0,
            status: a.status,
            started_at: a.started_at,
            submitted_at: a.submitted_at,
          };
        }),
      },
      programming: {
        total_submissions: programmingStats.total_submissions,
        accepted: programmingStats.accepted,
        solved_unique: programmingStats.solved_unique,
        acceptance_rate: programmingStats.total_submissions
          ? Math.round((programmingStats.accepted / programmingStats.total_submissions) * 100) : 0,
        recent_submissions: programmingStats.recent_submissions.map((s) => ({
          id: s._id,
          problem_id: s.problem_id?._id || s.problem_id,
          title: s.problem_id?.title || '',
          concept: s.problem_id?.concept || '',
          difficulty: s.problem_id?.difficulty || '',
          status: s.status,
          language: s.language,
          passed_test_cases: s.passed_test_cases || 0,
          total_test_cases: s.total_test_cases || 0,
          submitted_at: s.submitted_at,
        })),
      },
      interview: {
        total_reports: interviewStats.total_reports,
        average_percentage: interviewStats.average_percentage,
        reports: interviewStats.reports.map((r) => ({
          session_id: r.session_id,
          report_id: r.report_id,
          domain: r.interview_domain || '',
          role: r.interview_role || '',
          generated_date: r.generated_date,
          percentage: r.overall?.percentage || 0,
          grade: r.overall?.grade || '',
          grade_label: r.overall?.grade_label || '',
          ats_score: r.ats_analysis?.ats_score || 0,
        })),
      },
      resume: resumeVersion ? {
        id: resumeVersion._id,
        version: resumeVersion.version,
        title: resumeVersion.title || '',
        target_role: resumeVersion.target_role || '',
        ats_score: resumeVersion.ats_analysis?.ats_score || 0,
        updated_at: resumeVersion.updated_at,
      } : null,
    });
  }),
);

router.get(
  '/departments',
  asyncHandler(async (req, res) => {
    if (!req.user.institutionId) {
      return res.json({ departments: [] });
    }
    const departments = await Department.findAll({
      where: { institution_id: req.user.institutionId },
      attributes: ['_id', 'name'],
      order: [['name', 'ASC']],
    });
    res.json({
      departments: departments.map((d) => ({
        id: d._id,
        name: d.name,
      })),
    });
  }),
);

router.get(
  '/exports/:type',
  asyncHandler(async (req, res) => {
    const type = String(req.params.type || '');
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const assignedStudents = await Student.findAll({
      where: { assigned_admin: req.user._id },
      attributes: ['_id', 'name', 'email', 'is_active', 'updated_at'],
    });
    const assignedStudentIds = assignedStudents.map((student) => student._id);
    const assignedStudentIdStrings = assignedStudents.map((student) => student._id.toString());
    let rows = [];
    let title = 'Edvols Report';

    if (type === 'student-performance') {
      title = 'Student Performance Report';
      const attempts = await AssessmentAttempt.findAll({
        where: { student_id: { [Op.in]: assignedStudentIds }, status: 'submitted' },
        order: [['submitted_at', 'DESC']],
      });
      await populateAttempts(attempts);
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
      const attempts = await AssessmentAttempt.findAll({
        where: { student_id: { [Op.in]: assignedStudentIds }, status: 'submitted' },
        order: [['submitted_at', 'DESC']],
      });
      await populateAttempts(attempts);
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
      const interviewReports = await InterviewReport.findAll({
        where: assignedStudentIdStrings.length ? { student_id: { [Op.in]: assignedStudentIdStrings } } : { student_id: null },
        attributes: ['student_name', 'student_email', 'interview_role', 'interview_domain', 'overall', 'ats_analysis', 'created_at'],
        order: [['created_at', 'DESC']],
        limit: 1000,
      });
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
      Question.findAll({
        where: filter,
        order: [['created_at', 'DESC']],
        offset: (pageNum - 1) * limitNum,
        limit: limitNum,
      }),
      Question.count({ where: filter }),
    ]);

    const assessmentIds = [...new Set(questions.map((q) => q.assessment_id).filter(Boolean))];
    const assessments = await Assessment.findAll({
      where: { _id: { [Op.in]: assessmentIds } },
      attributes: ['_id', 'title'],
    });
    const assessmentTitleMap = Object.fromEntries(assessments.map((a) => [a._id, a.title]));

    res.json({
      questions: questions.map((question) => ({
        id: question._id.toString(),
        assessment_title: assessmentTitleMap[question.assessment_id] || '',
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
    const questions = await Question.findAll({
      attributes: ['_id', 'question_text', 'duplicate_fingerprint'],
      where: {
        duplicate_fingerprint: { [Op.ne]: '' },
      },
    });

    const groups = {};
    for (const q of questions) {
      const fp = q.duplicate_fingerprint;
      if (!groups[fp]) {
        groups[fp] = { count: 0, ids: [], samples: [] };
      }
      groups[fp].count += 1;
      groups[fp].ids.push(q._id);
      groups[fp].samples.push(q.question_text);
    }

    const duplicates = Object.entries(groups)
      .filter(([, g]) => g.count > 1)
      .map(([fingerprint, g]) => ({
        _id: fingerprint,
        count: g.count,
        ids: g.ids,
        samples: g.samples,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

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
    const question = await Question.findByPk(req.params.id);
    if (!question) throw notFound('Question not found');

    const updateData = { review_status: reviewStatus };
    if (Array.isArray(req.body.tags)) {
      updateData.tags = req.body.tags.map((tag) => String(tag).trim()).filter(Boolean);
    }
    updateData.is_private_bank = Boolean(req.body.is_private_bank);
    updateData.institution_id = req.body.is_private_bank ? req.user._id : null;

    await question.update(updateData);

    res.json({ question: { id: question._id.toString(), review_status: question.review_status, tags: question.tags || [] } });
  }),
);

router.get(
  '/proctoring/events',
  asyncHandler(async (req, res) => {
    const assignedStudents = await Student.findAll({ where: { assigned_admin: req.user._id }, attributes: ['_id'] });
    const studentIds = assignedStudents.map((student) => student._id);
    const events = await ProctoringEvent.findAll({
      where: studentIds.length ? { student_id: { [Op.in]: studentIds } } : { student_id: null },
      order: [['occurred_at', 'DESC']],
      limit: 200,
    });

    const uniqueStudentIds = [...new Set(events.map((e) => e.student_id).filter(Boolean))];
    const students = await Student.findAll({
      where: { _id: { [Op.in]: uniqueStudentIds } },
      attributes: ['_id', 'name', 'email'],
    });
    const studentMap = Object.fromEntries(students.map((s) => [s._id, s]));
    for (const event of events) {
      event.student_id = studentMap[event.student_id] || event.student_id;
    }

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
    const student = await Student.findOne({ where: { _id: req.params.studentId, assigned_admin: req.user._id } });
    if (!student) throw notFound('Student not found');
    const milestone = String(req.params.milestone || '');
    const titles = {
      coding_50: '50 Coding Problems Solved',
      aptitude_passed: 'Aptitude Assessment Passed',
      interview_readiness_75: 'Interview Readiness Certificate',
      placement_track_complete: 'Full Placement Preparation Track',
    };
    if (!titles[milestone]) throw badRequest('Invalid certificate milestone');

    let certificate = await StudentCertificate.findOne({
      where: { student_id: student._id, milestone },
    });
    const certData = {
      student_id: student._id,
      milestone,
      title: titles[milestone],
      description: `${student.name} was certified by ${req.user.name || 'the institution'} for ${titles[milestone]}.`,
      score: parseNumber(req.body.score, 0),
      issued_by: req.user._id,
      issued_at: new Date(),
    };
    if (certificate) {
      await certificate.update(certData);
    } else {
      certificate = await StudentCertificate.create(certData);
    }

    res.status(201).json({ certificate });
  }),
);

router.get(
  '/analytics/aptitude',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const assignedStudents = await Student.findAll({ where: { assigned_admin: req.user._id }, attributes: ['_id'] });
    const assignedStudentIds = assignedStudents.map((s) => s._id);
    const studentFilter = assignedStudentIds.length ? { student_id: { [Op.in]: assignedStudentIds } } : { student_id: null };

    const attempts = await AssessmentAttempt.findAll({
      where: { ...studentFilter, status: 'submitted' },
      order: [['submitted_at', 'DESC']],
    });

    await populateAttempts(attempts);

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
    const assignedStudents = await Student.findAll({ where: { assigned_admin: req.user._id }, attributes: ['_id'] });
    const assignedStudentIdStrings = assignedStudents.map((s) => s._id.toString());
    const reportFilter = assignedStudentIdStrings.length ? { student_id: { [Op.in]: assignedStudentIdStrings } } : { student_id: null };

    const interviewReports = await InterviewReport.findAll({
      where: reportFilter,
      attributes: ['session_id', 'report_id', 'generated_date', 'student_id', 'student_name', 'student_email', 'interview_domain', 'interview_role', 'overall', 'ats_analysis', 'created_at'],
      order: [['created_at', 'DESC']],
      limit: 500,
    });

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
    if (req.file) {
      const typeCheck = validateFileType(req.file.buffer, req.file.originalname);
      if (!typeCheck.valid) {
        throw badRequest(typeCheck.error);
      }
    }
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
      institutionId: req.user.institutionId || undefined,
      created_by: req.user._id,
      target_audience: config.target_audience,
      department_ids: config.department_ids,
    });

    console.log(`Created assessment ${assessment.start_time} with title "${assessment.title}" and ${validation.questions.length} questions`);

    await Question.bulkCreate(
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
  asyncHandler(async (req, res) => {
    const filter = { is_deleted: { [Op.ne]: true } };
    if (req.user.institutionId) {
      filter.institutionId = req.user.institutionId;
    }
    const assessments = await Assessment.findAll({ where: filter, order: [['created_at', 'DESC']] });
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
      institutionId: req.user.institutionId || undefined,
      created_by: req.user._id,
      target_audience: config.target_audience,
      department_ids: config.department_ids,
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
    const assessment = await Assessment.findByPk(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');
    const questions = await Question.findAll({ where: { assessment_id: assessment._id }, order: [['created_at', 'ASC']] });
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
    const assessment = await Assessment.findByPk(req.params.id);
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
      'target_audience',
    ];

    if (req.body.department_ids !== undefined) {
      const ids = Array.isArray(req.body.department_ids)
        ? req.body.department_ids
        : [];
      assessment.department_ids = ids.length ? ids : null;
    }
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
    const assessment = await Assessment.findByPk(req.params.id);
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
    const assessment = await Assessment.findByPk(req.params.id);
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

    const assessment = await Assessment.findByPk(req.params.id);
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
    const assessment = await Assessment.findByPk(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');
    const validation = validateQuestions(req.body.questions, {
      concept: assessment.concept,
      difficulty: assessment.difficulty,
    });
    if (!validation.valid) throw badRequest('Question validation failed', validation.errors);

    await Question.destroy({ where: { assessment_id: assessment._id } });
    const docs = await Question.bulkCreate(
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
    const assessment = await Assessment.findByPk(req.params.id);
    if (!assessment) throw notFound('Assessment not found');
    if (req.user.institutionId && assessment.institutionId && assessment.institutionId.toString() !== req.user.institutionId.toString()) {
      throw forbidden('You do not have access to this assessment');
    }

    const studentQueryFilter = req.user.institutionId
      ? { institutionId: req.user.institutionId }
      : { assigned_admin: req.user._id };
    const assignedStudents = await Student.findAll({ where: studentQueryFilter, attributes: ['_id'] });
    const assignedStudentIds = assignedStudents.map((s) => s._id);
    const attemptFilter = assignedStudentIds.length ? { student_id: { [Op.in]: assignedStudentIds } } : { student_id: null };

    const attempts = await AssessmentAttempt.findAll({
      where: { ...attemptFilter, assessment_id: assessment._id },
      order: [['submitted_at', 'DESC'], ['started_at', 'DESC']],
    });

    const uniqueStudentIds = [...new Set(attempts.map((a) => a.student_id).filter(Boolean))];
    const students = await Student.findAll({
      where: { _id: { [Op.in]: uniqueStudentIds } },
      attributes: ['_id', 'name', 'email'],
    });
    const studentMap = Object.fromEntries(students.map((s) => [s._id, s]));
    for (const attempt of attempts) {
      attempt.student_id = studentMap[attempt.student_id] || attempt.student_id;
    }

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

    const attempt = await AssessmentAttempt.findByPk(req.params.attemptId);
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.status !== 'in_progress') {
      throw badRequest('Only in-progress attempts can be extended');
    }

    const student = await Student.findByPk(attempt.student_id, { attributes: ['name', 'email'] });
    attempt.student_id = student || attempt.student_id;

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
