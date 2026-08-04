/**
 * One-time helper: mints a Gmail API refresh token for the sending mailbox.
 *
 *   node scripts/get-gmail-refresh-token.js
 *
 * Prerequisites in Google Cloud Console (same project as your Sign-In client):
 *   1. APIs & Services → Library → enable "Gmail API".
 *   2. APIs & Services → Credentials → an OAuth 2.0 Client ID of type
 *      "Web application", with this exact Authorised redirect URI:
 *          http://localhost:53682/oauth2callback
 *   3. Put that client's ID and secret in server/.env as
 *      GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.
 *
 * Sign in as GMAIL_USER when the browser opens — the refresh token is bound to
 * whichever account grants consent, and that mailbox is what mail is sent from.
 */
import 'dotenv/config';
import http from 'http';
import { google } from 'googleapis';

const PORT         = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPES       = ['https://www.googleapis.com/auth/gmail.send'];

const clientId     = (process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
const clientSecret = (process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_SECRET_ID || '').trim();

if (!clientId || !clientSecret) {
  console.error('\n  ✗ GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in server/.env first.\n');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

// access_type=offline is what makes Google return a refresh token at all, and
// prompt=consent forces a fresh one even if this account consented before.
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt:      'consent',
  scope:       SCOPES,
});

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.writeHead(404).end('Not found');
    return;
  }

  const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
  const error  = params.get('error');
  const code   = params.get('code');

  if (error || !code) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
       .end(`Authorisation failed: ${error || 'no code returned'}`);
    console.error(`\n  ✗ Authorisation failed: ${error || 'no code returned'}\n`);
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
       .end('<h2>Done.</h2><p>Refresh token issued — return to your terminal.</p>');

    if (!tokens.refresh_token) {
      console.error('\n  ✗ Google did not return a refresh token.');
      console.error('    Remove this app at https://myaccount.google.com/permissions and retry.\n');
      server.close();
      process.exit(1);
    }

    console.log('\n  ✓ Success. Add this line to server/.env and to your Render environment:\n');
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Token exchange failed.');
    console.error(`\n  ✗ Token exchange failed: ${err.message}\n`);
    process.exit(1);
  } finally {
    server.close();
  }
});

server.listen(PORT, () => {
  console.log('\n  Open this URL in your browser and grant access:\n');
  console.log(`  ${authUrl}\n`);
  console.log(`  Waiting for the redirect to ${REDIRECT_URI} …\n`);
});
