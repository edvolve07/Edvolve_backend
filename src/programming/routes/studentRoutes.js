import express from 'express';
import { requireAuth, requireModuleAccess, requireRole } from '../../aptitude/middleware/auth.js';
import {
  Op,
  User,
  ProgrammingChallenge,
  ProgrammingContest,
  ProgrammingDiscussion,
  ProgrammingEditorial,
  ProgrammingProblem,
  ProgrammingSubmission,
  getSequelize,
} from '../../database/index.js';
import { evaluateSubmission } from '../services/executionService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';
import {
  sanitizeStudentError,
  sanitizeStudentSubmissionError,
  serializeStudentTestResult,
} from '../utils/studentResultSerializer.js';
import { DEFAULT_PRACTICE_LANGUAGES, LANGUAGE_IDS } from '../utils/constants.js';
import { isVisibleProblemTitle, INVALID_PROBLEM_TITLE_PATTERN } from '../utils/problemVisibility.js';

const sequelize = getSequelize();
const router = express.Router();

router.use(requireAuth, requireRole('student'), requireModuleAccess('programming'));

function getPracticeLanguages(problem) {
  const configured = Array.isArray(problem?.languages)
    ? problem.languages.filter((language) => LANGUAGE_IDS.includes(language))
    : [];
  const merged = [...new Set([...configured, ...DEFAULT_PRACTICE_LANGUAGES])];
  return merged.length ? merged : DEFAULT_PRACTICE_LANGUAGES;
}

function serializeProblem(problem) {
  return {
    id: problem._id.toString(),
    problem_number: problem.problem_number || null,
    title: problem.title,
    difficulty: problem.difficulty,
    concept: problem.concept,
    tags: problem.tags || [],
    company_tags: problem.company_tags || [],
    companies_locked: problem.companies_locked !== false,
    sample_test_cases: problem.sample_test_cases,
    time_limit: problem.time_limit,
    memory_limit: problem.memory_limit,
    languages: getPracticeLanguages(problem),
    total_submissions: problem.total_submissions,
    total_accepted: problem.total_accepted,
    acceptance_rate: problem.acceptance_rate,
  };
}

function serializeProblemDetail(problem) {
  return {
    id: problem._id.toString(),
    problem_number: problem.problem_number || null,
    title: problem.title,
    description: problem.description,
    constraints: problem.constraints,
    input_format: problem.input_format,
    output_format: problem.output_format,
    difficulty: problem.difficulty,
    concept: problem.concept,
    tags: problem.tags || [],
    company_tags: problem.company_tags || [],
    companies_locked: problem.companies_locked !== false,
    hints: problem.hints || [],
    follow_up: problem.follow_up || '',
    sample_test_cases: problem.sample_test_cases,
    time_limit: problem.time_limit,
    memory_limit: problem.memory_limit,
    languages: getPracticeLanguages(problem),
    starter_code: problem.starter_code,
    total_submissions: problem.total_submissions,
    total_accepted: problem.total_accepted,
    acceptance_rate: problem.acceptance_rate,
  };
}

function studentProblemPrivacyFilterSequelize(user, prefix = '') {
  const field = (name) => (prefix ? sequelize.col(`${prefix}.${name}`) : name);
  if (!user.assigned_admin) {
    return { [field('is_private_bank')]: { [Op.ne]: true } };
  }
  return {
    [Op.or]: [
      { [field('is_private_bank')]: { [Op.ne]: true } },
      { [field('institution_id')]: user.assigned_admin },
    ],
  };
}

function studentVisibleProblemWhere(user) {
  const conditions = {
    status: 'published',
    is_deleted: { [Op.ne]: true },
    is_auto_gradable: { [Op.ne]: false },
    title: { [Op.notIRegexp]: '^#?\\s*Topic\\s+\\d+\\s*:|^(Easy|Medium|Hard)\\s*\\(' },
  };
  if (!user.assigned_admin) {
    conditions.is_private_bank = { [Op.ne]: true };
  } else {
    conditions[Op.or] = [
      { is_private_bank: { [Op.ne]: true } },
      { institution_id: user.assigned_admin },
    ];
  }
  return conditions;
}

function canStudentSeeProblem(problem, user) {
  return Boolean(
    problem
    && !problem.is_deleted
    && problem.status === 'published'
    && problem.is_auto_gradable !== false
    && isVisibleProblemTitle(problem.title)
    && (
      !problem.is_private_bank
      || (
        user.assigned_admin
        && problem.institution_id
        && problem.institution_id.toString() === user.assigned_admin.toString()
      )
    ),
  );
}

async function getVisibleProblemOrThrow(id, user) {
  const problem = await ProgrammingProblem.findByPk(id);
  if (!canStudentSeeProblem(problem, user)) {
    throw notFound('Problem not found');
  }
  return problem;
}

function serializeSubmissionSummary(submission, problemsMap) {
  const problem = problemsMap ? problemsMap.get(submission.problem_id) : null;
  return {
    id: submission._id.toString(),
    problem_id: problem?._id?.toString() || submission.problem_id?.toString?.() || '',
    problem_title: problem?.title || 'Unknown Problem',
    problem_difficulty: problem?.difficulty || '',
    problem_concept: problem?.concept || '',
    language: submission.language,
    status: submission.status,
    passed_test_cases: submission.passed_test_cases,
    total_test_cases: submission.total_test_cases,
    execution_time_ms: submission.execution_time_ms,
    submitted_at: submission.submitted_at,
  };
}

function serializeCodeByLanguage(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  if (typeof value === 'object' && value.dataValues) return value.get({ plain: true });
  return value;
}

function serializeEditorial(editorial, problem) {
  if (editorial) {
    return {
      id: editorial._id.toString(),
      problem_id: editorial.problem_id.toString(),
      overview: editorial.overview,
      brute_force: editorial.brute_force,
      optimal_approach: editorial.optimal_approach,
      complexity: editorial.complexity,
      pitfalls: editorial.pitfalls || [],
      code_by_language: serializeCodeByLanguage(editorial.code_by_language),
      updated_at: editorial.updated_at,
      is_generated_fallback: false,
    };
  }

  return {
    id: '',
    problem_id: problem._id.toString(),
    overview: `Break the problem into input parsing, the core transformation, and output formatting. ${problem.description.split('\n')[0] || ''}`.trim(),
    brute_force: 'Start with the most direct simulation or enumeration that matches the statement, then compare it against the constraints to find where it becomes too slow.',
    optimal_approach: `Use the ${problem.concept} pattern and preserve only the state needed to produce the final answer. Validate the approach against every sample before submitting hidden cases.`,
    complexity: `Time and space depend on the chosen ${problem.concept} strategy and input bounds. Aim for the lowest complexity allowed by the constraints.`,
    pitfalls: [
      'Handle empty input and boundary values.',
      'Match output formatting exactly.',
      'Re-test samples after changing the algorithm.',
    ],
    code_by_language: {},
    updated_at: problem.updated_at,
    is_generated_fallback: true,
  };
}

async function getInstitutionStudentIds(user) {
  if (!user.assigned_admin) return [user._id];
  const peers = await User.findAll({
    where: {
      role: 'student',
      assigned_admin: user.assigned_admin,
      is_active: { [Op.ne]: false },
    },
    attributes: ['_id'],
  });
  return peers.map((peer) => peer._id);
}

function serializeChallenge(challenge, problem, solvedSet) {
  if (!problem) return null;
  return {
    id: challenge?._id?.toString() || '',
    type: challenge?.type || 'daily',
    title: challenge?.title || (challenge?.type === 'weekly' ? 'Weekly Challenge' : 'Daily Challenge'),
    starts_at: challenge?.starts_at || null,
    ends_at: challenge?.ends_at || null,
    problem: {
      ...serializeProblem(problem),
      solved: solvedSet.has(problem._id.toString()),
    },
  };
}

async function getFallbackChallenge(type, solvedSet, user) {
  const count = await ProgrammingProblem.count({
    where: studentVisibleProblemWhere(user),
  });
  if (!count) return null;
  const now = new Date();
  const dayNumber = Math.floor(now.getTime() / 86400000);
  const index = type === 'weekly'
    ? Math.floor(dayNumber / 7) % count
    : dayNumber % count;
  const [problem] = await ProgrammingProblem.findAll({
    where: studentVisibleProblemWhere(user),
    order: [
      ['curriculum_order', 'ASC'],
      ['topic_rank', 'ASC'],
      ['created_at', 'ASC'],
    ],
    offset: index,
    limit: 1,
  });
  return serializeChallenge({ type, title: type === 'weekly' ? 'Weekly Challenge' : 'Daily Challenge' }, problem, solvedSet);
}

async function fetchProblemsMap(problemIds) {
  const uniqueIds = [...new Set(problemIds.filter(Boolean))];
  if (!uniqueIds.length) return new Map();
  const problems = await ProgrammingProblem.findAll({
    where: { _id: { [Op.in]: uniqueIds } },
    attributes: ['_id', 'title', 'difficulty', 'concept'],
  });
  return new Map(problems.map((p) => [p._id.toString(), p]));
}

router.get(
  '/concepts',
  asyncHandler(async (req, res) => {
    const where = studentVisibleProblemWhere(req.user);

    const [result, acceptedSubmissions] = await Promise.all([
      ProgrammingProblem.findAll({
        where,
        attributes: [
          'concept',
          [sequelize.fn('COUNT', sequelize.col('_id')), 'count'],
          [sequelize.fn('MIN', sequelize.col('curriculum_order')), 'minCurriculumOrder'],
          [sequelize.fn('MIN', sequelize.col('difficulty_rank')), 'minDifficultyRank'],
        ],
        group: ['concept'],
        order: [
          [sequelize.fn('MIN', sequelize.col('curriculum_order')), 'ASC'],
          [sequelize.fn('MIN', sequelize.col('difficulty_rank')), 'ASC'],
          ['concept', 'ASC'],
        ],
        raw: true,
      }),
      ProgrammingSubmission.findAll({
        where: { student_id: req.user._id, status: 'accepted' },
        attributes: ['problem_id'],
        raw: true,
      }),
    ]);

    const acceptedProblemIds = [...new Set(acceptedSubmissions.map((s) => s.problem_id))];
    const acceptedProblems = acceptedProblemIds.length
      ? await ProgrammingProblem.findAll({
          where: {
            _id: { [Op.in]: acceptedProblemIds },
            ...where,
          },
        })
      : [];

    const solvedByConcept = {};
    for (const p of acceptedProblems) {
      solvedByConcept[p.concept] = (solvedByConcept[p.concept] || 0) + 1;
    }

    const concepts = result.map((r) => r.concept);
    const counts = {};
    const solved_counts = {};
    const progress = {};

    result.forEach((r) => {
      counts[r.concept] = Number(r.count);
    });

    concepts.forEach((concept) => {
      const total = counts[concept] || 0;
      const solved = solvedByConcept[concept] || 0;
      solved_counts[concept] = solved;
      progress[concept] = total ? Math.round((solved / total) * 100) : 0;
    });

    res.json({ concepts, counts, solved_counts, progress });
  }),
);

router.get(
  '/problems',
  asyncHandler(async (req, res) => {
    const { difficulty, concept, tag, company, solved, page = 1, limit = 20 } = req.query;
    const where = studentVisibleProblemWhere(req.user);
    if (difficulty) where.difficulty = difficulty;
    if (concept) where.concept = concept;
    if (tag) where.tags = { [Op.contains]: [tag] };
    if (company) where.company_tags = { [Op.contains]: [company] };

    const [acceptedSubmissions, attemptedSubmissions] = await Promise.all([
      ProgrammingSubmission.findAll({
        where: { student_id: req.user._id, status: 'accepted' },
        attributes: ['problem_id'],
        raw: true,
      }),
      ProgrammingSubmission.findAll({
        where: { student_id: req.user._id },
        attributes: ['problem_id'],
        raw: true,
      }),
    ]);
    const solvedProblemIds = [...new Set(acceptedSubmissions.map((s) => s.problem_id))];
    const attemptedProblemIds = [...new Set(attemptedSubmissions.map((s) => s.problem_id))];

    if (solved === 'true') where._id = { [Op.in]: solvedProblemIds };
    if (solved === 'false') where._id = { [Op.notIn]: solvedProblemIds };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [problems, total] = await Promise.all([
      ProgrammingProblem.findAll({
        where,
        order: [
          ['difficulty_rank', 'ASC'],
          ['curriculum_order', 'ASC'],
          ['topic_rank', 'ASC'],
          ['created_at', 'ASC'],
        ],
        offset: skip,
        limit: limitNum,
      }),
      ProgrammingProblem.count({ where }),
    ]);

    const filterWhere = studentVisibleProblemWhere(req.user);
    const allFiltered = await ProgrammingProblem.findAll({
      where: filterWhere,
      attributes: ['tags', 'company_tags'],
    });
    const allTags = [...new Set(allFiltered.flatMap((p) => p.tags || []).filter(Boolean))].sort();
    const allCompanyTags = [...new Set(allFiltered.flatMap((p) => p.company_tags || []).filter(Boolean))].sort();

    const solvedSet = new Set(solvedProblemIds.map((id) => id.toString()));
    const attemptedSet = new Set(attemptedProblemIds.map((id) => id.toString()));

    res.json({
      problems: problems.map((problem) => ({
        ...serializeProblem(problem),
        solved: solvedSet.has(problem._id.toString()),
        attempted: attemptedSet.has(problem._id.toString()),
      })),
      filters: {
        tags: allTags,
        company_tags: allCompanyTags,
      },
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
    const problem = await getVisibleProblemOrThrow(req.params.id, req.user);
    const [solvedSubmission, latestSubmissions] = await Promise.all([
      ProgrammingSubmission.findOne({
        where: {
          problem_id: problem._id,
          student_id: req.user._id,
          status: 'accepted',
        },
      }),
      ProgrammingSubmission.findAll({
        where: {
          problem_id: problem._id,
          student_id: req.user._id,
        },
        order: [['submitted_at', 'DESC']],
        limit: 5,
      }),
    ]);
    res.json({
      problem: {
        ...serializeProblemDetail(problem),
        solved: Boolean(solvedSubmission),
        attempted: latestSubmissions.length > 0,
        latest_submissions: latestSubmissions.map((s) => serializeSubmissionSummary(s)),
      },
    });
  }),
);

router.get(
  '/problems/:id/starter-code',
  asyncHandler(async (req, res) => {
    const problem = await getVisibleProblemOrThrow(req.params.id, req.user);
    const language = req.query.language || 'javascript';
    res.json({
      language,
      starter_code: problem.starter_code?.[language] || '',
    });
  }),
);

router.post(
  '/problems/:id/run',
  asyncHandler(async (req, res) => {
    const { code, language } = req.body;
    if (!code || !language) throw badRequest('Code and language are required');
    if (!code.trim()) throw badRequest('Code cannot be empty');

    const problem = await getVisibleProblemOrThrow(req.params.id, req.user);
    if (!getPracticeLanguages(problem).includes(language)) {
      throw badRequest(`Language "${language}" is not supported for this problem`);
    }

    const rawCases = Array.isArray(req.body.test_cases) && req.body.test_cases.length
      ? req.body.test_cases
      : [{ input: req.body.input || '', output: req.body.expected_output || '' }];
    const customCases = rawCases.slice(0, 5).map((testCase) => ({
      input: String(testCase.input || ''),
      output: String(testCase.output || ''),
      is_sample: true,
    }));
    if (!customCases.length) throw badRequest('At least one custom test case is required');

    const result = await evaluateSubmission(
      code,
      language,
      customCases,
      problem.time_limit,
      problem.memory_limit,
    );

    res.json({
      run: {
        status: result.status,
        passed_test_cases: result.passed_test_cases,
        total_test_cases: customCases.length,
        execution_time_ms: result.execution_time_ms,
        test_results: result.test_results.map((tr) =>
          serializeStudentTestResult(tr, {
            isSample: true,
            status: result.status,
          }),
        ),
      },
    });
  }),
);

router.get(
  '/problems/:id/submissions',
  asyncHandler(async (req, res) => {
    const problem = await getVisibleProblemOrThrow(req.params.id, req.user);
    const submissions = await ProgrammingSubmission.findAll({
      where: {
        problem_id: problem._id,
        student_id: req.user._id,
      },
      order: [['submitted_at', 'DESC']],
      limit: 30,
    });
    const problemsMap = await fetchProblemsMap(submissions.map((s) => s.problem_id));

    res.json({ submissions: submissions.map((s) => serializeSubmissionSummary(s, problemsMap)) });
  }),
);

router.get(
  '/problems/:id/editorial',
  asyncHandler(async (req, res) => {
    const problem = await getVisibleProblemOrThrow(req.params.id, req.user);
    const editorial = await ProgrammingEditorial.findOne({ where: { problem_id: problem._id } });
    res.json({ editorial: serializeEditorial(editorial, problem) });
  }),
);

router.get(
  '/problems/:id/discussions',
  asyncHandler(async (req, res) => {
    const problem = await getVisibleProblemOrThrow(req.params.id, req.user);
    const peerIds = await getInstitutionStudentIds(req.user);
    const discussions = await ProgrammingDiscussion.findAll({
      where: {
        problem_id: problem._id,
        student_id: { [Op.in]: peerIds },
        is_private: true,
      },
      order: [['created_at', 'DESC']],
      limit: 50,
    });

    const studentIds = [...new Set(discussions.map((d) => d.student_id))];
    const students = studentIds.length
      ? await User.findAll({
          where: { _id: { [Op.in]: studentIds } },
          attributes: ['_id', 'name'],
        })
      : [];
    const studentMap = new Map(students.map((s) => [s._id.toString(), s.name]));

    res.json({
      discussions: discussions.map((discussion) => ({
        id: discussion._id.toString(),
        type: discussion.type,
        title: discussion.title,
        body: discussion.body,
        language: discussion.language || '',
        code: discussion.code || '',
        likes: discussion.likes || 0,
        author_name: studentMap.get(discussion.student_id.toString()) || 'Student',
        created_at: discussion.created_at,
        mine: discussion.student_id.toString() === req.user._id.toString(),
      })),
    });
  }),
);

router.post(
  '/problems/:id/discussions',
  asyncHandler(async (req, res) => {
    const problem = await getVisibleProblemOrThrow(req.params.id, req.user);
    const type = req.body.type === 'solution' ? 'solution' : 'discussion';
    const title = String(req.body.title || '').trim();
    const body = String(req.body.body || '').trim();
    if (!title || !body) throw badRequest('Title and body are required');

    const discussion = await ProgrammingDiscussion.create({
      problem_id: problem._id,
      student_id: req.user._id,
      type,
      title: title.slice(0, 120),
      body: body.slice(0, 4000),
      language: String(req.body.language || '').trim(),
      code: String(req.body.code || '').slice(0, 8000),
      is_private: true,
    });

    res.status(201).json({
      discussion: {
        id: discussion._id.toString(),
        type: discussion.type,
        title: discussion.title,
        body: discussion.body,
        language: discussion.language || '',
        code: discussion.code || '',
        likes: discussion.likes || 0,
        author_name: req.user.name || 'Student',
        created_at: discussion.created_at,
        mine: true,
      },
    });
  }),
);

router.post(
  '/problems/:id/submit',
  asyncHandler(async (req, res) => {
    const { code, language } = req.body;
    if (!code || !language) throw badRequest('Code and language are required');
    if (!code.trim()) throw badRequest('Code cannot be empty');

    const problem = await getVisibleProblemOrThrow(req.params.id, req.user);
    if (!getPracticeLanguages(problem).includes(language)) {
      throw badRequest(`Language "${language}" is not supported for this problem`);
    }

    const existing = await ProgrammingSubmission.findOne({
      where: {
        problem_id: problem._id,
        student_id: req.user._id,
        status: { [Op.in]: ['pending', 'running'] },
      },
    });
    if (existing) throw badRequest('You already have a submission in progress');

    const submission = await ProgrammingSubmission.create({
      problem_id: problem._id,
      student_id: req.user._id,
      language,
      code,
      status: 'running',
      total_test_cases: problem.sample_test_cases.length + problem.hidden_test_cases.length,
    });

    try {
      const allTestCases = [
        ...problem.sample_test_cases.map((tc, i) => ({
          ...tc,
          is_sample: true,
        })),
        ...problem.hidden_test_cases.map((tc) => ({
          ...tc,
          is_sample: false,
        })),
      ];

      const result = await evaluateSubmission(
        code,
        language,
        allTestCases,
        problem.time_limit,
        problem.memory_limit,
      );

      submission.status = result.status;
      submission.passed_test_cases = result.passed_test_cases;
      submission.test_results = result.test_results;
      submission.execution_time_ms = result.execution_time_ms;
      await submission.save();

      await ProgrammingProblem.increment(
        {
          total_submissions: 1,
          ...(result.status === 'accepted' ? { total_accepted: 1 } : {}),
        },
        { where: { _id: problem._id } },
      );

      res.json({
        submission: {
          id: submission._id.toString(),
          status: submission.status,
          passed_test_cases: submission.passed_test_cases,
          total_test_cases: submission.total_test_cases,
          execution_time_ms: submission.execution_time_ms,
          test_results: submission.test_results.map((tr) =>
            serializeStudentTestResult(tr, {
              isSample: Boolean(allTestCases[tr.test_case_index]?.is_sample),
              status: submission.status,
            }),
          ),
          submitted_at: submission.submitted_at,
        },
      });
    } catch (error) {
      submission.status = 'runtime_error';
      submission.error_message = sanitizeStudentError(error.message, 'runtime_error') || 'something went wrong while execution please try again';
      await submission.save();
      error.message = submission.error_message;
      throw error;
    }
  }),
);

router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const since = new Date();
    since.setDate(since.getDate() - 180);

    const [submissions, acceptedSubmissions, topicTotals] = await Promise.all([
      ProgrammingSubmission.findAll({
        where: {
          student_id: req.user._id,
          submitted_at: { [Op.gte]: since },
        },
        attributes: ['status', 'submitted_at', 'problem_id'],
      }),
      ProgrammingSubmission.findAll({
        where: {
          student_id: req.user._id,
          status: 'accepted',
        },
        attributes: ['problem_id'],
        raw: true,
      }),
      ProgrammingProblem.findAll({
        where: studentVisibleProblemWhere(req.user),
        attributes: [
          'concept',
          [sequelize.fn('COUNT', sequelize.col('_id')), 'total'],
        ],
        group: ['concept'],
        order: [['concept', 'ASC']],
        raw: true,
      }),
    ]);

    const heatmapMap = new Map();
    for (const submission of submissions) {
      const date = submission.submitted_at.toISOString().slice(0, 10);
      const entry = heatmapMap.get(date) || { date, count: 0, accepted: 0 };
      entry.count += 1;
      if (submission.status === 'accepted') entry.accepted += 1;
      heatmapMap.set(date, entry);
    }

    const acceptedProblemIds = [...new Set(acceptedSubmissions.map((s) => s.problem_id))];
    const solvedProblems = acceptedProblemIds.length
      ? await ProgrammingProblem.findAll({
          where: {
            _id: { [Op.in]: acceptedProblemIds },
            ...studentVisibleProblemWhere(req.user),
          },
          attributes: ['concept', 'difficulty'],
        })
      : [];
    const solvedByTopicMap = new Map();
    const solvedByDifficulty = { Easy: 0, Medium: 0, Hard: 0 };
    for (const problem of solvedProblems) {
      solvedByTopicMap.set(problem.concept, (solvedByTopicMap.get(problem.concept) || 0) + 1);
      solvedByDifficulty[problem.difficulty] = (solvedByDifficulty[problem.difficulty] || 0) + 1;
    }

    const totalProblems = topicTotals.reduce((sum, item) => sum + Number(item.total), 0);
    const solvedCount = solvedProblems.length;

    res.json({
      totals: {
        solved: solvedCount,
        total: totalProblems,
        submissions: submissions.length,
        completion_rate: totalProblems ? Math.round((solvedCount / totalProblems) * 100) : 0,
      },
      heatmap: [...heatmapMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
      solved_by_topic: topicTotals.map((item) => ({
        concept: item.concept,
        solved: solvedByTopicMap.get(item.concept) || 0,
        total: Number(item.total),
        percent: Number(item.total) ? Math.round(((solvedByTopicMap.get(item.concept) || 0) / Number(item.total)) * 100) : 0,
      })),
      solved_by_difficulty: solvedByDifficulty,
    });
  }),
);

router.get(
  '/challenges/current',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const acceptedSubmissions = await ProgrammingSubmission.findAll({
      where: { student_id: req.user._id, status: 'accepted' },
      attributes: ['problem_id'],
      raw: true,
    });
    const solvedProblemIds = [...new Set(acceptedSubmissions.map((s) => s.problem_id))];
    const solvedSet = new Set(solvedProblemIds.map((id) => id.toString()));
    const challenges = await ProgrammingChallenge.findAll({
      where: {
        status: 'published',
        starts_at: { [Op.lte]: now },
        ends_at: { [Op.gte]: now },
      },
      order: [['starts_at', 'DESC']],
    });

    const challengeProblemIds = [...new Set(challenges.map((c) => c.problem_id).filter(Boolean))];
    const problems = challengeProblemIds.length
      ? await ProgrammingProblem.findAll({ where: { _id: { [Op.in]: challengeProblemIds } } })
      : [];
    const problemsMap = new Map(problems.map((p) => [p._id.toString(), p]));

    const activeByType = {};
    for (const challenge of challenges) {
      const problem = problemsMap.get(challenge.problem_id.toString());
      if (activeByType[challenge.type] || !canStudentSeeProblem(problem, req.user)) {
        continue;
      }
      activeByType[challenge.type] = serializeChallenge(challenge, problem, solvedSet);
    }

    res.json({
      daily: activeByType.daily || await getFallbackChallenge('daily', solvedSet, req.user),
      weekly: activeByType.weekly || await getFallbackChallenge('weekly', solvedSet, req.user),
    });
  }),
);

router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const peerIds = await getInstitutionStudentIds(req.user);
    const [students, submissions] = await Promise.all([
      User.findAll({
        where: { _id: { [Op.in]: peerIds } },
        attributes: ['_id', 'name', 'email'],
      }),
      ProgrammingSubmission.findAll({
        where: { student_id: { [Op.in]: peerIds } },
        attributes: ['student_id', 'problem_id', 'status', 'execution_time_ms', 'submitted_at'],
        order: [['submitted_at', 'DESC']],
      }),
    ]);

    const stats = new Map();
    for (const student of students) {
      stats.set(student._id.toString(), {
        student_id: student._id.toString(),
        student_name: student.name,
        student_email: student.email,
        solved_set: new Set(),
        total_submissions: 0,
        accepted_submissions: 0,
        latest_submission_at: null,
        points: 0,
      });
    }

    for (const submission of submissions) {
      const key = submission.student_id.toString();
      const row = stats.get(key);
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

    const rows = [...stats.values()]
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

    res.json({ leaderboard: rows.slice(0, 100) });
  }),
);

router.get(
  '/contests/current',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const contests = await ProgrammingContest.findAll({
      where: {
        status: 'published',
        starts_at: { [Op.lte]: now },
        ends_at: { [Op.gte]: now },
        [Op.or]: [
          { institution_id: req.user.assigned_admin || null },
          { institution_id: null },
        ],
      },
      order: [['starts_at', 'DESC']],
      limit: 5,
    });

    const allProblemIds = [...new Set(contests.flatMap((c) => c.problem_ids || []))];
    const allProblems = allProblemIds.length
      ? await ProgrammingProblem.findAll({ where: { _id: { [Op.in]: allProblemIds } } })
      : [];
    const problemsMap = new Map(allProblems.map((p) => [p._id.toString(), p]));

    res.json({
      contests: contests.map((contest) => ({
        id: contest._id.toString(),
        title: contest.title,
        description: contest.description || '',
        starts_at: contest.starts_at,
        ends_at: contest.ends_at,
        problems: (contest.problem_ids || [])
          .map((pid) => problemsMap.get(pid.toString()))
          .filter(Boolean)
          .filter((problem) => canStudentSeeProblem(problem, req.user))
          .map(serializeProblem),
      })),
    });
  }),
);

router.get(
  '/contests/:id/leaderboard',
  asyncHandler(async (req, res) => {
    const contest = await ProgrammingContest.findByPk(req.params.id);
    if (!contest || contest.status !== 'published') throw notFound('Contest not found');
    if (
      contest.institution_id
      && req.user.assigned_admin
      && contest.institution_id.toString() !== req.user.assigned_admin.toString()
    ) {
      throw forbidden();
    }

    const peerIds = await getInstitutionStudentIds(req.user);
    const submissions = await ProgrammingSubmission.findAll({
      where: {
        student_id: { [Op.in]: peerIds },
        problem_id: { [Op.in]: contest.problem_ids },
        submitted_at: { [Op.gte]: contest.starts_at, [Op.lte]: contest.ends_at },
      },
      attributes: ['student_id', 'problem_id', 'status', 'submitted_at'],
    });
    const students = await User.findAll({
      where: { _id: { [Op.in]: peerIds } },
      attributes: ['_id', 'name', 'email'],
    });
    const studentMap = new Map(students.map((student) => [student._id.toString(), student]));
    const stats = new Map();

    for (const submission of submissions) {
      const key = submission.student_id.toString();
      const row = stats.get(key) || {
        student_id: key,
        solved_set: new Set(),
        total_submissions: 0,
        accepted_submissions: 0,
        latest_submission_at: null,
      };
      row.total_submissions += 1;
      if (submission.status === 'accepted') {
        row.accepted_submissions += 1;
        row.solved_set.add(submission.problem_id.toString());
      }
      if (!row.latest_submission_at || submission.submitted_at > row.latest_submission_at) {
        row.latest_submission_at = submission.submitted_at;
      }
      stats.set(key, row);
    }

    const leaderboard = [...stats.values()]
      .map((row) => ({
        student_id: row.student_id,
        student_name: studentMap.get(row.student_id)?.name || 'Student',
        student_email: studentMap.get(row.student_id)?.email || '',
        solved: row.solved_set.size,
        total_submissions: row.total_submissions,
        accepted_submissions: row.accepted_submissions,
        latest_submission_at: row.latest_submission_at,
        points: row.solved_set.size * 100 + row.accepted_submissions * 5,
      }))
      .sort((a, b) => b.points - a.points || b.solved - a.solved || a.total_submissions - b.total_submissions)
      .map((row, index) => ({ ...row, rank: index + 1 }));

    res.json({ contest_id: contest._id.toString(), leaderboard });
  }),
);

router.get(
  '/submissions',
  asyncHandler(async (req, res) => {
    const { problem_id, page = 1, limit = 20 } = req.query;
    const where = { student_id: req.user._id };
    if (problem_id) where.problem_id = problem_id;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [submissions, total] = await Promise.all([
      ProgrammingSubmission.findAll({
        where,
        order: [['submitted_at', 'DESC']],
        offset: skip,
        limit: limitNum,
      }),
      ProgrammingSubmission.count({ where }),
    ]);
    const problemsMap = await fetchProblemsMap(submissions.map((s) => s.problem_id));

    res.json({
      submissions: submissions.map((s) => serializeSubmissionSummary(s, problemsMap)),
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
    if (submission.student_id.toString() !== req.user._id.toString()) throw forbidden();

    const problem = await ProgrammingProblem.findByPk(submission.problem_id);
    const totalTestCases = (problem?.sample_test_cases?.length || 0) + (problem?.hidden_test_cases?.length || 0);

    res.json({
      submission: {
        id: submission._id.toString(),
        problem_id: problem?._id?.toString() || '',
        problem_title: problem?.title || 'Unknown Problem',
        problem_difficulty: problem?.difficulty || '',
        problem_concept: problem?.concept || '',
        language: submission.language,
        code: submission.code,
        status: submission.status,
        passed_test_cases: submission.passed_test_cases,
        total_test_cases: totalTestCases,
        test_results: submission.test_results.map((tr) =>
          serializeStudentTestResult(tr, {
            isSample: tr.test_case_index < (problem?.sample_test_cases?.length || 0),
            status: submission.status,
          }),
        ),
        execution_time_ms: submission.execution_time_ms,
        error_message: sanitizeStudentSubmissionError(submission.error_message, submission.status),
        submitted_at: submission.submitted_at,
      },
    });
  }),
);

export default router;
