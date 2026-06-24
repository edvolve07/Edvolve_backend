import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const StudentCertificate = sequelize.define('StudentCertificate', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  student_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  milestone: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  title: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    defaultValue: '',
  },
  score: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },
  issued_by: {
    type: DataTypes.UUID,
    defaultValue: null,
    allowNull: true,
  },
  issued_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'student_certificates',
  indexes: [
    { fields: ['student_id', 'milestone'], unique: true },
  ],
});
