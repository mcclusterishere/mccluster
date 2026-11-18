/* THE WORLD'S FIRST VISIT: THE GLOBE AND THE MISSIONS AT ONCE, THE PRIVACY NOTICE AS A BANNER.

   Owner, 2026-11-17 (docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md, "Owner decisions (2026-11-17, answered in
   session)"): "the full-screen 'Privacy before entry' wall on the World becomes the existing banner mode
   (<meta name="mcc-privacy-notice" content="banner">), so the globe and the missions show at once. Analytics stay off until
   the visitor agrees, as before."

   Every other World suite opens as a visitor who has already answered the notice, because each one tests something else.
   This one stores NOTHING before the page loads: no answer to the notice, no session, no tour flag. The page exactly as it
   ships (mnet.html), the real globe (Cesium from CESIUM_DIR, as the other World suites run it), a fake api.mccluster.org
   and Supabase in memory: no production call. At 390x844, 820x1180 and 1280x800 by night, and at 390x844 by day:
   - no full-screen wall: no #mccPrivacyGate, no data-privacy-gate on <html>, the World not hidden;
   - the notice is the bar along the bottom (#mccPrivacyNotice), inside the screen, a small part of it, with
     "I agree & continue", the Privacy Policy and "Not now", each 44 px or more;
   - at once, with no tap: the globe frame on screen with its mission pins drawn, and the mission posts in the feed;
   - with the bar still up, the Equity Uprise tab answers a tap, a mission post brought to the middle of the screen is not
     covered by the bar, and its Details opens the mission;
   - no analytics request (https://api.mccluster.org/v1/collect, the Supabase collect function), no device or acquisition
     record, and MCC_TRACK answers false, through the whole visit;
   - "I agree & continue" closes the bar in place, with no reload and still nothing recorded on that page view; the next
     page view records (so this probe does see analytics when they are allowed);
   - nothing scrolls sideways.
   At 390 also: "Not now" records only that the notice was seen, and the next page view shows neither bar nor wall and still
   records nothing; and a shared mission link (?mission=<id>) as the very first visit opens that mission over the World, with
   the bar and without the wall.

     CESIUM_DIR=/path/to/Build/Cesium node scripts/e2e/world-first-visit.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR if not resolvable). Screenshots and results.json land in outDir. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'world-first-visit');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }
if (!process.env.CESIUM_DIR) {
  console.error('CESIUM_DIR is required: the globe is half of what a first visit must show (a Cesium 1.131 Build/Cesium directory).');
  process.exit(2);
}

/* this checkout, as it ships */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------- the fixture world: three open missions (one pinned by the owner), two public posts, two stories ---------- */
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
const RIDE = '0e1f0000-0000-4000-8000-0000000000a1', RIVER = '0e1f0000-0000-4000-8000-0000000000a2', TREES = '0e1f0000-0000-4000-8000-0000000000a3';
const mission = (id, title, description, domain, created_at) => ({ id, campaign_id: null, title, description, domain, difficulty: 1, base_points: 10, proof_required: true, verification_mode: 'review', skills: ['service'], capacity: null, status: 'open', starts_at: null, ends_at: null, kind: 'civic', created_at });
const MISSIONS = [
  mission(RIDE, 'Give someone a free ride', 'Offer a ride to someone who needs one, and say where you took them.', 'community', ago(3)),
  mission(RIVER, 'Clean up the Mill River', 'Bag a block of shoreline with your neighbours.', 'environment', ago(2)),
  mission(TREES, 'Plant a street tree', 'Join a planting crew and plant one tree.', 'environment', ago(1))
];
const PINS = [{ mission_id: RIVER, title: 'Clean up the Mill River', description: 'Bag a block of shoreline with your neighbours.', action_path: 'show_up', region_key: 'US-CT', region_label: 'Connecticut', latitude: 41.6, longitude: -72.7 }];
const PEER = { m_uid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mccluster_id: 'fixture.ana', display_name: 'Fixture Ana' };
const POSTS = [1, 2].map((k) => ({ item_type: 'post', post_id: `dddddddd-dddd-4ddd-8ddd-0000000000a${k}`, occurred_at: new Date(Date.now() - k * 3600e3).toISOString(), actor: PEER,
  post: { id: `dddddddd-dddd-4ddd-8ddd-0000000000a${k}`, body: `Field note ${k}: what we did, what is next, and who can help.`, visibility: 'public', created_at: new Date(Date.now() - k * 3600e3).toISOString(), like_count: k, liked_by_me: false, media_locked: 0 } }));
const NEWS = [['US', 'Hartford, Connecticut, United States', 41.76, -72.68], ['KE', 'Nairobi, Nairobi Area, Kenya', -1.28, 36.82]]
  .map(([country, place, lat, lon], k) => ({ id: `ffffffff-ffff-4fff-8fff-0000000000a${k + 1}`, title: `World story ${k + 1}: councils weigh a budget for public transit`, url: `https://news${k}.example/story/${k + 1}`, domain: `news${k}.example`, seen_at: new Date(Date.now() - (k + 1) * 900e3).toISOString(), place, lat, lon, country }));

const results = [];
function check(scope, name, ok, detail) {
  results.push({ scope, name, ok: !!ok, ...(ok || detail === undefined ? {} : { detail }) });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${ok || detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 600)}`);
}
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });

/* A visitor who has never been here: a fresh context, nothing seeded. Every analytics request is counted, wherever it goes. */
async function firstVisit(viewport, mobile, path) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const seen = { collect: [], errors: [], navigations: 0 };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
  const cors = (route) => route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  await ctx.route('https://api.mccluster.org/**', (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return cors(route);
    if (p === '/v1/collect') { seen.collect.push('api ' + p); return json(route, { ok: true }); }
    if (p === '/v1/status') return json(route, { error: 'Forbidden' }, 403);
    if (p === '/v1/mnet/public-feed') return json(route, { items: POSTS, scope: 'public', next_before: null });
    if (p === '/v1/world/news') { const c = u.searchParams.get('country'); return json(route, { ok: true, items: c ? NEWS.filter((n) => n.country === c) : NEWS, next_before: null, attribution: { name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' } }); }
    if (p === '/v1/world/place-scope') return json(route, { ok: true, enabled: false, country: null });
    if (p === '/v1/world/news-heat') return json(route, { ok: true, window_hours: 24, countries: { US: 1, KE: 1 }, total: 2, capped: false, posts: {} });
    if (p === '/v1/world/members') return json(route, { ok: true, basis: 'accounts_by_latest_signed_in_ip_place', window_days: 400, exact: false, k: 5, countries: {} });
    if (p === '/v1/world/access') return json(route, { release: { version: 'globe-admin-preview/v1', admin_preview: false }, level: 'public', unlocked_layers: [], locked_layers: [], layers: {} });
    /* production today: the Environmental Justice module is not released */
    if (p === '/v1/world/environment') return json(route, { error: 'module_policy_unavailable' }, 503);
    return json(route, {});
  });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return cors(route);
    if (/\/functions\/v1\/collect$/.test(p)) { seen.collect.push('supabase ' + p); return json(route, { ok: true }); }
    if (p === '/auth/v1/user') return json(route, { msg: 'no session' }, 401);
    if (p === '/rest/v1/action_missions') { const id = (u.searchParams.get('id') || '').replace(/^eq\./, ''); return json(route, id ? MISSIONS.filter((m) => m.id === id) : MISSIONS); }
    if (p === '/rest/v1/action_mission_details') return json(route, []);
    if (p === '/rest/v1/rpc/action_globe_public_region_missions') return json(route, PINS);
    return json(route, []);
  });
  await ctx.route('https://cesium.com/**/Build/Cesium/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.split('/Build/Cesium/')[1];
    if (!rel || rel.includes('..')) return route.abort();
    try { return route.fulfill({ body: await readFile(join(process.env.CESIUM_DIR, rel)), contentType: TYPES[extname(rel)] || 'application/octet-stream' }); }
    catch { return route.abort(); }
  });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => seen.errors.push(e.message));
  page.on('console', (m) => { if (/TypeError|ReferenceError|SyntaxError/.test(m.text())) seen.errors.push(m.text().slice(0, 300)); });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) seen.navigations++; });
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.MCC_FEED_SCOPE && document.documentElement.classList.contains('mn-world-on'), null, { timeout: 60000 });
  return { ctx, page, seen };
}
const globeOf = (page) => page.frame({ url: /action-globe\.html/ });
const fits = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
/* the notice as a visitor meets it, and what it leaves recorded */
const notice = (page) => page.evaluate(() => {
  const bar = document.getElementById('mccPrivacyNotice'), r = bar ? bar.getBoundingClientRect() : null;
  const controls = bar ? [...bar.querySelectorAll('a,button')].map((c) => { const b = c.getBoundingClientRect(); return { text: c.textContent.trim(), href: c.getAttribute('href'), w: Math.round(b.width), h: Math.round(b.height) }; }) : [];
  return {
    wall: !!document.getElementById('mccPrivacyGate') || document.documentElement.hasAttribute('data-privacy-gate'),
    worldShown: getComputedStyle(document.querySelector('main.mn')).visibility === 'visible',
    bar: !!bar, role: bar && bar.getAttribute('role'), label: bar && bar.getAttribute('aria-label'),
    inside: !!r && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && r.top >= 0, share: r ? Math.round((r.height / innerHeight) * 100) : null, controls,
    agreed: MCC_PRIVACY.accepted(), seen: MCC_PRIVACY.seen(),
    device: localStorage.getItem('mcc_device'), acquisition: localStorage.getItem('mcc_acq'), track: typeof window.MCC_TRACK === 'function' ? window.MCC_TRACK('first_visit_probe', {}) : 'missing'
  };
});
/* the visitor's next page view: the World opened again (the software-rendered globe of the last one can hold its tab for a
   while as it goes, so the wait is generous) */
async function nextPageView(page, daylight) {
  await page.goto(`${BASE}/mnet.html?view=feed&daylight=${daylight}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => !!window.MCC_FEED_SCOPE, null, { timeout: 60000 });
}
async function untilCount(list, n, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (list.length >= n) return true; await new Promise((r) => setTimeout(r, 200)); } return list.length >= n; }

const VIEWPORTS = [
  { name: '390', viewport: { width: 390, height: 844 }, mobile: true, daylight: 'night' },
  { name: '820', viewport: { width: 820, height: 1180 }, mobile: true, daylight: 'night' },
  { name: '1280', viewport: { width: 1280, height: 800 }, mobile: false, daylight: 'night' },
  { name: '390-day', viewport: { width: 390, height: 844 }, mobile: true, daylight: 'day' }
];

try {
  for (const device of VIEWPORTS) {
    const scope = `first-visit-${device.name}`;
    const { ctx, page, seen } = await firstVisit(device.viewport, device.mobile, `/mnet.html?view=feed&daylight=${device.daylight}`);
    try {
      await page.waitForSelector('#mccPrivacyNotice', { timeout: 15000 }).catch(() => {});
      const first = await notice(page);
      check(scope, 'no full-screen wall: nothing covers or hides the World', !first.wall && first.worldShown, first);
      check(scope, 'the notice is the bar along the bottom, inside the screen, a small part of it', first.bar && first.role === 'region' && first.label === 'Privacy notice' && first.inside && first.share <= 35, first);
      check(scope, 'the bar offers I agree & continue, the Privacy Policy and Not now, each 44 px or more', JSON.stringify(first.controls.map((c) => c.text)) === JSON.stringify(['I agree & continue', 'Privacy Policy', 'Not now'])
        && first.controls.every((c) => c.w >= 44 && c.h >= 44) && first.controls[1].href === '/privacy.html', first.controls);
      check(scope, 'shown is seen, never agreed', first.seen === true && first.agreed === false, first);

      /* at once, with no tap: the mission posts in the feed, the globe on screen with the missions' pins */
      const posts = await page.waitForFunction((n) => document.querySelectorAll('#mnFeed [data-mission-post]').length === n, MISSIONS.length, { timeout: 30000 }).then(() => true, () => false);
      const shown = await page.evaluate(() => [...document.querySelectorAll('#mnFeed [data-mission-post]')].every((a) => a.getClientRects().length > 0 && getComputedStyle(a).visibility === 'visible'));
      check(scope, 'the mission posts are in the feed at once, visible, no tap needed', posts && shown, { posts, shown });
      const frame = await page.evaluate(() => { const f = document.getElementById('mnWorldFrame'), r = f.getBoundingClientRect(); return { src: f.getAttribute('src'), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), visible: getComputedStyle(f).visibility === 'visible' && r.bottom > 0 && r.top < innerHeight }; });
      const globe = globeOf(page);
      const pins = globe ? await globe.waitForFunction((n) => typeof window.__huMissionPins === 'function' && window.__huMissionPins() === n, PINS.length, { timeout: 60000 }).then(() => true, () => false) : false;
      check(scope, 'the globe is on screen at once and has drawn the missions\' pins for a guest', frame.visible && frame.w > 200 && frame.h > 150 && !/missions=0/.test(frame.src) && pins, { frame, pins });
      if (globe) await globe.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 25000 }).catch(() => {});
      let size = await fits(page);
      check(scope, 'nothing scrolls sideways with the bar up', size.sw === size.cw, size);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.screenshot({ path: join(OUT, `first-visit-${device.name}.png`) });

      /* the World answers with the bar still up */
      await page.click('#mnFeedScope [data-feed-scope="equity"]');
      await page.waitForFunction(() => window.MCC_FEED_SCOPE.get() === 'equity', null, { timeout: 10000 }).catch(() => {});
      await page.waitForSelector('#mnFeed [data-mission-details]', { timeout: 15000 }).catch(() => {});
      const tab = await page.evaluate(() => ({ scope: window.MCC_FEED_SCOPE.get(), pressed: document.querySelector('#mnFeedScope [data-feed-scope="equity"]').getAttribute('aria-pressed'), bar: !!document.getElementById('mccPrivacyNotice') }));
      check(scope, 'the Equity Uprise tab answers a tap while the bar is up', tab.scope === 'equity' && tab.pressed === 'true' && tab.bar, tab);
      const clear = await page.evaluate(async () => {
        const b = document.querySelector('#mnFeed [data-mission-details]');
        b.scrollIntoView({ block: 'center' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { hit: !!hit && (hit === b || b.contains(hit)), on: hit ? (hit.id || hit.className || hit.tagName) : null };
      });
      check(scope, 'a mission post in the middle of the screen is not under the bar', clear.hit, clear);
      await page.click('#mnFeed [data-mission-details]');
      const opened = await page.waitForFunction(() => document.getElementById('mnMissionDialog').open, null, { timeout: 10000 }).then(() => true, () => false);
      const title = await page.evaluate(() => document.getElementById('mnMissionTitle').textContent);
      check(scope, 'Details opens the mission for a first-time guest', opened && MISSIONS.some((m) => m.title === title), { opened, title });
      await page.click('#mnMissionClose').catch(() => {});

      const before = await notice(page);
      check(scope, 'through the whole visit: no analytics request, no device or acquisition record, every track call a no-op', seen.collect.length === 0 && before.device === null && before.acquisition === null && before.track === false && before.agreed === false,
        { collect: seen.collect, device: before.device, acquisition: before.acquisition, track: before.track });

      /* I agree & continue: in place, nothing reloads, and this page view still records nothing */
      const navigations = seen.navigations;
      await page.click('#mccPrivacyNoticeAgree');
      await page.waitForTimeout(3500);
      const agreed = await notice(page);
      check(scope, 'I agree & continue closes the bar in place, with no reload, and is kept', !agreed.bar && agreed.agreed === true && seen.navigations === navigations && !agreed.wall, { agreed, navigations: [navigations, seen.navigations] });
      check(scope, 'nothing is recorded on the page view where the visitor agreed', seen.collect.length === 0 && agreed.device === null, seen.collect);
      /* the next page view records: the probe above would have seen analytics had they run */
      await nextPageView(page, device.daylight);
      const recorded = await untilCount(seen.collect, 1, 15000);
      const after = await notice(page);
      check(scope, 'the next page view records, with no bar and no wall', recorded && !after.bar && !after.wall && typeof after.device === 'string' && after.device.length > 0, { collect: seen.collect.length, after });
      size = await fits(page);
      check(scope, 'nothing scrolls sideways after the answer', size.sw === size.cw, size);
      check(scope, 'no script errors', seen.errors.length === 0, seen.errors);
    } finally { await ctx.close(); }
  }

  /* Not now: seen and nothing more, on this page view and the next */
  {
    const scope = 'not-now-390';
    const { ctx, page, seen } = await firstVisit({ width: 390, height: 844 }, true, '/mnet.html?view=feed&daylight=night');
    try {
      await page.waitForSelector('#mccPrivacyNoticeLater', { timeout: 15000 });
      await page.click('#mccPrivacyNoticeLater');
      const later = await notice(page);
      const stored = await page.evaluate(() => ({ seen: JSON.parse(localStorage.getItem('mcc_privacy_seen') || 'null'), ack: localStorage.getItem('mcc_privacy_ack') }));
      check(scope, 'Not now closes the bar and records only that the notice was seen', !later.bar && !later.wall && later.seen === true && later.agreed === false && !!stored.seen && stored.ack === null, { later, stored });
      await nextPageView(page, 'night');
      await page.waitForTimeout(6000);
      const next = await notice(page);
      check(scope, 'the next page view shows neither bar nor wall, and still records nothing', !next.bar && !next.wall && next.agreed === false && next.track === false && seen.collect.length === 0 && next.device === null, { next, collect: seen.collect });
      check(scope, 'no script errors', seen.errors.length === 0, seen.errors);
    } finally { await ctx.close(); }
  }

  /* a shared mission link is somebody's very first visit */
  {
    const scope = 'shared-mission-390';
    const { ctx, page, seen } = await firstVisit({ width: 390, height: 844 }, true, `/mnet.html?mission=${RIDE}&daylight=night`);
    try {
      const opened = await page.waitForFunction(() => document.getElementById('mnMissionDialog').open, null, { timeout: 30000 }).then(() => true, () => false);
      const state = await page.evaluate(() => ({ title: document.getElementById('mnMissionTitle').textContent, bar: !!document.getElementById('mccPrivacyNotice'),
        wall: !!document.getElementById('mccPrivacyGate') || document.documentElement.hasAttribute('data-privacy-gate'), mission: new URLSearchParams(location.search).get('mission') }));
      check(scope, 'the shared mission opens over the World at once, with the bar and without the wall', opened && state.title === 'Give someone a free ride' && state.bar && !state.wall && state.mission === RIDE, state);
      await page.screenshot({ path: join(OUT, 'first-visit-shared-mission-390.png') });
      check(scope, 'no analytics request', seen.collect.length === 0, seen.collect);
      check(scope, 'no script errors', seen.errors.length === 0, seen.errors);
    } finally { await ctx.close(); }
  }
} catch (error) {
  check('harness', 'ran to completion', false, String(error && error.stack || error).slice(0, 600));
} finally {
  await browser.close();
  server.close();
  await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
}
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
if (failed) process.exitCode = 1;
