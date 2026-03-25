import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema(
  {
    connection: { type: mongoose.Schema.Types.ObjectId, ref: 'ConnectionRequest', required: true, index: true },
    sender:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text:       { type: String, required: true, trim: true, maxlength: 2000 },
    readBy:     { type: [mongoose.Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true }
);

chatMessageSchema.index({ connection: 1, createdAt: -1 });

export default mongoose.model('ChatMessage', chatMessageSchema);
