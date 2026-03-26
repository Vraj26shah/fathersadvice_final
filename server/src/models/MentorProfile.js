import mongoose from 'mongoose';

// Individual skill entry with proficiency (1-5) and years of experience
const skillSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true },
    proficiency: { type: Number, min: 1, max: 5, default: 3 },
    years:       { type: String, default: '' },
  },
  { _id: false }
);

// Availability time slot
const slotSchema = new mongoose.Schema(
  {
    day:   { type: String, required: true },  // e.g. "Monday"
    start: { type: String, required: true },  // e.g. "09:00"
    end:   { type: String, required: true },  // e.g. "11:00"
  },
  { _id: false }
);

const mentorProfileSchema = new mongoose.Schema(
  {
    // Reference to the auth user
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },

    // ── Step 2: Professional identity ─────────────────────────
    jobTitle:       { type: String, default: '' },
    organisation:   { type: String, default: '' },
    yearsExperience:{ type: String, default: '' },
    linkedinUrl:    { type: String, default: '' },
    bio:            { type: String, default: '' },

    // ── Step 3: Skills & domains (E_ij) ───────────────────────
    domain:               { type: String, default: '' },
    skills:               { type: [skillSchema], default: [] },
    expertiseDescription: { type: String, default: '' },   // TF-IDF source

    // ── Step 4: Availability (A_ij) ───────────────────────────
    slots:         { type: [slotSchema], default: [] },
    timezone:      { type: String, default: 'Asia/Kolkata' },
    maxMentees:    { type: Number, default: 3 },
    totalHours:    { type: String, default: '' },   // hours/week available
    sessionLength: { type: String, default: '60' }, // minutes
    languages:     { type: [String], default: [] },

    // Matching status
    isActive: { type: Boolean, default: true },

    // ── Resume & Verification ──────────────────────────────────
    resumeBase64:       { type: String, default: '' },
    resumeFileName:     { type: String, default: '' },
    resumeUploadedAt:   { type: Date,   default: null },
    verificationStatus: {
      type:    String,
      enum:    ['unverified', 'pending', 'approved', 'rejected'],
      default: 'unverified',
    },
    isVerified:         { type: Boolean, default: false },
    verificationNote:   { type: String, default: '' },
  },
  { timestamps: true }
);

const MentorProfile = mongoose.model('MentorProfile', mentorProfileSchema);
export default MentorProfile;
