import express from 'express';
import User from '../models/User.js';
import MentorProfile from '../models/MentorProfile.js';
import { protect, requireAdmin } from '../middleware/auth.js';
import { getIO, onlineUsers } from '../socket.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────────
// POST /api/admin/create-admin
// Create an admin account protected by ADMIN_SECRET env variable.
// Call once to bootstrap the first admin user.
// ─────────────────────────────────────────────────────────────────
router.post('/create-admin', async (req, res) => {
  try {
    const { secret, email } = req.body;
    const ADMIN_SECRET = process.env.ADMIN_SECRET;

    if (!ADMIN_SECRET) {
      return res.status(500).json({ message: 'ADMIN_SECRET not configured on server.' });
    }
    if (!email) {
      return res.status(400).json({ message: 'Email is required.' });
    }
    if (secret !== ADMIN_SECRET) {
      return res.status(403).json({ message: 'Invalid admin secret.' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ message: 'User not found.' });

    user.isAdmin = true;
    await user.save();

    res.json({ message: `${user.fullName} (${user.email}) is now an admin.` });
  } catch (err) {
    console.error('create-admin error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// All routes below require authentication + admin role
router.use(protect, requireAdmin);

// ─────────────────────────────────────────────────────────────────
// GET /api/admin/mentors
// List all mentors with their verification status (no resume data)
// ─────────────────────────────────────────────────────────────────
router.get('/mentors', async (req, res) => {
  try {
    const profiles = await MentorProfile.find()
      .populate('user', 'fullName email profilePicture')
      .select('-resumeBase64')   // exclude large base64 blob from list
      .lean();

    const mentors = profiles
      .filter(p => p.user)
      .map(p => ({
        profileId:          p._id,
        userId:             p.user._id,
        fullName:           p.user.fullName,
        email:              p.user.email,
        profilePicture:     p.user.profilePicture,
        jobTitle:           p.jobTitle,
        organisation:       p.organisation,
        domain:             p.domain,
        verificationStatus: p.verificationStatus,
        isVerified:         p.isVerified,
        verificationNote:   p.verificationNote,
        resumeFileName:     p.resumeFileName,
        resumeUploadedAt:   p.resumeUploadedAt,
        hasResume:          !!p.resumeFileName,
      }));

    res.json({ mentors });
  } catch (err) {
    console.error('admin GET /mentors error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/admin/mentor-resume/:profileId
// Get a mentor's uploaded resume as base64 (for preview in admin panel)
// ─────────────────────────────────────────────────────────────────
router.get('/mentor-resume/:profileId', async (req, res) => {
  try {
    const profile = await MentorProfile.findById(req.params.profileId)
      .select('resumeBase64 resumeFileName')
      .lean();
    if (!profile) return res.status(404).json({ message: 'Profile not found.' });
    if (!profile.resumeBase64) return res.status(404).json({ message: 'No resume uploaded.' });

    res.json({
      resumeBase64:  profile.resumeBase64,
      resumeFileName: profile.resumeFileName,
    });
  } catch (err) {
    console.error('admin GET /mentor-resume error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/admin/verify/:profileId
// Approve or reject a mentor's verification
// body: { action: 'approve' | 'reject', note?: string }
// ─────────────────────────────────────────────────────────────────
router.post('/verify/:profileId', async (req, res) => {
  try {
    const { action, note } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'action must be "approve" or "reject".' });
    }

    const update = {
      verificationStatus: action === 'approve' ? 'approved' : 'rejected',
      isVerified:         action === 'approve',
      verificationNote:   (note || '').trim(),
    };

    const profile = await MentorProfile.findByIdAndUpdate(
      req.params.profileId,
      update,
      { new: true }
    ).populate('user', '_id fullName email');

    if (!profile) return res.status(404).json({ message: 'Profile not found.' });

    const mentorUserId = profile.user._id.toString();
    const io = getIO();

    // Notify the mentor directly if online
    const mentorSid = onlineUsers.get(mentorUserId);
    if (mentorSid) {
      io.to(mentorSid).emit('verification_update', {
        status: action === 'approve' ? 'approved' : 'rejected',
        note:   (note || '').trim(),
      });
    }

    // Broadcast badge change to ALL connected clients so mentee dashboards update live
    io.emit('mentor_verification_changed', {
      mentorUserId,
      isVerified: action === 'approve',
    });

    res.json({
      message: `Mentor ${action === 'approve' ? 'approved' : 'rejected'} successfully.`,
      verificationStatus: profile.verificationStatus,
      isVerified:         profile.isVerified,
    });
  } catch (err) {
    console.error('admin POST /verify error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

export default router;
