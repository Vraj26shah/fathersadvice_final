import nodemailer from 'nodemailer';

// Lazily create transporter so missing config doesn't crash at startup
function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

/**
 * Send an email.  No-ops if EMAIL_USER is not configured.
 */
export async function sendMail({ to, subject, html }) {
  const user = process.env.EMAIL_USER;
  if (!user || user === 'your-email@gmail.com') {
    console.log(`  ✉  [Email not configured — skipped]  To: ${to}  |  ${subject}`);
    return { skipped: true };
  }
  try {
    const info = await getTransporter().sendMail({
      from:    `"Father's Advice" <${user}>`,
      to,
      subject,
      html,
    });
    console.log(`  ✉  Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error(`  ✉  Email failed to ${to}:`, err.message);
    return { error: err.message };
  }
}

// ── Email templates ──────────────────────────────────────────────

export function emailAccepted({ menteeName, mentorName, sessionUrl }) {
  return `
  <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:32px;background:#0a0a08;color:#ffffff;border-radius:12px;">
    <h2 style="color:#5e6ad2;font-family:Georgia,serif;margin-bottom:8px;">🎉 Your mentor request was accepted!</h2>
    <p style="color:#ccc;">Hi <strong style="color:#fff;">${menteeName}</strong>,</p>
    <p style="color:#ccc;">
      <strong style="color:#fff;">${mentorName}</strong> has accepted your mentorship request on Father's Advice.
      You can now join your live session together.
    </p>
    <div style="margin:28px 0;">
      <a href="${sessionUrl}"
         style="background:#5e6ad2;color:#ffffff;padding:13px 28px;border-radius:8px;
                text-decoration:none;display:inline-block;font-weight:700;font-size:15px;">
        Join Session Now →
      </a>
    </div>
    <p style="color:#666;font-size:12px;">
      If you can't join right now, log in to Father's Advice and click <em>My Sessions</em> to find the session at any time.
    </p>
    <hr style="border:none;border-top:1px solid #222;margin:24px 0;" />
    <p style="color:#444;font-size:11px;">Father's Advice — Mentorship Platform</p>
  </div>`;
}

export function emailSessionScheduled({ recipientName, proposerName, proposerRole, scheduledTime, sessionUrl, notes }) {
  return `
  <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:32px;background:#0a0a08;color:#ffffff;border-radius:12px;">
    <h2 style="color:#5e6ad2;font-family:Georgia,serif;margin-bottom:8px;">📅 Session Scheduled</h2>
    <p style="color:#ccc;">Hi <strong style="color:#fff;">${recipientName}</strong>,</p>
    <p style="color:#ccc;">
      Your ${proposerRole} <strong style="color:#fff;">${proposerName}</strong> has scheduled a session with you.
    </p>
    <div style="background:#1a1a18;border:1px solid #333;border-radius:10px;padding:20px;margin:20px 0;">
      <p style="color:#fff;font-size:16px;margin:0 0 8px;">🗓 <strong>${scheduledTime}</strong></p>
      ${notes ? `<p style="color:#aaa;font-size:13px;margin:0;">📝 ${notes}</p>` : ''}
    </div>
    <div style="margin:24px 0;display:flex;gap:12px;">
      <a href="${sessionUrl}?confirm=1"
         style="background:#5e6ad2;color:#ffffff;padding:11px 22px;border-radius:8px;
                text-decoration:none;display:inline-block;font-weight:700;font-size:14px;">
        ✓ Confirm Session
      </a>
    </div>
    <p style="color:#666;font-size:12px;">
      Log in to Father's Advice to view or reschedule your session.
    </p>
    <hr style="border:none;border-top:1px solid #222;margin:24px 0;" />
    <p style="color:#444;font-size:11px;">Father's Advice — Mentorship Platform</p>
  </div>`;
}

export function emailSessionConfirmed({ recipientName, otherName, scheduledTime, sessionUrl }) {
  return `
  <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:32px;background:#0a0a08;color:#ffffff;border-radius:12px;">
    <h2 style="color:#4ade80;font-family:Georgia,serif;margin-bottom:8px;">✅ Session Confirmed!</h2>
    <p style="color:#ccc;">Hi <strong style="color:#fff;">${recipientName}</strong>,</p>
    <p style="color:#ccc;">
      Your session with <strong style="color:#fff;">${otherName}</strong> is confirmed.
    </p>
    <div style="background:#1a1a18;border:1px solid #333;border-radius:10px;padding:20px;margin:20px 0;">
      <p style="color:#fff;font-size:16px;margin:0;">🗓 <strong>${scheduledTime}</strong></p>
    </div>
    <div style="margin:24px 0;">
      <a href="${sessionUrl}"
         style="background:#4ade80;color:#000000;padding:11px 22px;border-radius:8px;
                text-decoration:none;display:inline-block;font-weight:700;font-size:14px;">
        Join at Scheduled Time →
      </a>
    </div>
    <hr style="border:none;border-top:1px solid #222;margin:24px 0;" />
    <p style="color:#444;font-size:11px;">Father's Advice — Mentorship Platform</p>
  </div>`;
}

// ── Reminder templates ───────────────────────────────────────────

export function emailMorningReminder({ recipientName, otherName, otherRole, scheduledTime, sessionUrl, notes, durationMins }) {
  return `
  <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:32px;background:#0a0a08;color:#ffffff;border-radius:12px;">
    <h2 style="color:#c8a84b;font-family:Georgia,serif;margin-bottom:8px;">☀️ You have a session today!</h2>
    <p style="color:#ccc;">Good morning, <strong style="color:#fff;">${recipientName}</strong>!</p>
    <p style="color:#ccc;">
      You have a mentoring session with your ${otherRole} <strong style="color:#fff;">${otherName}</strong> scheduled for today.
    </p>
    <div style="background:#1a1a18;border:1px solid #333;border-radius:10px;padding:20px;margin:20px 0;">
      <p style="color:#fff;font-size:16px;margin:0 0 8px;">🗓 <strong>${scheduledTime}</strong></p>
      <p style="color:#aaa;font-size:13px;margin:0;">⏱ ${durationMins} minutes${notes ? ` &nbsp;|&nbsp; 📝 ${notes}` : ''}</p>
    </div>
    <div style="margin:24px 0;">
      <a href="${sessionUrl}"
         style="background:#c8a84b;color:#000000;padding:12px 26px;border-radius:8px;
                text-decoration:none;display:inline-block;font-weight:700;font-size:15px;">
        Open Session Room →
      </a>
    </div>
    <p style="color:#666;font-size:12px;">Make sure your camera and microphone are ready before the session starts.</p>
    <hr style="border:none;border-top:1px solid #222;margin:24px 0;" />
    <p style="color:#444;font-size:11px;">Father's Advice — Mentorship Platform</p>
  </div>`;
}

export function emailHourReminder({ recipientName, otherName, otherRole, scheduledTime, sessionUrl, durationMins, minutesAway }) {
  return `
  <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:32px;background:#0a0a08;color:#ffffff;border-radius:12px;">
    <h2 style="color:#5e6ad2;font-family:Georgia,serif;margin-bottom:8px;">⏰ Session starting in ${minutesAway} minutes!</h2>
    <p style="color:#ccc;">Hi <strong style="color:#fff;">${recipientName}</strong>,</p>
    <p style="color:#ccc;">
      Your session with ${otherRole} <strong style="color:#fff;">${otherName}</strong> starts in about <strong style="color:#5e6ad2;">${minutesAway} minutes</strong>.
    </p>
    <div style="background:#1a1a18;border:1px solid #5e6ad2;border-radius:10px;padding:20px;margin:20px 0;">
      <p style="color:#fff;font-size:16px;margin:0 0 6px;">🗓 <strong>${scheduledTime}</strong></p>
      <p style="color:#aaa;font-size:13px;margin:0;">⏱ ${durationMins} minutes</p>
    </div>
    <div style="margin:24px 0;">
      <a href="${sessionUrl}"
         style="background:#5e6ad2;color:#ffffff;padding:12px 26px;border-radius:8px;
                text-decoration:none;display:inline-block;font-weight:700;font-size:15px;">
        Join Session Now →
      </a>
    </div>
    <p style="color:#666;font-size:12px;">The session room will be ready and waiting for you.</p>
    <hr style="border:none;border-top:1px solid #222;margin:24px 0;" />
    <p style="color:#444;font-size:11px;">Father's Advice — Mentorship Platform</p>
  </div>`;
}
