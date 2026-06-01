import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import multer from 'multer';
import path from 'node:path';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { User } from '../models/User.js';
import { config } from '../../config.js';
import { aiService } from '../../services/aiService.js';
import { summarizeAiUsage } from '../../services/aiUsageService.js';
import { transcriber } from '../../services/transcriber.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';
import { normalizeEmail, ROLES, roleLabel } from '../utils/roles.js';

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
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    role_label: roleLabel(user.role),
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
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

function escapeEnvValue(value) {
  const text = String(value || '');
  if (!/[#\s"'\\]/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function writeEnvValue(key, value) {
  const envPath = path.join(process.cwd(), '.env');
  let content = '';

  try {
    content = await fs.readFile(envPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const nextLine = `${key}=${escapeEnvValue(value)}`;
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim().startsWith(`${key}=`));

  if (index >= 0) {
    lines[index] = nextLine;
  } else {
    if (lines.length && lines[lines.length - 1].trim()) lines.push('');
    lines.push(nextLine);
  }

  await fs.writeFile(envPath, `${lines.join('\n').replace(/\n+$/, '')}\n`);
}

function refreshRuntimeProvider(provider, apiKey) {
  process.env[provider.envKey] = apiKey;
  if (provider.id === 'groq') {
    config.groqApiKey = apiKey;
    aiService.setApiKey(apiKey);
    transcriber.setApiKey(apiKey);
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
      totalUsers,
      students,
      admins,
      masterAdmins,
      recentUsers,
      aiUsage,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: ROLES.STUDENT }),
      User.countDocuments({ role: ROLES.ADMIN }),
      User.countDocuments({ role: ROLES.MASTER_ADMIN }),
      User.find().sort({ created_at: -1 }).limit(8),
      summarizeAiUsage(),
    ]);

    res.json({
      totals: {
        users: totalUsers,
        students,
        admins,
        master_admins: masterAdmins,
      },
      recent_users: recentUsers.map((user) => ({
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        role_label: roleLabel(user.role),
        created_at: user.created_at,
      })),
      ai_usage: aiUsage,
    });
  }),
);

router.get(
  '/users',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const role = String(req.query.role || '').trim();
    const query = String(req.query.query || '').trim();
    const filter = {};

    if (role && assignableRoles.has(role)) {
      filter.role = role;
    }

    if (query) {
      filter.$or = [
        { name: { $regex: query, $options: 'i' } },
        { email: { $regex: query, $options: 'i' } },
      ];
    }

    const users = await User.find(filter).sort({ created_at: -1 }).limit(limit);
    res.json({ users: users.map(serializeUser) });
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

    await writeEnvValue(provider.envKey, apiKey);
    refreshRuntimeProvider(provider, apiKey);

    res.json({ provider: serializeProvider(provider) });
  }),
);

router.post(
  '/users',
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const role = String(req.body.role || ROLES.STUDENT);
    const errors = [];

    if (name.length < 2) errors.push('Full name is required');
    if (!validateEmail(email)) errors.push('A valid email is required');
    if (password.length < 8) errors.push('Password must be at least 8 characters');
    if (!assignableRoles.has(role)) errors.push('Invalid role');
    if (errors.length) throw badRequest('Validation failed', errors);

    const existing = await User.findOne({ email });
    if (existing) throw badRequest('Email is already registered', ['Email is already registered']);

    const user = await User.create({
      name,
      email,
      role,
      password_hash: await bcrypt.hash(password, 12),
    });

    res.status(201).json({ user: serializeUser(user) });
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
    const errors = [];

    if (roleMode !== 'file' && !assignableRoles.has(defaultRole)) errors.push('Invalid role');
    if (password.length < 8) errors.push('Temporary password must be at least 8 characters');
    if (errors.length) throw badRequest('Validation failed', errors);

    const rows = await parseUserUpload(req.file);
    if (!rows.length) throw badRequest('No users found in file', ['Add at least one row with name and email']);

    const passwordHash = await bcrypt.hash(password, 12);
    const summary = {
      total_rows: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
      users: [],
    };

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const name = getRowValue(row, ['name', 'fullname', 'username', 'user']);
      const email = normalizeEmail(getRowValue(row, ['email', 'emailid', 'mail', 'mailid']));
      const role = normalizeUploadedRole(
        roleMode === 'file' ? getRowValue(row, ['role', 'usertype', 'access']) : defaultRole,
        defaultRole,
      );

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

      const existing = await User.findOne({ email });
      if (existing) {
        if (existing._id.toString() === req.user._id.toString() && role !== ROLES.MASTER_ADMIN) {
          summary.skipped += 1;
          summary.errors.push(`Row ${rowNumber}: cannot remove your own master admin access`);
          continue;
        }

        existing.name = name;
        existing.role = role;
        await existing.save();
        summary.updated += 1;
        summary.users.push({ ...serializeUser(existing), action: 'updated' });
        continue;
      }

      const user = await User.create({
        name,
        email,
        role,
        password_hash: passwordHash,
        password_salt: crypto.randomBytes(8).toString('hex'),
      });
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

    if (req.params.id === req.user._id.toString() && role !== ROLES.MASTER_ADMIN) {
      throw forbidden('You cannot remove your own master admin access');
    }

    const user = await User.findById(req.params.id);
    if (!user) throw notFound('User not found');

    user.role = role;
    await user.save();
    res.json({ user: serializeUser(user) });
  }),
);

export default router;
