import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const Assessment = sequelize.define('Assessment', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  title: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    defaultValue: '',
  },
  concept: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  difficulty: {
    type: DataTypes.STRING(20),
    allowNull: false,
  },
  duration_minutes: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  total_marks: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  passing_marks: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  start_time: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  end_time: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'draft',
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  deleted_at: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  institutionId: {
    type: DataTypes.UUID,
    defaultValue: null,
    allowNull: true,
  },
  created_by: {
    type: DataTypes.UUID,
    allowNull: false,
  },
}, {
  tableName: 'assessments',
  indexes: [
    { fields: ['status'] },
    { fields: ['is_deleted'] },
    { fields: ['institutionId'] },
  ],
});
