import cron from 'node-cron';
import ScheduledSession from '../models/ScheduledSession.js';
import { sendMail, emailMorningReminder, emailHourReminder } from '../utils/email.js';

const BASE_URL = process.env.APP_URL || 'http://localhost:5000';

function fmt(date) {
  return new Date(date).toLocaleString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZoneName: 'short',
  });
}

// ── Auto-complete sessions whose time + duration has passed ──────
async function autoCompletePastSessions() {
  try {
    const now = new Date();
    const sessions = await ScheduledSession.find({
      status: 'confirmed',
      scheduledTime: { $lt: now },
    }).lean();

    for (const s of sessions) {
      const endTime = new Date(s.scheduledTime.getTime() + s.durationMins * 60 * 1000);
      if (endTime < now) {
        await ScheduledSession.findByIdAndUpdate(s._id, { status: 'completed' });
        console.log(`  ✓ Auto-completed session ${s._id}`);
      }
    }
  } catch (err) {
    console.error('Auto-complete error:', err.message);
  }
}

// ── Morning reminder — fires at 00:00 every day ──────────────────
async function sendMorningReminders() {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const sessions = await ScheduledSession.find({
      scheduledTime:       { $gte: todayStart, $lte: todayEnd },
      status:              { $in: ['confirmed', 'proposed'] },
      morningReminderSent: false,
    })
      .populate('mentor', 'fullName email')
      .populate('mentee', 'fullName email');

    for (const s of sessions) {
      const sessionUrl = `${BASE_URL}/session.html?requestId=${s.request}`;
      const timeStr    = fmt(s.scheduledTime);

      await Promise.all([
        sendMail({
          to:      s.mentor.email,
          subject: `☀️ Reminder: You have a session today — ${timeStr}`,
          html:    emailMorningReminder({
            recipientName: s.mentor.fullName,
            otherName:     s.mentee.fullName,
            otherRole:     'mentee',
            scheduledTime: timeStr,
            sessionUrl,
            notes:         s.notes,
            durationMins:  s.durationMins,
          }),
        }),
        sendMail({
          to:      s.mentee.email,
          subject: `☀️ Reminder: You have a session today — ${timeStr}`,
          html:    emailMorningReminder({
            recipientName: s.mentee.fullName,
            otherName:     s.mentor.fullName,
            otherRole:     'mentor',
            scheduledTime: timeStr,
            sessionUrl,
            notes:         s.notes,
            durationMins:  s.durationMins,
          }),
        }),
      ]);

      s.morningReminderSent = true;
      await s.save();
      console.log(`  ✉  Morning reminder sent for session ${s._id}`);
    }
  } catch (err) {
    console.error('Morning reminder error:', err.message);
  }
}

// ── 1-hour reminder — checked every 5 minutes ───────────────────
async function sendHourReminders() {
  try {
    const now     = new Date();
    // Window: sessions starting between 55 and 65 minutes from now
    const winStart = new Date(now.getTime() + 55 * 60 * 1000);
    const winEnd   = new Date(now.getTime() + 65 * 60 * 1000);

    const sessions = await ScheduledSession.find({
      scheduledTime:    { $gte: winStart, $lte: winEnd },
      status:           { $in: ['confirmed', 'proposed'] },
      hourReminderSent: false,
    })
      .populate('mentor', 'fullName email')
      .populate('mentee', 'fullName email');

    for (const s of sessions) {
      const sessionUrl   = `${BASE_URL}/session.html?requestId=${s.request}`;
      const timeStr      = fmt(s.scheduledTime);
      const minutesAway  = Math.round((new Date(s.scheduledTime) - now) / 60000);

      await Promise.all([
        sendMail({
          to:      s.mentor.email,
          subject: `⏰ Your session starts in ~${minutesAway} min — Father's Advice`,
          html:    emailHourReminder({
            recipientName: s.mentor.fullName,
            otherName:     s.mentee.fullName,
            otherRole:     'mentee',
            scheduledTime: timeStr,
            sessionUrl,
            durationMins:  s.durationMins,
            minutesAway,
          }),
        }),
        sendMail({
          to:      s.mentee.email,
          subject: `⏰ Your session starts in ~${minutesAway} min — Father's Advice`,
          html:    emailHourReminder({
            recipientName: s.mentee.fullName,
            otherName:     s.mentor.fullName,
            otherRole:     'mentor',
            scheduledTime: timeStr,
            sessionUrl,
            durationMins:  s.durationMins,
            minutesAway,
          }),
        }),
      ]);

      s.hourReminderSent = true;
      await s.save();
      console.log(`  ✉  1-hour reminder sent for session ${s._id}`);
    }
  } catch (err) {
    console.error('Hour reminder error:', err.message);
  }
}

// ── Start all cron jobs ──────────────────────────────────────────
export function startReminderJobs() {
  // Morning reminder — every day at 00:00
  cron.schedule('0 0 * * *', () => {
    console.log('  ⏰ Cron: sending morning reminders…');
    sendMorningReminders();
  }, { timezone: 'Asia/Kolkata' });

  // 1-hour reminder check — every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    sendHourReminders();
  });

  // Auto-complete past sessions — every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    autoCompletePastSessions();
  });

  console.log('  ✓ Reminder cron jobs started');
}
