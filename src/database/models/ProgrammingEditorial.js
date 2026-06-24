import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ProgrammingEditorial = sequelize.define('ProgrammingEditorial', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  problem_id: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
  },
  overview: { type: DataTypes.TEXT, defaultValue: '' },
  brute_force: { type: DataTypes.TEXT, defaultValue: '' },
  optimal_approach: { type: DataTypes.TEXT, defaultValue: '' },
  complexity: { type: DataTypes.STRING(100), defaultValue: '' },
  pitfalls: { type: DataTypes.JSONB, defaultValue: [] },
  code_by_language: { type: DataTypes.JSONB, defaultValue: {} },
  created_by: { type: DataTypes.UUID, defaultValue: null, allowNull: true },
}, {
  tableName: 'programming_editorials',
  indexes: [
    { fields: ['problem_id'], unique: true },
  ],
});
