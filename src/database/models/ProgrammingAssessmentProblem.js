import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ProgrammingAssessmentProblem = sequelize.define('ProgrammingAssessmentProblem', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  assessment_id: { type: DataTypes.UUID, allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: false },
  constraints: { type: DataTypes.TEXT, defaultValue: '' },
  input_format: { type: DataTypes.TEXT, defaultValue: '' },
  output_format: { type: DataTypes.TEXT, defaultValue: '' },
  difficulty: { type: DataTypes.STRING(10), allowNull: false },
  concept: { type: DataTypes.STRING(100), allowNull: false },
  marks: { type: DataTypes.INTEGER, allowNull: false },
  sample_test_cases: { type: DataTypes.JSONB, defaultValue: [] },
  hidden_test_cases: { type: DataTypes.JSONB, defaultValue: [] },
  time_limit: { type: DataTypes.INTEGER, defaultValue: 2 },
  memory_limit: { type: DataTypes.INTEGER, defaultValue: 256 },
  languages: { type: DataTypes.JSONB, defaultValue: ['javascript', 'python'] },
  starter_code: {
    type: DataTypes.JSONB,
    defaultValue: {
      javascript: '', typescript: '', python: '', java: '', cpp: '',
      c: '', csharp: '', go: '', rust: '', kotlin: '', ruby: '', swift: '', php: '',
    },
  },
  order: { type: DataTypes.INTEGER, defaultValue: 0 },
  difficulty_rank: { type: DataTypes.INTEGER, defaultValue: 1 },
  topic_rank: { type: DataTypes.INTEGER, defaultValue: 99 },
  curriculum_order: { type: DataTypes.INTEGER, defaultValue: 9999 },
  is_beginner_friendly: { type: DataTypes.BOOLEAN, defaultValue: false },
  is_auto_gradable: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'programming_assessment_problems',
  indexes: [
    { fields: ['assessment_id', 'order'] },
  ],
});
