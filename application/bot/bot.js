/**
 * Simulated administrator bot.
 *
 * The "Admin Feedback System" scenario assumes a human admin who periodically
 * reviews the feedback queue. This bot performs that login (including the MFA
 * step) and then re-visits /dashboard on a loop, so any stored XSS payload in
 * the feedback queue actually executes inside an authenticated browser session
 * — exactly like a real admin would trigger it.
 */
'use strict';

const puppeteer = require('puppeteer');

const APP_URL = process.env.APP_URL || 'http://feedback:3075';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Adm1n@Feedback2026';
const MFA_CODE = process.env.MFA_CODE || '123456';
const REVIEW_INTERVAL_MS = parseInt(process.env.REVIEW_INTERVAL_MS || '20000', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn(page) {
  await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.type('#username', ADMIN_USER);
  await page.type('#password', ADMIN_PASS);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
    page.click('#loginBtn'),
  ]);

  if (page.url().includes('verify-mfa')) {
    await page.waitForSelector('#code', { timeout: 15000 });
    await page.type('#code', MFA_CODE);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
      page.click('#mfaBtn'),
    ]);
  }
  console.log(`[bot] signed in, current url = ${page.url()}`);
}

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      // The app is served over plain HTTP on an internal hostname; stop Chromium
      // from auto-upgrading the navigation to HTTPS.
      '--disable-features=HttpsUpgrades,HttpsFirstModeV2,HttpsFirstBalancedModeAutoEnable',
    ],
  });

  const page = await browser.newPage();
  page.on('console', (msg) => console.log(`[bot][page] ${msg.text()}`));
  page.on('pageerror', (err) => console.log(`[bot][pageerror] ${err.message}`));

  // Try to sign in, with retries in case the app is still booting.
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await signIn(page);
      break;
    } catch (e) {
      console.log(`[bot] sign-in attempt ${attempt} failed: ${e.message}`);
      await sleep(5000);
    }
  }

  // Loop: act like an admin reviewing the feedback dashboard.
  for (;;) {
    try {
      await page.goto(`${APP_URL}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
      // A 302 to /login means our bearer session is no longer accepted — e.g.
      // the app container restarted and wiped its in-memory session table.
      // Re-authenticate so the review loop keeps acting as a logged-in admin.
      if (page.url().includes('/login')) {
        console.log('[bot] session invalid (redirected to /login) — re-authenticating');
        await signIn(page);
        await page.goto(`${APP_URL}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
      }
      await sleep(4000); // let any stored payload execute
      console.log(`[bot] reviewed dashboard (${new Date().toISOString()})`);
    } catch (e) {
      console.log(`[bot] review error: ${e.message}`);
      try { await signIn(page); } catch (_) {}
    }
    await sleep(REVIEW_INTERVAL_MS);
  }
})();
