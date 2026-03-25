import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import MentorProfile from '../models/MentorProfile.js';
import MenteeProfile from '../models/MenteeProfile.js';
import { protect } from '../middleware/auth.js';

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
      ...profileData,
    },
  });
};

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
      },
      profile,
    });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

export default router;
