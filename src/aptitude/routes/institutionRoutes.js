import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { User, Op, Institution, Department, Assessment, AssessmentAttempt, InstitutionModule, getSequelize } from '../../database/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, notFound, forbidden } from '../utils/httpError.js';
import { ROLES } from '../utils/roles.js';

const router = express.Router();
const sequelize = getSequelize();

router.use(requireAuth, requireRole(ROLES.MASTER_ADMIN));

function parseModules(body) {
  const modules = {};
  for (const key of ['aptitude', 'coding', 'interviews', 'resumeBuilder', 'certificates']) {
    if (body[`modules.${key}`] !== undefined) {
      modules[key] = Boolean(body[`modules.${key}`]);
    } else if (body.modules && body.modules[key] !== undefined) {
      modules[key] = Boolean(body.modules[key]);
    }
  }
  return Object.keys(modules).length ? modules : undefined;
}

async function syncInstitutionModules(institutionId, modules) {
  if (!modules || typeof modules !== 'object') return;
  for (const [name, enabled] of Object.entries(modules)) {
    await InstitutionModule.upsert({
      institution_id: institutionId,
      module_name: name,
      enabled: Boolean(enabled),
    });
  }
}

function serializeInstitution(inst) {
  return {
    id: inst._id,
    name: inst.name,
    code: inst.code,
    email: inst.email,
    phone: inst.phone || '',
    address: inst.address || '',
    modules: inst.modules || { aptitude: true, coding: true, interviews: true, resumeBuilder: false, certificates: true },
    status: inst.status,
    created_by: inst.created_by || null,
    created_at: inst.created_at,
    updated_at: inst.updated_at,
  };
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, search } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (search) {
      filter[Op.or] = [
        { name: { [Op.iLike]: `%${search}%` } },
        { code: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const institutions = await Institution.findAll({
      where: filter,
      order: [['created_at', 'DESC']],
    });

    const institutionIds = institutions.map((i) => i._id);

    const [adminCounts, studentCounts] = await Promise.all([
      institutionIds.length
        ? User.findAll({
            attributes: ['institutionId', [sequelize.fn('COUNT', sequelize.col('_id')), 'count']],
            where: { institutionId: { [Op.in]: institutionIds }, role: 'admin' },
            group: ['institutionId'],
            raw: true,
          })
        : [],
      institutionIds.length
        ? User.findAll({
            attributes: ['institutionId', [sequelize.fn('COUNT', sequelize.col('_id')), 'count']],
            where: { institutionId: { [Op.in]: institutionIds }, role: 'student' },
            group: ['institutionId'],
            raw: true,
          })
        : [],
    ]);

    const adminCountMap = new Map(adminCounts.map((c) => [c.institutionId, Number(c.count)]));
    const studentCountMap = new Map(studentCounts.map((c) => [c.institutionId, Number(c.count)]));

    const enriched = institutions.map((inst) => ({
      ...serializeInstitution(inst),
      total_admins: adminCountMap.get(inst._id) || 0,
      total_students: studentCountMap.get(inst._id) || 0,
    }));

    res.json({ institutions: enriched });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const institution = await Institution.findByPk(req.params.id);
    if (!institution) throw notFound('Institution not found');

    const [totalAdmins, totalStudents, admins, departments] = await Promise.all([
      User.count({ where: { institutionId: institution._id, role: 'admin' } }),
      User.count({ where: { institutionId: institution._id, role: 'student' } }),
      User.findAll({
        where: { institutionId: institution._id, role: 'admin' },
        attributes: ['_id', 'name', 'email', 'phone'],
        order: [['name', 'ASC']],
      }),
      Department.findAll({
        where: { institution_id: institution._id },
        order: [['name', 'ASC']],
      }),
    ]);

    res.json({
      institution: {
        ...serializeInstitution(institution),
        total_admins: totalAdmins,
        total_students: totalStudents,
        admins: admins.map((a) => ({ id: a._id, name: a.name, email: a.email, phone: a.phone || '' })),
        departments: departments.map((d) => ({ id: d._id, name: d.name })),
      },
    });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const code = String(req.body.code || '').trim().toUpperCase();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const address = String(req.body.address || '').trim();
    const status = String(req.body.status || 'active').toLowerCase();

    const errors = [];
    if (!name) errors.push('Institution name is required');
    if (!code) errors.push('Institution code is required');
    if (!email) errors.push('Email is required');

    if (code) {
      const existingCode = await Institution.findOne({ where: { code } });
      if (existingCode) errors.push('Institution code is already in use');
    }
    if (email) {
      const existingEmail = await Institution.findOne({ where: { email } });
      if (existingEmail) errors.push('Email is already in use');
    }

    if (errors.length) throw badRequest('Validation failed', errors);

    const modules = {
      aptitude: req.body.modules?.aptitude !== false,
      coding: req.body.modules?.coding !== false,
      interviews: req.body.modules?.interviews !== false,
      resumeBuilder: req.body.modules?.resumeBuilder === true,
      certificates: req.body.modules?.certificates !== false,
    };

    const institution = await Institution.create({
      name, code, email, phone, address, modules,
      status: status === 'inactive' ? 'inactive' : 'active',
      created_by: req.user._id,
    });
    await syncInstitutionModules(institution._id, modules);

    res.status(201).json({ institution: serializeInstitution(institution) });
  }),
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const institution = await Institution.findByPk(req.params.id);
    if (!institution) throw notFound('Institution not found');

    const name = req.body.name !== undefined ? String(req.body.name).trim() : undefined;
    const code = req.body.code !== undefined ? String(req.body.code).trim().toUpperCase() : undefined;
    const email = req.body.email !== undefined ? String(req.body.email).trim().toLowerCase() : undefined;
    const phone = req.body.phone !== undefined ? String(req.body.phone).trim() : undefined;
    const address = req.body.address !== undefined ? String(req.body.address).trim() : undefined;
    const status = req.body.status !== undefined ? String(req.body.status).toLowerCase() : undefined;

    if (code && code !== institution.code) {
      const existingCode = await Institution.findOne({ where: { code, _id: { [Op.ne]: institution._id } } });
      if (existingCode) throw badRequest('Institution code is already in use');
      institution.code = code;
    }

    if (email && email !== institution.email) {
      const existingEmail = await Institution.findOne({ where: { email, _id: { [Op.ne]: institution._id } } });
      if (existingEmail) throw badRequest('Email is already in use');
      institution.email = email;
    }

    if (name) institution.name = name;
    if (phone !== undefined) institution.phone = phone;
    if (address !== undefined) institution.address = address;
    if (status && ['active', 'inactive'].includes(status)) institution.status = status;

    const modulesUpdate = parseModules(req.body);
    if (modulesUpdate) {
      institution.modules = { ...institution.modules, ...modulesUpdate };
    }

    await institution.save();
    if (modulesUpdate) {
      await syncInstitutionModules(institution._id, institution.modules);
    }

    const [totalAdmins, totalStudents] = await Promise.all([
      User.count({ where: { institutionId: institution._id, role: 'admin' } }),
      User.count({ where: { institutionId: institution._id, role: 'student' } }),
    ]);

    res.json({
      institution: { ...serializeInstitution(institution), total_admins: totalAdmins, total_students: totalStudents },
    });
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const institution = await Institution.findByPk(req.params.id);
    if (!institution) throw notFound('Institution not found');

    const [adminCount, studentCount] = await Promise.all([
      User.count({ where: { institutionId: institution._id, role: 'admin' } }),
      User.count({ where: { institutionId: institution._id, role: 'student' } }),
    ]);

    if (adminCount > 0 || studentCount > 0) {
      throw badRequest(
        'Cannot delete institution with active users',
        [`${adminCount} admin(s) and ${studentCount} student(s) are associated with this institution. Remove or reassign them first.`],
      );
    }

    await Institution.destroy({ where: { _id: institution._id } });
    res.status(204).end();
  }),
);

router.get(
  '/:id/analytics',
  asyncHandler(async (req, res) => {
    const institution = await Institution.findByPk(req.params.id);
    if (!institution) throw notFound('Institution not found');

    const [
      totalAdmins,
      totalStudents,
      aptAssessments,
      recentAdmins,
      recentStudents,
    ] = await Promise.all([
      User.count({ where: { institutionId: institution._id, role: 'admin' } }),
      User.count({ where: { institutionId: institution._id, role: 'student' } }),
      Assessment.findAll({ where: { institutionId: institution._id }, attributes: ['_id'] }),
      User.findAll({
        where: { institutionId: institution._id, role: 'admin' },
        attributes: ['_id', 'name', 'email', 'created_at'],
        order: [['created_at', 'DESC']],
        limit: 5,
      }),
      User.findAll({
        where: { institutionId: institution._id, role: 'student' },
        attributes: ['_id', 'name', 'email', 'created_at'],
        order: [['created_at', 'DESC']],
        limit: 5,
      }),
    ]);

    const aptAssessmentIds = aptAssessments.map((a) => a._id);

    const [totalAttempts, avgScoreResult] = await Promise.all([
      aptAssessmentIds.length
        ? AssessmentAttempt.count({ where: { assessment_id: { [Op.in]: aptAssessmentIds }, status: 'submitted' } })
        : 0,
      aptAssessmentIds.length
        ? AssessmentAttempt.findAll({
            attributes: [
              [sequelize.fn('AVG', sequelize.col('percentage')), 'avg'],
            ],
            where: { assessment_id: { [Op.in]: aptAssessmentIds }, status: 'submitted' },
            raw: true,
          })
        : [],
    ]);

    const avgScore = avgScoreResult.length ? Math.round(Number(avgScoreResult[0].avg) || 0) : 0;

    res.json({
      analytics: {
        total_admins: totalAdmins,
        total_students: totalStudents,
        total_assessments: aptAssessmentIds.length,
        total_attempts: totalAttempts,
        average_score: avgScore,
        recent_admins: recentAdmins.map((a) => ({ id: a._id, name: a.name, email: a.email, created_at: a.created_at })),
        recent_students: recentStudents.map((s) => ({ id: s._id, name: s.name, email: s.email, created_at: s.created_at })),
      },
    });
  }),
);

router.get(
  '/:id/admins',
  asyncHandler(async (req, res) => {
    const institution = await Institution.findByPk(req.params.id);
    if (!institution) throw notFound('Institution not found');

    const admins = await User.findAll({
      where: {
        institutionId: institution._id,
        role: 'admin',
      },
      attributes: ['_id', 'name', 'email', 'phone', 'modules_access', 'is_active'],
      order: [['name', 'ASC']],
    });

    res.json({
      admins: admins.map((a) => ({
        id: a._id,
        name: a.name,
        email: a.email,
        phone: a.phone || '',
        modules_access: a.modules_access || ['both'],
        is_active: a.is_active !== false,
      })),
    });
  }),
);

router.get(
  '/:id/departments',
  asyncHandler(async (req, res) => {
    const institution = await Institution.findByPk(req.params.id);
    if (!institution) throw notFound('Institution not found');

    const departments = await Department.findAll({
      where: { institution_id: institution._id },
      order: [['name', 'ASC']],
    });

    const deptIds = departments.map((d) => d._id);

    const [adminDeptCounts, studentDeptCounts] = await Promise.all([
      deptIds.length
        ? User.findAll({
            attributes: ['department_id', [sequelize.fn('COUNT', sequelize.col('_id')), 'count']],
            where: { department_id: { [Op.in]: deptIds }, role: 'admin' },
            group: ['department_id'],
            raw: true,
          })
        : [],
      deptIds.length
        ? User.findAll({
            attributes: ['department_id', [sequelize.fn('COUNT', sequelize.col('_id')), 'count']],
            where: { department_id: { [Op.in]: deptIds }, role: 'student' },
            group: ['department_id'],
            raw: true,
          })
        : [],
    ]);
    const countMap = new Map();
    for (const c of [...adminDeptCounts, ...studentDeptCounts]) {
      const key = c.department_id;
      countMap.set(key, (countMap.get(key) || 0) + Number(c.count));
    }

    res.json({
      departments: departments.map((d) => ({
        id: d._id,
        name: d.name,
        user_count: countMap.get(d._id) || 0,
      })),
    });
  }),
);

router.post(
  '/:id/departments',
  asyncHandler(async (req, res) => {
    const institution = await Institution.findByPk(req.params.id);
    if (!institution) throw notFound('Institution not found');

    const name = String(req.body.name || '').trim();
    if (!name) throw badRequest('Department name is required');

    const existing = await Department.findOne({
      where: { institution_id: institution._id, name },
    });
    if (existing) throw badRequest('Department already exists');

    const department = await Department.create({
      institution_id: institution._id,
      name,
    });

    res.status(201).json({ department: { id: department._id, name: department.name } });
  }),
);

router.delete(
  '/:id/departments/:deptId',
  asyncHandler(async (req, res) => {
    const department = await Department.findByPk(req.params.deptId);
    if (!department) throw notFound('Department not found');

    if (String(department.institution_id) !== String(req.params.id)) {
      throw forbidden('Department does not belong to this institution');
    }

    const [adminCount, studentCount] = await Promise.all([
      User.count({ where: { department_id: department._id, role: 'admin' } }),
      User.count({ where: { department_id: department._id, role: 'student' } }),
    ]);
    const userCount = adminCount + studentCount;
    if (userCount > 0) {
      throw badRequest(
        'Cannot delete department with active users',
        [`${userCount} user(s) are associated with this department. Reassign them first.`],
      );
    }

    await department.destroy();
    res.status(204).end();
  }),
);

export default router;
