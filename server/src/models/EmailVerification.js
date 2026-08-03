import mongoose from 'mongoose';

// Persists OTP status across restarts and multiple production instances.
const emailVerificationSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  otpHash: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  verified: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, required: true },
}, { timestamps: true });

export default mongoose.model('EmailVerification', emailVerificationSchema);
