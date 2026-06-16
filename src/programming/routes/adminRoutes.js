import express from 'express';
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import { requireAuth, requireModuleAccess, requireRole } from '../../aptitude/middleware/auth.js';
import { ProgrammingChallenge } from '../models/ProgrammingChallenge.js';
import { ProgrammingContest } from '../models/ProgrammingContest.js';
import { ProgrammingEditorial } from '../models/ProgrammingEditorial.js';
import { ProgrammingProblem } from '../models/ProgrammingProblem.js';
import { ProgrammingSubmission } from '../models/ProgrammingSubmission.js';
import { User } from '../../aptitude/models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { DIFFICULTIES, STATUSES, CONCEPTS, DEFAULT_PRACTICE_LANGUAGES, LANGUAGES } from '../utils/constants.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { ROLES } from '../../aptitude/utils/roles.js';
import {
  isVisibleProblemTitle,
  visibleProblemFilter,
  visibleProblemTitleFilter,
} from '../utils/problemVisibility.js';

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.ADMIN), requireModuleAccess('programming'));

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildStarterCode(input = {}) {
  return Object.fromEntries(LANGUAGES.map((language) => [language.id, input?.[language.id] || '']));
}

function normalizeLanguages(languages) {
  if (!Array.isArray(languages)) return DEFAULT_PRACTICE_LANGUAGES;
  const selected = languages.filter((language) => LANGUAGES.some((item) => item.id === language));
  return selected.length ? selected : DEFAULT_PRACTICE_LANGUAGES;
}

function parseStringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeCodeByLanguage(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value.toObject === 'function') return value.toObject();
  return value;
}

function serializeProblem(problem) {
  return {
    id: problem._id.toString(),
    problem_number: problem.problem_number || null,
    title: problem.title,
    description: problem.description,
    constraints: problem.constraints,
    input_format: problem.input_format,
    output_format: problem.output_format,
    hints: problem.hints || [],
    follow_up: problem.follow_up || '',
    difficulty: problem.difficulty,
    concept: problem.concept,
    tags: problem.tags || [],
    company_tags: problem.company_tags || [],
    companies_locked: problem.companies_locked !== false,
    review_status: problem.review_status || 'approved',
    is_private_bank: Boolean(problem.is_private_bank),
    sample_test_cases: problem.sample_test_cases,
    hidden_test_cases: problem.hidden_test_cases,
    time_limit: problem.time_limit,
    memory_limit: problem.memory_limit,
    languages: problem.languages,
    starter_code: problem.starter_code,
    status: problem.status,
    is_deleted: problem.is_deleted || false,
    total_submissions: problem.total_submissions,
    total_accepted: problem.total_accepted,
    acceptance_rate: problem.acceptance_rate,
    created_at: problem.created_at,
    updated_at: problem.updated_at,
  };
}

function parseProblemPayload(body) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const constraints = String(body.constraints || '').trim();
  const input_format = String(body.input_format || '').trim();
  const output_format = String(body.output_format || '').trim();
  const hints = parseStringList(body.hints);
  const follow_up = String(body.follow_up || '').trim();
  const difficulty = String(body.difficulty || '').trim();
  const concept = String(body.concept || '').trim();
  const time_limit = parseNumber(body.time_limit, 2);
  const memory_limit = parseNumber(body.memory_limit, 256);
  const status = String(body.status || 'draft').toLowerCase();

  const errors = [];
  if (!title) errors.push('Problem title is required');
  if (title && !isVisibleProblemTitle(title)) errors.push('Problem title must be a real question, not a topic or difficulty heading');
  if (!description) errors.push('Problem description is required');
  if (!DIFFICULTIES.includes(difficulty)) errors.push('Invalid difficulty');
  if (!CONCEPTS.includes(concept)) errors.push('Invalid concept');
  if (!STATUSES.includes(status)) errors.push('Invalid status');
  if (time_limit < 1 || time_limit > 15) errors.push('Time limit must be between 1 and 15 seconds');
  if (memory_limit < 16 || memory_limit > 1024) errors.push('Memory limit must be between 16 and 1024 MB');
  if (errors.length) throw badRequest('Validation failed', errors);

  const sample_test_cases = Array.isArray(body.sample_test_cases)
    ? body.sample_test_cases.map((tc) => ({
        input: String(tc.input || ''),
        output: String(tc.output || ''),
        display_input: String(tc.display_input || ''),
        display_output: String(tc.display_output || ''),
        explanation: String(tc.explanation || ''),
      }))
    : [];
  const hidden_test_cases = Array.isArray(body.hidden_test_cases)
    ? body.hidden_test_cases.map((tc) => ({
        input: String(tc.input || ''),
        output: String(tc.output || ''),
      }))
    : [];

  if (hidden_test_cases.length === 0) errors.push('At least one hidden test case is required');
  if (errors.length) throw badRequest('Validation failed', errors);

  return {
    title,
    description,
    constraints,
    input_format,
    output_format,
    hints,
    follow_up,
    difficulty,
    concept,
    tags: parseStringList(body.tags),
    company_tags: parseStringList(body.company_tags),
    companies_locked: body.companies_locked !== false,
    sample_test_cases,
    hidden_test_cases,
    time_limit,
    memory_limit,
    languages: normalizeLanguages(body.languages),
    starter_code: buildStarterCode(body.starter_code),
    status,
    is_private_bank: body.is_private_bank !== false,
    institution_id: body.is_private_bank === false ? null : body.institution_id || null,
  };
}

function sendExcel(res, filename, rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Report');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}.xlsx`);
  res.send(buffer);
}

function sendPdf(res, filename, title, rows) {
  const doc = new PDFDocument({ margin: 42 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  doc.on('end', () => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}.pdf`);
    res.send(Buffer.concat(chunks));
  });
  doc.font('Helvetica-Bold').fontSize(18).text(title);
  doc.moveDown();
  for (const row of rows.slice(0, 120)) {
    doc.font('Helvetica-Bold').fontSize(10).text(row.student_name || row.problem_title || 'Record');
    doc.font('Helvetica').fontSize(8).text(Object.entries(row).map(([key, value]) => `${key}: ${value ?? ''}`).join(' | '));
    doc.moveDown(0.6);
  }
  doc.end();
}

function toDateOrThrow(value, field) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw badRequest(`${field} must be a valid date`);
  return date;
}

function serializeChallenge(challenge) {
  const problem = challenge.problem_id;
  return {
    id: challenge._id.toString(),
    type: challenge.type,
    title: challenge.title,
    starts_at: challenge.starts_at,
    ends_at: challenge.ends_at,
    status: challenge.status,
    problem: problem && problem.title
      ? {
          id: problem._id.toString(),
          title: problem.title,
          difficulty: problem.difficulty,
          concept: problem.concept,
        }
      : { id: problem?.toString?.() || '', title: 'Unknown Problem' },
  };
}

function serializeContest(contest) {
  return {
    id: contest._id.toString(),
    title: contest.title,
    description: contest.description || '',
    starts_at: contest.starts_at,
    ends_at: contest.ends_at,
    status: contest.status,
    problem_count: contest.problem_ids?.length || 0,
    problems: (contest.problem_ids || []).map((problem) => (
      problem && problem.title
        ? {
            id: problem._id.toString(),
            title: problem.title,
            difficulty: problem.difficulty,
            concept: problem.concept,
          }
        : { id: problem?.toString?.() || '', title: 'Unknown Problem' }
    )),
  };
}

router.get(
  '/problems',
  asyncHandler(async (req, res) => {
    const { status, difficulty, concept, tag, review_status, page = 1, limit = 50 } = req.query;
    const filter = visibleProblemFilter({ is_deleted: { $ne: true } });
    if (status) filter.status = status;
    if (difficulty) filter.difficulty = difficulty;
    if (concept) filter.concept = concept;
    if (tag) filter.tags = tag;
    if (review_status) filter.review_status = review_status;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [problems, total] = await Promise.all([
      ProgrammingProblem.find(filter)
        .sort({ difficulty_rank: 1, curriculum_order: 1, topic_rank: 1, created_at: 1 })
        .skip(skip)
        .limit(limitNum),
      ProgrammingProblem.countDocuments(filter),
    ]);

    res.json({
      problems: problems.map(serializeProblem),
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
  '/problems/:id',
  asyncHandler(async (req, res) => {
    const problem = await ProgrammingProblem.findById(req.params.id);
    if (!problem || problem.is_deleted || !isVisibleProblemTitle(problem.title)) throw notFound('Problem not found');
    res.json({ problem: serializeProblem(problem) });
  }),
);

router.post(
  '/problems',
  asyncHandler(async (req, res) => {
    const config = parseProblemPayload(req.body);
    const problem = await ProgrammingProblem.create({
      ...config,
      institution_id: config.is_private_bank ? req.user._id : null,
      created_by: req.user._id,
    });
    res.status(201).json({ problem: serializeProblem(problem) });
  }),
);

router.put(
  '/problems/:id',
  asyncHandler(async (req, res) => {
    const problem = await ProgrammingProblem.findById(req.params.id);
    if (!problem || problem.is_deleted || !isVisibleProblemTitle(problem.title)) throw notFound('Problem not found');

    const config = parseProblemPayload(req.body);
    Object.assign(problem, {
      ...config,
      institution_id: config.is_private_bank ? req.user._id : null,
    });
    await problem.save();

    res.json({ problem: serializeProblem(problem) });
  }),
);

router.patch(
  '/problems/:id/status',
  asyncHandler(async (req, res) => {
    const problem = await ProgrammingProblem.findById(req.params.id);
    if (!problem || problem.is_deleted || !isVisibleProblemTitle(problem.title)) throw notFound('Problem not found');

    const status = String(req.body.status || '').toLowerCase();
    if (!STATUSES.includes(status)) throw badRequest('Invalid status');

    problem.status = status;
    await problem.save();

    res.json({ problem: serializeProblem(problem) });
  }),
);

router.delete(
  '/problems/:id',
  asyncHandler(async (req, res) => {
    const problem = await ProgrammingProblem.findById(req.params.id);
    if (!problem || problem.is_deleted || !isVisibleProblemTitle(problem.title)) throw notFound('Problem not found');

    problem.is_deleted = true;
    problem.deleted_at = new Date();
    problem.status = 'draft';
    await problem.save();

    res.status(204).end();
  }),
);

router.get(
  '/problems/:id/editorial',
  asyncHandler(async (req, res) => {
    const problem = await ProgrammingProblem.findById(req.params.id);
    if (!problem || problem.is_deleted || !isVisibleProblemTitle(problem.title)) throw notFound('Problem not found');
    const editorial = await ProgrammingEditorial.findOne({ problem_id: problem._id });
    res.json({
      editorial: editorial
        ? {
            id: editorial._id.toString(),
            problem_id: editorial.problem_id.toString(),
            overview: editorial.overview,
            brute_force: editorial.brute_force,
            optimal_approach: editorial.optimal_approach,
            complexity: editorial.complexity,
            pitfalls: editorial.pitfalls || [],
            code_by_language: serializeCodeByLanguage(editorial.code_by_language),
            updated_at: editorial.updated_at,
          }
        : null,
    });
  }),
);

router.put(
  '/problems/:id/editorial',
  asyncHandler(async (req, res) => {
    const problem = await ProgrammingProblem.findById(req.params.id);
    if (!problem || problem.is_deleted || !isVisibleProblemTitle(problem.title)) throw notFound('Problem not found');

    const overview = String(req.body.overview || '').trim();
    const optimalApproach = String(req.body.optimal_approach || '').trim();
    if (!overview || !optimalApproach) throw badRequest('Overview and optimal approach are required');

    const editorial = await ProgrammingEditorial.findOneAndUpdate(
      { problem_id: problem._id },
      {
        problem_id: problem._id,
        overview,
        brute_force: String(req.body.brute_force || '').trim(),
        optimal_approach: optimalApproach,
        complexity: String(req.body.complexity || '').trim(),
        pitfalls: Array.isArray(req.body.pitfalls)
          ? req.body.pitfalls.map((pitfall) => String(pitfall).trim()).filter(Boolean).slice(0, 8)
          : [],
        code_by_language: req.body.code_by_language && typeof req.body.code_by_language === 'object'
          ? req.body.code_by_language
          : {},
        created_by: req.user._id,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    res.json({
      editorial: {
        id: editorial._id.toString(),
        problem_id: editorial.problem_id.toString(),
        overview: editorial.overview,
        brute_force: editorial.brute_force,
        optimal_approach: editorial.optimal_approach,
        complexity: editorial.complexity,
        pitfalls: editorial.pitfalls || [],
        code_by_language: serializeCodeByLanguage(editorial.code_by_language),
        updated_at: editorial.updated_at,
      },
    });
  }),
);

router.get(
  '/challenges',
  asyncHandler(async (_req, res) => {
    const challenges = await ProgrammingChallenge.find({})
      .sort({ starts_at: -1 })
      .limit(100)
      .populate('problem_id', 'title difficulty concept');
    res.json({ challenges: challenges.map(serializeChallenge) });
  }),
);

router.post(
  '/challenges',
  asyncHandler(async (req, res) => {
    const type = String(req.body.type || '');
    if (!['daily', 'weekly'].includes(type)) throw badRequest('Challenge type must be daily or weekly');
    const problem = await ProgrammingProblem.findById(req.body.problem_id);
    if (!problem || problem.is_deleted || !isVisibleProblemTitle(problem.title)) throw notFound('Problem not found');

    const startsAt = toDateOrThrow(req.body.starts_at, 'starts_at');
    const endsAt = toDateOrThrow(req.body.ends_at, 'ends_at');
    if (endsAt <= startsAt) throw badRequest('ends_at must be after starts_at');

    const challenge = await ProgrammingChallenge.create({
      problem_id: problem._id,
      type,
      title: String(req.body.title || (type === 'weekly' ? 'Weekly Challenge' : 'Daily Challenge')).trim(),
      starts_at: startsAt,
      ends_at: endsAt,
      status: req.body.status === 'draft' ? 'draft' : 'published',
      created_by: req.user._id,
    });
    await challenge.populate('problem_id', 'title difficulty concept');
    res.status(201).json({ challenge: serializeChallenge(challenge) });
  }),
);

router.get(
  '/contests',
  asyncHandler(async (req, res) => {
    const contests = await ProgrammingContest.find({
      $or: [{ institution_id: req.user._id }, { institution_id: null }],
    })
      .sort({ starts_at: -1 })
      .limit(100)
      .populate('problem_ids', 'title difficulty concept');
    res.json({ contests: contests.map(serializeContest) });
  }),
);

router.post(
  '/contests',
  asyncHandler(async (req, res) => {
    const title = String(req.body.title || '').trim();
    const problemIds = Array.isArray(req.body.problem_ids) ? req.body.problem_ids : [];
    if (!title) throw badRequest('Contest title is required');
    if (!problemIds.length) throw badRequest('At least one contest problem is required');

    const startsAt = toDateOrThrow(req.body.starts_at, 'starts_at');
    const endsAt = toDateOrThrow(req.body.ends_at, 'ends_at');
    if (endsAt <= startsAt) throw badRequest('ends_at must be after starts_at');

    const problems = await ProgrammingProblem.find({
      _id: { $in: problemIds },
      is_deleted: { $ne: true },
    }).select('_id');
    if (problems.length !== problemIds.length) throw badRequest('One or more contest problems are invalid');

    const contest = await ProgrammingContest.create({
      title,
      description: String(req.body.description || '').trim(),
      problem_ids: problems.map((problem) => problem._id),
      starts_at: startsAt,
      ends_at: endsAt,
      status: req.body.status === 'draft' ? 'draft' : 'published',
      institution_id: req.user._id,
      created_by: req.user._id,
    });
    await contest.populate('problem_ids', 'title difficulty concept');
    res.status(201).json({ contest: serializeContest(contest) });
  }),
);

router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const assignedStudents = await User.find({
      role: 'student',
      assigned_admin: req.user._id,
    }).select('name email');
    const assignedStudentIds = assignedStudents.map((student) => student._id);
    const submissions = await ProgrammingSubmission.find({
      student_id: { $in: assignedStudentIds },
    })
      .select('student_id problem_id status submitted_at')
      .sort({ submitted_at: -1 });

    const stats = new Map(assignedStudents.map((student) => [
      student._id.toString(),
      {
        student_id: student._id.toString(),
        student_name: student.name,
        student_email: student.email,
        solved_set: new Set(),
        total_submissions: 0,
        accepted_submissions: 0,
        latest_submission_at: null,
      },
    ]));

    for (const submission of submissions) {
      const row = stats.get(submission.student_id.toString());
      if (!row) continue;
      row.total_submissions += 1;
      if (!row.latest_submission_at || submission.submitted_at > row.latest_submission_at) {
        row.latest_submission_at = submission.submitted_at;
      }
      if (submission.status === 'accepted') {
        row.accepted_submissions += 1;
        row.solved_set.add(submission.problem_id.toString());
      }
    }

    const leaderboard = [...stats.values()]
      .map((row) => ({
        student_id: row.student_id,
        student_name: row.student_name,
        student_email: row.student_email,
        solved: row.solved_set.size,
        total_submissions: row.total_submissions,
        accepted_submissions: row.accepted_submissions,
        acceptance_rate: row.total_submissions ? Math.round((row.accepted_submissions / row.total_submissions) * 100) : 0,
        latest_submission_at: row.latest_submission_at,
        points: row.solved_set.size * 100 + row.accepted_submissions * 5,
      }))
      .sort((a, b) => b.points - a.points || b.solved - a.solved || a.total_submissions - b.total_submissions)
      .map((row, index) => ({ ...row, rank: index + 1 }));

    res.json({ leaderboard });
  }),
);

router.get(
  '/submissions',
  asyncHandler(async (req, res) => {
    const { problem_id, status, page = 1, limit = 50 } = req.query;
    const assignedStudents = await User.find({
      role: 'student',
      assigned_admin: req.user._id,
    }).select('_id');
    const assignedStudentIds = assignedStudents.map((s) => s._id);

    const filter = assignedStudentIds.length
      ? { student_id: { $in: assignedStudentIds } }
      : { student_id: null };
    if (problem_id) filter.problem_id = problem_id;
    if (status) filter.status = status;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [submissions, total] = await Promise.all([
      ProgrammingSubmission.find(filter)
        .sort({ submitted_at: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('student_id', 'name email')
        .populate('problem_id', 'title difficulty concept'),
      ProgrammingSubmission.countDocuments(filter),
    ]);

    res.json({
      submissions: submissions.map((sub) => ({
        id: sub._id.toString(),
        student_name: sub.student_id?.name || 'Unknown',
        student_email: sub.student_id?.email || '',
        problem_title: sub.problem_id?.title || 'Unknown Problem',
        problem_difficulty: sub.problem_id?.difficulty || '',
        language: sub.language,
        status: sub.status,
        passed_test_cases: sub.passed_test_cases,
        total_test_cases: sub.total_test_cases,
        execution_time_ms: sub.execution_time_ms,
        submitted_at: sub.submitted_at,
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
  '/submissions/:id',
  asyncHandler(async (req, res) => {
    const submission = await ProgrammingSubmission.findById(req.params.id)
      .populate('student_id', 'name email')
      .populate('problem_id', 'title difficulty concept');

    if (!submission) throw notFound('Submission not found');

    res.json({
      submission: {
        id: submission._id.toString(),
        student_name: submission.student_id?.name || 'Unknown',
        student_email: submission.student_id?.email || '',
        problem_title: submission.problem_id?.title || 'Unknown Problem',
        problem_difficulty: submission.problem_id?.difficulty || '',
        language: submission.language,
        code: submission.code,
        status: submission.status,
        passed_test_cases: submission.passed_test_cases,
        total_test_cases: submission.total_test_cases,
        test_results: submission.test_results,
        execution_time_ms: submission.execution_time_ms,
        error_message: submission.error_message,
        submitted_at: submission.submitted_at,
      },
    });
  }),
);

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const assignedStudents = await User.find({
      role: 'student',
      assigned_admin: req.user._id,
    }).select('_id');
    const assignedStudentIds = assignedStudents.map((s) => s._id);
    const studentFilter = assignedStudentIds.length
      ? { student_id: { $in: assignedStudentIds } }
      : { student_id: null };

    const [totalProblems, publishedProblems, totalSubmissions, acceptedSubmissions, recentSubmissions] =
      await Promise.all([
        ProgrammingProblem.countDocuments(visibleProblemFilter({ is_deleted: { $ne: true } })),
        ProgrammingProblem.countDocuments(visibleProblemFilter({ status: 'published', is_deleted: { $ne: true } })),
        ProgrammingSubmission.countDocuments(studentFilter),
        ProgrammingSubmission.countDocuments({ ...studentFilter, status: 'accepted' }),
        ProgrammingSubmission.find(studentFilter)
          .sort({ submitted_at: -1 })
          .limit(20)
          .populate('student_id', 'name email')
          .populate('problem_id', 'title difficulty concept'),
      ]);

    const conceptBreakdown = await ProgrammingProblem.aggregate([
      { $match: { is_deleted: { $ne: true }, status: 'published', ...visibleProblemTitleFilter() } },
      { $group: { _id: '$concept', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({
      total_problems: totalProblems,
      published_problems: publishedProblems,
      total_submissions: totalSubmissions,
      accepted_submissions: acceptedSubmissions,
      acceptance_rate: totalSubmissions
        ? Math.round((acceptedSubmissions / totalSubmissions) * 100)
        : 0,
      concept_breakdown: conceptBreakdown.map((c) => ({
        concept: c._id,
        count: c.count,
      })),
      recent_submissions: recentSubmissions.map((sub) => ({
        id: sub._id.toString(),
        student_name: sub.student_id?.name || 'Unknown',
        student_email: sub.student_id?.email || '',
        problem_title: sub.problem_id?.title || 'Unknown',
        problem_difficulty: sub.problem_id?.difficulty || '',
        language: sub.language,
        status: sub.status,
        passed_test_cases: sub.passed_test_cases,
        total_test_cases: sub.total_test_cases,
        submitted_at: sub.submitted_at,
      })),
    });
  }),
);

router.get(
  '/analytics/students',
  asyncHandler(async (req, res) => {
    const assignedStudents = await User.find({
      role: 'student',
      assigned_admin: req.user._id,
    }).select('_id');
    const assignedStudentIds = assignedStudents.map((s) => s._id);
    const studentFilter = assignedStudentIds.length
      ? { student_id: { $in: assignedStudentIds } }
      : { student_id: null };

    const [totalStudents, submissions] = await Promise.all([
      assignedStudentIds.length,
      ProgrammingSubmission.aggregate([
        { $match: studentFilter },
        {
          $group: {
            _id: '$student_id',
            total_submissions: { $sum: 1 },
            accepted: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } },
          },
        },
        { $sort: { total_submissions: -1 } },
      ]),
    ]);

    const studentIds = submissions.map((s) => s._id);
    const students = await User.find({ _id: { $in: studentIds } }).select('name email');

    const studentMap = {};
    for (const s of students) {
      studentMap[s._id.toString()] = { name: s.name, email: s.email };
    }

    res.json({
      total_students: totalStudents,
      student_performance: submissions.map((s) => ({
        student_id: s._id.toString(),
        student_name: studentMap[s._id.toString()]?.name || 'Unknown',
        student_email: studentMap[s._id.toString()]?.email || '',
        total_submissions: s.total_submissions,
        accepted: s.accepted,
        acceptance_rate: s.total_submissions
          ? Math.round((s.accepted / s.total_submissions) * 100)
          : 0,
      })),
    });
  }),
);

router.get(
  '/exports/coding-progress',
  asyncHandler(async (req, res) => {
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const assignedStudents = await User.find({
      role: 'student',
      assigned_admin: req.user._id,
    }).select('_id');
    const assignedStudentIds = assignedStudents.map((student) => student._id);
    const studentFilter = assignedStudentIds.length
      ? { student_id: { $in: assignedStudentIds } }
      : { student_id: null };

    const submissions = await ProgrammingSubmission.find(studentFilter)
      .sort({ submitted_at: -1 })
      .limit(2000)
      .populate('student_id', 'name email')
      .populate('problem_id', 'title difficulty concept');
    const rows = submissions.map((submission) => ({
      student_name: submission.student_id?.name || 'Unknown',
      email: submission.student_id?.email || '',
      problem_title: submission.problem_id?.title || 'Unknown',
      concept: submission.problem_id?.concept || '',
      difficulty: submission.problem_id?.difficulty || '',
      language: submission.language,
      status: submission.status,
      passed_test_cases: submission.passed_test_cases,
      total_test_cases: submission.total_test_cases,
      execution_time_ms: submission.execution_time_ms,
      submitted_at: submission.submitted_at,
    }));

    if (format === 'pdf') {
      sendPdf(res, 'coding-progress', 'Coding Progress Report', rows);
      return;
    }
    sendExcel(res, 'coding-progress', rows);
  }),
);

router.get(
  '/question-bank/duplicates',
  asyncHandler(async (_req, res) => {
    const duplicates = await ProgrammingProblem.aggregate([
      { $match: { is_deleted: { $ne: true } } },
      {
        $addFields: {
          normalized: {
            $trim: {
              input: {
                $regexReplace: {
                  input: { $toLower: '$title' },
                  regex: '[^a-z0-9]+',
                  replacement: ' ',
                },
              },
            },
          },
        },
      },
      { $group: { _id: '$normalized', count: { $sum: 1 }, ids: { $push: '$_id' }, samples: { $push: '$title' } } },
      { $match: { count: { $gt: 1 }, _id: { $ne: '' } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]);
    res.json({
      duplicates: duplicates.map((item) => ({
        fingerprint: item._id,
        count: item.count,
        problem_ids: item.ids.map((id) => id.toString()),
        sample: item.samples[0],
      })),
    });
  }),
);

router.patch(
  '/question-bank/:id/review',
  asyncHandler(async (req, res) => {
    const reviewStatus = String(req.body.review_status || '');
    if (!['draft', 'in_review', 'approved', 'rejected'].includes(reviewStatus)) {
      res.status(400).json({ detail: 'Invalid review status', message: 'Invalid review status' });
      return;
    }
    const problem = await ProgrammingProblem.findByIdAndUpdate(
      req.params.id,
      {
        review_status: reviewStatus,
        tags: Array.isArray(req.body.tags) ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean) : undefined,
        is_private_bank: Boolean(req.body.is_private_bank),
        institution_id: req.body.is_private_bank ? req.user._id : null,
      },
      { new: true },
    );
    if (!problem) throw notFound('Problem not found');
    res.json({
      problem: {
        id: problem._id.toString(),
        review_status: problem.review_status,
        tags: problem.tags || [],
        is_private_bank: Boolean(problem.is_private_bank),
      },
    });
  }),
);

export default router;
