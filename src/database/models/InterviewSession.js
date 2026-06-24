import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const InterviewSession = sequelize.define('InterviewSession', {
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
  student_role: {
    type: DataTypes.STRING(50),
    defaultValue: 'student',
  },
  domain: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  role: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  resume_text: {
    type: DataTypes.TEXT,
  },
  ats_analysis: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
  history: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  current_question: {
    type: DataTypes.TEXT,
    defaultValue: '',
  },
  question_count: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'active',
  },
}, {
  tableName: 'interview_sessions',
  indexes: [
    { fields: ['session_id'], unique: true },
    { fields: ['student_id', 'created_at'] },
  ],
});
