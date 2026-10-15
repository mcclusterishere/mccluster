/* The World is the feed (owner, 2026-10-15), end to end in a real browser:
   the Full world and the chrome-less "just the globe" mode, the layer access
   map (one free layer for a guest, every other layer shaded), the CCTV lock
   and a live snapshot through the mission gate, the Intel events layer while
   its API is switched off, and the Control Room's 60/40 analytics globe.

   Serves this checkout and fakes api.mccluster.org and Supabase in memory
   (no production call). Renders at 390 and 1280 wide, checks
   scrollWidth === clientWidth, and saves screenshots.

   Run:  node scripts/e2e/world-globe-feed.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR if not resolvable) and network access to
   the Cesium CDN and the imagery tiles. Exits non-zero on any failed check. */
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
function check(scope, name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 400)}`);
  if (!ok) failed++;
}

const FRAME = await readFile(join(ROOT, 'assets/frames/church_0001.jpg'));
const SOURCES = { ok: true, sources: [
  { id: 'cam-1', name: 'Lamar & 5th', city: 'Austin', provider: 'City of Austin', lat: 30.27, lon: -97.75, feedType: 'image', license: 'public' },
  { id: 'cam-2', name: 'I-405 at Sunset', city: 'Los Angeles', provider: 'Caltrans', lat: 34.07, lon: -118.47, feedType: 'image' },
  /* the coordinate bug: a camera with no latitude used to land on the equator (Number(null) is 0) */
  { id: 'cam-3', name: 'No latitude', city: 'Austin', provider: 'X', lat: null, lon: -97.75, feedType: 'image' }
], upstream_total: 3, dropped_without_position: 0 };
/* one real 10° cell (g10:3:-12 = 30..40°N, 120..110°W, around Las Vegas) and one with no centre or edges */
const INTEL = { ok: true, schema: 'mccluster-intel-geo/v1', totals: { records: 9, located: 9, unknown_location: 0, suppressed_records: 0 }, layer: { attribution: ['fixture'] }, buckets: [
  { cell: 'g10:3:-12', cell_center: { lat: 35, lon: -115 }, cell_bounds: [-120, 30, -110, 40], bucket_start: '2026-10-15T00:00:00Z', count: 7 },
  { cell: 'g10:0:-8', cell_center: { lat: null, lon: -75 }, cell_bounds: [null, null, -70, 10], bucket_start: '2026-10-15T00:00:00Z', count: 2 }
] };
const json = (route, body, status = 200, headers = {}) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': '*', ...headers }, body: JSON.stringify(body) });
const FAN_LOCKED = (cctvReason) => [
  { id: 'cctv', reason: cctvReason, next_step: cctvReason === 'privacy_acknowledgement_required' ? 'acknowledge_privacy' : 'complete_a_mission' },
  { id: 'audience', reason: 'creator_business_required', next_step: 'become_a_creator' }
];
const WHIP_LAYER = { min: 'fan', label: 'Whip Equipped transport', operator: 'Whip Equipped LLC', service_live: false, driver_signup_url: 'https://matthew.mccluster.org/whip/driver/' };

async function context(viewport, { member = false, eligible = false, owner = false, intel = false } = {}) {
  const mobile = viewport.width < 600;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript((m) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() }));
    if (m) { const exp = Math.floor(Date.now() / 1000) + 3600; localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: '11111111-1111-4111-8111-111111111111', email: 'owner@test' })).replace(/=+$/, '') + '.y', refresh_token: 'r', expires_at: exp, user: { id: '11111111-1111-4111-8111-111111111111', email: 'owner@test' } })); }
  }, member);
  const calls = [];
  await ctx.route('https://api.mccluster.org/**', (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, auth = req.headers().authorization || '';
    calls.push({ m: req.method(), p, auth: !!auth });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p === '/v1/world/access') return json(route, auth
      ? { level: owner ? 'owner' : 'fan', unlocked_layers: ['flights', 'satellites', 'launches', 'intel', 'music', 'transport'].concat(eligible ? ['cctv'] : []), locked_layers: FAN_LOCKED('privacy_acknowledgement_required').filter((l) => !(eligible && l.id === 'cctv')), layers: { transport: WHIP_LAYER }, approximate_location: { source: 'ip_approximate', country: 'US', region: 'Connecticut', city: 'New Haven', lat: 41.3, lon: -72.9 } }
      : { level: 'public', unlocked_layers: ['flights'], locked_layers: ['satellites', 'launches', 'intel', 'music', 'cctv', 'audience', 'transport'].map((id) => ({ id, reason: 'sign_in_required', next_step: 'sign_in' })), layers: { transport: WHIP_LAYER } });
    if (p === '/v1/world/cctv/eligibility') return json(route, auth ? { eligible, checks: { signed_in: true, privacy_acknowledged: eligible, mission_completed: eligible }, reason: eligible ? null : 'privacy_acknowledgement_required', privacy_version: '2026-09-26' } : { eligible: false, checks: { signed_in: false, privacy_acknowledged: false, mission_completed: false }, reason: 'sign_in_required' });
    if (p === '/v1/world/cctv/sources') return eligible && auth ? json(route, SOURCES) : json(route, { error: 'no' }, 403);
    if (p.startsWith('/v1/world/cctv/frame/')) return eligible && auth ? route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*', 'x-cctv-source': 'upstream-image', 'x-cctv-provider': 'City of Austin', 'last-modified': new Date(Date.now() - 40000).toUTCString(), 'x-cctv-retrieved-at': new Date().toISOString(), 'x-cctv-license': 'public' }, body: FRAME }) : json(route, { error: 'no' }, 403);
    if (p === '/v1/intel/geo') return intel ? json(route, INTEL) : json(route, { code: 'intel_schema_not_ready' }, 503);
    if (p === '/v1/world/layers/flights') return json(route, { ok: true, layer: 'flights', attribution: 'OpenSky Network', count: 2, aircraft: [['a', 'UAL1', -73.9, 40.7, 10000, 250, 90], ['b', 'BAW2', -0.4, 51.5, 11000, 240, 180]] });
    if (p === '/v1/status') return json(route, owner ? { ok: true } : { error: 'no' }, owner ? 200 : 403);
    if (p.startsWith('/v1/analytics/identity')) return json(route, { coverage: { accounts: 9 }, journeys: [...Array(6)].map((_, i) => ({ source: 'x.com', country: 'US', created_at: new Date().toISOString(), email: `a${i}@test` })).concat([{ source: 'direct', country: 'GB' }, { source: 'x.com', country: null }]), tracks: [] });
    return json(route, {});
  });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => {
    const u = new URL(route.request().url()), p = u.pathname;
    if (p === '/auth/v1/user') return json(route, { id: '11111111-1111-4111-8111-111111111111', email: 'owner@test' });
    if (p === '/rest/v1/rpc/action_globe_public_region_missions') return json(route, [{ mission_id: 'm1', title: 'Clean up the Mill River', description: 'Bag a block of shoreline.', action_path: 'show_up', region_key: 'US-CT', region_label: 'Connecticut', latitude: 41.6, longitude: -72.7 }]);
    if (p === '/rest/v1/rpc/analytics_totals') return json(route, [{ page_views: 200, visitors: 90, sessions: 120, events: 900 }]);
    if (p === '/rest/v1/rpc/analytics_top') {
      const dim = JSON.parse(route.request().postData() || '{}').p_dim;
      if (dim === 'country') return json(route, [{ key: 'US', n: 120 }, { key: 'GB', n: 30 }, { key: 'DE', n: 12 }, { key: 'FR', n: 4 }]);
      if (dim === 'source') return json(route, [{ key: 'x.com', n: 40 }, { key: 'direct', n: 30 }]);
      return json(route, []);
    }
    if (p.startsWith('/rest/v1/rpc/')) return json(route, []);
    return json(route, []);
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, calls, errors };
}
/* the bottom app bar is on screen and no globe control sits under it (owner, 2026-10-15: the bar never leaves) */
const barClear = (page) => page.evaluate(() => {
  const bar = document.querySelector('.appbar'); if (!bar) return { bar: false };
  const b = bar.getBoundingClientRect(), cs = getComputedStyle(bar);
  const shown = cs.display !== 'none' && cs.visibility !== 'hidden' && b.height > 0;
  const hits = [...document.querySelectorAll('.globe-controls button, .globe-data button')].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && getComputedStyle(n).display !== 'none' && r.bottom > b.top + 1 && r.top < b.bottom && r.right > b.left && r.left < b.right; }).map((n) => n.id);
  return { bar: shown, top: Math.round(b.top), covered: hits };
});
const widths = (page) => page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
async function settle(frameOrPage) { await frameOrPage.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 25000 }).catch(() => {}); }

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
/* E2E_ONLY=analytics (or guest, bare, member, eligible) reruns one family; the full run is the evidence */
const ONLY = process.env.E2E_ONLY || '';
const runs = (scope) => !ONLY || scope.startsWith(ONLY);
const SIZES = [{ name: '390', viewport: { width: 390, height: 844 } }, { name: '1280', viewport: { width: 1280, height: 800 } }];

for (const size of SIZES) {
  /* 1. guest, Full world: Flights free, every other layer on screen and shaded; a locked tap asks to sign in */
  if (runs('guest')) {
    const { ctx, page, calls, errors } = await context(size.viewport);
    await page.goto(BASE + '/action-globe.html?explore=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__huAccess && window.__huAccess(), null, { timeout: 60000 });
    await settle(page);
    const t = await page.evaluate(() => ['ctlFlights', 'ctlSats', 'ctlLaunch', 'ctlIntel', 'ctlMusic', 'ctlCctv', 'ctlTransport'].map((id) => { const b = document.getElementById(id); const r = b.getBoundingClientRect(); return { id, visible: !b.hidden && r.width > 0, locked: b.classList.contains('is-locked') }; }));
    check(`guest-${size.name}`, 'every layer toggle is on screen', t.every((x) => x.visible), t);
    check(`guest-${size.name}`, 'exactly one free layer (Flights); the rest shaded', JSON.stringify(t.filter((x) => !x.locked).map((x) => x.id)) === '["ctlFlights"]', t);
    await page.click('#ctlCctv', { force: true });
    await page.waitForTimeout(400);
    check(`guest-${size.name}`, 'a locked tap opens the sign-in line, not an error', /Sign in/.test(await page.textContent('#exploreLine')) && !(await page.isHidden('#exploreLine')));
    check(`guest-${size.name}`, 'no CCTV list or frame is ever requested for a guest', !calls.some((c) => /cctv\/(sources|frame)/.test(c.p)));
    await page.click('#ctlFlights');
    await page.waitForFunction(() => window.__huLayerOn && window.__huLayerOn('flights'), null, { timeout: 10000 }).catch(() => {});
    check(`guest-${size.name}`, 'the free layer opens', await page.evaluate(() => window.__huLayerOn('flights')));
    const w = await widths(page);
    check(`guest-${size.name}`, 'no sideways overflow', w.scrollW === w.clientW, w);
    const gb = await barClear(page);
    check(`guest-${size.name}`, 'the app bar is there and covers no globe control', gb.bar && gb.covered.length === 0, gb);
    await page.screenshot({ path: join(OUT, `guest-full-world-${size.name}.png`) });
    check(`guest-${size.name}`, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }
  /* 2. just the globe: no controls, the credit, one way back, and the bottom app bar (it never leaves) */
  if (runs('bare')) {
    const { ctx, page, errors } = await context(size.viewport);
    await page.goto(BASE + '/action-globe.html?explore=1&chrome=0', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.classList.contains('globe-bare'), null, { timeout: 30000 });
    await settle(page); await page.waitForTimeout(800);
    const v = await page.evaluate(() => { const vis = (s) => { const n = document.querySelector(s); if (!n) return false; const r = n.getBoundingClientRect(), cs = getComputedStyle(n); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }; return { bar: vis('.appbar'), controls: vis('.globe-controls'), data: vis('.globe-data'), header: vis('header'), deck: vis('#deck'), exit: vis('#bareExit'), credit: vis('.osm-credit') }; });
    check(`bare-${size.name}`, 'the Earth, the credit, the way back and the app bar', v.bar && !v.controls && !v.data && !v.header && !v.deck && v.exit && v.credit, v);
    const w = await widths(page);
    check(`bare-${size.name}`, 'no sideways overflow', w.scrollW === w.clientW, w);
    await page.screenshot({ path: join(OUT, `just-the-globe-${size.name}.png`) });
    await page.keyboard.press('Escape');
    await page.waitForURL(/explore=1$/, { timeout: 10000 }).catch(() => {});
    check(`bare-${size.name}`, 'Escape brings the chrome back', /action-globe\.html\?explore=1$/.test(page.url()));
    check(`bare-${size.name}`, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }
  /* 3. a member who is not eligible: the lock explains the three requirements */
  if (runs('member')) {
    const { ctx, page, calls, errors } = await context(size.viewport, { member: true });
    await page.goto(BASE + '/action-globe.html?explore=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__huCctv && window.__huCctv().state, null, { timeout: 60000 });
    await settle(page);
    check(`member-${size.name}`, 'CCTV shaded for a member who is not eligible', await page.evaluate(() => document.getElementById('ctlCctv').classList.contains('is-locked')));
    await page.click('#ctlCctv', { force: true });
    await page.waitForSelector('#cctvSheet:not([hidden])', { timeout: 30000 });
    const txt = await page.textContent('#cctvBody');
    check(`member-${size.name}`, 'the lock names all three requirements and a way to meet each', /Signed in/.test(txt) && /Privacy Policy agreed/.test(txt) && /A mission completed/.test(txt) && /I agree to the Privacy Policy/.test(txt) && /Find a mission/.test(txt) && /no verified mission yet/.test(txt), txt.slice(0, 300));
    check(`member-${size.name}`, 'no camera list or frame was requested', !calls.some((c) => /cctv\/(sources|frame)/.test(c.p)));
    const w = await widths(page);
    check(`member-${size.name}`, 'no sideways overflow', w.scrollW === w.clientW, w);
    const mb = await barClear(page);
    check(`member-${size.name}`, 'a signed-in member keeps the app bar on the Full world, clear of the controls', mb.bar && mb.covered.length === 0, mb);
    await page.screenshot({ path: join(OUT, `cctv-locked-${size.name}.png`) });
    /* location consent IS the privacy acknowledgement: one tap records it on the member's own auth record */
    const sbCalls = [];
    page.on('request', (r) => { if (r.url().startsWith('https://zmnhbrjyhxzhkxmhkexs.supabase.co/auth/v1/user') && r.method() === 'PUT') sbCalls.push(r.postData()); });
    await page.click('[data-cctv-privacy]');
    await page.waitForTimeout(800);
    const put = sbCalls[0] ? JSON.parse(sbCalls[0]) : null;
    check(`member-${size.name}`, "agreeing records the privacy version and time on the member's own record, and no position", !!put && put.data && put.data.privacy_policy_version === '2026-09-26' && !!Date.parse(put.data.privacy_acknowledged_at) && !/lat|lon|coords/i.test(sbCalls[0]), sbCalls);
    check(`member-${size.name}`, 'no location-consent route is ever called', !calls.some((c) => /location-consent/.test(c.p)));
    await page.click('#cctvClose');
    /* Whip Equipped: open to a member; rides are not live; drivers are asked to sign up with Whip */
    check(`member-${size.name}`, 'Whip Equipped is open to a signed-in member', !(await page.evaluate(() => document.getElementById('ctlTransport').classList.contains('is-locked'))));
    await page.click('#ctlTransport', { force: true });
    await page.waitForFunction(() => window.__huWhip && window.__huWhip().open, null, { timeout: 10000 }).catch(() => {});
    const whip = await page.textContent('#cctvBody');
    const href = await page.getAttribute('[data-whip-signup]', 'href').catch(() => null);
    check(`member-${size.name}`, 'opening it says rides are not live and offers the driver sign-up', /rides aren’t live yet/.test(whip) && /Are you a driver, or know one\? Have them sign up today/.test(whip) && /Whip Equipped LLC/.test(whip) && !/McCluster/.test(whip) && href === 'https://matthew.mccluster.org/whip/driver/', { whip: whip.slice(0, 300), href });
    check(`member-${size.name}`, 'no ride is requested from anywhere', !calls.some((c) => /\/api\/rides/.test(c.p)));
    const ww = await widths(page);
    check(`member-${size.name}`, 'no sideways overflow with the Whip sheet open', ww.scrollW === ww.clientW, ww);
    await page.screenshot({ path: join(OUT, `whip-not-live-${size.name}.png`) });
    await page.click('#cctvClose');
    await page.click('#ctlIntel', { force: true });
    await page.waitForFunction(() => /Intel events/.test(document.getElementById('cctvTitle').textContent) && !document.getElementById('cctvSheet').hidden, null, { timeout: 15000 }).catch(() => {});
    check(`member-${size.name}`, 'Intel events say honestly they are switched off; nothing drawn', /not switched on yet/.test(await page.textContent('#cctvBody')) && (await page.evaluate(() => window.__huIntel().cells)) === 0);
    check(`member-${size.name}`, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }
  /* 3b. Intel events: one 10° cell drawn exactly where its bounds say; a cell with no centre or edges is never drawn */
  if (runs('intel')) {
    const { ctx, page, errors } = await context(size.viewport, { member: true, intel: true });
    await page.goto(BASE + '/action-globe.html?explore=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__huAccess && window.__huAccess(), null, { timeout: 60000 });
    await settle(page);
    await page.click('#ctlIntel', { force: true });
    await page.waitForFunction(() => window.__huIntel && window.__huIntel().on, null, { timeout: 15000 }).catch(() => {});
    const cells = (await page.evaluate(() => window.__huPlaced())).intel;
    check(`intel-${size.name}`, 'coordinates: g10:3:-12 is the rectangle 120°W..110°W, 30°N..40°N; the null cell is not drawn', cells.length === 1 && JSON.stringify(cells[0].rect) === JSON.stringify([-120, 30, -110, 40]), cells);
    check(`intel-${size.name}`, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }
  /* 4. an eligible member: cameras on the Earth and a live snapshot with its provenance */
  if (runs('eligible')) {
    const { ctx, page, calls, errors } = await context(size.viewport, { member: true, eligible: true });
    await page.goto(BASE + '/action-globe.html?explore=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__huCctv && window.__huCctv().state && window.__huCctv().state.eligible, null, { timeout: 60000 });
    await settle(page);
    await page.click('#ctlCctv', { force: true });
    await page.waitForFunction(() => window.__huCctv().on, null, { timeout: 10000 }).catch(() => {});
    check(`eligible-${size.name}`, 'the cameras are on the Earth', (await page.evaluate(() => window.__huCctv().count)) === 2);
    const placed = (await page.evaluate(() => window.__huPlaced())).cctv;
    const cam1 = placed.find((c) => c.cam === 'cam-1');
    check(`eligible-${size.name}`, 'coordinates: Lamar & 5th is at 30.27°N 97.75°W; the camera with no latitude is not drawn', !!cam1 && Math.abs(cam1.lat - 30.27) < 0.001 && Math.abs(cam1.lon + 97.75) < 0.001 && !placed.some((c) => c.cam === 'cam-3'), placed);
    await page.evaluate(() => window.__huOpenCamera('cam-1'));
    await page.waitForSelector('#cctvBody .cctv-frame img', { timeout: 10000 }).catch(() => {});
    const f = await page.evaluate(() => { const i = document.querySelector('#cctvBody .cctv-frame img'); return { src: i ? i.src.slice(0, 5) : null, w: i ? i.naturalWidth : 0, facts: (document.querySelector('#cctvBody .cctv-facts') || {}).textContent || '' }; });
    check(`eligible-${size.name}`, 'a live snapshot from a blob URL with provider, times, media type and licence', f.src === 'blob:' && f.w > 0 && /City of Austin/.test(f.facts) && /Captured/.test(f.facts) && /Retrieved/.test(f.facts) && /image\/jpeg/.test(f.facts) && /public/.test(f.facts), f);
    check(`eligible-${size.name}`, 'every CCTV call carried the member session', calls.filter((c) => /\/v1\/world\/cctv\//.test(c.p) && c.m !== 'OPTIONS').every((c) => c.auth));
    const w = await widths(page);
    check(`eligible-${size.name}`, 'no sideways overflow', w.scrollW === w.clientW, w);
    await page.screenshot({ path: join(OUT, `cctv-live-snapshot-${size.name}.png`) });
    check(`eligible-${size.name}`, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }
}

/* 5. Control Room Analytics, 60/40: the globe draws only countries with 5+, the panel discloses the rest, selection both ways */
for (const size of SIZES) {
  if (!runs('analytics')) continue;
  const { ctx, page, errors } = await context(size.viewport, { member: true, owner: true });
  await page.goto(BASE + '/control.html#analytics', { waitUntil: 'domcontentloaded' });
  const opened = await page.waitForSelector('#craGlobe', { timeout: 45000 }).then(() => true).catch(() => false);
  check(`analytics-${size.name}`, 'the Analytics tab mounts the globe and the panel', opened);
  if (opened) {
    const frame = page.frame({ url: /surface=analytics/ });
    await page.waitForFunction(() => /On the globe/.test(document.body.textContent) && /United States/.test((document.getElementById('craPanel') || {}).textContent || ''), null, { timeout: 45000 }).catch(() => {});
    if (frame) { await frame.waitForFunction(() => window.__huAnalyticsCount && window.__huAnalyticsCount() > 0, null, { timeout: 45000 }).catch(() => {}); await settle(frame); }
    const drawn = frame ? await frame.evaluate(() => window.__huAnalyticsCount()) : 0;
    check(`analytics-${size.name}`, 'the globe draws US, GB and DE (France, under five, is folded)', drawn === 3, drawn);
    if (frame) {
      const at = (await frame.evaluate(() => window.__huPlaced())).analytics.filter((x) => x.lon !== undefined);
      const us = at.find((x) => x.code === 'US'), gb = at.find((x) => x.code === 'GB');
      /* Natural Earth label points, data/geo/country-label-points.json: US [-97.48, 39.54], GB [-2.12, 54.4] as [lon, lat] */
      check(`analytics-${size.name}`, 'coordinates: the US dot is at 39.54°N 97.48°W and the UK at 54.4°N 2.12°W (lon/lat not swapped)', !!us && Math.abs(us.lat - 39.54) < 0.01 && Math.abs(us.lon + 97.48) < 0.01 && !!gb && Math.abs(gb.lat - 54.4) < 0.01 && Math.abs(gb.lon + 2.12) < 0.01, at);
    }
    const panel = await page.textContent('#craPanel');
    check(`analytics-${size.name}`, 'located, under five and no-country totals are on screen', /On the globe/.test(panel) && /Under 5/.test(panel) && /No country/.test(panel), panel.slice(0, 200));
    const geom = await page.evaluate(() => { const g = document.querySelector('.cra-globe').getBoundingClientRect(), p = document.querySelector('.cra-side').getBoundingClientRect(); return { gw: g.width, pw: p.width, gTop: g.top, pTop: p.top }; });
    if (size.viewport.width >= 1024) check(`analytics-${size.name}`, 'about 60% globe / 40% panel side by side', Math.abs(geom.gw / (geom.gw + geom.pw) - 0.6) < 0.04 && Math.abs(geom.gTop - geom.pTop) < 2, geom);
    else check(`analytics-${size.name}`, 'phone: the globe first, the panel stacked under it', geom.pTop > geom.gTop, geom);
    if (size.viewport.width >= 1024) {
      const stick = await page.evaluate(async () => { const g = document.querySelector('.cra-globe'), side = document.querySelector('.cra-side'); const before = Math.round(g.getBoundingClientRect().top); side.scrollTop = side.scrollHeight; await new Promise((r) => setTimeout(r, 300)); const r = g.getBoundingClientRect(); const out = { before, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, panelScrolled: side.scrollTop }; side.scrollTop = 0; return out; });
      check(`analytics-${size.name}`, 'the globe stays in view while the panel scrolls', stick.panelScrolled > 0 && stick.top === stick.before && stick.top >= 0 && stick.bottom <= stick.vh, stick);
    }
    await page.click('[data-cra-region="GB"]');
    await page.waitForTimeout(500);
    check(`analytics-${size.name}`, 'a row picks the region in the shared filter', (await page.$eval('#craRegion', (s) => s.value)) === 'GB');
    const w = await widths(page);
    check(`analytics-${size.name}`, 'no sideways overflow', w.scrollW === w.clientW, w);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `analytics-60-40-${size.name}.png`) });
  }
  check(`analytics-${size.name}`, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
