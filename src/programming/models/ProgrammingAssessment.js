import mongoose from '../../aptitude/config/mongoose.js';

const assessmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
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

assessmentSchema.set('toJSON', { virtuals: true });
assessmentSchema.set('toObject', { virtuals: true });

export const ProgrammingAssessment = mongoose.model('ProgrammingAssessment', assessmentSchema);
