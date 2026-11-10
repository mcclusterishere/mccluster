// Real browser, local HTTP only. Every auth and API answer is a fixture: no account, no production request or write.
// The session here is stale on every call, as on a device whose clock runs ahead of the server's: each refreshed
// token already looks expired, so every MCC.user() and MCC.api() refreshes again. The bar must still ask once,
// settle, keep its owner answer when the token moves under it, and not be set off again by another tab.
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
const HOME = '/index.html';     // the front door: its globe embed (js/guest-world.js) asks the bar again on every session write
const SUB = 'fixture-member';
const seconds = () => Math.floor(Date.now() / 1000);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/* One browser profile with the stale-on-every-call session already stored, and `tabs` pages open on it.
   owner: what GET /v1/status answers. statusDelay holds that answer back so a token refresh can land first. */
async function visit({ page: path = PAGE, tabs = 1, owner = false, statusDelay = 0 } = {}) {
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
  await context.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    const cors = { 'access-control-allow-origin': '*' };
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') {
      counts.refresh++;
      return route.fulfill({ json: { access_token: token(), refresh_token: 'fixture-refresh-' + counts.refresh, token_type: 'bearer', expires_in: 3600, expires_at: seconds() - 5, user: { id: SUB } }, headers: cors });
    }
    if (u.pathname === '/auth/v1/user') { counts.user++; return route.fulfill({ json: { id: SUB, email: 'fixture@example.test', user_metadata: { name: 'Fixture Member' } }, headers: cors }); }
    if (u.href === 'https://api.mccluster.org/v1/status') {
      counts.status++;
      if (statusDelay) await pause(statusDelay);
      return route.fulfill(owner ? { json: { ok: true }, headers: cors } : { status: 403, json: { error: 'forbidden' }, headers: cors }).catch(() => {});
    }
    return route.abort();
  });
  const pages = [];
  for (let i = 0; i < tabs; i++) {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    pages.push(page);
  }
  await Promise.all(pages.map((page) => page.goto(base + path, { waitUntil: 'domcontentloaded' })));   // tabs restored together
  return { context, pages, counts, errors };
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
const released = (page, ownerBar) => page.waitForFunction((want) => !document.documentElement.classList.contains('mcc-shell-pending') &&
  document.body.hasAttribute('data-appbar-admin') === want, ownerBar, { timeout: 4000 })
  .catch(() => assert.fail(`the bar was still hidden, or painted for the wrong role, 4 seconds after the owner check answered (owner bar expected: ${ownerBar})`));
const lines = [];

try {
  // One tab: the lookup that used to repeat for ever.
  const one = await visit();
  await settled(one.pages[0], one.counts);
  await released(one.pages[0], false);
  const single = await quiet(one.counts, 'nothing more is asked once the bar has its answer');
  assert.deepEqual(single, { refresh: 1, user: 1, status: 1 }, 'one refresh, one account lookup, one owner check');
  assert.deepEqual(await painted(one.pages[0]), SIGNED_IN);
  assert.deepEqual(one.errors, []);
  await one.context.close();
  lines.push(`one tab settled signed in and visible after ${single.refresh} refresh and ${single.user} user request, then asked nothing for 1.5 seconds`);

  // The owner check is still in the air when another request on the page refreshes the token: its answer still counts.
  for (const owner of [true, false]) {
    const late = await visit({ owner, statusDelay: 700 });
    await settled(late.pages[0], late.counts);
    await late.pages[0].evaluate(() => window.MCC.refresh());
    assert.equal(late.counts.refresh, 2, 'the token moved again under the owner check');
    await released(late.pages[0], owner);
    assert.deepEqual(await painted(late.pages[0]), SIGNED_IN);
    assert.equal(late.counts.status, 1, 'one owner check');
    assert.deepEqual(late.errors, []);
    await late.context.close();
  }
  lines.push('an owner answer that landed after the token moved again released the bar for the owner (seven tabs) and for a member (three)');

  // Two tabs: each tab's refresh used to make the other look the account up again, through the bar's own storage
  // listener and, on the home page, through the globe embed asking the bar.
  for (const [name, path] of [['a plain page', PAGE], ['the home page', HOME]]) {
    const two = await visit({ page: path, tabs: 2 });
    for (const page of two.pages) await settled(page, two.counts);
    const pair = await quiet(two.counts, `two tabs on ${name} do not keep answering each other`);
    assert.ok(pair.refresh <= 6, `three lookups a tab at most: ${pair.refresh} refresh requests on ${name}`);
    assert.equal(pair.user, 2, `one answer each on ${name}`);
    for (const page of two.pages) assert.deepEqual(await painted(page), SIGNED_IN);
    assert.deepEqual(two.errors, []);
    await two.context.close();
    lines.push(`two tabs on ${name} settled signed in after ${pair.refresh} refresh and ${pair.user} user request(s) between them, then asked nothing for 1.5 seconds`);
  }

  console.log('PASS: with a session that is stale on every call, ' + lines.join('; ') + '. All auth/API responses synthetic, no production credentials or writes.');
} finally { await browser.close(); server.closeAllConnections(); await new Promise((r) => server.close(r)); }
