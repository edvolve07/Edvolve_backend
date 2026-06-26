import jwt from 'jsonwebtoken';
import { Admin, Student, Assessment, Op } from '../../database/index.js';
import { forbidden, locked, unauthorized } from '../utils/httpError.js';

export async function requireAuth(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
      throw unauthorized();
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = payload.role === 'student'
      ? await Student.findByPk(payload.sub)
      : await Admin.findByPk(payload.sub);

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

export function requireInstitutionAccess(paramName = 'id') {
  return async (req, _res, next) => {
    try {
      if (!req.user) return next(unauthorized());
      if (req.user.role === 'master_admin') return next();

      const targetId = req.params[paramName] || req.body[paramName] || req.query[paramName];
      if (!targetId) return next(forbidden('Access denied'));

      if (req.user.role === 'admin') {
        if (!req.user.institutionId) return next(forbidden('Admin has no institution assigned'));

        const targetDoc = await Assessment.findByPk(targetId, { attributes: ['institutionId'] });
        if (targetDoc) {
          if (!targetDoc.institutionId || targetDoc.institutionId.toString() !== req.user.institutionId.toString()) {
            return next(forbidden('You do not have access to this resource'));
          }
          return next();
        }

        let targetUser = await Student.findByPk(targetId, { attributes: ['institutionId', 'role'] });
        if (!targetUser) {
          targetUser = await Admin.findByPk(targetId, { attributes: ['institutionId', 'role'] });
        }
        if (targetUser) {
          if (!targetUser.institutionId || targetUser.institutionId.toString() !== req.user.institutionId.toString()) {
            return next(forbidden('You do not have access to this user'));
          }
          return next();
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export async function ensureInstitutionAccess(user, resourceInstitutionId) {
  if (user.role === 'master_admin') return true;
  if (user.role === 'admin') {
    if (!user.institutionId) return false;
    return user.institutionId.toString() === resourceInstitutionId.toString();
  }
  return false;
}
