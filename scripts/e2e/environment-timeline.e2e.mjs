/* THE PUBLIC TIMELINE IN THE WORLD, END TO END (E=UP event timeline slice S4, 2026-11-19; the record is
   docs/control-plane/EUP-EVENT-TIMELINE.md). mnet.html as a signed-out guest at 390x844, 820x1180 and 1280x800 with the REAL globe
   frame (Cesium inside #mnWorldFrame), every environmental read answered by the REAL Worker handler (handleWorldEnvironment: the
   gate, the public timeline routes, the feed whose quakes now come from the store, the layer routes) over the REAL module policy
   and the five PENDING event store parts in PGlite (scripts/test/support/eup-environment-timeline-plane.mjs, the local stand-in
   for staging, decision D1, default adopted pending Matthew's confirmation). The page's other reads (missions, member posts,
   news) are small fixtures, as scripts/e2e/environment-world.e2e.mjs answers them.

   What it proves, at each width, from a deep link ?view=feed&feed=equity&event=<canonical id>:
     - the link opens the Equity Uprise tab; the missions keep their own list, first and on page one (decision D8); the timeline
       is its own list beside them, from the store;
     - the linked event's post is marked current (aria-current) and the globe selects that same event (one canonical id);
     - a corrected event renders its revision, the provider's update and retrieval times, "Reviewed by USGS" and the official
       correction old -> new; a USGS deletion renders as a tombstone "Withdrawn by USGS on <date>" with no globe object;
     - D9 (default adopted pending Matthew's confirmation): in the tab the news layer is off: the frame says on:false, no news
       shading, no news-heat read by the globe, and a country's card has no news count; leaving the tab brings the news back;
     - Show on globe on another timeline post writes ?feed=equity&event=<id> as one history entry, the same event again adds
       none, and Back marks the linked event again;
     - Global keeps one observation post after at least six other items; nothing scrolls sideways at 390.
   Then, once: a deep link by an alias lands on the canonical id with the address replaced (no new entry); a deep link to an
   unknown event says so in one line; the gate refusing (module disabled) asks the timeline nothing; and behind the sign-in door
   the news layer is off too and comes back when the door closes (carried release item 6).

   Serves this checkout at 127.0.0.1; no production call, no deployment, nothing applied anywhere but PGlite. Run:
     PGLITE_MODULE=<PGlite 0.3.x dist/index.js> CESIUM_DIR=<Build/Cesium of 1.131> node scripts/e2e/environment-timeline.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR if not resolvable). One page at a time. Exits non-zero on any failed check. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTimelinePlane, usgsEvent, API_ORIGIN } from '../test/support/eup-environment-timeline-plane.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'environment-timeline');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

let failed = 0;
const T0 = Date.now();
function check(scope, name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 600)} (t+${Date.now() - T0} ms)`);
  if (!ok) failed++;
}
if (!process.env.PGLITE_MODULE) { check('setup', 'PGLITE_MODULE is set: the proof runs over the in-process plane and is never skipped', false, 'PGLITE_MODULE unset'); process.exit(1); }

/* ---------- the store, as the S3 ingest would leave it (built events, labelled as such) ---------- */
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const A = usgsEvent({ provider_id: 'us7000s4ea', status: 'automatic', observed_at: hoursAgo(2), source_updated_at: hoursAgo(1.9), magnitude: 6.4, magnitude_type: 'mww',
  place: '60 km W of Built Bay, Chile', title: 'M 6.4 - 60 km W of Built Bay, Chile', significance: 700, lon: -72.4, lat: -35.1, depth_km: 22 });
const B = usgsEvent({ provider_id: 'us7000s4eb', observed_at: hoursAgo(3), source_updated_at: hoursAgo(2.9), magnitude: 5.0, magnitude_type: 'mb',
  place: 'Built Ridge offshore', title: 'M 5.0 - Built Ridge offshore', significance: 400, lon: 150.2, lat: 45.3, depth_km: 35 });
const C = usgsEvent({ provider_id: 'us7000s4ec', observed_at: hoursAgo(4), source_updated_at: hoursAgo(3.9), magnitude: 4.8, magnitude_type: 'mb',
  place: '20 km N of Built Town, Turkey', title: 'M 4.8 - 20 km N of Built Town, Turkey', significance: 360, lon: 35.1, lat: 38.9, depth_km: 8 });
const VAN = usgsEvent({ provider_id: 'attn6uqd', status: 'automatic', observed_at: hoursAgo(5), source_updated_at: hoursAgo(4.9), lon: 167.95, lat: -15.12, depth_km: 25,
  magnitude: 6.6, magnitude_type: 'mi', place: 'Vanuatu Islands', title: 'M 6.6 - Vanuatu Islands', significance: 670, net: 'at', code: 'tn6uqd' });
const AID = 'usgs:us7000s4ea', BID = 'usgs:us7000s4eb', CID = 'usgs:us7000s4ec', VID = 'usgs:attn6uqd';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
/* the Worker's own CORS rule answers this test page's origin as it answers the World's sites (the plane's emulated part 4) */
const plane = await createTimelinePlane({ origins: [BASE] });
await plane.install(); await plane.enable(); await plane.setUsgsRule();
await plane.store.ingest([A, B, C, VAN], { fetchedAt: hoursAgo(1.8) });
/* USGS reviews A: magnitude 6.4 -> 6.1, automatic -> reviewed (revision 2) */
await plane.store.ingest([{ ...A, status: 'reviewed', magnitude: 6.1, source_updated_at: hoursAgo(1) }], { fetchedAt: hoursAgo(0.9) });
/* USGS deletes B (a tombstone) */
await plane.store.ingest([{ provider_id: B.provider_id, status: 'deleted' }], { fetchedAt: hoursAgo(0.8) });
/* the Vanuatu event's preferred id moves to us6000u3jl (an alias of the canonical usgs:attn6uqd) */
await plane.store.ingest([{ ...VAN, provider_id: 'us6000u3jl', aliases: ['attn6uqd', 'pt26293000', 'us6000u3jl'], status: 'reviewed', magnitude: 6.3, magnitude_type: 'mww', source_updated_at: hoursAgo(4.5) }], { fetchedAt: hoursAgo(0.7) });
const seed = await plane.get('/v1/world/environment/events', { cache: plane.freshCache() });
check('setup', 'the plane\'s timeline holds the built events: A at revision 2, B as a tombstone (its revision 2), C, the Vanuatu event once by its canonical id',
  seed.status === 200 && JSON.stringify(seed.body.events.map((e) => [e.id, e.revision, e.state])) === JSON.stringify([[AID, 2, 'published'], [BID, 2, 'withdrawn_by_source'], [CID, 1, 'published'], [VID, 2, 'published']]),
  seed.body.events && seed.body.events.map((e) => [e.id, e.revision, e.state]));
plane.freshCache();

/* ---------- the page's other reads (as scripts/e2e/environment-world.e2e.mjs answers them) ---------- */
const TILE = await readFile(join(ROOT, 'assets/img/closet/seek-first/sf-33.jpg'));
const UUID = (n) => `0e1f0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mission = (n, title, created_at) => ({ id: UUID(n), campaign_id: null, title, description: 'Fixture mission: what to do and how to show it.', domain: 'community', difficulty: 1, base_points: 10, proof_required: true, verification_mode: 'review', skills: ['service'], capacity: null, status: 'open', starts_at: null, ends_at: null, kind: 'civic', created_at });
const MISSIONS = [mission(101, 'Fixture mission, the newest', hoursAgo(1.5)), mission(102, 'Fixture mission, midday', hoursAgo(6)), mission(103, 'Fixture mission, yesterday', hoursAgo(30))];
const PEER = { m_uid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mccluster_id: 'fixture.ana', display_name: 'Fixture Ana' };
const POSTS = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => { const at = hoursAgo(k), pid = `dddddddd-dddd-4ddd-8ddd-00000000000${k}`; return { item_type: 'post', post_id: pid, occurred_at: at, actor: PEER, post: { id: pid, body: `Field note ${k}: what we did, what is next, and who can help.`, visibility: 'public', created_at: at, like_count: 0, liked_by_me: false, media_locked: 0 } }; });
const NEWS = [1, 2, 3, 4, 5, 6].map((k) => ({ id: `ffffffff-ffff-4fff-8fff-00000000000${k}`, title: `World story ${k}: councils weigh a budget for public transit`, url: `https://news${k % 2}.example/story/${k}`, domain: `news${k % 2}.example`, seen_at: new Date(Date.now() - k * 900e3).toISOString(), place: 'Hartford, Connecticut, United States', lat: 41.76, lon: -72.68, country: 'US' }));
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });


await mkdir(OUT, { recursive: true });
const launchOptions = process.env.E2E_GL_ARGS === '1' || process.env.CI ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : {};
const browser = await chromium.launch(launchOptions);

async function openPage(size, query, { reducedMotion = 'no-preference' } = {}) {
  const mobile = size.width < 1000;
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', reducedMotion });
  await ctx.addInitScript(() => { localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() })); localStorage.setItem('mnet_tour_seen', '1'); });
  /* every history entry the page writes, and the length it started with (a new tab's first entry is about:blank) */
  await ctx.addInitScript(() => {
    if (window.top !== window) return;
    window.__hist = []; window.__startLength = history.length;
    const push = history.pushState, replace = history.replaceState;
    history.pushState = function (st, t, url) { window.__hist.push(['push', String(url || '')]); return push.apply(this, arguments); };
    history.replaceState = function (st, t, url) { window.__hist.push(['replace', String(url || '')]); return replace.apply(this, arguments); };
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  const errors = [], requests = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (500|503|404|401|403)/.test(t)) errors.push('console: ' + t.slice(0, 300)); });
  /* every request the page and the globe make, with which of them made it */
  page.on('request', (r) => { try { const u = new URL(r.url()); if (u.origin === API_ORIGIN) requests.push({ path: u.pathname, query: u.search, by: r.frame() === page.mainFrame() ? 'page' : 'globe', at: Date.now() }); } catch (e) {} });
  /* the test's own catch-all, registered FIRST; the plane's route (attached after it) answers /v1/world/environment* */
  await page.route((url) => !url.href.startsWith(BASE) && !/(^|\.)cesium\.com$/.test(url.hostname), async (route) => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (url.hostname === 'api.mccluster.org') {
      if (p === '/v1/mnet/public-feed') return json(route, { items: POSTS, scope: 'public', next_before: null });
      if (p === '/v1/world/news') return json(route, { ok: true, items: NEWS, next_before: null, attribution: { name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' } });
      if (p === '/v1/world/place-scope') return json(route, { ok: true, enabled: false, country: null });
      if (p === '/v1/world/news-heat') return json(route, { ok: true, window_hours: 24, countries: { US: 6 }, total: 6, capped: false, posts: {} });
      if (p === '/v1/world/members') return json(route, { ok: true, basis: 'accounts_by_latest_signed_in_ip_place', window_days: 400, exact: false, k: 5, countries: {} });
      if (p === '/v1/world/access') return json(route, { release: { version: 'globe-admin-preview/v1', admin_preview: false }, level: 'public', unlocked_layers: [], locked_layers: [], layers: {} });
      if (p === '/v1/world/ion') return json(route, { available: false });
      if (p === '/v1/status') return json(route, { error: 'Forbidden' }, 403);
      if (p === '/v1/action-archive/docket-516r-2025') return json(route, { ok: false }, 404);
      return json(route, {});
    }
    if (url.hostname.endsWith('.supabase.co')) {
      if (p === '/auth/v1/user') return json(route, { msg: 'no session' }, 401);
      if (p === '/auth/v1/settings') return json(route, { external: { email: true } });
      if (p === '/rest/v1/action_missions') return json(route, MISSIONS);
      return json(route, []);
    }
    if (url.hostname === 'gibs.earthdata.nasa.gov' || url.hostname === 'tile.openstreetmap.org') return route.fulfill({ status: 200, contentType: 'image/jpeg', headers: CORS, body: TILE });
    return route.fulfill({ status: 204, headers: CORS, body: '' });
  });
  await plane.attach(page);
  if (process.env.CESIUM_DIR) await page.route('https://cesium.com/**/Build/Cesium/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.split('/Build/Cesium/')[1];
    if (!rel || rel.includes('..')) return route.abort();
    try { return route.fulfill({ body: await readFile(join(process.env.CESIUM_DIR, rel)), contentType: TYPES[extname(rel)] || 'application/octet-stream' }); }
    catch { return route.abort(); }
  });
  await page.goto(`${BASE}/mnet.html${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.MCC_WORLD_MODE && !!window.MCC_FEED_SCOPE && document.documentElement.classList.contains('mn-world-on'), null, { timeout: 60000 });
  return { ctx, page, errors, requests };
}
async function globeFrame(page) {
  for (let i = 0; i < 600; i++) { const f = page.frames().find((x) => x.url().includes('/action-globe.html')); if (f) return f; await page.waitForTimeout(100); }
  throw new Error('the globe frame never appeared');
}
const until = (target, fn, arg, ms = 20000) => target.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false);
const env = (frame) => frame.evaluate(() => window.__mccEnvironmentLayers && window.__mccEnvironmentLayers());
const news = (frame) => frame.evaluate(() => { const p = window.__huWorldNewsPins ? window.__huWorldNewsPins() : null, s = window.__huCountries ? window.__huCountries() : null, l = document.getElementById('heatLegend'); return { on: p ? p.on : null, tint: p ? p.tint : null, heat: s ? s.heat : 'unread', newsOff: s ? s.newsOff : null, legendHidden: l ? l.hidden : null }; });
const setScope = (page, scope) => page.evaluate((s) => { document.querySelector('#mnFeedScope [data-feed-scope="' + s + '"]').click(); }, scope);
const fits = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
const feedSeq = (page) => page.evaluate(() => [...document.querySelectorAll('#mnFeed > article, #mnFeed > [data-observation-list] > article')].map((a) => a.hasAttribute('data-observation-post') ? 'o:' + a.getAttribute('data-observation-post') : a.hasAttribute('data-mission-post') ? 'm:' + a.getAttribute('data-mission-post') : a.hasAttribute('data-news-id') ? 'n' : a.hasAttribute('data-post-id') ? 'p' : '?'));
const post = (page, id) => page.evaluate((x) => {
  const a = document.querySelector(`#mnFeed [data-observation-post="${x}"]`);
  if (!a) return null;
  const g = a.querySelector('.mn__observation-globe');
  return { timeline: a.hasAttribute('data-timeline-post'), revision: a.getAttribute('data-revision'), current: a.getAttribute('aria-current'), cls: a.className,
    title: (a.querySelector('.mn__observation-post-title') || {}).textContent, body: (a.querySelector('.mn__observation-post-body') || {}).textContent,
    lines: [...a.querySelectorAll('.mn__timeline-line')].map((p) => [p.className.replace('mn__timeline-line', '').trim(), p.textContent]),
    globe: g ? { disabled: g.disabled, label: g.textContent.trim() } : null, source: (a.querySelector('a.mn__observation-source') || {}).href || null };
}, id);
const address = (page) => page.evaluate(() => ({ search: location.search, length: history.length, start: window.__startLength, writes: (window.__hist || []).filter(([, u]) => /event=/.test(u)) }));
const shot = async (page, name) => { try { await page.screenshot({ path: join(OUT, name + '.png') }); } catch (e) {} };

const SIZES = [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1280, height: 800 }];
try {
  /* ---------- the deep link, at every width ---------- */
  for (const size of SIZES) {
    const scope = String(size.width);
    plane.freshCache();
    const { ctx, page, errors, requests } = await openPage(size, `?view=feed&feed=equity&event=${AID}`);
    try {
      const listed = await until(page, (id) => !!document.querySelector(`#mnFeed [data-timeline-post][data-observation-post="${id}"]`), AID, 60000);
      check(scope, 'the deep link opens the Equity Uprise tab and its timeline lists the linked event from the store', listed && await page.evaluate(() => window.MCC_FEED_SCOPE.get()) === 'equity', await address(page));
      /* D8: the missions' own list first, on page one; the timeline its own list beside them */
      const seq = await feedSeq(page), firstObs = seq.findIndex((x) => x.startsWith('o:')), missionsSeen = seq.filter((x) => x.startsWith('m:'));
      check(scope, 'D8: the missions keep their own list, first and whole on page one, before the timeline\'s', missionsSeen.length === MISSIONS.length && firstObs > seq.lastIndexOf(missionsSeen.at(-1)) && seq.slice(0, MISSIONS.length).every((x) => x.startsWith('m:')), seq);
      const order = seq.filter((x) => x.startsWith('o:usgs:'));
      check(scope, 'the timeline\'s USGS posts are the store\'s, newest observation first, each once by its canonical id (the alias never a second post)', JSON.stringify(order) === JSON.stringify([AID, BID, CID, VID].map((x) => 'o:' + x)), order);
      const a = await post(page, AID);
      check(scope, 'the linked post is marked current (aria-current) and carries its revision', !!a && a.current === 'true' && /\bis-current\b/.test(a.cls) && a.revision === '2', a);
      check(scope, 'a corrected event: its title, reviewed by USGS, Revision 2 with the update and retrieval times, and the correction old -> new',
        !!a && a.title === 'M6.1 · 60 km W of Built Bay, Chile' && /Reviewed by USGS/.test(a.body) && /Magnitude: 6\.1 mww/.test(a.body)
        && a.lines.some(([k, t]) => k === '' && /^Revision 2 · USGS updated .+ · Retrieved .+$/.test(t))
        && a.lines.some(([k, t]) => k === 'mn__timeline-correction' && t === 'Corrected by USGS: magnitude 6.4 → 6.1; review automatic → reviewed')
        && a.source === 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000s4ea' && a.globe && !a.globe.disabled, a);
      const b = await post(page, BID);
      check(scope, 'a USGS deletion: a tombstone "Withdrawn by USGS on <date>", no Show on globe, no review or times of a live event',
        !!b && b.timeline && b.lines.some(([k, t]) => k === 'mn__timeline-tombstone' && /^Withdrawn by USGS on .+/.test(t)) && !!b.globe && b.globe.disabled && b.globe.label === 'Withdrawn: not on the globe' && !/Reviewed|Automatic/.test(b.body), b);
      /* the globe: the same canonical id selected */
      const frame = await globeFrame(page);
      const selected = await until(frame, (id) => { const s = window.__mccEnvironmentLayers && window.__mccEnvironmentLayers(); return !!s && s.on && !!s.selected && s.selected.id === id; }, AID, 180000);
      const st = await env(frame);
      check(scope, 'the globe selects the linked event: the same canonical id drives the post and the globe object', selected, st && { on: st.on, selected: st.selected, pendingFocus: st.pendingFocus });
      check(scope, 'the globe draws the store\'s three published quakes (A, C, the Vanuatu event): the tombstone has no globe object', !!st && st.counts.quakes === 3, st && st.counts);
      /* D9: the news layer is off in the tab */
      const quietNews = await until(frame, () => { const p = window.__huWorldNewsPins && window.__huWorldNewsPins(); return !!p && p.on === false && p.tint === false; }, null, 30000);
      const inTab = await news(frame), heatReads = requests.filter((r) => r.by === 'globe' && r.path === '/v1/world/news-heat').length;
      check(scope, 'D9: in the tab the news layer is off: the frame has the news off, no shading or legend, no news-heat read by the globe', quietNews && inTab.heat === null && inTab.legendHidden !== false && inTab.newsOff === true && heatReads === 0, { inTab, heatReads });
      /* the page tells the frame, as its own place card's close button does (the frame hears only its parent page) */
      const tellFrame = (msg) => page.evaluate((m) => document.getElementById('mnWorldFrame').contentWindow.postMessage(m, location.origin), msg);
      await tellFrame({ type: 'hu:select-country', code: 'US' });
      const carded = await until(page, () => { const c = document.getElementById('mnPlaceCard'); return !!c && !c.hidden && /United States/.test(c.textContent) && c.querySelectorAll('.mn__place-stat').length > 0; }, null, 30000);
      const cells = await page.evaluate(() => [...document.querySelectorAll('#mnPlaceCard .mn__place-stat small')].map((s) => s.textContent));
      check(scope, 'D9: a country picked in the tab: its card has no news count (missions, posts and members only), and the feed stays in the tab', carded && !cells.includes('news · 24 h') && cells.includes('missions') && await page.evaluate(() => window.MCC_FEED_SCOPE.get()) === 'equity', cells);
      await tellFrame({ type: 'hu:select-country', code: null });
      await until(page, () => document.getElementById('mnPlaceCard').hidden, null, 10000);
      if (size.width === 390) { const f = await fits(page); check(scope, 'nothing scrolls sideways in the tab at 390', f.sw === f.cw, f); }
      await shot(page, `timeline-deep-link-${scope}`);
      /* the posts themselves: the linked (corrected) event marked, the tombstone under it */
      await page.locator(`#mnFeed [data-observation-post="${AID}"]`).first().scrollIntoViewIfNeeded().catch(() => {});
      await page.evaluate((id) => { const a = document.querySelector(`#mnFeed [data-observation-post="${id}"]`); if (a) window.scrollBy(0, a.getBoundingClientRect().top - 90); }, AID);
      await page.waitForTimeout(300);
      await shot(page, `timeline-posts-${scope}`);
      /* a visitor's choice: Show on globe on C is one history entry; the same again adds none; Back marks A again */
      const before = await address(page);
      const cButton = page.locator(`#mnFeed [data-observation-globe="${CID}"]`).first();
      await cButton.scrollIntoViewIfNeeded();
      await cButton.click();
      const toC = await until(page, (id) => new URLSearchParams(location.search).get('event') === id && document.querySelector(`#mnFeed [data-observation-post="${id}"]`).getAttribute('aria-current') === 'true', CID, 15000);
      const afterC = await address(page);
      check(scope, 'Show on globe on another timeline post writes ?feed=equity&event=<its id> as one history entry and marks it current', toC && afterC.length === before.length + 1 && new URLSearchParams(afterC.search).get('feed') === 'equity', { before, afterC });
      const cOnGlobe = await until(frame, (id) => { const s = window.__mccEnvironmentLayers(); return !!s.selected && s.selected.id === id; }, CID, 30000);
      check(scope, 'and the globe selects that event', cOnGlobe, (await env(frame)).selected);
      await page.locator(`#mnFeed [data-observation-globe="${CID}"]`).first().click();
      await page.waitForTimeout(600);
      check(scope, 'the same event chosen again adds no history entry', (await address(page)).length === afterC.length, await address(page));
      await page.goBack({ waitUntil: 'commit' }).catch(() => {});
      const backToA = await until(page, (id) => new URLSearchParams(location.search).get('event') === id && document.querySelector(`#mnFeed [data-observation-post="${id}"]`).getAttribute('aria-current') === 'true', AID, 15000);
      check(scope, 'Back returns to the linked event: the address names it and its post is marked current again', backToA, await address(page));
      const aAgain = await until(frame, (id) => { const s = window.__mccEnvironmentLayers(); return !!s.selected && s.selected.id === id; }, AID, 30000);
      check(scope, 'and the globe selects it again', aAgain, (await env(frame)).selected);
      /* leaving the tab brings the news back; Global keeps one observation after at least six other items */
      const heatBefore = requests.filter((r) => r.by === 'globe' && r.path === '/v1/world/news-heat').length;
      await setScope(page, 'global');
      const back = await until(frame, () => { const p = window.__huWorldNewsPins(), s = window.__huCountries(); return p.on === true && p.tint === true && !!s.heat && s.heat.total === 6; }, null, 30000);
      check(scope, 'leaving the tab brings the news layer back as it was: on, the tint, the counts read again', back && requests.filter((r) => r.by === 'globe' && r.path === '/v1/world/news-heat').length > heatBefore, await news(frame));
      await until(page, () => document.querySelectorAll('#mnFeed [data-news-id]').length > 0 && document.querySelectorAll('#mnFeed .mn__observation-post').length > 0, null, 30000);
      const global = await feedSeq(page);
      let since = 0, cadence = true;
      for (const x of global) { if (x.startsWith('o:')) { if (since < 6) cadence = false; since = 0; } else since++; }
      check(scope, 'Global keeps one observation post after at least six other items, the significant quakes by their canonical ids', cadence && global.some((x) => x === 'o:' + AID) && !global.some((x) => x === 'o:' + BID || x === 'o:usgs:us6000u3jl'), global);
      if (size.width === 390) { const f = await fits(page); check(scope, 'nothing scrolls sideways on Global at 390', f.sw === f.cw, f); }
      check(scope, 'the timeline was read through the Worker with no credential, and only after the panel\'s feed', requests.some((r) => r.by === 'page' && r.path === '/v1/world/environment/events'), requests.filter((r) => /environment/.test(r.path)).slice(0, 6).map((r) => r.path));
      check(scope, 'no page errors', errors.length === 0, errors.slice(0, 5));
    } finally { await ctx.close(); }
  }

  /* ---------- once: an alias, an unknown event, the gate refusing ---------- */
  {
    const scope = 'alias-390';
    plane.freshCache();
    const { ctx, page, errors } = await openPage(SIZES[0], '?view=feed&event=usgs:us6000u3jl');
    try {
      const landed = await until(page, (id) => new URLSearchParams(location.search).get('event') === id && !!document.querySelector(`#mnFeed [data-observation-post="${id}"][aria-current="true"]`), VID, 60000);
      const at = await address(page);
      check(scope, 'a deep link by an alias lands on the canonical id: the address replaced (no new history entry), the post marked, the tab open', landed && at.length === at.start && at.writes.length === 1 && at.writes[0][0] === 'replace' && new URLSearchParams(at.search).get('feed') === 'equity' && new URLSearchParams(at.search).get('view') === 'feed' && await page.evaluate(() => window.MCC_FEED_SCOPE.get()) === 'equity', at);
      const v = await post(page, VID);
      check(scope, 'its post says the correction the new preferred id brought (old -> new)', !!v && v.lines.some(([k, t]) => k === 'mn__timeline-correction' && /^Corrected by USGS: magnitude 6\.6 → 6\.3; magnitude type mi → mww/.test(t)), v);
      check(scope, 'no page errors', errors.length === 0, errors.slice(0, 5));
    } finally { await ctx.close(); }
  }
  {
    const scope = 'unknown-390';
    plane.freshCache();
    const { ctx, page, errors } = await openPage(SIZES[0], '?view=feed&feed=equity&event=usgs:us0000none');
    try {
      const said = await until(page, () => /That environmental event is not on the timeline\./.test((document.querySelector('#mnFeed [data-timeline-note]') || {}).textContent || ''), null, 60000);
      check(scope, 'a deep link to an event the timeline does not hold says so in one line, above the timeline it does hold', said && await page.evaluate(() => document.querySelectorAll('#mnFeed [data-timeline-post]').length) === 4 && await page.evaluate(() => !document.querySelector('#mnFeed [aria-current="true"]')), null);
      check(scope, 'no page errors', errors.length === 0, errors.slice(0, 5));
    } finally { await ctx.close(); }
  }
  {
    const scope = 'refused-390';
    await plane.disable();
    plane.freshCache();
    const { ctx, page, errors, requests } = await openPage(SIZES[0], `?view=feed&feed=equity&event=${AID}`);
    try {
      for (let i = 0; i < 300 && !requests.some((r) => r.path === '/v1/world/environment'); i++) await page.waitForTimeout(100);
      await page.waitForTimeout(4000);
      const asked = requests.filter((r) => r.path.startsWith('/v1/world/environment/events'));
      check(scope, 'the gate refusing (module disabled): the feed says so and the timeline is never asked, not even for the deep link', asked.length === 0 && requests.some((r) => r.path === '/v1/world/environment'), { asked: asked.length, environment: requests.filter((r) => /environment/.test(r.path)).map((r) => r.path).slice(0, 6) });
      check(scope, 'no timeline post and no marked post', await page.evaluate(() => !document.querySelector('#mnFeed [data-timeline-post]') && !document.querySelector('#mnFeed [aria-current="true"]')), null);
      check(scope, 'no page errors', errors.length === 0, errors.slice(0, 5));
    } finally { await ctx.close(); await plane.enable(); }
  }

  /* ---------- once: behind the sign-in door the news layer is off too (carried release item 6) ---------- */
  {
    const scope = 'door-1280';
    plane.freshCache();
    const { ctx, page, errors } = await openPage(SIZES[2], '?view=feed');
    try {
      const frame = await globeFrame(page);
      const on = await until(frame, () => { const p = window.__huWorldNewsPins && window.__huWorldNewsPins(); return !!p && p.on === true && p.tint === true; }, null, 120000);
      check(scope, 'on Global the news layer is on, with its tint', on, await news(frame));
      await page.click('[data-guest-open="signin"]');
      const opened = await until(page, () => document.documentElement.classList.contains('mn-door-open'), null, 20000);
      const quiet = await until(frame, () => { const p = window.__huWorldNewsPins(), s = window.__huCountries(); return p.on === false && p.tint === false && !s.heat; }, null, 20000);
      check(scope, 'the door open: the backdrop goes as quiet as the tab: the news layer off, no shading, no counts', opened && quiet, await news(frame));
      await shot(page, 'timeline-door-quiet-1280');
      await page.click('#mnSignedOut .wg-back');
      const closed = await until(page, () => !document.documentElement.classList.contains('mn-door-open'), null, 20000);
      const backOn = await until(frame, () => { const p = window.__huWorldNewsPins(), s = window.__huCountries(); return p.on === true && p.tint === true && !!s.heat && s.heat.total === 6; }, null, 30000);
      check(scope, 'the door closed: the news layer is back as it was', closed && backOn, await news(frame));
      check(scope, 'no page errors', errors.length === 0, errors.slice(0, 5));
    } finally { await ctx.close(); }
  }
} finally {
  await browser.close();
  server.close();
  await plane.close();
}
console.log(failed ? `${failed} check(s) failed` : 'every check passed');
process.exit(failed ? 1 : 0);
