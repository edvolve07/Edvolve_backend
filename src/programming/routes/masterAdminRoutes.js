import express from 'express';
import { requireAuth, requireRole } from '../../aptitude/middleware/auth.js';
import { Op, getSequelize, Student, ProgrammingProblem, ProgrammingSubmission } from '../../database/index.js';
import { sanitizeStudentSubmissionError } from '../utils/studentResultSerializer.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { DIFFICULTIES, STATUSES, CONCEPTS, DEFAULT_PRACTICE_LANGUAGES, LANGUAGES } from '../utils/constants.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { ROLES } from '../../aptitude/utils/roles.js';
import {
  INVALID_PROBLEM_TITLE_PATTERN,
  isVisibleProblemTitle,
} from '../utils/problemVisibility.js';

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.MASTER_ADMIN));

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildStarterCode(input = {}) {
  return Object.fromEntries(LANGUAGES.map((language) => [language.id, input?.[language.id] || '']));
}

function normalizeLanguages(languages) {
  if (!Array.isArray(languages)) return DEFAULT_PRACTICE_LANGUAGES;
  const selected = languages.filter((l) => LANGUAGES.some((lang) => lang.id === l));
  return selected.length ? selected : DEFAULT_PRACTICE_LANGUAGES;
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
    created_by: problem.created_by?.toString() || '',
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
  const hints = Array.isArray(body.hints)
    ? body.hints.map((hint) => String(hint).trim()).filter(Boolean)
    : String(body.hints || '').split(',').map((hint) => hint.trim()).filter(Boolean);
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

  if (hidden_test_cases.length === 0) {
    errors.push('At least one hidden test case is required');
  }
  if (errors.length) throw badRequest('Validation failed', errors);

  const languages = normalizeLanguages(body.languages);

  const starter_code = buildStarterCode(body.starter_code);

  return {
    title,
    description,
    constraints,
    input_format,
    output_format,
    hints,
    follow_up,
    tags: Array.isArray(body.tags) ? body.tags.map((tag) => String(tag).trim()).filter(Boolean) : String(body.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    company_tags: Array.isArray(body.company_tags) ? body.company_tags.map((tag) => String(tag).trim()).filter(Boolean) : String(body.company_tags || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    companies_locked: body.companies_locked !== false,
    difficulty,
    concept,
    sample_test_cases,
    hidden_test_cases,
    time_limit,
    memory_limit,
    languages,
    starter_code,
    status,
  };
}

router.get(
  '/problems',
  asyncHandler(async (req, res) => {
    const { status, difficulty, concept, page = 1, limit = 50 } = req.query;
    const filter = { is_deleted: { [Op.ne]: true }, title: { [Op.notRegexp]: INVALID_PROBLEM_TITLE_PATTERN.source } };
    if (status) filter.status = status;
    if (difficulty) filter.difficulty = difficulty;
    if (concept) filter.concept = concept;

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
    Object.assign(problem, config);
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
  '/submissions',
  asyncHandler(async (req, res) => {
    const { problem_id, status, page = 1, limit = 50 } = req.query;
    const filter = {};
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
      Student.findAll({ where: { _id: { [Op.in]: studentIds } }, attributes: ['_id', 'name', 'email'] }),
      ProgrammingProblem.findAll({ where: { _id: { [Op.in]: problemIds } }, attributes: ['_id', 'title', 'difficulty', 'concept'] }),
    ]);

    const studentMap = Object.fromEntries(students.map((s) => [s._id.toString(), s]));
    const problemMap = Object.fromEntries(problems.map((p) => [p._id.toString(), p]));

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
      student = await Student.findByPk(submission.student_id, { attributes: ['name', 'email'] });
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
        error_message: sanitizeStudentSubmissionError(submission.error_message, submission.status),
        submitted_at: submission.submitted_at,
      },
    });
  }),
);

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const problemFilter = { is_deleted: { [Op.ne]: true }, title: { [Op.notRegexp]: INVALID_PROBLEM_TITLE_PATTERN.source } };
    const publishedProblemFilter = { ...problemFilter, status: 'published' };

    const [totalProblems, publishedProblems, totalSubmissions, acceptedSubmissions, recentSubmissions] =
      await Promise.all([
        ProgrammingProblem.count({ where: problemFilter }),
        ProgrammingProblem.count({ where: publishedProblemFilter }),
        ProgrammingSubmission.count(),
        ProgrammingSubmission.count({ where: { status: 'accepted' } }),
        ProgrammingSubmission.findAll({
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

    const studentIds = [...new Set(recentSubmissions.map((s) => s.student_id).filter(Boolean))];
    const problemIds = [...new Set(recentSubmissions.map((s) => s.problem_id).filter(Boolean))];

    const [students, problems] = await Promise.all([
      Student.findAll({ where: { _id: { [Op.in]: studentIds } }, attributes: ['_id', 'name', 'email'] }),
      ProgrammingProblem.findAll({ where: { _id: { [Op.in]: problemIds } }, attributes: ['_id', 'title', 'difficulty', 'concept'] }),
    ]);

    const studentMap = Object.fromEntries(students.map((s) => [s._id.toString(), s]));
    const problemMap = Object.fromEntries(problems.map((p) => [p._id.toString(), p]));

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
        count: c.count,
      })),
      recent_submissions: recentSubmissions.map((sub) => {
        const student = studentMap[sub.student_id?.toString()];
        const problem = problemMap[sub.problem_id?.toString()];
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

export default router;
