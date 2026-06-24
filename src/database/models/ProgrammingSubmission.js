import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ProgrammingSubmission = sequelize.define('ProgrammingSubmission', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  problem_id: { type: DataTypes.UUID, allowNull: false },
  student_id: { type: DataTypes.UUID, allowNull: false },
  language: { type: DataTypes.STRING(50), allowNull: false },
  code: { type: DataTypes.TEXT, allowNull: false },
  status: {
    type: DataTypes.STRING(30),
    defaultValue: 'pending',
  },
  passed_test_cases: { type: DataTypes.INTEGER, defaultValue: 0 },
  total_test_cases: { type: DataTypes.INTEGER, defaultValue: 0 },
  test_results: { type: DataTypes.JSONB, defaultValue: [] },
  execution_time_ms: { type: DataTypes.FLOAT, defaultValue: 0 },
  memory_used_kb: { type: DataTypes.FLOAT, defaultValue: 0 },
  error_message: { type: DataTypes.TEXT, defaultValue: '' },
  submitted_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'programming_submissions',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['problem_id'] },
    { fields: ['student_id'] },
    { fields: ['status'] },
    { fields: ['problem_id', 'student_id', 'submitted_at'] },
  ],
});
