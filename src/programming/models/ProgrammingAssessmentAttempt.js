import mongoose from '../../aptitude/config/mongoose.js';

const assessmentAttemptSchema = new mongoose.Schema(
  {
    assessment_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProgrammingAssessment',
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
    status: {
      type: String,
      enum: ['in_progress', 'submitted'],
      default: 'in_progress',
      index: true,
    },
    total_marks: { type: Number, default: 0 },
    obtained_marks: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

assessmentAttemptSchema.index({ assessment_id: 1, student_id: 1 });

export const ProgrammingAssessmentAttempt = mongoose.model('ProgrammingAssessmentAttempt', assessmentAttemptSchema);
