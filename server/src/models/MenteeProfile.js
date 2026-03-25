import mongoose from 'mongoose';

// Learning topic with priority weighting (1 = highest)
const topicSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true },
    priority: { type: Number, min: 1, max: 3, default: 1 },
  },
  { _id: false }
);

// Availability time slot
const slotSchema = new mongoose.Schema(
  {
    day:   { type: String, required: true },
    start: { type: String, required: true },
    end:   { type: String, required: true },
  },
  { _id: false }
);

const menteeProfileSchema = new mongoose.Schema(
  {
    // Reference to auth user
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    // ── Step 2: Background ─────────────────────────────────────
    roleStatus:   { type: String, default: '' },  // student / working / career-change / freelancer
    organisation: { type: String, default: '' },
    expLevel:     { type: String, default: '' },  // beginner / intermediate / advanced
    domain:       { type: String, default: '' },
    bio:          { type: String, default: '' },

    // ── Step 3: Learning goals (E_ij) ─────────────────────────
    topics:              { type: [topicSchema], default: [] },
    learningDescription: { type: String, default: '' },  // TF-IDF source
    desiredOutcome:      { type: String, default: '' },

    // ── Step 4: Availability (A_ij) ───────────────────────────
    slots:         { type: [slotSchema], default: [] },
    timezone:      { type: String, default: 'Asia/Kolkata' },
    requiredHours: { type: String, default: '' },  // hours/week needed
    sessionFormat: { type: String, default: 'live' },  // live / async / both
    sessionLength: { type: String, default: '60' },
    languages:     { type: [String], default: [] },

    // Currently matched mentor (null = unmatched)
    activeMentor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

const MenteeProfile = mongoose.model('MenteeProfile', menteeProfileSchema);
export default MenteeProfile;
