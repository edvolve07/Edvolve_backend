import { User, StudentJourney, Subscription, getSequelize } from '../../database/index.js';

/**
 * Build the legacy req.user shape from the unified `users` table +
 * profile tables.  Existing business logic continues to work unchanged
 * because the returned object has all the fields that `admins`/`students`
 * used to provide.
 */
export async function buildUserContext(userId) {
  const user = await User.findByPk(userId);
  if (!user) return null;

  const data = user.toJSON();

  if (user.role === 'student') {
    const [[profileResult]] = await getSequelize().query(
      `SELECT es.* FROM enterprise_students es WHERE es.user_id = :uid LIMIT 1`,
      { replacements: { uid: userId } }
    );
    if (profileResult) {
      data.institutionId = profileResult.institution_id || data.institutionId || null;
      data.department_id = profileResult.department_id || data.department_id || null;
      data.usn = profileResult.usn || data.usn || null;
      data.year = profileResult.year || data.year || null;
      data.assigned_admin = profileResult.assigned_admin || data.assigned_admin || null;
      data._enterprise_profile_id = profileResult._id;
    }
  }

  if (user.role === 'individual_student') {
    const [[profileResult]] = await getSequelize().query(
      `SELECT is2.* FROM individual_students is2 WHERE is2.user_id = :uid LIMIT 1`,
      { replacements: { uid: userId } }
    );
    if (profileResult) {
      data.subscription_id = profileResult.subscription_id || null;
      data.journey_access = profileResult.journey_access || 0;
      data.current_level = profileResult.current_level || 1;
      data.current_interview = profileResult.current_interview || 1;
      data.subscription_status = profileResult.subscription_status || 'inactive';
      data._individual_profile_id = profileResult._id;
    }
  }

  // Load journey state for students (enterprise + individual)
  if (user.role === 'student' || user.role === 'individual_student') {
    const [[journey]] = await getSequelize().query(
      `SELECT * FROM student_journeys WHERE student_id = :sid LIMIT 1`,
      { replacements: { sid: userId } }
    );
    if (journey) {
      data.journey_access_level = journey.journey_access_level || 0;
      data.current_level = journey.current_level || 1;
      data.current_interview_number = journey.current_interview_number || 1;
      data.completed_interviews = journey.completed_interviews || 0;
      data.total_interviews = journey.total_interviews || 24;
      data.overall_score = journey.overall_score || 0;
      data.readiness_score = journey.readiness_score || 0;
      data.journey_status = journey.status || 'not_started';
    }
  }

  return data;
}

/**
 * Build user context by looking up the `users` table with a WHERE clause
 * (e.g. by email, by token).  Returns the legacy-shaped object or null.
 */
export async function buildUserContextWhere(whereClause) {
  const user = await User.findOne({ where: whereClause });
  if (!user) return null;
  return buildUserContext(user._id);
}
