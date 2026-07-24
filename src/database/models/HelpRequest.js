import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const HelpRequest = sequelize.define('HelpRequest', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  phone: {
    type: DataTypes.STRING(50),
    defaultValue: '',
  },
  institution: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
  issue: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'open',
  },
  response: {
    type: DataTypes.TEXT,
    defaultValue: null,
  },
  responded_by: {
    type: DataTypes.STRING(255),
    defaultValue: null,
  },
  responded_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'help_requests',
  timestamps: false,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['status'] },
    { fields: ['created_at'] },
  ],
});
