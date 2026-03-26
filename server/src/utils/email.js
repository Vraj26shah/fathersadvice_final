import nodemailer from 'nodemailer';

// Lazily create transporter so missing config doesn't crash at startup
function getTransporter() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: (process.env.EMAIL_USER || '').trim(),
      pass: (process.env.EMAIL_PASS || '').replace(/\s/g, ''), // strip spaces (Google shows them grouped)
    },
    tls: { rejectUnauthorized: false },
  });
}

/**
 * Send an email.  No-ops if EMAIL_USER is not configured.
 */
export async function sendMail({ to, subject, html }) {
  const user = (process.env.EMAIL_USER || '').trim();
  const pass = (process.env.EMAIL_PASS || '').replace(/\s/g, '');
  if (!user || !pass || user === 'your-email@gmail.com') {
    const err = new Error('EMAIL_USER or EMAIL_PASS is not configured in environment variables.');
    console.error('  ✉  ' + err.message);
    throw err;
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
    console.error(`  ✉  Email failed to ${to}:`);
    console.error(`     Code: ${err.code}`);
    console.error(`     Message: ${err.message}`);
    if (err.responseCode) console.error(`     SMTP Response: ${err.responseCode} ${err.response}`);
    throw err;
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

export function emailOtpVerification({ otp }) {
  return `
  <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:36px;background:#0a0a08;color:#ffffff;border-radius:12px;">
    <div style="text-align:center;margin-bottom:28px;">
      <h2 style="font-family:Georgia,serif;color:#5e6ad2;font-size:22px;margin:0 0 6px;">Verify your email</h2>
      <p style="color:#888;font-size:13px;margin:0;">Father's Advice</p>
    </div>
    <p style="color:#ccc;font-size:14px;line-height:1.7;margin-bottom:28px;">
      Enter the following code to complete your registration. This code is valid for <strong style="color:#fff;">10 minutes</strong>.
    </p>
    <div style="background:#1a1a17;border:1px solid rgba(94,106,210,0.35);border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
      <div style="font-size:40px;font-weight:700;letter-spacing:14px;color:#5e6ad2;font-family:monospace;">${otp}</div>
    </div>
    <p style="color:#555;font-size:12px;line-height:1.6;">
      If you did not request this, you can safely ignore this email.
    </p>
    <hr style="border:none;border-top:1px solid #1e1e1a;margin:24px 0;" />
    <p style="color:#333;font-size:11px;">Father's Advice — Mentorship Platform</p>
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
