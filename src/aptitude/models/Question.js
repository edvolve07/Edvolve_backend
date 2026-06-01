import mongoose from '../config/mongoose.js';

const questionSchema = new mongoose.Schema(
  {
    assessment_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assessment',
      required: true,
      index: true,
    },
    question_text: { type: String, required: true, trim: true },
    option_a: { type: String, required: true, trim: true },
    option_b: { type: String, required: true, trim: true },
    option_c: { type: String, required: true, trim: true },
    option_d: { type: String, required: true, trim: true },
    correct_option: {
      type: String,
      enum: ['A', 'B', 'C', 'D'],
      required: true,
    },
    explanation: { type: String, required: true, trim: true },
    shortcut: { type: String, default: '' },
    concept: { type: String, required: true, trim: true },
    difficulty: {
      type: String,
      enum: ['Easy', 'Medium', 'Hard', 'Mixed'],
      required: true,
    },
    marks: { type: Number, required: true, min: 0 },
    negative_marks: { type: Number, required: true, min: 0 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

export const Question = mongoose.model('Question', questionSchema);
