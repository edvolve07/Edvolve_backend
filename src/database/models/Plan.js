import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const Plan = sequelize.define('Plan', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  plan_key: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  plan_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  duration_months: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  max_level: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
  },
  journey_access: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  total_interviews: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  price: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  gst_percentage: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 18,
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'active',
  },
  features: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
}, {
  tableName: 'plans',
  indexes: [
    { fields: ['plan_key'], unique: true },
    { fields: ['status'] },
  ],
});
