import mongoose from 'mongoose';

const scheduledSessionSchema = new mongoose.Schema(
  {
    request:    { type: mongoose.Schema.Types.ObjectId, ref: 'ConnectionRequest', required: true },
    mentor:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    mentee:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    scheduledTime: { type: Date, required: true },
    durationMins:  { type: Number, default: 60 },
    proposedBy:    { type: String, enum: ['mentor', 'mentee'], required: true },
    status: {
      type: String,
      enum: ['proposed', 'confirmed', 'cancelled', 'completed'],
      default: 'proposed',
    },
    roomUrl:  { type: String, default: '' },
    notes:    { type: String, default: '' },
    // Reminder flags — set to true once the email has been dispatched
    morningReminderSent: { type: Boolean, default: false },
    hourReminderSent:    { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('ScheduledSession', scheduledSessionSchema);
