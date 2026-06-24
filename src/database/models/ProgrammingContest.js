import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ProgrammingContest = sequelize.define('ProgrammingContest', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, defaultValue: '' },
  problem_ids: { type: DataTypes.JSONB, defaultValue: [] },
  starts_at: { type: DataTypes.DATE, allowNull: false },
  ends_at: { type: DataTypes.DATE, allowNull: false },
  status: { type: DataTypes.STRING(20), defaultValue: 'published' },
  institution_id: { type: DataTypes.UUID, defaultValue: null, allowNull: true },
  created_by: { type: DataTypes.UUID, defaultValue: null, allowNull: true },
}, {
  tableName: 'programming_contests',
  indexes: [
    { fields: ['starts_at'] },
    { fields: ['ends_at'] },
    { fields: ['status'] },
    { fields: ['institution_id'] },
    { fields: ['starts_at', 'status'] },
  ],
});
