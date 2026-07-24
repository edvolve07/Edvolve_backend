import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const IndividualStudent = sequelize.define('IndividualStudent', {
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
  subscription_id: {
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
  subscription_status: {
    type: DataTypes.STRING(20),
    defaultValue: 'inactive',
  },
}, {
  tableName: 'individual_students',
  indexes: [
    { fields: ['user_id'], unique: true },
    { fields: ['subscription_id'] },
  ],
});
