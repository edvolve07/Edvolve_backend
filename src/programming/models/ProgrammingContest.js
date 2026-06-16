import mongoose from '../../aptitude/config/mongoose.js';

const contestSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    problem_ids: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProgrammingProblem',
    }],
    starts_at: { type: Date, required: true, index: true },
    ends_at: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['draft', 'published', 'archived'],
      default: 'published',
      index: true,
    },
    institution_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
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

contestSchema.index({ starts_at: -1, status: 1 });

export const ProgrammingContest = mongoose.model('ProgrammingContest', contestSchema);
