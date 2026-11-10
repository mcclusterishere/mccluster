// Real browser, local HTTP only. Every auth and API answer is a fixture: no account, no production request or write.
// A device whose clock runs an hour ahead of the auth server's, and the server's ordinary one-hour tokens. The canonical
// client measures a session's expiry on the device's own clock (js/mcc-auth.js stampExpiry), so a token is fresh here
// for its hour as it is anywhere. Before, every token looked expired the moment it arrived: each call refreshed and
// rewrote the session, tabs restored together refreshed over each other, and most bars never painted signed in.
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
const HOUR = 3600, AHEAD = HOUR, TABS = 6, SUB = 'fixture-member';
const PAGE = '/privacy.html';                                // a public page whose only account lookup is the bar's
const seconds = () => Math.floor(Date.now() / 1000);         // the fixture servers keep this runner's clock
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = (token) => { try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url')); } catch { return {}; } };

const counts = { refresh: 0, user: 0, refused: 0 }, errors = [];
let serial = 0;
const issue = () => {
  const iat = seconds(), n = ++serial;
  return {
    access_token: 'fixture.' + Buffer.from(JSON.stringify({ sub: SUB, email: 'fixture@example.test', iat, exp: iat + HOUR, n })).toString('base64url') + '.fixture',
    refresh_token: 'fixture-refresh-' + n, token_type: 'bearer', expires_in: HOUR, expires_at: iat + HOUR, user: { id: SUB }
  };
};
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
/* this device's clock: an hour ahead, for Date.now() and new Date() alike */
await context.addInitScript((ahead) => {
  const Real = Date, shift = ahead * 1000;
  class Device extends Real {
    constructor(...args) { if (args.length) super(...args); else super(Real.now() + shift); }
    static now() { return Real.now() + shift; }
  }
  globalThis.Date = Device;
}, AHEAD);
/* what an earlier visit left, the way the client stored it before: the server's answer with the server's expires_at,
   which on this clock reads as already spent */
await context.addInitScript((session) => {
  if (sessionStorage.getItem('fixture-seeded')) return;
  sessionStorage.setItem('fixture-seeded', '1');
  if (!localStorage.getItem('mccdb_session')) { localStorage.setItem('mccdb_session', session); localStorage.setItem('mcc_sess_keep', session); }
}, JSON.stringify(issue()));
await context.route('**/*', async (route) => {
  const u = new URL(route.request().url());
  if (u.origin === base) return route.continue();
  const cors = { 'access-control-allow-origin': '*' };
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') { counts.refresh++; return route.fulfill({ json: issue(), headers: cors }); }
  const bearer = String(route.request().headers().authorization || '').replace(/^Bearer /, '');
  const live = claims(bearer).exp > seconds();             // the server refuses an expired token, on its own clock
  if (u.pathname === '/auth/v1/user' || u.pathname.startsWith('/rest/v1/rpc/') || u.href === 'https://api.mccluster.org/v1/status') {
    if (!live) { counts.refused++; return route.fulfill({ status: 401, json: { code: 'bad_jwt', msg: 'JWT expired' }, headers: cors }); }
    if (u.pathname === '/auth/v1/user') { counts.user++; return route.fulfill({ json: { id: SUB, email: 'fixture@example.test', user_metadata: { name: 'Fixture Member' } }, headers: cors }); }
    if (u.pathname.startsWith('/rest/v1/rpc/')) return route.fulfill({ json: u.pathname.endsWith('/m_my_uid') ? 'fixture-m-uid' : [], headers: cors });
    return route.fulfill({ status: 403, json: { error: 'forbidden' }, headers: cors });   // a member, not the owner
  }
  return route.abort();
});

const painted = (page) => page.evaluate(() => ({
  auth: document.body.getAttribute('data-mcc-auth'),
  state: window.MCC_AUTH_STATE && { signed_in: window.MCC_AUTH_STATE.signed_in, verified: window.MCC_AUTH_STATE.verified }
}));
async function signedIn(pages) {
  for (const page of pages) {
    await page.waitForFunction(() => window.MCC_AUTH_STATE && window.MCC_AUTH_STATE.verified === true && window.MCC_AUTH_STATE.signed_in === true, null, { timeout: 6000 })
      .catch(async () => assert.fail(`a bar never painted signed in: ${JSON.stringify(await painted(page))}; ${counts.refresh} refresh and ${counts.user} user requests so far`));
    assert.deepEqual(await painted(page), { auth: 'in', state: { signed_in: true, verified: true } });
  }
}
/* nothing more is asked once every bar has its answer */
async function quiet(message) {
  await pause(750);
  const after = { ...counts };
  await pause(1500);
  assert.deepEqual(counts, after, message);
  return after;
}
const lines = [];

try {
  const pages = [];
  for (let i = 0; i < TABS; i++) { const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message)); pages.push(page); }
  await Promise.all(pages.map((page) => page.goto(base + PAGE, { waitUntil: 'domcontentloaded' })));   // tabs restored together
  await signedIn(pages);
  const restored = await quiet('nothing more is asked once every bar is signed in');
  assert.ok(restored.refresh <= TABS, `one refresh a tab at most for the session stored with the server's expiry: ${restored.refresh}`);
  assert.equal(restored.refused, 0, 'no expired token was sent');
  const stored = await pages[0].evaluate(() => JSON.parse(localStorage.getItem('mccdb_session')));
  const left = stored.expires_at - await pages[0].evaluate(() => Math.floor(Date.now() / 1000));
  assert.ok(left > HOUR - 120 && left <= HOUR, `stored with its hour measured on this device's clock: ${left}s left`);
  assert.ok(Math.abs(stored.server_expires_at - (seconds() + HOUR)) <= 120, 'and the server\'s own expiry kept beside it');
  lines.push(`${TABS} tabs restored together on a clock an hour ahead all painted signed in after ${restored.refresh} refresh and ${restored.user} user requests, then asked nothing for 1.5 seconds`);

  await Promise.all(pages.map((page) => page.reload({ waitUntil: 'domcontentloaded' })));
  await signedIn(pages);
  const reloaded = await quiet('the reloaded tabs ask nothing more');
  assert.equal(reloaded.refresh, restored.refresh, 'reloading every tab refreshes nothing: the stored session is fresh on this clock');
  lines.push(`reloading all ${TABS} made ${reloaded.user - restored.user} user and ${reloaded.refresh - restored.refresh} refresh requests`);

  await pages[1].evaluate(() => { window.__sessionWrites = 0; addEventListener('storage', (e) => { if (e.key === 'mccdb_session') window.__sessionWrites++; }); });
  const calls = await pages[0].evaluate(async () => {
    const answers = [];
    for (let round = 0; round < 5; round++) {
      answers.push(!!(await window.MCC.user()), (await window.MCC.api('/v1/status')).status === 403, await window.MCC.mUid() === 'fixture-m-uid',
        Array.isArray(await window.MCC.identities()), !!(await window.MCC.refreshIfNeeded()));
    }
    return answers;
  });
  assert.ok(calls.every(Boolean), 'every call answered with the stored token');
  await pause(500);
  assert.equal(counts.refresh, restored.refresh, `${calls.length} calls refreshed nothing`);
  assert.equal(await pages[1].evaluate(() => window.__sessionWrites), 0, 'and another tab heard no session write');
  assert.equal(counts.refused, 0);
  lines.push(`${calls.length} MCC.user/api/mUid/identities/refreshIfNeeded calls in one tab made no refresh and no session write another tab could hear`);
  assert.deepEqual(errors, []);
  console.log('PASS: ' + lines.join('; ') + '. All auth/API responses synthetic, no production credentials or writes.');
} finally { await context.close(); await browser.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); }
