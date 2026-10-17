/* The member desk over the World globe, and the profile edit request, in a
   real browser at 390 and 1280. docs/control-plane/MEMBER-DESK-AND-PROFILE-EDIT-GATE.md

   Serves this checkout and puts an in-memory fake in front of
   api.mccluster.org and Supabase (no production call). Checks:
     - the Desk tab is on the bottom app bar and opens the desk OVER the
       globe; the bar stays visible and tappable; no sideways scroll;
     - a fellow's policy memo desk is inside it (Policy memos), with the
       creator's audience section from the same Worker numbers;
     - the old action-policy.html lands on the World with the desk on Policy;
     - an edit request: locked details, consent, a LIVE camera (Chromium's
       fake device, never a file), the server's code on screen, record,
       send (signed upload + identity_finish_submission), then the ID check
       answering "not switched on yet" (PERSONA_DISABLED).
   Run: node scripts/e2e/member-desk.e2e.mjs [outDir]
   (PLAYWRIGHT_DIR=/path/to/node_modules if playwright is not resolvable). */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const ME = { m_uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', mccluster_id: 'fixture.you', display_name: 'Fixture You' };
const SUB = '30000000-0000-4000-8000-0000000000e1';

function freshWorld() {
  return { requests: [], edit: { latest: null }, uploads: 0 };
}
function editStatus(w) {
  return { signed_in: true, require_persona: true, latest: w.edit.latest,
    consent: { version: 'profile-edit-fixture', title: 'Changing a locked profile detail: what you are agreeing to', body: 'Fixture consent.\n\nWe review your submissions together, including comparing them, to confirm you are the same person. No computer program measures or matches your face.', retention_days: 30 },
    fields: [
      { key: 'legal_name', label: 'Legal name', locked: true, requestable: true, max_length: 160, value: 'Fixture Person' },
      { key: 'handle', label: 'Username (@handle)', locked: true, requestable: true, max_length: 32, pattern: '^[a-z0-9][a-z0-9._-]{2,31}$', value: 'fixture.you' },
      { key: 'payout_account', label: 'Payout account', locked: false, requestable: false, value: null }
    ], limits: { max_seconds: 120 } };
}

async function route(ctx, w, { member }) {
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
  await ctx.route('https://cesium.com/**', (r) => r.abort());
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', async (r) => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname, m = req.method();
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const body = req.postData() && req.headers()['content-type'] === 'application/json' ? (() => { try { return JSON.parse(req.postData()); } catch { return null; } })() : null;
    w.requests.push({ m, p, body });
    if (p === '/auth/v1/user') return member ? json(r, { id: 'auth-you', email: 'fixture@example.invalid' }) : json(r, { msg: 'no session' }, 401);
    if (p.endsWith('/rpc/policy_ladder_status')) return json(r, member
      ? { signed_in: true, eligible: true, next_step: 'write_memo', completed: 3, needed: 3, steps: [], policy_seats: [{ cohort_id: 'c1', name: 'Connecticut Policy Fellowship' }], fellowship_application: { status: 'accepted' } }
      : { signed_in: false, next_step: 'sign_in', steps: [] });
    if (p === '/rest/v1/action_policy_memos') return json(r, [{ id: 'memo-1', status: 'draft', draft_title: 'Keep the 7 bus running past 10pm', region_key: 'US-CT', updated_at: new Date().toISOString() }]);
    if (p.endsWith('/rpc/music_creator_state')) return json(r, { message: 'Could not find the function' }, 404);
    if (p === '/rest/v1/music_creator_profiles') return json(r, member ? [{ handle: 'fixture-you', artist_name: 'Fixture You' }] : []);
    if (p === '/rest/v1/analytics_sites') return json(r, []);
    if (p.endsWith('/rpc/action_record')) return json(r, { verified_actions: 3, points: 300, in_progress: 1, missions: [
      { mission_id: '44444444-4444-4444-8444-444444444441', title: 'Write to the river council', status: 'in_progress' },
      { mission_id: '44444444-4444-4444-8444-444444444442', title: 'Help someone reach a real service', status: 'verified' }] });
    if (p === '/rest/v1/action_globe_regions') return json(r, [{ region_key: 'US-CT', region_label: 'Connecticut' }]);
    if (p.endsWith('/rpc/profile_edit_status')) return json(r, editStatus(w));
    if (p.endsWith('/rpc/profile_edit_start')) {
      if (!body || !body.p_changes || !body.p_changes.legal_name || !body.p_consent_version || !body.p_reason) return json(r, { message: 'bad start' }, 400);
      w.edit.latest = { request_id: 'r1', submission_id: SUB, status: 'awaiting_capture', changes: body.p_changes };
      return json(r, { request_id: 'r1', submission_id: SUB, bucket: 'identity-verification-videos', object_path: 'auth-you/' + SUB, challenge_phrase: 'harbor 4821', challenge_expires_at: new Date(Date.now() + 600000).toISOString(), max_seconds: 120, changes: body.p_changes });
    }
    if (p.startsWith('/storage/v1/object/upload/sign/') && m === 'PUT') { w.uploads++; w.uploadPath = p; w.uploadQuery = u.search; w.uploadType = req.headers()['content-type']; w.uploadBytes = (req.postDataBuffer() || Buffer.alloc(0)).length; return json(r, { Key: 'x' }); }
    if (p.startsWith('/storage/v1/object/upload/sign/')) { w.signPath = p; return json(r, { url: '/object/upload/sign/identity-verification-videos/auth-you/' + SUB + '?token=fixture' }); }
    if (p.endsWith('/rpc/identity_finish_submission')) {
      w.finish = body;
      if (!body || !body.p_capture_meta || body.p_capture_meta.source !== 'getUserMedia' || body.p_capture_meta.track_state !== 'live') return json(r, { message: 'only a live camera recording is accepted' }, 400);
      w.edit.latest = Object.assign({}, w.edit.latest, { status: 'submitted', persona_status: null, persona_inquiry: false });
      return json(r, { submission_id: SUB, status: 'submitted' });
    }
    if (p.includes('/rest/v1/action_policy_')) return json(r, []);
    return json(r, []);
  });
  await ctx.route('https://api.mccluster.org/**', (r) => {
    const req = r.request(), u = new URL(req.url()), auth = req.headers().authorization || '';
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    w.requests.push({ m: req.method(), p: u.pathname, auth: !!auth });
    if (u.pathname === '/v1/mnet/public-feed') return json(r, { items: [], next_before: null });
    if (u.pathname.startsWith('/v1/world/layers/')) return json(r, { ok: true, count: 0, aircraft: [], satellites: [], launches: [] });
    if (!/^Bearer \S+/.test(auth)) return json(r, { error: 'Authentication required' }, 401);
    if (u.pathname === '/v1/status') return json(r, { error: 'Owner access required' }, 403);
    if (u.pathname === '/v1/mnet/bootstrap') return json(r, { identity: { m_uid: ME.m_uid, mccluster_id: ME.mccluster_id }, profile: { display_name: ME.display_name, mccluster_id: ME.mccluster_id, headline: 'Writing memos for Connecticut' }, next_step: null, tour_done_at: new Date().toISOString() });
    if (u.pathname === '/v1/mnet/feed') return json(r, { items: [], next_before: null });
    if (u.pathname === '/v1/mnet/notifications') return json(r, { notifications: [{ id: 'n1', type: 'action_policy_memo_review', body: 'The desk asked for changes on your memo.', created_at: new Date().toISOString(), read_at: null }] });
    if (u.pathname === '/v1/creator-billing/entitlement') return json(r, { paid: false, workspaces: [] });
    if (u.pathname === '/v1/analytics/my-creator') return json(r, { ok: true, creator: true, page_traffic: { views: 57, approximate_sessions: 31 }, tracks: [{ title: 'Fixture Song', plays: 12, completions: 5, shares: 2 }], audience: { countries: [{ country: 'US', views: 42 }, { country: 'GB', views: 9 }], elsewhere_views: 4, unknown_views: 2, min_views: 5 }, disclaimer: 'Observed matching events only.' });
    if (u.pathname === '/v1/identity/persona/inquiry') return json(r, { error: 'The government-ID check is not switched on yet', detail: { code: 'PERSONA_DISABLED' } }, 503);
    if (u.pathname === '/v1/mnet/live/directory') return json(r, { sessions: [] });
    return json(r, {});
  });
}

const results = [];
function check(scope, name, ok, detail) { results.push({ scope, name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); }

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const DEVICES = [{ name: '390', viewport: { width: 390, height: 844 }, mobile: true }, { name: '1280', viewport: { width: 1280, height: 800 }, mobile: false }];

async function openPage(device, { member, url }) {
  const w = freshWorld();
  const ctx = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 2, isMobile: device.mobile, hasTouch: device.mobile, permissions: ['camera', 'microphone'] });
  await ctx.addInitScript((m) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() }));
    if (m && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); const exp = Math.floor(Date.now() / 1000) + 3600; const pl = btoa(JSON.stringify({ exp, sub: 'auth-you' })).replace(/=+$/, ''); localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + pl + '.y', refresh_token: 'r', expires_at: exp })); }
  }, member);
  await route(ctx, w, { member });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.appbar', { timeout: 15000 });
  await page.waitForTimeout(1200);
  return { ctx, page, w, errors };
}
const geometry = (page) => page.evaluate(() => {
  const r = (el) => el && el.getBoundingClientRect();
  const desk = r(document.getElementById('huDesk')), bar = r(document.querySelector('.appbar')), world = r(document.getElementById('mnWorld'));
  const tab = document.querySelector('[data-hu-desk]'), tr = r(tab);
  const hit = tr ? document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2) : null;
  const deskShown = !!desk && !document.getElementById('huDesk').hidden;
  return { deskShown, deskBottom: desk && Math.round(desk.bottom), deskTop: desk && Math.round(desk.top), deskLeft: desk && Math.round(desk.left), deskWidth: desk && Math.round(desk.width),
    barTop: bar && Math.round(bar.top), barVisible: !!bar && bar.height > 0 && getComputedStyle(document.querySelector('.appbar')).visibility !== 'hidden',
    tabTappable: !!(hit && tab && (hit === tab || tab.contains(hit))),
    overGlobe: !!(desk && world && desk.top < world.bottom && desk.bottom > world.top && world.height > 0),
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
});

for (const device of DEVICES) {
  /* 1. member: Desk tab on the bar opens the desk over the globe */
  {
    const scope = 'member-' + device.name;
    const { ctx, page, w, errors } = await openPage(device, { member: true, url: '/mnet.html?view=feed' });
    check(scope, 'the Desk tab is on the bottom app bar', await page.isVisible('.appbar [data-hu-desk]'));
    await page.click('.appbar [data-hu-desk]');
    await page.waitForSelector('#huDesk:not([hidden]) .hu-desk__tab', { timeout: 10000 });
    await page.waitForFunction(() => /Policy memos/.test(document.getElementById('huDeskTabs').textContent), null, { timeout: 10000 });
    await page.waitForSelector('#huDeskEditGate h3', { timeout: 10000 });
    await page.waitForTimeout(600);
    let g = await geometry(page);
    check(scope, 'desk opens over the globe', g.deskShown && g.overGlobe, g);
    check(scope, 'the app bar stays visible, below the desk, and tappable', g.barVisible && g.deskBottom <= g.barTop + 1 && g.tabTappable, g);
    check(scope, 'no sideways scroll (scrollWidth === clientWidth)', g.sw === g.cw, g);
    if (device.name === '1280') check(scope, 'a side panel at desktop width', g.deskWidth <= 470 && g.deskLeft > 640, g);
    else check(scope, 'a bottom sheet at phone width', g.deskLeft <= 16 && g.deskWidth >= 350, g);
    const tabs = await page.$$eval('#huDeskTabs button', (b) => b.map((x) => x.textContent));
    check(scope, 'capability matrix: fellow + creator see profile, policy memos, missions, alerts, audience', JSON.stringify(tabs) === JSON.stringify(['Profile', 'Policy memos', 'Missions', 'Alerts', 'Audience']), tabs);
    check(scope, 'URL carries the open desk', /desk=profile/.test(page.url()), page.url());
    await page.screenshot({ path: join(OUT, `desk-profile-${device.name}.png`) });
    await page.click('[data-hu-desk-section="policy"]');
    await page.waitForFunction(() => /Your memos/.test((document.getElementById('ladder') || {}).textContent || ''), null, { timeout: 10000 });
    check(scope, 'the fellow policy memo desk is inside the desk', await page.isVisible('#huDesk #ladder') && /Keep the 7 bus running/.test(await page.textContent('#ladder')));
    g = await geometry(page);
    check(scope, 'policy section: bar still visible and no sideways scroll', g.barVisible && g.sw === g.cw, g);
    await page.screenshot({ path: join(OUT, `desk-policy-${device.name}.png`) });
    await page.click('[data-hu-desk-section="creator"]');
    await page.waitForFunction(() => /Page views/.test(document.getElementById('huDeskBody').textContent), null, { timeout: 10000 });
    const body = await page.textContent('#huDeskBody');
    check(scope, 'creator audience: the Worker numbers, by country above the threshold', /57/.test(body) && /US/.test(body) && /6 more from countries under 5 views/.test(body), body.slice(0, 200));
    await page.screenshot({ path: join(OUT, `desk-creator-${device.name}.png`) });
    await page.click('[data-hu-desk-section="missions"]');
    await page.waitForFunction(() => /Help someone reach a real service/.test(document.getElementById('huDeskBody').textContent), null, { timeout: 10000 });
    check(scope, 'missions in progress and verified', true);
    await page.click('#huDesk [data-hu-desk-close]');
    check(scope, 'closing hides the desk and leaves the bar', !(await geometry(page)).deskShown && await page.isVisible('.appbar') && !/desk=/.test(page.url()));
    check(scope, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }
  /* 2. guest: legacy desk links leave a useful World without member clutter. */
  {
    const scope = 'policy-redirect-' + device.name;
    const { ctx, page, w, errors } = await openPage(device, { member: false, url: '/action-policy.html?region=US-CT' });
    await page.waitForURL(/mnet\.html/, { timeout: 10000 });
    await page.waitForFunction(() => window.HU_DESK && !new URL(location.href).searchParams.has('desk'));
    check(scope, 'legacy Policy URL lands on World without a guest workspace', /mnet\.html/.test(page.url()) && !/desk=/.test(page.url()) && await page.locator('#huDesk').count() === 0, page.url());
    check(scope, 'unrelated query parameters survive', new URL(page.url()).searchParams.get('region') === 'US-CT');
    check(scope, 'no guest Desk control or welcome/policy panel is mounted', await page.locator('[data-hu-desk], #huDesk, #huDeskPolicy').count() === 0);
    const opened = await page.evaluate(() => window.HU_DESK.open('policy'));
    check(scope, 'direct guest open is refused without a sign-in interruption', opened === false && await page.locator('#huDesk').count() === 0 && !(await page.isVisible('#mnSignedOut')));
    await page.evaluate(() => {
      const stale = document.createElement('button'); stale.setAttribute('data-hu-desk', '');
      document.querySelector('.appbar').appendChild(stale);
    });
    await page.waitForFunction(() => !document.querySelector('[data-hu-desk]'));
    check(scope, 'a bar redraw cannot restore a guest Desk button', await page.locator('[data-hu-desk]').count() === 0);
    check(scope, 'no desk capabilities or policy data are fetched for a guest', !w.requests.some(r => /policy_ladder_status|music_creator_state|analytics_sites|creator-billing\/entitlement|action_policy_|action_record/.test(r.p)), w.requests.filter(r => /policy|creator/.test(r.p)));
    const g = await geometry(page);
    check(scope, 'bar visible and no sideways scroll', g.barVisible && g.sw === g.cw, g);
    await page.screenshot({ path: join(OUT, `policy-redirect-guest-${device.name}.png`) });
    check(scope, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }
  /* Auth can change while capability requests are pending. Late answers must
     not put member content back on a now-signed-out World. */
  {
    const scope = 'desk-signout-' + device.name;
    const { ctx, page, errors } = await openPage(device, { member: true, url: '/mnet.html?view=feed' });
    await page.route('**/rest/v1/rpc/music_creator_state', async route => {
      await new Promise(resolve => setTimeout(resolve, 350));
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ creator: true, handle: 'fixture-you' }) });
    });
    await page.evaluate(() => {
      window.HU_DESK.open('creator');
      localStorage.removeItem('mccdb_session');
      window.dispatchEvent(new CustomEvent('mcc:auth-changed', { detail: { signed_in: false } }));
    });
    await page.waitForTimeout(650);
    check(scope, 'sign-out removes desk content and invalidates pending loads', await page.locator('#huDesk, [data-hu-desk]').count() === 0 && await page.evaluate(() => !HU_DESK.isOpen() && HU_DESK.state.caps === null && Object.keys(HU_DESK.state.data).length === 0));
    check(scope, 'sign-out leaves no desk parameter or page errors', !new URL(page.url()).searchParams.has('desk') && errors.length === 0, errors);
    await ctx.close();
  }
  /* 3. an edit request with a live (fake) camera */
  {
    const scope = 'edit-request-' + device.name;
    const { ctx, page, w, errors } = await openPage(device, { member: true, url: '/mnet.html?view=feed&desk=profile' });
    await page.waitForSelector('#huDeskEditGate [data-he-field="legal_name"]', { timeout: 15000 });
    check(scope, 'locked details are listed; no file input anywhere in the desk', /Fixture Person/.test(await page.textContent('#huDeskEditGate')) && (await page.$$('#huDesk input[type=file]')).length === 0);
    await page.fill('[data-he-field="legal_name"]', 'Fixture Q Person');
    await page.fill('#heReason', 'I got married');
    await page.check('#heAgree');
    await page.fill('#heName', 'Fixture Person');
    await page.click('[data-he="camera"]');
    await page.waitForSelector('.hu-desk__code', { timeout: 15000 });
    check(scope, 'the server code is on screen with the script', /harbor 4821/.test(await page.textContent('.hu-desk__challenge')) && /change my legal name/.test(await page.textContent('.hu-desk__challenge')));
    const start = w.requests.find((r) => /profile_edit_start$/.test(r.p));
    check(scope, 'start sends only the change, the reason, the name and the consent version', start && JSON.stringify(start.body.p_changes) === '{"legal_name":"Fixture Q Person"}' && start.body.p_consent_version === 'profile-edit-fixture', start && start.body);
    await page.screenshot({ path: join(OUT, `edit-request-camera-${device.name}.png`) });
    await page.click('[data-he="record"]');
    await page.waitForTimeout(3600);
    await page.click('[data-he="stop"]');
    await page.waitForSelector('#hePlayback', { timeout: 10000 });
    await page.click('[data-he="send"]');
    await page.waitForSelector('[data-he="persona"]', { timeout: 15000 });
    check(scope, 'video uploaded once to the issued path, then finished as a live capture', w.uploads === 1 && w.signPath === '/storage/v1/object/upload/sign/identity-verification-videos/auth-you/' + SUB && w.uploadQuery === '?token=fixture' && w.uploadBytes > 0 && /^video\/(webm|mp4)/.test(w.uploadType || '') && w.finish && w.finish.p_capture_meta.source === 'getUserMedia' && w.finish.p_duration_ms >= 3000, { uploads: w.uploads, bytes: w.uploadBytes, type: w.uploadType, finish: w.finish });
    await page.click('[data-he="persona"]');
    await page.waitForFunction(() => /not switched on yet/.test(document.getElementById('huDeskEditGate').textContent), null, { timeout: 10000 });
    check(scope, 'the ID check says it is not switched on (PERSONA_ENABLED off)', true);
    const g = await geometry(page);
    check(scope, 'bar visible and no sideways scroll during the request', g.barVisible && g.sw === g.cw, g);
    await page.screenshot({ path: join(OUT, `edit-request-sent-${device.name}.png`) });
    check(scope, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
