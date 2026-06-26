import { Admin, Student, Op } from '../../database/index.js';

export async function findUserByPk(id, options = {}) {
  let user = await Admin.findByPk(id, options);
  if (user) return user;
  return Student.findByPk(id, options);
}

export async function findUserByEmail(email, options = {}) {
  let user = await Admin.findOne({ where: { email }, ...options });
  if (user) return user;
  return Student.findOne({ where: { email }, ...options });
}

export async function findUserByToken(field, value, extraWhere = {}) {
  const where = { [field]: value, ...extraWhere };
  let user = await Admin.findOne({ where });
  if (user) return user;
  return Student.findOne({ where });
}

export async function findUserByPkAndRole(id, role, options = {}) {
  if (role === 'student') {
    return Student.findByPk(id, options);
  }
  return Admin.findByPk(id, options);
}

export async function findUsersByRole(role, where = {}, options = {}) {
  const Model = role === 'student' ? Student : Admin;
  return Model.findAll({ where, ...options });
}

export async function countUsersByRole(role, where = {}) {
  const Model = role === 'student' ? Student : Admin;
  return Model.count({ where });
}

export async function findStudentsByAdmin(adminId, options = {}) {
  return Student.findAll({ where: { assigned_admin: adminId }, ...options });
}

export async function findAdminsByInstitution(institutionId, options = {}) {
  return Admin.findAll({ where: { institutionId }, ...options });
}

export async function findStudentsByInstitution(institutionId, options = {}) {
  return Student.findAll({ where: { institutionId }, ...options });
}

export async function getUserCountsByInstitution(institutionIds) {
  const [adminRows, studentRows] = await Promise.all([
    Admin.findAll({
      attributes: ['institutionId', [Admin.sequelize.fn('COUNT', Admin.sequelize.col('_id')), 'count']],
      where: { institutionId: { [Op.in]: institutionIds } },
      group: ['institutionId'],
      raw: true,
    }),
    Student.findAll({
      attributes: ['institutionId', [Student.sequelize.fn('COUNT', Student.sequelize.col('_id')), 'count']],
      where: { institutionId: { [Op.in]: institutionIds } },
      group: ['institutionId'],
      raw: true,
    }),
  ]);
  return { admins: adminRows, students: studentRows };
}

export async function findUserByAuthToken(token, options = {}) {
  const where = { auth_token: token, auth_expires_at: { [Op.gt]: new Date() } };
  let user = await Admin.findOne({ where, ...options });
  if (user) return user;
  return Student.findOne({ where, ...options });
}
