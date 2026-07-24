import express from 'express';
import { requireAuth, requireRole } from '../../aptitude/middleware/auth.js';
import { ROLES } from '../../aptitude/utils/roles.js';
import { ProgrammingAssessment, ProgrammingAssessmentProblem, ProgrammingAssessmentAttempt, ProgrammingAssessmentAnswer, User, Op } from '../../database/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { DEFAULT_PRACTICE_LANGUAGES, LANGUAGE_IDS, LANGUAGES } from '../utils/constants.js';

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.MASTER_ADMIN));

function buildStarterCode(input = {}) {
  return Object.fromEntries(LANGUAGES.map((language) => [language.id, input?.[language.id] || '']));
}

function normalizeLanguages(languages) {
  if (!Array.isArray(languages)) return DEFAULT_PRACTICE_LANGUAGES;
  const selected = languages.filter((language) => LANGUAGE_IDS.includes(language));
  return selected.length ? selected : DEFAULT_PRACTICE_LANGUAGES;
}

router.get(
  '/assessments',
  asyncHandler(async (req, res) => {
    const assessments = await ProgrammingAssessment.findAll({
      where: { is_deleted: { [Op.ne]: true } },
      order: [['created_at', 'DESC']],
    });

    const creatorIds = [...new Set(assessments.map((a) => a.created_by).filter(Boolean))];
    const creators = creatorIds.length > 0
      ? await User.findAll({
          where: { _id: { [Op.in]: creatorIds } },
          attributes: ['_id', 'name', 'email'],
        })
      : [];
    const creatorMap = {};
    for (const c of creators) {
      creatorMap[c._id] = c;
    }

    const result = await Promise.all(
      assessments.map(async (a) => {
        const problemCount = await ProgrammingAssessmentProblem.count({ where: { assessment_id: a._id } });
        const attemptCount = await ProgrammingAssessmentAttempt.count({ where: { assessment_id: a._id } });
        const creator = creatorMap[a.created_by];
        return {
          id: a._id.toString(),
          title: a.title,
          description: a.description,
          status: a.status,
          created_by: creator
            ? { id: creator._id.toString(), name: creator.name, email: creator.email }
            : null,
          problem_count: problemCount,
          attempt_count: attemptCount,
          created_at: a.created_at,
        };
      }),
    );

    res.json({ assessments: result });
  }),
);

router.post(
  '/assessments',
  asyncHandler(async (req, res) => {
    const { title, description, status, created_by } = req.body;
    if (!title || !title.trim()) throw badRequest('Title is required');

    const assessment = await ProgrammingAssessment.create({
      title: title.trim(),
      description: description || '',
      status: status || 'draft',
      created_by: created_by || req.user._id,
    });

    res.status(201).json({
      assessment: {
        id: assessment._id.toString(),
        title: assessment.title,
        description: assessment.description,
        status: assessment.status,
        created_at: assessment.created_at,
      },
    });
  }),
);

router.get(
  '/assessments/:id',
  asyncHandler(async (req, res) => {
    const assessment = await ProgrammingAssessment.findByPk(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');

    const problems = await ProgrammingAssessmentProblem.findAll({
      where: { assessment_id: assessment._id },
      order: [['order', 'ASC']],
    });

    res.json({
      assessment: {
        id: assessment._id.toString(),
        title: assessment.title,
        description: assessment.description,
        status: assessment.status,
        created_at: assessment.created_at,
      },
      problems: problems.map((p) => ({
        id: p._id.toString(),
        ...p,
      })),
    });
  }),
);

router.patch(
  '/assessments/:id',
  asyncHandler(async (req, res) => {
    const { title, description, status } = req.body;
    const assessment = await ProgrammingAssessment.findByPk(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');

    if (title !== undefined) assessment.title = title.trim();
    if (description !== undefined) assessment.description = description;
    if (status !== undefined) assessment.status = status;
    await assessment.save();

    res.json({
      assessment: {
        id: assessment._id.toString(),
        title: assessment.title,
        description: assessment.description,
        status: assessment.status,
      },
    });
  }),
);

router.patch(
  '/assessments/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['draft', 'published'].includes(status)) throw badRequest('Invalid status');

    const assessment = await ProgrammingAssessment.findByPk(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');

    const problemCount = await ProgrammingAssessmentProblem.count({ where: { assessment_id: assessment._id } });
    if (status === 'published' && problemCount === 0) {
      throw badRequest('Cannot publish an assessment with no problems');
    }

    assessment.status = status;
    await assessment.save();

    res.json({
      assessment: {
        id: assessment._id.toString(),
        title: assessment.title,
        status: assessment.status,
      },
    });
  }),
);

router.delete(
  '/assessments/:id',
  asyncHandler(async (req, res) => {
    const assessment = await ProgrammingAssessment.findByPk(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');

    assessment.is_deleted = true;
    assessment.deleted_at = new Date();
    await assessment.save();

    res.json({ message: 'Assessment deleted' });
  }),
);

router.put(
  '/assessments/:id/problems',
  asyncHandler(async (req, res) => {
    const { problems } = req.body;
    if (!Array.isArray(problems)) throw badRequest('Problems must be an array');

    const assessment = await ProgrammingAssessment.findByPk(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');

    await ProgrammingAssessmentProblem.destroy({ where: { assessment_id: assessment._id } });

    const created = await ProgrammingAssessmentProblem.bulkCreate(
      problems.map((p, i) => ({
        assessment_id: assessment._id,
        title: p.title,
        description: p.description,
        constraints: p.constraints || '',
        input_format: p.input_format || '',
        output_format: p.output_format || '',
        difficulty: p.difficulty || 'Easy',
        concept: p.concept || 'General',
        marks: p.marks || 10,
        sample_test_cases: p.sample_test_cases || [],
        hidden_test_cases: p.hidden_test_cases || [],
        time_limit: p.time_limit || 2,
        memory_limit: p.memory_limit || 256,
        languages: normalizeLanguages(p.languages),
        starter_code: buildStarterCode(p.starter_code),
        order: i,
      })),
    );

    res.json({
      problems: created.map((p) => ({
        id: p._id.toString(),
        title: p.title,
        marks: p.marks,
        order: p.order,
      })),
    });
  }),
);

router.get(
  '/assessments/:id/results',
  asyncHandler(async (req, res) => {
    const assessment = await ProgrammingAssessment.findByPk(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');

    const attempts = await ProgrammingAssessmentAttempt.findAll({
      where: { assessment_id: assessment._id },
      order: [['submitted_at', 'DESC']],
    });

    const userIds = [...new Set(attempts.map((a) => a.student_id).filter(Boolean))];
    const users = userIds.length > 0
      ? await Student.findAll({
          where: { _id: { [Op.in]: userIds } },
          attributes: ['_id', 'name', 'email'],
        })
      : [];
    const userMap = {};
    for (const u of users) {
      userMap[u._id] = u;
    }

    res.json({
      assessment: {
        id: assessment._id.toString(),
        title: assessment.title,
      },
      results: attempts.map((a) => {
        const user = userMap[a.student_id];
        return {
          id: a._id.toString(),
          student_id: a.student_id?.toString() || '',
          student_name: user?.name || 'Unknown',
          student_email: user?.email || '',
          status: a.status,
          total_marks: a.total_marks,
          obtained_marks: a.obtained_marks,
          percentage: a.total_marks > 0
            ? Math.round((a.obtained_marks / a.total_marks) * 100)
            : 0,
          started_at: a.started_at,
          submitted_at: a.submitted_at,
        };
      }),
    });
  }),
);

router.get(
  '/analytics',
  asyncHandler(async (req, res) => {
    const assessments = await ProgrammingAssessment.findAll({
      where: { is_deleted: { [Op.ne]: true } },
    });

    const assessmentIds = assessments.map((a) => a._id);
    const attempts = await ProgrammingAssessmentAttempt.findAll({
      where: {
        assessment_id: { [Op.in]: assessmentIds },
        status: 'submitted',
      },
      order: [['submitted_at', 'DESC']],
    });

    const studentIds = [...new Set(attempts.map((a) => a.student_id).filter(Boolean))];
    const users = studentIds.length > 0
      ? await Student.findAll({
          where: { _id: { [Op.in]: studentIds } },
          attributes: ['_id', 'name', 'email'],
        })
      : [];
    const userMap = {};
    for (const u of users) {
      userMap[u._id] = u;
    }

    const studentMap = {};
    for (const a of attempts) {
      const sid = a.student_id?.toString();
      if (!sid) continue;
      const user = userMap[sid];
      if (!studentMap[sid]) {
        studentMap[sid] = {
          student_id: sid,
          student_name: user?.name || 'Unknown',
          student_email: user?.email || '',
          total_assessments: 0,
          total_marks: 0,
          obtained_marks: 0,
        };
      }
      studentMap[sid].total_assessments += 1;
      studentMap[sid].total_marks += a.total_marks || 0;
      studentMap[sid].obtained_marks += a.obtained_marks || 0;
    }

    const students = Object.values(studentMap).map((s) => ({
      ...s,
      percentage: s.total_marks > 0
        ? Math.round((s.obtained_marks / s.total_marks) * 100)
        : 0,
    }));

    res.json({
      total_assessments: assessments.length,
      total_attempts: attempts.length,
      total_students: students.length,
      students,
    });
  }),
);

export default router;
