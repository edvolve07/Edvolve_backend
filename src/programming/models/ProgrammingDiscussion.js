import mongoose from '../../aptitude/config/mongoose.js';

const discussionSchema = new mongoose.Schema(
  {
    problem_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProgrammingProblem',
      required: true,
      index: true,
    },
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['discussion', 'solution'],
      default: 'discussion',
      index: true,
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    language: { type: String, default: '' },
    code: { type: String, default: '' },
    is_private: { type: Boolean, default: true, index: true },
    likes: { type: Number, default: 0 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

discussionSchema.index({ problem_id: 1, created_at: -1 });

export const ProgrammingDiscussion = mongoose.model('ProgrammingDiscussion', discussionSchema);
