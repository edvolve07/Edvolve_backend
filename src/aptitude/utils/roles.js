export const ROLES = {
  STUDENT: 'student',
  ADMIN: 'admin',
  MASTER_ADMIN: 'master_admin',
};

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function envEmailSet(key) {
  return new Set(
    String(process.env[key] || '')
      .split(',')
      .map((email) => normalizeEmail(email))
      .filter(Boolean),
  );
}

export function roleForEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return ROLES.STUDENT;

  if (envEmailSet('MASTER_ADMIN_EMAILS').has(normalizedEmail)) {
    return ROLES.MASTER_ADMIN;
  }

  if (envEmailSet('ADMIN_EMAILS').has(normalizedEmail)) {
    return ROLES.ADMIN;
  }

  return ROLES.STUDENT;
}

export function roleLabel(role) {
  if (role === ROLES.MASTER_ADMIN) return 'Master Admin';
  if (role === ROLES.ADMIN) return 'Admin';
  return 'Student';
}
