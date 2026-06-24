import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ResumeVersion = sequelize.define('ResumeVersion', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  student_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  version: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  title: {
    type: DataTypes.STRING(255),
    defaultValue: 'Resume',
  },
  target_role: {
    type: DataTypes.STRING(100),
    defaultValue: '',
  },
  phone: {
    type: DataTypes.STRING(50),
    defaultValue: '',
  },
  email: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
  linkedin: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
  github: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
  location: {
    type: DataTypes.STRING(100),
    defaultValue: '',
  },
  summary: {
    type: DataTypes.TEXT,
    defaultValue: '',
  },
  skills: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  experience: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  education: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  projects: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  certifications: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  achievements: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  ats_analysis: {
    type: DataTypes.JSONB,
    defaultValue: {
      ats_score: 0,
      previous_score: 0,
      improvements: [],
      strengths: [],
    },
  },
}, {
  tableName: 'resume_versions',
  indexes: [
    { fields: ['student_id', { attribute: 'version', order: 'DESC' }] },
  ],
});
