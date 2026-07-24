import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const AssessmentAssignment = sequelize.define('AssessmentAssignment', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  assessment_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  student_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  assigned_by: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  assigned_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'active',
  },
}, {
  tableName: 'assessment_assignments',
  indexes: [
    { fields: ['assessment_id'] },
    { fields: ['student_id'] },
    { unique: true, fields: ['assessment_id', 'student_id'] },
  ],
});
