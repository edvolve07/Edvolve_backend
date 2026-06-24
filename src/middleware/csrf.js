import crypto from 'node:crypto';

const CSRF_COOKIE = '_csrf';
const CSRF_HEADER = 'x-csrf-token';

export function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const token = req.cookies?.[CSRF_COOKIE];
    if (!token) {
      const csrfToken = crypto.randomBytes(32).toString('hex');
      res.cookie(CSRF_COOKIE, csrfToken, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 86400000,
      });
      res.setHeader('X-CSRF-Token', csrfToken);
    }
    return next();
  }

  const headerToken = req.headers[CSRF_HEADER];
  const cookieToken = req.cookies?.[CSRF_COOKIE];

  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return res.status(403).json({
      detail: 'CSRF token validation failed',
      message: 'Invalid or missing CSRF token',
    });
  }

  next();
}
