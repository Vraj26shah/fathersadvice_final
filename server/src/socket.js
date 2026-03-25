import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import ChatMessage from './models/ChatMessage.js';
import ConnectionRequest from './models/ConnectionRequest.js';

// Online users map: userId (string) → socketId
const onlineUsers = new Map();
let _io = null;

export function setupSocket(httpServer) {
  _io = new Server(httpServer, {
    cors: {
      origin: [
        'http://localhost:5000',
        'http://localhost:5173',
        'http://localhost:4173',
      ],
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

    socket.on('disconnect', () => {
      onlineUsers.delete(uid);
      console.log(`  ↓ Socket: ${socket.userName || uid} offline`);
    });
  });

  return _io;
}

export function getIO()    { return _io; }
export { onlineUsers };
