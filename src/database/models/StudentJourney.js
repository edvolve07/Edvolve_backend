import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const StudentJourney = sequelize.define('StudentJourney', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  student_id: {
    type: DataTypes.STRING(64),
    allowNull: false,
    unique: true,
  },
  student_name: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
  student_email: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
  institution_id: {
    type: DataTypes.UUID,
    defaultValue: null,
    allowNull: true,
  },
  journey_access_level: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  current_level: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  current_interview_number: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  completed_interviews: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  total_interviews: {
    type: DataTypes.INTEGER,
    defaultValue: 24,
  },
  overall_score: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },
  readiness_score: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'not_started',
  },
  started_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  completed_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  last_interview_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  target_career_goal: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
}, {
  tableName: 'student_journeys',
  indexes: [
    { fields: ['student_id'], unique: true },
    { fields: ['institution_id'] },
    { fields: ['journey_access_level'] },
  ],
});
