import mongoose from '../../aptitude/config/mongoose.js';

const editorialSchema = new mongoose.Schema(
  {
    problem_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProgrammingProblem',
      required: true,
      unique: true,
      index: true,
    },
    overview: { type: String, default: '' },
    brute_force: { type: String, default: '' },
    optimal_approach: { type: String, default: '' },
    complexity: { type: String, default: '' },
    pitfalls: { type: [String], default: [] },
    code_by_language: { type: Map, of: String, default: {} },
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

export const ProgrammingEditorial = mongoose.model('ProgrammingEditorial', editorialSchema);
