import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const AssessmentDepartment = sequelize.define('AssessmentDepartment', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  assessment_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  department_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
}, {
  tableName: 'assessment_departments',
  indexes: [
    { fields: ['assessment_id'] },
    { fields: ['department_id'] },
    { unique: true, fields: ['assessment_id', 'department_id'] },
  ],
});
