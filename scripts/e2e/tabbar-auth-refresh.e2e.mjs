// Real browser, local HTTP only. Every auth and API answer is a fixture: no account, no production request or write.
// The session here is stale on every call, as on a device whose clock runs ahead of the server's: each refreshed
// token already looks expired, so every MCC.user() and MCC.api() refreshes again. The bar must still ask once
// and settle.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
const { chromium } = createRequire(join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '/opt/node-tools/node_modules', 'package.json'))('playwright');
const root = resolve('.');
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!path.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try { const data = await readFile(path); res.setHeader('Content-Type', TYPES[extname(path)] || 'application/octet-stream'); res.end(data); }
  catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
const PAGE = '/privacy.html';   // a public page whose only account lookup is the bar's
const SUB = 'fixture-member';
const seconds = () => Math.floor(Date.now() / 1000);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* One browser profile with the stale-on-every-call session already stored, and one page open on it. */
async function visit() {
  let serial = 0;
  const token = () => 'fixture.' + Buffer.from(JSON.stringify({ sub: SUB, email: 'fixture@example.test', exp: seconds() - 5, n: ++serial })).toString('base64url') + '.fixture';
  const counts = { refresh: 0, user: 0, status: 0 }, errors = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const saved = JSON.stringify({ access_token: token(), refresh_token: 'fixture-refresh-0', expires_at: seconds() - 5 });
  await context.addInitScript((session) => {
    if (sessionStorage.getItem('fixture-seeded')) return;       // a reload keeps whatever the page stored since
    sessionStorage.setItem('fixture-seeded', '1');
    if (!localStorage.getItem('mccdb_session')) { localStorage.setItem('mccdb_session', session); localStorage.setItem('mcc_sess_keep', session); }
  }, saved);
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    const cors = { 'access-control-allow-origin': '*' };
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') {
      counts.refresh++;
      return route.fulfill({ json: { access_token: token(), refresh_token: 'fixture-refresh-' + counts.refresh, token_type: 'bearer', expires_in: 3600, expires_at: seconds() - 5, user: { id: SUB } }, headers: cors });
    }
    if (u.pathname === '/auth/v1/user') { counts.user++; return route.fulfill({ json: { id: SUB, email: 'fixture@example.test', user_metadata: { name: 'Fixture Member' } }, headers: cors }); }
    if (u.href === 'https://api.mccluster.org/v1/status') { counts.status++; return route.fulfill({ status: 403, json: { error: 'forbidden' }, headers: cors }); }
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + PAGE, { waitUntil: 'domcontentloaded' });
  return { context, page, counts, errors };
}
/* The bar has an answer when its state is verified. Unfixed, it never does: it is still asking. */
async function settled(page, counts) {
  await page.waitForFunction(() => window.MCC_AUTH_STATE && window.MCC_AUTH_STATE.verified === true, null, { timeout: 4000 })
    .catch(() => assert.fail(`the bar never settled: ${counts.refresh} refresh and ${counts.user} user requests in 4 seconds`));
}
/* a bar with its answer asks nothing more for as long as we watch */
async function quiet(counts, message) {
  await pause(750);
  const after = { ...counts };
  await pause(1500);
  assert.deepEqual(counts, after, message);
  return after;
}
const painted = (page) => page.evaluate(() => ({
  auth: document.body.getAttribute('data-mcc-auth'),
  chip: (document.querySelector('#mccAuthChip .mcc-auth-chip__text') || {}).textContent || '',
  state: window.MCC_AUTH_STATE && { signed_in: window.MCC_AUTH_STATE.signed_in, verified: window.MCC_AUTH_STATE.verified, user: window.MCC_AUTH_STATE.user && window.MCC_AUTH_STATE.user.id }
}));
const SIGNED_IN = { auth: 'in', chip: 'Profile', state: { signed_in: true, verified: true, user: SUB } };
/* js/shell-boot.js hides the bar until the owner check has an answer, for at most 12 seconds */
const released = (page) => page.waitForFunction(() => !document.documentElement.classList.contains('mcc-shell-pending'), null, { timeout: 4000 })
  .catch(() => assert.fail('the bar was still hidden 4 seconds after it settled'));

try {
  const one = await visit();
  await settled(one.page, one.counts);
  await released(one.page);
  const after = await quiet(one.counts, 'nothing more is asked once the bar has its answer');
  assert.deepEqual(after, { refresh: 1, user: 1, status: 1 }, 'one refresh, one account lookup, one owner check');
  assert.deepEqual(await painted(one.page), SIGNED_IN);
  assert.deepEqual(one.errors, []);
  await one.context.close();
  console.log(`PASS: with a session that is stale on every call the bar settled signed in and visible after ${after.refresh} refresh and ${after.user} user request, then asked nothing for 1.5 seconds. All auth/API responses synthetic, no production credentials or writes.`);
} finally { await browser.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); }
