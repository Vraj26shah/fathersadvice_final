import mongoose from 'mongoose';

const feedbackSchema = new mongoose.Schema({
  from:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  connection: { type: mongoose.Schema.Types.ObjectId, ref: 'ConnectionRequest', required: true },
  rating:     { type: Number, min: 1, max: 5, required: true },
  comment:    { type: String, maxlength: 1000, default: '' },
  fromRole:   { type: String, enum: ['mentor', 'mentee'], required: true },
}, { timestamps: true });

// One feedback per user per session
feedbackSchema.index({ from: 1, connection: 1 }, { unique: true });

export default mongoose.model('Feedback', feedbackSchema);
