import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const Student = sequelize.define('Student', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
  },
  phone: {
    type: DataTypes.STRING(50),
    defaultValue: null,
  },
  organization: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
  usn: {
    type: DataTypes.STRING(50),
    defaultValue: null,
    allowNull: true,
  },
  department_id: {
    type: DataTypes.UUID,
    defaultValue: null,
    allowNull: true,
  },
  year: {
    type: DataTypes.STRING(20),
    defaultValue: null,
    allowNull: true,
  },
  interested_role: {
    type: DataTypes.STRING(80),
    defaultValue: '',
  },
  profile_headline: {
    type: DataTypes.STRING(120),
    defaultValue: '',
  },
  profile_bio: {
    type: DataTypes.STRING(500),
    defaultValue: '',
  },
  location: {
    type: DataTypes.STRING(80),
    defaultValue: '',
  },
  modules_access: {
    type: DataTypes.JSONB,
    defaultValue: ['both'],
  },
  role: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'student',
  },
  institutionId: {
    type: DataTypes.UUID,
    defaultValue: null,
    allowNull: true,
  },
  assigned_admin: {
    type: DataTypes.UUID,
    defaultValue: null,
    allowNull: true,
  },
  must_change_password: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  password_hash: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  password_salt: {
    type: DataTypes.STRING(255),
    defaultValue: null,
  },
  email_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  email_verification_token: {
    type: DataTypes.STRING(255),
    defaultValue: null,
  },
  email_verification_expires_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  password_reset_token_hash: {
    type: DataTypes.STRING(255),
    defaultValue: null,
  },
  password_reset_expires_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  auth_token: {
    type: DataTypes.STRING(255),
    defaultValue: null,
  },
  auth_expires_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
}, {
  tableName: 'students',
  indexes: [
    { fields: ['email'], unique: true },
    { fields: ['institutionId'] },
    { fields: ['assigned_admin'] },
    { fields: ['department_id'] },
    { fields: ['is_active'] },
    { fields: ['institutionId', 'department_id'] },
  ],
});
