import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ProctoringEvent = sequelize.define('ProctoringEvent', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  attempt_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  assessment_type: {
    type: DataTypes.STRING(20),
    allowNull: false,
  },
  student_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  event_type: {
    type: DataTypes.STRING(30),
    allowNull: false,
  },
  severity: {
    type: DataTypes.STRING(10),
    defaultValue: 'low',
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
  occurred_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'proctoring_events',
  indexes: [
    { fields: ['attempt_id'] },
    { fields: ['assessment_type'] },
    { fields: ['student_id'] },
    { fields: ['occurred_at'] },
    { fields: ['attempt_id', 'assessment_type', 'occurred_at'] },
  ],
});
