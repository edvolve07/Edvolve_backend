import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ProgrammingAssessment = sequelize.define('ProgrammingAssessment', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, defaultValue: '' },
  status: { type: DataTypes.STRING(20), defaultValue: 'draft' },
  is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
  deleted_at: { type: DataTypes.DATE, defaultValue: null },
  created_by: { type: DataTypes.UUID, allowNull: false },
}, {
  tableName: 'programming_assessments',
  indexes: [
    { fields: ['status'] },
    { fields: ['is_deleted'] },
  ],
});
