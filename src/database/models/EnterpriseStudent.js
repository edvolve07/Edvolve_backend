import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const EnterpriseStudent = sequelize.define('EnterpriseStudent', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
  },
  institution_id: {
    type: DataTypes.UUID,
    defaultValue: null,
    allowNull: true,
  },
  department_id: {
    type: DataTypes.UUID,
    defaultValue: null,
    allowNull: true,
  },
  journey_access: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  current_level: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  current_interview: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
  },
  student_status: {
    type: DataTypes.STRING(20),
    defaultValue: 'active',
  },
  usn: {
    type: DataTypes.STRING(50),
    defaultValue: null,
    allowNull: true,
  },
  year: {
    type: DataTypes.STRING(20),
    defaultValue: null,
    allowNull: true,
  },
  assigned_admin: {
    type: DataTypes.UUID,
    defaultValue: null,
    allowNull: true,
  },
}, {
  tableName: 'enterprise_students',
  indexes: [
    { fields: ['user_id'], unique: true },
    { fields: ['institution_id'] },
    { fields: ['department_id'] },
    { fields: ['assigned_admin'] },
  ],
});
