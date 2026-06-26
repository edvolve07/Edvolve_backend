import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const CommunicationSession = sequelize.define('CommunicationSession', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  session_id: {
    type: DataTypes.STRING(64),
    unique: true,
    allowNull: false,
  },
  student_id: {
    type: DataTypes.STRING(64),
    allowNull: false,
  },
  student_name: { type: DataTypes.STRING(255), defaultValue: '' },
  student_email: { type: DataTypes.STRING(255), defaultValue: '' },
  scenario_id: { type: DataTypes.STRING(64), defaultValue: '' },
  category: { type: DataTypes.STRING(100), defaultValue: '' },
  context: { type: DataTypes.TEXT, defaultValue: '' },
  history: { type: DataTypes.JSONB, defaultValue: [] },
  current_prompt: { type: DataTypes.TEXT, defaultValue: '' },
  exchange_count: { type: DataTypes.INTEGER, defaultValue: 0 },
  max_exchanges: { type: DataTypes.INTEGER, defaultValue: 6 },
  status: { type: DataTypes.STRING(20), defaultValue: 'active' },
}, {
  tableName: 'communication_sessions',
  indexes: [
    { fields: ['session_id'], unique: true },
    { fields: ['student_id', 'created_at'] },
  ],
});
