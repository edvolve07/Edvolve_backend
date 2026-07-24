import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const PaymentTransaction = sequelize.define('PaymentTransaction', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  student_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  subscription_id: {
    type: DataTypes.UUID,
    defaultValue: null,
  },
  amount: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  currency: {
    type: DataTypes.STRING(10),
    defaultValue: 'INR',
  },
  gst_amount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  total_amount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  payment_method: {
    type: DataTypes.STRING(50),
    defaultValue: null,
  },
  payment_id: {
    type: DataTypes.STRING(255),
    defaultValue: null,
  },
  order_id: {
    type: DataTypes.STRING(255),
    defaultValue: null,
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'pending',
  },
  invoice_number: {
    type: DataTypes.STRING(50),
    defaultValue: null,
  },
  invoice_date: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  invoice_items: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  plan_key: {
    type: DataTypes.STRING(50),
    defaultValue: null,
  },
  plan_name: {
    type: DataTypes.STRING(100),
    defaultValue: null,
  },
}, {
  tableName: 'payment_transactions',
  timestamps: true,
  indexes: [
    { fields: ['student_id'] },
    { fields: ['subscription_id'] },
    { fields: ['payment_id'] },
    { fields: ['invoice_number'] },
    { fields: ['status'] },
  ],
});
