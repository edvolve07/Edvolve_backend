import mongoose from '../config/mongoose.js';

const assessmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    concept: { type: String, required: true, trim: true },
    difficulty: {
      type: String,
      enum: ['Easy', 'Medium', 'Hard', 'Mixed'],
      required: true,
    },
    duration_minutes: { type: Number, required: true, min: 1 },
    total_marks: { type: Number, required: true, min: 0 },
    passing_marks: { type: Number, required: true, min: 0 },
    start_time: { type: Date, default: null },
    end_time: { type: Date, default: null },
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
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

assessmentSchema.virtual('total_questions', {
  ref: 'Question',
  localField: '_id',
  foreignField: 'assessment_id',
  count: true,
});

assessmentSchema.set('toJSON', { virtuals: true });
assessmentSchema.set('toObject', { virtuals: true });

export const Assessment = mongoose.model('Assessment', assessmentSchema);
