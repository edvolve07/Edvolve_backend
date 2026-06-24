import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const InterviewReport = sequelize.define('InterviewReport', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  session_id: {
    type: DataTypes.STRING(64),
    unique: true,
    allowNull: false,
  },
  student_id: {
    type: DataTypes.STRING(64),
    allowNull: false,
  },
  student_name: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
  student_email: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
  interview_domain: {
    type: DataTypes.STRING(100),
    defaultValue: '',
  },
  interview_role: {
    type: DataTypes.STRING(100),
    defaultValue: '',
  },
  report_id: {
    type: DataTypes.STRING(100),
    defaultValue: '',
  },
  generated_date: {
    type: DataTypes.STRING(100),
    defaultValue: '',
  },
  overall: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
  ats_analysis: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
  question_breakdown: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  strengths: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  areas_to_improve: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  interview_tips: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
}, {
  tableName: 'interview_reports',
  indexes: [
    { fields: ['session_id'], unique: true },
    { fields: ['student_id', 'created_at'] },
  ],
});
