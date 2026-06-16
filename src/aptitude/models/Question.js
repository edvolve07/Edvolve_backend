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
    tags: { type: [String], default: [], index: true },
    review_status: {
      type: String,
      enum: ['draft', 'in_review', 'approved', 'rejected'],
      default: 'approved',
      index: true,
    },
    is_private_bank: { type: Boolean, default: false, index: true },
    institution_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    duplicate_fingerprint: { type: String, default: '', index: true },
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

questionSchema.pre('save', function setQuestionFingerprint(next) {
  this.duplicate_fingerprint = String(this.question_text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 220);
  next();
});

export const Question = mongoose.model('Question', questionSchema);
