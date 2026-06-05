import express from 'express';
import { requireAuth, requireModuleAccess, requireRole } from '../middleware/auth.js';
import { Assessment } from '../models/Assessment.js';
import { AssessmentAttempt } from '../models/AssessmentAttempt.js';
import { Question } from '../models/Question.js';
import { StudentAnswer } from '../models/StudentAnswer.js';
import { collections } from '../../db.js';
import { evaluateAttempt } from '../services/scoringService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';
import { toStudentQuestion } from '../utils/questionValidation.js';

const router = express.Router();

router.use(requireAuth, requireRole('student'));

async function serializeAssessment(assessment) {
  const totalQuestions = await Question.countDocuments({ assessment_id: assessment._id });
  const start_time = assessment.start_time ? new Date(assessment.start_time) : null;
  return {
    id: assessment._id.toString(),
    title: assessment.title,
    concept: assessment.concept,
    difficulty: assessment.difficulty,
    duration_minutes: assessment.duration_minutes,
    total_marks: assessment.total_marks,
    passing_marks: assessment.passing_marks,
    start_time: assessment.start_time,
    end_time: assessment.end_time,
    total_questions: totalQuestions,
  };
}

function ensureAvailable(assessment) {
  const now = new Date();
  if (assessment.is_deleted) throw forbidden('Assessment is no longer available');
  if (assessment.status !== 'published') throw forbidden('Assessment is not published');
  if (assessment.start_time && now < assessment.start_time) {
    throw forbidden('Assessment has not started yet');
  }
  if (assessment.end_time && now > assessment.end_time) {
    throw forbidden('Assessment has ended');
  }
}

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const { reports } = collections();
    const studentId = req.user._id.toString();
    const userModules = req.user.modules_access || ['both'];
    const hasAptitude = userModules.includes('aptitude') || userModules.includes('both');
    const hasInterview = userModules.includes('ai_interview') || userModules.includes('both');

    let available = 0, submittedCount = 0, attempts = [], interviewReports = [];

    if (hasAptitude) {
      const aptitudeResults = await Promise.all([
        Assessment.countDocuments({ status: 'published', is_deleted: { $ne: true } }),
        AssessmentAttempt.countDocuments({ student_id: req.user._id, status: 'submitted' }),
        AssessmentAttempt.find({ student_id: req.user._id, status: 'submitted' }).populate(
          'assessment_id',
          'title concept difficulty passing_marks total_marks duration_minutes',
        ),
      ]);
      available = aptitudeResults[0];
      submittedCount = aptitudeResults[1];
      attempts = aptitudeResults[2];
    }

    if (hasInterview) {
      interviewReports = await reports
        .find(
          { student_id: studentId },
          {
            projection: {
              _id: 0,
              session_id: 1,
              report_id: 1,
              generated_date: 1,
              interview_domain: 1,
              interview_role: 1,
              overall: 1,
              ats_analysis: 1,
              created_at: 1,
            },
          },
        )
        .sort({ created_at: -1 })
        .limit(25)
        .toArray();
    }

    const attemptAnalytics = attempts
      .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0))
      .map((attempt) => {
        const assessment = attempt.assessment_id;
        const started = attempt.started_at ? new Date(attempt.started_at).getTime() : null;
        const submitted = attempt.submitted_at ? new Date(attempt.submitted_at).getTime() : null;
        const timeTakenSeconds = started && submitted ? Math.max(0, Math.round((submitted - started) / 1000)) : 0;

        return {
          id: attempt._id.toString(),
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
      });

    const passedCount = attemptAnalytics.filter((attempt) => attempt.passed).length;
    const averagePercentage = attemptAnalytics.length
      ? Number(
          (
            attemptAnalytics.reduce((sum, attempt) => sum + attempt.percentage, 0) /
            attemptAnalytics.length
          ).toFixed(2),
        )
      : 0;

    const topicMap = new Map();
    for (const attempt of attemptAnalytics) {
      const key = attempt.concept || 'General';
      const current = topicMap.get(key) || {
        concept: key,
        attempts: 0,
        best_percentage: 0,
        average_percentage: 0,
        passed: 0,
      };
      current.attempts += 1;
      current.best_percentage = Math.max(current.best_percentage, attempt.percentage);
      current.average_percentage += attempt.percentage;
      if (attempt.passed) current.passed += 1;
      topicMap.set(key, current);
    }

    const topic_analytics = Array.from(topicMap.values()).map((topic) => ({
      ...topic,
      average_percentage: Number((topic.average_percentage / topic.attempts).toFixed(2)),
      pass_rate: Math.round((topic.passed / topic.attempts) * 100),
    }));

    const interviewPercentages = interviewReports
      .map((report) => Number(report.overall?.percentage || 0))
      .filter((value) => Number.isFinite(value));
    const averageInterviewPercentage = interviewPercentages.length
      ? Number((interviewPercentages.reduce((sum, value) => sum + value, 0) / interviewPercentages.length).toFixed(2))
      : 0;
    const latestInterviewReport = interviewReports[0] || null;

    res.json({
      available_assessments: available,
      submitted_attempts: submittedCount,
      passed_attempts: passedCount,
      pass_rate: attemptAnalytics.length ? Math.round((passedCount / attemptAnalytics.length) * 100) : 0,
      average_percentage: averagePercentage,
      recent_submissions: attemptAnalytics.slice(0, 25),
      topic_analytics,
      interview_analytics: {
        reports: interviewReports.length,
        average_percentage: averageInterviewPercentage,
        latest_metrics: latestInterviewReport?.overall?.metrics || {},
        latest_ats_score: latestInterviewReport?.ats_analysis?.ats_score || 0,
        recent_reports: interviewReports.map((report) => ({
          session_id: report.session_id,
          report_id: report.report_id,
          domain: report.interview_domain || '',
          role: report.interview_role || '',
          generated_date: report.generated_date,
          percentage: report.overall?.percentage || 0,
          grade: report.overall?.grade || '',
          grade_label: report.overall?.grade_label || '',
          ats_score: report.ats_analysis?.ats_score || 0,
          created_at: report.created_at,
        })),
      },
    });
  }),
);

router.get(
  '/assessments',
  requireModuleAccess('aptitude'),
  asyncHandler(async (_req, res) => {
    const assessments = await Assessment.find({
      status: 'published',
      is_deleted: { $ne: true },
    }).sort({ created_at: -1 });

    console.log(`Fetched ${assessments} published assessments for student dashboard`);
    res.json({ assessments: await Promise.all(assessments.map(serializeAssessment)) });
  }),
);

router.post(
  '/assessments/:id/start',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');
    ensureAvailable(assessment);

    let attempt = await AssessmentAttempt.findOne({
      assessment_id: assessment._id,
      student_id: req.user._id,
      status: 'in_progress',
    });

    if (!attempt) {
      attempt = await AssessmentAttempt.create({
        assessment_id: assessment._id,
        student_id: req.user._id,
      });
    }

    const questions = await Question.find({ assessment_id: assessment._id }).sort({ created_at: 1 });
    const answers = await StudentAnswer.find({ attempt_id: attempt._id });
    const selected = Object.fromEntries(
      answers.map((answer) => [answer.question_id.toString(), answer.selected_option]),
    );

    res.json({
      assessment: await serializeAssessment(assessment),
      attempt: {
        id: attempt._id.toString(),
        started_at: attempt.started_at,
        extra_time_minutes: attempt.extra_time_minutes || 0,
        status: attempt.status,
      },
      questions: questions.map(toStudentQuestion),
      selected_answers: selected,
    });
  }),
);

router.get(
  '/attempts/:attemptId/time',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const attempt = await AssessmentAttempt.findById(req.params.attemptId).populate(
      'assessment_id',
      'duration_minutes',
    );
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.student_id.toString() !== req.user._id.toString()) throw forbidden();

    res.json({
      attempt: {
        id: attempt._id.toString(),
        started_at: attempt.started_at,
        status: attempt.status,
        extra_time_minutes: attempt.extra_time_minutes || 0,
        effective_duration_minutes:
          (attempt.assessment_id?.duration_minutes || 0) + (attempt.extra_time_minutes || 0),
      },
    });
  }),
);

router.put(
  '/attempts/:attemptId/answers',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const { question_id, selected_option } = req.body;
    if (!['A', 'B', 'C', 'D', null].includes(selected_option)) {
      throw badRequest('Selected option must be A, B, C, D, or null');
    }

    const attempt = await AssessmentAttempt.findById(req.params.attemptId);
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.student_id.toString() !== req.user._id.toString()) throw forbidden();
    if (attempt.status !== 'in_progress') throw badRequest('Attempt already submitted');

    const question = await Question.findById(question_id);
    if (!question || question.assessment_id.toString() !== attempt.assessment_id.toString()) {
      throw badRequest('Question does not belong to this attempt');
    }

    await StudentAnswer.findOneAndUpdate(
      { attempt_id: attempt._id, question_id: question._id },
      { selected_option },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.json({ saved: true });
  }),
);

router.post(
  '/attempts/:attemptId/submit',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const attempt = await AssessmentAttempt.findById(req.params.attemptId);
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.student_id.toString() !== req.user._id.toString()) throw forbidden();

    const assessment = await Assessment.findById(attempt.assessment_id);
    if (!assessment) throw notFound('Assessment not found');

    if (attempt.status === 'submitted') {
      return res.json({ attempt });
    }

    const questions = await Question.find({ assessment_id: assessment._id });
    const evaluated = await evaluateAttempt(attempt, assessment, questions);
    res.json({ attempt: evaluated });
  }),
);

router.get(
  '/results',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const attempts = await AssessmentAttempt.find({
      student_id: req.user._id,
      status: 'submitted',
    })
      .populate('assessment_id', 'title concept difficulty passing_marks total_marks')
      .sort({ submitted_at: -1 });

    res.json({
      results: attempts.map((attempt) => ({
        id: attempt._id.toString(),
        assessment_title: attempt.assessment_id?.title || 'Assessment',
        concept: attempt.assessment_id?.concept || '',
        difficulty: attempt.assessment_id?.difficulty || '',
        score: attempt.score,
        total_marks: attempt.assessment_id?.total_marks || 0,
        passing_marks: attempt.assessment_id?.passing_marks || 0,
        percentage: attempt.percentage,
        passed: attempt.score >= (attempt.assessment_id?.passing_marks || 0),
        submitted_at: attempt.submitted_at,
      })),
    });
  }),
);

router.get(
  '/results/:attemptId',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const attempt = await AssessmentAttempt.findById(req.params.attemptId).populate(
      'assessment_id',
      'title concept difficulty total_marks passing_marks',
    );
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.student_id.toString() !== req.user._id.toString()) throw forbidden();
    if (attempt.status !== 'submitted') throw forbidden('Results are available after submission');

    const questions = await Question.find({ assessment_id: attempt.assessment_id._id }).sort({
      created_at: 1,
    });
    const answers = await StudentAnswer.find({ attempt_id: attempt._id });
    const answerMap = new Map(
      answers.map((answer) => [answer.question_id.toString(), answer]),
    );

    const byTopic = {};
    const details = questions.map((question) => {
      const answer = answerMap.get(question._id.toString());
      if (!byTopic[question.concept]) {
        byTopic[question.concept] = { concept: question.concept, correct: 0, total: 0, score: 0 };
      }
      byTopic[question.concept].total += 1;
      byTopic[question.concept].score += answer?.marks_awarded || 0;
      if (answer?.is_correct) byTopic[question.concept].correct += 1;

      return {
        id: question._id.toString(),
        question_text: question.question_text,
        options: {
          A: question.option_a,
          B: question.option_b,
          C: question.option_c,
          D: question.option_d,
        },
        correct_option: question.correct_option,
        selected_option: answer?.selected_option || null,
        is_correct: Boolean(answer?.is_correct),
        marks_awarded: answer?.marks_awarded || 0,
        explanation: question.explanation,
        shortcut: question.shortcut,
        concept: question.concept,
        difficulty: question.difficulty,
      };
    });

    res.json({
      attempt: {
        id: attempt._id.toString(),
        score: attempt.score,
        percentage: attempt.percentage,
        passed: attempt.score >= attempt.assessment_id.passing_marks,
        started_at: attempt.started_at,
        submitted_at: attempt.submitted_at,
      },
      assessment: {
        id: attempt.assessment_id._id.toString(),
        title: attempt.assessment_id.title,
        concept: attempt.assessment_id.concept,
        difficulty: attempt.assessment_id.difficulty,
        total_marks: attempt.assessment_id.total_marks,
        passing_marks: attempt.assessment_id.passing_marks,
      },
      answers: details,
      topic_analytics: Object.values(byTopic).map((topic) => ({
        ...topic,
        accuracy: topic.total ? Math.round((topic.correct / topic.total) * 100) : 0,
      })),
    });
  }),
);

export default router;
