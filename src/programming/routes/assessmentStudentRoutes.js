import express from 'express';
import { requireAuth, requireModuleAccess, requireRole } from '../../aptitude/middleware/auth.js';
import { ProgrammingAssessment, ProgrammingAssessmentProblem, ProgrammingAssessmentAttempt, ProgrammingAssessmentAnswer, Op } from '../../database/index.js';
import { evaluateSubmission } from '../services/executionService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';
import { serializeStudentTestResult } from '../utils/studentResultSerializer.js';

const router = express.Router();

router.use(requireAuth, requireRole('student', 'individual_student'), requireModuleAccess('programming'));

router.get(
  '/assessments',
  asyncHandler(async (req, res) => {
    const assessments = await ProgrammingAssessment.findAll({
      where: {
        status: 'published',
        is_deleted: { [Op.ne]: true },
      },
      order: [['created_at', 'DESC']],
    });

    const result = await Promise.all(
      assessments.map(async (a) => {
        const problemCount = await ProgrammingAssessmentProblem.count({ where: { assessment_id: a._id } });
        const existingAttempt = await ProgrammingAssessmentAttempt.findOne({
          where: { assessment_id: a._id, student_id: req.user._id },
        });
        return {
          id: a._id.toString(),
          title: a.title,
          description: a.description,
          problem_count: problemCount,
          status: a.status,
          attempt: existingAttempt
            ? {
                id: existingAttempt._id.toString(),
                status: existingAttempt.status,
                obtained_marks: existingAttempt.obtained_marks,
                total_marks: existingAttempt.total_marks,
                started_at: existingAttempt.started_at,
                submitted_at: existingAttempt.submitted_at,
              }
            : null,
          created_at: a.created_at,
        };
      }),
    );

    res.json({ assessments: result });
  }),
);

router.post(
  '/assessments/:id/start',
  asyncHandler(async (req, res) => {
    const assessment = await ProgrammingAssessment.findByPk(req.params.id);
    if (!assessment || assessment.is_deleted || assessment.status !== 'published') {
      throw notFound('Assessment not found');
    }

    let attempt = await ProgrammingAssessmentAttempt.findOne({
      where: { assessment_id: assessment._id, student_id: req.user._id },
    });

    if (!attempt) {
      const problems = await ProgrammingAssessmentProblem.findAll({
        where: { assessment_id: assessment._id },
        order: [['order', 'ASC']],
      });

      if (problems.length === 0) throw badRequest('This assessment has no problems');

      const totalMarks = problems.reduce((sum, p) => sum + (p.marks || 0), 0);

      attempt = await ProgrammingAssessmentAttempt.create({
        assessment_id: assessment._id,
        student_id: req.user._id,
        total_marks: totalMarks,
        status: 'in_progress',
      });
    }

    if (attempt.status === 'submitted') {
      throw badRequest('You have already submitted this assessment');
    }

    const problems = await ProgrammingAssessmentProblem.findAll({
      where: { assessment_id: assessment._id },
      order: [['order', 'ASC']],
    });

    const existingAnswers = await ProgrammingAssessmentAnswer.findAll({ where: { attempt_id: attempt._id } });
    const answerMap = {};
    for (const ans of existingAnswers) {
      answerMap[ans.problem_id.toString()] = ans;
    }

    const serialized = problems.map((p) => {
      const answer = answerMap[p._id.toString()];
      const sampleTestCases = p.sample_test_cases.map((tc, i) => ({
        index: i,
        input: tc.input,
        output: tc.output,
        explanation: tc.explanation,
      }));
      return {
        id: p._id.toString(),
        title: p.title,
        description: p.description,
        constraints: p.constraints,
        input_format: p.input_format,
        output_format: p.output_format,
        difficulty: p.difficulty,
        concept: p.concept,
        marks: p.marks,
        order: p.order,
        sample_test_cases: sampleTestCases,
        time_limit: p.time_limit,
        memory_limit: p.memory_limit,
        languages: p.languages,
        starter_code: p.starter_code,
        answer: answer
          ? {
              code: answer.code,
              language: answer.language,
              status: answer.status,
            }
          : null,
      };
    });

    res.json({
      attempt: {
        id: attempt._id.toString(),
        assessment_id: attempt.assessment_id.toString(),
        status: attempt.status,
        started_at: attempt.started_at,
        total_marks: attempt.total_marks,
      },
      assessment: {
        id: assessment._id.toString(),
        title: assessment.title,
        description: assessment.description,
      },
      problems: serialized,
    });
  }),
);

router.put(
  '/attempts/:attemptId/answers/:problemId',
  asyncHandler(async (req, res) => {
    const { code, language } = req.body;
    if (!code) throw badRequest('Code is required');

    const attempt = await ProgrammingAssessmentAttempt.findByPk(req.params.attemptId);
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.student_id.toString() !== req.user._id.toString()) throw forbidden();
    if (attempt.status === 'submitted') throw badRequest('Assessment already submitted');

    const problem = await ProgrammingAssessmentProblem.findByPk(req.params.problemId);
    if (!problem) throw notFound('Problem not found');
    if (problem.assessment_id.toString() !== attempt.assessment_id.toString()) {
      throw badRequest('Problem does not belong to this assessment');
    }

    if (language && !problem.languages.includes(language)) {
      throw badRequest(`Language "${language}" not supported for this problem`);
    }

    const [answer, created] = await ProgrammingAssessmentAnswer.findOrCreate({
      where: { attempt_id: attempt._id, problem_id: problem._id },
      defaults: { code, language: language || 'javascript', status: 'pending' },
    });
    if (!created) {
      await answer.update({ code, language: language || 'javascript', status: 'pending' });
    }

    res.json({
      answer: {
        id: answer._id.toString(),
        problem_id: answer.problem_id.toString(),
        code: answer.code,
        language: answer.language,
        status: answer.status,
      },
    });
  }),
);

router.post(
  '/attempts/:attemptId/submit',
  asyncHandler(async (req, res) => {
    const attempt = await ProgrammingAssessmentAttempt.findByPk(req.params.attemptId);
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.student_id.toString() !== req.user._id.toString()) throw forbidden();
    if (attempt.status === 'submitted') throw badRequest('Assessment already submitted');

    const problems = await ProgrammingAssessmentProblem.findAll({
      where: { assessment_id: attempt.assessment_id },
    });

    const answers = await ProgrammingAssessmentAnswer.findAll({
      where: { attempt_id: attempt._id },
    });

    const answerMap = {};
    for (const ans of answers) {
      answerMap[ans.problem_id.toString()] = ans;
    }

    let obtainedMarks = 0;

    for (const problem of problems) {
      const answer = answerMap[problem._id.toString()];
      if (!answer || !answer.code || !answer.code.trim()) {
        const [ans, created] = await ProgrammingAssessmentAnswer.findOrCreate({
          where: { attempt_id: attempt._id, problem_id: problem._id },
          defaults: {
            status: 'pending',
            passed_test_cases: 0,
            total_test_cases: problem.sample_test_cases.length + problem.hidden_test_cases.length,
            marks_awarded: 0,
            submitted_at: new Date(),
          },
        });
        if (!created) {
          await ans.update({
            status: 'pending',
            passed_test_cases: 0,
            total_test_cases: problem.sample_test_cases.length + problem.hidden_test_cases.length,
            marks_awarded: 0,
            submitted_at: new Date(),
          });
        }
        continue;
      }

      const allTestCases = [
        ...problem.sample_test_cases.map((tc) => ({ ...tc, is_sample: true })),
        ...problem.hidden_test_cases.map((tc) => ({ ...tc, is_sample: false })),
      ];

      const result = await evaluateSubmission(
        answer.code,
        answer.language,
        allTestCases,
        problem.time_limit,
        problem.memory_limit,
      );

      const marksPerCase = result.total_test_cases > 0
        ? problem.marks / result.total_test_cases
        : 0;
      const marksAwarded = Math.round(result.passed_test_cases * marksPerCase * 100) / 100;

      obtainedMarks += marksAwarded;

      const [ans, created] = await ProgrammingAssessmentAnswer.findOrCreate({
        where: { attempt_id: attempt._id, problem_id: problem._id },
        defaults: {
          status: result.status,
          passed_test_cases: result.passed_test_cases,
          total_test_cases: result.total_test_cases,
          test_results: result.test_results,
          marks_awarded: marksAwarded,
          submitted_at: new Date(),
        },
      });
      if (!created) {
        await ans.update({
          status: result.status,
          passed_test_cases: result.passed_test_cases,
          total_test_cases: result.total_test_cases,
          test_results: result.test_results,
          marks_awarded: marksAwarded,
          submitted_at: new Date(),
        });
      }
    }

    attempt.obtained_marks = obtainedMarks;
    attempt.status = 'submitted';
    attempt.submitted_at = new Date();
    await attempt.save();

    const finalAnswers = await ProgrammingAssessmentAnswer.findAll({ where: { attempt_id: attempt._id } });

    res.json({
      attempt: {
        id: attempt._id.toString(),
        status: attempt.status,
        total_marks: attempt.total_marks,
        obtained_marks: attempt.obtained_marks,
        submitted_at: attempt.submitted_at,
      },
      answers: finalAnswers.map((a) => ({
        id: a._id.toString(),
        problem_id: a.problem_id.toString(),
        status: a.status,
        passed_test_cases: a.passed_test_cases,
        total_test_cases: a.total_test_cases,
        marks_awarded: a.marks_awarded,
        test_results: (a.test_results || []).map((tr) =>
          serializeStudentTestResult(tr, {
            isSample: false,
            status: a.status,
          }),
        ),
      })),
    });
  }),
);

router.get(
  '/results',
  asyncHandler(async (req, res) => {
    const attempts = await ProgrammingAssessmentAttempt.findAll({
      where: { student_id: req.user._id, status: 'submitted' },
      order: [['submitted_at', 'DESC']],
    });

    const assessmentIds = [...new Set(attempts.map((a) => a.assessment_id).filter(Boolean))];
    const assessments = assessmentIds.length > 0
      ? await ProgrammingAssessment.findAll({
          where: { _id: { [Op.in]: assessmentIds } },
          attributes: ['_id', 'title'],
        })
      : [];
    const assessmentMap = {};
    for (const a of assessments) {
      assessmentMap[a._id] = a;
    }

    res.json({
      results: attempts.map((a) => {
        const assessment = assessmentMap[a.assessment_id];
        return {
          id: a._id.toString(),
          assessment_id: a.assessment_id?.toString() || '',
          assessment_title: assessment?.title || 'Unknown',
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
  '/results/:attemptId',
  asyncHandler(async (req, res) => {
    const attempt = await ProgrammingAssessmentAttempt.findByPk(req.params.attemptId);

    if (!attempt) throw notFound('Result not found');
    if (attempt.student_id.toString() !== req.user._id.toString()) throw forbidden();

    const assessment = await ProgrammingAssessment.findByPk(attempt.assessment_id, {
      attributes: ['_id', 'title'],
    });

    const problems = await ProgrammingAssessmentProblem.findAll({
      where: { assessment_id: attempt.assessment_id },
      order: [['order', 'ASC']],
    });

    const answers = await ProgrammingAssessmentAnswer.findAll({
      where: { attempt_id: attempt._id },
    });

    const answerMap = {};
    for (const a of answers) {
      answerMap[a.problem_id.toString()] = a;
    }

    const problemResults = problems.map((p) => {
      const answer = answerMap[p._id.toString()];
      return {
        id: p._id.toString(),
        title: p.title,
        difficulty: p.difficulty,
        concept: p.concept,
        marks: p.marks,
        order: p.order,
        sample_test_cases: p.sample_test_cases.map((tc, i) => ({
          index: i,
          input: tc.input,
          output: tc.output,
          explanation: tc.explanation,
        })),
        answer: answer
          ? {
              code: answer.code,
              language: answer.language,
              status: answer.status,
              passed_test_cases: answer.passed_test_cases,
              total_test_cases: answer.total_test_cases,
              marks_awarded: answer.marks_awarded,
              test_results: (answer.test_results || []).map((tr) =>
                serializeStudentTestResult(tr, {
                  isSample: tr.test_case_index < (p.sample_test_cases?.length || 0),
                  status: answer.status,
                }),
              ),
            }
          : null,
      };
    });

    res.json({
      result: {
        id: attempt._id.toString(),
        assessment_title: assessment?.title || 'Unknown',
        total_marks: attempt.total_marks,
        obtained_marks: attempt.obtained_marks,
        percentage: attempt.total_marks > 0
          ? Math.round((attempt.obtained_marks / attempt.total_marks) * 100)
          : 0,
        started_at: attempt.started_at,
        submitted_at: attempt.submitted_at,
      },
      problems: problemResults,
    });
  }),
);

export default router;
