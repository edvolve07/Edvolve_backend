import mongoose from '../config/mongoose.js';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
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
    role: this.role,
    created_at: this.created_at,
    updated_at: this.updated_at,
  };
};

export const User = mongoose.model('User', userSchema);
