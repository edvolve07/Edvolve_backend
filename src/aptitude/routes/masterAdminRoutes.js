import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { Admin, Student, Op, Institution, Department } from '../../database/index.js';
import { config } from '../../config.js';
import { aiService } from '../../services/aiService.js';
import { summarizeAiUsage } from '../../services/aiUsageService.js';
import { updateApiKeyInDb, getProviders, getProviderById } from '../../services/apiKeyService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, locked, notFound } from '../utils/httpError.js';
import { MODULE_OPTIONS, normalizeEmail, ROLES, roleLabel } from '../utils/roles.js';
import { sendAccountCreationEmail, isEmailServiceConfigured } from '../../services/emailService.js';

const router = express.Router();
const assignableRoles = new Set(Object.values(ROLES));
const providerSettings = [
  {
    id: 'groq',
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    description: 'Interview questions, answer evaluation, reports, and speech transcription.',
  },
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    envKey: 'NVIDIA_NIM_API_KEY',
    description: 'AI aptitude question generation when AI_PROVIDER is set to nvidia.',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    description: 'OpenAI-compatible aptitude generation fallback.',
  },
  {
    id: 'generic',
    name: 'Generic AI',
    envKey: 'AI_API_KEY',
    description: 'Generic OpenAI-compatible API key fallback.',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    envKey: 'GEMINI_API_KEY',
    description: 'Gemini provider key for future or external AI workflows.',
  },
];
const providerById = new Map(providerSettings.map((provider) => [provider.id, provider]));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(requireAuth, requireRole(ROLES.MASTER_ADMIN));

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function serializeUser(user) {
  const obj = {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    organization: user.organization || '',
    usn: user.usn || '',
    department_id: user.department_id || null,
    year: user.year || '',
    admin_role: user.admin_role || '',
    modules_access: user.modules_access || ['both'],
    institutionId: user.institutionId || null,
    assigned_admin: user.assigned_admin || null,
    must_change_password: user.must_change_password !== false,
    role: user.role,
    role_label: roleLabel(user.role),
    is_active: user.is_active !== false,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
  if (user.assigned_admin_name) {
    obj.assigned_admin_name = user.assigned_admin_name;
  }
  if (user.department_name) {
    obj.department_name = user.department_name;
  }
  if (user.institution_name) {
    obj.institution_name = user.institution_name;
  }
  return obj;
}

function generateTempPassword(name) {
  const base = String(name || 'user').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 10);
  const random = Math.floor(1000 + Math.random() * 9000);
  return `${base}@${random}`;
}

function validatePhone(phone) {
  return /^[\d\+\-\(\)\s]{7,20}$/.test(String(phone || '').trim());
}

function normalizeModules(value) {
  if (!value) return ['both'];
  const val = String(value).toLowerCase().trim();
  if (['both', 'ai_interview', 'aptitude', 'programming'].includes(val)) return [val];
  if (val.includes(',')) {
    const parts = val.split(',').map((v) => v.trim().toLowerCase()).filter((v) => MODULE_OPTIONS.includes(v));
    if (parts.includes('both') || parts.length === 0) return ['both'];
    return parts;
  }
  return ['both'];
}

function maskSecret(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (trimmed.length <= 8) return '********';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function serializeProvider(provider) {
  const value = process.env[provider.envKey] || '';
  return {
    id: provider.id,
    name: provider.name,
    env_key: provider.envKey,
    description: provider.description,
    configured: Boolean(value),
    masked_value: maskSecret(value),
    updated_runtime: provider.id === 'groq',
  };
}

async function refreshRuntimeProvider(provider, apiKey) {
  try {
    await updateApiKeyInDb(provider.id, apiKey, "master_admin");
  } catch (error) {
    process.env[provider.envKey] = apiKey;
    if (provider.id === 'groq') {
      config.groqApiKeys = String(apiKey || '').split(',').map(s => s.trim()).filter(Boolean);
      aiService.rebuildClients();
    }
  }
}

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && insideQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCsv(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

async function parseSpreadsheet(buffer) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), String(value || '').trim()])),
  );
}

async function parseUserUpload(file) {
  const name = String(file.originalname || '').toLowerCase();
  if (name.endsWith('.csv')) return parseCsv(file.buffer);
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseSpreadsheet(file.buffer);
  throw badRequest('Upload a CSV or Excel file', ['Supported formats: .csv, .xlsx, .xls']);
}

function getRowValue(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value) return String(value).trim();
  }
  return '';
}

function normalizeUploadedRole(value, fallback) {
  const role = String(value || fallback || ROLES.STUDENT)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  return role === 'masteradmin' ? ROLES.MASTER_ADMIN : role;
}

router.get(
  '/dashboard',
  asyncHandler(async (_req, res) => {
    const [
      totalAdmins,
      totalStudents,
      totalInstitutions,
      recentAdmins,
      recentStudents,
    ] = await Promise.all([
      Admin.count(),
      Student.count(),
      Institution.count(),
      Admin.findAll({ order: [['created_at', 'DESC']], limit: 8 }),
      Student.findAll({ order: [['created_at', 'DESC']], limit: 8 }),
    ]);
    const totalUsers = totalAdmins + totalStudents;
    const recentUsers = [...recentAdmins, ...recentStudents]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 8);

    res.json({
      totals: {
        users: totalUsers,
        institutions: totalInstitutions,
      },
      recent_users: recentUsers.map((user) => ({
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        organization: user.organization || '',
        modules_access: user.modules_access || ['both'],
        role: user.role,
        role_label: roleLabel(user.role),
        is_active: user.is_active !== false,
        created_at: user.created_at,
      })),
    });
  }),
);

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const role = String(req.query.role || '').trim();
    const query = String(req.query.query || '').trim();
    const adminId = String(req.query.admin_id || '').trim();
    const institutionId = String(req.query.institution_id || '').trim();

    let users = [];
    if (!role || role === 'student') {
      const studentFilter = {};
      if (adminId) studentFilter.assigned_admin = adminId;
      if (institutionId) studentFilter.institutionId = institutionId;
      if (query) {
        studentFilter[Op.or] = [
          { name: { [Op.iLike]: `%${query}%` } },
          { email: { [Op.iLike]: `%${query}%` } },
        ];
      }
      const students = await Student.findAll({ where: studentFilter, order: [['created_at', 'DESC']], limit });
      users.push(...students);
    }
    if (!role || role === 'admin' || role === 'master_admin') {
      const adminFilter = {};
      if (role && (role === 'admin' || role === 'master_admin')) adminFilter.role = role;
      if (institutionId) adminFilter.institutionId = institutionId;
      if (query) {
        adminFilter[Op.or] = [
          { name: { [Op.iLike]: `%${query}%` } },
          { email: { [Op.iLike]: `%${query}%` } },
        ];
      }
      const admins = await Admin.findAll({ where: adminFilter, order: [['created_at', 'DESC']], limit });
      users.push(...admins);
    }
    users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    users = users.slice(0, limit);

    const adminIds = users.map((u) => u.assigned_admin).filter(Boolean);
    const institutionIds = users.map((u) => u.institutionId).filter(Boolean);

    const [admins, institutions] = await Promise.all([
      adminIds.length
        ? Admin.findAll({ where: { _id: { [Op.in]: adminIds } }, attributes: ['_id', 'name', 'email'], raw: true })
        : [],
      institutionIds.length
        ? Institution.findAll({ where: { _id: { [Op.in]: institutionIds } }, attributes: ['_id', 'name', 'code'], raw: true })
        : [],
    ]);

    const adminMap = new Map(admins.map((a) => [a._id, a]));
    const institutionMap = new Map(institutions.map((i) => [i._id, i]));

    res.json({
      users: users.map((u) => {
        const s = serializeUser(u);
        const admin = adminMap.get(u.assigned_admin);
        if (admin) {
          s.assigned_admin_name = admin.name;
          s.assigned_admin_email = admin.email;
        }
        const inst = institutionMap.get(u.institutionId);
        if (inst) {
          s.institution_name = inst.name || '';
          s.institution_code = inst.code || '';
        }
        return s;
      }),
    });
  }),
);

router.get(
  '/admins-list',
  asyncHandler(async (req, res) => {
    const filter = { role: ROLES.ADMIN };
    if (req.query.institutionId) {
      filter.institutionId = req.query.institutionId;
    }
    const admins = await Admin.findAll({
      where: filter,
      attributes: ['_id', 'name', 'email', 'phone', 'organization', 'modules_access', 'institutionId'],
      order: [['name', 'ASC']],
    });

    const institutionIds = admins.map((a) => a.institutionId).filter(Boolean);
    const institutions = institutionIds.length
      ? await Institution.findAll({ where: { _id: { [Op.in]: institutionIds } }, attributes: ['_id', 'name', 'code'], raw: true })
      : [];
    const institutionMap = new Map(institutions.map((i) => [i._id, i]));

    res.json({
      admins: admins.map((a) => ({
        id: a._id,
        name: a.name,
        email: a.email,
        phone: a.phone || '',
        organization: a.organization || '',
        modules_access: a.modules_access || ['both'],
        institutionId: a.institutionId || null,
        institution_name: institutionMap.get(a.institutionId)?.name || '',
      })),
    });
  }),
);

router.get(
  '/institutions-list',
  asyncHandler(async (_req, res) => {
    const institutions = await Institution.findAll({
      where: { status: 'active' },
      attributes: ['_id', 'name', 'code', 'email'],
      order: [['name', 'ASC']],
    });
    res.json({
      institutions: institutions.map((inst) => ({
        id: inst._id,
        name: inst.name,
        code: inst.code,
        email: inst.email,
      })),
    });
  }),
);

router.post(
  '/admins',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const phone = String(req.body.phone || '').trim();
    const departmentId = req.body.department_id || null;
    const adminRole = req.body.admin_role || '';
    const organization = String(req.body.organization || '').trim();
    const modules = normalizeModules(req.body.modules_access);
    const errors = [];

    if (name.length < 2) errors.push('Full name is required');
    if (!validateEmail(email)) errors.push('A valid email is required');
    if (phone && !validatePhone(phone)) errors.push('Phone number is invalid');
    if (departmentId) {
      const dept = await Department.findByPk(departmentId);
      if (!dept) errors.push('Department not found');
    }
    if (adminRole && !['hod', 'placement_officer'].includes(adminRole)) {
      errors.push("Admin role must be 'hod' or 'placement_officer'");
    }
    if (errors.length) throw badRequest('Validation failed', errors);

    const existingByEmail = await Admin.findOne({ where: { email } });
    if (existingByEmail) throw badRequest('Email is already registered', ['Email is already registered']);

    if (phone) {
      const existingByPhone = await Admin.findOne({ where: { phone } });
      if (existingByPhone) throw badRequest('Phone number is already registered', ['Phone number is already registered']);
    }

    const tempPassword = generateTempPassword(name);
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    const institutionId = req.body.institutionId || null;
    if (institutionId) {
      const institution = await Institution.findByPk(institutionId);
      if (!institution) throw badRequest('Institution not found');
    }

    let departmentName = '';
    if (departmentId) {
      const dept = await Department.findByPk(departmentId);
      if (dept) departmentName = dept.name;
    }

    const user = await Admin.create({
      name,
      email,
      phone,
      department_id: departmentId,
      admin_role: adminRole,
      organization,
      modules_access: modules,
      institutionId: institutionId || undefined,
      role: ROLES.ADMIN,
      password_hash: passwordHash,
      must_change_password: true,
    });

    let emailSent = false;
    if (isEmailServiceConfigured()) {
      try {
        await sendAccountCreationEmail({ to: email, name, tempPassword });
        emailSent = true;
      } catch (err) {
        console.error('[admin-creation] Email failed:', err.message);
      }
    }

    const serialized = serializeUser(user);
    serialized.department_name = departmentName;

    res.status(201).json({
      user: serialized,
      temp_password: tempPassword,
      email_sent: emailSent,
    });
  }),
);

router.post(
  '/admins/import',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Upload file is required', ['Choose a CSV or Excel file']);

    const defaultModules = normalizeModules(req.body.modules_access);
    const institutionId = req.body.institutionId || null;
    const errors = [];

    if (institutionId) {
      const institution = await Institution.findByPk(institutionId);
      if (!institution) throw badRequest('Institution not found');
    }

    let allDepartments = [];
    if (institutionId) {
      allDepartments = await Department.findAll({ where: { institution_id: institutionId } });
    }

    if (errors.length) throw badRequest('Validation failed', errors);

    const rows = await parseUserUpload(req.file);
    if (!rows.length) throw badRequest('No users found in file', ['Add at least one row with name and email']);

    const summary = {
      total_rows: rows.length,
      created: 0,
      skipped: 0,
      errors: [],
      users: [],
      email_failures: [],
    };

    const emailConfigured = isEmailServiceConfigured();

    function deptByName(name) {
      return allDepartments.find((d) => d.name.toLowerCase() === String(name).trim().toLowerCase());
    }

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const name = getRowValue(row, ['name', 'fullname', 'username', 'user']);
      const email = normalizeEmail(getRowValue(row, ['email', 'emailid', 'mail', 'mailid']));
      const phone = getRowValue(row, ['phone', 'phonenumber', 'mobile', 'contact']);
      const organization = getRowValue(row, ['organization', 'org', 'company', 'institution']);
      const departmentName = getRowValue(row, ['department', 'department_name', 'departmentname', 'dept', 'branch']);
      const adminRoleRaw = getRowValue(row, ['admin_role', 'adminrole', 'role', 'position']).toLowerCase().replace(/\s+/g, '_');
      const adminRole = ['hod', 'placement_officer'].includes(adminRoleRaw) ? adminRoleRaw : '';
      const rowModules = normalizeModules(
        getRowValue(row, ['modules', 'modules_access', 'access', 'module']),
      );
      const modules = rowModules[0] === 'both' && defaultModules[0] !== 'both' ? defaultModules : rowModules;

      if (name.length < 2) {
        summary.skipped += 1;
        summary.errors.push(`Row ${rowNumber}: name is required`);
        continue;
      }
      if (!validateEmail(email)) {
        summary.skipped += 1;
        summary.errors.push(`Row ${rowNumber}: valid email is required`);
        continue;
      }

      let departmentId = null;
      if (departmentName) {
        const dept = deptByName(departmentName);
        if (dept) {
          departmentId = dept._id;
        } else {
          summary.skipped += 1;
          summary.errors.push(`Row ${rowNumber}: department "${departmentName}" not found in this institution`);
          continue;
        }
      }

      const existingByEmail = await Admin.findOne({ where: { email } });
      if (existingByEmail) {
        summary.skipped += 1;
        summary.errors.push(`Row ${rowNumber}: email ${email} is already registered`);
        continue;
      }

      if (phone) {
        const existingByPhone = await Admin.findOne({ where: { phone } });
        if (existingByPhone) {
          summary.skipped += 1;
          summary.errors.push(`Row ${rowNumber}: phone ${phone} is already registered`);
          continue;
        }
      }

      const tempPassword = generateTempPassword(name);
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      try {
        const user = await Admin.create({
          name,
          email,
          phone,
          department_id: departmentId,
          admin_role: adminRole,
          organization,
          modules_access: modules,
          role: ROLES.ADMIN,
          institutionId: institutionId || undefined,
          password_hash: passwordHash,
          must_change_password: true,
        });

        if (emailConfigured) {
          sendAccountCreationEmail({ to: email, name, tempPassword })
            .catch((err) => { summary.email_failures.push({ email, error: err.message }); });
        }

        const serialized = serializeUser(user);
        if (departmentName) serialized.department_name = departmentName;
        serialized.temp_password = tempPassword;
        summary.created += 1;
        summary.users.push(serialized);
      } catch (createError) {
        summary.skipped += 1;
        summary.errors.push(`Row ${rowNumber}: ${createError.message}`);
      }
    }

    res.status(201).json(summary);
  }),
);

router.post(
  '/users/create-with-details',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const phone = String(req.body.phone || '').trim();
    const usn = String(req.body.usn || '').trim();
    const departmentId = req.body.department_id || null;
    const year = String(req.body.year || '').trim();
    const organization = String(req.body.organization || '').trim();
    const assignedAdminId = req.body.assigned_admin || null;
    const institutionId = req.body.institutionId || null;
    const errors = [];

    if (name.length < 2) errors.push('Full name is required');
    if (!validateEmail(email)) errors.push('A valid email is required');
    if (phone && !validatePhone(phone)) errors.push('Phone number is invalid');
    if (departmentId) {
      const dept = await Department.findByPk(departmentId);
      if (!dept) errors.push('Department not found');
    }
    if (year && !['1st', '2nd', '3rd', '4th'].includes(year)) {
      errors.push("Year must be one of: 1st, 2nd, 3rd, 4th");
    }
    if (errors.length) throw badRequest('Validation failed', errors);

    const existingByEmail = await Student.findOne({ where: { email } });
    if (existingByEmail) throw badRequest('Email is already registered', ['Email is already registered']);

    if (phone) {
      const existingByPhone = await Student.findOne({ where: { phone } });
      if (existingByPhone) throw badRequest('Phone number is already registered', ['Phone number is already registered']);
    }

    if (usn) {
      const existingByUsn = await Student.findOne({ where: { usn } });
      if (existingByUsn) throw badRequest('USN is already registered', ['USN is already registered']);
    }

    let effectiveInstitutionId = institutionId;
    let modulesAccess = ['both'];
    let assignedAdminName = '';
    let departmentName = '';

    if (institutionId) {
      const institution = await Institution.findByPk(institutionId);
      if (!institution) throw badRequest('Institution not found');
    }

    if (departmentId) {
      const dept = await Department.findByPk(departmentId);
      if (dept) departmentName = dept.name;
    }

    if (assignedAdminId) {
      const admin = await Admin.findByPk(assignedAdminId);
      if (!admin || (admin.role !== 'admin' && admin.role !== 'master_admin')) {
        throw badRequest('Assigned admin not found', ['Specified admin does not exist']);
      }
      modulesAccess = admin.modules_access || ['both'];
      assignedAdminName = admin.name;
      if (!effectiveInstitutionId && admin.institutionId) {
        effectiveInstitutionId = admin.institutionId;
      }
    }

    const tempPassword = generateTempPassword(name);

    const user = await Student.create({
      name,
      email,
      phone,
      usn: usn || undefined,
      department_id: departmentId,
      year: year || undefined,
      organization,
      modules_access: modulesAccess,
      institutionId: effectiveInstitutionId || undefined,
      assigned_admin: assignedAdminId || null,
      role: ROLES.STUDENT,
      password_hash: await bcrypt.hash(tempPassword, 10),
      must_change_password: true,
    });

    let emailSent = false;
    if (isEmailServiceConfigured()) {
      try {
        await sendAccountCreationEmail({ to: email, name, tempPassword });
        emailSent = true;
      } catch (err) {
        console.error('[user-creation] Email failed:', err.message);
      }
    }

    const serialized = serializeUser(user);
    serialized.assigned_admin_name = assignedAdminName;
    serialized.department_name = departmentName;

    res.status(201).json({
      user: serialized,
      temp_password: tempPassword,
      email_sent: emailSent,
    });
  }),
);

router.post(
  '/users/import-with-details',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Upload file is required', ['Choose a CSV or Excel file']);

    const assignedAdminId = req.body.assigned_admin || null;
    const institutionId = req.body.institutionId || null;
    const errors = [];

    let defaultModules = ['both'];
    let assignedAdminName = '';
    let effectiveInstitutionId = institutionId;

    if (institutionId) {
      const institution = await Institution.findByPk(institutionId);
      if (!institution) throw badRequest('Institution not found');
    }

    let allDepartments = [];
    if (institutionId) {
      allDepartments = await Department.findAll({ where: { institution_id: institutionId } });
    }

    if (assignedAdminId) {
      const admin = await Admin.findByPk(assignedAdminId);
      if (!admin || (admin.role !== 'admin' && admin.role !== 'master_admin')) {
        throw badRequest('Assigned admin not found', ['Specified admin does not exist']);
      }
      defaultModules = admin.modules_access || ['both'];
      assignedAdminName = admin.name;
      if (!effectiveInstitutionId && admin.institutionId) {
        effectiveInstitutionId = admin.institutionId;
      }
    }

    if (errors.length) throw badRequest('Validation failed', errors);

    const rows = await parseUserUpload(req.file);
    if (!rows.length) throw badRequest('No users found in file', ['Add at least one row with name and email']);

    const summary = {
      total_rows: rows.length,
      created: 0,
      skipped: 0,
      errors: [],
      users: [],
      email_failures: [],
    };

    const emailConfigured = isEmailServiceConfigured();

    function deptByName(name) {
      return allDepartments.find((d) => d.name.toLowerCase() === String(name).trim().toLowerCase());
    }

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const name = getRowValue(row, ['name', 'fullname', 'username', 'user']);
      const email = normalizeEmail(getRowValue(row, ['email', 'emailid', 'mail', 'mailid']));
      const phone = getRowValue(row, ['phone', 'phonenumber', 'mobile', 'contact']);
      const usn = getRowValue(row, ['usn', 'rollno', 'roll_no', 'rollnumber', 'regno', 'reg_no', 'regnumber']);
      const departmentName = getRowValue(row, ['department', 'department_name', 'departmentname', 'dept', 'branch']);
      const yearRaw = getRowValue(row, ['year', 'academic_year', 'academicyear', 'semester']).toLowerCase().trim();
      const year = ['1st', '2nd', '3rd', '4th'].includes(yearRaw) ? yearRaw : '';
      const organization = getRowValue(row, ['organization', 'org', 'company', 'institution']);

      if (name.length < 2) {
        summary.skipped += 1;
        summary.errors.push(`Row ${rowNumber}: name is required`);
        continue;
      }
      if (!validateEmail(email)) {
        summary.skipped += 1;
        summary.errors.push(`Row ${rowNumber}: valid email is required`);
        continue;
      }

      let departmentId = null;
      let resolvedDeptName = '';
      if (departmentName) {
        const dept = deptByName(departmentName);
        if (dept) {
          departmentId = dept._id;
          resolvedDeptName = dept.name;
        } else {
          summary.skipped += 1;
          summary.errors.push(`Row ${rowNumber}: department "${departmentName}" not found in this institution`);
          continue;
        }
      }

      const existingByEmail = await Student.findOne({ where: { email } });
      if (existingByEmail) {
        summary.skipped += 1;
        summary.errors.push(`Row ${rowNumber}: email ${email} is already registered`);
        continue;
      }

      if (phone) {
        const existingByPhone = await Student.findOne({ where: { phone } });
        if (existingByPhone) {
          summary.skipped += 1;
          summary.errors.push(`Row ${rowNumber}: phone ${phone} is already registered`);
          continue;
        }
      }

      if (usn) {
        const existingByUsn = await Student.findOne({ where: { usn } });
        if (existingByUsn) {
          summary.skipped += 1;
          summary.errors.push(`Row ${rowNumber}: USN ${usn} is already registered`);
          continue;
        }
      }

      const tempPassword = generateTempPassword(name);

      try {
        const user = await Student.create({
          name,
          email,
          phone,
          usn: usn || undefined,
          department_id: departmentId,
          year: year || undefined,
          organization,
          modules_access: defaultModules,
          institutionId: effectiveInstitutionId || undefined,
          assigned_admin: assignedAdminId || null,
          role: ROLES.STUDENT,
          password_hash: await bcrypt.hash(tempPassword, 10),
          must_change_password: true,
        });

        if (emailConfigured) {
          sendAccountCreationEmail({ to: email, name, tempPassword })
            .catch((err) => { summary.email_failures.push({ email, error: err.message }); });
        }

        const serialized = serializeUser(user);
        if (assignedAdminName) serialized.assigned_admin_name = assignedAdminName;
        if (resolvedDeptName) serialized.department_name = resolvedDeptName;
        serialized.temp_password = tempPassword;
        summary.created += 1;
        summary.users.push(serialized);
      } catch (createError) {
        summary.skipped += 1;
        summary.errors.push(`Row ${rowNumber}: ${createError.message}`);
      }
    }

    res.status(201).json(summary);
  }),
);

router.get(
  '/api-keys',
  asyncHandler(async (_req, res) => {
    res.json({ providers: providerSettings.map(serializeProvider) });
  }),
);

router.patch(
  '/api-keys/:providerId',
  asyncHandler(async (req, res) => {
    const provider = providerById.get(String(req.params.providerId || '').toLowerCase());
    if (!provider) throw notFound('Provider not found');

    const apiKey = String(req.body.api_key || '').trim();
    if (apiKey.length < 8) {
      throw badRequest('API key is too short', ['API key must be at least 8 characters']);
    }

    await refreshRuntimeProvider(provider, apiKey);

    res.json({ provider: serializeProvider(provider) });
  }),
);

router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const phone = String(req.body.phone || '').trim();
    const organization = String(req.body.organization || '').trim();
    const modules = normalizeModules(req.body.modules_access);
    const assignedAdminId = req.body.assigned_admin || null;
    const password = String(req.body.password || '');
    const role = String(req.body.role || ROLES.STUDENT);
    const errors = [];

    if (name.length < 2) errors.push('Full name is required');
    if (!validateEmail(email)) errors.push('A valid email is required');
    if (password.length < 8 && !req.body.skip_email) errors.push('Password must be at least 8 characters');
    if (!assignableRoles.has(role)) errors.push('Invalid role');
    if (phone && !validatePhone(phone)) errors.push('Phone number is invalid');
    if (errors.length) throw badRequest('Validation failed', errors);

    const [existingByEmailAdmin, existingByEmailStudent] = await Promise.all([
      Admin.findOne({ where: { email } }),
      Student.findOne({ where: { email } }),
    ]);
    if (existingByEmailAdmin || existingByEmailStudent) throw badRequest('Email is already registered', ['Email is already registered']);

    if (phone) {
      const [existingByPhoneAdmin, existingByPhoneStudent] = await Promise.all([
        Admin.findOne({ where: { phone } }),
        Student.findOne({ where: { phone } }),
      ]);
      if (existingByPhoneAdmin || existingByPhoneStudent) throw badRequest('Phone number is already registered', ['Phone number is already registered']);
    }

    const effectivePassword = password.length >= 8 ? password : generateTempPassword(name);
    const Model = role === 'student' ? Student : Admin;
    const user = await Model.create({
      name,
      email,
      phone,
      organization,
      modules_access: modules,
      assigned_admin: assignedAdminId || null,
      role,
      password_hash: await bcrypt.hash(effectivePassword, 10),
      must_change_password: true,
    });

    let emailSent = false;
    if (isEmailServiceConfigured()) {
      try {
        await sendAccountCreationEmail({ to: email, name, tempPassword: effectivePassword });
        emailSent = true;
      } catch (err) {
        console.error('[user-creation] Email failed:', err.message);
      }
    }

    res.status(201).json({
      user: serializeUser(user),
      temp_password: password.length < 8 ? effectivePassword : undefined,
      email_sent: emailSent,
    });
  }),
);

router.post(
  '/users/import',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Upload file is required', ['Choose a CSV or Excel file']);

    const defaultRole = String(req.body.role || ROLES.STUDENT);
    const roleMode = String(req.body.role_mode || 'fixed');
    const password = String(req.body.password || '');
    const defaultModules = normalizeModules(req.body.modules_access);
    const assignedAdminId = req.body.assigned_admin || null;
    const errors = [];

    if (roleMode !== 'file' && !assignableRoles.has(defaultRole)) errors.push('Invalid role');
    if (errors.length) throw badRequest('Validation failed', errors);

    const rows = await parseUserUpload(req.file);
    if (!rows.length) throw badRequest('No users found in file', ['Add at least one row with name and email']);

    const summary = {
      total_rows: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      users: [],
      email_failures: [],
    };

    const emailConfigured = isEmailServiceConfigured();

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const name = getRowValue(row, ['name', 'fullname', 'username', 'user']);
      const email = normalizeEmail(getRowValue(row, ['email', 'emailid', 'mail', 'mailid']));
      const phone = getRowValue(row, ['phone', 'phonenumber', 'mobile', 'contact']);
      const organization = getRowValue(row, ['organization', 'org', 'company', 'institution']);
      const role = normalizeUploadedRole(
        roleMode === 'file' ? getRowValue(row, ['role', 'usertype', 'access']) : defaultRole,
        defaultRole,
      );
      const rowModules = normalizeModules(
        getRowValue(row, ['modules', 'modules_access', 'access', 'module']),
      );
      const modules = rowModules[0] === 'both' && defaultModules[0] !== 'both' ? defaultModules : rowModules;

      if (name.length < 2) {
        summary.skipped += 1;
        summary.errors.push(`Row ${rowNumber}: name is required`);
        continue;
      }
      if (!validateEmail(email)) {
        summary.skipped += 1;
        summary.errors.push(`Row ${rowNumber}: valid email is required`);
        continue;
      }
      if (!assignableRoles.has(role)) {
        summary.skipped += 1;
        summary.errors.push(`Row ${rowNumber}: invalid role`);
        continue;
      }
      if (phone && !validatePhone(phone)) {
        summary.skipped += 1;
        summary.errors.push(`Row ${rowNumber}: invalid phone number`);
        continue;
      }

      let existing = await Admin.findOne({ where: { email } });
      let existingModel = 'Admin';
      if (!existing) {
        existing = await Student.findOne({ where: { email } });
        existingModel = 'Student';
      }
      if (existing) {
        if (existing._id === req.user._id && role !== ROLES.MASTER_ADMIN) {
          summary.skipped += 1;
          summary.errors.push(`Row ${rowNumber}: cannot remove your own master admin access`);
          continue;
        }

        existing.name = name;
        existing.role = role;
        if (phone) existing.phone = phone;
        if (organization) existing.organization = organization;
        if (modules) existing.modules_access = modules;
        await existing.save();
        summary.updated += 1;
        summary.users.push({ ...serializeUser(existing), action: 'updated' });
        continue;
      }

      if (phone) {
        const [existingByPhoneAdmin, existingByPhoneStudent] = await Promise.all([
          Admin.findOne({ where: { phone } }),
          Student.findOne({ where: { phone } }),
        ]);
        if (existingByPhoneAdmin || existingByPhoneStudent) {
          summary.skipped += 1;
          summary.errors.push(`Row ${rowNumber}: phone ${phone} is already registered`);
          continue;
        }
      }

      const effectivePassword = password.length >= 8 ? password : generateTempPassword(name);
      const Model = role === 'student' ? Student : Admin;
      const user = await Model.create({
        name,
        email,
        phone,
        organization,
        modules_access: modules,
        assigned_admin: assignedAdminId || null,
        role,
        password_hash: await bcrypt.hash(effectivePassword, 10),
        must_change_password: true,
      });

      if (emailConfigured) {
        sendAccountCreationEmail({ to: email, name, tempPassword: effectivePassword })
          .catch((err) => { summary.email_failures.push({ email, error: err.message }); });
      }

      summary.created += 1;
      summary.users.push({ ...serializeUser(user), action: 'created' });
    }

    res.status(201).json(summary);
  }),
);

router.patch(
  '/users/:id/role',
  asyncHandler(async (req, res) => {
    const role = String(req.body.role || '');
    if (!assignableRoles.has(role)) throw badRequest('Invalid role', ['Invalid role']);

    if (req.params.id === req.user._id && role !== ROLES.MASTER_ADMIN) {
      throw forbidden('You cannot remove your own master admin access');
    }

    let user = await Admin.findByPk(req.params.id);
    if (!user) user = await Student.findByPk(req.params.id);
    if (!user) throw notFound('User not found');

    user.role = role;
    await user.save();
    res.json({ user: serializeUser(user) });
  }),
);

router.patch(
  '/users/:id/modules',
  asyncHandler(async (req, res) => {
    const modules = req.body.modules_access;
    if (!Array.isArray(modules) || modules.length === 0) {
      throw badRequest('Invalid modules', ['modules_access must be a non-empty array']);
    }
    const valid = modules.every((m) => MODULE_OPTIONS.includes(m));
    if (!valid) throw badRequest('Invalid module', ['Valid modules: ai_interview, aptitude, programming, both']);

    let user = await Admin.findByPk(req.params.id);
    if (!user) user = await Student.findByPk(req.params.id);
    if (!user) throw notFound('User not found');

    const normalizedModules = modules.includes('both') ? ['both'] : modules;
    user.modules_access = normalizedModules;
    await user.save();

    await Student.update(
      { modules_access: normalizedModules },
      { where: { assigned_admin: user._id } },
    );

    res.json({ user: serializeUser(user) });
  }),
);

router.patch(
  '/users/:id/revoke',
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user._id) {
      throw forbidden('You cannot revoke your own access');
    }

    let user = await Admin.findByPk(req.params.id);
    if (!user) user = await Student.findByPk(req.params.id);
    if (!user) throw notFound('User not found');

    user.is_active = false;
    await user.save();

    if (user.role === ROLES.ADMIN) {
      await Student.update(
        { is_active: false },
        { where: { assigned_admin: user._id } },
      );
    }

    res.json({ user: serializeUser(user) });
  }),
);

router.patch(
  '/users/:id/restore',
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user._id) {
      throw forbidden('You cannot restore your own access');
    }

    let user = await Admin.findByPk(req.params.id);
    if (!user) user = await Student.findByPk(req.params.id);
    if (!user) throw notFound('User not found');

    user.is_active = true;
    await user.save();

    res.json({ user: serializeUser(user) });
  }),
);

router.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user._id) {
      throw forbidden('You cannot delete your own account');
    }

    let user = await Admin.findByPk(req.params.id);
    if (!user) user = await Student.findByPk(req.params.id);
    if (!user) throw notFound('User not found');

    if (user.role === 'student') {
      await Student.destroy({ where: { _id: user._id } });
    } else {
      await Admin.destroy({ where: { _id: user._id } });
    }
    res.status(204).end();
  }),
);

export default router;
