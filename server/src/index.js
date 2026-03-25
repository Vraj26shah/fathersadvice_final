import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import connectDB from './config/db.js';
import { setupSocket } from './socket.js';
import { startReminderJobs } from './jobs/reminders.js';
import authRoutes from './routes/auth.js';
import connectRoutes from './routes/connect.js';
import sessionsRoutes from './routes/sessions.js';
import chatRoutes    from './routes/chat.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const CLIENT_DIR = path.join(__dirname, '../../client');

connectDB();

const app    = express();
const server = http.createServer(app);

// ── Socket.io (must init before routes that use getIO()) ────────
setupSocket(server);

// ── Middleware ──────────────────────────────────────────────────
app.use(cors({
  origin: [
    'http://localhost:5000',
    'http://localhost:5173',
    'http://localhost:4173',
  ],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// ── Static files ────────────────────────────────────────────────
app.use(express.static(CLIENT_DIR));

// ── API Routes ──────────────────────────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/connect',  connectRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/chat',    chatRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', message: "Father's Advice API is running" });
});

// ── Fallback ────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n  ✓ App running at  http://localhost:${PORT}`);
  console.log(`  ✓ API available at http://localhost:${PORT}/api`);
  console.log(`  ✓ Socket.io ready`);
  startReminderJobs();
});
