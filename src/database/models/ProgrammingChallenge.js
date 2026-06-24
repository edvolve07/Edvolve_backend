import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ProgrammingChallenge = sequelize.define('ProgrammingChallenge', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  problem_id: { type: DataTypes.UUID, allowNull: false },
  type: { type: DataTypes.STRING(10), allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  starts_at: { type: DataTypes.DATE, allowNull: false },
  ends_at: { type: DataTypes.DATE, defaultValue: null, allowNull: true },
  status: { type: DataTypes.STRING(20), defaultValue: 'published' },
  created_by: { type: DataTypes.UUID, defaultValue: null, allowNull: true },
}, {
  tableName: 'programming_challenges',
  indexes: [
    { fields: ['problem_id'] },
    { fields: ['type'] },
    { fields: ['starts_at'] },
    { fields: ['ends_at'] },
    { fields: ['status'] },
    { fields: ['type', 'starts_at'] },
  ],
});
