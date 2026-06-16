import mongoose from '../../aptitude/config/mongoose.js';

const sampleTestCaseSchema = new mongoose.Schema(
  {
    input: { type: String, required: true },
    output: { type: String, required: true },
    display_input: { type: String, default: '' },
    display_output: { type: String, default: '' },
    explanation: { type: String, default: '' },
  },
  { _id: false },
);

const hiddenTestCaseSchema = new mongoose.Schema(
  {
    input: { type: String, required: true },
    output: { type: String, required: true },
  },
  { _id: false },
);

const problemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    problem_number: { type: Number, default: null, index: true },
    description: { type: String, required: true },
    constraints: { type: String, default: '' },
    input_format: { type: String, default: '' },
    output_format: { type: String, default: '' },
    hints: { type: [String], default: [] },
    follow_up: { type: String, default: '' },
    difficulty: {
      type: String,
      enum: ['Easy', 'Medium', 'Hard'],
      required: true,
      index: true,
    },
    tags: { type: [String], default: [], index: true },
    company_tags: { type: [String], default: [], index: true },
    companies_locked: { type: Boolean, default: true },
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
    concept: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    sample_test_cases: [sampleTestCaseSchema],
    hidden_test_cases: [hiddenTestCaseSchema],
    time_limit: { type: Number, default: 2, min: 1, max: 15 },
    memory_limit: { type: Number, default: 256, min: 16, max: 1024 },
    languages: {
      type: [String],
      default: ['javascript', 'python'],
    },
    starter_code: {
      javascript: { type: String, default: '' },
      typescript: { type: String, default: '' },
      python: { type: String, default: '' },
      java: { type: String, default: '' },
      cpp: { type: String, default: '' },
      c: { type: String, default: '' },
      csharp: { type: String, default: '' },
      go: { type: String, default: '' },
      rust: { type: String, default: '' },
      kotlin: { type: String, default: '' },
      ruby: { type: String, default: '' },
      swift: { type: String, default: '' },
      php: { type: String, default: '' },
    },
    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
      index: true,
    },
    is_deleted: { type: Boolean, default: false, index: true },
    deleted_at: { type: Date, default: null },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    total_submissions: { type: Number, default: 0 },
    total_accepted: { type: Number, default: 0 },
    difficulty_rank: { type: Number, default: 1, index: true },
    topic_rank: { type: Number, default: 99, index: true },
    curriculum_order: { type: Number, default: 9999, index: true },
    is_beginner_friendly: { type: Boolean, default: false, index: true },
    is_auto_gradable: { type: Boolean, default: true, index: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

problemSchema.index({ status: 1, is_deleted: 1, difficulty_rank: 1, curriculum_order: 1 });
problemSchema.index({ duplicate_fingerprint: 1, institution_id: 1 });

problemSchema.pre('save', function setProblemFingerprint(next) {
  this.duplicate_fingerprint = String(this.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 180);
  next();
});

problemSchema.virtual('acceptance_rate').get(function () {
  if (this.total_submissions === 0) return 0;
  return Math.round((this.total_accepted / this.total_submissions) * 100);
});

problemSchema.set('toJSON', { virtuals: true });
problemSchema.set('toObject', { virtuals: true });

export const ProgrammingProblem = mongoose.model('ProgrammingProblem', problemSchema);
