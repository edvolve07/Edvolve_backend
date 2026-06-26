import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const CommunicationReport = sequelize.define('CommunicationReport', {
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
  student_id: { type: DataTypes.STRING(64), allowNull: false },
  student_name: { type: DataTypes.STRING(255), defaultValue: '' },
  student_email: { type: DataTypes.STRING(255), defaultValue: '' },
  category: { type: DataTypes.STRING(100), defaultValue: '' },
  report_id: { type: DataTypes.STRING(100), defaultValue: '' },
  generated_date: { type: DataTypes.STRING(100), defaultValue: '' },
  overall: { type: DataTypes.JSONB, defaultValue: {} },
  exchange_breakdown: { type: DataTypes.JSONB, defaultValue: [] },
  strengths: { type: DataTypes.JSONB, defaultValue: [] },
  areas_to_improve: { type: DataTypes.JSONB, defaultValue: [] },
  tips: { type: DataTypes.JSONB, defaultValue: [] },
}, {
  tableName: 'communication_reports',
  indexes: [
    { fields: ['session_id'], unique: true },
    { fields: ['student_id', 'created_at'] },
  ],
});
