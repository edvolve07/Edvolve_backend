import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const ApiKey = sequelize.define('ApiKey', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  provider: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
  },
  api_key: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  updated_by: {
    type: DataTypes.STRING(255),
    defaultValue: '',
  },
}, {
  tableName: 'api_keys',
  indexes: [
    { fields: ['provider'] },
  ],
});
