import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import { User, Op } from '../../database/index.js';
import { findUserByEmail, findUserByPk } from '../utils/userUtils.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError, badRequest, locked, unauthorized } from '../utils/httpError.js';
import { normalizeEmail, roleForEmail, ROLES } from '../utils/roles.js';
import { verifyPassword } from '../../utils/auth.js';
import {
  RESET_TOKEN_TTL_MINUTES,
  getPasswordResetBaseUrl,
  isEmailServiceConfigured,
  sendPasswordResetEmail,
} from '../../services/emailService.js';

const router = express.Router();

function toSafeJSON(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    organization: user.organization || '',
    interested_role: user.interested_role || '',
    profile_headline: user.profile_headline || '',
    profile_bio: user.profile_bio || '',
    location: user.location || '',
    modules_access: user.modules_access || ['both'],
    usn: user.usn || '',
    department_id: user.department_id || null,
    year: user.year || '',
    admin_role: user.admin_role || '',
    institutionId: user.institutionId || null,
    assigned_admin: user.assigned_admin || null,
    must_change_password: user.must_change_password !== false,
    role: user.role,
    is_active: user.is_active !== false,
    email_verified: user.email_verified !== false,
    created_at: user.created_at,
    updated_at: user.updated_at,
    subscription_id: user.subscription_id || null,
    subscription_status: user.subscription_status || null,
    journey_access: user.journey_access || 0,
    current_level: user.current_level || 1,
    current_interview: user.current_interview || 1,
    journey_access_level: user.journey_access_level || 0,
    current_interview_number: user.current_interview_number || 1,
    completed_interviews: user.completed_interviews || 0,
    total_interviews: user.total_interviews || 24,
    overall_score: user.overall_score || 0,
    readiness_score: user.readiness_score || 0,
    journey_status: user.journey_status || 'not_started',
    _enterprise_profile_id: user._enterprise_profile_id || null,
    _individual_profile_id: user._individual_profile_id || null,
  };
}

function signToken(user) {
  return jwt.sign({ sub: user._id, role: user.role }, getJwtSecret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function getJwtSecret() {
  if (!process.env.JWT_SECRET) {
    throw new HttpError(503, 'Authentication service is not configured', [
      'Set JWT_SECRET in the backend environment',
    ]);
  }
  return process.env.JWT_SECRET;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePhone(phone) {
  return /^[\d\+\-\(\)\s]{7,20}$/.test(String(phone || '').trim());
}

function cleanProfileField(value, maxLength) {
  const text = String(value || '').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function passwordResetResponse() {
  return {
    message: 'If that email is registered, a password reset link has been sent.',
  };
}

router.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const { name, email, password, confirmPassword } = req.body;
    const errors = [];

    if (!name || name.trim().length < 2) errors.push('Full name is required');
    if (!email || !validateEmail(email)) errors.push('A valid email is required');
    if (!password || password.length < 8) {
      errors.push('Password must be at least 8 characters');
    }
    if (password !== confirmPassword) errors.push('Passwords do not match');
    if (errors.length) throw badRequest('Validation failed', errors);
    getJwtSecret();

    const normalizedEmail = normalizeEmail(email);

    const existing = await findUserByEmail(normalizedEmail);
    if (existing) throw badRequest('Email is already registered');

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      role: ROLES.MASTER_ADMIN,
      email_verified: true,
    });

    res.status(201).json({
      user: toSafeJSON(user),
      token: signToken(user),
      message: 'Account created successfully.',
    });
  }),
);

router.post(
  '/individual-signup',
  asyncHandler(async (req, res) => {
    const { name, email, password, confirmPassword, plan_key } = req.body;
    const errors = [];

    if (!name || name.trim().length < 2) errors.push('Full name is required');
    if (!email || !validateEmail(email)) errors.push('A valid email is required');
    if (!password || password.length < 8) errors.push('Password must be at least 8 characters');
    if (password !== confirmPassword) errors.push('Passwords do not match');
    if (errors.length) throw badRequest('Validation failed', errors);
    getJwtSecret();

    const normalizedEmail = normalizeEmail(email);
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) throw badRequest('Email is already registered');

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      role: 'individual_student',
      email_verified: true,
      must_change_password: false,
      is_active: true,
    });

    const { getSequelize } = await import('../../database/index.js');
    await getSequelize().query(
      `INSERT INTO individual_students (_id, user_id, subscription_status, created_at, updated_at)
       VALUES (gen_random_uuid(), :userId, 'inactive', NOW(), NOW())`,
      { replacements: { userId: user._id } }
    );

    res.status(201).json({
      user: toSafeJSON(user),
      token: signToken(user),
      message: 'Account created successfully.',
    });
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) throw badRequest('Email and password are required');
    getJwtSecret();

    const normalizedEmail = normalizeEmail(email);
    const userRow = await User.findOne({ where: { email: normalizedEmail } });
    if (!userRow) throw unauthorized('Invalid email or password');

    const isBcryptHash = String(userRow.password_hash || '').startsWith('$2');
    const valid = isBcryptHash
      ? await bcrypt.compare(password, userRow.password_hash)
      : userRow.password_salt
        ? await verifyPassword(password, userRow.password_salt, userRow.password_hash)
        : false;
    if (!valid) throw unauthorized('Invalid email or password');
    if (userRow.is_active === false) throw locked();

    const configuredRole = roleForEmail(normalizedEmail);
    let needsSave = false;
    if (!isBcryptHash) {
      userRow.password_hash = await bcrypt.hash(password, 10);
      userRow.password_salt = null;
      needsSave = true;
    }

    if (configuredRole !== ROLES.STUDENT && userRow.role !== configuredRole) {
      userRow.role = configuredRole;
      needsSave = true;
    }

    if (needsSave) {
      await userRow.save();
    }

    const user = await import('../utils/userContext.js').then(m => m.buildUserContext(userRow._id));

    res.json({ user: toSafeJSON(user), token: signToken(user) });
  }),
);

router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const normalizedEmail = normalizeEmail(req.body.email);
    if (!validateEmail(normalizedEmail)) throw badRequest('A valid email is required');
    if (!isEmailServiceConfigured()) {
      throw new HttpError(503, 'Password reset email is not configured', [
        'Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM in .env',
      ]);
    }

    const user = await User.findOne({ where: { email: normalizedEmail } });
    if (!user) {
      res.json(passwordResetResponse());
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const resetUrl = new URL('/reset-password', getPasswordResetBaseUrl(req));
    resetUrl.searchParams.set('token', token);

    user.password_reset_token_hash = hashResetToken(token);
    user.password_reset_expires_at = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
    await user.save();

    try {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetLink: resetUrl.toString(),
      });
    } catch (error) {
      user.password_reset_token_hash = null;
      user.password_reset_expires_at = null;
      await user.save();
      throw new HttpError(503, 'Password reset email could not be sent', [
        error.message || 'Email delivery failed',
      ]);
    }

    res.json(passwordResetResponse());
  }),
);

router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');
    const confirmPassword = String(req.body.confirmPassword || '');
    const errors = [];

    if (!token) errors.push('Reset token is required');
    if (password.length < 8) errors.push('Password must be at least 8 characters');
    if (password !== confirmPassword) errors.push('Passwords do not match');
    if (errors.length) throw badRequest('Validation failed', errors);

    const tokenHash = hashResetToken(token);
    const user = await User.findOne({
      where: {
        password_reset_token_hash: tokenHash,
        password_reset_expires_at: { [Op.gt]: new Date() },
      },
    });

    if (!user) {
      throw badRequest('Reset link is invalid or expired', [
        'Password reset links expire after 5 minutes. Request a new link.',
      ]);
    }

    user.password_hash = await bcrypt.hash(password, 10);
    user.password_salt = null;
    user.password_reset_token_hash = null;
    user.password_reset_expires_at = null;
    await user.save();

    res.json({ message: 'Password has been reset. You can now sign in.' });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: toSafeJSON(req.user) });
  }),
);

router.put(
  '/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const name = cleanProfileField(req.body.name, 80);
    const phone = cleanProfileField(req.body.phone, 20);
    const organization = cleanProfileField(req.body.organization, 120);
    const interestedRole = cleanProfileField(req.body.interested_role, 80);
    const profileHeadline = cleanProfileField(req.body.profile_headline, 120);
    const profileBio = cleanProfileField(req.body.profile_bio, 500);
    const location = cleanProfileField(req.body.location, 80);
    const errors = [];

    if (!name || name.length < 2) errors.push('Full name must be at least 2 characters');
    if (phone && !validatePhone(phone)) errors.push('Phone number is invalid');
    if (errors.length) throw badRequest('Validation failed', errors);

    if (phone) {
      const existingPhone = await User.findOne({ where: { phone, _id: { [Op.ne]: req.user._id } } });
      if (existingPhone) {
        throw badRequest('Phone number is already registered', ['Phone number is already registered']);
      }
    }

    const user = await User.findByPk(req.user._id);
    if (!user) throw unauthorized('User not found');

    user.name = name;
    user.phone = phone;
    user.organization = organization;
    user.interested_role = interestedRole;
    user.profile_headline = profileHeadline;
    user.profile_bio = profileBio;
    user.location = location;
    await user.save();

    const updated = await import('../utils/userContext.js').then(m => m.buildUserContext(user._id));

    res.json({
      message: 'Profile updated successfully.',
      user: toSafeJSON(updated),
    });
  }),
);

router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const token = String(req.body.token || '').trim();
    const email = normalizeEmail(req.body.email);
    if (!token || !email) throw badRequest('Verification token and email are required');

    const tokenHash = hashResetToken(token);
    const user = await User.findOne({
      where: {
        email,
        email_verification_token: tokenHash,
        email_verification_expires_at: { [Op.gt]: new Date() },
      },
    });
    if (!user) throw badRequest('Verification link is invalid or expired');

    user.email_verified = true;
    user.email_verification_token = null;
    user.email_verification_expires_at = null;
    await user.save();

    res.json({ message: 'Email verified successfully.' });
  }),
);

router.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const errors = [];

    if (!currentPassword) errors.push('Current password is required');
    if (!newPassword || newPassword.length < 8) errors.push('New password must be at least 8 characters');
    if (newPassword !== confirmPassword) errors.push('Passwords do not match');
    if (errors.length) throw badRequest('Validation failed', errors);

    const user = await User.findByPk(req.user._id);
    if (!user) throw unauthorized('User not found');

    const isBcryptHash = String(user.password_hash || '').startsWith('$2');
    const valid = isBcryptHash
      ? await bcrypt.compare(currentPassword, user.password_hash)
      : user.password_salt
        ? await verifyPassword(currentPassword, user.password_salt, user.password_hash)
        : false;

    if (!valid) throw badRequest('Current password is incorrect');

    user.password_hash = await bcrypt.hash(newPassword, 10);
    user.password_salt = null;
    user.must_change_password = false;
    await user.save();

    const updated = await import('../utils/userContext.js').then(m => m.buildUserContext(user._id));
    const token = signToken(updated);

    res.json({
      message: 'Password has been changed successfully.',
      user: toSafeJSON(updated),
      token,
    });
  }),
);

export default router;
