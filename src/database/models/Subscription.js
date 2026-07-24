import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const Subscription = sequelize.define('Subscription', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  student_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  plan_key: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  plan_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  access_level: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  interviews_total: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'active',
  },
  razorpay_order_id: {
    type: DataTypes.STRING(255),
    defaultValue: null,
  },
  razorpay_payment_id: {
    type: DataTypes.STRING(255),
    defaultValue: null,
  },
  razorpay_subscription_id: {
    type: DataTypes.STRING(255),
    defaultValue: null,
  },
  amount_paid: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  currency: {
    type: DataTypes.STRING(10),
    defaultValue: 'INR',
  },
  gst_amount: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  start_date: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  end_date: {
    type: DataTypes.DATE,
    defaultValue: null,
  },
  invoices: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  plan_id: {
    type: DataTypes.UUID,
    defaultValue: null,
  },
}, {
  tableName: 'subscriptions',
  timestamps: true,
  indexes: [
    { fields: ['student_id'] },
    { fields: ['status'] },
    { fields: ['razorpay_payment_id'] },
  ],
});
