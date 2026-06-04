import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { forbidden, locked, unauthorized } from '../utils/httpError.js';

export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      throw unauthorized();
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub);
    if (!user) {
      throw unauthorized('Invalid session');
    }

    if (user.is_active === false) {
      throw locked();
    }

    req.user = user;
    next();
  } catch (error) {
    next(error.name === 'JsonWebTokenError' ? unauthorized('Invalid session') : error);
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(unauthorized());
    }
    if (!roles.includes(req.user.role)) {
      return next(forbidden());
    }
    next();
  };
}

export function requireModuleAccess(...modules) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(unauthorized());
    }
    const userModules = req.user.modules_access || ['both'];
    const hasAccess = modules.some(
      (mod) => userModules.includes(mod) || userModules.includes('both'),
    );
    if (!hasAccess) {
      return next(forbidden('You do not have access to this module'));
    }
    next();
  };
}
