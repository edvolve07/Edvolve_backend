import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ProgrammingDiscussion = sequelize.define('ProgrammingDiscussion', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  problem_id: { type: DataTypes.UUID, allowNull: false },
  student_id: { type: DataTypes.UUID, allowNull: false },
  type: { type: DataTypes.STRING(20), defaultValue: 'discussion' },
  title: { type: DataTypes.STRING(255), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  language: { type: DataTypes.STRING(50), defaultValue: '' },
  code: { type: DataTypes.TEXT, defaultValue: '' },
  is_private: { type: DataTypes.BOOLEAN, defaultValue: true },
  likes: { type: DataTypes.INTEGER, defaultValue: 0 },
}, {
  tableName: 'programming_discussions',
  indexes: [
    { fields: ['problem_id'] },
    { fields: ['student_id'] },
    { fields: ['type'] },
    { fields: ['is_private'] },
    { fields: ['problem_id', 'created_at'] },
  ],
});
