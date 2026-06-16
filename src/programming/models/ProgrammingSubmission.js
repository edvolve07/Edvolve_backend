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

const submissionSchema = new mongoose.Schema(
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
    language: {
      type: String,
      required: true,
    },
    code: { type: String, required: true },
    status: {
      type: String,
      enum: [
        'pending',
        'running',
        'accepted',
        'wrong_answer',
        'time_limit_exceeded',
        'memory_limit_exceeded',
        'runtime_error',
        'compilation_error',
      ],
      default: 'pending',
      index: true,
    },
    passed_test_cases: { type: Number, default: 0 },
    total_test_cases: { type: Number, default: 0 },
    test_results: [testResultSchema],
    execution_time_ms: { type: Number, default: 0 },
    memory_used_kb: { type: Number, default: 0 },
    error_message: { type: String, default: '' },
  },
  {
    timestamps: { createdAt: 'submitted_at', updatedAt: 'updated_at' },
  },
);

submissionSchema.index({ problem_id: 1, student_id: 1, submitted_at: -1 });

export const ProgrammingSubmission = mongoose.model(
  'ProgrammingSubmission',
  submissionSchema,
);
