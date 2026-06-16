import mongoose from '../config/mongoose.js';

const proctoringEventSchema = new mongoose.Schema(
  {
    attempt_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    assessment_type: {
      type: String,
      enum: ['aptitude', 'programming'],
      required: true,
      index: true,
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    event_type: {
      type: String,
      enum: ['tab_switch', 'fullscreen_exit', 'copy', 'paste', 'webcam_snapshot', 'manual'],
      required: true,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low',
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    occurred_at: { type: Date, default: Date.now, index: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

proctoringEventSchema.index({ attempt_id: 1, assessment_type: 1, occurred_at: -1 });

export const ProctoringEvent = mongoose.model('ProctoringEvent', proctoringEventSchema);
