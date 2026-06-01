import mongoose from '../config/mongoose.js';

const assessmentAttemptSchema = new mongoose.Schema(
  {
    assessment_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Assessment',
      required: true,
      index: true,
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    started_at: { type: Date, default: Date.now },
    submitted_at: { type: Date, default: null },
    extra_time_minutes: { type: Number, default: 0, min: 0 },
    score: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['in_progress', 'submitted'],
      default: 'in_progress',
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

export const AssessmentAttempt = mongoose.model(
  'AssessmentAttempt',
  assessmentAttemptSchema,
);
