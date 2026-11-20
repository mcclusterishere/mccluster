/* Native Control → Sell → Music → Review, using the real control.html and
   music-ops.js. Every network request is intercepted; the release, account,
   signed URL and audio bytes are synthetic. No production publication.
   PLAYWRIGHT_DIR=<node_modules> [CHROMIUM_EXECUTABLE=…] node
   scripts/e2e/control-music-review.e2e.mjs [outDir] */
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const OUT = process.argv[2] || '/tmp/control-music-review-proof';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const BASE = 'https://matthew.mccluster.org';
const SB = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
const OWNER = '11111111-1111-4111-8111-111111111111';
const TRACK = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const SHA = 'a7'.repeat(32);
const BEFORE = '2026-11-19T10:00:00.000Z';
const AFTER = '2026-11-19T10:01:00.000Z';
const SIGNED = `${SB}/storage/v1/object/sign/creator-masters/pinned-${VERSION}.wav?token=fixture-only`;
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const results = [];
function check(scope, name, ok, detail) {
  results.push({ scope, name, pass: !!ok, ...(ok ? {} : { detail }) });
  console.log((ok ? 'PASS ' : 'FAIL ') + '[' + scope + '] ' + name + (ok ? '' : ' ' + JSON.stringify(detail ?? null)));
}
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) }).catch(() => {});
function silentWav(seconds) {
  const n = seconds * 8000, b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(n, 40); return b;
}
const WAV = silentWav(12);
function serveWav(route, request) {
  const m = /bytes=(\d+)-(\d*)/.exec(request.headers().range || '');
  const headers = { 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
  if (!m) return route.fulfill({ status: 200, contentType: 'audio/wav', headers, body: WAV });
  const start = Number(m[1]), end = m[2] ? Math.min(Number(m[2]), WAV.length - 1) : WAV.length - 1;
  if (start >= WAV.length) return route.fulfill({ status: 416, headers: { ...headers, 'content-range': `bytes */${WAV.length}` }, body: '' });
  return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { ...headers, 'content-range': `bytes ${start}-${end}/${WAV.length}` }, body: WAV.subarray(start, end + 1) });
}
const publish = page => page.locator(`[data-crom-review="publish"][data-id="${TRACK}"]`);
const prepare = page => page.locator(`[data-crom-prepare="${TRACK}"]`);
const row = page => page.locator(`[data-crom-track="${TRACK}"]`);
const audio = page => page.locator(`[data-crom-audio="${TRACK}"]`);
const publications = db => db.calls.filter(call => call.action === 'operator-review' && call.decision === 'publish');
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });

async function setup(width, { musicOperator = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 1000 ? 844 : 900 }, deviceScaleFactor: 1, hasTouch: width < 1000, serviceWorkers: 'block' });
  const errors = [], dialogs = [];
  const db = { calls: [], audioReads: [], prepareMode: 'ok', reviewMode: 'ok', hold: null,
    track: { id: TRACK, uid: OWNER, m_uid: 'fixture-music', title: 'Fixture release for review', artist: 'Fixture Creator', status: 'pending_review', rights_status: 'attested', access_mode: 'account', genre: 'Fixture', created_at: BEFORE, updated_at: BEFORE } };
  await ctx.addInitScript(({ OWNER }) => {
    if (localStorage.getItem('fixture-music-review-seeded')) return;
    localStorage.setItem('fixture-music-review-seeded', '1');
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const session = JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: OWNER, email: 'owner@fixture.invalid' })).replace(/=+$/, '') + '.y', refresh_token: 'fixture-only', expires_at: exp, user: { id: OWNER, email: 'owner@fixture.invalid' } });
    localStorage.setItem('mccdb_session', session); localStorage.setItem('mcc_sess_keep', session);
  }, { OWNER });
  await ctx.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (url.origin === 'https://api.mccluster.org') {
      if (path === '/v1/status') return request.headers().authorization ? json(route, { ok: true, operator: { email: 'owner@fixture.invalid' }, database: { reachable: true } }) : json(route, { error: 'Forbidden' }, 403);
      if (path === '/v1/workspaces/me') return json(route, { ok: true, profile: { id: OWNER }, default_org_id: 'fixture-org', workspaces: [{ org_id: 'fixture-org', slug: 'mccluster', kind: 'studio', role: 'owner', enabled: true, name: 'McCluster' }] });
      return json(route, { ok: true, threads: [], apps: [], events: [], jobs: [], tools: [], decisions: [], leads: [], total: 0 });
    }
    if (url.origin === SB && path.startsWith('/storage/v1/object/sign/creator-masters/')) { db.audioReads.push(url.href); return serveWav(route, request); }
    if (url.hostname.endsWith('supabase.co')) {
      if (path === '/auth/v1/user') return json(route, { id: OWNER, email: 'owner@fixture.invalid' });
      if (path === '/functions/v1/music-access') {
        const body = request.postDataJSON() || {}; db.calls.push(body);
        if (!musicOperator) return json(route, { error: 'operator permission required' }, 403);
        if (body.action === 'operator-dashboard') return json(route, { ok: true, tracks: [{ ...db.track }], creators: [{ m_uid: 'fixture-music', artist_name: 'Fixture Creator' }], offers: [] });
        if (body.action === 'operator-review-prepare') {
          const prepared = { ok: true, track_id: TRACK, version_id: VERSION, sha256: SHA, sha256_short: SHA.slice(0, 12), size_bytes: WAV.length, expected_updated_at: db.track.updated_at, listen_url: SIGNED, expires_in: 900 };
          if (db.hold) await db.hold;
          if (db.prepareMode === 'fail') return json(route, { error: 'Fixture audio verification failed' }, 502);
          return json(route, prepared);
        }
        if (body.action === 'operator-review') {
          if (body.expected_master_sha256 !== SHA || body.expected_updated_at !== db.track.updated_at) return json(route, { error: 'verify the audio and review it again' }, 400);
          if (db.reviewMode === 'stale') {
            db.track.updated_at = AFTER; db.track.title = 'Revised fixture release'; db.reviewMode = 'ok';
            return json(route, { error: 'the release changed since you loaded it: reload and review it again' }, 409);
          }
          db.track.status = 'published'; db.track.rights_status = 'cleared'; db.track.updated_at = AFTER;
          if (db.reviewMode === 'uncertain') return route.abort('failed');
          return json(route, { ok: true, track: { ...db.track } });
        }
        return json(route, { error: 'unsupported fixture action' }, 400);
      }
      return json(route, []);
    }
    if (url.origin === BASE) {
      if (path === '/__music-review-account-fixture') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Account fixture</title>' });
      const relative = path === '/' ? 'index.html' : decodeURIComponent(path.replace(/^\//, ''));
      const file = resolve(ROOT, relative);
      if (!file.startsWith(ROOT + sep)) return route.abort();
      try { return route.fulfill({ body: await readFile(file), contentType: TYPES[extname(file)] || 'application/octet-stream' }); }
      catch { return route.fulfill({ status: 404, body: '' }); }
    }
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  return { ctx, page, db, errors, dialogs };
}
async function openReview(page) {
  await page.goto(BASE + '/control.html#sell:music:catalog', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-crom-section="review"]').waitFor({ timeout: 30000 });
  await page.locator('[data-crom-section="review"]').click();
  await prepare(page).waitFor({ timeout: 15000 });
}
async function verify(page) {
  await prepare(page).click();
  await page.waitForFunction(id => {
    const button = document.querySelector(`[data-crom-review="publish"][data-id="${id}"]`);
    return button && !button.disabled;
  }, TRACK, { timeout: 15000 });
}
async function notice(page, pattern) {
  await page.waitForFunction(({ id, source }) => {
    const node = document.querySelector(`[data-crom-notice="${id}"]`);
    return node && new RegExp(source, 'i').test(node.textContent);
  }, { id: TRACK, source: pattern }, { timeout: 15000 });
}
async function layout(page, scope) {
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
    controls: [...document.querySelectorAll('[data-crom-prepare],[data-crom-review],[data-crom-refresh]')].map(el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; }) }));
  check(scope, 'the page has no horizontal overflow', dimensions.scroll === dimensions.client, dimensions);
  check(scope, 'every release action has a 44px target', dimensions.controls.length >= 5 && dimensions.controls.every(r => r.width >= 44 && r.height >= 44), dimensions.controls);
}
async function scenario(scope, width, run, options) {
  const fixture = await setup(width, options);
  try { await run(fixture); check(scope, 'no page script errors', fixture.errors.length === 0, fixture.errors); }
  catch (error) {
    check(scope, 'journey completes', false, error.stack || String(error));
    await fixture.page.screenshot({ path: join(OUT, scope.replace(/[^a-z0-9-]/gi, '-') + '-failure.png'), fullPage: true }).catch(() => {});
  } finally { await fixture.ctx.close(); }
}

try {
  for (const width of [390, 1280]) await scenario('review-' + width, width, async ({ page, db }) => {
    await openReview(page);
    check(width, 'Publish waits for verification', await publish(page).isDisabled() && await audio(page).count() === 0);
    check(width, 'opening the queue sends no publication command', publications(db).length === 0);
    await verify(page);
    check(width, 'verification requests exactly this release', db.calls.filter(call => call.action === 'operator-review-prepare').length === 1 && db.calls.find(call => call.action === 'operator-review-prepare').track_id === TRACK);
    check(width, 'the player uses the returned pinned URL and shows its hash', await audio(page).getAttribute('src') === SIGNED && (await row(page).innerText()).includes(SHA.slice(0, 12)));
    await audio(page).evaluate(element => element.play());
    await page.waitForFunction(id => { const a = document.querySelector(`[data-crom-audio="${id}"]`); return a && !a.paused && a.currentTime > 0.1 && a.duration === 12; }, TRACK, { timeout: 15000 });
    check(width, 'the actual reviewed audio plays', db.audioReads.length > 0 && db.audioReads.every(url => url === SIGNED), db.audioReads);
    await audio(page).evaluate(element => element.pause());
    await layout(page, width);
    await row(page).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, `control-music-verified-${width}.png`), fullPage: true });
    await publish(page).click();
    await page.waitForFunction(id => { const r = document.querySelector(`[data-crom-track="${id}"]`); return r && /published/.test(r.textContent) && /cleared/.test(r.textContent); }, TRACK, { timeout: 15000 });
    const sent = publications(db);
    check(width, 'Publish sends the verified hash and displayed release version exactly once', sent.length === 1 && sent[0].expected_updated_at === BEFORE && sent[0].expected_master_sha256 === SHA && sent[0].track_id === TRACK, sent);
    check(width, 'success is read back from the queue', db.calls.filter(call => call.action === 'operator-dashboard').length >= 2);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await row(page).waitFor({ timeout: 30000 });
    check(width, 'publication survives a page reload', /published/.test(await row(page).innerText()) && /cleared/.test(await row(page).innerText()));
    check(width, 'a reload never republishes or retains a signed review player', publications(db).length === 1 && await audio(page).count() === 0);
  });

  await scenario('failed-verification', 390, async ({ page, db }) => {
    await openReview(page); db.prepareMode = 'fail'; await prepare(page).click();
    await notice(page, 'verification failed');
    check('failed-verification', 'failed verification leaves Publish disabled and no audio', await publish(page).isDisabled() && await audio(page).count() === 0);
    check('failed-verification', 'no publication follows a failed verification', publications(db).length === 0);
    db.prepareMode = 'ok'; await verify(page);
    check('failed-verification', 'an explicit successful verification recovers', !(await publish(page).isDisabled()));
  });

  await scenario('changed-before-verification', 390, async ({ page, db }) => {
    await openReview(page);
    db.track.updated_at = AFTER; db.track.title = 'Revised fixture release';
    await prepare(page).click();
    await notice(page, 'changed|reload|refresh');
    check('changed-before-verification', 'verification of an unseen version requires a queue refresh', await publish(page).isDisabled() && await prepare(page).isDisabled() && await audio(page).count() === 0);
    check('changed-before-verification', 'the unseen version is never published', publications(db).length === 0);
    await page.locator('[data-crom-refresh]').click();
    await page.waitForFunction(id => document.querySelector(`[data-crom-track="${id}"]`)?.textContent.includes('Revised fixture release'), TRACK, { timeout: 15000 });
    check('changed-before-verification', 'manual refresh shows the revised metadata and still requires verification', await publish(page).isDisabled());
    await verify(page);
    check('changed-before-verification', 'the refreshed version gets its own verification', !(await publish(page).isDisabled()) && db.calls.filter(call => call.action === 'operator-review-prepare').length === 2);
    await publish(page).click();
    await page.waitForFunction(id => document.querySelector(`[data-crom-track="${id}"]`)?.textContent.includes('published'), TRACK, { timeout: 15000 });
    const sent = publications(db);
    check('changed-before-verification', 'only the displayed and reverified version is published', sent.length === 1 && sent[0].expected_updated_at === AFTER && sent[0].expected_master_sha256 === SHA, sent);
  });

  await scenario('stale-version', 390, async ({ page, db }) => {
    await openReview(page); await verify(page); db.reviewMode = 'stale'; await publish(page).click();
    await notice(page, 'changed|reload|refresh');
    check('stale-version', 'a 409 clears the verified player and blocks another publish', await publish(page).isDisabled() && await audio(page).count() === 0);
    check('stale-version', 'the refused decision is not automatically resent', publications(db).length === 1);
    await page.locator('[data-crom-refresh]').click();
    await page.waitForFunction(id => document.querySelector(`[data-crom-track="${id}"]`)?.textContent.includes('Revised fixture release'), TRACK, { timeout: 15000 });
    check('stale-version', 'refresh shows the changed release and still requires verification', await publish(page).isDisabled());
    await verify(page);
    check('stale-version', 'the changed release can be verified without resending publication', !(await publish(page).isDisabled()) && publications(db).length === 1);
  });

  await scenario('uncertain-publication', 390, async ({ page, db }) => {
    await openReview(page); await verify(page); db.reviewMode = 'uncertain'; await publish(page).click();
    await notice(page, 'unknown|uncertain|could not confirm|refresh');
    check('uncertain-publication', 'a lost response does not offer an immediate repeat decision', await publish(page).isDisabled() && await audio(page).count() === 0);
    await page.waitForTimeout(250);
    check('uncertain-publication', 'the command is never automatically resent', publications(db).length === 1);
    await page.locator('[data-crom-refresh]').click();
    await page.waitForFunction(id => document.querySelector(`[data-crom-track="${id}"]`)?.textContent.includes('published'), TRACK, { timeout: 15000 });
    check('uncertain-publication', 'an explicit readback discovers the committed publication', /cleared/.test(await row(page).innerText()) && publications(db).length === 1);
  });

  await scenario('account-loss', 390, async ({ ctx, page, db }) => {
    await openReview(page);
    let release; db.hold = new Promise(resolve => { release = resolve; });
    const requested = page.waitForRequest(request => {
      if (!request.url().includes('/functions/v1/music-access') || request.method() !== 'POST') return false;
      return request.postDataJSON()?.action === 'operator-review-prepare';
    });
    await prepare(page).click();
    await requested;
    await page.waitForFunction(() => document.querySelector('[data-crom-prepare]')?.disabled);
    const other = await ctx.newPage();
    await other.goto(BASE + '/__music-review-account-fixture');
    await other.evaluate(() => { localStorage.removeItem('mcc_sess_keep'); localStorage.removeItem('mccdb_session'); });
    await other.close(); release(); db.hold = null;
    await page.waitForFunction(() => { const gate = document.getElementById('cpGate'), app = document.getElementById('crApp'); return gate && app && !gate.hidden && app.hidden; }, null, { timeout: 15000 });
    check('account-loss', 'sign-out conceals the queue and its signed audio', await audio(page).count() === 0 && await row(page).count() === 0);
    check('account-loss', 'a late verification cannot cause publication', publications(db).length === 0);
  });

  await scenario('operator-denied', 390, async ({ page, db }) => {
    await page.goto(BASE + '/control.html#sell:music:catalog', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('crSurface')?.textContent.includes('operator permission required'), null, { timeout: 30000 });
    check('operator-denied', 'a refused music operator sees no releases or signed audio', await row(page).count() === 0 && await audio(page).count() === 0);
    check('operator-denied', 'no verification or publication is attempted after denial', db.calls.every(call => call.action === 'operator-dashboard'), db.calls);
  }, { musicOperator: false });
} finally {
  await browser.close();
  await writeFile(join(OUT, 'summary.json'), JSON.stringify({ results }, null, 2) + '\n');
}
const failed = results.filter(result => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
