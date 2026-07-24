import { User } from '../../database/index.js';
import { Op } from '../../database/index.js';

/**
 * Build a Sequelize WHERE clause for filtering students based on the
 * current admin's role and scope.
 *
 * - master_admin  → null (no filter, sees everything)
 * - placement_officer → filters by institutionId only
 * - hod → filters by institutionId AND department_id
 * - admin (legacy, no institutionId) → filters by assigned_admin
 *
 * Returns { filter: WhereOptions, studentIds: UUID[] }
 *   filter  – usable directly in other queries (e.g. AssessmentAttempt)
 *   studentIds – list of matching student _id values
 */
export async function buildStudentFilter(user) {
  if (user.role === 'master_admin') {
    return { filter: null, studentIds: null };
  }

  const studentWhere = { role: 'student' };

  if (user.admin_role === 'hod' && user.department_id && user.institutionId) {
    studentWhere.institutionId = user.institutionId;
    studentWhere.department_id = user.department_id;
  } else if (user.institutionId) {
    studentWhere.institutionId = user.institutionId;
  } else {
    studentWhere.assigned_admin = user._id;
  }

  const students = await User.findAll({
    where: studentWhere,
    attributes: ['_id'],
  });
  const ids = students.map((s) => s._id);

  return {
    filter: ids.length ? { student_id: { [Op.in]: ids } } : { student_id: null },
    studentIds: ids,
  };
}

/**
 * Build a WHERE clause for filtering assessments by institution/department
 * based on the current admin's role.
 */
export function buildAssessmentFilter(user) {
  const filter = { is_deleted: { [Op.ne]: true } };

  if (user.role === 'master_admin') {
    return filter;
  }

  if (user.institutionId) {
    filter.institutionId = user.institutionId;
  }

  return filter;
}

/**
 * Build a WHERE clause for filtering students by institution/department
 * for use in Student.findAll() calls.
 */
export function buildStudentWhere(user) {
  if (user.role === 'master_admin') {
    return { role: 'student' };
  }

  const where = { role: 'student' };

  if (user.admin_role === 'hod' && user.department_id && user.institutionId) {
    where.institutionId = user.institutionId;
    where.department_id = user.department_id;
  } else if (user.institutionId) {
    where.institutionId = user.institutionId;
  } else {
    where.assigned_admin = user._id;
  }

  return where;
}
