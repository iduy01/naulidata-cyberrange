/**
 * PT Nauli Mula Data — Cyber Range Engineering Assessment
 * Scenario "Cookies Reuse & MFA Bypass"
 *
 * Vulnerable Node.js application: "Admin Feedback System"
 * INTENTIONALLY VULNERABLE — training lab only. Never expose to the internet.
 */

'use strict';

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.disable('x-powered-by');

const PORT = parseInt(process.env.PORT || '3075', 10);
const LOG_DIR = process.env.LOG_DIR || '/opt/admin/logs';
const ACCESS_LOG = path.join(LOG_DIR, 'access.log');
const ERROR_LOG = path.join(LOG_DIR, 'error.log');

// ---- Lab credentials (documented in README — this is a training lab) ----
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Adm1n@Feedback2026';
const MFA_CODE = process.env.MFA_CODE || '123456';

fs.mkdirSync(LOG_DIR, { recursive: true });

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '256kb' }));

// ---------------------------------------------------------------------------
// FLAGS — every requirement in the assessment carries a SCENARIO75{...} flag.
// ---------------------------------------------------------------------------
const FLAG = {
  NODE: 'SCENARIO75{Node.js}',
  MFA_PATH: 'SCENARIO75{/api/verify-mfa}',
  DASHBOARD: 'SCENARIO75{/dashboard}',
  ROBOTS: 'SCENARIO75{robots.txt}',
  PRE_COOKIE: 'SCENARIO75{pre_mfa_session}',
  PRE_VALUE: 'SCENARIO75{pending_mfa_verification}',
  POST: 'SCENARIO75{POST}',
  WAF403: 'SCENARIO75{403}',
  SVG: 'SCENARIO75{<svg>}',
  BRACKET: "SCENARIO75{window['docu'+'ment']['coo'+'kie']}",
  HTTPONLY_FALSE: 'SCENARIO75{False}',
  FETCH: 'SCENARIO75{fetch}',
  ADM_SESS: 'SCENARIO75{adm_sess}',
  XSS_CLASS: 'SCENARIO75{xss-payload}',
  RED_FINAL: 'SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}',
};

// ---------------------------------------------------------------------------
// Logging helpers — Nginx-style combined format + XFF, plus an app error log.
// ---------------------------------------------------------------------------
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.ip || (req.socket && req.socket.remoteAddress) || '-').replace(/^::ffff:/, '');
}

function nginxTs(d) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  const tz = `${sign}${p(Math.floor(a / 60))}${p(a % 60)}`;
  return `${p(d.getDate())}/${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]}/${d.getFullYear()}:${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${tz}`;
}

function appendLine(file, line) {
  try {
    fs.appendFileSync(file, line + '\n');
  } catch (e) {
    /* never let logging crash the app */
  }
}

function logAccess(req, status, bytes) {
  const ua = req.headers['user-agent'] || '-';
  const ref = req.headers['referer'] || '-';
  const xff = req.headers['x-forwarded-for'] || '-';
  const line =
    `${clientIp(req)} - - [${nginxTs(new Date())}] ` +
    `"${req.method} ${req.originalUrl} HTTP/1.1" ${status} ${bytes} ` +
    `"${ref}" "${ua}" xff=${xff}`;
  appendLine(ACCESS_LOG, line);
}

function logError(level, msg) {
  const d = new Date();
  appendLine(ERROR_LOG, `${d.toISOString()} [${level}] ${msg}`);
}

// ---------------------------------------------------------------------------
// "WAF" — a deliberately rudimentary Web Application Firewall.
//   * blocks any payload containing <script ...
//   * blocks the raw keywords document / cookie  -> forces bracket-notation
//   * blocks onerror -> forces the <svg onload=...> HTML5 bypass
//   * does NOT block <svg>, onload, or fetch -> that is the intended bypass.
// ---------------------------------------------------------------------------
const WAF_RULES = [
  { label: '<script>', re: /<\s*script/i },
  { label: 'document', re: /document/i },
  { label: 'cookie', re: /cookie/i },
  { label: 'onerror', re: /onerror/i },
];

function waf(req, res, next) {
  const body = JSON.stringify(req.body || {});
  for (const rule of WAF_RULES) {
    if (rule.re.test(body)) {
      logError(
        'CRITICAL',
        `WAF blocked payload containing forbidden token "${rule.label}" from ${clientIp(req)} (uri=${req.originalUrl})`
      );
      logAccess(req, 403, 0);
      return res
        .status(403)
        .type('html')
        .send(
          `<h1>403 Forbidden</h1>` +
            `<p>Request blocked by WAF (matched token: <code>${rule.label.replace(/</g, '&lt;')}</code>).</p>` +
            `<!-- ${FLAG.WAF403} -->`
        );
    }
  }
  next();
}

// ---------------------------------------------------------------------------
// State (in-memory, reset on restart). Sessions NEVER expire and are not bound
// to the client — that is the "session token issuance logic is flawed" flaw.
// ---------------------------------------------------------------------------
const feedbacks = []; // { author, message, ts, ip }
const validSessions = new Set(); // adm_sess tokens

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ASCII_ART = `
<!--
     ___                _      ______         _ _     _
    / _ \\              (_)     |  ___|       | | |   | |
   / /_\\ \\_ __   __ _   _  ___ | |_ ___  __ _| | |__ | |__   ___  _ __
   |  _  | '_ \\ / _\` | | |/ __||  _/ _ \\/ _\` | | '_ \\| '_ \\ / _ \\| '__|
   | | | | | | | (_| | | |\\__ \\| ||  __/ (_| | | |_) | |_) | (_) | |
   \\_| |_/_| |_|\\__,_| |_|___/ \\_|\\___|\\__,_|_|_.__/|_.__/ \\___/|_|
                                                            v1.0
   Admin Feedback System
   --------------------------------------------------------------------
   NOTE TO ADMIN: hidden endpoints are listed where crawlers should look.
   Psst... have you checked robots.txt lately?  ->  ${FLAG.ROBOTS}
   --------------------------------------------------------------------
-->
`;

const PAGE_STYLE = `
  body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0f1220;color:#e6e6f0;margin:0;padding:40px}
  .card{max-width:720px;margin:0 auto;background:#171a2e;border:1px solid #2a2f52;border-radius:12px;padding:28px}
  h1{color:#8ab4ff;margin-top:0} a{color:#8ab4ff}
  label{display:block;margin:14px 0 6px;color:#9aa0c8} input,textarea{width:100%;padding:10px;border-radius:8px;border:1px solid #2a2f52;background:#0f1220;color:#e6e6f0;box-sizing:border-box}
  button{margin-top:16px;padding:10px 18px;border:0;border-radius:8px;background:#4c6ef5;color:#fff;font-weight:600;cursor:pointer}
  .xss-payload{background:#0f1220;border-left:3px solid #4c6ef5;padding:12px;margin:10px 0;border-radius:6px}
  .flag{background:#1e2a1e;border:1px solid #3fa34d;color:#9be29b;padding:12px;border-radius:8px;font-family:monospace}
  code{background:#0f1220;padding:2px 6px;border-radius:4px}
`;

function layout(title, body, extraComment) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${PAGE_STYLE}</style></head>
<body>
${extraComment || ''}
<div class="card">
${body}
</div>
<!-- ${FLAG.NODE} — backend technology is exposed via the X-Powered-By header -->
</body></html>`;
}

// X-Powered-By header exposing the backend technology (requirement).
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'Node.js (Express)');
  next();
});

// ---- GET / : issues the pre-auth session cookie + shows the feedback form ----
app.get('/', (req, res) => {
  if (!req.cookies.pre_mfa_session) {
    // HttpOnly explicitly FALSE so client-side JS (XSS) can read it.
    res.cookie('pre_mfa_session', 'pending_mfa_verification', {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
    });
  }
  const body = `
    <h1>Admin Feedback System</h1>
    <p>Leave feedback for the administration team. Submissions are reviewed in the admin dashboard.</p>
    <form method="POST" action="/api/feedback">
      <label for="author">Name</label>
      <input id="author" name="author" placeholder="your name">
      <label for="message">Message</label>
      <textarea id="message" name="message" rows="4" placeholder="your feedback..."></textarea>
      <button type="submit">Submit feedback</button>
    </form>
    <p style="color:#9aa0c8;font-size:13px">Session: <code>pre_mfa_session=pending_mfa_verification</code> (HttpOnly=False)</p>
    <p><a href="/login">Admin login</a></p>
    <!-- ${FLAG.PRE_COOKIE} / ${FLAG.PRE_VALUE} / ${FLAG.HTTPONLY_FALSE} -->
  `;
  logAccess(req, 200, body.length);
  res.type('html').send(layout('Admin Feedback System', body, ASCII_ART));
});

// ---- robots.txt : disallowed path is the hint ----
app.get('/robots.txt', (req, res) => {
  const body =
    'User-agent: *\n' +
    'Disallow: /api/verify-mfa\n' +
    'Disallow: /dashboard\n' +
    `# ${FLAG.MFA_PATH}\n` +
    `# ${FLAG.DASHBOARD}\n`;
  logAccess(req, 200, body.length);
  res.type('text/plain').send(body);
});

// ---- /api/feedback : POST only ----
app.get('/api/feedback', (req, res) => {
  logAccess(req, 405, 0);
  res
    .status(405)
    .type('html')
    .send('<h1>405 Method Not Allowed</h1><p>Feedback submission only accepts POST.</p>');
});

app.post('/api/feedback', waf, (req, res) => {
  const author = String(req.body.author || 'anonymous').slice(0, 200);
  const message = String(req.body.message || '').slice(0, 4000);
  feedbacks.push({ author, message, ts: new Date().toISOString(), ip: clientIp(req) });
  const body = `<h1>Thanks!</h1><p>Your feedback has been recorded and will be reviewed by an administrator.</p><p><a href="/">Back</a></p>`;
  logAccess(req, 200, body.length);
  res.type('html').send(layout('Feedback received', body));
});

// ---- Admin login (step 1) + MFA verify (step 2) ----
app.get('/login', (req, res) => {
  const body = `
    <h1>Admin Login</h1>
    <form method="POST" action="/login">
      <label for="username">Username</label><input id="username" name="username">
      <label for="password">Password</label><input id="password" name="password" type="password">
      <button id="loginBtn" type="submit">Sign in</button>
    </form>`;
  logAccess(req, 200, body.length);
  res.type('html').send(layout('Admin Login', body));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.cookie('pre_mfa_session', 'pending_mfa_verification', { httpOnly: false, path: '/' });
    logAccess(req, 302, 0);
    return res.redirect('/api/verify-mfa');
  }
  logAccess(req, 401, 0);
  res.status(401).type('html').send(layout('Admin Login', '<h1>401</h1><p>Invalid credentials.</p>'));
});

app.get('/api/verify-mfa', (req, res) => {
  const body = `
    <h1>Multi-Factor Authentication</h1>
    <p>Enter the 6-digit code from your authenticator to finish signing in.</p>
    <form method="POST" action="/api/verify-mfa">
      <label for="code">Verification code</label>
      <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code">
      <button id="mfaBtn" type="submit">Verify</button>
    </form>
    <!-- ${FLAG.MFA_PATH} -->
  `;
  logAccess(req, 200, body.length);
  res.type('html').send(layout('MFA Verification', body));
});

app.post('/api/verify-mfa', (req, res) => {
  const code = String((req.body || {}).code || '');
  if (code === MFA_CODE) {
    // FLawed: token is a plain bearer token, never expires, not bound to client.
    const token = 'adm_sess_' + crypto.randomBytes(16).toString('hex');
    validSessions.add(token);
    res.cookie('adm_sess', token, { httpOnly: false, path: '/' }); // readable by JS (XSS)
    logAccess(req, 302, 0);
    return res.redirect('/dashboard');
  }
  logAccess(req, 401, 0);
  res.status(401).type('html').send(layout('MFA Verification', '<h1>401</h1><p>Invalid code.</p>'));
});

// ---- /dashboard : the restricted admin area ----
app.get('/dashboard', (req, res) => {
  const token = req.cookies.adm_sess;
  // VULNERABILITY: only checks the bearer token, never re-verifies MFA state.
  // A replayed (stolen) adm_sess cookie skips /api/verify-mfa entirely.
  if (!token || !validSessions.has(token)) {
    logAccess(req, 302, 0);
    return res.redirect('/login?next=/dashboard');
  }

  const rendered = feedbacks
    .map(
      (f) =>
        `<div class="xss-payload" data-author="${escapeAttr(f.author)}">${f.message}</div>`
    )
    .join('\n');

  const rows = feedbacks.length
    ? feedbacks
        .map(
          (f) =>
            `<tr><td>${escapeAttr(f.author)}</td><td>${escapeAttr(f.ts)}</td><td>${escapeAttr(f.ip)}</td></tr>`
        )
        .join('')
    : '<tr><td colspan="3">No feedback yet.</td></tr>';

  const body = `
    <h1>Admin Dashboard</h1>
    <div class="flag">&#9733; FINAL RED TEAM FLAG: ${FLAG.RED_FINAL}</div>
    <h2>Customer feedback</h2>
    <div id="feedback">${rendered}</div>
    <h2>Metadata</h2>
    <table border="0" cellpadding="6"><tr><th align="left">Author</th><th align="left">Timestamp</th><th align="left">Source IP</th></tr>${rows}</table>
    <p><a href="/logout">Sign out</a></p>
    <!-- ${FLAG.DASHBOARD} / ${FLAG.ADM_SESS} / ${FLAG.XSS_CLASS} -->
  `;
  logAccess(req, 200, body.length);
  res.type('html').send(layout('Admin Dashboard', body));
});

app.get('/logout', (req, res) => {
  if (req.cookies.adm_sess) validSessions.delete(req.cookies.adm_sess);
  res.clearCookie('adm_sess');
  res.redirect('/');
});

// ---- misc ----
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((req, res) => {
  logAccess(req, 404, 0);
  res.status(404).type('html').send(layout('404', '<h1>404 Not Found</h1>'));
});

function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[admin-feedback] listening on :${PORT}`);
  console.log(`[admin-feedback] logs -> ${LOG_DIR}`);
});
