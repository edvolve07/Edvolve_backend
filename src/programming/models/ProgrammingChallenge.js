import mongoose from '../../aptitude/config/mongoose.js';

const challengeSchema = new mongoose.Schema(
  {
    problem_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProgrammingProblem',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['daily', 'weekly'],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    starts_at: { type: Date, required: true, index: true },
    ends_at: { type: Date, default: null, index: true },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'published',
      index: true,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

challengeSchema.index({ type: 1, starts_at: -1 });

export const ProgrammingChallenge = mongoose.model('ProgrammingChallenge', challengeSchema);
