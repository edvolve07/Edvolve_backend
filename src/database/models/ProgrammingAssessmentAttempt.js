import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ProgrammingAssessmentAttempt = sequelize.define('ProgrammingAssessmentAttempt', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  assessment_id: { type: DataTypes.UUID, allowNull: false },
  student_id: { type: DataTypes.UUID, allowNull: false },
  started_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  submitted_at: { type: DataTypes.DATE, defaultValue: null },
  status: { type: DataTypes.STRING(20), defaultValue: 'in_progress' },
  total_marks: { type: DataTypes.FLOAT, defaultValue: 0 },
  obtained_marks: { type: DataTypes.FLOAT, defaultValue: 0 },
}, {
  tableName: 'programming_assessment_attempts',
  indexes: [
    { fields: ['assessment_id'] },
    { fields: ['student_id'] },
    { fields: ['status'] },
    { fields: ['assessment_id', 'student_id'] },
  ],
});
