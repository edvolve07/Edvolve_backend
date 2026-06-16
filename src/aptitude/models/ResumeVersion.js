import mongoose from '../config/mongoose.js';

const resumeSectionSchema = new mongoose.Schema(
  {
    title: { type: String, default: '' },
    items: { type: [String], default: [] },
  },
  { _id: false },
);

const resumeVersionSchema = new mongoose.Schema(
  {
    student_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    version: { type: Number, required: true, min: 1 },
    title: { type: String, default: 'Resume', trim: true },
    target_role: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true },
    linkedin: { type: String, default: '', trim: true },
    github: { type: String, default: '', trim: true },
    location: { type: String, default: '', trim: true },
    summary: { type: String, default: '', trim: true },
    skills: { type: [String], default: [] },
    experience: { type: [resumeSectionSchema], default: [] },
    education: { type: [resumeSectionSchema], default: [] },
    projects: { type: [resumeSectionSchema], default: [] },
    certifications: { type: [String], default: [] },
    achievements: { type: [resumeSectionSchema], default: [] },
    ats_analysis: {
      ats_score: { type: Number, default: 0 },
      previous_score: { type: Number, default: 0 },
      improvements: { type: [String], default: [] },
      strengths: { type: [String], default: [] },
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

resumeVersionSchema.index({ student_id: 1, version: -1 });

export const ResumeVersion = mongoose.model('ResumeVersion', resumeVersionSchema);
