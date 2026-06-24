import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ProgrammingProblem = sequelize.define('ProgrammingProblem', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: { type: DataTypes.STRING(255), allowNull: false },
  problem_number: { type: DataTypes.INTEGER, defaultValue: null },
  description: { type: DataTypes.TEXT, allowNull: false },
  constraints: { type: DataTypes.TEXT, defaultValue: '' },
  input_format: { type: DataTypes.TEXT, defaultValue: '' },
  output_format: { type: DataTypes.TEXT, defaultValue: '' },
  hints: { type: DataTypes.JSONB, defaultValue: [] },
  follow_up: { type: DataTypes.TEXT, defaultValue: '' },
  difficulty: { type: DataTypes.STRING(10), allowNull: false },
  tags: { type: DataTypes.JSONB, defaultValue: [] },
  company_tags: { type: DataTypes.JSONB, defaultValue: [] },
  companies_locked: { type: DataTypes.BOOLEAN, defaultValue: true },
  review_status: { type: DataTypes.STRING(20), defaultValue: 'approved' },
  is_private_bank: { type: DataTypes.BOOLEAN, defaultValue: false },
  institution_id: { type: DataTypes.UUID, defaultValue: null, allowNull: true },
  duplicate_fingerprint: { type: DataTypes.STRING(255), defaultValue: '' },
  concept: { type: DataTypes.STRING(100), allowNull: false },
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
  status: { type: DataTypes.STRING(20), defaultValue: 'draft' },
  is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
  deleted_at: { type: DataTypes.DATE, defaultValue: null },
  created_by: { type: DataTypes.UUID, allowNull: false },
  total_submissions: { type: DataTypes.INTEGER, defaultValue: 0 },
  total_accepted: { type: DataTypes.INTEGER, defaultValue: 0 },
  difficulty_rank: { type: DataTypes.INTEGER, defaultValue: 1 },
  topic_rank: { type: DataTypes.INTEGER, defaultValue: 99 },
  curriculum_order: { type: DataTypes.INTEGER, defaultValue: 9999 },
  is_beginner_friendly: { type: DataTypes.BOOLEAN, defaultValue: false },
  is_auto_gradable: { type: DataTypes.BOOLEAN, defaultValue: true },
}, {
  tableName: 'programming_problems',
  hooks: {
    beforeSave: (problem) => {
      if (problem.changed('title')) {
        problem.duplicate_fingerprint = String(problem.title || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim()
          .slice(0, 180);
      }
    },
  },
  indexes: [
    { fields: ['difficulty'] },
    { fields: ['tags'] },
    { fields: ['company_tags'] },
    { fields: ['review_status'] },
    { fields: ['is_private_bank'] },
    { fields: ['institution_id'] },
    { fields: ['duplicate_fingerprint'] },
    { fields: ['concept'] },
    { fields: ['status'] },
    { fields: ['is_deleted'] },
    { fields: ['difficulty_rank'] },
    { fields: ['topic_rank'] },
    { fields: ['curriculum_order'] },
    { fields: ['is_beginner_friendly'] },
    { fields: ['is_auto_gradable'] },
    { fields: ['status', 'is_deleted', 'difficulty_rank', 'curriculum_order'] },
    { fields: ['duplicate_fingerprint', 'institution_id'] },
  ],
});
