import express from 'express';
import PDFDocument from 'pdfkit';
import { requireAuth, requireModuleAccess, requireRole } from '../middleware/auth.js';
import { ROLES } from '../utils/roles.js';
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
  CommunicationReport,
} from '../../database/index.js';
import { evaluateAttempt } from '../services/scoringService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';
import { toStudentQuestion } from '../utils/questionValidation.js';
import { INVALID_PROBLEM_TITLE_PATTERN } from '../../programming/utils/problemVisibility.js';

const router = express.Router();

router.use(requireAuth, requireRole(ROLES.STUDENT, ROLES.INDIVIDUAL_STUDENT));

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
    assigned_student_ids: assessment.assigned_student_ids || null,
  };
}
function ensureAvailable(assessment, student) {
  const now = new Date();
  if (assessment.is_deleted) throw forbidden('Assessment is no longer available');
  if (assessment.status !== 'published') throw forbidden('Assessment is not published');

  if (student?.institutionId && assessment.institutionId && assessment.institutionId.toString() !== student.institutionId.toString()) {
    throw forbidden('Assessment is not available in your institution');
  }
  if (student?.role === 'student' && student?.department_id && assessment.department_ids?.length) {
    if (!assessment.department_ids.includes(student.department_id)) {
      throw forbidden('Assessment is not available for your department');
    }
  }
  if (student?.role === 'individual_student' && assessment.target_audience === 'individual') {
    if (Array.isArray(assessment.assigned_student_ids) && assessment.assigned_student_ids.length > 0) {
      if (!assessment.assigned_student_ids.includes(student._id)) {
        throw forbidden('Assessment is not assigned to you');
      }
    }
  }

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
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysBetween(dateKeyA, dateKeyB) {
  const a = new Date(`${dateKeyA}T00:00:00`).getTime();
  const b = new Date(`${dateKeyB}T00:00:00`).getTime();
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
  const role = (payload.target_role || '').toLowerCase().trim();
  const sections = [
    payload.summary,
    ...(payload.experience || []).flatMap((section) => [section.title, ...(section.items || [])]),
    ...(payload.projects || []).flatMap((section) => [section.title, ...(section.items || [])]),
    ...(payload.education || []).flatMap((section) => [section.title, ...(section.items || [])]),
    ...(payload.achievements || []).flatMap((section) => [section.title, ...(section.items || [])]),
    ...(payload.certifications || []),
  ].map((item) => String(item || '').trim()).filter(Boolean);

  const allText = sections.join(' ').toLowerCase();
  const actionVerbs = ['led', 'built', 'improved', 'reduced', 'designed', 'deployed', 'automated', 'developed', 'created', 'implemented', 'optimized', 'architected', 'engineered', 'delivered', 'managed', 'coordinated', 'launched', 'scaled', 'migrated', 'integrated', 'configured'];
  const measurablePattern = /\b\d+%|\b\d+\+|\b\d+x\b|\$\d+/i;

  const roleKeywords = {
    'software engineer': { tech: ['javascript', 'python', 'java', 'react', 'node', 'sql', 'aws', 'docker', 'git', 'rest', 'api', 'microservices', 'ci/cd', 'typescript', 'mongodb', 'kubernetes'], concepts: ['agile', 'testing', 'system design', 'data structures', 'algorithms', 'code review', 'oop'] },
    'frontend engineer': { tech: ['javascript', 'typescript', 'react', 'vue', 'angular', 'html', 'css', 'redux', 'webpack', 'rest api', 'responsive', 'testing', 'sass'], concepts: ['accessibility', 'performance', 'browser', 'ui/ux', 'responsive design', 'cross-browser', 'state management'] },
    'backend engineer': { tech: ['node.js', 'python', 'java', 'go', 'postgresql', 'mongodb', 'redis', 'aws', 'docker', 'kubernetes', 'graphql', 'rest', 'kafka'], concepts: ['microservices', 'api design', 'scalability', 'caching', 'database design', 'authentication', 'ci/cd'] },
    'full stack': { tech: ['javascript', 'typescript', 'react', 'node', 'python', 'sql', 'aws', 'docker', 'git', 'rest', 'html', 'css', 'mongodb'], concepts: ['full stack', 'agile', 'testing', 'devops', 'api', 'deployment', 'authentication'] },
    'data scientist': { tech: ['python', 'r', 'sql', 'tensorflow', 'pytorch', 'scikit-learn', 'pandas', 'numpy', 'hadoop', 'spark', 'tableau', 'aws'], concepts: ['machine learning', 'statistics', 'nlp', 'deep learning', 'a/b testing', 'data pipeline', 'visualization'] },
    'data engineer': { tech: ['python', 'sql', 'spark', 'airflow', 'kafka', 'hadoop', 'aws', 'gcp', 'docker', 'postgresql', 'bigquery', 'snowflake'], concepts: ['etl', 'data pipeline', 'data warehouse', 'orchestration', 'data modeling', 'streaming', 'batch processing'] },
    'devops engineer': { tech: ['aws', 'gcp', 'azure', 'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins', 'gitlab', 'prometheus', 'linux', 'helm'], concepts: ['ci/cd', 'infrastructure', 'monitoring', 'automation', 'containerization', 'cloud', 'incident response'] },
    'product manager': { tech: ['jira', 'confluence', 'figma', 'sql', 'excel', 'amplitude', 'mixpanel', 'github'], concepts: ['roadmap', 'stakeholder', 'agile', 'user research', 'a/b testing', 'analytics', 'strategy', 'sprint'] },
    'ui/ux designer': { tech: ['figma', 'sketch', 'adobe xd', 'framer', 'prototype', 'user research', 'wireframe', 'design system'], concepts: ['accessibility', 'usability', 'information architecture', 'user flows', 'visual design', 'responsive'] },
    'quality assurance': { tech: ['selenium', 'cypress', 'jest', 'junit', 'postman', 'testrail', 'jira', 'sql'], concepts: ['automation', 'regression', 'integration testing', 'test planning', 'bug tracking', 'performance testing'] },
    'mobile engineer': { tech: ['swift', 'kotlin', 'react native', 'flutter', 'android', 'ios', 'xcode', 'firebase'], concepts: ['mobile', 'app architecture', 'push notifications', 'offline', 'app store', 'performance'] },
    'security engineer': { tech: ['python', 'go', 'aws', 'kubernetes', 'linux', 'burp suite', 'wireshark', 'owasp'], concepts: ['vulnerability', 'penetration testing', 'threat model', 'security audit', 'compliance', 'incident response'] },
    'machine learning engineer': { tech: ['python', 'tensorflow', 'pytorch', 'scikit', 'mlflow', 'kubeflow', 'aws sagemaker', 'docker'], concepts: ['mlops', 'model deployment', 'feature engineering', 'training pipeline', 'a/b testing', 'monitoring'] },
    'systems engineer': { tech: ['linux', 'aws', 'python', 'bash', 'docker', 'kubernetes', 'ansible', 'terraform'], concepts: ['infrastructure', 'automation', 'monitoring', 'scalability', 'high availability', 'performance'] },
    'site reliability engineer': { tech: ['kubernetes', 'docker', 'prometheus', 'grafana', 'terraform', 'python', 'go', 'linux'], concepts: ['sli', 'slo', 'incident management', 'on-call', 'chaos engineering', 'capacity planning'] },
    'cloud engineer': { tech: ['aws', 'azure', 'gcp', 'terraform', 'docker', 'kubernetes', 'cloudformation', 'python'], concepts: ['migration', 'architecture', 'networking', 'cost optimization', 'security', 'serverless'] },
    'embedded engineer': { tech: ['c', 'c++', 'python', 'rtos', 'linux', 'arm', 'microcontroller', 'i2c'], concepts: ['firmware', 'hardware', 'driver', 'realtime', 'protocol', 'signal processing'] },
    'ios engineer': { tech: ['swift', 'objective-c', 'xcode', 'cocoa', 'swiftui', 'core data', 'alamofire', 'firebase'], concepts: ['app architecture', 'app store', 'push', 'offline', 'testing', 'ui kit'] },
    'android engineer': { tech: ['kotlin', 'java', 'android studio', 'jetpack', 'compose', 'gradle', 'firebase', 'dagger'], concepts: ['mvvm', 'clean architecture', 'app store', 'testing', 'material design'] },
    'ai engineer': { tech: ['python', 'tensorflow', 'pytorch', 'langchain', 'openai', 'huggingface', 'docker', 'aws'], concepts: ['llm', 'nlp', 'computer vision', 'fine-tuning', 'rag', 'agent', 'prompt engineering'] },
  };

  const matchedRole = Object.keys(roleKeywords).find((roleKey) => role.includes(roleKey) || roleKey.includes(role));
  const keywords = matchedRole ? roleKeywords[matchedRole] : null;

  let keywordMatches = 0;
  let keywordTotal = 0;
  let missingKeywords = [];

  if (keywords) {
    keywordTotal = keywords.tech.length + keywords.concepts.length;
    const allJobText = allText + ' ' + skills.map((s) => s.toLowerCase()).join(' ');
    for (const kw of keywords.tech) {
      if (allJobText.includes(kw) || skills.some((s) => s.toLowerCase().includes(kw) || kw.includes(s.toLowerCase()))) {
        keywordMatches++;
      } else {
        missingKeywords.push(kw);
      }
    }
    for (const kw of keywords.concepts) {
      if (allJobText.includes(kw)) {
        keywordMatches++;
      } else {
        missingKeywords.push(kw);
      }
    }
  }

  let score = 25;
  let sectionScores = {};

  if (payload.target_role) { score += 8; sectionScores.targetRole = 8; } else { sectionScores.targetRole = 0; }
  if (payload.summary && String(payload.summary).length >= 80) { score += 10; sectionScores.summary = 10; }
  else if (payload.summary && String(payload.summary).length >= 40) { score += 5; sectionScores.summary = 5; }
  else { sectionScores.summary = 0; }

  const skillScore = Math.min(skills.length * 2.5, 15);
  score += skillScore;
  sectionScores.skills = skillScore;

  if ((payload.experience || []).length) {
    const expScore = Math.min((payload.experience || []).reduce((sum, e) => sum + ((e.items || []).length > 0 ? 5 : 0), 0), 15);
    score += expScore;
    sectionScores.experience = expScore;
  } else { sectionScores.experience = 0; }

  if ((payload.projects || []).length) {
    const projScore = Math.min((payload.projects || []).reduce((sum, p) => sum + ((p.items || []).length > 0 ? 4 : 0), 0), 12);
    sectionScores.projects = projScore;
    score += projScore;
  } else { sectionScores.projects = 0; }

  if ((payload.achievements || []).length) { score += 4; sectionScores.achievements = 4; } else { sectionScores.achievements = 0; }
  if ((payload.certifications || []).length) { score += 3; sectionScores.certifications = 3; } else { sectionScores.certifications = 0; }

  const actionWordCount = actionVerbs.filter((v) => allText.includes(v)).length;
  const actionScore = Math.min(actionWordCount * 3, 9);
  score += actionScore;
  sectionScores.actionVerbs = actionScore;

  const measurableScore = sections.some((item) => measurablePattern.test(item)) ? 6 : 0;
  score += measurableScore;
  sectionScores.measurableOutcomes = measurableScore;

  if (keywords) {
    const keywordPct = keywordTotal > 0 ? Math.round((keywordMatches / keywordTotal) * 100) : 0;
    const kwScore = Math.round(keywordPct * 0.12);
    score += kwScore;
    sectionScores.keywordMatch = kwScore;
  } else {
    sectionScores.keywordMatch = 0;
  }

  const linkedinPresent = payload.linkedin && String(payload.linkedin).trim().length > 0 ? 3 : 0;
  const githubPresent = payload.github && String(payload.github).trim().length > 0 ? 2 : 0;
  score += linkedinPresent + githubPresent;
  sectionScores.contactLinks = linkedinPresent + githubPresent;

  score = clampScore(Math.round(score));

  const improvements = [];
  const strengths = [];

  if (!payload.target_role) improvements.push('Add a target role so resume can be evaluated against a placement goal.');
  if (!payload.summary || String(payload.summary).length < 80) improvements.push('Write a 3-4 line professional summary with role, skills, and measurable impact.');
  if (skills.length < 6) improvements.push(`Add at least 6 role-relevant technical and soft skills (${skills.length} found).`);
  if (!(payload.projects || []).length) improvements.push('Add 1-2 projects with tools used, problem solved, and outcome.');
  if (!sections.some((item) => measurablePattern.test(item))) improvements.push('Add measurable outcomes such as percentages, counts, revenue, or scale.');
  if (actionWordCount < 3) improvements.push(`Use strong action verbs (led, built, improved) — only ${actionWordCount} found.`);
  if (keywords && missingKeywords.length > 5) improvements.push(`Target keywords missing: ${missingKeywords.slice(0, 6).join(', ')}. Add these to your skills and experience.`);
  if (!payload.linkedin) improvements.push('Add your LinkedIn URL — recruiters expect it.');
  if ((payload.experience || []).every((e) => !(e.items || []).length)) improvements.push('Add bullet details under each experience entry.');

  if (payload.summary) strengths.push('Professional summary included');
  if (skills.length >= 6) strengths.push('Strong skills coverage');
  if ((payload.projects || []).length) strengths.push('Project evidence included');
  if (actionWordCount >= 3) strengths.push('Action verbs used throughout');
  if (sections.some((item) => measurablePattern.test(item))) strengths.push('Measurable outcomes included');
  if (keywords && keywordMatches > keywordTotal * 0.5) strengths.push('Good role-relevant keyword density');

  return {
    ats_score: clampScore(score),
    previous_score: clampScore(previousScore),
    score_breakdown: sectionScores,
    keyword_matches: keywords ? { matched: keywordMatches, total: keywordTotal, found: keywords.tech.filter((k) => allText.includes(k) || skills.some((s) => s.toLowerCase().includes(k))), missing: missingKeywords.slice(0, 8) } : null,
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
    const hasCommunication = userModules.includes('communication') || userModules.includes('both');
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
      const assessmentBaseFilter = { status: 'published', is_deleted: { [Op.ne]: true } };
      if (req.user.institutionId) {
        assessmentBaseFilter.institutionId = req.user.institutionId;
      }
      if (req.user.role === 'student' && req.user.department_id) {
        assessmentBaseFilter[Op.or] = [
          { department_ids: null },
          { department_ids: { [Op.contains]: [req.user.department_id] } },
        ];
      }
      const aptitudeResults = await Promise.all([
        Assessment.count({ where: assessmentBaseFilter }),
        AssessmentAttempt.count({ where: { student_id: req.user._id, status: 'submitted' } }),
        AssessmentAttempt.findAll({ where: { student_id: req.user._id, status: 'submitted' } }),
        AssessmentAttempt.findAll({
          where: { student_id: req.user._id, status: 'in_progress' },
          order: [['updated_at', 'DESC'], ['started_at', 'DESC']],
          limit: 5,
        }),
        Assessment.findOne({
          where: assessmentBaseFilter,
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

    let communicationAnalytics = null;
    if (hasCommunication) {
      const commReports = await CommunicationReport.findAll({
        where: { student_id: req.user._id },
        attributes: ['overall'],
      });
      const percentages = commReports
        .map((r) => Number(r.overall?.percentage || 0))
        .filter(Number.isFinite);
      communicationAnalytics = {
        total_sessions: commReports.length,
        average_percentage: percentages.length
          ? Number((percentages.reduce((s, v) => s + v, 0) / percentages.length).toFixed(2))
          : 0,
      };
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

    const activityDates = activity.map((item) => item.occurred_at);
    activityDates.push(new Date());
    const streak = buildStreak(activityDates);
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
      communication: communicationAnalytics,
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
  '/resume-builder/templates',
  asyncHandler(async (req, res) => {
    const templates = [
      { id: 'swe', role: 'Software Engineer', category: 'Engineering', summary: 'Results-driven Software Engineer with 5+ years building scalable distributed systems. Proficient in Java, Python, and cloud-native architectures.', skills: ['Java', 'Python', 'React', 'AWS', 'Docker', 'Kubernetes', 'PostgreSQL', 'Redis', 'Kafka', 'Git', 'CI/CD', 'Microservices'], highlights: ['Designed a real-time event pipeline processing 2M+ events/day with Kafka and Spark', 'Reduced API latency by 40% through query optimization and caching strategies', 'Led migration of monolith to microservices across 12 services with zero downtime'], source: 'Sourabh Bajaj (sb2nov/resume) — MIT License', overleaf_url: 'https://www.overleaf.com/latex/templates/software-engineer-resume/gqxmqsvsbdjf' },
      { id: 'fe', role: 'Frontend Engineer', category: 'Engineering', summary: 'Creative Frontend Engineer specializing in React ecosystems. Passionate about accessible, performant user interfaces.', skills: ['React', 'TypeScript', 'Next.js', 'CSS/Sass', 'Redux', 'GraphQL', 'Jest', 'Webpack', 'Storybook', 'Figma'], highlights: ['Built component library used across 5 product teams, reducing development time by 30%', 'Improved Core Web Vitals (LCP 2.1s → 1.2s) leading to 15% higher conversion', 'Implemented design system with 50+ reusable components documented in Storybook'], overleaf_url: 'https://www.overleaf.com/latex/templates/resume-template/ysrmnrwyrhpp' },
      { id: 'be', role: 'Backend Engineer', category: 'Engineering', summary: 'Backend Engineer experienced in designing high-throughput APIs and data pipelines. Focused on reliability and performance.', skills: ['Node.js', 'Python', 'Go', 'PostgreSQL', 'MongoDB', 'Redis', 'AWS', 'Docker', 'GraphQL', 'Kafka', 'gRPC'], highlights: ['Architected payment system handling $50M+ monthly transaction volume with 99.99% uptime', 'Designed GraphQL API layer reducing frontend data fetching by 60%', 'Built distributed task queue processing 500K+ jobs daily'], overleaf_url: 'https://www.overleaf.com/latex/templates/software-engineer-resume/gqxmqsvsbdjf' },
      { id: 'fs', role: 'Full Stack Developer', category: 'Engineering', summary: 'Versatile Full Stack Developer experienced in building end-to-end web applications and SaaS platforms.', skills: ['JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'PostgreSQL', 'AWS', 'Docker', 'MongoDB', 'Tailwind CSS', 'Git'], highlights: ['Built SaaS platform serving 10K+ users with React frontend and Node.js backend', 'Implemented real-time collaboration features using WebSockets and CRDTs', 'Designed CI/CD pipeline reducing deployment time from 2 hours to 12 minutes'], overleaf_url: 'https://www.overleaf.com/latex/templates/resume-professional-template-software-engineer/ttwtyxskrcsz' },
      { id: 'ds', role: 'Data Scientist', category: 'Data & AI', summary: 'Data Scientist skilled in ML model development, statistical analysis, and building data pipelines for actionable insights.', skills: ['Python', 'R', 'SQL', 'TensorFlow', 'PyTorch', 'scikit-learn', 'Pandas', 'NumPy', 'Spark', 'Tableau', 'Docker'], highlights: ['Developed ML model predicting customer churn with 94% accuracy, saving $2M annually', 'Built automated A/B testing framework reducing experiment analysis time by 70%', 'Created interactive dashboards used by executive team for weekly KPI tracking'], overleaf_url: 'https://www.overleaf.com/latex/templates/data-science-tech-resume-template/zcdmpfxrzjhv' },
      { id: 'mle', role: 'Machine Learning Engineer', category: 'Data & AI', summary: 'MLE focused on deploying and monitoring production ML systems at scale. Experience across the full ML lifecycle.', skills: ['Python', 'TensorFlow', 'PyTorch', 'MLflow', 'Kubeflow', 'AWS SageMaker', 'Docker', 'Kubernetes', 'Spark'], highlights: ['Deployed real-time inference pipeline serving 500K predictions/day with p99 latency <50ms', 'Built feature store unifying ML features across 8 teams, reducing duplication by 60%', 'Implemented model monitoring system detecting data drift within 5 minutes'], overleaf_url: 'https://www.overleaf.com/latex/templates/ats-friendly-technical-resume/yrhtcnjyzgsf' },
      { id: 'aie', role: 'AI Engineer', category: 'Data & AI', summary: 'AI Engineer specializing in LLMs, RAG systems, and agent architectures. Building next-generation AI-powered products.', skills: ['Python', 'LangChain', 'OpenAI API', 'HuggingFace', 'TensorFlow', 'PyTorch', 'Docker', 'Weaviate', 'Redis', 'FastAPI'], highlights: ['Built RAG-based Q&A system processing 10K+ internal documents with 92% answer accuracy', 'Fine-tuned LLM for domain-specific code generation, improving developer velocity by 25%', 'Designed multi-agent orchestration framework for automated customer support workflows'], overleaf_url: 'https://www.overleaf.com/latex/templates/ats-friendly-technical-resume/yrhtcnjyzgsf' },
      { id: 'de', role: 'Data Engineer', category: 'Data & AI', summary: 'Data Engineer experienced in building reliable data pipelines and warehouse solutions at petabyte scale.', skills: ['Python', 'SQL', 'Spark', 'Airflow', 'Kafka', 'dbt', 'Snowflake', 'BigQuery', 'AWS', 'Docker', 'Terraform'], highlights: ['Designed ETL pipeline processing 5TB+ daily data with 99.9% uptime SLA', 'Reduced data warehouse query costs by 45% through partitioning and materialized views', 'Migrated legacy on-premise data warehouse to cloud, saving $800K/year'], overleaf_url: 'https://www.overleaf.com/latex/templates/data-science-tech-resume-template/zcdmpfxrzjhv' },
      { id: 'doe', role: 'DevOps Engineer', category: 'Cloud & Infrastructure', summary: 'DevOps Engineer with deep expertise in CI/CD, container orchestration, and cloud infrastructure automation.', skills: ['AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins', 'Prometheus', 'Grafana', 'Linux'], highlights: ['Reduced deployment time from 45min to 6min with ArgoCD-based GitOps pipeline', 'Managed 200+ node Kubernetes cluster across 3 availability zones with 99.95% uptime', 'Automated infrastructure provisioning reducing new environment setup from 2 weeks to 2 hours'], overleaf_url: 'https://github.com/tarushjreddy/resume-template-format-overleaf' },
      { id: 'ce', role: 'Cloud Engineer', category: 'Cloud & Infrastructure', summary: 'Cloud Engineer focused on architecting secure, cost-optimized multi-cloud infrastructure.', skills: ['AWS', 'GCP', 'Azure', 'Terraform', 'Docker', 'Kubernetes', 'CloudFormation', 'Python', 'Linux', 'Networking'], highlights: ['Migrated 200+ legacy servers to AWS saving $1.2M/year in infrastructure costs', 'Designed multi-region disaster recovery architecture with RTO < 15 minutes', 'Reduced cloud spend by 35% through right-sizing and reserved instance optimization'], overleaf_url: 'https://github.com/tarushjreddy/resume-template-format-overleaf' },
      { id: 'sre', role: 'Site Reliability Engineer', category: 'Cloud & Infrastructure', summary: 'SRE championing reliability through automation, observability, and incident management best practices.', skills: ['Kubernetes', 'Docker', 'Prometheus', 'Grafana', 'Terraform', 'Python', 'Go', 'Linux', 'Helm'], highlights: ['Drove SLO achievement from 95% to 99.95% through systematic error budget enforcement', 'Built automated on-call escalation reducing MTTR from 45min to 12min', 'Implemented chaos engineering program reducing incident severity by 60%'], overleaf_url: 'https://www.overleaf.com/latex/templates/software-engineer-resume/gqxmqsvsbdjf' },
      { id: 'sec', role: 'Security Engineer', category: 'Security', summary: 'Security Engineer with expertise in application security, cloud security, and incident response.', skills: ['Python', 'Go', 'AWS', 'Kubernetes', 'Linux', 'Burp Suite', 'OWASP', 'SIEM', 'Splunk', 'Firewalls'], highlights: ['Discovered and remediated 50+ critical vulnerabilities across production systems', 'Built automated security scanning pipeline integrated into CI/CD, catching 95% of vulns pre-deploy', 'Led SOC 2 Type II compliance effort achieving zero findings in audit'], overleaf_url: 'https://www.overleaf.com/latex/templates/resume-professional-template-software-engineer/ttwtyxskrcsz' },
      { id: 'pm', role: 'Product Manager', category: 'Product & Design', summary: 'Product Manager with 6+ years delivering SaaS products from ideation to launch. Data-driven and user-obsessed.', skills: ['Jira', 'Confluence', 'Figma', 'SQL', 'Amplitude', 'Mixpanel', 'A/B Testing', 'Agile', 'Roadmapping'], highlights: ['Launched 3 high-impact products driving $5M+ ARR in first year', 'Improved NPS from 32 to 68 through systematic user research and iterative design', 'Defined OKR framework adopted across entire product org of 40+ PMs'], overleaf_url: 'https://www.overleaf.com/latex/templates/awesome-cv/dfnvtnhzhhbm' },
      { id: 'ux', role: 'UI/UX Designer', category: 'Product & Design', summary: 'UI/UX Designer creating intuitive, accessible experiences for web and mobile platforms.', skills: ['Figma', 'Sketch', 'Adobe XD', 'Framer', 'User Research', 'Prototyping', 'Design Systems', 'Typography', 'Motion Design'], highlights: ['Designed and maintained design system used by 50+ designers and developers', 'Increased user task completion rate by 35% through accessibility-focused redesign', 'Conducted 100+ user research sessions driving iterative product improvements'], overleaf_url: 'https://www.overleaf.com/latex/templates/awesome-cv/dfnvtnhzhbbm' },
      { id: 'ios', role: 'Mobile Engineer (iOS)', category: 'Mobile', summary: 'iOS Engineer building polished, performant mobile applications using Swift and modern Apple frameworks.', skills: ['Swift', 'SwiftUI', 'UIKit', 'Xcode', 'Core Data', 'Alamofire', 'Firebase', 'Combine', 'App Store', 'CI/CD'], highlights: ['Published 3 apps with cumulative 500K+ downloads and 4.7+ star ratings', 'Optimized cold launch time from 4.2s to 0.8s through lazy loading and caching', 'Implemented CI/CD pipeline with GitHub Actions delivering weekly TestFlight builds'], overleaf_url: 'https://www.overleaf.com/latex/templates/software-engineer-resume/gqxmqsvsbdjf' },
      { id: 'and', role: 'Mobile Engineer (Android)', category: 'Mobile', summary: 'Android Engineer experienced in building robust, user-friendly apps with Kotlin and Jetpack Compose.', skills: ['Kotlin', 'Java', 'Android Studio', 'Jetpack Compose', 'MVVM', 'Dagger', 'Firebase', 'Gradle', 'Room', 'Material Design'], highlights: ['Developed banking app serving 2M+ active users with near-zero crash rate (0.02%)', 'Reduced APK size by 40% through resource optimization and ProGuard rules', 'Migrated legacy codebase from Java to Kotlin across 150K+ lines of code'], overleaf_url: 'https://www.overleaf.com/latex/templates/software-engineer-resume/gqxmqsvsbdjf' },
      { id: 'qa', role: 'Quality Assurance Engineer', category: 'Engineering', summary: 'QA Engineer skilled in test automation, performance testing, and building quality culture across dev teams.', skills: ['Selenium', 'Cypress', 'Jest', 'JUnit', 'Postman', 'TestRail', 'Jira', 'SQL', 'JavaScript', 'Python'], highlights: ['Built end-to-end test suite covering 90%+ of critical user journeys', 'Reduced production defects by 55% through shift-left testing strategy', 'Automated regression suite reducing test execution from 8 hours to 22 minutes'], overleaf_url: 'https://www.overleaf.com/latex/templates/software-engineer-resume/gqxmqsvsbdjf' },
      { id: 'sys', role: 'Systems Engineer', category: 'Engineering', summary: 'Systems Engineer focused on building reliable, high-performance distributed systems infrastructure.', skills: ['Linux', 'AWS', 'Python', 'Bash', 'Docker', 'Kubernetes', 'Ansible', 'Terraform', 'Nginx', 'Monitoring'], highlights: ['Architected HA infrastructure handling 100K+ concurrent users with 99.99% uptime', 'Automated server provisioning reducing deployment time from 4 hours to 8 minutes', 'Designed monitoring stack processing 10TB+ of logs daily with real-time alerting'], overleaf_url: 'https://www.overleaf.com/latex/templates/software-engineering-resume/mcvwcrmddsyw' },
      { id: 'emb', role: 'Embedded Systems Engineer', category: 'Engineering', summary: 'Embedded Systems Engineer with expertise in firmware development, real-time systems, and HW-SW integration.', skills: ['C', 'C++', 'Python', 'RTOS', 'Linux', 'ARM', 'Microcontroller', 'I2C', 'SPI', 'UART', 'FPGA'], highlights: ['Developed bootloader for IoT device fleet reducing field update time by 80%', 'Designed sensor fusion algorithm improving navigation accuracy by 35%', 'Optimized power consumption by 60% through RTOS task scheduling improvements'], overleaf_url: 'https://www.overleaf.com/latex/templates/software-engineering-resume/mcvwcrmddsyw' },
      { id: 'cv', role: 'Computer Vision Engineer', category: 'Data & AI', summary: 'Computer Vision Engineer building real-time image and video analysis systems using deep learning.', skills: ['Python', 'TensorFlow', 'PyTorch', 'OpenCV', 'YOLO', 'Docker', 'CUDA', 'ONNX', 'GStreamer', 'AWS'], highlights: ['Developed real-time object detection pipeline running at 60fps on edge devices', 'Built automated quality inspection system reducing defect escape rate by 90%', 'Deployed video analytics solution processing 1000+ streams concurrently'], overleaf_url: 'https://www.overleaf.com/latex/templates/ats-friendly-technical-resume/yrhtcnjyzgsf' },
      { id: 'nlp', role: 'NLP Engineer', category: 'Data & AI', summary: 'NLP Engineer specializing in transformer models, text classification, and conversational AI systems.', skills: ['Python', 'PyTorch', 'HuggingFace', 'Transformers', 'spaCy', 'LangChain', 'Docker', 'Weaviate', 'FastAPI'], highlights: ['Built multilingual sentiment analysis system achieving 94% accuracy across 15 languages', 'Developed Q&A system reducing customer support response time by 65%', 'Fine-tuned BERT-based NER model for domain-specific entity extraction with F1 0.91'], overleaf_url: 'https://www.overleaf.com/latex/templates/ats-friendly-technical-resume/yrhtcnjyzgsf' },
      { id: 'bc', role: 'Blockchain Developer', category: 'Engineering', summary: 'Blockchain Developer experienced in smart contract development, DeFi protocols, and distributed ledger technology.', skills: ['Solidity', 'JavaScript', 'TypeScript', 'web3.js', 'Ethers.js', 'Hardhat', 'React', 'Node.js', 'IPFS'], highlights: ['Developed DeFi smart contracts managing $10M+ in TVL with zero security incidents', 'Built NFT marketplace handling 50K+ transactions, optimizing gas costs by 30%', 'Audited 20+ smart contracts identifying 40+ vulnerabilities pre-deployment'], overleaf_url: 'https://www.overleaf.com/latex/templates/resume-template/ysrmnrwyrhpp' },
      { id: 'plat', role: 'Platform Engineer', category: 'Cloud & Infrastructure', summary: 'Platform Engineer building internal developer platforms that accelerate delivery across engineering orgs.', skills: ['Kubernetes', 'Go', 'Docker', 'Terraform', 'GitHub Actions', 'ArgoCD', 'Crossplane', 'Backstage'], highlights: ['Built IDP used by 30+ teams, reducing new service setup from weeks to hours', 'Implemented golden path templates standardizing deployments across 100+ microservices', 'Reduced developer onboarding time from 2 weeks to 2 days through self-service platform'], overleaf_url: 'https://github.com/tarushjreddy/resume-template-format-overleaf' },
      { id: 'em', role: 'Engineering Manager', category: 'Leadership', summary: 'Engineering Manager leading high-performing teams through technical strategy, mentorship, and delivery excellence.', skills: ['Agile', 'Project Management', 'System Design', 'Code Review', 'Mentoring', 'OKRs', 'Jira', 'Confluence'], highlights: ['Led team of 12 engineers delivering 3 major product releases on schedule with <5% defect rate', 'Established engineering standards adopted across entire organization of 80+ engineers', 'Improved team velocity by 40% through process improvements and eliminating bottlenecks'], overleaf_url: 'https://www.overleaf.com/latex/templates/awesome-cv/dfnvtnhzhbbm' },
      { id: 'tpm', role: 'Technical Program Manager', category: 'Leadership', summary: 'TPM orchestrating cross-functional programs from planning through execution across multiple teams.', skills: ['Program Management', 'Agile', 'Jira', 'Risk Management', 'Stakeholder Mgmt', 'SQL', 'Confluence', 'Asana'], highlights: ['Drove 6-month cross-team initiative migrating 50+ teams and 200+ services with zero critical incidents', 'Reduced project delivery latency by 40% through improved dependency tracking and risk monitoring', 'Managed $10M+ program budget ensuring all milestones delivered on time and under budget'], overleaf_url: 'https://www.overleaf.com/latex/templates/awesome-cv/dfnvtnhzhbbm' },
      { id: 'dba', role: 'Database Administrator', category: 'Engineering', summary: 'DBA ensuring database reliability, performance, and security across OLTP and OLAP workloads at scale.', skills: ['PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Cassandra', 'AWS RDS', 'DynamoDB', 'Query Optimization', 'Replication'], highlights: ['Optimized slow queries reducing p99 latency from 2s to 50ms, improving application performance', 'Designed multi-region database replication strategy with RPO < 5 minutes', 'Migrated 50TB+ of data from on-premise to cloud with zero downtime'], overleaf_url: 'https://www.overleaf.com/latex/templates/software-engineering-resume/mcvwcrmddsyw' },
      { id: 'net', role: 'Network Engineer', category: 'Cloud & Infrastructure', summary: 'Network Engineer designing and maintaining secure, high-performance enterprise and cloud networks.', skills: ['Cisco', 'Juniper', 'AWS VPC', 'Terraform', 'BGP', 'OSPF', 'TCP/IP', 'Load Balancers', 'Firewalls', 'DNS'], highlights: ['Designed multi-region network topology supporting 10K+ endpoints with 99.99% availability', 'Reduced incident response time from 30min to 5min through automated monitoring and alerting', 'Cut network costs by 25% by redesigning data transfer architecture between regions'], overleaf_url: 'https://www.overleaf.com/latex/templates/software-engineering-resume/mcvwcrmddsyw' },
      { id: 'tse', role: 'Technical Support Engineer', category: 'Engineering', summary: 'Technical Support Engineer bridging customers and engineering to resolve complex issues at scale.', skills: ['Linux', 'SQL', 'Python', 'Bash', 'APIs', 'Postman', 'Zendesk', 'Jira', 'Monitoring', 'Docker'], highlights: ['Resolved 2K+ complex support tickets with 95% CSAT score and <4hr avg response time', 'Built automated diagnostic tools reducing mean resolution time by 50%', 'Created internal knowledge base adopted by 20+ team members reducing escalations by 35%'], overleaf_url: 'https://www.overleaf.com/latex/templates/resume-professional-template-software-engineer/tswtyxskrcsz' },
      { id: 'int', role: 'Engineering Intern', category: 'Internships', summary: 'Motivated CS student with strong fundamentals in data structures, algorithms, and full-stack development.', skills: ['JavaScript', 'Python', 'React', 'Java', 'SQL', 'Git', 'HTML/CSS', 'Node.js', 'Data Structures', 'Algorithms', 'OOP'], highlights: ['Developed production feature used by 10K+ users during internship at mid-size tech company', 'Won internal hackathon with AI-powered code review tool adopted by 2 engineering teams', 'Contributed 15+ PRs to open source project with 5K+ GitHub stars'], overleaf_url: 'https://www.overleaf.com/latex/templates/resume-for-freshers/qpvkfqjfycgg' },
      { id: 'scrum', role: 'Scrum Master', category: 'Leadership', summary: 'Certified Scrum Master enabling high-performing teams through agile coaching and continuous improvement.', skills: ['Scrum', 'Kanban', 'Jira', 'Confluence', 'Agile', 'Facilitation', 'Conflict Resolution', 'Coaching', 'Lean'], highlights: ['Led agile transformation for 4 teams, improving velocity by 35% within 3 sprints', 'Facilitated 100+ sprint ceremonies with consistent 4.5/5 feedback scores', 'Coached 20+ team members in agile practices reducing blockers by 60%'], overleaf_url: 'https://www.overleaf.com/latex/templates/awesome-cv/dfnvtnhzhbbm' },
      { id: 'csa', role: 'Cybersecurity Analyst', category: 'Security', summary: 'Cybersecurity Analyst experienced in vulnerability management, SOC operations, and threat intelligence.', skills: ['Python', 'SIEM', 'Splunk', 'Wireshark', 'Burp Suite', 'Nmap', 'Metasploit', 'Linux', 'OWASP Top 10', 'Incident Response'], highlights: ['Identified and mitigated critical data exposure vulnerability affecting 1M+ user records', 'Built automated incident playbook reducing mean detection time from 3 days to 15 minutes', 'Led tabletop exercises for executive team improving org-wide incident readiness score by 40%'], overleaf_url: 'https://www.overleaf.com/latex/templates/resume-professional-template-software-engineer/tswtyxskrcsz' },
    ];
    res.json({ templates });
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

    const isLatex = req.query.format === 'latex';

    if (isLatex) {
      const sanitize = (s) => (s || '').replace(/&/g, '\\&').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/#/g, '\\#').replace(/\$/g, '\\$').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
      const escape = sanitize;
      const safeName = escape(req.user.name || 'Student');
      const safeRole = escape(version.target_role || '');
      const safePhone = escape(version.phone || '');
      const safeEmail = escape(version.email || req.user.email || '');
      const safeLinkedin = escape(version.linkedin || '');
      const safeGithub = escape(version.github || '');
      const safeLocation = escape(version.location || '');
      const safeSummary = escape(version.summary || '');

      const contactParts = [safePhone, safeEmail, safeLinkedin, safeGithub, safeLocation].filter(Boolean);
      const contactLine = contactParts.join(' \\textbar{} ');

      const safeSkills = (version.skills || []).map(escape).join(', ');

      function toLatexItems(items = []) {
        return items.filter(Boolean).map((item) => `\\resumeItem{${escape(item)}}`).join('\n');
      }

      function toLatexSections(sections = [], titleKey = 'title') {
        return sections.filter((s) => s.title || (s.items || []).length).map((s) =>
          `\\resumeSubheading\n  {${escape(s.title || '')}}{}\n  {}{}\n  \\resumeItemListStart\n${(s.items || []).filter(Boolean).map((item) => `    \\resumeItem{${escape(item)}}`).join('\n')}\n  \\resumeItemListEnd`
        ).join('\n');
      }

      const tex = `%-------------------------
% Resume in LaTeX
% Generated by Edvols Resume Builder
% Based on sb2nov/resume (MIT License)
%-------------------------
\\documentclass[letterpaper,11pt]{article}

\\usepackage{latexsym}
\\usepackage[empty]{fullpage}
\\usepackage{titlesec}
\\usepackage{marvosym}
\\usepackage[usenames,dvipsnames]{color}
\\usepackage{verbatim}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fancyhdr}
\\usepackage[english]{babel}
\\usepackage{tabularx}
\\input{glyphtounicode}

\\pagestyle{fancy}
\\fancyhf{}
\\fancyfoot{}
\\renewcommand{\\headrulewidth}{0pt}
\\renewcommand{\\footrulewidth}{0pt}
\\addtolength{\\oddsidemargin}{-0.5in}
\\addtolength{\\evensidemargin}{-0.5in}
\\addtolength{\\textwidth}{1in}
\\addtolength{\\topmargin}{-.5in}
\\addtolength{\\textheight}{1.0in}
\\urlstyle{same}
\\raggedbottom
\\raggedright
\\setlength{\\tabcolsep}{0in}
\\titleformat{\\section}{\\vspace{-4pt}\\scshape\\raggedright\\large}{}{0em}{}[\\color{black}\\titlerule\\vspace{-5pt}]
\\pdfgentounicode=1

\\newcommand{\\resumeItem}[1]{\\item\\small{#1 \\vspace{-2pt}}}
\\newcommand{\\resumeSubheading}[4]{\\vspace{-1pt}\\item\\begin{tabular*}{0.97\\textwidth}{l@{\\extracolsep{\\fill}}r}\\textbf{#1} & #2 \\\\\\textit{\\small #3} & \\textit{\\small #4} \\\\\\end{tabular*}\\vspace{-5pt}}
\\renewcommand{\\labelitemii}{$\\circ$}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{-5pt}}
\\newcommand{\\resumeSubHeadingListStart}{\\begin{itemize}[leftmargin=*,label={}]}
\\newcommand{\\resumeSubHeadingListEnd}{\\end{itemize}}

\\begin{document}

%----------HEADING----------
\\begin{tabular*}{\\textwidth}{l@{\\extracolsep{\\fill}}r}
  \\textbf{\\Large ${safeName}} & ${safeEmail} \\\\
  ${contactLine} & ${safeRole ? safeRole : ''} \\\\
\\end{tabular*}

%----------SUMMARY----------
\\section{Professional Summary}
\\resumeItemListStart
\\resumeItem{${safeSummary}}
\\resumeItemListEnd

%----------EXPERIENCE----------
${(version.experience || []).length ? '\\section{Experience}\n\\resumeSubHeadingListStart\n' + toLatexSections(version.experience, 'Experience') + '\n\\resumeSubHeadingListEnd' : ''}

%----------EDUCATION----------
${(version.education || []).length ? '\\section{Education}\n\\resumeSubHeadingListStart\n' + toLatexSections(version.education, 'Education') + '\n\\resumeSubHeadingListEnd' : ''}

%----------PROJECTS----------
${(version.projects || []).length ? '\\section{Projects}\n\\resumeSubHeadingListStart\n' + toLatexSections(version.projects, 'Projects') + '\n\\resumeSubHeadingListEnd' : ''}

%----------SKILLS----------
${safeSkills ? '\\section{Technical Skills}\n\\resumeItemListStart\n\\resumeItem{' + safeSkills + '}\n\\resumeItemListEnd' : ''}

%----------CERTIFICATIONS----------
${(version.certifications || []).length ? '\\section{Certifications}\n\\resumeItemListStart\n' + (version.certifications || []).map((c) => '\\resumeItem{' + escape(c) + '}').join('\n') + '\n\\resumeItemListEnd' : ''}

%----------ACHIEVEMENTS----------
${(version.achievements || []).length ? '\\section{Achievements}\n\\resumeSubHeadingListStart\n' + toLatexSections(version.achievements, 'Achievements') + '\n\\resumeSubHeadingListEnd' : ''}

\\end{document}`;

      res.setHeader('Content-Type', 'application/x-latex');
      res.setHeader('Content-Disposition', `attachment; filename=resume_v${version.version}.tex`);
      res.send(tex);
      return;
    }

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
      doc.font('Helvetica-Bold').fillColor('#064e3b').text('Edvols', { align: 'center' });
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

    if (req.user.role === 'individual_student') {
      filter[Op.or] = [
        { target_audience: { [Op.or]: ['all', null] } },
        {
          target_audience: 'individual',
          [Op.or]: [
            { assigned_student_ids: null },
            { assigned_student_ids: { [Op.contains]: [req.user._id] } },
          ],
        },
      ];
    } else if (req.user.department_id) {
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
    ensureAvailable(assessment, req.user);

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
