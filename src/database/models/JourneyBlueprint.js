import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const JourneyBlueprint = sequelize.define('JourneyBlueprint', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  interview_number: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
  },
  title: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  level: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  objective: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  focus_areas: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  difficulty: {
    type: DataTypes.STRING(20),
    defaultValue: 'Medium',
  },
  ai_prompt: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  follow_up_guidelines: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  evaluation_criteria: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
  domain: {
    type: DataTypes.STRING(100),
    defaultValue: 'General',
  },
  role: {
    type: DataTypes.STRING(100),
    defaultValue: 'Software Engineer',
  },
  category: {
    type: DataTypes.STRING(100),
    defaultValue: 'Technical',
  },
}, {
  tableName: 'journey_blueprints',
  indexes: [
    { fields: ['interview_number'], unique: true },
    { fields: ['level'] },
  ],
});
