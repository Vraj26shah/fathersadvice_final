import express from 'express';
import ConnectionRequest from '../models/ConnectionRequest.js';
import ChatMessage from '../models/ChatMessage.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();
router.use(protect);

// ─────────────────────────────────────────────────────────────────
// GET /api/chat/conversations
// Returns all accepted connections for current user, with last
// message and unread count for each — used to populate the sidebar
// ─────────────────────────────────────────────────────────────────
router.get('/conversations', async (req, res) => {
  try {
    const uid   = req.user._id;
    const field = req.user.role === 'mentor' ? 'mentor' : 'mentee';

    const connections = await ConnectionRequest.find({
      [field]: uid,
      status:  'accepted',
    })
      .populate('mentor', 'fullName profilePicture')
      .populate('mentee', 'fullName profilePicture')
      .lean();

    const conversations = await Promise.all(connections.map(async (c) => {
      const [lastMsg, unread] = await Promise.all([
        ChatMessage.findOne({ connection: c._id })
          .sort({ createdAt: -1 })
          .populate('sender', 'fullName')
          .lean(),
        ChatMessage.countDocuments({
          connection: c._id,
          readBy:     { $ne: uid },
          sender:     { $ne: uid },
        }),
      ]);

      const other = req.user.role === 'mentor' ? c.mentee : c.mentor;
      return {
        connectionId:  c._id,
        otherId:       other._id,
        otherName:     other.fullName,
        otherAvatar:   other.profilePicture,
        otherRole:     req.user.role === 'mentor' ? 'mentee' : 'mentor',
        lastMessage:   lastMsg ? { text: lastMsg.text, senderName: lastMsg.sender?.fullName, createdAt: lastMsg.createdAt } : null,
        unreadCount:   unread,
        doubt:         c.doubt,
        requestId:     c._id,   // alias for Jitsi session link
      };
    }));

    // Sort by last message time, newest first
    conversations.sort((a, b) => {
      const ta = a.lastMessage?.createdAt || 0;
      const tb = b.lastMessage?.createdAt || 0;
      return new Date(tb) - new Date(ta);
    });

    res.json({ conversations });
  } catch (err) {
    console.error('GET /chat/conversations error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// GET /api/chat/messages/:connectionId?before=<ISO>&limit=50
// Returns message history, oldest-to-newest, paginated via 'before'
// ─────────────────────────────────────────────────────────────────
router.get('/messages/:connectionId', async (req, res) => {
  try {
    const uid = req.user._id;
    const conn = await ConnectionRequest.findOne({
      _id:    req.params.connectionId,
      status: 'accepted',
      $or:    [{ mentor: uid }, { mentee: uid }],
    }).lean();
    if (!conn) return res.status(403).json({ message: 'Access denied.' });

    const limit  = Math.min(parseInt(req.query.limit || '50', 10), 100);
    const filter = { connection: req.params.connectionId };
    if (req.query.before) {
      filter.createdAt = { $lt: new Date(req.query.before) };
    }

    const messages = await ChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('sender', 'fullName')
      .lean();

    // Mark fetched messages as read
    await ChatMessage.updateMany(
      { connection: req.params.connectionId, readBy: { $ne: uid }, sender: { $ne: uid } },
      { $addToSet: { readBy: uid } }
    );

    res.json({ messages: messages.reverse() });
  } catch (err) {
    console.error('GET /chat/messages error:', err);
    res.status(500).json({ message: 'Server error.' });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/chat/read/:connectionId
// Mark all messages in this conversation as read
// ─────────────────────────────────────────────────────────────────
router.post('/read/:connectionId', async (req, res) => {
  try {
    await ChatMessage.updateMany(
      { connection: req.params.connectionId, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
});

export default router;
