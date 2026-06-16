import mongoose from '../config/mongoose.js';
import { formatDisplayName } from '../utils/nameFormat.js';

const MODULE_OPTIONS = ['ai_interview', 'aptitude', 'programming', 'both'];

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      set: formatDisplayName,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
    organization: {
      type: String,
      trim: true,
      default: '',
    },
    interested_role: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    profile_headline: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    profile_bio: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    location: {
      type: String,
      trim: true,
      maxlength: 80,
      default: '',
    },
    modules_access: {
      type: [String],
      enum: MODULE_OPTIONS,
      default: ['both'],
    },
    assigned_admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    must_change_password: {
      type: Boolean,
      default: true,
    },
    password_hash: {
      type: String,
      required: true,
      select: false,
    },
    password_salt: {
      type: String,
      select: false,
    },
    password_reset_token_hash: {
      type: String,
      select: false,
      index: true,
    },
    password_reset_expires_at: {
      type: Date,
      index: true,
    },
    role: {
      type: String,
      enum: ['student', 'admin', 'master_admin'],
      required: true,
      default: 'student',
      index: true,
    },
    is_active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);

userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    phone: this.phone || '',
    organization: this.organization || '',
    interested_role: this.interested_role || '',
    profile_headline: this.profile_headline || '',
    profile_bio: this.profile_bio || '',
    location: this.location || '',
    modules_access: this.    modules_access || ['both'],
    
    assigned_admin: this.assigned_admin ? this.assigned_admin.toString() : null,
    must_change_password: this.must_change_password !== false,
    role: this.role,
    is_active: this.is_active !== false,
    created_at: this.created_at,
    updated_at: this.updated_at,
  };
};

export const User = mongoose.model('User', userSchema);
