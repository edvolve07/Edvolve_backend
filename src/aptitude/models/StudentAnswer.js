import mongoose from '../config/mongoose.js';

const studentAnswerSchema = new mongoose.Schema(
  {
    attempt_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AssessmentAttempt',
      required: true,
      index: true,
    },
    question_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Question',
      required: true,
      index: true,
    },
    selected_option: {
      type: String,
      enum: ['A', 'B', 'C', 'D', null],
      default: null,
    },
    is_correct: { type: Boolean, default: false },
    marks_awarded: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

studentAnswerSchema.index({ attempt_id: 1, question_id: 1 }, { unique: true });

export const StudentAnswer = mongoose.model('StudentAnswer', studentAnswerSchema);
