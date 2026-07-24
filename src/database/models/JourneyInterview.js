import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const JourneyInterview = sequelize.define('JourneyInterview', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  student_id: {
    type: DataTypes.STRING(64),
    allowNull: false,
  },
  interview_number: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  blueprint_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  blueprint_title: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
  level: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'locked',
  },
  session_id: {
    type: DataTypes.STRING(64),
    defaultValue: null,
    allowNull: true,
  },
  report_id: {
    type: DataTypes.STRING(100),
    defaultValue: null,
    allowNull: true,
  },
  overall_score: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },
  grade: {
    type: DataTypes.STRING(5),
    defaultValue: '',
  },
  started_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  completed_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  level_at_time: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
}, {
  tableName: 'journey_interviews',
  indexes: [
    { unique: true, fields: ['student_id', 'interview_number'] },
    { fields: ['student_id', 'status'] },
    { fields: ['student_id', 'blueprint_id'] },
  ],
});
