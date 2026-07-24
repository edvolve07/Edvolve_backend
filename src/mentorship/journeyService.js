import { v4 as uuidv4 } from 'uuid';
import { JourneyBlueprint, StudentJourney, JourneyInterview, InterviewSession, InterviewReport, User, ResumeVersion } from '../database/index.js';
import { LEVELS, BLUEPRINTS, getLevelForInterview, getBlueprintByNumber, isInterviewAccessible, getNextLockedInterview } from './blueprints.js';
import { getSequelize, Op } from '../database/index.js';
import { buildStudentWhere } from '../aptitude/utils/adminScope.js';

export class JourneyService {

  async getOrCreateJourney(studentId, studentName, studentEmail, institutionId) {
    let journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (!journey) {
      journey = await StudentJourney.create({
        student_id: studentId,
        student_name: studentName || '',
        student_email: studentEmail || '',
        institution_id: institutionId || null,
        journey_access_level: 0,
        current_level: 1,
        current_interview_number: 1,
        completed_interviews: 0,
        status: 'not_started',
      });
    }
    return journey;
  }

  async getJourney(studentId) {
    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    return journey;
  }

  async getLevels(studentId) {
    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    const currentLevel = journey?.current_level || 1;
    const accessLevel = journey?.journey_access_level || 0;
    const completedInterviews = journey?.completed_interviews || 0;

    return {
      levels: LEVELS.map(lvl => ({
        level: lvl.level,
        name: lvl.name,
        unlock_after_interviews: lvl.unlock_after_interviews,
        features: lvl.features,
        color: lvl.color,
        accessible: lvl.level <= accessLevel,
        completed: lvl.level < currentLevel,
        is_current: lvl.level === currentLevel,
      })),
      current_level: currentLevel,
      journey_access_level: accessLevel,
    };
  }

  async getJourneyInterviews(studentId) {
    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    const accessLevel = journey?.journey_access_level || 0;
    const interviews = await JourneyInterview.findAll({
      where: { student_id: studentId },
      order: [['interview_number', 'ASC']],
    });

    const interviewMap = new Map();
    for (const iv of interviews) {
      interviewMap.set(iv.interview_number, iv);
    }

    const result = [];
    for (const blueprint of BLUEPRINTS) {
      const existing = interviewMap.get(blueprint.interview_number);
      const accessible = blueprint.level <= accessLevel;

      result.push({
        interview_number: blueprint.interview_number,
        blueprint_id: existing?.blueprint_id || null,
        title: blueprint.title,
        level: blueprint.level,
        objective: blueprint.objective,
        focus_areas: blueprint.focus_areas,
        difficulty: blueprint.difficulty,
        category: blueprint.category,
        status: existing?.status || (accessible ? 'available' : 'locked'),
        session_id: existing?.session_id || null,
        report_id: existing?.report_id || null,
        overall_score: existing?.overall_score || 0,
        grade: existing?.grade || '',
        started_at: existing?.started_at || null,
        completed_at: existing?.completed_at || null,
        level_at_time: existing?.level_at_time || blueprint.level,
        accessible,
      });
    }

    return result;
  }

  async getAvailableInterview(studentId) {
    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (!journey) return null;

    const interviews = await JourneyInterview.findAll({
      where: { student_id: studentId, status: 'completed' },
      order: [['interview_number', 'DESC']],
    });

    const completedNumbers = new Set(interviews.map(iv => iv.interview_number));

    for (const blueprint of BLUEPRINTS) {
      if (!completedNumbers.has(blueprint.interview_number) && blueprint.level <= journey.journey_access_level) {
        const dbBp = await JourneyBlueprint.findOne({ where: { interview_number: blueprint.interview_number } });
        return {
          interview_number: blueprint.interview_number,
          blueprint_id: dbBp?._id || null,
          title: blueprint.title,
          level: blueprint.level,
          objective: blueprint.objective,
          focus_areas: blueprint.focus_areas,
          difficulty: blueprint.difficulty,
        };
      }
    }
    return null;
  }

  async startInterview(studentId, studentName, studentEmail) {
    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (!journey) throw new Error('No journey found. Contact your administrator to assign journey access.');

    const nextInterview = await this.getAvailableInterview(studentId);
    if (!nextInterview) throw new Error('No available interviews. All accessible interviews are completed or locked.');

    const blueprint = getBlueprintByNumber(nextInterview.interview_number);
    if (!blueprint) throw new Error('Blueprint not found for interview ' + nextInterview.interview_number);

    const existing = await JourneyInterview.findOne({
      where: { student_id: studentId, interview_number: nextInterview.interview_number, status: 'active' }
    });
    if (existing && existing.session_id) {
      return {
        session_id: existing.session_id,
        interview_number: nextInterview.interview_number,
        blueprint_title: nextInterview.title,
        level: nextInterview.level,
        question_number: 1,
        question: '',
        ats_score: 0,
      };
    }

    const sessionId = uuidv4();
    await JourneyInterview.upsert({
      student_id: studentId,
      interview_number: nextInterview.interview_number,
      blueprint_id: nextInterview.blueprint_id,
      blueprint_title: nextInterview.title,
      level: nextInterview.level,
      status: 'active',
      session_id: sessionId,
      started_at: new Date(),
      level_at_time: journey.current_level,
    });

    if (journey.status === 'not_started') {
      await journey.update({ status: 'in_progress', started_at: new Date() });
    }

    return {
      session_id: sessionId,
      interview_number: nextInterview.interview_number,
      blueprint_title: nextInterview.title,
      level: nextInterview.level,
      objective: blueprint.objective,
      focus_areas: blueprint.focus_areas,
      difficulty: blueprint.difficulty,
      question_number: 1,
      question: '',
      ats_score: 0,
    };
  }

  async startInterviewById(studentId, interviewNumber) {
    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (!journey) throw new Error('No journey found.');

    const blueprint = getBlueprintByNumber(interviewNumber);
    if (!blueprint) throw new Error('Invalid interview number: ' + interviewNumber);

    if (!isInterviewAccessible(interviewNumber, journey.journey_access_level)) {
      throw new Error('Interview ' + interviewNumber + ' is locked. Complete previous interviews or upgrade your journey access.');
    }

    const existing = await JourneyInterview.findOne({
      where: { student_id: studentId, interview_number: interviewNumber }
    });
    if (existing && existing.status === 'completed') {
      throw new Error('Interview ' + interviewNumber + ' is already completed.');
    }
    if (existing && existing.status === 'active') {
      return {
        session_id: existing.session_id,
        interview_number: interviewNumber,
        blueprint_title: blueprint.title,
        level: blueprint.level,
      };
    }

    const sessionId = uuidv4();
    const dbBp = await JourneyBlueprint.findOne({ where: { interview_number: interviewNumber } });
    await JourneyInterview.upsert({
      student_id: studentId,
      interview_number: interviewNumber,
      blueprint_id: dbBp?._id || null,
      blueprint_title: blueprint.title,
      level: blueprint.level,
      status: 'active',
      session_id: sessionId,
      started_at: new Date(),
      level_at_time: journey.current_level,
    });

    return {
      session_id: sessionId,
      interview_number: interviewNumber,
      blueprint_title: blueprint.title,
      level: blueprint.level,
      objective: blueprint.objective,
      focus_areas: blueprint.focus_areas,
      difficulty: blueprint.difficulty,
    };
  }

  async generateBlueprintQuestion(sessionId, studentId) {
    const journeyInt = await JourneyInterview.findOne({
      where: { session_id: sessionId, student_id: studentId }
    });
    if (!journeyInt) throw new Error('Journey interview not found');

    const blueprint = getBlueprintByNumber(journeyInt.interview_number);
    if (!blueprint) throw new Error('Blueprint not found');

    const session = await InterviewSession.findOne({ where: { session_id: sessionId } });
    const resumeText = session?.resume_text || '';

    return {
      blueprint_prompt: blueprint.ai_prompt,
      objective: blueprint.objective,
      focus_areas: blueprint.focus_areas,
      difficulty: blueprint.difficulty,
      interview_number: journeyInt.interview_number,
      title: blueprint.title,
      level: blueprint.level,
      resume_text: resumeText,
    };
  }

  async completeInterview(studentId, sessionId, score, grade) {
    const journeyInt = await JourneyInterview.findOne({
      where: { session_id: sessionId, student_id: studentId }
    });
    if (!journeyInt) throw new Error('Journey interview not found');

    await journeyInt.update({
      status: 'completed',
      overall_score: score || 0,
      grade: grade || '',
      completed_at: new Date(),
    });

    const completedCount = await JourneyInterview.count({
      where: { student_id: studentId, status: 'completed' }
    });

    const allCompleted = await JourneyInterview.findAll({
      where: { student_id: studentId, status: 'completed' },
      attributes: ['overall_score'],
    });

    const avgScore = allCompleted.length > 0
      ? allCompleted.reduce((sum, iv) => sum + (iv.overall_score || 0), 0) / allCompleted.length
      : 0;

    let newLevel = 1;
    for (const level of LEVELS) {
      if (completedCount >= level.unlock_after_interviews) {
        newLevel = level.level;
      }
    }

    const nextInterview = await this.getAvailableInterview(studentId);
    const readinessScore = this.calculateReadiness(completedCount, avgScore, allCompleted);

    await StudentJourney.update({
      completed_interviews: completedCount,
      current_level: newLevel,
      current_interview_number: nextInterview?.interview_number || null,
      overall_score: Math.round(avgScore * 10) / 10,
      readiness_score: readinessScore,
      last_interview_at: new Date(),
      status: completedCount >= 24 ? 'completed' : 'in_progress',
      completed_at: completedCount >= 24 ? new Date() : null,
    }, { where: { student_id: studentId } });

    return {
      completed: true,
      interview_number: journeyInt.interview_number,
      completed_count: completedCount,
      new_level: newLevel,
      overall_score: Math.round(avgScore * 10) / 10,
      readiness_score: readinessScore,
      next_interview: nextInterview,
      journey_completed: completedCount >= 24,
    };
  }

  calculateReadiness(completedCount, avgScore, completedInterviews) {
    const completionWeight = (completedCount / 24) * 40;
    const scoreWeight = (avgScore / 100) * 35;
    const consistencyBonus = completedCount >= 4 ? 10 : (completedCount / 4) * 10;
    const levelBonus = Math.min(15, (completedCount / 24) * 15);
    return Math.min(100, Math.round(completionWeight + scoreWeight + consistencyBonus + levelBonus));
  }

  async getProgress(studentId) {
    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (!journey) return null;

    const completedInterviews = await JourneyInterview.findAll({
      where: { student_id: studentId, status: 'completed' },
      order: [['interview_number', 'ASC']],
    });

    return {
      total_interviews: completedInterviews.length,
      total_available: journey.journey_access_level > 0 ? this._getMaxInterviewsForAccess(journey.journey_access_level) : 0,
      average_score: journey.overall_score,
      current_level: journey.current_level,
      journey_access_level: journey.journey_access_level,
      readiness_score: journey.readiness_score,
      scores: {
        overall: journey.overall_score,
      },
    };
  }

  _getMaxInterviewsForAccess(accessLevel) {
    let max = 0;
    for (const level of LEVELS) {
      if (level.level <= accessLevel) {
        max = level.interview_range[1];
      }
    }
    return max;
  }

  async getTrends(studentId) {
    const completedInterviews = await JourneyInterview.findAll({
      where: { student_id: studentId, status: 'completed' },
      order: [['completed_at', 'ASC']],
    });

    const trends = completedInterviews.map(iv => ({
      value: iv.overall_score,
      score: iv.overall_score,
      date: iv.completed_at,
      interview_number: iv.interview_number,
      title: iv.blueprint_title,
      session_id: iv.session_id,
    }));

    return { trends };
  }

  async getReadiness(studentId) {
    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (!journey) return { score: 0, components: {} };

    const completedInterviews = await JourneyInterview.findAll({
      where: { student_id: studentId, status: 'completed' },
    });

    const completion = (completedInterviews.length / 24) * 100;
    const avgScore = completedInterviews.length > 0
      ? completedInterviews.reduce((sum, iv) => sum + (iv.overall_score || 0), 0) / completedInterviews.length
      : 0;

    const resume = await ResumeVersion.findOne({
      where: { student_id: studentId },
      order: [['created_at', 'DESC']],
    });
    const resumeScore = resume?.ats_analysis?.ats_score || 0;

    return {
      score: journey.readiness_score,
      components: {
        aptitude: Math.min(100, Math.round(completion * 0.8)),
        coding: Math.min(100, Math.round(avgScore * 0.9)),
        interview: Math.min(100, Math.round(avgScore)),
        consistency: Math.min(100, Math.round(completion)),
        resume: Math.min(100, Math.round(resumeScore)),
      },
    };
  }

  async getResumeComparisons(studentId) {
    const versions = await ResumeVersion.findAll({
      where: { student_id: studentId },
      order: [['created_at', 'DESC']],
      limit: 6,
    });

    return {
      comparisons: versions.map((v, idx) => ({
        _id: v._id,
        name: v.title || `Version ${idx + 1}`,
        version: v.version,
        ats_score: v.ats_analysis?.ats_score || 0,
        improvement: idx < versions.length - 1
          ? (v.ats_analysis?.ats_score || 0) - (versions[idx + 1]?.ats_analysis?.ats_score || 0)
          : 0,
        uploaded_at: v.created_at,
      })),
    };
  }

  async getReplays(studentId) {
    const replays = await JourneyInterview.findAll({
      where: { student_id: studentId, status: 'completed' },
      order: [['interview_number', 'ASC']],
    });

    return {
      replays: replays.map(iv => ({
        session_id: iv.session_id,
        interview_number: iv.interview_number,
        blueprint_title: iv.blueprint_title,
        overall_score: iv.overall_score,
        grade: iv.grade,
        completed_at: iv.completed_at,
        level_at_time: iv.level_at_time,
      })),
    };
  }

  async getReplayDetail(studentId, sessionId) {
    const report = await InterviewReport.findOne({ where: { session_id: sessionId } });
    if (!report) return null;

    return {
      session_id: sessionId,
      total_questions: report.question_breakdown?.length || 0,
      overall: report.overall,
      strengths: report.strengths,
      areas_to_improve: report.areas_to_improve,
      questions: (report.question_breakdown || []).map(qb => ({
        question: qb.question,
        answer: qb.answer,
        evaluation: qb.evaluation,
      })),
    };
  }

  async getSubscription(studentId) {
    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (!journey) return { subscription: null, lock_status: null };

    const accessLevel = journey.journey_access_level;
    const completedInterviews = journey.completed_interviews;
    const maxInterviews = this._getMaxInterviewsForAccess(accessLevel);

    return {
      subscription: {
        plan_key: accessLevel > 0 ? `level_1_${accessLevel}` : null,
        status: accessLevel > 0 ? 'active' : 'none',
        interviews_used: completedInterviews,
        interviews_total: maxInterviews,
        expires_at: null,
        level_access: accessLevel,
      },
      lock_status: {
        allowed: completedInterviews < maxInterviews,
        interviewsUsed: completedInterviews,
        interviewsTotal: maxInterviews,
        remaining: Math.max(0, maxInterviews - completedInterviews),
        nextUnlockAt: null,
        daysRemaining: null,
        lastInterviewAt: journey.last_interview_at,
        gapDays: 0,
        reason: completedInterviews >= maxInterviews ? 'level_limit' : null,
      },
    };
  }

  async getLockStatus(studentId) {
    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (!journey) return { allowed: false };

    const maxInterviews = this._getMaxInterviewsForAccess(journey.journey_access_level);
    const completed = journey.completed_interviews;

    return {
      allowed: completed < maxInterviews,
      interviewsUsed: completed,
      interviewsTotal: maxInterviews,
      remaining: Math.max(0, maxInterviews - completed),
      nextUnlockAt: null,
      daysRemaining: 0,
      lastInterviewAt: journey.last_interview_at,
      gapDays: 0,
      reason: completed >= maxInterviews ? 'level_limit' : null,
    };
  }

  async subscribe(studentId, planKey) {
    throw new Error('Enterprise students do not purchase plans. Contact your administrator for journey access.');
  }

  // ═══════════════════════════════════════════════════════
  // ADMIN METHODS
  // ═══════════════════════════════════════════════════════

  async assignJourneyAccess(studentId, accessLevel, assignedBy) {
    if (accessLevel < 0 || accessLevel > 6) {
      throw new Error('Invalid access level. Must be 0-6.');
    }

    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (!journey) {
      const student = await User.findOne({ where: { _id: studentId } });
      if (!student) throw new Error('Student not found');

      await StudentJourney.create({
        student_id: studentId,
        student_name: student.name || '',
        student_email: student.email || '',
        institution_id: student.institutionId || null,
        journey_access_level: accessLevel,
        current_level: accessLevel > 0 ? 1 : 0,
        status: accessLevel > 0 ? 'not_started' : 'locked',
      });
    } else {
      const oldLevel = journey.journey_access_level;
      await journey.update({
        journey_access_level: accessLevel,
        current_level: accessLevel > 0 ? Math.max(journey.current_level, 1) : 0,
        status: accessLevel > 0 ? (journey.status === 'not_started' ? 'not_started' : journey.status) : 'locked',
      });
    }

    return { success: true, student_id: studentId, access_level: accessLevel };
  }

  async upgradeJourneyAccess(studentId, newLevel, upgradedBy) {
    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (!journey) throw new Error('Student journey not found');

    if (newLevel <= journey.journey_access_level) {
      throw new Error('New level must be higher than current level');
    }

    await journey.update({ journey_access_level: newLevel });
    return { success: true, student_id: studentId, new_level: newLevel };
  }

  async downgradeJourneyAccess(studentId, newLevel, downgradedBy) {
    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (!journey) throw new Error('Student journey not found');

    if (newLevel >= journey.journey_access_level) {
      throw new Error('New level must be lower than current level');
    }

    await journey.update({ journey_access_level: newLevel });
    return { success: true, student_id: studentId, new_level: newLevel };
  }

  async bulkAssignAccess(studentIds, accessLevel, assignedBy) {
    const results = [];
    for (const studentId of studentIds) {
      try {
        await this.assignJourneyAccess(studentId, accessLevel, assignedBy);
        results.push({ student_id: studentId, success: true });
      } catch (err) {
        results.push({ student_id: studentId, success: false, error: err.message });
      }
    }
    return results;
  }

  async getAdminDashboard(user) {
    const studentWhere = buildStudentWhere(user);

    const totalStudents = await User.count({ where: studentWhere });
    const studentIds = (await User.findAll({ where: studentWhere, attributes: ['_id'], raw: true })).map(s => s._id);

    const totalJourneys = await StudentJourney.count({ where: studentIds.length ? { student_id: { [Op.in]: studentIds } } : { student_id: null } });
    const totalSubscriptions = await StudentJourney.count({ where: { student_id: { [Op.in]: studentIds }, journey_access_level: { [Op.gt]: 0 } } });
    const activeSubscriptions = await StudentJourney.count({ where: { student_id: { [Op.in]: studentIds }, journey_access_level: { [Op.gt]: 0 }, status: { [Op.ne]: 'locked' } } });
    const activeJourneys = await StudentJourney.count({ where: { student_id: { [Op.in]: studentIds }, status: 'in_progress' } });
    const completedJourneys = await StudentJourney.count({ where: { student_id: { [Op.in]: studentIds }, status: 'completed' } });
    const avgReadiness = await StudentJourney.findAll({
      attributes: [[getSequelize().fn('AVG', getSequelize().col('readiness_score')), 'avg_readiness']],
      where: { student_id: { [Op.in]: studentIds }, readiness_score: { [Op.gt]: 0 } },
      raw: true,
    });

    return {
      total_students: totalStudents,
      total_journeys: totalJourneys,
      total_subscriptions: totalSubscriptions,
      active_subscriptions: activeSubscriptions,
      active_journeys: activeJourneys,
      completed_journeys: completedJourneys,
      average_readiness: Math.round(avgReadiness[0]?.avg_readiness || 0),
    };
  }

  async getAdminStudents(user, institutionId, search, page = 1, limit = 20) {
    const studentWhere = buildStudentWhere(user);
    if (institutionId) {
      studentWhere.institutionId = institutionId;
    }

    const allStudents = await User.findAll({
      where: studentWhere,
      order: [['created_at', 'DESC']],
      raw: true,
    });

    const journeys = await StudentJourney.findAll({ raw: true });
    const journeyMap = new Map();
    for (const j of journeys) {
      journeyMap.set(j.student_id, j);
    }

    let filtered = allStudents.map(s => {
      const j = journeyMap.get(s._id);
      const accessLevel = j?.journey_access_level || 0;
      const maxInterviews = this._getMaxInterviewsForAccess(accessLevel);
      return {
        id: s._id,
        name: s.name,
        email: s.email,
        institution_id: s.institutionId || null,
        journey: j ? {
          _id: j._id,
          current_level: j.current_level,
          readiness_score: j.readiness_score,
          completed_interviews: j.completed_interviews,
          status: j.status,
        } : null,
        subscription: {
          plan_key: accessLevel > 0 ? `level_1_${accessLevel}` : null,
          plan_name: accessLevel > 0 ? LEVELS.find(l => l.level === accessLevel)?.name || 'Unknown' : '—',
          status: accessLevel > 0 ? 'active' : 'none',
          interviews_used: j?.completed_interviews || 0,
          interviews_total: maxInterviews,
          level_access: accessLevel,
        },
      };
    });

    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(s =>
        s.name?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q)
      );
    }

    const count = filtered.length;
    const offset = (page - 1) * limit;
    const students = filtered.slice(offset, offset + limit);

    return {
      students,
      total: count,
      page,
      limit,
      total_pages: Math.ceil(count / limit),
    };
  }

  async getAdminStudentDetail(user, studentId) {
    const studentWhere = buildStudentWhere(user);
    studentWhere._id = studentId;
    const student = await User.findOne({ where: studentWhere });
    if (!student) return null;

    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });

    const interviews = journey ? await JourneyInterview.findAll({
      where: { student_id: studentId },
      order: [['interview_number', 'ASC']],
    }) : [];

    const accessLevel = journey?.journey_access_level || 0;
    const maxInterviews = this._getMaxInterviewsForAccess(accessLevel);

    return {
      student: { _id: student._id, name: student.name, email: student.email, institutionId: student.institutionId },
      journey: journey ? {
        _id: journey._id,
        student_id: journey.student_id,
        current_level: journey.current_level,
        current_interview_number: journey.current_interview_number,
        completed_interviews: journey.completed_interviews,
        overall_score: journey.overall_score,
        readiness_score: journey.readiness_score,
        status: journey.status,
        journey_access_level: journey.journey_access_level,
      } : null,
      subscription: {
        id: journey?._id || null,
        plan_key: accessLevel > 0 ? `level_1_${accessLevel}` : null,
        status: accessLevel > 0 ? 'active' : 'none',
        interviews_used: journey?.completed_interviews || 0,
        interviews_total: maxInterviews,
        level_access: accessLevel,
      },
      interview_entries: interviews.map(iv => ({
        _id: iv._id,
        interview_number: iv.interview_number,
        blueprint_title: iv.blueprint_title,
        status: iv.status,
        overall_score: iv.overall_score,
        grade: iv.grade,
        session_id: iv.session_id,
        started_at: iv.started_at,
        completed_at: iv.completed_at,
      })),
      reports: interviews.filter(iv => iv.status === 'completed').map(iv => ({
        session_id: iv.session_id,
        interview_number: iv.interview_number,
        blueprint_title: iv.blueprint_title,
        overall_score: iv.overall_score,
        grade: iv.grade,
      })),
    };
  }

  async getAdminPlans() {
    return {
      plans: LEVELS.map(lvl => ({
        key: `level_1_${lvl.level}`,
        name: lvl.name,
        level_access: lvl.level,
        interviews_total: lvl.interview_range[1],
        interviews: lvl.interview_range[1],
        duration_months: lvl.level,
      })),
    };
  }

  async assignSubscription(studentId, planKey) {
    const levelMatch = planKey.match(/level_1_(\d+)/);
    if (!levelMatch) throw new Error('Invalid plan key');
    const level = parseInt(levelMatch[1]);
    return this.assignJourneyAccess(studentId, level, 'admin');
  }

  async bulkAssignSubscription(studentIds, planKey) {
    return this.bulkAssignAccess(studentIds, this._levelFromPlanKey(planKey), 'admin');
  }

  async extendSubscription(subscriptionId, days) {
    return { success: true, message: 'Enterprise subscriptions are level-based, not time-based.' };
  }

  async cancelSubscription(subscriptionId) {
    return { success: true, message: 'Enterprise subscription cancelled.' };
  }

  async getSubscriptionImpact(institutionId, planKey) {
    const students = await StudentJourney.findAll({
      where: { institution_id: institutionId },
    });
    return {
      total_affected: students.length,
      institution_id: institutionId,
      plan_key: planKey,
    };
  }

  async assignInstitutionSubscription(institutionId, planKey) {
    const students = await User.findAll({ where: { institutionId } });
    const studentIds = students.map(s => s._id);
    return this.bulkAssignAccess(studentIds, this._levelFromPlanKey(planKey), 'admin');
  }

  async assignInstitutionJourneyAccess(institutionId, accessLevel, assignedBy, filters = {}) {
    const where = { institutionId };
    if (filters.department_id) where.department_id = filters.department_id;
    if (filters.year) where.year = filters.year;
    const students = await User.findAll({ where });
    const studentIds = students.map(s => s._id);
    return this.bulkAssignAccess(studentIds, accessLevel, assignedBy);
  }

  async getJourneyAccessImpact(institutionId, filters = {}) {
    const studentWhere = { institutionId };
    if (filters.department_id) studentWhere.department_id = filters.department_id;
    if (filters.year) studentWhere.year = filters.year;
    const totalStudents = await User.count({ where: studentWhere });
    const journeyWhere = {};
    if (institutionId) journeyWhere.institution_id = institutionId;
    const count = await StudentJourney.count({ where: journeyWhere });
    return {
      total_affected: totalStudents,
      with_journey: count,
      institution_id: institutionId,
    };
  }

  _levelFromPlanKey(planKey) {
    const match = planKey.match(/level_1_(\d+)/);
    return match ? parseInt(match[1]) : 1;
  }

  async getAdminDepartments() {
    const { Department } = await import('../database/index.js');
    const departments = await Department.findAll();
    return { departments };
  }

  async getStudentUsers(studentId) {
    const student = await User.findOne({ where: { _id: studentId } });
    return student ? { student } : null;
  }

  async assignStudentAdmin(studentId, adminId) {
    const student = await User.findOne({ where: { _id: studentId } });
    if (!student) throw new Error('Student not found');
    await student.update({ assigned_admin: adminId });
    return { success: true };
  }

  async updateStudentProfile(studentId, body, admin) {
    const student = await User.findOne({ where: { _id: studentId } });
    if (!student) throw new Error('Student not found');

    const updates = {};
    if (body.name !== undefined) updates.name = String(body.name).trim();
    if (body.email !== undefined) updates.email = String(body.email).trim().toLowerCase();
    if (body.phone !== undefined) updates.phone = String(body.phone).trim();
    if (body.usn !== undefined) updates.usn = String(body.usn).trim() || null;
    if (body.department_id !== undefined) updates.department_id = body.department_id || null;
    if (body.year !== undefined) updates.year = String(body.year).trim() || null;
    if (body.organization !== undefined) updates.organization = String(body.organization).trim();
    if (body.assigned_admin !== undefined) updates.assigned_admin = body.assigned_admin || null;

    if (Object.keys(updates).length === 0) {
      return { success: true, student: student.toJSON() };
    }

    await student.update(updates);

    if (student.role === 'student' && (updates.department_id !== undefined || updates.assigned_admin !== undefined)) {
      const { EnterpriseStudent } = await import('../database/index.js');
      const profile = await EnterpriseStudent.findOne({ where: { user_id: studentId } });
      if (profile) {
        const profileUpdates = {};
        if (updates.department_id !== undefined) profileUpdates.department_id = updates.department_id;
        if (updates.assigned_admin !== undefined) profileUpdates.assigned_admin = updates.assigned_admin;
        if (Object.keys(profileUpdates).length > 0) await profile.update(profileUpdates);
      }
    }

    return { success: true, student: student.toJSON() };
  }
}

export const journeyService = new JourneyService();
