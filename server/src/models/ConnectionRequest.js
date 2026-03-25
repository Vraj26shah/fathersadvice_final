import mongoose from 'mongoose';

const connectionRequestSchema = new mongoose.Schema(
  {
    mentee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mentor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doubt:  { type: String, required: true, trim: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  },
  { timestamps: true }
);

// One active request per mentee→mentor pair
connectionRequestSchema.index({ mentee: 1, mentor: 1 }, { unique: true });

export default mongoose.model('ConnectionRequest', connectionRequestSchema);
