import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const AiUsage = sequelize.define('AiUsage', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  provider: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  model: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  feature: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'success',
  },
  prompt_tokens: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  completion_tokens: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  total_tokens: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
}, {
  tableName: 'ai_usage',
  indexes: [
    { fields: ['created_at'] },
    { fields: ['provider', 'feature', 'created_at'] },
  ],
});
