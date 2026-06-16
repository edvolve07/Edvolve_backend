import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth.js';
import { User } from '../models/User.js';
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

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, getJwtSecret(), {
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
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) throw badRequest('Email is already registered');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      role: roleForEmail(normalizedEmail),
    });

    res.status(201).json({ user: user.toSafeJSON(), token: signToken(user) });
  }),
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) throw badRequest('Email and password are required');
    getJwtSecret();

    const normalizedEmail = normalizeEmail(email);
    const user = await User.findOne({ email: normalizedEmail }).select(
      '+password_hash +password_salt',
    );
    if (!user) throw unauthorized('Invalid email or password');

    const isBcryptHash = String(user.password_hash || '').startsWith('$2');
    const valid = isBcryptHash
      ? await bcrypt.compare(password, user.password_hash)
      : user.password_salt
        ? await verifyPassword(password, user.password_salt, user.password_hash)
        : false;
    if (!valid) throw unauthorized('Invalid email or password');
    if (user.is_active === false) throw locked();

    const configuredRole = roleForEmail(normalizedEmail);
    if (!isBcryptHash) {
      user.password_hash = await bcrypt.hash(password, 12);
      user.password_salt = undefined;
    }

    if (configuredRole !== ROLES.STUDENT && user.role !== configuredRole) {
      user.role = configuredRole;
    }

    if (!isBcryptHash || user.isModified('role')) {
      await user.save();
    }

    res.json({ user: user.toSafeJSON(), token: signToken(user) });
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

    const user = await User.findOne({ email: normalizedEmail });
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
      user.password_reset_token_hash = undefined;
      user.password_reset_expires_at = undefined;
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

    const user = await User.findOne({
      password_reset_token_hash: hashResetToken(token),
      password_reset_expires_at: { $gt: new Date() },
    }).select('+password_hash +password_salt +password_reset_token_hash');

    if (!user) {
      throw badRequest('Reset link is invalid or expired', [
        'Password reset links expire after 5 minutes. Request a new link.',
      ]);
    }

    user.password_hash = await bcrypt.hash(password, 12);
    user.password_salt = undefined;
    user.password_reset_token_hash = undefined;
    user.password_reset_expires_at = undefined;
    await user.save();

    res.json({ message: 'Password has been reset. You can now sign in.' });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user.toSafeJSON() });
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
      const existingByPhone = await User.findOne({
        phone,
        _id: { $ne: req.user._id },
      });
      if (existingByPhone) {
        throw badRequest('Phone number is already registered', ['Phone number is already registered']);
      }
    }

    const user = await User.findById(req.user._id);
    if (!user) throw unauthorized('User not found');

    user.name = name;
    user.phone = phone;
    user.organization = organization;
    user.interested_role = interestedRole;
    user.profile_headline = profileHeadline;
    user.profile_bio = profileBio;
    user.location = location;
    await user.save();

    res.json({
      message: 'Profile updated successfully.',
      user: user.toSafeJSON(),
    });
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

    const user = await User.findById(req.user._id).select('+password_hash +password_salt');
    if (!user) throw unauthorized('User not found');

    const isBcryptHash = String(user.password_hash || '').startsWith('$2');
    const valid = isBcryptHash
      ? await bcrypt.compare(currentPassword, user.password_hash)
      : user.password_salt
        ? await verifyPassword(currentPassword, user.password_salt, user.password_hash)
        : false;

    if (!valid) throw badRequest('Current password is incorrect');

    user.password_hash = await bcrypt.hash(newPassword, 12);
    user.password_salt = undefined;
    user.must_change_password = false;
    await user.save();

    const token = signToken(user);

    res.json({
      message: 'Password has been changed successfully.',
      user: user.toSafeJSON(),
      token,
    });
  }),
);

export default router;
