import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const AptitudeQuestion = sequelize.define('AptitudeQuestion', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  domain: {
    type: DataTypes.STRING(50),
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
  correct_answer: {
    type: DataTypes.STRING(10),
    allowNull: false,
  },
  explanation: {
    type: DataTypes.TEXT,
    defaultValue: '',
  },
}, {
  tableName: 'aptitude_questions',
});

export const AptitudeResult = sequelize.define('AptitudeResult', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.STRING(64),
    defaultValue: null,
  },
  domain: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  result: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
}, {
  tableName: 'aptitude_results',
});
