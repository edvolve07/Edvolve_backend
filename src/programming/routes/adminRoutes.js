import express from 'express';
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import { requireAuth, requireModuleAccess, requireRole } from '../../aptitude/middleware/auth.js';
import { Op, getSequelize, User, ProgrammingProblem, ProgrammingSubmission, ProgrammingEditorial, ProgrammingChallenge, ProgrammingContest } from '../../database/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { DIFFICULTIES, STATUSES, CONCEPTS, DEFAULT_PRACTICE_LANGUAGES, LANGUAGES } from '../utils/constants.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { ROLES } from '../../aptitude/utils/roles.js';
import {
  INVALID_PROBLEM_TITLE_PATTERN,
  isVisibleProblemTitle,
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
  if (typeof value.toJSON === 'function') return value.toJSON();
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

function serializeChallenge(challenge, problem) {
  return {
    id: challenge._id.toString(),
    type: challenge.type,
    title: challenge.title,
    starts_at: challenge.starts_at,
    ends_at: challenge.ends_at,
    status: challenge.status,
    problem: problem
      ? {
          id: problem._id.toString(),
          title: problem.title,
          difficulty: problem.difficulty,
          concept: problem.concept,
        }
      : { id: challenge.problem_id?.toString?.() || '', title: 'Unknown Problem' },
  };
}

function serializeContest(contest, problems = []) {
  const problemMap = {};
  for (const p of problems) {
    problemMap[p._id.toString()] = p;
  }
  return {
    id: contest._id.toString(),
    title: contest.title,
    description: contest.description || '',
    starts_at: contest.starts_at,
    ends_at: contest.ends_at,
    status: contest.status,
    problem_count: contest.problem_ids?.length || 0,
    problems: (contest.problem_ids || []).map((pid) => {
      const problem = problemMap[pid.toString()];
      return problem
        ? {
            id: problem._id.toString(),
            title: problem.title,
            difficulty: problem.difficulty,
            concept: problem.concept,
          }
        : { id: pid.toString() || '', title: 'Unknown Problem' };
    }),
  };
}

router.get(
  '/problems',
  asyncHandler(async (req, res) => {
    const { status, difficulty, concept, tag, review_status, page = 1, limit = 50 } = req.query;
    const filter = { is_deleted: { [Op.ne]: true }, title: { [Op.notRegexp]: INVALID_PROBLEM_TITLE_PATTERN.source } };
    if (status) filter.status = status;
    if (difficulty) filter.difficulty = difficulty;
    if (concept) filter.concept = concept;
    if (tag) filter.tags = tag;
    if (review_status) filter.review_status = review_status;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const [problems, total] = await Promise.all([
      ProgrammingProblem.findAll({
        where: filter,
        order: [['difficulty_rank', 'ASC'], ['curriculum_order', 'ASC'], ['topic_rank', 'ASC'], ['created_at', 'ASC']],
        offset,
        limit: limitNum,
      }),
      ProgrammingProblem.count({ where: filter }),
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
    const problem = await ProgrammingProblem.findByPk(req.params.id);
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
    const problem = await ProgrammingProblem.findByPk(req.params.id);
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
    const problem = await ProgrammingProblem.findByPk(req.params.id);
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
    const problem = await ProgrammingProblem.findByPk(req.params.id);
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
    const problem = await ProgrammingProblem.findByPk(req.params.id);
    if (!problem || problem.is_deleted || !isVisibleProblemTitle(problem.title)) throw notFound('Problem not found');
    const editorial = await ProgrammingEditorial.findOne({ where: { problem_id: problem._id } });
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
    const problem = await ProgrammingProblem.findByPk(req.params.id);
    if (!problem || problem.is_deleted || !isVisibleProblemTitle(problem.title)) throw notFound('Problem not found');

    const overview = String(req.body.overview || '').trim();
    const optimalApproach = String(req.body.optimal_approach || '').trim();
    if (!overview || !optimalApproach) throw badRequest('Overview and optimal approach are required');

    const updateData = {
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
    };

    let editorial = await ProgrammingEditorial.findOne({ where: { problem_id: problem._id } });
    if (editorial) {
      await editorial.update(updateData);
    } else {
      editorial = await ProgrammingEditorial.create({ problem_id: problem._id, ...updateData });
    }

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
    const challenges = await ProgrammingChallenge.findAll({
      order: [['starts_at', 'DESC']],
      limit: 100,
    });

    const problemIds = [...new Set(challenges.map((c) => c.problem_id).filter(Boolean))];
    const problems = await ProgrammingProblem.findAll({
      where: { _id: { [Op.in]: problemIds } },
      attributes: ['_id', 'title', 'difficulty', 'concept'],
    });
    const problemMap = {};
    for (const p of problems) {
      problemMap[p._id.toString()] = p;
    }

    res.json({ challenges: challenges.map((c) => serializeChallenge(c, problemMap[c.problem_id?.toString()])) });
  }),
);

router.post(
  '/challenges',
  asyncHandler(async (req, res) => {
    const type = String(req.body.type || '');
    if (!['daily', 'weekly'].includes(type)) throw badRequest('Challenge type must be daily or weekly');
    const problem = await ProgrammingProblem.findByPk(req.body.problem_id);
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

    res.status(201).json({ challenge: serializeChallenge(challenge, problem) });
  }),
);

router.get(
  '/contests',
  asyncHandler(async (req, res) => {
    const contests = await ProgrammingContest.findAll({
      where: {
        [Op.or]: [{ institution_id: req.user._id }, { institution_id: null }],
      },
      order: [['starts_at', 'DESC']],
      limit: 100,
    });

    const allProblemIds = [...new Set(contests.flatMap((c) => c.problem_ids || []))];
    const problems = allProblemIds.length
      ? await ProgrammingProblem.findAll({
          where: { _id: { [Op.in]: allProblemIds } },
          attributes: ['_id', 'title', 'difficulty', 'concept'],
        })
      : [];

    res.json({ contests: contests.map((c) => serializeContest(c, problems)) });
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

    const problems = await ProgrammingProblem.findAll({
      where: { _id: { [Op.in]: problemIds }, is_deleted: { [Op.ne]: true } },
      attributes: ['_id'],
    });
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

    const contestProblems = await ProgrammingProblem.findAll({
      where: { _id: { [Op.in]: contest.problem_ids } },
      attributes: ['_id', 'title', 'difficulty', 'concept'],
    });

    res.status(201).json({ contest: serializeContest(contest, contestProblems) });
  }),
);

router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const assignedStudents = await User.findAll({
      where: { role: 'student', assigned_admin: req.user._id },
      attributes: ['_id', 'name', 'email'],
    });
    const assignedStudentIds = assignedStudents.map((student) => student._id);
    const submissions = await ProgrammingSubmission.findAll({
      where: { student_id: { [Op.in]: assignedStudentIds } },
      attributes: ['student_id', 'problem_id', 'status', 'submitted_at'],
      order: [['submitted_at', 'DESC']],
    });

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
    const assignedStudents = await User.findAll({
      where: { role: 'student', assigned_admin: req.user._id },
      attributes: ['_id'],
    });
    const assignedStudentIds = assignedStudents.map((s) => s._id);

    const filter = assignedStudentIds.length
      ? { student_id: { [Op.in]: assignedStudentIds } }
      : { student_id: null };
    if (problem_id) filter.problem_id = problem_id;
    if (status) filter.status = status;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const [submissions, total] = await Promise.all([
      ProgrammingSubmission.findAll({
        where: filter,
        order: [['submitted_at', 'DESC']],
        offset,
        limit: limitNum,
      }),
      ProgrammingSubmission.count({ where: filter }),
    ]);

    const studentIds = [...new Set(submissions.map((s) => s.student_id).filter(Boolean))];
    const problemIds = [...new Set(submissions.map((s) => s.problem_id).filter(Boolean))];
    const [students, problems] = await Promise.all([
      User.findAll({ where: { _id: { [Op.in]: studentIds } }, attributes: ['_id', 'name', 'email'] }),
      ProgrammingProblem.findAll({ where: { _id: { [Op.in]: problemIds } }, attributes: ['_id', 'title', 'difficulty', 'concept'] }),
    ]);
    const studentMap = {};
    for (const s of students) {
      studentMap[s._id.toString()] = s;
    }
    const problemMap = {};
    for (const p of problems) {
      problemMap[p._id.toString()] = p;
    }

    res.json({
      submissions: submissions.map((sub) => {
        const student = studentMap[sub.student_id?.toString()];
        const problem = problemMap[sub.problem_id?.toString()];
        return {
          id: sub._id.toString(),
          student_name: student?.name || 'Unknown',
          student_email: student?.email || '',
          problem_title: problem?.title || 'Unknown Problem',
          problem_difficulty: problem?.difficulty || '',
          language: sub.language,
          status: sub.status,
          passed_test_cases: sub.passed_test_cases,
          total_test_cases: sub.total_test_cases,
          execution_time_ms: sub.execution_time_ms,
          submitted_at: sub.submitted_at,
        };
      }),
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
    const submission = await ProgrammingSubmission.findByPk(req.params.id);

    if (!submission) throw notFound('Submission not found');

    let student = null;
    let problem = null;
    if (submission.student_id) {
      student = await User.findByPk(submission.student_id, { attributes: ['name', 'email'] });
    }
    if (submission.problem_id) {
      problem = await ProgrammingProblem.findByPk(submission.problem_id, { attributes: ['title', 'difficulty', 'concept'] });
    }

    res.json({
      submission: {
        id: submission._id.toString(),
        student_name: student?.name || 'Unknown',
        student_email: student?.email || '',
        problem_title: problem?.title || 'Unknown Problem',
        problem_difficulty: problem?.difficulty || '',
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
    const assignedStudents = await User.findAll({
      where: { role: 'student', assigned_admin: req.user._id },
      attributes: ['_id'],
    });
    const assignedStudentIds = assignedStudents.map((s) => s._id);
    const studentFilter = assignedStudentIds.length
      ? { student_id: { [Op.in]: assignedStudentIds } }
      : { student_id: null };

    const problemFilter = { is_deleted: { [Op.ne]: true }, title: { [Op.notRegexp]: INVALID_PROBLEM_TITLE_PATTERN.source } };
    const publishedProblemFilter = { ...problemFilter, status: 'published' };

    const [totalProblems, publishedProblems, totalSubmissions, acceptedSubmissions, recentSubmissions] =
      await Promise.all([
        ProgrammingProblem.count({ where: problemFilter }),
        ProgrammingProblem.count({ where: publishedProblemFilter }),
        ProgrammingSubmission.count({ where: studentFilter }),
        ProgrammingSubmission.count({ where: { ...studentFilter, status: 'accepted' } }),
        ProgrammingSubmission.findAll({
          where: studentFilter,
          order: [['submitted_at', 'DESC']],
          limit: 20,
        }),
      ]);

    const sequelize = getSequelize();
    const conceptBreakdown = await ProgrammingProblem.findAll({
      where: { is_deleted: { [Op.ne]: true }, status: 'published', title: { [Op.notRegexp]: INVALID_PROBLEM_TITLE_PATTERN.source } },
      attributes: ['concept', [sequelize.fn('COUNT', sequelize.col('_id')), 'count']],
      group: ['concept'],
      order: [[sequelize.fn('COUNT', sequelize.col('_id')), 'DESC']],
      raw: true,
    });

    const recentStudentIds = [...new Set(recentSubmissions.map((s) => s.student_id).filter(Boolean))];
    const recentProblemIds = [...new Set(recentSubmissions.map((s) => s.problem_id).filter(Boolean))];
    const [recentStudents, recentProblems] = await Promise.all([
      User.findAll({ where: { _id: { [Op.in]: recentStudentIds } }, attributes: ['_id', 'name', 'email'] }),
      ProgrammingProblem.findAll({ where: { _id: { [Op.in]: recentProblemIds } }, attributes: ['_id', 'title', 'difficulty', 'concept'] }),
    ]);
    const recentStudentMap = {};
    for (const s of recentStudents) {
      recentStudentMap[s._id.toString()] = s;
    }
    const recentProblemMap = {};
    for (const p of recentProblems) {
      recentProblemMap[p._id.toString()] = p;
    }

    res.json({
      total_problems: totalProblems,
      published_problems: publishedProblems,
      total_submissions: totalSubmissions,
      accepted_submissions: acceptedSubmissions,
      acceptance_rate: totalSubmissions
        ? Math.round((acceptedSubmissions / totalSubmissions) * 100)
        : 0,
      concept_breakdown: conceptBreakdown.map((c) => ({
        concept: c.concept,
        count: Number(c.count),
      })),
      recent_submissions: recentSubmissions.map((sub) => {
        const student = recentStudentMap[sub.student_id?.toString()];
        const problem = recentProblemMap[sub.problem_id?.toString()];
        return {
          id: sub._id.toString(),
          student_name: student?.name || 'Unknown',
          student_email: student?.email || '',
          problem_title: problem?.title || 'Unknown',
          problem_difficulty: problem?.difficulty || '',
          language: sub.language,
          status: sub.status,
          passed_test_cases: sub.passed_test_cases,
          total_test_cases: sub.total_test_cases,
          submitted_at: sub.submitted_at,
        };
      }),
    });
  }),
);

router.get(
  '/analytics/students',
  asyncHandler(async (req, res) => {
    const assignedStudents = await User.findAll({
      where: { role: 'student', assigned_admin: req.user._id },
      attributes: ['_id'],
    });
    const assignedStudentIds = assignedStudents.map((s) => s._id);
    const studentFilter = assignedStudentIds.length
      ? { student_id: { [Op.in]: assignedStudentIds } }
      : { student_id: null };

    const sequelize = getSequelize();
    const [totalStudents, submissions] = await Promise.all([
      assignedStudentIds.length,
      ProgrammingSubmission.findAll({
        where: studentFilter,
        attributes: [
          'student_id',
          [sequelize.fn('COUNT', sequelize.col('_id')), 'total_submissions'],
          [sequelize.fn('SUM', sequelize.literal("CASE WHEN status = 'accepted' THEN 1 ELSE 0 END")), 'accepted'],
        ],
        group: ['student_id'],
        order: [[sequelize.fn('COUNT', sequelize.col('_id')), 'DESC']],
        raw: true,
      }),
    ]);

    const studentIds = submissions.map((s) => s.student_id);
    const students = await User.findAll({
      where: { _id: { [Op.in]: studentIds } },
      attributes: ['_id', 'name', 'email'],
    });

    const studentMap = {};
    for (const s of students) {
      studentMap[s._id.toString()] = { name: s.name, email: s.email };
    }

    res.json({
      total_students: totalStudents,
      student_performance: submissions.map((s) => ({
        student_id: s.student_id.toString(),
        student_name: studentMap[s.student_id.toString()]?.name || 'Unknown',
        student_email: studentMap[s.student_id.toString()]?.email || '',
        total_submissions: Number(s.total_submissions),
        accepted: Number(s.accepted),
        acceptance_rate: Number(s.total_submissions)
          ? Math.round((Number(s.accepted) / Number(s.total_submissions)) * 100)
          : 0,
      })),
    });
  }),
);

router.get(
  '/exports/coding-progress',
  asyncHandler(async (req, res) => {
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const assignedStudents = await User.findAll({
      where: { role: 'student', assigned_admin: req.user._id },
      attributes: ['_id'],
    });
    const assignedStudentIds = assignedStudents.map((student) => student._id);
    const studentFilter = assignedStudentIds.length
      ? { student_id: { [Op.in]: assignedStudentIds } }
      : { student_id: null };

    const submissions = await ProgrammingSubmission.findAll({
      where: studentFilter,
      order: [['submitted_at', 'DESC']],
      limit: 2000,
    });

    const studentIds = [...new Set(submissions.map((s) => s.student_id).filter(Boolean))];
    const problemIds = [...new Set(submissions.map((s) => s.problem_id).filter(Boolean))];
    const [students, problems] = await Promise.all([
      User.findAll({ where: { _id: { [Op.in]: studentIds } }, attributes: ['_id', 'name', 'email'] }),
      ProgrammingProblem.findAll({ where: { _id: { [Op.in]: problemIds } }, attributes: ['_id', 'title', 'difficulty', 'concept'] }),
    ]);
    const studentMap = {};
    for (const s of students) {
      studentMap[s._id.toString()] = s;
    }
    const problemMap = {};
    for (const p of problems) {
      problemMap[p._id.toString()] = p;
    }

    const rows = submissions.map((submission) => {
      const student = studentMap[submission.student_id?.toString()];
      const problem = problemMap[submission.problem_id?.toString()];
      return {
        student_name: student?.name || 'Unknown',
        email: student?.email || '',
        problem_title: problem?.title || 'Unknown',
        concept: problem?.concept || '',
        difficulty: problem?.difficulty || '',
        language: submission.language,
        status: submission.status,
        passed_test_cases: submission.passed_test_cases,
        total_test_cases: submission.total_test_cases,
        execution_time_ms: submission.execution_time_ms,
        submitted_at: submission.submitted_at,
      };
    });

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
    const problems = await ProgrammingProblem.findAll({
      where: { is_deleted: { [Op.ne]: true } },
      attributes: ['_id', 'title'],
    });

    const groups = {};
    for (const p of problems) {
      const normalized = (p.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (!normalized) continue;
      if (!groups[normalized]) {
        groups[normalized] = { ids: [], samples: [] };
      }
      groups[normalized].ids.push(p._id);
      groups[normalized].samples.push(p.title);
    }

    const duplicates = Object.entries(groups)
      .filter(([, group]) => group.ids.length > 1)
      .sort((a, b) => b[1].ids.length - a[1].ids.length)
      .slice(0, 50)
      .map(([normalized, group]) => ({
        fingerprint: normalized,
        count: group.ids.length,
        problem_ids: group.ids.map((id) => id.toString()),
        sample: group.samples[0],
      }));

    res.json({ duplicates });
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
    await ProgrammingProblem.update(
      {
        review_status: reviewStatus,
        tags: Array.isArray(req.body.tags) ? req.body.tags.map((tag) => String(tag).trim()).filter(Boolean) : undefined,
        is_private_bank: Boolean(req.body.is_private_bank),
        institution_id: req.body.is_private_bank ? req.user._id : null,
      },
      { where: { _id: req.params.id } },
    );
    const problem = await ProgrammingProblem.findByPk(req.params.id);
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
