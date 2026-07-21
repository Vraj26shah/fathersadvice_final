import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import ChatMessage from './models/ChatMessage.js';
import ConnectionRequest from './models/ConnectionRequest.js';
import User from './models/User.js';
import { sendMail } from './utils/email.js';

// Online users map: userId (string) → socketId
const onlineUsers = new Map();

// Session presence: requestId → { userId, userName, userRole }
// Persists across socket reconnects so latecomers are notified immediately on connect
const sessionPresence = new Map();

let _io = null;

export function setupSocket(httpServer) {
  const allowedOrigins = [
    'http://localhost:5000',
    'http://localhost:5173',
    'http://localhost:4173',
    process.env.APP_URL,
  ].filter(Boolean);

  _io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  // Authenticate every socket connection with the JWT token
  // Note: the JWT only carries { id } (see auth.js signToken), so role/name
  // must be looked up from the DB — they are not present on the decoded token.
  _io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('fullName role').lean();
      if (!user) return next(new Error('User not found'));
      socket.userId   = decoded.id;
      socket.userRole = user.role;
      socket.userName = user.fullName;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  _io.on('connection', async (socket) => {
    const uid = socket.userId;
    onlineUsers.set(uid, socket.id);
    console.log(`  ↑ Socket: ${socket.userName || uid} (${socket.userRole}) online`);

    // On connect: check if any session peer is already waiting in a room for this user
    // so we fire session_peer_joined immediately — even if they just came online
    try {
      const conns = await ConnectionRequest.find({
        $or: [{ mentor: uid }, { mentee: uid }],
        status: 'accepted',
      }).select('_id').lean();

      for (const conn of conns) {
        const reqId    = conn._id.toString();
        const presence = sessionPresence.get(reqId);
        if (!presence || presence.userId === uid) continue;
        // A peer is waiting in this session — notify immediately
        socket.emit('session_peer_joined', {
          requestId: reqId,
          userName:  presence.userName,
          userRole:  presence.userRole,
        });
      }
    } catch (_) { /* non-critical */ }

    // ── Chat room management ──────────────────────────────
    socket.on('join_chat_room', ({ connectionId }) => {
      socket.join(`chat-${connectionId}`);
    });
    socket.on('leave_chat_room', ({ connectionId }) => {
      socket.leave(`chat-${connectionId}`);
    });

    // ── Send chat message ─────────────────────────────────
    socket.on('send_chat_message', async ({ connectionId, text }) => {
      if (!text?.trim() || !connectionId) return;
      try {
        // Verify the sender is a participant
        const conn = await ConnectionRequest.findOne({
          _id:    connectionId,
          status: 'accepted',
          $or:    [{ mentor: uid }, { mentee: uid }],
        }).lean();
        if (!conn) return;

        const msg = await ChatMessage.create({
          connection: connectionId,
          sender:     uid,
          text:       text.trim(),
          readBy:     [uid],
        });

        const payload = {
          messageId:    msg._id.toString(),
          connectionId,
          senderId:     uid,
          senderName:   socket.userName,
          text:         msg.text,
          createdAt:    msg.createdAt,
        };

        // Broadcast to everyone in the room (including sender)
        _io.to(`chat-${connectionId}`).emit('chat_message', payload);

        // If recipient is online but not in this chat room, send a notification
        const recipientId = conn.mentor.toString() === uid
          ? conn.mentee.toString()
          : conn.mentor.toString();
        if (onlineUsers.has(recipientId)) {
          const recipientSid = onlineUsers.get(recipientId);
          const sockets = await _io.in(recipientSid).fetchSockets().catch(() => []);
          const inRoom  = sockets.some(s => s.rooms.has(`chat-${connectionId}`));
          if (!inRoom) {
            _io.to(recipientSid).emit('chat_notification', {
              connectionId,
              senderName: socket.userName,
              text:       msg.text,
            });
          }
        }
      } catch (err) {
        console.error('Socket send_chat_message error:', err.message);
      }
    });

    // ── Typing indicators ─────────────────────────────────
    socket.on('typing_start', ({ connectionId }) => {
      socket.to(`chat-${connectionId}`).emit('typing_start', { userId: uid, name: socket.userName });
    });
    socket.on('typing_stop', ({ connectionId }) => {
      socket.to(`chat-${connectionId}`).emit('typing_stop', { userId: uid });
    });

    // ── Whiteboard sync ───────────────────────────────────
    socket.on('whiteboard_draw', ({ connectionId, x0, y0, x1, y1, color, size }) => {
      socket.to(`chat-${connectionId}`).emit('whiteboard_draw', { x0, y0, x1, y1, color, size });
    });
    socket.on('whiteboard_clear', ({ connectionId }) => {
      socket.to(`chat-${connectionId}`).emit('whiteboard_clear');
    });
    socket.on('whiteboard_text', ({ connectionId, x, y, text, color, size }) => {
      socket.to(`chat-${connectionId}`).emit('whiteboard_text', { x, y, text, color, size });
    });

    // ── WebRTC signalling ─────────────────────────────────
    // First peer to join waits; second peer's arrival triggers offer creation
    socket.on('webrtc_join', ({ connectionId }) => {
      const room = `webrtc-${connectionId}`;
      socket.join(room);
      // Tell the existing peer (if any) that someone new arrived → they create the offer
      socket.to(room).emit('webrtc_peer_joined');
    });

    socket.on('webrtc_offer', ({ connectionId, offer }) => {
      socket.to(`webrtc-${connectionId}`).emit('webrtc_offer', { offer });
    });

    socket.on('webrtc_answer', ({ connectionId, answer }) => {
      socket.to(`webrtc-${connectionId}`).emit('webrtc_answer', { answer });
    });

    socket.on('webrtc_ice', ({ connectionId, candidate }) => {
      socket.to(`webrtc-${connectionId}`).emit('webrtc_ice', { candidate });
    });

    socket.on('webrtc_leave', ({ connectionId }) => {
      socket.to(`webrtc-${connectionId}`).emit('webrtc_peer_left');
      socket.leave(`webrtc-${connectionId}`);
    });

    // ── Session presence (join / leave) ──────────────────
    // When a user opens session.html, they announce their presence.
    // We look up the connection to find the other participant and emit
    // directly to their socket so the dashboard receives it in real-time.
    socket.on('announce_session_presence', async ({ requestId }) => {
      if (!requestId) return;
      if (!socket._sessionRooms) socket._sessionRooms = new Set();
      socket._sessionRooms.add(requestId);

      // Persist this user's presence so latecomers are notified when they connect
      sessionPresence.set(requestId, {
        userId:   uid,
        userName: socket.userName,
        userRole: socket.userRole,
      });

      try {
        const conn = await ConnectionRequest.findById(requestId)
          .select('mentor mentee')
          .lean();
        if (!conn) return;

        const otherUserId = conn.mentor.toString() === uid
          ? conn.mentee.toString()
          : conn.mentor.toString();

        const otherSid = onlineUsers.get(otherUserId);

        if (otherSid) {
          // Other party is online — notify them instantly
          _io.to(otherSid).emit('session_peer_joined', {
            requestId,
            userName: socket.userName,
            userRole: socket.userRole,
          });
        } else {
          // Other party is offline — send them an email
          try {
            const otherUser = await User.findById(otherUserId).select('email fullName').lean();
            if (otherUser?.email) {
              const joinerRole = socket.userRole === 'mentor' ? 'Mentor' : 'Mentee';
              const sessionUrl = `${process.env.APP_URL || 'http://localhost:5000'}/session.html?requestId=${requestId}`;
              await sendMail({
                to:      otherUser.email,
                subject: `${socket.userName} has joined your session room`,
                html: `
                  <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:32px;background:#0a0a08;color:#fff;border-radius:12px;">
                    <h2 style="color:#4ade80;font-family:Georgia,serif;margin-bottom:8px;">🟢 Your ${joinerRole} is in the session room!</h2>
                    <p style="color:#ccc;">Hi <strong style="color:#fff;">${otherUser.fullName}</strong>,</p>
                    <p style="color:#ccc;">
                      <strong style="color:#fff;">${socket.userName}</strong> has joined the session room and is waiting for you.
                    </p>
                    <div style="margin:28px 0;">
                      <a href="${sessionUrl}"
                         style="background:#4ade80;color:#000;padding:13px 28px;border-radius:8px;
                                text-decoration:none;display:inline-block;font-weight:700;font-size:15px;">
                        Join Session Now →
                      </a>
                    </div>
                    <p style="color:#666;font-size:12px;">If you can't join right now, they'll wait in the session room.</p>
                    <hr style="border:none;border-top:1px solid #222;margin:24px 0;" />
                    <p style="color:#444;font-size:11px;">Father's Advice — Mentorship Platform</p>
                  </div>`,
              });
              console.log(`  ✉  Session join email sent to ${otherUser.email} (peer offline)`);
            }
          } catch (mailErr) {
            console.error('  ✉  Session join email failed:', mailErr.message);
          }
        }
      } catch (err) {
        console.error('announce_session_presence error:', err.message);
      }
    });

    // One party ended the session — tell the other party to show their feedback modal
    socket.on('session_ended_notify', async ({ requestId }) => {
      if (!requestId) return;
      try {
        const conn = await ConnectionRequest.findById(requestId)
          .select('mentor mentee')
          .lean();
        if (!conn) return;
        const otherUserId = conn.mentor.toString() === uid
          ? conn.mentee.toString()
          : conn.mentor.toString();
        const otherSid = onlineUsers.get(otherUserId);
        if (otherSid) {
          _io.to(otherSid).emit('session_ended_by_peer', { requestId });
        }
      } catch (err) {
        console.error('session_ended_notify error:', err.message);
      }
    });

    socket.on('leave_session_presence', async ({ requestId }) => {
      if (!requestId) return;
      socket._sessionRooms?.delete(requestId);
      // Clear persistent presence so the "waiting" notification is not re-sent
      if (sessionPresence.get(requestId)?.userId === uid) {
        sessionPresence.delete(requestId);
      }

      try {
        const conn = await ConnectionRequest.findById(requestId)
          .select('mentor mentee')
          .lean();
        if (!conn) return;

        const otherUserId = conn.mentor.toString() === uid
          ? conn.mentee.toString()
          : conn.mentor.toString();

        const otherSid = onlineUsers.get(otherUserId);
        if (otherSid) {
          _io.to(otherSid).emit('session_peer_left', {
            requestId,
            userName: socket.userName,
          });
        }
      } catch (err) {
        console.error('leave_session_presence error:', err.message);
      }
    });

    socket.on('disconnect', async () => {
      onlineUsers.delete(uid);
      // Clear any session presence this user held
      for (const [reqId, presence] of sessionPresence.entries()) {
        if (presence.userId === uid) sessionPresence.delete(reqId);
      }
      // Notify the other participant for every active session presence
      if (socket._sessionRooms && socket._sessionRooms.size > 0) {
        for (const requestId of socket._sessionRooms) {
          try {
            const conn = await ConnectionRequest.findById(requestId)
              .select('mentor mentee')
              .lean();
            if (!conn) continue;
            const otherUserId = conn.mentor.toString() === uid
              ? conn.mentee.toString()
              : conn.mentor.toString();
            const otherSid = onlineUsers.get(otherUserId);
            if (otherSid) {
              _io.to(otherSid).emit('session_peer_left', {
                requestId,
                userName: socket.userName,
              });
            }
          } catch (_) {}
        }
      }
      console.log(`  ↓ Socket: ${socket.userName || uid} offline`);
    });
  });

  return _io;
}

export function getIO()    { return _io; }
export { onlineUsers };
