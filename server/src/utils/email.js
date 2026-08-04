import nodemailer from 'nodemailer';
import { google } from 'googleapis';

// Mail always leaves from the real GMAIL_USER mailbox, so there's no domain to
// verify and any recipient can be emailed. Two ways to reach Gmail, picked
// automatically:
//
//   Gmail API (preferred) — gmail.googleapis.com over HTTPS on port 443.
//     Required on hosts that block outbound SMTP: Render's free tier blocks
//     ports 25/465/587, which is why raw SMTP times out in that deploy while
//     working perfectly on a local machine.
//     Needs GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET + GMAIL_REFRESH_TOKEN.
//
//   SMTP (fallback) — Gmail address + App Password. Simplest to configure, and
//     fine locally or on any host that permits outbound SMTP.
const gmailUser         = () => (process.env.GMAIL_USER || '').trim();
const oauthClientId     = () => (process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
const oauthClientSecret = () => (process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_SECRET_ID || '').trim();
const oauthRefreshToken = () => (process.env.GMAIL_REFRESH_TOKEN || '').trim();
const gmailAppPassword  = () => (process.env.GMAIL_APP_PASSWORD || '').replace(/\s/g, '');

export function isOAuthConfigured() {
  return Boolean(gmailUser() && oauthClientId() && oauthClientSecret() && oauthRefreshToken());
}

export function isSmtpConfigured() {
  return Boolean(gmailUser() && gmailAppPassword());
}

export function isEmailConfigured() {
  return isOAuthConfigured() || isSmtpConfigured();
}

function fromHeader() {
  return (process.env.EMAIL_FROM || `Father's Advice <${gmailUser()}>`).trim();
}

// ── Gmail API transport (HTTPS) ──────────────────────────────────
let gmailClient = null;
function getGmailClient() {
  if (!gmailClient) {
    // No redirect URI needed: the refresh token was already granted offline, and
    // the client exchanges it for short-lived access tokens on demand.
    const auth = new google.auth.OAuth2(oauthClientId(), oauthClientSecret());
    auth.setCredentials({ refresh_token: oauthRefreshToken() });
    gmailClient = google.gmail({ version: 'v1', auth });
  }
  return gmailClient;
}

// An RFC 2822 message, base64url-encoded the way the Gmail API expects. Subject
// and body are explicitly UTF-8 encoded so accents and emoji survive intact.
function buildRawMessage({ to, subject, html }) {
  const headers = [
    `From: ${fromHeader()}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].join('\r\n');
  const body = Buffer.from(html, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return Buffer.from(`${headers}\r\n\r\n${body}`, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function describeGoogleError(error) {
  return error?.response?.data?.error_description
      || error?.response?.data?.error?.message
      || error?.errors?.[0]?.message
      || error.message;
}

// ── SMTP transport ───────────────────────────────────────────────
const transporters = new Map();
function getTransporter(port = 465) {
  if (!transporters.has(port)) {
    transporters.set(port, nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: {
        user: gmailUser(),
        pass: gmailAppPassword(),
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    }));
  }
  return transporters.get(port);
}

export async function verifyEmailTransport() {
  if (!isEmailConfigured()) {
    console.error('  [Email] No Gmail credentials found. Set GMAIL_CLIENT_ID + GMAIL_CLIENT_SECRET');
    console.error('          + GMAIL_REFRESH_TOKEN (Gmail API), or GMAIL_APP_PASSWORD (SMTP).');
    console.error('          OTP email is disabled until one of those is configured.');
    return false;
  }

  if (isOAuthConfigured()) {
    try {
      const profile = await getGmailClient().users.getProfile({ userId: 'me' });
      console.log(`  [Email] Gmail API ready (HTTPS) as ${profile.data.emailAddress}.`);
      return true;
    } catch (error) {
      console.error(`  [Email] Gmail API verification failed: ${describeGoogleError(error)}`);
      if (!isSmtpConfigured()) return false;
      console.warn('  [Email] Falling back to SMTP for verification.');
    }
  }

  try {
    const primaryPort = process.env.NODE_ENV === 'production' ? 587 : 465;
    const fallbackPort = primaryPort === 465 ? 587 : 465;
    try {
      await getTransporter(primaryPort).verify();
      console.log(`  [Email] Gmail SMTP connection verified on port ${primaryPort}.`);
    } catch (primaryError) {
      console.warn(`  [Email] Gmail SMTP port ${primaryPort} unavailable: ${primaryError.message}. Trying port ${fallbackPort}.`);
      await getTransporter(fallbackPort).verify();
      console.log(`  [Email] Gmail SMTP connection verified on port ${fallbackPort}.`);
    }
    return true;
  } catch (error) {
    console.error(`  [Email] Gmail SMTP verification failed: ${error.message}`);
    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKET') {
      console.error('          ↳ Outbound SMTP looks blocked by the host (Render free tier');
      console.error('            blocks 25/465/587). Configure the Gmail API vars instead.');
    }
    return false;
  }
}

/**
 * Send an email from the GMAIL_USER mailbox — via the Gmail API when OAuth is
 * configured, otherwise over SMTP. Throws if no transport is configured, or if
 * every configured transport fails.
 */
export async function sendMail({ to, subject, html }) {
  if (!isEmailConfigured()) {
    const err = new Error('No Gmail transport configured: set GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN, or GMAIL_APP_PASSWORD.');
    console.error('  ✉  ' + err.message);
    throw err;
  }

  if (isOAuthConfigured()) {
    try {
      const res = await getGmailClient().users.messages.send({
        userId: 'me',
        requestBody: { raw: buildRawMessage({ to, subject, html }) },
      });
      console.log(`  ✉  Email sent to ${to} via Gmail API: ${res.data.id}`);
      return res.data;
    } catch (error) {
      const detail = describeGoogleError(error);
      console.error(`  ✉  Gmail API send failed to ${to}: ${detail}`);
      if (!isSmtpConfigured()) {
        const err = new Error(detail || 'Failed to send email.');
        err.code = error.code;
        throw err;
      }
      console.warn('     ↳ Falling back to SMTP.');
    }
  }

  const from = fromHeader();
  try {
    const primaryPort = process.env.NODE_ENV === 'production' ? 587 : 465;
    const fallbackPort = primaryPort === 465 ? 587 : 465;
    let info;
    try {
      info = await getTransporter(primaryPort).sendMail({ from, to, subject, html });
    } catch (primaryError) {
      // Some hosting networks permit submission on 587 but not implicit TLS on
      // 465. Gmail supports both, so retry once before reporting a failure.
      console.warn(`  [Email] Gmail SMTP port ${primaryPort} failed: ${primaryError.message}. Retrying port ${fallbackPort}.`);
      info = await getTransporter(fallbackPort).sendMail({ from, to, subject, html });
    }
    console.log(`  ✉  Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`  ✉  Email failed to ${to}: ${error.message}`);
    const err = new Error(error.message || 'Failed to send email.');
    err.code = error.code;
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
