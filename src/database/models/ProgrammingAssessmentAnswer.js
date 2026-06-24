import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ProgrammingAssessmentAnswer = sequelize.define('ProgrammingAssessmentAnswer', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  attempt_id: { type: DataTypes.UUID, allowNull: false },
  problem_id: { type: DataTypes.UUID, allowNull: false },
  code: { type: DataTypes.TEXT, defaultValue: '' },
  language: { type: DataTypes.STRING(50), defaultValue: 'javascript' },
  status: { type: DataTypes.STRING(30), defaultValue: 'pending' },
  passed_test_cases: { type: DataTypes.INTEGER, defaultValue: 0 },
  total_test_cases: { type: DataTypes.INTEGER, defaultValue: 0 },
  test_results: { type: DataTypes.JSONB, defaultValue: [] },
  marks_awarded: { type: DataTypes.FLOAT, defaultValue: 0 },
  submitted_at: { type: DataTypes.DATE, defaultValue: null },
}, {
  tableName: 'programming_assessment_answers',
  indexes: [
    { fields: ['attempt_id'] },
    { fields: ['attempt_id', 'problem_id'], unique: true },
  ],
});
