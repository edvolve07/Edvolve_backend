import { DataTypes } from 'sequelize';
import { getSequelize } from '../connection.js';

const sequelize = getSequelize();

export const StudentAnswer = sequelize.define('StudentAnswer', {
  _id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  attempt_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  question_id: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  selected_option: {
    type: DataTypes.STRING(1),
    defaultValue: null,
    allowNull: true,
  },
  is_correct: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  marks_awarded: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
  },
}, {
  tableName: 'student_answers',
  indexes: [
    { fields: ['attempt_id'] },
    { fields: ['question_id'] },
    { fields: ['attempt_id', 'question_id'], unique: true },
  ],
});
