/* THE WORLD PAGE AND THE ENVIRONMENTAL GLOBE TOGETHER (slice G1, the integration pass, 2026-11-17): mnet.html as a guest at
   390x844, 820x1180 and 1280x800 with the REAL globe frame (Cesium inside #mnWorldFrame, nothing stubbed), the Environmental
   Justice panel and the feed, every read a fixture (the public feed, the six layer routes, the ShakeMaps, the member posts, the
   news, the missions). Lane L2 proved the page with a stub frame and lane L1 proved the frame under a stand-in host; this is the
   one place both ends meet with the real messages, so a seam between them fails here and nowhere else.

   What it proves, in order, at each width: the significant observation posts in Global from the panel's first feed load; the
   layers off and the loop continuous while the tab is Global; the Equity Uprise tab turns the typed layers on (counts by the
   frame's debug hook), shows the panel's health rows per feed source and per globe layer with the Worker's own words, renders on
   demand once every hold is released, and lists the observations with the missions in one list by time exactly as the pure module
   orders them; the tour starts by itself when the frame is in view (or waits when it is not), pauses on a wheel over the globe
   with the panel saying so, resumes, steps and pauses; choosing a quake in the list focuses the globe (ripple labelled
   illustrative, its bounded hold, the ShakeMap contours, the ShakeMap health row, the tour queue growing when the ShakeMap makes
   the quake significant); a real tap on a fire perimeter answers with the globe-selection card (Captured, Retrieved, Coverage,
   Status, acres, source); Show on globe from the tab and from Global; the 2D map and back; leaving the tab turns the layers
   off; Local, News, the member posts and the guest's People gate are as before; nothing scrolls sideways; no page errors. Then,
   at 390: landing on ?feed=equity (the panel spoke before the globe was ready; hu:globe-ready makes it whole); at 1280, the globe's
   missions read held until a wheel has paused the tour, so the same globe says ready again late and the tour stays paused (review
   RV2-1); reduced motion (no autostart, play refused, focus jumps to the regional frame with a still ripple outline since slice S5, the legend says animations are off); the gate
   refusing the feed and the layers with 503 module_policy_unavailable and 404 module_disabled (the honest line, no panel, no
   posts, every layer in the policy state, no retry); one layer unavailable (perimeters 500) beside the stale natural-events
   layer, both reported truthfully; and the day palette's contrast at every width, with the layer rows and the frame's legend
   measured.

   Release polish (2026-11-18), at every width: the news tint ("News mentions · last 24 h", the countries shaded by their stories)
   shows on Global, steps aside with its legend in the Equity Uprise tab and comes back exactly as it was when the tab is left, by
   night and by day (review V2-M3); CHANGED ON PURPOSE by decision D9 (E=UP event timeline slice S4, 2026-11-19, default adopted
   pending Matthew's confirmation): in the tab the news layer itself is off, so the counts are no longer kept there (no heat, the
   frame's news off) and are read again when the tab is left; the observation list opens on two rows with the first post within one and a
   half screens of the feed's row, its toggle lists all 65 in place and closes again from the keyboard, and the tour's scenes open
   no card in the panel (review V2-M2); Show on globe from Global keeps the clicked event selected over ten seconds of watching,
   where the panel's older selection used to echo back and take the globe (the G1 close-out's flip).

   E=UP slice S0 (2026-11-19; docs/control-plane/EUP-EVENT-TIMELINE.md): the tab's missions and observations are two lists, the
   missions first (decision D8); off (404) and an outage (503) each have their own line on the page and in the frame's legend, and
   four activations of the tab ask the layer routes once; every source answering with nothing has its own line; a perimeter post's
   Show on globe selects its wfigs: perimeter.

   The review of the release polish (2026-11-18): the scene Next brings with the tour paused opens its card and presses its row at
   every width, and under reduced motion Next and Previous each do so without a flight (RP-1); a row chosen with the keyboard deep in
   the open list keeps its place, its pressed state and the focus (RP-2).

   Serves this checkout at 127.0.0.1 and answers api.mccluster.org, Supabase, the NASA tiles and, with CESIUM_DIR, the Cesium CDN
   in memory: no production call, no deployment, no claim beyond what ran. Run:
     CESIUM_DIR=<Build/Cesium of 1.131> node scripts/e2e/environment-world.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR if not resolvable). One page at a time. Exits non-zero on any failed check. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'environment-world');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const FIXTURE_DIR = join(ROOT, 'scripts/e2e/fixtures/environment');
const FIX = {};
for (const name of ['feed', 'feed-empty', 'feed-policy-503', 'feed-policy-404', 'layers-fires', 'layers-perimeters', 'layers-alerts', 'layers-eonet', 'layers-tides', 'shakemap-us7000tyhr', 'shakemap-us7000tyca', 'shakemap-none', 'policy-503', 'policy-404']) FIX[name] = JSON.parse(await readFile(join(FIXTURE_DIR, name + '.json'), 'utf8'));
const P = require(join(ROOT, 'js/world-environment-posts.js'));
const SIGNIFICANT = new Set(FIX.feed.events.filter(P.significance).map((e) => e.id));
const TILE = await readFile(join(ROOT, 'assets/img/closet/seek-first/sf-33.jpg'));
const QUAKE = FIX.feed.events.find((e) => e.id === 'usgs:us7000tyhr');
const NEWEST_QUAKE = FIX.feed.events.find((e) => e.id === 'usgs:fx-gen-50');

/* the page's other reads, as scripts/e2e/world-environment.mjs (harness B) answers them: three open missions whose times fall
   between the fixture's quakes, eight member posts, six news stories */
const UUID = (n) => `0e1f0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mission = (n, title, created_at) => ({ id: UUID(n), campaign_id: null, title, description: 'Fixture mission: what to do and how to show it.', domain: 'community', difficulty: 1, base_points: 10, proof_required: true, verification_mode: 'review', skills: ['service'], capacity: null, status: 'open', starts_at: null, ends_at: null, kind: 'civic', created_at });
const MISSIONS = [mission(101, 'Fixture mission, the newest', '2026-11-17T20:30:00Z'), mission(102, 'Fixture mission, midday', '2026-11-17T12:00:00Z'), mission(103, 'Fixture mission, yesterday', '2026-11-16T09:00:00Z')];
const PEER = { m_uid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mccluster_id: 'fixture.ana', display_name: 'Fixture Ana' };
const POSTS = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => { const at = new Date(Date.now() - k * 3600e3).toISOString(), pid = `dddddddd-dddd-4ddd-8ddd-00000000000${k}`; return { item_type: 'post', post_id: pid, occurred_at: at, actor: PEER, post: { id: pid, body: `Field note ${k}: what we did, what is next, and who can help.`, visibility: 'public', created_at: at, like_count: 0, liked_by_me: false, media_locked: 0 } }; });
const NEWS = [1, 2, 3, 4, 5, 6].map((k) => ({ id: `ffffffff-ffff-4fff-8fff-00000000000${k}`, title: `World story ${k}: councils weigh a budget for public transit`, url: `https://news${k % 2}.example/story/${k}`, domain: `news${k % 2}.example`, seen_at: new Date(Date.now() - k * 900e3).toISOString(), place: 'Hartford, Connecticut, United States', lat: 41.76, lon: -72.68, country: 'US' }));
/* the digests the frame hands the panel from these fixtures, as js/environment-layers.js builds them (the first ten cells, the
   first ten perimeters with their times), so the tab's order by time can be computed here with the same pure module the page uses;
   each digest names the record that speaks for its layer (review G1R-3: the newest retrieval for the fires and the perimeters) */
const firstSource = (body) => (Array.isArray(body.sources) ? body.sources.slice().sort((a, b) => String(b.fetched_at).localeCompare(String(a.fetched_at)))[0] : null) || {};
const DIGEST_LAYERS = {
  fires: { status: 'available', reason: null, fetched_at: firstSource(FIX['layers-fires']).fetched_at, label: firstSource(FIX['layers-fires']).label, url: firstSource(FIX['layers-fires']).url, coverage: firstSource(FIX['layers-fires']).coverage, attribution: firstSource(FIX['layers-fires']).attribution, license: firstSource(FIX['layers-fires']).license, generated_at: FIX['layers-fires'].generated_at, cell_degrees: 1, cells: FIX['layers-fires'].summary.cells.slice(0, 10) },
  perimeters: { status: 'available', reason: null, fetched_at: firstSource(FIX['layers-perimeters']).fetched_at, label: firstSource(FIX['layers-perimeters']).label, url: firstSource(FIX['layers-perimeters']).url, coverage: firstSource(FIX['layers-perimeters']).coverage, attribution: firstSource(FIX['layers-perimeters']).attribution, license: firstSource(FIX['layers-perimeters']).license, top: FIX['layers-perimeters'].perimeters.slice(0, 10).map((p) => { const ring = p.polygons && p.polygons[0] && p.polygons[0][0]; const v = Array.isArray(ring) && Array.isArray(ring[0]) ? ring[0] : [null, null]; return { id: p.id, name: p.name, gis_acres: p.gis_acres, polygon_captured_at: p.polygon_captured_at, last_edited_at: p.last_edited_at, discovered_at: p.discovered_at, lon: v[0], lat: v[1] }; }) }
};

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failed = 0;
const T0 = Date.now();
function check(scope, name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 600)} (t+${Date.now() - T0} ms)`);
  if (!ok) failed++;
}
/* when Cesium stops rendering ("An error occurred while rendering"), the frame records the moment, the error, the camera, the
   mode, the director and the governor, so a stopped globe is diagnosed, never guessed at */
const hookRenderError = (frame) => frame.evaluate(() => {
  if (window.__renderErrorHooked || !window.HuGlobe || !window.HuGlobe.viewer()) return false;
  window.__renderErrorHooked = true;
  const v = window.HuGlobe.viewer();
  /* every flight's options, so a camera that went wrong can be traced to the move that sent it */
  window.__flights = [];
  const flyTo = v.camera.flyTo.bind(v.camera);
  v.camera.flyTo = (o) => { try { const c = v.camera.positionCartographic, d = o && o.destination ? Cesium.Ellipsoid.WGS84.cartesianToCartographic(o.destination) : null; window.__flights.push({ at: Date.now(), from: [c.longitude * 180 / Math.PI, c.latitude * 180 / Math.PI, c.height], to: d ? [d.longitude * 180 / Math.PI, d.latitude * 180 / Math.PI, d.height] : null, duration: o && o.duration, flyOverLongitude: o && o.flyOverLongitude }); if (window.__flights.length > 12) window.__flights.shift(); } catch (e) {} return flyTo(o); };
  v.scene.renderError.addEventListener((scene, err) => {
    const p = v.camera.position, c = v.camera.positionCartographic;
    /* the primitives whose bounding volumes are not finite: the usual way a frustum count becomes NaN */
    const bad = [];
    try {
      const prims = scene.primitives;
      for (let i = 0; i < prims.length; i++) {
        const q = prims.get(i), spheres = [];
        for (const key of ['_boundingSphereWC', '_boundingSpheres', '_boundingVolume', '_boundingVolumeWC', '_boundingVolume2D', '_boundingSphere']) { const x = q[key] || (q._primitive && q._primitive[key]); if (x) spheres.push(...(Array.isArray(x) ? x : [x])); }
        if (spheres.some((b) => b && b.center && (!Number.isFinite(b.center.x) || !Number.isFinite(b.center.y) || !Number.isFinite(b.center.z) || !Number.isFinite(b.radius)))) bad.push({ type: q.constructor && q.constructor.name, show: q.show, count: typeof q.length === 'number' ? q.length : undefined, id: (() => { try { const gi = q.geometryInstances; const first = Array.isArray(gi) ? gi[0] : gi; return first && first.id ? JSON.stringify(first.id).slice(0, 120) : undefined; } catch (e) { return undefined; } })() });
      }
    } catch (e) { bad.push({ error: String(e && e.message) }); }
    window.__renderError = { at: Date.now(), message: String(err && err.message).slice(0, 300), stack: String(err && err.stack).slice(0, 500), position: { x: p.x, y: p.y, z: p.z }, cartographic: { lon: c.longitude * 180 / Math.PI, lat: c.latitude * 180 / Math.PI, height: c.height }, mode: scene.mode, badPrimitives: bad, flights: window.__flights.slice(-4), director: window.__mccSceneDirector && window.__mccSceneDirector(), governor: window.__mccGlobeGovernor && window.__mccGlobeGovernor(), env: (() => { try { const s = window.__mccEnvironmentLayers(); return { selected: s.selected, ripple: s.ripple, built: s.built, lod: s.lod }; } catch (e) { return null; } })() };
  });
  return true;
});
const renderError = (frame) => frame.evaluate(() => window.__renderError || null).catch(() => null);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: CORS, body: JSON.stringify(body) });

const SIZES = [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1280, height: 800 }];
await mkdir(OUT, { recursive: true });
const launchOptions = process.env.E2E_GL_ARGS === '1' || process.env.CI ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : {};
const browser = await chromium.launch(launchOptions);

/* feed: 'available' | '503' | '404' (the gate's answer, for the feed AND the layer routes, as one module policy governs both);
   fail: a layer route that answers 500; query: more of the page's address; holdMissions: a promise the globe's missions read
   waits on, so the frame says hu:globe-ready again only when the check lets it (review RV2-1); init: a script for every frame of
   the page, run before its own */
async function openPage(size, { daylight = 'night', feed = 'available', fail = null, reducedMotion = 'no-preference', query = '', holdMissions = null, init = null } = {}) {
  const mobile = size.width < 1000;
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', reducedMotion });
  await ctx.addInitScript(() => { localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() })); localStorage.setItem('mnet_tour_seen', '1'); });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  const requests = [], errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  /* the browser's own resource log for a deliberate 500/503/404/401/403 fixture answer is the scenario, not an error of the page */
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (500|503|404|401|403)/.test(t)) errors.push('console: ' + t.slice(0, 300)); else if (/TypeError|ReferenceError|SyntaxError/.test(t)) errors.push('console: ' + t.slice(0, 300)); if (process.env.E2E_DEBUG) console.error('console:', m.type(), t.slice(0, 200)); });
  const by = (route) => { try { return route.request().frame() === page.mainFrame() ? 'page' : 'globe'; } catch (e) { return 'unknown'; } };
  const policy = feed === 'available' || feed === 'empty' ? null : FIX['feed-policy-' + feed];
  await page.route((url) => !url.href.startsWith(BASE) && !/(^|\.)cesium\.com$/.test(url.hostname), async (route) => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (url.hostname === 'api.mccluster.org') {
      requests.push({ path: p, by: by(route) });
      if (p === '/v1/world/environment') return policy ? json(route, policy, Number(feed)) : json(route, feed === 'empty' ? FIX['feed-empty'] : FIX.feed);
      const layer = /^\/v1\/world\/environment\/layers\/(fires|perimeters|alerts|eonet|tides)$/.exec(p);
      if (layer) { if (policy) return json(route, policy, Number(feed)); if (fail === layer[1]) return json(route, { error: 'fixture failure' }, 500); return json(route, FIX['layers-' + layer[1]]); }
      const sm = /^\/v1\/world\/environment\/quakes\/([a-z0-9]+)\/shakemap$/.exec(p);
      if (sm) return policy ? json(route, policy, Number(feed)) : json(route, FIX['shakemap-' + sm[1]] || FIX['shakemap-none']);
      if (p.startsWith('/v1/world/environment/')) return json(route, { ok: false, code: 'not_found' }, 404);
      if (p === '/v1/mnet/public-feed') return json(route, { items: POSTS, scope: 'public', next_before: null });
      if (p === '/v1/world/news') return json(route, { ok: true, items: NEWS, next_before: null, attribution: { name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' } });
      if (p === '/v1/world/place-scope') return json(route, { ok: true, enabled: false, country: null });
      // Fixtures testing the retained visual deliberately opt in like the owner would.
      if (p === '/v1/world/display') return json(route, { ok: true, publicNewsHeatMap: true });
      if (p === '/v1/world/news-heat') return json(route, { ok: true, window_hours: 24, countries: { US: 6 }, total: 6, capped: false, posts: {} });
      if (p === '/v1/world/members') return json(route, { ok: true, basis: 'accounts_by_latest_signed_in_ip_place', window_days: 400, exact: false, k: 5, countries: {} });
      if (p === '/v1/world/access') return json(route, { release: { version: 'globe-admin-preview/v1', admin_preview: false }, level: 'public', unlocked_layers: [], locked_layers: [], layers: {} });
      if (p === '/v1/world/ion') return json(route, { available: false });
      if (p === '/v1/status') return json(route, { error: 'Forbidden' }, 403);
      return json(route, {});
    }
    if (url.hostname.endsWith('.supabase.co')) {
      if (p === '/auth/v1/user') return json(route, { msg: 'no session' }, 401);
      if (p === '/auth/v1/settings') return json(route, { external: { email: true } });
      if (holdMissions && p === '/rest/v1/rpc/action_globe_public_region_missions') return holdMissions.then(() => json(route, [])).catch(() => {});
      if (p === '/rest/v1/action_missions') return json(route, MISSIONS);
      return json(route, []);
    }
    if (url.hostname === 'gibs.earthdata.nasa.gov' || url.hostname === 'tile.openstreetmap.org') return route.fulfill({ status: 200, contentType: 'image/jpeg', headers: CORS, body: TILE });
    return route.fulfill({ status: 204, headers: CORS, body: '' });
  });
  if (process.env.CESIUM_DIR) await page.route('https://cesium.com/**/Build/Cesium/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.split('/Build/Cesium/')[1];
    if (!rel || rel.includes('..')) return route.abort();
    try { return route.fulfill({ body: await readFile(join(process.env.CESIUM_DIR, rel)), contentType: TYPES[extname(rel)] || 'application/octet-stream' }); }
    catch { return route.abort(); }
  });
  await page.goto(`${BASE}/mnet.html?view=feed&daylight=${daylight}${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.MCC_WORLD_MODE && !!window.MCC_FEED_SCOPE && document.documentElement.classList.contains('mn-world-on'), null, { timeout: 60000 });
  return { ctx, page, errors, requests };
}
async function globeFrame(page) {
  for (let i = 0; i < 600; i++) {
    const f = page.frames().find((x) => x.url().includes('/action-globe.html'));
    if (f) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('the globe frame never appeared');
}
async function until(target, fn, arg, ms = 20000) { return target.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false); }
const env = (frame) => frame.evaluate(() => window.__mccEnvironmentLayers && window.__mccEnvironmentLayers());
const gov = (frame) => frame.evaluate(() => window.__mccGlobeGovernor && window.__mccGlobeGovernor());
const dir = (frame) => frame.evaluate(() => window.__mccSceneDirector && window.__mccSceneDirector());
async function settle(frame) { await frame.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 60000 }).catch(() => {}); }
async function layersReady(frame, ms = 150000) {
  return until(frame, () => { const s = window.__mccEnvironmentLayers && window.__mccEnvironmentLayers(); return !!s && s.on && s.ready && s.counts.events === 62; }, null, ms);
}
const feedSeq = (page) => page.evaluate(() => [...document.querySelectorAll('#mnFeed > article, #mnFeed > [data-observation-list] > article')].map((a) => a.hasAttribute('data-observation-post') ? 'o:' + a.getAttribute('data-observation-post') : a.hasAttribute('data-mission-post') ? 'm:' + a.getAttribute('data-mission-post') : a.hasAttribute('data-news-id') ? 'n' : a.hasAttribute('data-post-id') ? 'p' : '?'));
/* the page, the panel and the feed must not scroll sideways; the feed's action rows bleed 6 px into the gutter by design */
const fits = (page) => page.evaluate(() => { const feed = document.getElementById('mnFeed'), edge = feed.getBoundingClientRect().right + 0.5; const over = [...feed.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > edge && el.getClientRects().length).slice(0, 8).map((el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.') + '@' + Math.round(el.getBoundingClientRect().right - edge)); return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, psw: document.getElementById('wePanel').scrollWidth, pcw: document.getElementById('wePanel').clientWidth, over }; });
const frameWidths = (frame) => frame.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
/* how much of the frame is in the viewport: the panel's autostart rule asks for a quarter */
const frameVisibleRatio = (page) => page.evaluate(() => { const r = document.getElementById('mnWorldFrame').getBoundingClientRect(); const ix = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)), iy = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)); return r.width && r.height ? Math.round(((ix * iy) / (r.width * r.height)) * 100) / 100 : 0; });
const panelShown = (page) => page.evaluate(() => getComputedStyle(document.getElementById('wePanel')).display !== 'none');
/* the feed strip's tab: the button's own click handler, dispatched directly (after a selection the panel's detail and the frame's
   smooth scroll move the page under a pointer for seconds; lane L2's e2e proved the strip's buttons under real taps) */
const setScope = (page, scope) => page.evaluate((s) => { document.querySelector('#mnFeedScope [data-feed-scope="' + s + '"]').click(); }, scope);
const openTab = async (page) => { await setScope(page, 'equity'); await page.waitForFunction(() => getComputedStyle(document.getElementById('wePanel')).display !== 'none', null, { timeout: 30000 }); };
const healthRows = (page) => page.evaluate(() => [...document.querySelectorAll('#weSources > li')].map((li) => li.textContent));
const rowOf = (rows, re) => rows.find((r) => re.test(r)) || '';
const shot = async (page, name) => { try { await page.screenshot({ path: join(OUT, name + '.png'), fullPage: false }); } catch (e) {} };
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* a time as the panel writes it (local, medium date, short time), the same rule the page uses */
const localTime = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
/* THE NEWS TINT (release polish, review V2-M3): the countries' news shading and its legend inside the frame, as the frame's own hook
   and the legend's DOM say; on Global they show, in the Equity Uprise tab they step aside (since decision D9, slice S4, with the
   news layer itself off: no counts), and leaving the tab brings back exactly what was there */
const tint = (frame) => frame.evaluate(() => {
  const s = window.__huCountries ? window.__huCountries() : null, l = document.getElementById('heatLegend'), p = window.__huWorldNewsPins ? window.__huWorldNewsPins() : null;
  return { lines: s ? s.lines : null, heat: s && s.heat ? { countries: s.heat.countries, total: s.heat.total, shown: s.heat.shown } : null, legend: l ? { hidden: l.hidden, text: l.textContent.trim(), display: getComputedStyle(l).display } : null, news: p ? { on: p.on, tint: p.tint } : null };
});
/* what must be the same before the tab and after it: the shading's counts and visibility, and the legend's (its place on screen
   follows the page's own layout, so its position is not compared) */
const tintSame = (a, b) => JSON.stringify({ heat: a.heat, legend: a.legend }) === JSON.stringify({ heat: b.heat, legend: b.legend });
/* the camera over the whole Earth, settled: there the borders show and so would the shading (js/world-countries.js draws it while the
   borders do), so a tint that is hidden is hidden by the tab, never by the camera's height (the tour flies low) */
const overEarth = async (frame) => { await frame.evaluate(() => window.__huCountriesCam && window.__huCountriesCam.view(-35, 25, 1.2e7)); return until(frame, () => { const s = window.__huCountries && window.__huCountries(); return !!s && s.lines === 1; }, null, 15000); };
const tintShown = (frame) => until(frame, () => { const s = window.__huCountries && window.__huCountries(), l = document.getElementById('heatLegend'); return !!s && !!s.heat && s.heat.countries > 0 && s.heat.shown === true && !!l && l.hidden === false; }, null, 60000);
/* D9 (slice S4), on purpose: in the tab the news layer is off, so no counts are held (s.heat null) where they were kept before */
const tintQuiet = (frame) => until(frame, () => { const s = window.__huCountries && window.__huCountries(), l = document.getElementById('heatLegend'), p = window.__huWorldNewsPins && window.__huWorldNewsPins(); return !!s && !s.heat && !!l && l.hidden === true && !!p && p.on === false && p.tint === false; }, null, 30000);
/* THE LIST OPENS COMPACT (release polish, review V2-M2): the few rows, the toggle under them, and where the first post sits below the
   feed's row; opening the full list where a check needs a row that is not among the few */
const listState = (page) => page.evaluate(() => {
  const row = document.getElementById('mnFeedScope').getBoundingClientRect(), post = document.querySelector('#mnFeed > article'), more = document.getElementById('weMore');
  const mr = more ? more.getBoundingClientRect() : null;
  return { rows: document.querySelectorAll('#weEvents > li').length, more: more ? { hidden: more.hidden, text: more.textContent, expanded: more.getAttribute('aria-expanded'), controls: more.getAttribute('aria-controls'), font: parseFloat(getComputedStyle(more).fontSize), h: Math.round(mr.height), w: Math.round(mr.width) } : null,
    gap: post ? Math.round(post.getBoundingClientRect().top - row.bottom) : null, vh: innerHeight, count: document.getElementById('weCount').textContent };
});
const openList = async (page) => { if ((await page.evaluate(() => { const m = document.getElementById('weMore'); return !!m && !m.hidden && m.getAttribute('aria-expanded') === 'false'; }))) await page.locator('#weMore').click(); };
/* THE REVIEW OF THE RELEASE POLISH (RP-1): the card a step opens, waited for until the globe has arrived at the scene: its title,
   Observed, Retrieved and a link to the source, and its row the one pressed */
const stepCard = (page, title) => until(page, (t) => {
  const d = document.getElementById('weDetail'), x = d.textContent || '', pressed = [...document.querySelectorAll('#weEvents button[aria-pressed="true"] strong')].map((s) => s.textContent);
  return !d.hidden && x.includes(t) && /Observed/.test(x) && /Retrieved/.test(x) && !!d.querySelector('a[href^="https://"]') && pressed.length === 1 && pressed[0] === t;
}, title, 20000);
const panelCard = (page) => page.evaluate(() => ({ card: !document.getElementById('weDetail').hidden, head: (document.getElementById('weDetail').textContent || '').replace(/\s+/g, ' ').slice(0, 120), pressed: [...document.querySelectorAll('#weEvents button[aria-pressed="true"] strong')].map((s) => s.textContent), scene: document.getElementById('weSceneStatus').textContent }));

/* THE PANEL'S SEARCH PLACEHOLDER AND SOURCES SUMMARY (release review, carried into E=UP slice S0: the placeholder "Place or event"
   measured 2.1 to 2.9:1 and the summary "Sources, coverage and limitations" was a 23 px target): the placeholder's own ink on the
   field, and the summary's height */
const panelReadable = (page) => page.evaluate(() => {
  const rgb = (s) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s); return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const input = document.getElementById('weSearch'), summary = document.querySelector('#wePanel details > summary');
  const ink = getComputedStyle(input, '::placeholder').color, ground = getComputedStyle(input).backgroundColor, a = lum(rgb(ink)), b = lum(rgb(ground));
  /* the measured ink is the placeholder's own: the panel's dim ink, not the field's typed ink */
  const probe = document.createElement('span'); probe.style.color = 'var(--we-dim)'; input.parentNode.appendChild(probe);
  const dim = getComputedStyle(probe).color; probe.remove();
  return { placeholder: input.getAttribute('placeholder'), ink, dim, typed: getComputedStyle(input).color, ground, ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100, summary: Math.round(summary.getBoundingClientRect().height * 10) / 10 };
});

/* ---------- the main journey, at every width ---------- */
for (const size of SIZES) {
  const scope = String(size.width);
  const { ctx, page, errors, requests } = await openPage(size);
  /* Global first: the panel read the feed at mount and handed it to the page; the significant observations ride at 1 in 6 */
  const everythingPosts = await until(page, () => document.querySelectorAll('#mnFeed .mn__observation-post').length > 0, null, 30000);
  const everything = await feedSeq(page);
  let since = 0, ratioOk = true;
  for (const x of everything) { if (x.startsWith('o:')) { if (since < 6) ratioOk = false; since = 0; } else since++; }
  check(scope, 'Global carries the significant observation posts from the panel\'s first feed load, one after at least six other items', everythingPosts && ratioOk && everything.some((x) => x.startsWith('o:')) && everything.filter((x) => x.startsWith('o:')).every((x) => SIGNIFICANT.has(x.slice(2))), everything);
  /* the real globe frame, with the layers off while the tab is Global */
  const frame = await globeFrame(page);
  const booted = await until(frame, () => !!window.MCC_ENVIRONMENT_LAYERS && !!window.__mccEnvironmentLayers && !!window.__mccGlobeGovernor && !!window.__mccSceneDirector, null, 120000);
  check(scope, 'the globe frame boots with the typed layers, the governor and the director mounted', booted);
  await hookRenderError(frame);
  await settle(frame);
  const gl = await frame.evaluate(() => { try { const gl = window.HuGlobe.viewer().scene.context._gl; const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { return 'unknown'; } });
  console.log(`INFO [${scope}] WebGL renderer: ${gl}`);
  const offState = await env(frame), offGov = await gov(frame);
  check(scope, 'on Global the environmental layers are off and the globe keeps its continuous loop (byte for byte the old page)', !!offState && offState.on === false && !!offGov && offGov.enabled === false && offGov.mode === 'continuous' && (await frame.evaluate(() => window.HuGlobe.viewer().scene.requestRenderMode === false && document.getElementById('envLegend').hidden === true)), { on: offState && offState.on, governor: offGov });
  /* the news tint on Global, over the whole Earth: the United States shaded by its fixture stories, the legend saying what the
     colours mean */
  await overEarth(frame);
  const tintOn = await tintShown(frame), tintGlobal = await tint(frame);
  check(scope, 'on Global the news tint shows: the countries shaded by their stories and the legend "News mentions · last 24 h"', tintOn && tintGlobal.lines === 1 && tintGlobal.heat.countries === 1 && tintGlobal.heat.total === 6 && tintGlobal.heat.shown === true && /^News mentions · last 24 h/.test(tintGlobal.legend.text), tintGlobal);
  /* the Equity Uprise tab: the panel shows, the layers come on, the frame draws them */
  await openTab(page);
  const ready = await layersReady(frame);
  /* S5-TOUR (event timeline slice S5; vendor/equity-uprise/product-source.lock.json): as the tab first shows the panel, no tour
     control lies under the page's floating app bar or anything else (the release review saw Previous, Next and part of Replay
     under it at 390 px; the tour's group now follows the description) */
  const tourClear = await page.evaluate(() => { window.scrollTo(0, 0); const bar = document.querySelector('nav.appbar'), covered = [], shown = []; for (const id of ['wePlay', 'wePrev', 'weNext', 'weReplay']) { const el = document.getElementById(id), b = el.getBoundingClientRect(); if (b.top >= innerHeight) continue; shown.push(id); for (const [x, y] of [[b.left + 6, b.top + 6], [b.right - 6, b.top + 6], [b.left + 6, Math.min(innerHeight - 1, b.bottom - 6)], [b.right - 6, Math.min(innerHeight - 1, b.bottom - 6)]]) { const t = document.elementFromPoint(x, y); if (t && t !== el && !el.contains(t)) { covered.push(id); break; } } } return { shown, covered, barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null, vh: innerHeight }; });
  check(scope, 'S5-TOUR: as the tab opens, every tour control in view is clear of the floating app bar and of anything else', tourClear.covered.length === 0 && (size.width !== 390 || tourClear.shown.length === 4), tourClear);
  const s = await env(frame), c = s ? s.counts : null;
  check(scope, 'the tab turns the typed layers on and every layer route answers inside the frame', ready, s && s.states);
  check(scope, 'counts match the fixtures: 50 quake discs and dots among 62 events, 600 fire footprints and 20 cells, 50 perimeters with rings, 70 alert polygons (25 zone-only and 5 rejected listed), 11 EONET points, 1 track, 1 polygon, 14 station columns with labels', !!c && c.events === 62 && c.quakes === 50 && c.quakeDiscs === 50 && c.firesNear === 600 && c.cells === 20 && c.perimeters === 50 && c.perimeterRings === 50 && c.alerts.drawn === 70 && c.alerts.zone_only === 25 && c.alerts.rejected === 5 && c.eonetPoints === 11 && c.eonetTracks === 1 && c.eonetPolygons === 1 && c.tides === 14 && c.tideLabels === 14, c);
  check(scope, 'the frame shows its legend, collapsed, naming the quantities, with no logo and no brand', await frame.evaluate(() => { const d = document.getElementById('envLegend'); return !!d && !d.hidden && !d.open && d.querySelectorAll('li').length >= 6 && !d.querySelector('img') && !/Equity Uprise/.test(d.textContent) && /Disc area shows magnitude/.test(d.textContent) && /MLLW, metres/.test(d.textContent); }));
  check(scope, 'with the layers on the governor is enabled with maximumRenderTimeChange 60 (on demand once the tour lets go of the camera, below)', (await gov(frame)).enabled === true && (await gov(frame)).maximumRenderTimeChange === 60, await gov(frame));
  const readable = await panelReadable(page);
  check(scope, 'the panel\'s search placeholder reads 4.5:1 or better on its field (2.1 to 2.9:1 before) and the sources summary is a 44 px target (23 px before)', readable.ink === readable.dim && readable.ratio >= 4.5 && readable.summary >= 44, readable);
  /* the panel's health rows: the four feed sources and the six layers the frame reported, in the Worker's words */
  await page.locator('#wePanel details > summary').first().click();
  const rowsOk = await until(page, () => document.querySelectorAll('#weSources > li').length >= 10, null, 30000);
  const rows = await healthRows(page);
  check(scope, 'health rows: the four feed sources and the six layers the globe reported', rowsOk && rows.length >= 10, rows.map((r) => r.slice(0, 48)));
  const fires = rowOf(rows, /^Fires/), eonetLayer = rowOf(rows, /^Natural events/), tides = rowOf(rows, /^Water levels/), alerts = rowOf(rows, /^Alerts/), eonetFeed = rowOf(rows, /^NASA EONET/);
  check(scope, 'the fires row carries the Worker\'s own words: available, 600 of 600, the VIIRS attribution, CC0', /available/.test(fires) && /600 of 600/.test(fires) && /VIIRS/.test(fires) && /CC0/.test(fires) && /Retrieved .+ · Last success/.test(fires), fires.slice(0, 240));
  check(scope, 'the natural-events layer and the EONET feed source are both stale with the provider reason in plain words, never invented', /stale/.test(eonetLayer) && /refused, failed or answered an error/.test(eonetLayer) && /stale/.test(eonetFeed) && /refused, failed or answered an error/.test(eonetFeed), { layer: eonetLayer.slice(0, 160), feed: eonetFeed.slice(0, 160) });
  check(scope, 'water levels: 14 of 20 documented stations answered; alerts: 70 placed, 25 zone-only listed never placed, 5 rejected', /14 of 20/.test(tides) && /70 with their own polygon/.test(alerts) && /25 name zones only/.test(alerts) && /5 rejected/.test(alerts), { tides: tides.slice(0, 120), alerts: alerts.slice(0, 200) });
  /* review G1R-3: a layer's row renders every source record it carries, each with its own retrieval time; the water levels' readings
     (retrieved 19:56) are never shown with the station catalogue's 08:00, and the two satellites each have their own line */
  const records = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#weSources > li')].filter((li) => li.querySelector('ul.we-records')).map((li) => [li.querySelector(':scope > p strong').textContent, [...li.querySelectorAll('ul.we-records > li')].map((r) => r.textContent)])));
  const tideRecords = records['Water levels'] || [], fireRecords = records.Fires || [];
  check(scope, 'the water-levels row renders the station catalogue and the readings, each with its own retrieval (08:00 and 19:56); the fires row both satellites', tideRecords.length === 2 && /^NOAA CO-OPS stations/.test(tideRecords[0]) && tideRecords[0].includes('Retrieved ' + localTime('2026-11-17T08:00:00.000Z')) && /^NOAA CO-OPS latest water levels/.test(tideRecords[1]) && tideRecords[1].includes('Retrieved ' + localTime('2026-11-17T19:56:00.000Z')) && fireRecords.length === 2 && fireRecords.some((r) => /NOAA-20/.test(r)) && fireRecords.some((r) => /NOAA-21/.test(r)), { tides: tideRecords.map((r) => r.slice(0, 120)), fires: fireRecords.map((r) => r.slice(0, 60)) });
  /* review G1R-10: the panel handed the frame the feed's own provider terms with the pins; the frame keeps no copy of its own */
  check(scope, 'the frame holds the feed providers\' terms the panel sent with the pins (usgs, nws, eonet, nhc)', JSON.stringify((await env(frame)).feedTerms) === JSON.stringify(['eonet', 'nhc', 'nws', 'usgs']), (await env(frame)).feedTerms);
  check(scope, 'no refusal line while the gate allows the layers', await page.evaluate(() => document.getElementById('weLayersNote').hidden === true));
  /* E=UP slice S0 (2026-11-19), changed on purpose (decision D8, default adopted pending Matthew's confirmation): the tab's TWO
     lists, never one by time: the missions first, newest first, a page of twenty, then the observations (the fire areas and the
     largest perimeters from the frame's digests among them) under their own heading, newest first, a page of twenty, exactly as the
     pure module orders them, each clearly typed. One list by time put the missions behind every current observation. */
  await page.waitForFunction(() => document.querySelectorAll('#mnFeed [data-mission-post]').length > 0 && document.querySelectorAll('#mnFeed .mn__observation-post').length > 0, null, { timeout: 30000 });
  const expected = [...MISSIONS].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).map((m) => 'm:' + m.id)
    .concat(P.interleaveByTime([], P.observationPosts({ events: FIX.feed.events, sources: FIX.feed.sources, unavailable: false, layers: DIGEST_LAYERS }, Date.now()), { pageSize: 20 }).map((x) => 'o:' + x.id));
  const tab = await feedSeq(page);
  check(scope, 'the Equity Uprise tab lists the missions first, then the observations in their own list, each newest first, as the pure module orders them (D8)', JSON.stringify(tab) === JSON.stringify(expected), { got: tab, want: expected });
  const lists = await page.evaluate(() => { const sec = document.querySelector('#mnFeed > [data-observation-list]'), h = sec && sec.querySelector('#mnObsHeading'), last = [...document.querySelectorAll('#mnFeed > [data-mission-post]')].pop(); return { heading: h ? h.textContent : null, labelled: sec ? sec.getAttribute('aria-labelledby') : null, after: !!(sec && last && (last.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING)), feedMore: document.getElementById('mnMore').hidden, more: !!(sec && sec.querySelector('[data-observations-more]')) }; });
  check(scope, 'the observations sit after every mission under their own heading, with their own "Show more observations"; the feed\'s Load more stays hidden in the tab', lists.heading === 'Environmental observations' && lists.labelled === 'mnObsHeading' && lists.after && lists.feedMore === true && lists.more === true, lists);
  const heads = await page.evaluate(() => [...document.querySelectorAll('#mnFeed > article, #mnFeed > [data-observation-list] > article')].map((a) => a.hasAttribute('data-observation-post') ? { obs: a.getAttribute('data-observation-post'), sub: a.querySelector('.mn__author-sub').textContent, author: a.querySelector('.mn__author-name').textContent } : { mission: a.getAttribute('data-mission-post'), head: a.querySelector('.mn__author-name').textContent }));
  check(scope, 'every post in the tab is typed: Civic mission or Environmental observation by the Environmental desk, stamped recorded or retrieved', heads.length > 0 && heads.every((h) => h.mission ? /^Civic mission/.test(h.head) : h.author === 'Environmental desk' && /^Environmental observation · /.test(h.sub) && / · (Recorded|Retrieved) /.test(h.sub)), heads.slice(0, 4));
  const newest = heads.find((h) => h.obs === 'usgs:fx-gen-50');
  check(scope, 'the newest mission leads the tab and the newest quake leads the observations, stamped with its recorded time in local time', tab[0] === 'm:' + MISSIONS[0].id && tab.find((x) => x.startsWith('o:')) === 'o:usgs:fx-gen-50' && !!newest && new RegExp('Recorded ' + esc(new Date(NEWEST_QUAKE.observed_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }))).test(newest.sub), newest && newest.sub);
  /* the list opens compact: the first post within about a screen and a half of the feed's row; the toggle opens every observation
     from the keyboard, moves the focus to the first row it revealed, and closes again with the focus kept on it. The gap is measured
     on the panel as a visitor first gets it: the health-row checks above opened "Sources, coverage and limitations", so it is closed
     for the measure and opened again after, for the rest of the journey */
  await page.locator('#wePanel details > summary').first().click();
  await until(page, () => document.querySelector('#wePanel details').open === false, null, 5000);
  const compact = await listState(page);
  check(scope, 'the observation list opens on two rows, with "Show all 65 observations" under them (a 16px, 44px button naming the list it opens)', compact.rows === 2 && !!compact.more && !compact.more.hidden && compact.more.text === 'Show all 65 observations' && compact.more.expanded === 'false' && compact.more.controls === 'weEvents' && compact.more.font >= 16 && compact.more.h >= 44 && /^Showing 2 of 65 observations: the significant ones, newest first\. /.test(compact.count), compact);
  check(scope, 'the first post sits within one and a half screens of the feed\'s row', compact.gap !== null && compact.gap <= 1.5 * compact.vh, { gap: compact.gap, screens: Math.round((compact.gap / compact.vh) * 100) / 100 });
  console.log(`INFO [${scope}] first post ${compact.gap} px below the row (${Math.round((compact.gap / compact.vh) * 100) / 100} screens of ${compact.vh})`);
  if (compact.more) await page.focus('#weMore');
  await page.keyboard.press('Enter');
  const opened = await until(page, () => document.querySelectorAll('#weEvents > li').length === 65 && document.getElementById('weMore').getAttribute('aria-expanded') === 'true', null, 10000);
  const focusOpen = await page.evaluate(() => { const a = document.activeElement, rows = [...document.querySelectorAll('#weEvents > li > button')]; return { index: rows.indexOf(a), text: document.getElementById('weMore').textContent }; });
  check(scope, 'Enter on the toggle lists all 65 observations in place and moves the focus to the first row it revealed', opened && focusOpen.index === compact.rows && focusOpen.text === 'Show fewer observations', { ...focusOpen, shownBefore: compact.rows });
  if (compact.more) await page.focus('#weMore');
  await page.keyboard.press('Space');
  const closed = await until(page, (n) => document.querySelectorAll('#weEvents > li').length === n && document.getElementById('weMore').getAttribute('aria-expanded') === 'false', compact.rows, 10000);
  check(scope, 'Space on the toggle closes the list again and keeps the focus on the toggle', closed && (await page.evaluate(() => document.activeElement === document.getElementById('weMore'))));
  await page.locator('#wePanel details > summary').first().click();
  /* the tour: by itself when the frame is at least a quarter in view, else it waits for Play */
  const ratio = await frameVisibleRatio(page);
  const autostarted = await until(page, () => document.getElementById('wePlay').textContent === 'Pause tour', null, 15000);
  check(scope, ratio >= 0.25 ? 'the tour starts by itself: the frame is in view, the page visible, motion allowed' : 'the tour waits for Play: the frame is not a quarter in view', ratio >= 0.25 ? autostarted : !autostarted, { frameVisible: ratio, autostarted });
  if (!autostarted) { await page.locator('#wePlay').click(); await until(page, () => document.getElementById('wePlay').textContent === 'Pause tour', null, 15000); }
  const d0 = await dir(frame);
  check(scope, 'the significance tour plays its 12 scenes on the globe, newest first, and the panel names the scene', !!d0 && d0.playing === true && d0.queue === 'significant' && d0.total === 12 && /Scene \d+ of 12/.test(await page.locator('#weSceneStatus').textContent()), d0);
  /* the tour's scenes are named by the scene line and open no card in the panel (release polish, V2-M2): watched over the next
     scene, the card stays closed and the list keeps its two rows with none pressed */
  const sceneMoved = await until(frame, (i) => { const d = window.__mccSceneDirector(); return d.playing && d.index !== i; }, d0.index, 20000);
  await page.waitForTimeout(600);
  const tourPanel = await page.evaluate(() => ({ card: !document.getElementById('weDetail').hidden, rows: document.querySelectorAll('#weEvents > li').length, pressed: document.querySelectorAll('#weEvents button[aria-pressed="true"]').length, scene: document.getElementById('weSceneStatus').textContent }));
  check(scope, 'the tour\'s scenes open no card in the panel: the scene line names them, the list keeps its two rows, none pressed', sceneMoved && !tourPanel.card && tourPanel.rows === 2 && tourPanel.pressed === 0 && /Scene \d+ of 12/.test(tourPanel.scene), tourPanel);
  await page.locator('#mnWorldFrame').scrollIntoViewIfNeeded();
  const globeBox = await frame.locator('#globe').boundingBox();
  await page.mouse.move(globeBox.x + globeBox.width / 2, globeBox.y + globeBox.height / 2);
  await page.mouse.wheel(0, 120);
  const pausedByInput = await until(page, () => /you moved the globe/.test(document.getElementById('weSceneStatus').textContent) && document.getElementById('wePlay').textContent === 'Play tour', null, 10000);
  const d1 = await dir(frame);
  check(scope, 'a wheel over the globe pauses the tour; the panel says the visitor moved the globe', pausedByInput && !!d1 && d1.playing === false && d1.reason === 'input', d1);
  /* with the tour paused nothing holds the loop for long: the flight's hold is released, the camera's moveEnd follows, the ripple
     ends on its timer, and the globe draws on demand (a tour under way holds and lets go every few seconds, so this is read here) */
  const tIdle = Date.now();
  const idle = await until(frame, () => { const g = window.__mccGlobeGovernor(); return g.enabled && g.holds.length === 0 && window.HuGlobe.viewer().scene.requestRenderMode === true; }, null, 60000);
  const g0 = await gov(frame);
  console.log(`INFO [${scope}] every hold released ${idle ? Date.now() - tIdle : '>60000'} ms after the pause (software GL: the camera's moveEnd and the ripple's timer set the pace)`);
  check(scope, 'with the tour paused the globe renders on demand: every hold released, requestRenderMode true', idle && g0.mode === 'on-demand', g0);
  /* Next while paused steps one scene (no dwell runs, so the step is exact); Play resumes from there; Pause by the visitor keeps
     the place (the dwell may have advanced the tour by one scene between the read and the press) */
  const indexBefore = (await dir(frame)).index;
  await page.locator('#weNext').click();
  check(scope, 'Next steps to the following scene', await until(frame, (i) => window.__mccSceneDirector().index === (i + 1) % 12 && window.__mccSceneDirector().playing === false, indexBefore, 15000), await dir(frame));
  /* the scene the visitor stepped to is their choice (review of the release polish, RP-1): once the globe has flown there, its card
     opens with Observed, Retrieved and the source, and its row is pressed */
  const stepped = await dir(frame);
  check(scope, 'the scene Next brought, the tour paused, opens its card (Observed, Retrieved, the source) and presses its row', !!stepped && (await stepCard(page, stepped.title)), { scene: stepped && stepped.title, panel: await panelCard(page) });
  await page.locator('#wePlay').click();
  check(scope, 'Play resumes the tour', await until(page, () => document.getElementById('wePlay').textContent === 'Pause tour', null, 15000) && (await dir(frame)).playing === true);
  const indexAtPause = (await dir(frame)).index;
  await page.locator('#wePlay').click();
  const dPaused = await until(page, () => document.getElementById('wePlay').textContent === 'Play tour', null, 10000) ? await dir(frame) : null;
  check(scope, 'Pause stops the tour and keeps its place', !!dPaused && dPaused.playing === false && (dPaused.index === indexAtPause || dPaused.index === (indexAtPause + 1) % 12), dPaused);
  /* with the tour paused the camera stays where it is put: over the whole Earth, where the shading would show, the Equity Uprise
     tab keeps the news tint and its legend hidden; since D9 (slice S4, on purpose) the news layer is off there, so no counts */
  await overEarth(frame);
  const tintOff = await tintQuiet(frame), tintTab = await tint(frame);
  check(scope, 'in the Equity Uprise tab, over the whole Earth, the news tint and its legend stay hidden under the environmental layers; D9: the news layer itself is off, no counts held', tintOff && tintTab.lines === 1 && tintTab.heat === null && tintTab.legend.hidden === true && tintTab.news.on === false && tintTab.news.tint === false, tintTab);
  /* choosing a quake in the list: the globe focuses it, the detail shows the recorded and retrieval times and the source, the
     ripple runs labelled under its bounded hold, the ShakeMap draws and reports, and the tour queue grows */
  await openList(page);
  await page.locator('#weEvents button', { hasText: QUAKE.title }).first().click();
  const focused = await until(frame, () => { const s = window.__mccEnvironmentLayers(); return !!s.selected && s.selected.id === 'usgs:us7000tyhr'; }, null, 20000);
  const r1 = await env(frame), g1 = await gov(frame);
  const detail = await page.locator('#weDetail').textContent();
  check(scope, 'choosing a quake in the list focuses the globe; the detail shows Observed, Retrieved, the magnitude and depth and the USGS page', focused && /Observed/.test(detail) && /Retrieved/.test(detail) && /Magnitude/.test(detail) && /Depth/.test(detail) && (await page.locator('#weDetail a[href^="https://earthquake.usgs.gov/"]').count()) > 0, detail.slice(0, 200));
  check(scope, 'the ripple runs on the selected quake under its bounded env-ripple hold and the legend labels it illustrative', !!r1.ripple && r1.ripple.active && g1.holds.includes('env-ripple') && r1.legend.includes('Ripple is illustrative: not a recording of shaking'), { ripple: r1.ripple, holds: g1.holds });
  const tLines = Date.now();
  const lines = await until(frame, () => window.__mccEnvironmentLayers().counts.shakemapLines === 10 && window.__mccEnvironmentLayers().built, null, 60000);
  console.log(`INFO [${scope}] ShakeMap contours drawn and every primitive built ${lines ? Date.now() - tLines : '>60000'} ms after the list click`);
  const smRow = await until(page, () => [...document.querySelectorAll('#weSources > li')].some((li) => /^ShakeMap/.test(li.textContent) && /available/.test(li.textContent)), null, 15000);
  const smState = await env(frame);
  const building = await frame.evaluate(() => { const prims = window.HuGlobe.viewer().scene.primitives, out = []; for (let i = 0; i < prims.length; i++) { const p = prims.get(i); if (p && 'ready' in p && !p.ready) out.push(p.constructor ? p.constructor.name : 'primitive'); } return out; });
  check(scope, 'the ShakeMap contours draw for the selected quake and the panel gains a ShakeMap health row; the frame\'s legend says modelled', lines && smRow && smState.legend.some((l) => /modelled shaking intensity/.test(l)), { lines, smRow, shakemapLines: smState.counts.shakemapLines, built: smState.built, ready: smState.ready, building, rows: rowOf(await healthRows(page), /^ShakeMap/).slice(0, 120), legend: smState.legend.filter((l) => /ShakeMap/.test(l)).map((l) => l.slice(0, 80)) });
  const queued = await until(frame, () => { const d = window.__mccSceneDirector(); return d.queueIds.includes('usgs:us7000tyhr') && d.total === 12; }, null, 15000);
  check(scope, 'a quake with a ShakeMap becomes significant: the panel re-sends the pins with the flag and the tour queue takes it in (the queue stays capped at 12 scenes, the undated one leaving)', queued, await dir(frame));
  const ended = await until(frame, () => { const s = window.__mccEnvironmentLayers(); return s.ripple === null && !window.__mccGlobeGovernor().holds.includes('env-ripple'); }, null, 12000);
  check(scope, 'the ripple and its hold end on their own within the bound', ended, (await env(frame)).lastRipple);
  /* a real tap on a fire perimeter through the page: the frame's own pick order, the panel's globe-selection card */
  await page.locator('#mnWorldFrame').scrollIntoViewIfNeeded();
  await frame.evaluate(() => window.HuGlobe.viewer().camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-118.75, 34.6, 120000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }));
  await settle(frame); await page.waitForTimeout(800);
  check(scope, 'at 120 km the fire footprints are the near level of detail', await until(frame, () => window.__mccEnvironmentLayers().lod === 'near', null, 5000));
  const box = await frame.locator('#globe').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const picked = await until(frame, () => { const s = window.__mccEnvironmentLayers(); return !!s.selected && s.selected.id === 'wfigs:2026-CAXXX-000001'; }, null, 15000);
  const cardOk = await until(page, () => /Selected on the globe/.test(document.getElementById('weDetail').textContent) && /Fixture Ridge/.test(document.getElementById('weDetail').textContent), null, 10000);
  const card = await page.locator('#weDetail').textContent();
  check(scope, 'a tap on a fire perimeter picks it on the real page; the panel\'s card shows Captured, Retrieved, Coverage, Status, the acres and the source, never an Observed slot', picked && cardOk && /Captured/.test(card) && /Retrieved/.test(card) && /Coverage/.test(card) && /Status\s*available/.test(card) && /45,210\.5/.test(card) && !/Observed/.test(card) && (await page.locator('#weDetail a[href^="https://"]').count()) > 0, card.slice(0, 260));
  /* review G1R-3 through the real spine: a water-level station chosen on the globe answers with the readings' retrieval time (19:56),
     never the station catalogue's (08:00), and the panel's card shows it under Retrieved beside the reading's own Observed time */
  await frame.evaluate(() => window.MCC_ENVIRONMENT_LAYERS.select('coops:8518750', 'pick', { layer: 'tides' }));
  const stationOk = await until(page, () => /Selected on the globe/.test(document.getElementById('weDetail').textContent) && /The Battery/.test(document.getElementById('weDetail').textContent), null, 10000);
  const station = await page.locator('#weDetail').textContent();
  check(scope, 'a station chosen on the globe: the card shows Observed 15:48 and Retrieved 19:56 (the readings), never the catalogue\'s 08:00', stationOk && station.includes('Observed' + localTime('2026-11-17T15:48:00.000Z')) && station.includes('Retrieved' + localTime('2026-11-17T19:56:00.000Z')) && !station.includes(localTime('2026-11-17T08:00:00.000Z')) && /1\.024 m above MLLW/.test(station), station.slice(0, 300));
  /* E=UP slice S0, E2: a perimeter post's Show on globe selects the globe's own perimeter, wfigs:<NIFC id> (the post carried NIFC's
     bare id, so the focus waited for an entry that never came) */
  for (let i = 0; i < 6 && await page.locator('#mnFeed [data-observations-more]').count(); i++) { await page.locator('#mnFeed [data-observations-more]').click(); await page.waitForTimeout(150); }
  const rimPost = await page.evaluate(() => { const b = document.querySelector('#mnFeed [data-observation-post^="wfigs:"] [data-observation-globe]'); return b ? b.getAttribute('data-observation-globe') : null; });
  if (rimPost) { const b = page.locator(`#mnFeed [data-observation-globe="${rimPost}"]`).first(); await b.scrollIntoViewIfNeeded(); await b.click(); }
  const rimShown = !!rimPost && await until(frame, (id) => { const s = window.__mccEnvironmentLayers(); return !!s.selected && s.selected.id === id && s.selected.layer === 'perimeters'; }, rimPost, 20000);
  check(scope, 'a perimeter post\'s Show on globe selects its own wfigs: perimeter on the globe (one id for the post and the globe)', rimShown, { rimPost, selected: (await env(frame)).selected });
  /* Show on globe from the tab */
  const button = page.locator('#mnFeed [data-observation-globe="usgs:fx-gen-50"]').first();
  await button.scrollIntoViewIfNeeded(); await button.click();
  const shown = await until(frame, () => { const s = window.__mccEnvironmentLayers(); return !!s.selected && s.selected.id === 'usgs:fx-gen-50'; }, null, 20000);
  check(scope, 'Show on globe from the tab focuses that event on the globe and the panel opens its row', shown && await until(page, (t) => document.getElementById('weDetail').textContent.includes(t), NEWEST_QUAKE.title, 10000), (await env(frame)).selected);
  /* the 2D map and back */
  await page.locator('#weView2d').click();
  const flat = await until(page, () => document.getElementById('weView2d').getAttribute('aria-pressed') === 'true' && document.getElementById('weView2d').textContent === '2D map', null, 25000);
  const tMorph = Date.now();
  const is2d = await until(frame, () => window.HuGlobe.viewer().scene.mode === Cesium.SceneMode.SCENE2D, null, 40000);
  const morphInfo = await frame.evaluate(async () => { const scene = window.HuGlobe.viewer().scene; let frames = 0; const fn = () => { frames += 1; }; scene.postRender.addEventListener(fn); await new Promise((r) => setTimeout(r, 2000)); scene.postRender.removeEventListener(fn); return { mode: scene.mode, morphTime: scene.morphTime, framesIn2s: frames, requestRenderMode: scene.requestRenderMode, governor: window.__mccGlobeGovernor() }; });
  console.log(`INFO [${scope}] 2D morph ${is2d ? 'completed ' + (Date.now() - tMorph) + ' ms after the toggle' : 'did not complete within 40 s'} ${JSON.stringify(morphInfo).slice(0, 300)}`);
  const c2 = (await env(frame)).counts;
  check(scope, '2D map: the globe morphs, the panel\'s toggle (one label, pressed) follows the globe\'s own state, the layers stay with their counts', flat && is2d && c2.quakeDiscs === 50 && c2.firesNear === 600 && c2.perimeters === 50 && c2.alerts.drawn === 70 && c2.tides === 14, { flat, is2d, c2 });
  await page.locator('#weView2d').click();
  check(scope, 'back to the 3D globe', await until(page, () => document.getElementById('weView2d').getAttribute('aria-pressed') === 'false' && document.getElementById('weView2d').textContent === '2D map', null, 25000) && await until(frame, () => window.HuGlobe.viewer().scene.mode === Cesium.SceneMode.SCENE3D, null, 25000));
  const dims = await fits(page), fw = await frameWidths(frame);
  check(scope, 'nothing scrolls sideways: the page, the panel, the feed and the frame', dims.sw === dims.cw && dims.psw <= dims.pcw && dims.over.every((x) => /^div\.mn__post-actions@[1-6]$/.test(x)) && fw.scrollW === fw.clientW, { dims, frame: fw });
  await shot(page, `environment-world-tab-${scope}`);
  /* leaving the tab: layers off, director stopped, continuous loop, legend hidden, panel hidden */
  await setScope(page, 'global');
  const off = await until(frame, () => !window.__mccEnvironmentLayers().on && !window.__mccGlobeGovernor().enabled && !window.__mccSceneDirector().playing, null, 15000);
  check(scope, 'leaving the tab turns the layers off, stops the director, restores the continuous loop and hides the legend and the panel', off && (await frame.evaluate(() => document.getElementById('envLegend').hidden === true && window.HuGlobe.viewer().scene.requestRenderMode === false)) && !(await panelShown(page)), await gov(frame));
  await overEarth(frame);
  const tintBack = await tintShown(frame), tintAfter = await tint(frame);
  check(scope, 'leaving the tab brings the news tint and its legend back exactly as they were on Global', tintBack && tintSame(tintAfter, tintGlobal), { before: tintGlobal, after: tintAfter });
  /* Show on globe from Global: the feed turns to the tab, the layers come back and the globe honours the focus once they arrive */
  await page.waitForFunction(() => document.querySelectorAll('#mnFeed .mn__observation-post [data-observation-globe]').length > 0, null, { timeout: 20000 });
  const firstId = await page.evaluate(() => document.querySelector('#mnFeed .mn__observation-post [data-observation-globe]').getAttribute('data-observation-globe'));
  const wantId = firstId.startsWith('firecell:') ? 'cell:' + firstId.slice('firecell:'.length) : firstId;
  /* every change of the globe's selection from just before the click, sampled every 50 ms in the frame */
  await frame.evaluate(() => { clearInterval(window.__selTimer); window.__sel = []; let last; const tick = () => { const s = window.__mccEnvironmentLayers(), id = s.selected ? s.selected.id : null; if (id !== last) { window.__sel.push({ at: Date.now(), id }); last = id; } }; tick(); window.__selTimer = setInterval(tick, 50); });
  await page.locator('#mnFeed [data-observation-globe]').first().click();
  const refocused = await until(frame, (id) => { const s = window.__mccEnvironmentLayers(); return s.on && !!s.selected && s.selected.id === id; }, wantId, 40000);
  check(scope, 'Show on globe from Global turns the feed to the Equity Uprise tab, brings the layers back and focuses the event', (await page.evaluate(() => window.MCC_FEED_SCOPE.get())) === 'equity' && refocused && (await panelShown(page)), { firstId, selected: (await env(frame)).selected });
  /* the G1 close-out's flip: the panel held the event chosen earlier (fx-gen-50) and its pins carried it after the focus, so the two
     echoed between panel and globe for as long as the page was open. Watched for ten seconds after the clicked event was first
     selected, the globe's selection never leaves it, and the panel shows it */
  await page.waitForTimeout(10000);
  const history = await frame.evaluate(() => { clearInterval(window.__selTimer); return window.__sel; });
  const first = history.findIndex((x) => x.id === wantId), after = first >= 0 ? history.slice(first) : [];
  const panelNow = await page.evaluate(() => ({ detail: (document.getElementById('weDetail').textContent || '').slice(0, 120), pressed: [...document.querySelectorAll('#weEvents button[aria-pressed="true"] strong')].map((b) => b.textContent) }));
  const wantTitle = (FIX.feed.events.find((e) => e.id === wantId) || {}).title;
  check(scope, 'the clicked event stays selected: ten seconds on, the globe never went back to the event the panel held before, and the panel shows the clicked one', first >= 0 && after.every((x) => x.id === wantId) && (await env(frame)).selected?.id === wantId && !!wantTitle && panelNow.detail.includes(wantTitle) && JSON.stringify(panelNow.pressed) === JSON.stringify([wantTitle]), { history: history.map((x) => x.id), panel: panelNow });
  /* nothing else regresses: Local, News, the member posts, a guest's People */
  await setScope(page, 'local');
  await page.waitForTimeout(600);
  const local = await page.evaluate(() => ({ text: document.getElementById('mnFeed').textContent.slice(0, 160), panel: getComputedStyle(document.getElementById('wePanel')).display, observations: document.querySelectorAll('#mnFeed .mn__observation-post').length }));
  check(scope, 'Local is as before (no country picked: its line), no observation post there and the panel hidden', /Tap a country/.test(local.text) && local.panel === 'none' && local.observations === 0, local);
  await setScope(page, 'news');
  check(scope, 'News still lists the stories and carries no observation post', await until(page, () => document.querySelectorAll('#mnFeed [data-news-id]').length >= 1, null, 15000) && (await page.locator('#mnFeed .mn__observation-post').count()) === 0);
  await setScope(page, 'global');
  check(scope, 'Global still carries the member posts and the news between them', await until(page, () => document.querySelectorAll('#mnFeed [data-post-id]').length >= 1 && document.querySelectorAll('#mnFeed [data-news-id]').length >= 1, null, 15000));
  await page.locator('[data-mn-view="discover"]:visible').first().click();
  check(scope, 'People asks a guest to sign in, as before', await until(page, () => !!document.getElementById('mnGuestWhy') && document.getElementById('mnGuestWhy').textContent === 'Sign in to find people.', null, 10000));
  /* changed on purpose by E=UP slice S4: the page's one other read under the environment is its own timeline (/events, the event
     store's public page; js/world-environment-timeline.js), never a layer route */
  check(scope, 'the frame never requested the feed route and the page never requested a layer route (the timeline\'s own /events read aside)', !requests.some((r) => r.by === 'globe' && r.path === '/v1/world/environment') && !requests.some((r) => r.by === 'page' && r.path.startsWith('/v1/world/environment/') && !/^\/v1\/world\/environment\/events(\/|$)/.test(r.path)) && requests.filter((r) => r.by === 'page' && r.path === '/v1/world/environment').length === 1, requests.filter((r) => r.path.startsWith('/v1/world/environment')).map((r) => r.by[0] + ':' + r.path.replace('/v1/world/environment', '')));
  { const re = await renderError(frame); if (re) console.log(`INFO [${scope}] render error record ${JSON.stringify(re)}`); check(scope, 'no page errors', errors.length === 0, { errors, renderError: re && { message: re.message, position: re.position, bad: re.badPrimitives } }); }
  await ctx.close();
}

/* ---------- landing on the tab before the globe is ready (390) ---------- */
{
  const scope = '390-landing';
  const { ctx, page, errors } = await openPage(SIZES[0], { query: '&feed=equity' });
  const frame = await globeFrame(page);
  const ready = await layersReady(frame);
  check(scope, 'landing on ?feed=equity: the panel spoke before the globe could listen; hu:globe-ready makes it whole and the layers draw', ready && (await panelShown(page)), (await env(frame)) && (await env(frame)).counts);
  const ratio = await frameVisibleRatio(page);
  const autostarted = await until(page, () => document.getElementById('wePlay').textContent === 'Pause tour', null, 15000);
  check(scope, ratio >= 0.25 ? 'the tour starts by itself once the globe is ready, though the tab was open before the globe was' : 'the tour waits for Play: the frame is not a quarter in view', ratio >= 0.25 ? autostarted : !autostarted, { frameVisible: ratio, autostarted, director: await dir(frame) });
  { const re = await renderError(frame); if (re) console.log(`INFO [${scope}] render error record ${JSON.stringify(re)}`); check(scope, 'no page errors', errors.length === 0, { errors, renderError: re && { message: re.message, position: re.position, bad: re.badPrimitives } }); }
  await ctx.close();
}

/* ---------- the same globe saying ready again never restarts a tour the visitor stopped (1280; review RV2-1) ----------
   The globe's missions read is held, so it says hu:globe-ready (dataPending) at boot and again only when the check releases the
   read: after the tour started by itself and a wheel over the globe paused it. That late ready names the same boot, and the panel
   answers it with the layers and the pins only: no play reaches the frame and the tour stays paused, as the visitor left it. */
{
  const scope = '1280-late-ready';
  let release = () => {};
  const held = new Promise((r) => { release = r; });
  /* every hu:globe-ready the page hears, from before the frame could say its first */
  const init = () => { if (window.top !== window) return; window.__readies = []; window.addEventListener('message', (e) => { const d = e.data || {}; if (d.type === 'hu:globe-ready') window.__readies.push({ boot: typeof d.boot === 'string' ? d.boot : null, dataPending: d.dataPending === true, at: Date.now() }); }); };
  const { ctx, page, errors } = await openPage(SIZES[2], { query: '&feed=equity', holdMissions: held, init });
  const frame = await globeFrame(page);
  check(scope, 'the tab is open from the address and the layers draw while the globe\'s missions read is still held', await layersReady(frame) && (await panelShown(page)));
  await hookRenderError(frame);
  if ((await frameVisibleRatio(page)) < 0.25) await page.locator('#mnWorldFrame').scrollIntoViewIfNeeded();
  const autostarted = await until(page, () => document.getElementById('wePlay').textContent === 'Pause tour', null, 20000);
  check(scope, 'the tour starts by itself on the globe that has just booted', autostarted && (await dir(frame)).playing === true, await dir(frame));
  await frame.evaluate(() => { window.__sceneCommands = []; window.addEventListener('message', (e) => { const d = e.data || {}; if (d.type === 'hu:environment-scene') window.__sceneCommands.push({ action: d.action, at: Date.now() }); }); });
  const globeBox = await frame.locator('#globe').boundingBox();
  await page.mouse.move(globeBox.x + globeBox.width / 2, globeBox.y + globeBox.height / 2);
  await page.mouse.wheel(0, 120);
  const paused = await until(page, () => /you moved the globe/.test(document.getElementById('weSceneStatus').textContent) && document.getElementById('wePlay').textContent === 'Play tour', null, 10000);
  check(scope, 'a wheel over the globe pauses the tour (reason input)', paused && (await dir(frame)).reason === 'input', await dir(frame));
  const heardBefore = await page.evaluate(() => window.__readies.length);
  release();
  const late = await until(page, (n) => window.__readies.length > n && window.__readies.slice(n).some((r) => r.dataPending === false), heardBefore, 30000);
  await page.waitForTimeout(2500);
  const readies = await page.evaluate(() => window.__readies), commands = await frame.evaluate(() => window.__sceneCommands), d1 = await dir(frame);
  check(scope, 'the released missions read makes the globe say ready again, naming the same boot as every ready before it', late && readies.length >= 2 && readies.every((r) => r.boot && r.boot === readies[0].boot), readies);
  check(scope, 'the tour stays paused: no play reaches the frame after the visitor moved the globe, the director keeps reason input and the panel still says so', commands.every((c) => c.action !== 'play') && d1.playing === false && d1.reason === 'input' && /you moved the globe/.test(await page.locator('#weSceneStatus').textContent()), { commands, director: { playing: d1.playing, reason: d1.reason, index: d1.index } });
  { const re = await renderError(frame); if (re) console.log(`INFO [${scope}] render error record ${JSON.stringify(re)}`); check(scope, 'no page errors', errors.length === 0, { errors, renderError: re && { message: re.message, position: re.position, bad: re.badPrimitives } }); }
  await ctx.close();
}

/* ---------- reduced motion (390): nothing moves by itself ---------- */
{
  const scope = '390-reduced-motion';
  const { ctx, page, errors } = await openPage(SIZES[0], { reducedMotion: 'reduce' });
  const frame = await globeFrame(page);
  await openTab(page);
  check(scope, 'layers ready under reduced motion', await layersReady(frame));
  await page.waitForTimeout(3000);
  check(scope, 'the tour does not start by itself under reduced motion', (await page.locator('#wePlay').textContent()) === 'Play tour' && (await dir(frame)).playing === false);
  await page.locator('#wePlay').click();
  const refused = await until(page, () => /reduced motion/.test(document.getElementById('weSceneStatus').textContent), null, 10000);
  check(scope, 'Play is refused by the globe with the reason reduced-motion and the panel says so', refused && (await dir(frame)).reason === 'reduced-motion' && (await dir(frame)).playing === false, await dir(frame));
  /* the review of the release polish, RP-1: the tour never plays by itself here, so Next and Previous are how a visitor goes through
     the significant events; each scene they step to opens its card, without a flight, and presses its row */
  const r0 = await dir(frame);
  await page.locator('#weNext').click();
  const r1ok = await until(frame, (i) => { const d = window.__mccSceneDirector(); return d.index === (i + 1) % d.total && d.playing === false; }, r0.index, 10000);
  const r1 = await dir(frame);
  check(scope, 'Next under reduced motion opens the card of the scene it brings (Observed, Retrieved, the source) and presses its row', r1ok && (await stepCard(page, r1.title)), { from: r0.title, to: r1.title, panel: await panelCard(page) });
  await page.locator('#wePrev').click();
  const r2ok = await until(frame, (i) => window.__mccSceneDirector().index === i, r0.index, 10000);
  check(scope, 'Previous opens the card of the scene before it the same way', r2ok && (await stepCard(page, r0.title)), { to: r0.title, panel: await panelCard(page) });
  /* RP-2: a row chosen with the keyboard deep in the open list keeps its place, is pressed and keeps the focus, also once the globe
     has answered the focus it asked for */
  await openList(page);
  const deep = await page.evaluate(() => { const rows = [...document.querySelectorAll('#weEvents > li > button')]; rows[30].focus(); return { title: rows[30].querySelector('strong').textContent, rows: rows.length }; });
  await page.keyboard.press('Enter');
  const kept = await until(page, (t) => { const rows = [...document.querySelectorAll('#weEvents > li > button')], i = rows.findIndex((b) => b.querySelector('strong').textContent === t); return i === 30 && rows[30].getAttribute('aria-pressed') === 'true' && document.activeElement === rows[30] && document.getElementById('weDetail').textContent.includes(t); }, deep.title, 10000);
  await page.waitForTimeout(1500);
  const deepAfter = await page.evaluate((t) => { const rows = [...document.querySelectorAll('#weEvents > li > button')]; return { index: rows.findIndex((b) => b.querySelector('strong').textContent === t), focus: rows.indexOf(document.activeElement), rows: rows.length }; }, deep.title);
  check(scope, 'a row chosen with the keyboard deep in the open list keeps its place, is pressed and keeps the focus, also after the globe answered', kept && deepAfter.index === 30 && deepAfter.focus === 30 && deepAfter.rows === deep.rows, { deep, after: deepAfter });
  await openList(page);
  await page.locator('#weEvents button', { hasText: QUAKE.title }).first().click();
  const focused = await until(frame, () => { const s = window.__mccEnvironmentLayers(); return !!s.selected && s.selected.id === 'usgs:us7000tyhr'; }, null, 20000);
  /* E=UP event timeline slice S5 (2026-11-19), changed on purpose (decisions D14, D17): the focus still jumps with no flight, now to
     the quake's regional frame (M5.4: 174 km away, 49.5 degrees down, about 132 km up; before S5, 900 km straight down), and the
     ripple is a still outline at its regional radius (before S5: none) */
  await until(frame, () => { const c = window.__mccEnvironmentLayers().camera; return !!c && !!c.last && c.last.id === 'usgs:us7000tyhr'; }, null, 10000);
  const height = await frame.evaluate(() => Math.round(window.HuGlobe.viewer().camera.positionCartographic.height));
  const s = await env(frame);
  check(scope, 'focus jumps with no flight to the quake\'s regional frame (about 132 km up), the ripple a still outline, and the legend says animations are off', focused && Math.abs(height - 132300) < 8000 && !!s.camera && s.camera.last.how === 'jump' && !!s.ripple && s.ripple.phase === 'outline' && s.legend.includes('(animations off)'), { height, camera: s.camera, ripple: s.ripple });
  { const re = await renderError(frame); if (re) console.log(`INFO [${scope}] render error record ${JSON.stringify(re)}`); check(scope, 'no page errors', errors.length === 0, { errors, renderError: re && { message: re.message, position: re.position, bad: re.badPrimitives } }); }
  await ctx.close();
}

/* ---------- the gate refuses (390): 503 module_policy_unavailable and 404 module_disabled ----------
   E=UP slice S0 (2026-11-19), changed on purpose: off (404 module_disabled: the module never installed or disabled) and an outage
   (503) are two lines on the page and two in the frame's legend, no longer one sentence for both; and leaving the tab and coming
   back asks no layer route again while the refusal is held (the release review counted 6, 11, 16 and 21 requests after four
   activations) */
for (const code of ['503', '404']) {
  const scope = `390-policy-${code}`;
  const reason = code === '503' ? 'module_policy_unavailable' : 'module_disabled';
  const state = code === '503' ? 'unavailable' : 'off', noteId = code === '503' ? 'weUnavailable' : 'weOff';
  const line = code === '503' ? 'Environmental reports are not available right now.' : 'Environmental reports are turned off for now.';
  const legendLine = code === '503' ? 'Environmental layers are not available right now' : 'Environmental layers are turned off for now';
  const { ctx, page, errors, requests } = await openPage(SIZES[0], { feed: code });
  const frame = await globeFrame(page);
  await page.waitForFunction((v) => document.documentElement.getAttribute('data-we-feed') === v, state, { timeout: 30000 });
  await setScope(page, 'equity');
  await page.waitForFunction(() => document.querySelectorAll('#mnFeed [data-mission-post]').length > 0, null, { timeout: 30000 });
  const tab = await page.evaluate((id) => ({ note: getComputedStyle(document.getElementById(id)).display, text: document.getElementById(id).textContent.trim(), shown: [...document.querySelectorAll('.mn__we-note')].filter((n) => getComputedStyle(n).display !== 'none').map((n) => n.id), panel: getComputedStyle(document.getElementById('wePanel')).display, posts: document.querySelectorAll('#mnFeed .mn__observation-post').length, missions: document.querySelectorAll('#mnFeed [data-mission-post]').length }), noteId);
  check(scope, `the ${state} line and no other, no panel, zero observation posts, the missions untouched`, tab.note === 'block' && tab.text === line && JSON.stringify(tab.shown) === JSON.stringify([noteId]) && tab.panel === 'none' && tab.posts === 0 && tab.missions === 3, tab);
  const gated = await until(frame, (c) => { const s = window.__mccEnvironmentLayers && window.__mccEnvironmentLayers(); return !!s && s.policy === true && ['fires', 'perimeters', 'alerts', 'eonet', 'tides'].every((l) => s.states[l] && s.states[l].status === 'policy' && s.states[l].reason === c); }, reason, 60000);
  const s = await env(frame);
  check(scope, `inside the frame every layer is in the policy state with reason ${reason} and the legend says "${legendLine}"`, gated && s.legend.includes(legendLine) && s.counts.firesNear === 0 && s.counts.perimeters === 0, s && { states: s.states, legend: s.legend });
  const before = requests.filter((r) => r.path.startsWith('/v1/world/environment/')).length;
  await page.waitForTimeout(10000);
  const after = requests.filter((r) => r.path.startsWith('/v1/world/environment/')).length;
  check(scope, 'no retry against the refusing gate within 10 s, and one read of the feed', before === after && before <= 5 && requests.filter((r) => r.path === '/v1/world/environment').length === 1, { before, after });
  /* three more activations of the tab: the refusal is held, so the frame says the same state again and asks nothing */
  for (let i = 0; i < 3; i++) {
    await setScope(page, 'global');
    await until(frame, () => !window.__mccEnvironmentLayers().on, null, 15000);
    await setScope(page, 'equity');
    await until(frame, () => window.__mccEnvironmentLayers().on, null, 15000);
    await page.waitForTimeout(1500);
  }
  const again = await env(frame), afterFour = requests.filter((r) => r.path.startsWith('/v1/world/environment/')).length;
  check(scope, 'four activations of the tab ask the layer routes once (the release review counted 6, 11, 16 and 21 requests), and the frame keeps saying the same state', afterFour === after && again.policy === true && again.legend.includes(legendLine), { requests: afterFour, first: after, legend: again.legend });
  { const re = await renderError(frame); if (re) console.log(`INFO [${scope}] render error record ${JSON.stringify(re)}`); check(scope, 'no page errors', errors.length === 0, { errors, renderError: re && { message: re.message, position: re.position, bad: re.badPrimitives } }); }
  await ctx.close();
}

/* ---------- no data (390): every source answered and none reported an event (E=UP slice S0) ----------
   the one line for it, no panel, no observation post, the missions untouched; the frame's layers still answer for themselves */
{
  const scope = '390-empty';
  const { ctx, page, errors } = await openPage(SIZES[0], { feed: 'empty' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-we-feed') === 'empty', null, { timeout: 30000 });
  await setScope(page, 'equity');
  await page.waitForFunction(() => document.querySelectorAll('#mnFeed [data-mission-post]').length > 0, null, { timeout: 30000 });
  const tab = await page.evaluate(() => ({ text: document.getElementById('weEmpty').textContent.trim(), shown: [...document.querySelectorAll('.mn__we-note')].filter((n) => getComputedStyle(n).display !== 'none').map((n) => n.id), panel: getComputedStyle(document.getElementById('wePanel')).display, posts: document.querySelectorAll('#mnFeed .mn__observation-post').length, missions: document.querySelectorAll('#mnFeed [data-mission-post]').length }));
  check(scope, 'no data has its own line and no other, no panel, no observation post, the missions untouched', tab.text === 'No qualifying environmental events right now.' && JSON.stringify(tab.shown) === JSON.stringify(['weEmpty']) && tab.panel === 'none' && tab.posts === 0 && tab.missions === 3, tab);
  const dims = await fits(page);
  check(scope, 'nothing scrolls sideways at 390', dims.sw === dims.cw, dims);
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* ---------- one layer unavailable beside the stale one (390) ---------- */
{
  const scope = '390-unavailable';
  const { ctx, page, errors } = await openPage(SIZES[0], { fail: 'perimeters' });
  const frame = await globeFrame(page);
  await openTab(page);
  check(scope, 'the other layers are ready', await layersReady(frame));
  await page.locator('#wePanel details > summary').first().click();
  const rowsOk = await until(page, () => [...document.querySelectorAll('#weSources > li')].some((li) => /^Fire perimeters/.test(li.textContent)), null, 20000);
  const rows = await healthRows(page);
  const perims = rowOf(rows, /^Fire perimeters/), natural = rowOf(rows, /^Natural events/);
  const s = await env(frame);
  check(scope, 'the perimeters row says unavailable with the HTTP reason in plain words, nothing is drawn for it, and the natural-events row stays stale with its reason', rowsOk && /unavailable/.test(perims) && /answered HTTP 500/.test(perims) && /Retrieved: Not supplied/.test(perims) && /stale/.test(natural) && /refused, failed or answered an error/.test(natural) && s.counts.perimeters === 0 && s.counts.firesNear === 600 && !s.legend.some((l) => /perimeters as NIFC/.test(l)), { perims: perims.slice(0, 200), natural: natural.slice(0, 120), counts: s.counts });
  { const re = await renderError(frame); if (re) console.log(`INFO [${scope}] render error record ${JSON.stringify(re)}`); check(scope, 'no page errors', errors.length === 0, { errors, renderError: re && { message: re.message, position: re.position, bad: re.badPrimitives } }); }
  await ctx.close();
}

/* ---------- by day: the panel, its rows and the frame's legend read 4.5:1 or better ---------- */
for (const size of SIZES) {
  const scope = `${size.width}-day`;
  const { ctx, page, errors } = await openPage(size, { daylight: 'day' });
  const frame = await globeFrame(page);
  await settle(frame); await overEarth(frame);
  const dayOn = await tintShown(frame), dayGlobal = await tint(frame);
  check(scope, 'by day on Global the news tint and its legend show', dayOn && dayGlobal.lines === 1 && dayGlobal.heat.countries === 1 && dayGlobal.heat.shown === true && dayGlobal.legend.hidden === false, dayGlobal);
  await openTab(page);
  await layersReady(frame);
  /* a tour that started by itself is paused as a visitor would, so the camera stays over the whole Earth for the reading */
  await page.waitForTimeout(1500);
  if ((await page.locator('#wePlay').textContent()) === 'Pause tour') { await page.locator('#wePlay').click(); await until(page, () => document.getElementById('wePlay').textContent === 'Play tour', null, 10000); }
  await overEarth(frame);
  const dayOff = await tintQuiet(frame), dayTab = await tint(frame);
  check(scope, 'by day the Equity Uprise tab, over the whole Earth, hides the news tint and its legend; D9: the news layer off, no counts held', dayOff && dayTab.lines === 1 && dayTab.heat === null && dayTab.legend.hidden === true && dayTab.news.on === false, dayTab);
  await page.waitForFunction(() => document.querySelectorAll('#mnFeed .mn__observation-post').length > 0 && document.querySelectorAll('#weSources > li').length >= 10, null, { timeout: 60000 });
  await page.locator('#wePanel details > summary').first().click();
  const contrast = await page.evaluate(() => {
    const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b; } return 'rgb(255, 255, 255)'; };
    const rgb = (s) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(s); return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0]; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (x, y) => { const a = lum(rgb(x)), b = lum(rgb(y)); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
    const of = (name, el) => el ? { name, text: el.textContent.trim().slice(0, 40), ink: getComputedStyle(el).color, ground: bgOf(el), ratio: ratio(getComputedStyle(el).color, bgOf(el)) } : { name, missing: true };
    const q = (s) => document.querySelector(s);
    return { phase: document.documentElement.dataset.daylight, rows: [of('title', q('#weTitle')), of('eyebrow', q('#wePanel .we-eyebrow')), of('subtle', q('#wePanel .we-subtle')), of('refresh', q('#weRefresh')), of('play', q('#wePlay')), of('view', q('#weView2d')), of('scene status', q('#weSceneStatus')), of('status available', q('#weSources .we-status[data-status="available"]')), of('status stale', q('#weSources .we-status[data-status="stale"]')), of('health reason', q('#weSources li p.we-subtle')), of('list button', q('#weEvents button strong')), of('post author', q('#mnFeed .mn__observation-post .mn__author-name')), of('post sub', q('#mnFeed .mn__observation-post .mn__author-sub')), of('post title', q('#mnFeed .mn__observation-post-title')), of('post body', q('#mnFeed .mn__observation-post-body')), of('post action', q('#mnFeed .mn__observation-post .mn__action-label'))] };
  });
  const legend = await frame.evaluate(() => {
    const rgb = (s) => { const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/.exec(s); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : [0, 0, 0, 1]; };
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const el = document.querySelector('#envLegend summary'), box = document.getElementById('envLegend');
    const ink = rgb(getComputedStyle(el).color), bg = rgb(getComputedStyle(box).backgroundColor), page = [5, 9, 18, 1];
    const over = bg[3] >= 1 ? bg : bg.map((v, i) => i < 3 ? Math.round(v * bg[3] + page[i] * (1 - bg[3])) : 1);
    const a = lum(ink), b = lum(over);
    return { ink: getComputedStyle(el).color, ground: getComputedStyle(box).backgroundColor, ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 };
  });
  const low = contrast.rows.filter((r) => !r.missing && r.ratio < 4.5), missing = contrast.rows.filter((r) => r.missing && r.name !== 'scene status');
  check(scope, 'by day every measured pair reads 4.5:1 or better: the panel\'s words, buttons, status words, health reasons, list rows and the observation posts', contrast.phase === 'day' && low.length === 0 && missing.length === 0, contrast.rows.map((r) => r.missing ? r.name + ' missing' : r.name + ' ' + r.ratio));
  check(scope, 'the frame\'s legend summary reads 4.5:1 or better on its own ground', legend.ratio >= 4.5, legend);
  const dayReadable = await panelReadable(page);
  check(scope, 'by day the panel\'s search placeholder reads 4.5:1 or better and the sources summary is a 44 px target', dayReadable.ink === dayReadable.dim && dayReadable.ratio >= 4.5 && dayReadable.summary >= 44, dayReadable);
  const dims = await fits(page);
  check(scope, 'nothing scrolls sideways by day', dims.sw === dims.cw && dims.psw <= dims.pcw, dims);
  await shot(page, `environment-world-day-${size.width}`);
  await setScope(page, 'global');
  await overEarth(frame);
  const dayBack = await tintShown(frame), dayAfter = await tint(frame);
  check(scope, 'by day leaving the tab brings the news tint and its legend back exactly as they were', dayBack && tintSame(dayAfter, dayGlobal), { before: dayGlobal, after: dayAfter });
  { const re = await renderError(frame); if (re) console.log(`INFO [${scope}] render error record ${JSON.stringify(re)}`); check(scope, 'no page errors', errors.length === 0, { errors, renderError: re && { message: re.message, position: re.position, bad: re.badPrimitives } }); }
  await ctx.close();
}

await browser.close();
server.close();
await writeFile(join(OUT, 'summary.json'), JSON.stringify({ failed, at: new Date().toISOString() }, null, 1));
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
