import express from 'express';
import { requireAuth, requireModuleAccess, requireRole } from '../../aptitude/middleware/auth.js';
import { User } from '../../aptitude/models/User.js';
import { ProgrammingChallenge } from '../models/ProgrammingChallenge.js';
import { ProgrammingContest } from '../models/ProgrammingContest.js';
import { ProgrammingDiscussion } from '../models/ProgrammingDiscussion.js';
import { ProgrammingEditorial } from '../models/ProgrammingEditorial.js';
import { ProgrammingProblem } from '../models/ProgrammingProblem.js';
import { ProgrammingSubmission } from '../models/ProgrammingSubmission.js';
import { evaluateSubmission } from '../services/executionService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';
import {
  sanitizeStudentSubmissionError,
  serializeStudentTestResult,
} from '../utils/studentResultSerializer.js';
import { DEFAULT_PRACTICE_LANGUAGES, LANGUAGE_IDS } from '../utils/constants.js';
import {
  isVisibleProblemTitle,
  visibleProblemTitleFilter,
} from '../utils/problemVisibility.js';

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

function studentProblemPrivacyFilter(user, prefix = '') {
  const field = (name) => (prefix ? `${prefix}.${name}` : name);
  if (!user.assigned_admin) {
    return { [field('is_private_bank')]: { $ne: true } };
  }
  return {
    $or: [
      { [field('is_private_bank')]: { $ne: true } },
      { [field('institution_id')]: user.assigned_admin },
    ],
  };
}

function studentVisibleProblemFilter(user, extra = {}, prefix = '') {
  return {
    ...extra,
    ...visibleProblemTitleFilter(prefix ? `${prefix}.title` : 'title'),
    ...studentProblemPrivacyFilter(user, prefix),
  };
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
  const problem = await ProgrammingProblem.findById(id);
  if (!canStudentSeeProblem(problem, user)) {
    throw notFound('Problem not found');
  }
  return problem;
}

function serializeSubmissionSummary(submission) {
  const problem = submission.problem_id;
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
  if (typeof value.toObject === 'function') return value.toObject();
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
  const peers = await User.find({
    role: 'student',
    assigned_admin: user.assigned_admin,
    is_active: { $ne: false },
  }).select('_id');
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
  const count = await ProgrammingProblem.countDocuments(studentVisibleProblemFilter(user, {
    status: 'published',
    is_deleted: { $ne: true },
    is_auto_gradable: { $ne: false },
  }));
  if (!count) return null;
  const now = new Date();
  const dayNumber = Math.floor(now.getTime() / 86400000);
  const index = type === 'weekly'
    ? Math.floor(dayNumber / 7) % count
    : dayNumber % count;
  const [problem] = await ProgrammingProblem.find(studentVisibleProblemFilter(user, {
    status: 'published',
    is_deleted: { $ne: true },
    is_auto_gradable: { $ne: false },
  }))
    .sort({ curriculum_order: 1, topic_rank: 1, created_at: 1 })
    .skip(index)
    .limit(1);
  return serializeChallenge({ type, title: type === 'weekly' ? 'Weekly Challenge' : 'Daily Challenge' }, problem, solvedSet);
}

router.get(
  '/concepts',
  asyncHandler(async (req, res) => {
    const [result, solvedResult] = await Promise.all([
      ProgrammingProblem.aggregate([
        {
          $match: studentVisibleProblemFilter(req.user, {
            status: 'published',
            is_deleted: { $ne: true },
            is_auto_gradable: { $ne: false },
          }),
        },
        {
          $group: {
            _id: '$concept',
            count: { $sum: 1 },
            minCurriculumOrder: { $min: '$curriculum_order' },
            minDifficultyRank: { $min: '$difficulty_rank' },
          },
        },
        { $sort: { minCurriculumOrder: 1, minDifficultyRank: 1, _id: 1 } },
        {
          $project: {
            _id: 0,
            concept: '$_id',
            count: 1,
          },
        },
      ]),
      ProgrammingSubmission.aggregate([
        {
          $match: {
            student_id: req.user._id,
            status: 'accepted',
          },
        },
        {
          $group: {
            _id: '$problem_id',
          },
        },
        {
          $lookup: {
            from: 'programmingproblems',
            localField: '_id',
            foreignField: '_id',
            as: 'problem',
          },
        },
        { $unwind: '$problem' },
        {
          $match: {
            'problem.status': 'published',
            'problem.is_deleted': { $ne: true },
            'problem.is_auto_gradable': { $ne: false },
            ...visibleProblemTitleFilter('problem.title'),
            ...studentProblemPrivacyFilter(req.user, 'problem'),
          },
        },
        {
          $group: {
            _id: '$problem.concept',
            solved: { $sum: 1 },
          },
        },
      ]),
    ]);

    const concepts = result.map((r) => r.concept);
    const counts = {};
    const solved_counts = {};
    const progress = {};

    result.forEach((r) => {
      counts[r.concept] = r.count;
    });

    solvedResult.forEach((r) => {
      solved_counts[r._id] = r.solved;
    });

    concepts.forEach((concept) => {
      const total = counts[concept] || 0;
      const solved = solved_counts[concept] || 0;
      progress[concept] = total ? Math.round((solved / total) * 100) : 0;
    });

    res.json({ concepts, counts, solved_counts, progress });
  }),
);

router.get(
  '/problems',
  asyncHandler(async (req, res) => {
    const { difficulty, concept, tag, company, solved, page = 1, limit = 20 } = req.query;
    const filter = studentVisibleProblemFilter(req.user, {
      status: 'published',
      is_deleted: { $ne: true },
      is_auto_gradable: { $ne: false },
    });
    if (difficulty) filter.difficulty = difficulty;
    if (concept) filter.concept = concept;
    if (tag) filter.tags = tag;
    if (company) filter.company_tags = company;

    const [solvedProblemIds, attemptedProblemIds] = await Promise.all([
      ProgrammingSubmission.distinct('problem_id', {
        student_id: req.user._id,
        status: 'accepted',
      }),
      ProgrammingSubmission.distinct('problem_id', {
        student_id: req.user._id,
      }),
    ]);
    if (solved === 'true') filter._id = { $in: solvedProblemIds };
    if (solved === 'false') filter._id = { $nin: solvedProblemIds };

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [problems, total, filters] = await Promise.all([
      ProgrammingProblem.find(filter)
        .sort({ difficulty_rank: 1, curriculum_order: 1, topic_rank: 1, created_at: 1 })
        .skip(skip)
        .limit(limitNum),
      ProgrammingProblem.countDocuments(filter),
      ProgrammingProblem.aggregate([
        {
          $match: studentVisibleProblemFilter(req.user, {
            status: 'published',
            is_deleted: { $ne: true },
            is_auto_gradable: { $ne: false },
          }),
        },
        {
          $group: {
            _id: null,
            tags: { $addToSet: '$tags' },
            company_tags: { $addToSet: '$company_tags' },
          },
        },
      ]),
    ]);
    const solvedSet = new Set(solvedProblemIds.map((id) => id.toString()));
    const attemptedSet = new Set(attemptedProblemIds.map((id) => id.toString()));
    const filterMeta = filters[0] || {};

    res.json({
      problems: problems.map((problem) => ({
        ...serializeProblem(problem),
        solved: solvedSet.has(problem._id.toString()),
        attempted: attemptedSet.has(problem._id.toString()),
      })),
      filters: {
        tags: [...new Set((filterMeta.tags || []).flat().filter(Boolean))].sort(),
        company_tags: [...new Set((filterMeta.company_tags || []).flat().filter(Boolean))].sort(),
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
    const [solved, latestSubmissions] = await Promise.all([
      ProgrammingSubmission.exists({
        problem_id: problem._id,
        student_id: req.user._id,
        status: 'accepted',
      }),
      ProgrammingSubmission.find({
        problem_id: problem._id,
        student_id: req.user._id,
      })
        .sort({ submitted_at: -1 })
        .limit(5),
    ]);
    res.json({
      problem: {
        ...serializeProblemDetail(problem),
        solved: Boolean(solved),
        attempted: latestSubmissions.length > 0,
        latest_submissions: latestSubmissions.map(serializeSubmissionSummary),
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
    const submissions = await ProgrammingSubmission.find({
      problem_id: problem._id,
      student_id: req.user._id,
    })
      .sort({ submitted_at: -1 })
      .limit(30)
      .populate('problem_id', 'title difficulty concept');

    res.json({ submissions: submissions.map(serializeSubmissionSummary) });
  }),
);

router.get(
  '/problems/:id/editorial',
  asyncHandler(async (req, res) => {
    const problem = await getVisibleProblemOrThrow(req.params.id, req.user);
    const editorial = await ProgrammingEditorial.findOne({ problem_id: problem._id });
    res.json({ editorial: serializeEditorial(editorial, problem) });
  }),
);

router.get(
  '/problems/:id/discussions',
  asyncHandler(async (req, res) => {
    const problem = await getVisibleProblemOrThrow(req.params.id, req.user);
    const peerIds = await getInstitutionStudentIds(req.user);
    const discussions = await ProgrammingDiscussion.find({
      problem_id: problem._id,
      student_id: { $in: peerIds },
      is_private: true,
    })
      .sort({ created_at: -1 })
      .limit(50)
      .populate('student_id', 'name');

    res.json({
      discussions: discussions.map((discussion) => ({
        id: discussion._id.toString(),
        type: discussion.type,
        title: discussion.title,
        body: discussion.body,
        language: discussion.language || '',
        code: discussion.code || '',
        likes: discussion.likes || 0,
        author_name: discussion.student_id?.name || 'Student',
        created_at: discussion.created_at,
        mine: discussion.student_id?._id?.toString() === req.user._id.toString(),
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
      problem_id: problem._id,
      student_id: req.user._id,
      status: { $in: ['pending', 'running'] },
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
          ...tc.toObject(),
          is_sample: true,
        })),
        ...problem.hidden_test_cases.map((tc) => ({
          ...tc.toObject(),
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

      await ProgrammingProblem.findByIdAndUpdate(problem._id, {
        $inc: { total_submissions: 1 },
        ...(result.status === 'accepted' ? { total_accepted: 1 } : {}),
      });

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
      submission.error_message = error.message;
      await submission.save();
      throw error;
    }
  }),
);

router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const since = new Date();
    since.setDate(since.getDate() - 180);

    const [submissions, acceptedProblemIds, topicTotals] = await Promise.all([
      ProgrammingSubmission.find({
        student_id: req.user._id,
        submitted_at: { $gte: since },
      }).select('status submitted_at problem_id'),
      ProgrammingSubmission.distinct('problem_id', {
        student_id: req.user._id,
        status: 'accepted',
      }),
      ProgrammingProblem.aggregate([
        {
          $match: studentVisibleProblemFilter(req.user, {
            status: 'published',
            is_deleted: { $ne: true },
            is_auto_gradable: { $ne: false },
          }),
        },
        { $group: { _id: '$concept', total: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const heatmapMap = new Map();
    for (const submission of submissions) {
      const date = submission.submitted_at.toISOString().slice(0, 10);
      const entry = heatmapMap.get(date) || { date, count: 0, accepted: 0 };
      entry.count += 1;
      if (submission.status === 'accepted') entry.accepted += 1;
      heatmapMap.set(date, entry);
    }

    const solvedProblems = await ProgrammingProblem.find({
      _id: { $in: acceptedProblemIds },
      status: 'published',
      is_deleted: { $ne: true },
      is_auto_gradable: { $ne: false },
    }).select('concept difficulty tags');
    const solvedByTopicMap = new Map();
    const solvedByDifficulty = { Easy: 0, Medium: 0, Hard: 0 };
    for (const problem of solvedProblems) {
      solvedByTopicMap.set(problem.concept, (solvedByTopicMap.get(problem.concept) || 0) + 1);
      solvedByDifficulty[problem.difficulty] = (solvedByDifficulty[problem.difficulty] || 0) + 1;
    }

    const totalProblems = topicTotals.reduce((sum, item) => sum + item.total, 0);
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
        concept: item._id,
        solved: solvedByTopicMap.get(item._id) || 0,
        total: item.total,
        percent: item.total ? Math.round(((solvedByTopicMap.get(item._id) || 0) / item.total) * 100) : 0,
      })),
      solved_by_difficulty: solvedByDifficulty,
    });
  }),
);

router.get(
  '/challenges/current',
  asyncHandler(async (req, res) => {
    const now = new Date();
    const solvedProblemIds = await ProgrammingSubmission.distinct('problem_id', {
      student_id: req.user._id,
      status: 'accepted',
    });
    const solvedSet = new Set(solvedProblemIds.map((id) => id.toString()));
    const challenges = await ProgrammingChallenge.find({
      status: 'published',
      starts_at: { $lte: now },
      ends_at: { $gte: now },
    })
      .sort({ starts_at: -1 })
      .populate('problem_id');

    const activeByType = {};
    for (const challenge of challenges) {
      const problem = challenge.problem_id;
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
      User.find({ _id: { $in: peerIds } }).select('name email'),
      ProgrammingSubmission.find({ student_id: { $in: peerIds } })
        .select('student_id problem_id status execution_time_ms submitted_at')
        .sort({ submitted_at: -1 }),
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
    const contests = await ProgrammingContest.find({
      status: 'published',
      starts_at: { $lte: now },
      ends_at: { $gte: now },
      $or: [
        { institution_id: req.user.assigned_admin || null },
        { institution_id: null },
      ],
    })
      .sort({ starts_at: -1 })
      .limit(5)
      .populate('problem_ids', 'title difficulty concept tags company_tags total_submissions total_accepted sample_test_cases time_limit memory_limit languages');

    res.json({
      contests: contests.map((contest) => ({
        id: contest._id.toString(),
        title: contest.title,
        description: contest.description || '',
        starts_at: contest.starts_at,
        ends_at: contest.ends_at,
        problems: (contest.problem_ids || [])
          .filter((problem) => canStudentSeeProblem(problem, req.user))
          .map(serializeProblem),
      })),
    });
  }),
);

router.get(
  '/contests/:id/leaderboard',
  asyncHandler(async (req, res) => {
    const contest = await ProgrammingContest.findById(req.params.id);
    if (!contest || contest.status !== 'published') throw notFound('Contest not found');
    if (
      contest.institution_id
      && req.user.assigned_admin
      && contest.institution_id.toString() !== req.user.assigned_admin.toString()
    ) {
      throw forbidden();
    }

    const peerIds = await getInstitutionStudentIds(req.user);
    const submissions = await ProgrammingSubmission.find({
      student_id: { $in: peerIds },
      problem_id: { $in: contest.problem_ids },
      submitted_at: { $gte: contest.starts_at, $lte: contest.ends_at },
    }).select('student_id problem_id status submitted_at');
    const students = await User.find({ _id: { $in: peerIds } }).select('name email');
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
    const filter = { student_id: req.user._id };
    if (problem_id) filter.problem_id = problem_id;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const [submissions, total] = await Promise.all([
      ProgrammingSubmission.find(filter)
        .sort({ submitted_at: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate('problem_id', 'title difficulty concept'),
      ProgrammingSubmission.countDocuments(filter),
    ]);

    res.json({
      submissions: submissions.map(serializeSubmissionSummary),
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
      .populate('problem_id', 'title difficulty concept sample_test_cases hidden_test_cases time_limit');

    if (!submission) throw notFound('Submission not found');
    if (submission.student_id.toString() !== req.user._id.toString()) throw forbidden();

    const problem = submission.problem_id;
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
