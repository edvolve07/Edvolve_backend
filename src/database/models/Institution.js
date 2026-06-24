import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const Institution = sequelize.define('Institution', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
  },
  phone: {
    type: DataTypes.STRING(50),
    defaultValue: '',
  },
  address: {
    type: DataTypes.TEXT,
    defaultValue: '',
  },
  modules: {
    type: DataTypes.JSONB,
    defaultValue: {
      aptitude: true,
      coding: true,
      interviews: true,
      resumeBuilder: false,
      certificates: true,
    },
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'active',
  },
  created_by: {
    type: DataTypes.UUID,
    allowNull: false,
  },
}, {
  tableName: 'institutions',
  indexes: [
    { fields: ['code'], unique: true },
    { fields: ['email'], unique: true },
  ],
});
