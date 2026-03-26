import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import ChatMessage from './models/ChatMessage.js';
import ConnectionRequest from './models/ConnectionRequest.js';

// Online users map: userId (string) → socketId
const onlineUsers = new Map();
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
  _io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId   = decoded.id;
      socket.userRole = decoded.role;
      socket.userName = decoded.name || decoded.fullName;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  _io.on('connection', (socket) => {
    const uid = socket.userId;
    onlineUsers.set(uid, socket.id);
    console.log(`  ↑ Socket: ${socket.userName || uid} (${socket.userRole}) online`);

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
      // Track which sessions this socket is present in (for disconnect cleanup)
      if (!socket._sessionRooms) socket._sessionRooms = new Set();
      socket._sessionRooms.add(requestId);

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
          _io.to(otherSid).emit('session_peer_joined', {
            requestId,
            userName: socket.userName,
            userRole: socket.userRole,
          });
        }
      } catch (err) {
        console.error('announce_session_presence error:', err.message);
      }
    });

    socket.on('leave_session_presence', async ({ requestId }) => {
      if (!requestId) return;
      socket._sessionRooms?.delete(requestId);

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
