import { User, getSequelize, Op } from '../../database/index.js';
import { buildUserContext, buildUserContextWhere } from './userContext.js';

/**
 * Find a user by primary key via the unified `users` table,
 * returning the legacy-shaped context object.
 */
export async function findUserByPk(id, options = {}) {
  return buildUserContext(id);
}

/**
 * Find a user by email via the unified `users` table,
 * returning the legacy-shaped context object.
 */
export async function findUserByEmail(email, options = {}) {
  const user = await User.findOne({ where: { email }, ...options });
  if (!user) return null;
  return buildUserContext(user._id);
}

export async function findUserByToken(field, value, extraWhere = {}) {
  const where = { [field]: value, ...extraWhere };
  const user = await User.findOne({ where });
  if (!user) return null;
  return buildUserContext(user._id);
}

export async function findUserByPkAndRole(id, role, options = {}) {
  const user = await User.findByPk(id, options);
  if (!user) return null;
  return buildUserContext(id);
}

export async function findUsersByRole(role, where = {}, options = {}) {
  return User.findAll({ where: { role, ...where }, ...options });
}

export async function countUsersByRole(role, where = {}) {
  return User.count({ where: { role, ...where } });
}

export async function findStudentsByAdmin(adminId, options = {}) {
  const [rows] = await getSequelize().query(
    `SELECT u.* FROM users u
     INNER JOIN enterprise_students es ON es.user_id = u._id
     WHERE es.assigned_admin = :adminId AND u.role = 'student'`,
    { replacements: { adminId }, ...options }
  );
  return rows;
}

export async function findAdminsByInstitution(institutionId, options = {}) {
  return User.findAll({
    where: {
      institutionId,
      role: { [Op.in]: ['admin', 'master_admin'] }
    },
    ...options,
  });
}

export async function findStudentsByInstitution(institutionId, options = {}) {
  return User.findAll({
    where: {
      institutionId,
      role: 'student',
    },
    ...options,
  });
}

export async function getUserCountsByInstitution(institutionIds) {
  const adminRows = await User.findAll({
    attributes: ['institutionId', [User.sequelize.fn('COUNT', User.sequelize.col('_id')), 'count']],
    where: { institutionId: { [Op.in]: institutionIds }, role: { [Op.in]: ['admin', 'master_admin'] } },
    group: ['institutionId'],
    raw: true,
  });
  const studentRows = await User.findAll({
    attributes: ['institutionId', [User.sequelize.fn('COUNT', User.sequelize.col('_id')), 'count']],
    where: { institutionId: { [Op.in]: institutionIds }, role: 'student' },
    group: ['institutionId'],
    raw: true,
  });
  return { admins: adminRows, students: studentRows };
}

export async function findUserByAuthToken(token, options = {}) {
  const where = { auth_token: token, auth_expires_at: { [Op.gt]: new Date() } };
  const user = await User.findOne({ where, ...options });
  if (!user) return null;
  return buildUserContext(user._id);
}
