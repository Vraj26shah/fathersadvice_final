import express from 'express';
import ConnectionRequest from '../models/ConnectionRequest.js';
import ScheduledSession from '../models/ScheduledSession.js';
import { protect } from '../middleware/auth.js';
import { getIO, onlineUsers } from '../socket.js';
import { sendMail, emailSessionScheduled, emailSessionConfirmed } from '../utils/email.js';

const router = express.Router();
router.use(protect);

const BASE_URL = process.env.APP_URL || 'http://localhost:5000';

function formatTime(date) {
  return new Date(date).toLocaleString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZoneName: 'short',
  });
}

// ─────────────────────────────────────────────────────────────────
// POST /api/sessions/propose
// Mentor or mentee proposes a session time for an accepted connection
// Body: { requestId, scheduledTime (ISO string), durationMins, notes }
// ─────────────────────────────────────────────────────────────────
router.post('/propose', async (req, res) => {
  try {
    const { requestId, scheduledTime, durationMins, notes } = req.body;
    if (!requestId || !scheduledTime) {
      return res.status(400).json({ message: 'requestId and scheduledTime are required.' });
    }

    const connection = await ConnectionRequest.findById(requestId)
      .populate('mentor', 'fullName email')
      .populate('mentee', 'fullName email')
      .lean();

    if (!connection) return res.status(404).json({ message: 'Connection not found.' });
    if (connection.status !== 'accepted') {
      return res.status(400).json({ message: 'You can only schedule sessions for accepted connections.' });
    }

    const uid = req.user._id.toString();
    const isParticipant = connection.mentor._id.toString() === uid || connection.mentee._id.toString() === uid;
    if (!isParticipant) return res.status(403).json({ message: 'Access denied.' });

    // ── 5-session limit per connection ────────────────────────────
    const activeCount = await ScheduledSession.countDocuments({
      request: requestId,
      status:  { $in: ['proposed', 'confirmed'] },
    });
    if (activeCount >= 5) {
      return res.status(400).json({
        message: 'You already have 5 active sessions scheduled. Complete them before booking more.',
        limitReached: true,
        activeCount,
      });
    }

    const session = await ScheduledSession.create({
      request:      requestId,
      mentor:       connection.mentor._id,
      mentee:       connection.mentee._id,
      scheduledTime: new Date(scheduledTime),
      durationMins:  durationMins || 60,
      proposedBy:    req.user.role,
      roomUrl:       `https://meet.jit.si/FathersAdvice-${requestId}`,
      notes:         notes || '',
    });

    const proposer   = req.user.role === 'mentor' ? connection.mentor : connection.mentee;
    const recipient  = req.user.role === 'mentor' ? connection.mentee : connection.mentor;
    const sessionUrl = `${BASE_URL}/session.html?requestId=${requestId}`;
    const timeStr    = formatTime(scheduledTime);

    // Notify recipient in real-time if online
    const io = getIO();
    if (io && onlineUsers.has(recipient._id.toString())) {
      io.to(onlineUsers.get(recipient._id.toString())).emit('session_scheduled', {
        sessionId:    session._id,
        proposerName: proposer.fullName,
        proposerRole: req.user.role,
        scheduledTime: timeStr,
        durationMins:  session.durationMins,
        notes:         session.notes,
        sessionUrl,
        requestId,
      });
    }

    // Also send email (regardless of online status — as a reminder)
    await sendMail({
      to:      recipient.email,
      subject: `📅 Session scheduled by ${proposer.fullName}`,
      html:    emailSessionScheduled({
        recipientName: recipient.fullName,
        proposerName:  proposer.fullName,
        proposerRole:  req.user.role,
        scheduledTime: timeStr,
        sessionUrl,
        notes:         session.notes,
      }),
    });

    res.status(201).json({ message: 'Session proposed.', session });
  } catch (err) {
    console.error('POST /sessions/propose error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/sessions/confirm/:sessionId
// The other party confirms the proposed session
// ─────────────────────────────────────────────────────────────────
router.post('/confirm/:sessionId', async (req, res) => {
  try {
    const session = await ScheduledSession.findById(req.params.sessionId)
      .populate('mentor', 'fullName email')
      .populate('mentee', 'fullName email');

    if (!session) return res.status(404).json({ message: 'Session not found.' });

    const uid = req.user._id.toString();
    const isParticipant = session.mentor._id.toString() === uid || session.mentee._id.toString() === uid;
    if (!isParticipant) return res.status(403).json({ message: 'Access denied.' });

    if (session.status !== 'proposed') {
      return res.status(400).json({ message: `Session is already ${session.status}.` });
    }

    session.status = 'confirmed';
    await session.save();

    const timeStr    = formatTime(session.scheduledTime);
    const sessionUrl = `${BASE_URL}/session.html?requestId=${session.request}`;

    // Notify proposer in real-time
    const proposerUser = session.proposedBy === 'mentor' ? session.mentor : session.mentee;
    const confirmerUser = session.proposedBy === 'mentor' ? session.mentee : session.mentor;
    const io = getIO();
    if (io && onlineUsers.has(proposerUser._id.toString())) {
      io.to(onlineUsers.get(proposerUser._id.toString())).emit('session_confirmed', {
        sessionId:     session._id,
        confirmerName: confirmerUser.fullName,
        scheduledTime: timeStr,
        sessionUrl,
        requestId:     session.request,
      });
    }

    // Email both parties
    await Promise.all([
      sendMail({
        to:      session.mentor.email,
        subject: '✅ Session confirmed — Father\'s Advice',
        html:    emailSessionConfirmed({ recipientName: session.mentor.fullName, otherName: session.mentee.fullName, scheduledTime: timeStr, sessionUrl }),
      }),
      sendMail({
        to:      session.mentee.email,
        subject: '✅ Session confirmed — Father\'s Advice',
        html:    emailSessionConfirmed({ recipientName: session.mentee.fullName, otherName: session.mentor.fullName, scheduledTime: timeStr, sessionUrl }),
      }),
    ]);

    res.json({ message: 'Session confirmed.', session });
  } catch (err) {
    console.error('POST /sessions/confirm error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/sessions/cancel/:sessionId
// ─────────────────────────────────────────────────────────────────
router.post('/cancel/:sessionId', async (req, res) => {
  try {
    const session = await ScheduledSession.findById(req.params.sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found.' });

    const uid = req.user._id.toString();
    const isParticipant = session.mentor.toString() === uid || session.mentee.toString() === uid;
    if (!isParticipant) return res.status(403).json({ message: 'Access denied.' });

    session.status = 'cancelled';
    await session.save();
    res.json({ message: 'Session cancelled.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/sessions/mine
// All sessions for current user (proposed + confirmed)
// ─────────────────────────────────────────────────────────────────
router.get('/mine', async (req, res) => {
  try {
    const field = req.user.role === 'mentor' ? 'mentor' : 'mentee';
    const sessions = await ScheduledSession.find({
      [field]: req.user._id,
      status: { $ne: 'cancelled' },
    })
      .populate('mentor', 'fullName')
      .populate('mentee', 'fullName')
      .sort({ scheduledTime: 1 })
      .lean();

    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/sessions/complete/:sessionId
// Mark a session as completed (either party can call this)
// ─────────────────────────────────────────────────────────────────
router.post('/complete/:sessionId', async (req, res) => {
  try {
    const session = await ScheduledSession.findById(req.params.sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found.' });

    const uid = req.user._id.toString();
    const isParticipant = session.mentor.toString() === uid || session.mentee.toString() === uid;
    if (!isParticipant) return res.status(403).json({ message: 'Access denied.' });

    session.status = 'completed';
    await session.save();
    res.json({ message: 'Session marked as completed.' });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/sessions/calendar?year=YYYY&month=M (0-indexed month)
// Returns all non-cancelled sessions for the user in a given month
// ─────────────────────────────────────────────────────────────────
router.get('/calendar', async (req, res) => {
  try {
    const year  = parseInt(req.query.year  || new Date().getFullYear(), 10);
    const month = parseInt(req.query.month || new Date().getMonth(),    10);

    const start = new Date(year, month, 1);
    const end   = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const field = req.user.role === 'mentor' ? 'mentor' : 'mentee';
    const sessions = await ScheduledSession.find({
      [field]:       req.user._id,
      scheduledTime: { $gte: start, $lte: end },
      status:        { $in: ['proposed', 'confirmed'] },
    })
      .populate('mentor', 'fullName')
      .populate('mentee', 'fullName')
      .sort({ scheduledTime: 1 })
      .lean();

    // Also return active count per request so the frontend can show the limit
    const activeCounts = {};
    for (const s of sessions) {
      const rid = s.request.toString();
      if (!activeCounts[rid]) {
        activeCounts[rid] = await ScheduledSession.countDocuments({
          request: rid, status: { $in: ['proposed', 'confirmed'] },
        });
      }
    }

    res.json({ sessions, activeCounts });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/sessions/limit/:requestId
// Returns how many active sessions exist for a connection (max 5)
// ─────────────────────────────────────────────────────────────────
router.get('/limit/:requestId', async (req, res) => {
  try {
    const active = await ScheduledSession.countDocuments({
      request: req.params.requestId,
      status:  { $in: ['proposed', 'confirmed'] },
    });
    const completed = await ScheduledSession.countDocuments({
      request: req.params.requestId,
      status:  'completed',
    });
    res.json({ active, completed, remaining: Math.max(0, 5 - active) });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
});

export default router;
