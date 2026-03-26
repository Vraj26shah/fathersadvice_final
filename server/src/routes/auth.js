import express from 'express';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import User from '../models/User.js';
import MentorProfile from '../models/MentorProfile.js';
import MenteeProfile from '../models/MenteeProfile.js';
import ConnectionRequest from '../models/ConnectionRequest.js';
import Feedback from '../models/Feedback.js';
import { protect } from '../middleware/auth.js';
import { sendMail, emailOtpVerification } from '../utils/email.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// In-memory OTP store: email → { otp, expiresAt, verified }
const otpStore = new Map();

const router = express.Router();

// Helper: sign a JWT
const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// Helper: send token + safe user object back
const sendAuth = (res, statusCode, user, profileData = {}) => {
  const token = signToken(user._id);
  res.status(statusCode).json({
    token,
    user: {
      id:       user._id,
      fullName: user.fullName,
      email:    user.email,
      role:     user.role,
      profilePicture: user.profilePicture,
      isAdmin:  user.isAdmin || false,
      ...profileData,
    },
  });
};

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/send-otp  — send a 6-digit code to the given email
// ─────────────────────────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required.' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ message: 'An account with this email already exists.' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email.toLowerCase(), { otp, expiresAt: Date.now() + 10 * 60 * 1000, verified: false });

    // In dev mode, skip email entirely and return OTP in the response
    if (process.env.NODE_ENV !== 'production') {
      console.log(`  [DEV] OTP for ${email}: ${otp}`);
      return res.json({ message: 'Dev mode: OTP generated.', devOtp: otp });
    }

    // Production: send email
    await sendMail({ to: email, subject: "Your Father's Advice verification code", html: emailOtpVerification({ otp }) });
    res.json({ message: 'Verification code sent to your email.' });
  } catch (err) {
    console.error('send-otp error:', err);
    const emailAddr = req.body?.email;
    if (emailAddr) otpStore.delete(emailAddr.toLowerCase());
    res.status(500).json({ message: 'Failed to send verification email. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/verify-otp  — confirm the code the user entered
// ─────────────────────────────────────────────────────────────────
router.post('/verify-otp', (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ message: 'Email and OTP are required.' });

  const record = otpStore.get(email.toLowerCase());
  if (!record)                       return res.status(400).json({ message: 'No OTP found for this email. Please request a new code.' });
  if (Date.now() > record.expiresAt) { otpStore.delete(email.toLowerCase()); return res.status(400).json({ message: 'Code has expired. Please request a new one.' }); }
  if (record.otp !== otp.trim())     return res.status(400).json({ message: 'Incorrect code. Please try again.' });

  otpStore.set(email.toLowerCase(), { ...record, verified: true });
  res.json({ verified: true, message: 'Email verified successfully.' });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/register/mentor
// ─────────────────────────────────────────────────────────────────
router.post('/register/mentor', async (req, res) => {
  try {
    const {
      fullName, email, password, profilePicture,
      // Step 2
      jobTitle, organisation, yearsExperience, linkedinUrl, bio,
      // Step 3
      domain, skills, expertiseDescription,
      // Step 4
      slots, timezone, maxMentees, totalHours, sessionLength, languages,
    } = req.body;

    // Basic validation
    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    // OTP verification check
    const otpRecord = otpStore.get(email.toLowerCase());
    if (!otpRecord?.verified) {
      return res.status(400).json({ message: 'Email not verified. Please complete OTP verification first.' });
    }

    // Duplicate check
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    // Create user (pre-save hook hashes the password)
    const user = await User.create({
      fullName,
      email,
      passwordHash: password,
      role: 'mentor',
      profilePicture: profilePicture || null,
    });

    // Create mentor profile
    await MentorProfile.create({
      user:                 user._id,
      jobTitle:             jobTitle             || '',
      organisation:         organisation         || '',
      yearsExperience:      yearsExperience      || '',
      linkedinUrl:          linkedinUrl          || '',
      bio:                  bio                  || '',
      domain:               domain               || '',
      skills:               skills               || [],
      expertiseDescription: expertiseDescription || '',
      slots:                slots                || [],
      timezone:             timezone             || 'Asia/Kolkata',
      maxMentees:           maxMentees           ? Number(maxMentees) : 3,
      totalHours:           totalHours           || '',
      sessionLength:        sessionLength        || '60',
      languages:            languages            || [],
    });

    otpStore.delete(email.toLowerCase()); // clean up
    sendAuth(res, 201, user);
  } catch (err) {
    console.error('register/mentor error:', err);
    res.status(500).json({ message: 'Server error — please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/register/mentee
// ─────────────────────────────────────────────────────────────────
router.post('/register/mentee', async (req, res) => {
  try {
    const {
      fullName, email, password, profilePicture,
      // Step 2
      roleStatus, organisation, expLevel, domain, bio,
      // Step 3
      topics, learningDescription, desiredOutcome,
      // Step 4
      slots, timezone, requiredHours, sessionFormat, sessionLength, languages,
    } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    // OTP verification check
    const otpRecord = otpStore.get(email.toLowerCase());
    if (!otpRecord?.verified) {
      return res.status(400).json({ message: 'Email not verified. Please complete OTP verification first.' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const user = await User.create({
      fullName,
      email,
      passwordHash: password,
      role: 'mentee',
      profilePicture: profilePicture || null,
    });

    await MenteeProfile.create({
      user:                user._id,
      roleStatus:          roleStatus          || '',
      organisation:        organisation        || '',
      expLevel:            expLevel            || '',
      domain:              domain              || '',
      bio:                 bio                 || '',
      topics:              topics              || [],
      learningDescription: learningDescription || '',
      desiredOutcome:      desiredOutcome      || '',
      slots:               slots               || [],
      timezone:            timezone            || 'Asia/Kolkata',
      requiredHours:       requiredHours       || '',
      sessionFormat:       sessionFormat       || 'live',
      sessionLength:       sessionLength       || '60',
      languages:           languages           || [],
    });

    otpStore.delete(email.toLowerCase()); // clean up
    sendAuth(res, 201, user);
  } catch (err) {
    console.error('register/mentee error:', err);
    res.status(500).json({ message: 'Server error — please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/login
// ─────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    // Block admin from password login
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    if (email.toLowerCase() === adminEmail) {
      return res.status(403).json({ message: 'Admin account must sign in with Google.' });
    }

    // Find user and verify password
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Incorrect email or password.' });
    }

    sendAuth(res, 200, user);
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ message: 'Server error — please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/google  — verify Google id_token, log in user
// Admin email → auto-create/find admin account, bypass signup requirement
// Regular email → must have an existing account
// ─────────────────────────────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'Google token is required.' });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { email, name, sub: googleId, picture } = ticket.getPayload();
    const normalizedEmail = email.toLowerCase();
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();

    let user = await User.findOne({ $or: [{ googleId }, { email: normalizedEmail }] });

    if (normalizedEmail === adminEmail) {
      // Admin path — create the admin user on first login if needed
      if (!user) {
        user = await User.create({
          fullName: name || 'Admin',
          email:    normalizedEmail,
          googleId,
          role:     'admin',
          isAdmin:  true,
          profilePicture: picture || null,
        });
      } else {
        // Ensure existing record has admin flags and correct role set
        let dirty = false;
        if (!user.isAdmin)         { user.isAdmin  = true;    dirty = true; }
        if (user.role !== 'admin') { user.role     = 'admin'; dirty = true; }
        if (!user.googleId)        { user.googleId = googleId; dirty = true; }
        if (!user.profilePicture && picture) { user.profilePicture = picture; dirty = true; }
        if (dirty) await user.save();
      }
      return sendAuth(res, 200, user);
    }

    // Regular user — must have signed up first
    if (!user) {
      return res.status(404).json({
        message: 'No account found for this Google account. Please sign up first.',
      });
    }

    // Attach googleId + picture on first Google login
    let dirty = false;
    if (!user.googleId)                      { user.googleId = googleId; dirty = true; }
    if (!user.profilePicture && picture)     { user.profilePicture = picture; dirty = true; }
    if (dirty) await user.save();

    sendAuth(res, 200, user);
  } catch (err) {
    console.error('google auth error:', err.message);
    res.status(401).json({ message: 'Google sign-in failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/auth/me  — returns the logged-in user + profile
// ─────────────────────────────────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  try {
    const user = req.user;
    let profile = null;

    if (user.role === 'mentor') {
      profile = await MentorProfile.findOne({ user: user._id });
    } else {
      profile = await MenteeProfile.findOne({ user: user._id });
    }

    res.json({
      user: {
        id:       user._id,
        fullName: user.fullName,
        email:    user.email,
        role:     user.role,
        profilePicture: user.profilePicture,
        isAdmin:  user.isAdmin || false,
      },
      profile,
    });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/feedback  — submit session feedback
// ─────────────────────────────────────────────────────────────────
router.post('/feedback', protect, async (req, res) => {
  try {
    const { connectionId, rating, comment } = req.body;
    if (!connectionId || !rating) {
      return res.status(400).json({ message: 'connectionId and rating are required.' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
    }

    const conn = await ConnectionRequest.findById(connectionId).lean();
    if (!conn) return res.status(404).json({ message: 'Session not found.' });

    const uid      = req.user._id.toString();
    const mentorId = conn.mentor.toString();
    const menteeId = conn.mentee.toString();
    if (uid !== mentorId && uid !== menteeId) {
      return res.status(403).json({ message: 'Not a participant of this session.' });
    }

    const toId = uid === mentorId ? conn.mentee : conn.mentor;

    await Feedback.create({
      from:       req.user._id,
      to:         toId,
      connection: connectionId,
      rating:     Number(rating),
      comment:    (comment || '').trim(),
      fromRole:   req.user.role,
    });

    res.json({ message: 'Feedback submitted. Thank you!' });
  } catch (err) {
    if (err.code === 11000) return res.json({ message: 'Feedback already submitted for this session.' });
    console.error('feedback error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// PUT /api/auth/profile  — update profile (email is never changed)
// ─────────────────────────────────────────────────────────────────
router.put('/profile', protect, async (req, res) => {
  try {
    const uid = req.user._id;
    const { fullName, profilePicture, ...profileData } = req.body;

    // Update base user fields (never email)
    const userUpdate = {};
    if (fullName?.trim())          userUpdate.fullName       = fullName.trim();
    if (profilePicture !== undefined) userUpdate.profilePicture = profilePicture;
    if (Object.keys(userUpdate).length) await User.findByIdAndUpdate(uid, userUpdate);

    // Update role-specific profile
    if (req.user.role === 'mentor') {
      const allowed = ['jobTitle','organisation','yearsExperience','linkedinUrl','bio',
                       'domain','skills','expertiseDescription','slots','timezone',
                       'maxMentees','totalHours','sessionLength','languages','isActive'];
      const update = {};
      allowed.forEach(k => { if (profileData[k] !== undefined) update[k] = profileData[k]; });
      await MentorProfile.findOneAndUpdate({ user: uid }, update, { new: true });
    } else {
      const allowed = ['roleStatus','organisation','expLevel','domain','bio',
                       'topics','learningDescription','desiredOutcome','slots',
                       'timezone','requiredHours','sessionFormat','sessionLength','languages'];
      const update = {};
      allowed.forEach(k => { if (profileData[k] !== undefined) update[k] = profileData[k]; });
      await MenteeProfile.findOneAndUpdate({ user: uid }, update, { new: true });
    }

    const updatedUser    = await User.findById(uid).lean();
    const updatedProfile = req.user.role === 'mentor'
      ? await MentorProfile.findOne({ user: uid }).lean()
      : await MenteeProfile.findOne({ user: uid }).lean();

    res.json({
      user: {
        id: updatedUser._id, fullName: updatedUser.fullName,
        email: updatedUser.email, role: updatedUser.role,
        profilePicture: updatedUser.profilePicture,
      },
      profile: updatedProfile,
    });
  } catch (err) {
    console.error('profile update error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/auth/upload-resume  — mentor uploads resume (base64 PDF/DOCX)
// ─────────────────────────────────────────────────────────────────
router.post('/upload-resume', protect, async (req, res) => {
  try {
    if (req.user.role !== 'mentor') {
      return res.status(403).json({ message: 'Only mentors can upload a resume.' });
    }
    const { resumeBase64, resumeFileName } = req.body;
    if (!resumeBase64 || !resumeFileName) {
      return res.status(400).json({ message: 'Resume file and filename are required.' });
    }

    await MentorProfile.findOneAndUpdate(
      { user: req.user._id },
      {
        resumeBase64,
        resumeFileName,
        resumeUploadedAt:   new Date(),
        verificationStatus: 'pending',
        isVerified:         false,
        verificationNote:   '',
      }
    );

    res.json({ message: 'Resume uploaded. Your profile is now pending admin verification.' });
  } catch (err) {
    console.error('upload-resume error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

export default router;
