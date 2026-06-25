import express from 'express';
import PDFDocument from 'pdfkit';
import { requireAuth, requireModuleAccess, requireRole } from '../middleware/auth.js';
import {
  Op,
  Assessment,
  AssessmentAttempt,
  Question,
  ProctoringEvent,
  ResumeVersion,
  StudentAnswer,
  StudentCertificate,
  ProgrammingProblem,
  ProgrammingAssessmentAttempt,
  ProgrammingSubmission,
  InterviewReport,
} from '../../database/index.js';
import { evaluateAttempt } from '../services/scoringService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';
import { toStudentQuestion } from '../utils/questionValidation.js';
import { INVALID_PROBLEM_TITLE_PATTERN } from '../../programming/utils/problemVisibility.js';

const router = express.Router();

router.use(requireAuth, requireRole('student'));

async function serializeAssessment(assessment) {
  const totalQuestions = await Question.count({
    where: { assessment_id: assessment._id },
  });

  const subtract530 = (date) => {
    if (!date) return null;

    const d = new Date(date);
    d.setMinutes(d.getMinutes() - 330);
    return d;
  };

  return {
    id: assessment._id,
    title: assessment.title,
    concept: assessment.concept,
    difficulty: assessment.difficulty,
    duration_minutes: assessment.duration_minutes,
    total_marks: assessment.total_marks,
    passing_marks: assessment.passing_marks,
    start_time: subtract530(assessment.start_time),
    end_time: subtract530(assessment.end_time),
    total_questions: totalQuestions,
    target_audience: assessment.target_audience || 'all',
    department_ids: assessment.department_ids || null,
  };
}
function ensureAvailable(assessment) {
  const now = new Date();
  if (assessment.is_deleted) throw forbidden('Assessment is no longer available');
  if (assessment.status !== 'published') throw forbidden('Assessment is not published');

 const subtract530 = (date) => {
    if (!date) return null;

    const d = new Date(date);
    d.setMinutes(d.getMinutes() - 330);
    return d;
  };

  const check_start_time = subtract530(assessment.start_time);
  const check_end_time = subtract530(assessment.end_time);

  if (check_start_time && now < check_start_time) {
    throw forbidden('Assessment has not started yet');
  }
  if (check_end_time && now > check_end_time) {
    throw forbidden('Assessment has ended');
  }
}

function toDateKey(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function daysBetween(dateKeyA, dateKeyB) {
  const a = new Date(`${dateKeyA}T00:00:00.000Z`).getTime();
  const b = new Date(`${dateKeyB}T00:00:00.000Z`).getTime();
  return Math.round((a - b) / (24 * 60 * 60 * 1000));
}

function buildStreak(activityDates) {
  const dateKeys = [...new Set(activityDates.map(toDateKey).filter(Boolean))].sort();
  if (!dateKeys.length) {
    return { current: 0, best: 0, active_days: [] };
  }

  let best = 1;
  let run = 1;
  for (let index = 1; index < dateKeys.length; index += 1) {
    if (daysBetween(dateKeys[index], dateKeys[index - 1]) === 1) {
      run += 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
  }

  const todayKey = toDateKey(new Date());
  const latestKey = dateKeys[dateKeys.length - 1];
  const canContinueFromLatest = daysBetween(todayKey, latestKey) <= 1;
  let current = canContinueFromLatest ? 1 : 0;
  if (current) {
    for (let index = dateKeys.length - 1; index > 0; index -= 1) {
      if (daysBetween(dateKeys[index], dateKeys[index - 1]) !== 1) break;
      current += 1;
    }
  }

  return { current, best, active_days: dateKeys.slice(-14) };
}

function formatActivityDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : new Date(0);
}

function normalizeActivityValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeActivity(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = [
      item.type,
      normalizeActivityValue(item.title),
      normalizeActivityValue(item.meta),
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function buildReadinessScore({ aptitude, coding, interview, consistency, resume }) {
  const components = {
    aptitude: clampScore(aptitude),
    coding: clampScore(coding),
    interview: clampScore(interview),
    consistency: clampScore(consistency),
    resume: clampScore(resume),
  };
  const score = clampScore(
    components.aptitude * 0.25
      + components.coding * 0.25
      + components.interview * 0.25
      + components.consistency * 0.15
      + components.resume * 0.10,
  );
  const label = score >= 80 ? 'Placement Ready' : score >= 65 ? 'Nearly Ready' : score >= 45 ? 'Building Readiness' : 'Needs Foundation';
  return { score, label, components };
}

function pickWeakTopic(topicAnalytics = []) {
  return [...topicAnalytics]
    .sort((a, b) => Number(a.average_percentage || 0) - Number(b.average_percentage || 0))[0] || null;
}

function buildLearningPath({ hasAptitude, hasProgramming, hasInterview, readiness, topicAnalytics, programmingAnalytics, interviewAnalytics, resumeScore }) {
  const weakTopic = pickWeakTopic(topicAnalytics);
  const tasks = [];

  if (hasProgramming) {
    tasks.push({
      id: 'coding-foundation',
      title: programmingAnalytics?.solved_unique ? 'Continue coding progression' : 'Beginner coding path',
      category: 'Coding',
      priority: readiness.components.coding < 60 ? 'high' : 'medium',
      progress: programmingAnalytics?.progress_percentage || 0,
      href: '/programming/practice',
      task: programmingAnalytics?.solved_unique
        ? 'Solve two unsolved problems from your current topic.'
        : 'Start with beginner-friendly problems and submit your first accepted solution.',
    });
  }

  if (hasAptitude) {
    tasks.push({
      id: 'aptitude-weak-area',
      title: weakTopic ? `${weakTopic.concept} weak-area path` : 'Aptitude weak-area path',
      category: 'Aptitude',
      priority: readiness.components.aptitude < 65 ? 'high' : 'medium',
      progress: weakTopic ? clampScore(weakTopic.average_percentage) : 0,
      href: '/aptitude',
      task: weakTopic
        ? `Practice ${weakTopic.concept} until your average crosses 75%.`
        : 'Attempt one published aptitude assessment to reveal weak areas.',
    });
  }

  if (hasInterview) {
    tasks.push({
      id: 'interview-improvement',
      title: 'Interview improvement path',
      category: 'Interview',
      priority: readiness.components.interview < 75 ? 'high' : 'medium',
      progress: interviewAnalytics?.average_percentage || 0,
      href: '/interview',
      task: interviewAnalytics?.reports
        ? 'Retake an interview and improve the lowest focus metric.'
        : 'Complete one AI mock interview for role-specific feedback.',
    });
  }

  tasks.push({
    id: 'daily-practice',
    title: 'Daily practice tasks',
    category: 'Consistency',
    priority: readiness.components.consistency < 50 ? 'high' : 'low',
    progress: readiness.components.consistency,
    href: hasProgramming ? '/programming/practice' : hasAptitude ? '/aptitude' : '/interview',
    task: 'Complete one task today to keep your weekly goal and streak moving.',
  });

  tasks.push({
    id: 'resume-builder',
    title: 'Resume improvement path',
    category: 'Resume',
    priority: resumeScore < 70 ? 'high' : 'low',
    progress: resumeScore,
    href: '/resume-builder',
    task: resumeScore ? 'Apply the latest ATS suggestions and save a new version.' : 'Build your first tracked resume version.',
  });

  return tasks.sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return rank[a.priority] - rank[b.priority];
  });
}

function buildBadges({ readiness, programmingAnalytics, passedCount, interviewAnalytics, streak }) {
  const badges = [];
  if ((programmingAnalytics?.solved_unique || 0) >= 50) badges.push({ title: '50 Coding Problems', tier: 'gold' });
  if (passedCount > 0) badges.push({ title: 'Aptitude Pass', tier: 'green' });
  if ((interviewAnalytics?.average_percentage || 0) >= 75) badges.push({ title: 'Interview Ready', tier: 'blue' });
  if ((streak.current || 0) >= 7) badges.push({ title: '7-Day Streak', tier: 'amber' });
  if ((readiness?.score || 0) >= 80) badges.push({ title: 'Placement Ready', tier: 'gold' });
  return badges;
}

function buildCertificateMilestones({ readiness, programmingAnalytics, passedCount, interviewAnalytics }) {
  return [
    {
      milestone: 'coding_50',
      title: '50 Coding Problems Solved',
      eligible: (programmingAnalytics?.solved_unique || 0) >= 50,
      progress: Math.min(programmingAnalytics?.solved_unique || 0, 50),
      target: 50,
    },
    {
      milestone: 'aptitude_passed',
      title: 'Aptitude Assessment Passed',
      eligible: passedCount > 0,
      progress: Math.min(passedCount, 1),
      target: 1,
    },
    {
      milestone: 'interview_readiness_75',
      title: 'Interview Readiness Above 75%',
      eligible: (interviewAnalytics?.average_percentage || 0) >= 75,
      progress: clampScore(interviewAnalytics?.average_percentage || 0),
      target: 75,
    },
    {
      milestone: 'placement_track_complete',
      title: 'Full Placement Preparation Track',
      eligible: (readiness?.score || 0) >= 80,
      progress: readiness?.score || 0,
      target: 80,
    },
  ];
}

function cleanList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanResumeSections(value, limit = 8) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((section) => ({
    title: String(section?.title || '').trim().slice(0, 160),
    items: cleanList(section?.items).slice(0, 8),
  })).filter((section) => section.title || section.items.length);
}

function analyzeResumePayload(payload, previousScore = 0) {
  const skills = cleanList(payload.skills);
  const sections = [
    payload.summary,
    ...(payload.experience || []).flatMap((section) => [section.title, ...(section.items || [])]),
    ...(payload.projects || []).flatMap((section) => [section.title, ...(section.items || [])]),
    ...(payload.education || []).flatMap((section) => [section.title, ...(section.items || [])]),
    ...(payload.achievements || []).flatMap((section) => [section.title, ...(section.items || [])]),
    ...(payload.certifications || []),
  ].map((item) => String(item || '').trim()).filter(Boolean);

  let score = 25;
  if (payload.target_role) score += 10;
  if (payload.summary && String(payload.summary).length >= 80) score += 15;
  score += Math.min(skills.length * 3, 18);
  if ((payload.experience || []).length) score += 14;
  if ((payload.projects || []).length) score += 14;
  if ((payload.achievements || []).length) score += 6;
  if ((payload.certifications || []).length) score += 4;
  if (sections.some((item) => /\b\d+%|\b\d+\+|\b\d+x\b/i.test(item))) score += 8;
  if (sections.some((item) => /\b(led|built|improved|reduced|designed|deployed|automated)\b/i.test(item))) score += 6;

  const improvements = [];
  const strengths = [];
  if (!payload.target_role) improvements.push('Add a target role so the resume can be evaluated against a placement goal.');
  if (!payload.summary || String(payload.summary).length < 80) improvements.push('Write a 3-4 line professional summary with role, skills, and measurable impact.');
  if (skills.length < 6) improvements.push('Add at least 6 role-relevant technical and soft skills.');
  if (!(payload.projects || []).length) improvements.push('Add 1-2 projects with tools used, problem solved, and outcome.');
  if (!sections.some((item) => /\b\d+%|\b\d+\+|\b\d+x\b/i.test(item))) improvements.push('Add measurable outcomes such as percentages, counts, or scale.');
  if (payload.summary) strengths.push('Summary section present');
  if (skills.length >= 6) strengths.push('Strong skills coverage');
  if ((payload.projects || []).length) strengths.push('Project evidence included');

  return {
    ats_score: clampScore(score),
    previous_score: clampScore(previousScore),
    improvements: improvements.slice(0, 6),
    strengths: strengths.slice(0, 5),
  };
}

function buildPdfBuffer(draw) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    draw(doc);
    doc.end();
  });
}

function serializeResumeVersion(version) {
  return {
    id: version._id,
    version: version.version,
    title: version.title,
    target_role: version.target_role,
    phone: version.phone || '',
    email: version.email || '',
    linkedin: version.linkedin || '',
    github: version.github || '',
    location: version.location || '',
    summary: version.summary,
    skills: version.skills,
    experience: version.experience,
    education: version.education,
    projects: version.projects,
    certifications: version.certifications || [],
    achievements: version.achievements || [],
    ats_analysis: version.ats_analysis,
    created_at: version.created_at,
    updated_at: version.updated_at,
  };
}

function drawResumeSection(doc, label, sections = []) {
  if (!sections?.length) return;
  doc.moveDown(0.7);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(label);
  doc.moveTo(48, doc.y + 2).lineTo(564, doc.y + 2).strokeColor('#111827').lineWidth(0.5).stroke();
  doc.moveDown(0.45);
  for (const section of sections) {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111827').text(section.title || label);
    doc.font('Helvetica').fontSize(9).fillColor('#1f2937');
    for (const item of section.items || []) {
      doc.text(`- ${item}`, { indent: 10, lineGap: 1 });
    }
    doc.moveDown(0.25);
  }
}

function drawResumeListSection(doc, label, items = []) {
  if (!items?.length) return;
  doc.moveDown(0.7);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(label);
  doc.moveTo(48, doc.y + 2).lineTo(564, doc.y + 2).strokeColor('#111827').lineWidth(0.5).stroke();
  doc.moveDown(0.45);
  doc.font('Helvetica').fontSize(9).fillColor('#1f2937').text(items.join(', '), { lineGap: 1 });
}

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const studentId = req.user._id;
    const userModules = req.user.modules_access || ['both'];
    const hasAptitude = userModules.includes('aptitude') || userModules.includes('both');
    const hasInterview = userModules.includes('ai_interview') || userModules.includes('both');
    const hasProgramming = userModules.includes('programming') || userModules.includes('both');
    const [latestResume, issuedCertificates] = await Promise.all([
      ResumeVersion.findOne({ where: { student_id: req.user._id }, order: [['version', 'DESC']] }),
      StudentCertificate.findAll({ where: { student_id: req.user._id }, order: [['issued_at', 'DESC']] }),
    ]);

    let available = 0, submittedCount = 0, attempts = [], inProgressAttempts = [], interviewReports = [];
    let nextAssessment = null;
    let programmingStats = {
      total_submissions: 0,
      total_problems: 0,
      solved_unique: 0,
      accepted: 0,
      pending: 0,
      wrong: 0,
      recent_submissions: [],
    };

    if (hasAptitude) {
      const aptitudeResults = await Promise.all([
        Assessment.count({ where: { status: 'published', is_deleted: { [Op.ne]: true } } }),
        AssessmentAttempt.count({ where: { student_id: req.user._id, status: 'submitted' } }),
        AssessmentAttempt.findAll({ where: { student_id: req.user._id, status: 'submitted' } }),
        AssessmentAttempt.findAll({
          where: { student_id: req.user._id, status: 'in_progress' },
          order: [['updated_at', 'DESC'], ['started_at', 'DESC']],
          limit: 5,
        }),
        Assessment.findOne({
          where: { status: 'published', is_deleted: { [Op.ne]: true } },
          order: [['start_time', 'ASC'], ['created_at', 'DESC']],
        }),
      ]);
      available = aptitudeResults[0];
      submittedCount = aptitudeResults[1];
      attempts = aptitudeResults[2];
      inProgressAttempts = aptitudeResults[3];
      nextAssessment = aptitudeResults[4];

      const allAttempts = [...attempts, ...inProgressAttempts];
      const assessmentIds = [...new Set(allAttempts.map(a => a.assessment_id).filter(Boolean))];
      if (assessmentIds.length) {
        const assessments = await Assessment.findAll({
          where: { _id: assessmentIds },
          attributes: ['_id', 'title', 'concept', 'difficulty', 'passing_marks', 'total_marks', 'duration_minutes'],
        });
        const assessmentMap = Object.fromEntries(assessments.map(a => [a._id, a]));
        allAttempts.forEach(a => {
          if (assessmentMap[a.assessment_id]) {
            a.setDataValue('assessment_id', assessmentMap[a.assessment_id]);
          }
        });
      }
    }

    if (hasProgramming) {
      const [totalSubmissions, accepted, wrong, pending, totalProblems, solvedProblemSubmissions, recentProgrammingSubmissions] = await Promise.all([
        ProgrammingSubmission.count({ where: { student_id: req.user._id } }),
        ProgrammingSubmission.count({ where: { student_id: req.user._id, status: 'accepted' } }),
        ProgrammingSubmission.count({
          where: {
            student_id: req.user._id,
            status: { [Op.in]: ['wrong_answer', 'time_limit_exceeded', 'runtime_error', 'compilation_error'] },
          },
        }),
        ProgrammingSubmission.count({
          where: {
            student_id: req.user._id,
            status: { [Op.in]: ['pending', 'running'] },
          },
        }),
        ProgrammingProblem.count({
          where: {
            status: 'published',
            is_deleted: { [Op.ne]: true },
            is_auto_gradable: { [Op.ne]: false },
            title: { [Op.notIRegexp]: INVALID_PROBLEM_TITLE_PATTERN.source },
          },
        }),
        ProgrammingSubmission.findAll({
          where: { student_id: req.user._id, status: 'accepted' },
          attributes: ['problem_id'],
        }),
        ProgrammingSubmission.findAll({
          where: { student_id: req.user._id },
          order: [['submitted_at', 'DESC']],
          limit: 25,
        }),
      ]);
      const solvedProblemIds = [...new Set(solvedProblemSubmissions.map(s => s.problem_id))];

      const problemIds = [...new Set(recentProgrammingSubmissions.map(s => s.problem_id).filter(Boolean))];
      if (problemIds.length) {
        const problems = await ProgrammingProblem.findAll({
          where: { _id: problemIds },
          attributes: ['_id', 'title', 'concept', 'difficulty'],
        });
        const problemMap = Object.fromEntries(problems.map(p => [p._id, p]));
        recentProgrammingSubmissions.forEach(s => {
          if (problemMap[s.problem_id]) {
            s.setDataValue('problem_id', problemMap[s.problem_id]);
          }
        });
      }

      programmingStats = {
        total_submissions: totalSubmissions,
        total_problems: totalProblems,
        solved_unique: solvedProblemIds.length,
        accepted,
        wrong,
        pending,
        recent_submissions: recentProgrammingSubmissions,
      };
    }

    if (hasInterview) {
      interviewReports = await InterviewReport.findAll({
        where: { student_id: req.user._id },
        attributes: ['session_id', 'report_id', 'generated_date', 'interview_domain', 'interview_role', 'overall', 'ats_analysis', 'created_at'],
        order: [['created_at', 'DESC']],
        limit: 25,
      });
    }

    const attemptAnalytics = attempts
      .sort((a, b) => new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0))
      .map((attempt) => {
        const assessment = attempt.assessment_id;
        const started = attempt.started_at ? new Date(attempt.started_at).getTime() : null;
        const submitted = attempt.submitted_at ? new Date(attempt.submitted_at).getTime() : null;
        const timeTakenSeconds = started && submitted ? Math.max(0, Math.round((submitted - started) / 1000)) : 0;

        return {
          id: attempt._id,
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

    const activeAttempts = inProgressAttempts.map((attempt) => {
      const assessment = attempt.assessment_id;
      const started = attempt.started_at ? new Date(attempt.started_at).getTime() : null;
      const durationMinutes = assessment?.duration_minutes || 0;
      const elapsedSeconds = started ? Math.max(0, Math.round((Date.now() - started) / 1000)) : 0;
      const totalSeconds = Math.max(0, (durationMinutes + (attempt.extra_time_minutes || 0)) * 60);
      const progress = totalSeconds ? Math.min(99, Math.round((elapsedSeconds / totalSeconds) * 100)) : 0;

      return {
        id: attempt._id,
        assessment_id: assessment?._id || '',
        assessment_title: assessment?.title || 'Assessment',
        concept: assessment?.concept || '',
        difficulty: assessment?.difficulty || '',
        duration_minutes: durationMinutes,
        started_at: attempt.started_at,
        progress,
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

    const programmingAnalytics = hasProgramming
      ? {
          total_submissions: programmingStats.total_submissions,
          total_problems: programmingStats.total_problems,
          solved_unique: programmingStats.solved_unique,
          accepted: programmingStats.accepted,
          wrong: programmingStats.wrong,
          pending: programmingStats.pending,
          acceptance_rate: programmingStats.total_submissions
            ? Math.round((programmingStats.accepted / programmingStats.total_submissions) * 100)
            : 0,
          progress_percentage: programmingStats.total_problems
            ? Math.round((programmingStats.solved_unique / programmingStats.total_problems) * 100)
            : 0,
          recent_submissions: programmingStats.recent_submissions.map((submission) => ({
            id: submission._id,
            problem_id: submission.problem_id?._id || submission.problem_id || '',
            title: submission.problem_id?.title || 'Coding problem',
            concept: submission.problem_id?.concept || '',
            difficulty: submission.problem_id?.difficulty || '',
            status: submission.status,
            language: submission.language,
            passed_test_cases: submission.passed_test_cases || 0,
            total_test_cases: submission.total_test_cases || 0,
            submitted_at: submission.submitted_at,
          })),
        }
      : null;

    const interviewPercentages = interviewReports
      .map((report) => Number(report.overall?.percentage || 0))
      .filter((value) => Number.isFinite(value));
    const averageInterviewPercentage = interviewPercentages.length
      ? Number((interviewPercentages.reduce((sum, value) => sum + value, 0) / interviewPercentages.length).toFixed(2))
      : 0;
    const latestInterviewReport = interviewReports[0] || null;
    const interviewAnalytics = hasInterview
      ? {
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
        }
      : null;

    const activity = [
      ...attemptAnalytics.map((attempt) => ({
        id: attempt.id,
        type: 'aptitude',
        title: attempt.assessment_title,
        meta: `${attempt.concept || 'Aptitude'}${attempt.difficulty ? ` · ${attempt.difficulty}` : ''}`,
        result: attempt.passed ? 'Passed' : 'Submitted',
        score: attempt.percentage,
        href: `/aptitude/results/${attempt.id}`,
        occurred_at: attempt.submitted_at,
      })),
      ...(interviewAnalytics?.recent_reports || []).map((report) => ({
        id: report.report_id || report.session_id,
        type: 'interview',
        title: report.role || 'Mock Interview',
        meta: report.domain || 'AI Interview',
        result: report.grade_label || report.grade || 'Report ready',
        score: report.percentage,
        href: `/reports?session=${report.session_id}`,
        occurred_at: report.created_at,
      })),
      ...(programmingAnalytics?.recent_submissions || []).map((submission) => ({
        id: submission.id,
        type: 'programming',
        title: submission.title,
        meta: `${submission.concept || 'Coding'}${submission.difficulty ? ` · ${submission.difficulty}` : ''}`,
        result: submission.status === 'accepted' ? 'Accepted' : submission.status.replaceAll('_', ' '),
        score: submission.total_test_cases
          ? Math.round((submission.passed_test_cases / submission.total_test_cases) * 100)
          : null,
        href: submission.problem_id ? `/programming/practice/problems/${submission.problem_id}` : '/programming/practice',
        occurred_at: submission.submitted_at,
      })),
    ].sort((a, b) => formatActivityDate(b.occurred_at) - formatActivityDate(a.occurred_at));
    const recentActivity = dedupeActivity(activity).slice(0, 8);

    const streak = buildStreak(activity.map((item) => item.occurred_at));
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const weeklyCompleted = activity.filter((item) => formatActivityDate(item.occurred_at) >= weekStart).length;
    const resumeScore = latestResume?.ats_analysis?.ats_score || latestInterviewReport?.ats_analysis?.ats_score || 0;
    const progressValues = [
      hasAptitude ? averagePercentage : null,
      hasInterview ? averageInterviewPercentage : null,
      hasProgramming ? programmingAnalytics?.progress_percentage : null,
    ].filter((value) => Number.isFinite(Number(value)));
    const overallProgress = progressValues.length
      ? Number((progressValues.reduce((sum, value) => sum + Number(value), 0) / progressValues.length).toFixed(2))
      : 0;
    const consistencyScore = Math.min(100, (weeklyCompleted / 5) * 70 + Math.min(streak.current || 0, 7) * 4.3);
    const readiness = buildReadinessScore({
      aptitude: hasAptitude ? averagePercentage : 0,
      coding: hasProgramming ? programmingAnalytics?.progress_percentage : 0,
      interview: hasInterview ? averageInterviewPercentage : 0,
      consistency: consistencyScore,
      resume: resumeScore,
    });
    const learningPath = buildLearningPath({
      hasAptitude,
      hasProgramming,
      hasInterview,
      readiness,
      topicAnalytics: topic_analytics,
      programmingAnalytics,
      interviewAnalytics,
      resumeScore,
    });
    const badges = buildBadges({
      readiness,
      programmingAnalytics,
      passedCount,
      interviewAnalytics,
      streak,
    });
    const certificateMilestones = buildCertificateMilestones({
      readiness,
      programmingAnalytics,
      passedCount,
      interviewAnalytics,
    });

    const continueLearning = [
      ...activeAttempts.map((attempt) => ({
        type: 'aptitude',
        title: attempt.assessment_title,
        meta: `${attempt.concept || 'Aptitude'}${attempt.difficulty ? ` · ${attempt.difficulty}` : ''}`,
        progress: attempt.progress,
        href: attempt.assessment_id ? `/aptitude/${attempt.assessment_id}/start` : '/aptitude',
        action: 'Resume Assessment',
        updated_at: attempt.started_at,
      })),
      ...(programmingAnalytics?.recent_submissions?.length
        ? [
            {
              type: 'programming',
              title: programmingAnalytics.recent_submissions[0].title,
              meta: `${programmingAnalytics.recent_submissions[0].concept || 'Coding practice'}${programmingAnalytics.recent_submissions[0].difficulty ? ` · ${programmingAnalytics.recent_submissions[0].difficulty}` : ''}`,
              progress: programmingAnalytics.progress_percentage,
              href: programmingAnalytics.recent_submissions[0].problem_id
                ? `/programming/practice/problems/${programmingAnalytics.recent_submissions[0].problem_id}`
                : '/programming/practice',
              action: programmingAnalytics.recent_submissions[0].status === 'accepted' ? 'Practice More' : 'Try Again',
              updated_at: programmingAnalytics.recent_submissions[0].submitted_at,
            },
          ]
        : []),
      ...(latestInterviewReport
        ? [
            {
              type: 'interview',
              title: latestInterviewReport.interview_role || req.user.interested_role || 'AI Mock Interview',
              meta: latestInterviewReport.interview_domain || 'Interview prep',
              progress: averageInterviewPercentage,
              href: '/interview',
              action: 'Start Interview',
              updated_at: latestInterviewReport.created_at,
            },
          ]
        : []),
    ].sort((a, b) => formatActivityDate(b.updated_at) - formatActivityDate(a.updated_at));

    const unsolvedProblems = Math.max((programmingAnalytics?.total_problems || 0) - (programmingAnalytics?.solved_unique || 0), 0);
    const recommendations = [
      hasAptitude && available
        ? {
            type: 'aptitude',
            title: nextAssessment?.title || 'Aptitude Assessment',
            meta: `${available} published assessment${available === 1 ? '' : 's'} available`,
            href: '/aptitude',
            action: 'Start Quiz',
          }
        : null,
      hasProgramming && programmingAnalytics
        ? {
            type: 'programming',
            title: programmingAnalytics.solved_unique ? 'Next Coding Problem' : 'Start Coding Practice',
            meta: `${unsolvedProblems} unsolved problem${unsolvedProblems === 1 ? '' : 's'}`,
            href: '/programming/practice',
            action: programmingAnalytics.solved_unique ? 'Continue Practice' : 'Start Practice',
          }
        : null,
      hasInterview
        ? {
            type: 'interview',
            title: req.user.interested_role ? `${req.user.interested_role} Mock Interview` : 'AI Mock Interview',
            meta: interviewReports.length ? `${interviewReports.length} report${interviewReports.length === 1 ? '' : 's'} saved` : 'Practice with AI feedback',
            href: '/interview',
            action: 'Start Interview',
          }
        : null,
    ].filter(Boolean);

    res.json({
      generated_at: new Date(),
      user: {
        id: req.user._id,
        role: req.user.role,
        modules_access: userModules,
        interested_role: req.user.interested_role || '',
      },
      available_assessments: available,
      submitted_attempts: submittedCount,
      passed_attempts: passedCount,
      pass_rate: attemptAnalytics.length ? Math.round((passedCount / attemptAnalytics.length) * 100) : 0,
      average_percentage: averagePercentage,
      overall_progress: overallProgress,
      active_attempts: activeAttempts,
      recent_submissions: attemptAnalytics.slice(0, 25),
      topic_analytics,
      interview_analytics: interviewAnalytics,
      programming_analytics: programmingAnalytics,
      placement_readiness: readiness,
      learning_path: learningPath,
      certificates: {
        issued: issuedCertificates.map((certificate) => ({
          id: certificate._id,
          milestone: certificate.milestone,
          title: certificate.title,
          description: certificate.description,
          score: certificate.score,
          issued_at: certificate.issued_at,
        })),
        milestones: certificateMilestones,
      },
      resume_builder: {
        latest_version: latestResume
          ? {
              id: latestResume._id,
              version: latestResume.version,
              title: latestResume.title,
              target_role: latestResume.target_role,
              ats_score: latestResume.ats_analysis?.ats_score || 0,
              previous_score: latestResume.ats_analysis?.previous_score || 0,
              improvements: latestResume.ats_analysis?.improvements || [],
              updated_at: latestResume.updated_at,
            }
          : null,
      },
      continue_learning: continueLearning.slice(0, 3),
      recommendations,
      recent_activity: recentActivity,
      study_streak: streak,
      weekly_goal: {
        target: 5,
        completed: Math.min(weeklyCompleted, 5),
        raw_completed: weeklyCompleted,
      },
      engagement: {
        xp: activity.reduce((sum, item) => sum + (item.type === 'interview' ? 50 : item.type === 'aptitude' ? 25 : 15), 0),
        rank: readiness.score >= 80 ? 'Gold' : readiness.score >= 65 ? 'Silver' : readiness.score >= 45 ? 'Bronze' : 'Starter',
        badges,
      },
    });
  }),
);

router.get(
  '/resume-builder',
  asyncHandler(async (req, res) => {
    const versions = await ResumeVersion.findAll({ where: { student_id: req.user._id }, order: [['version', 'DESC']], limit: 20 });
    res.json({
      versions: versions.map(serializeResumeVersion),
    });
  }),
);

router.post(
  '/resume-builder/versions',
  asyncHandler(async (req, res) => {
    const latest = await ResumeVersion.findOne({ where: { student_id: req.user._id }, order: [['version', 'DESC']] });
    const nextVersion = (latest?.version || 0) + 1;
    const payload = {
      title: String(req.body.title || 'Resume').trim().slice(0, 80) || 'Resume',
      target_role: String(req.body.target_role || req.user.interested_role || '').trim().slice(0, 80),
      phone: String(req.body.phone || req.user.phone || '').trim().slice(0, 40),
      email: String(req.body.email || req.user.email || '').trim().slice(0, 120),
      linkedin: String(req.body.linkedin || '').trim().slice(0, 160),
      github: String(req.body.github || '').trim().slice(0, 160),
      location: String(req.body.location || req.user.location || '').trim().slice(0, 80),
      summary: String(req.body.summary || '').trim().slice(0, 1200),
      skills: cleanList(req.body.skills).slice(0, 40),
      experience: cleanResumeSections(req.body.experience, 8),
      education: cleanResumeSections(req.body.education, 6),
      projects: cleanResumeSections(req.body.projects, 8),
      certifications: cleanList(req.body.certifications).slice(0, 20),
      achievements: cleanResumeSections(req.body.achievements, 8),
    };
    const ats = analyzeResumePayload(payload, latest?.ats_analysis?.ats_score || 0);
    const version = await ResumeVersion.create({
      student_id: req.user._id,
      version: nextVersion,
      ...payload,
      ats_analysis: ats,
    });

    res.status(201).json({
      version: serializeResumeVersion(version),
    });
  }),
);

router.get(
  '/resume-builder/versions/:id/pdf',
  asyncHandler(async (req, res) => {
    const version = await ResumeVersion.findOne({ where: { _id: req.params.id, student_id: req.user._id } });
    if (!version) throw notFound('Resume version not found');

    const pdf = await buildPdfBuffer((doc) => {
      const contact = [
        version.phone,
        version.email || req.user.email,
        version.linkedin,
        version.github,
        version.location,
      ].filter(Boolean).join('  |  ');
      doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827').text(req.user.name || 'Student Resume', { align: 'center' });
      doc.moveDown(0.15);
      doc.font('Helvetica').fontSize(8.5).fillColor('#374151').text(contact, { align: 'center' });
      if (version.target_role) {
        doc.moveDown(0.2);
        doc.font('Helvetica-Bold').fontSize(9).text(version.target_role, { align: 'center' });
      }
      doc.moveDown(0.6);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text('Objective');
      doc.moveTo(48, doc.y + 2).lineTo(564, doc.y + 2).strokeColor('#111827').lineWidth(0.5).stroke();
      doc.moveDown(0.45);
      doc.font('Helvetica').fontSize(9).fillColor('#1f2937').text(version.summary || 'No objective added.', { lineGap: 1 });

      for (const [label, sections] of [
        ['Experience', version.experience || []],
        ['Education', version.education || []],
        ['Projects', version.projects || []],
      ]) {
        drawResumeSection(doc, label, sections);
      }

      drawResumeListSection(doc, 'Technical Skills', version.skills || []);
      drawResumeListSection(doc, 'Certifications', version.certifications || []);
      drawResumeSection(doc, 'Achievements', version.achievements || []);
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=resume_v${version.version}.pdf`);
    res.send(pdf);
  }),
);

router.post(
  '/certificates/:milestone/issue',
  asyncHandler(async (req, res) => {
    const milestone = String(req.params.milestone || '');
    const [acceptedProblemSubmissions, submittedAttempts, interviewReports, existingCertificate] = await Promise.all([
      ProgrammingSubmission.findAll({
        where: { student_id: req.user._id, status: 'accepted' },
        attributes: ['problem_id'],
      }),
      AssessmentAttempt.findAll({ where: { student_id: req.user._id, status: 'submitted' } }),
      InterviewReport.findAll({
        where: { student_id: req.user._id },
        attributes: ['overall', 'ats_analysis', 'created_at'],
        order: [['created_at', 'DESC']],
        limit: 50,
      }),
      StudentCertificate.findOne({ where: { student_id: req.user._id, milestone } }),
    ]);

    const acceptedProblemIds = [...new Set(acceptedProblemSubmissions.map(s => s.problem_id))];

    const assessmentIds = [...new Set(submittedAttempts.map(a => a.assessment_id).filter(Boolean))];
    if (assessmentIds.length) {
      const assessments = await Assessment.findAll({
        where: { _id: assessmentIds },
        attributes: ['_id', 'passing_marks'],
      });
      const assessmentMap = Object.fromEntries(assessments.map(a => [a._id, a]));
      submittedAttempts.forEach(a => {
        if (assessmentMap[a.assessment_id]) {
          a.setDataValue('assessment_id', assessmentMap[a.assessment_id]);
        }
      });
    }

    if (existingCertificate) {
      res.json({ certificate: existingCertificate });
      return;
    }

    const interviewScores = interviewReports.map((report) => Number(report.overall?.percentage || 0)).filter(Number.isFinite);
    const avgInterview = interviewScores.length ? interviewScores.reduce((sum, value) => sum + value, 0) / interviewScores.length : 0;
    const resumeScore = Math.max(...interviewReports.map((report) => Number(report.ats_analysis?.ats_score || 0)), 0);
    const passedAttempts = submittedAttempts.filter((attempt) => attempt.score >= (attempt.assessment_id?.passing_marks || 0)).length;
    const eligibility = {
      coding_50: acceptedProblemIds.length >= 50,
      aptitude_passed: passedAttempts > 0,
      interview_readiness_75: avgInterview >= 75,
      placement_track_complete: acceptedProblemIds.length >= 50 && passedAttempts > 0 && avgInterview >= 75 && resumeScore >= 70,
    };
    if (!eligibility[milestone]) throw forbidden('Milestone is not eligible for certificate generation yet.');

    const titles = {
      coding_50: '50 Coding Problems Solved',
      aptitude_passed: 'Aptitude Assessment Passed',
      interview_readiness_75: 'Interview Readiness Certificate',
      placement_track_complete: 'Full Placement Preparation Track',
    };
    const score = milestone === 'coding_50'
      ? acceptedProblemIds.length
      : milestone === 'aptitude_passed'
        ? passedAttempts
        : milestone === 'interview_readiness_75'
          ? avgInterview
          : 100;
    const certificate = await StudentCertificate.create({
      student_id: req.user._id,
      milestone,
      title: titles[milestone],
      description: `${req.user.name} completed the ${titles[milestone]} milestone.`,
      score: Math.round(score),
    });
    res.status(201).json({ certificate });
  }),
);

router.get(
  '/certificates/:id/pdf',
  asyncHandler(async (req, res) => {
    const certificate = await StudentCertificate.findOne({ where: { _id: req.params.id, student_id: req.user._id } });
    if (!certificate) throw notFound('Certificate not found');
    const pdf = await buildPdfBuffer((doc) => {
      doc.rect(36, 36, 540, 720).stroke('#059669');
      doc.moveDown(5);
      doc.font('Helvetica-Bold').fontSize(26).fillColor('#064e3b').text('Certificate of Achievement', { align: 'center' });
      doc.moveDown(2);
      doc.font('Helvetica').fontSize(14).fillColor('#334155').text('This certifies that', { align: 'center' });
      doc.moveDown();
      doc.font('Helvetica-Bold').fontSize(24).fillColor('#0f172a').text(req.user.name || 'Student', { align: 'center' });
      doc.moveDown();
      doc.font('Helvetica').fontSize(13).fillColor('#334155').text(`has completed ${certificate.title}`, { align: 'center' });
      doc.moveDown();
      doc.text(certificate.description || '', { align: 'center' });
      doc.moveDown(2);
      doc.font('Helvetica-Bold').text(`Issued: ${new Date(certificate.issued_at).toLocaleDateString()}`, { align: 'center' });
      doc.text(`Score: ${certificate.score}`, { align: 'center' });
      doc.moveDown(4);
      doc.font('Helvetica-Bold').fillColor('#064e3b').text('Edvolve', { align: 'center' });
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=certificate_${certificate.milestone}.pdf`);
    res.send(pdf);
  }),
);

router.post(
  '/proctoring/events',
  asyncHandler(async (req, res) => {
    const assessmentType = String(req.body.assessment_type || 'aptitude');
    const eventType = String(req.body.event_type || '');
    if (!['aptitude', 'programming'].includes(assessmentType)) throw badRequest('Invalid assessment type');
    if (!['tab_switch', 'fullscreen_exit', 'copy', 'paste', 'webcam_snapshot', 'manual'].includes(eventType)) {
      throw badRequest('Invalid proctoring event');
    }

    const AttemptModel = assessmentType === 'programming' ? ProgrammingAssessmentAttempt : AssessmentAttempt;
    const attempt = await AttemptModel.findByPk(req.body.attempt_id);
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.student_id.toString() !== req.user._id.toString()) throw forbidden();

    const severity = ['tab_switch', 'fullscreen_exit'].includes(eventType) ? 'medium' : ['copy', 'paste'].includes(eventType) ? 'high' : 'low';
    const event = await ProctoringEvent.create({
      attempt_id: attempt._id,
      assessment_type: assessmentType,
      student_id: req.user._id,
      event_type: eventType,
      severity,
      metadata: req.body.metadata || {},
    });
    const count = await ProctoringEvent.count({ where: { attempt_id: attempt._id, assessment_type: assessmentType } });
    res.status(201).json({
      event: {
        id: event._id,
        event_type: event.event_type,
        severity: event.severity,
        occurred_at: event.occurred_at,
      },
      total_events: count,
    });
  }),
);

router.get(
  '/assessments',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const filter = {
      status: 'published',
      is_deleted: { [Op.ne]: true },
    };
    if (req.user.institutionId) {
      filter.institutionId = req.user.institutionId;
    }

    if (req.user.department_id) {
      const deptId = String(req.user.department_id);
      filter[Op.or] = [
        { target_audience: { [Op.or]: ['all', null] } },
        {
          target_audience: 'department',
          department_ids: { [Op.contains]: [deptId] },
        },
      ];
    }

    const assessments = await Assessment.findAll({ where: filter, order: [['created_at', 'DESC']] });

    console.log(`Fetched ${assessments.length} published assessments for student dashboard`);
    res.json({ assessments: await Promise.all(assessments.map(serializeAssessment)) });
  }),
);

router.post(
  '/assessments/:id/start',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const assessment = await Assessment.findByPk(req.params.id);
    if (!assessment || assessment.is_deleted) throw notFound('Assessment not found');
    ensureAvailable(assessment);

    const existingSubmitted = await AssessmentAttempt.findOne({
      where: {
        assessment_id: assessment._id,
        student_id: req.user._id,
        status: 'submitted',
      },
    });

    if (existingSubmitted) {
      throw forbidden('You have already submitted this assessment and cannot retake it.');
    }

    let attempt = await AssessmentAttempt.findOne({
      where: {
        assessment_id: assessment._id,
        student_id: req.user._id,
        status: 'in_progress',
      },
    });

    if (!attempt) {
      attempt = await AssessmentAttempt.create({
        assessment_id: assessment._id,
        student_id: req.user._id,
      });
    }

    const questions = await Question.findAll({ where: { assessment_id: assessment._id }, order: [['created_at', 'ASC']] });
    const answers = await StudentAnswer.findAll({ where: { attempt_id: attempt._id } });
    const selected = Object.fromEntries(
      answers.map((answer) => [answer.question_id, answer.selected_option]),
    );

    res.json({
      assessment: await serializeAssessment(assessment),
      attempt: {
        id: attempt._id,
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
    const attempt = await AssessmentAttempt.findByPk(req.params.attemptId);
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.student_id.toString() !== req.user._id.toString()) throw forbidden();

    const assessment = await Assessment.findByPk(attempt.assessment_id, {
      attributes: ['_id', 'duration_minutes'],
    });
    attempt.setDataValue('assessment_id', assessment);

    res.json({
      attempt: {
        id: attempt._id,
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

    const attempt = await AssessmentAttempt.findByPk(req.params.attemptId);
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.student_id.toString() !== req.user._id.toString()) throw forbidden();
    if (attempt.status !== 'in_progress') throw badRequest('Attempt already submitted');

    const question = await Question.findByPk(question_id);
    if (!question || question.assessment_id.toString() !== attempt.assessment_id.toString()) {
      throw badRequest('Question does not belong to this attempt');
    }

    const [answerRecord] = await StudentAnswer.findOrCreate({
      where: { attempt_id: attempt._id, question_id: question._id },
      defaults: { selected_option: selected_option ?? null },
    });
    if (answerRecord.selected_option !== selected_option) {
      answerRecord.selected_option = selected_option;
      await answerRecord.save();
    }

    res.json({ saved: true });
  }),
);

router.post(
  '/attempts/:attemptId/submit',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const attempt = await AssessmentAttempt.findByPk(req.params.attemptId);
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.student_id.toString() !== req.user._id.toString()) throw forbidden();

    const assessment = await Assessment.findByPk(attempt.assessment_id);
    if (!assessment) throw notFound('Assessment not found');

    if (attempt.status === 'submitted') {
      return res.json({ attempt });
    }

    const questions = await Question.findAll({ where: { assessment_id: assessment._id } });
    const evaluated = await evaluateAttempt(attempt, assessment, questions);
    res.json({ attempt: evaluated });
  }),
);

router.get(
  '/results',
  requireModuleAccess('aptitude'),
  asyncHandler(async (req, res) => {
    const attempts = await AssessmentAttempt.findAll({
      where: {
        student_id: req.user._id,
        status: 'submitted',
      },
      order: [['submitted_at', 'DESC']],
    });

    const assessmentIds = [...new Set(attempts.map(a => a.assessment_id).filter(Boolean))];
    if (assessmentIds.length) {
      const assessments = await Assessment.findAll({
        where: { _id: assessmentIds },
        attributes: ['_id', 'title', 'concept', 'difficulty', 'passing_marks', 'total_marks'],
      });
      const assessmentMap = Object.fromEntries(assessments.map(a => [a._id, a]));
      attempts.forEach(a => {
        if (assessmentMap[a.assessment_id]) {
          a.setDataValue('assessment_id', assessmentMap[a.assessment_id]);
        }
      });
    }

    res.json({
      results: attempts.map((attempt) => ({
        id: attempt._id,
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
    const attempt = await AssessmentAttempt.findByPk(req.params.attemptId);
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.student_id.toString() !== req.user._id.toString()) throw forbidden();
    if (attempt.status !== 'submitted') throw forbidden('Results are available after submission');

    const assessment = await Assessment.findByPk(attempt.assessment_id, {
      attributes: ['_id', 'title', 'concept', 'difficulty', 'total_marks', 'passing_marks'],
    });
    attempt.setDataValue('assessment_id', assessment);

    const questions = await Question.findAll({
      where: { assessment_id: attempt.assessment_id._id },
      order: [['created_at', 'ASC']],
    });
    const answers = await StudentAnswer.findAll({ where: { attempt_id: attempt._id } });
    const answerMap = new Map(
      answers.map((answer) => [answer.question_id, answer]),
    );

    const byTopic = {};
    const details = questions.map((question) => {
      const answer = answerMap.get(question._id);
      if (!byTopic[question.concept]) {
        byTopic[question.concept] = { concept: question.concept, correct: 0, total: 0, score: 0 };
      }
      byTopic[question.concept].total += 1;
      byTopic[question.concept].score += answer?.marks_awarded || 0;
      if (answer?.is_correct) byTopic[question.concept].correct += 1;

      return {
        id: question._id,
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
        id: attempt._id,
        score: attempt.score,
        percentage: attempt.percentage,
        passed: attempt.score >= attempt.assessment_id.passing_marks,
        started_at: attempt.started_at,
        submitted_at: attempt.submitted_at,
      },
      assessment: {
        id: attempt.assessment_id._id,
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
