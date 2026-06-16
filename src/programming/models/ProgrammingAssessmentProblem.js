import mongoose from '../../aptitude/config/mongoose.js';

const sampleTestCaseSchema = new mongoose.Schema(
  {
    input: { type: String, required: true },
    output: { type: String, required: true },
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

const assessmentProblemSchema = new mongoose.Schema(
  {
    assessment_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProgrammingAssessment',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    constraints: { type: String, default: '' },
    input_format: { type: String, default: '' },
    output_format: { type: String, default: '' },
    difficulty: {
      type: String,
      enum: ['Easy', 'Medium', 'Hard'],
      required: true,
    },
    concept: {
      type: String,
      required: true,
      trim: true,
    },
    marks: { type: Number, required: true, min: 1 },
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
    order: { type: Number, default: 0 },
    difficulty_rank: { type: Number, default: 1 },
    topic_rank: { type: Number, default: 99 },
    curriculum_order: { type: Number, default: 9999 },
    is_beginner_friendly: { type: Boolean, default: false },
    is_auto_gradable: { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

assessmentProblemSchema.index({ assessment_id: 1, order: 1 });

assessmentProblemSchema.set('toJSON', { virtuals: true });
assessmentProblemSchema.set('toObject', { virtuals: true });

export const ProgrammingAssessmentProblem = mongoose.model('ProgrammingAssessmentProblem', assessmentProblemSchema);
