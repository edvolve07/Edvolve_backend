import mongoose from '../../aptitude/config/mongoose.js';

const testResultSchema = new mongoose.Schema(
  {
    test_case_index: { type: Number, required: true },
    input: { type: String, default: '' },
    expected_output: { type: String, default: '' },
    actual_output: { type: String, default: '' },
    passed: { type: Boolean, default: false },
    error: { type: String, default: '' },
    execution_time_ms: { type: Number, default: 0 },
  },
  { _id: false },
);

const assessmentAnswerSchema = new mongoose.Schema(
  {
    attempt_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProgrammingAssessmentAttempt',
      required: true,
      index: true,
    },
    problem_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProgrammingAssessmentProblem',
      required: true,
    },
    code: { type: String, default: '' },
    language: { type: String, default: 'javascript' },
    status: {
      type: String,
      enum: [
        'pending',
        'accepted',
        'wrong_answer',
        'time_limit_exceeded',
        'runtime_error',
        'compilation_error',
      ],
      default: 'pending',
    },
    passed_test_cases: { type: Number, default: 0 },
    total_test_cases: { type: Number, default: 0 },
    test_results: [testResultSchema],
    marks_awarded: { type: Number, default: 0 },
    submitted_at: { type: Date, default: null },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

assessmentAnswerSchema.index({ attempt_id: 1, problem_id: 1 }, { unique: true });

export const ProgrammingAssessmentAnswer = mongoose.model('ProgrammingAssessmentAnswer', assessmentAnswerSchema);
