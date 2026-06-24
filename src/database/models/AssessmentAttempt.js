import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const AssessmentAttempt = sequelize.define('AssessmentAttempt', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  assessment_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  student_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  started_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  submitted_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  extra_time_minutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  score: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },
  percentage: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'in_progress',
  },
}, {
  tableName: 'assessment_attempts',
  indexes: [
    { fields: ['assessment_id'] },
    { fields: ['student_id'] },
    { fields: ['status'] },
    { fields: ['assessment_id', 'status'] },
  ],
});
