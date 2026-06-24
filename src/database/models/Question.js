import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const Question = sequelize.define('Question', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  assessment_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  question_text: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  option_a: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  option_b: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  option_c: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  option_d: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  correct_option: {
    type: DataTypes.STRING(1),
    allowNull: false,
  },
  explanation: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  shortcut: {
    type: DataTypes.TEXT,
    defaultValue: '',
  },
  concept: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  tags: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  review_status: {
    type: DataTypes.STRING(20),
    defaultValue: 'approved',
  },
  is_private_bank: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  institution_id: {
    type: DataTypes.UUID,
    defaultValue: null,
    allowNull: true,
  },
  duplicate_fingerprint: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
  difficulty: {
    type: DataTypes.STRING(20),
    allowNull: false,
  },
  marks: {
    type: DataTypes.FLOAT,
    allowNull: false,
  },
  negative_marks: {
    type: DataTypes.FLOAT,
    allowNull: false,
  },
}, {
  tableName: 'questions',
  hooks: {
    beforeSave: (question) => {
      if (question.changed('question_text')) {
        question.duplicate_fingerprint = String(question.question_text || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim()
          .slice(0, 220);
      }
    },
  },
  indexes: [
    { fields: ['assessment_id'] },
    { fields: ['tags'] },
    { fields: ['review_status'] },
    { fields: ['is_private_bank'] },
    { fields: ['institution_id'] },
    { fields: ['duplicate_fingerprint'] },
  ],
});
