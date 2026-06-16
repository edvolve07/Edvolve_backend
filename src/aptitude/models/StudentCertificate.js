import mongoose from '../config/mongoose.js';

const certificateSchema = new mongoose.Schema(
  {
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    milestone: {
      type: String,
      enum: [
        'coding_50',
        'aptitude_passed',
        'interview_readiness_75',
        'placement_track_complete',
      ],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    score: { type: Number, default: 0 },
    issued_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    issued_at: { type: Date, default: Date.now },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

certificateSchema.index({ student_id: 1, milestone: 1 }, { unique: true });

export const StudentCertificate = mongoose.model('StudentCertificate', certificateSchema);
