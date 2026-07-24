import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const InstitutionModule = sequelize.define('InstitutionModule', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  institution_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  module_name: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'institution_modules',
  indexes: [
    { unique: true, fields: ['institution_id', 'module_name'] },
    { fields: ['institution_id'] },
  ],
});
