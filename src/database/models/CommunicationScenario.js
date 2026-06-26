import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const CommunicationScenario = sequelize.define('CommunicationScenario', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, defaultValue: '' },
  category: { type: DataTypes.STRING(100), defaultValue: '' },
  context: { type: DataTypes.TEXT, defaultValue: '' },
  difficulty: { type: DataTypes.STRING(20), defaultValue: 'Medium' },
  status: { type: DataTypes.STRING(20), defaultValue: 'draft' },
  created_by: { type: DataTypes.STRING(64), defaultValue: '' },
}, {
  tableName: 'communication_scenarios',
  indexes: [
    { fields: ['created_by'] },
    { fields: ['category'] },
  ],
});
