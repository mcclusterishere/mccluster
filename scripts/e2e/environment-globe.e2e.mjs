/* The environmental globe inside its frame (slice G1, 2026-11-17), in a real browser at 390 and 1280 with every layer
   route answered from the fixtures: counts per layer, the legend sentences, the selection payload per layer (source,
   recorded time under its own label, retrieval time, coverage, status), ShakeMap contours on the selected quake with
   the modelled label, the ripple's bounded hold, reduced motion, the 2D toggle, the policy gate (503 and 404), one
   layer unavailable and one stale reported truthfully, a real pick and a miss that falls through, the feed route never
   requested by the frame, scrollWidth === clientWidth, no page errors, and the perf script in --check mode.
   Event timeline slice S5 (2026-11-19): every quake a labelled glyph, the labels inside the frame's free area, a real tap 15 px
   off a glyph selecting it and pushing the camera to its regional frame, the visitor's wheel cancelling the push, the rings
   waiting for the landing and ending inside their bound, the modelled up-dip edge of a USGS finite fault (the Worker's own
   answer for the recorded USGS files, rupture-us6000u43g.json) drawn and called a model, reduced motion moving nothing by
   itself, and the mission halos standing still while the layers are on (D16).

   Serves this checkout at 127.0.0.1 and fakes api.mccluster.org, Supabase and the NASA tiles in memory (no production
   call). Run:  node scripts/e2e/environment-globe.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR if not resolvable) and the Cesium CDN, or CESIUM_DIR pointing at a local
   Build/Cesium of the same release (served under the CDN URL, so the page's SRI still applies). E2E_GL_ARGS=1 adds the
   SwiftShader flags the editorial CI uses. Exits non-zero on any failed check. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'environment-globe');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const FIXTURE_DIR = join(ROOT, 'scripts/e2e/fixtures/environment');
const FIX = {};
for (const name of ['layers-fires', 'layers-perimeters', 'layers-alerts', 'layers-eonet', 'layers-tides', 'shakemap-us7000tyhr', 'shakemap-us7000tyca', 'shakemap-none', 'policy-503', 'policy-404', 'pins', 'rupture-us6000u43g']) FIX[name] = JSON.parse(await readFile(join(FIXTURE_DIR, name + '.json'), 'utf8'));
const TILE = await readFile(join(ROOT, 'assets/img/closet/seek-first/sf-33.jpg'));

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const HOST = `${BASE}/scripts/e2e/support/environment-globe-host.html`;

let failed = 0;
function check(scope, name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 500)}`);
  if (!ok) failed++;
}
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });

/* two open missions for the globe's pins (D16: their halos), the shape action_globe_public_region_missions answers */
const MISSION_PINS = [
  { mission_id: '0e1f0000-0000-4000-8000-000000000002', title: 'Clean up the Mill River', description: 'Bag a block of shoreline with your neighbours.', action_path: 'show_up', region_key: 'US-CT', region_label: 'Connecticut', latitude: 41.6, longitude: -72.7 },
  { mission_id: '0e1f0000-0000-4000-8000-000000000003', title: 'Plant a street tree', description: 'Join a planting crew and plant one tree.', action_path: 'show_up', region_key: 'BR-SP', region_label: 'Sao Paulo', latitude: -23.5, longitude: -46.6 }
];
async function context(viewport, { reducedMotion = 'no-preference', policy = null, fail = null, missions = false } = {}) {
  const mobile = viewport.width < 600;
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion });
  const requests = [];
  /* registered first, so every specific route below takes precedence (Playwright matches the last-registered route first):
     anything else off this origin and off the CDN answers an empty object, never the network */
  await ctx.route((url) => !url.href.startsWith(BASE) && !/cesium\.com/.test(url.hostname), (route) => json(route, {}));
  await ctx.route('https://api.mccluster.org/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    requests.push(p);
    if (p === '/v1/world/environment') return json(route, FIX['policy-503'], 503); /* the frame must never ask for the feed */
    const layer = /^\/v1\/world\/environment\/layers\/(fires|perimeters|alerts|eonet|tides)$/.exec(p);
    if (layer) {
      if (policy) return json(route, FIX['policy-' + policy], policy);
      if (fail === layer[1]) return json(route, { error: 'fixture failure' }, 500);
      return json(route, FIX['layers-' + layer[1]]);
    }
    const sm = /^\/v1\/world\/environment\/quakes\/([a-z0-9]+)\/shakemap$/.exec(p);
    if (sm) return policy ? json(route, FIX['policy-' + policy], policy) : json(route, FIX['shakemap-' + sm[1]] || FIX['shakemap-none']);
    const rp = /^\/v1\/world\/environment\/quakes\/([a-z0-9]+)\/rupture$/.exec(p);
    if (rp) return policy ? json(route, FIX['policy-' + policy], policy) : FIX['rupture-' + rp[1]] ? json(route, FIX['rupture-' + rp[1]]) : json(route, { ok: false, code: 'not_found' }, 404);
    if (p === '/v1/world/access') return json(route, { level: 'public', unlocked_layers: ['flights'], locked_layers: ['satellites', 'launches', 'intel', 'music', 'cctv', 'audience', 'transport'].map((id) => ({ id, reason: 'sign_in_required', next_step: 'sign_in' })), layers: {} });
    if (p === '/v1/world/ion') return json(route, { available: false });
    return json(route, {});
  });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => json(route, missions && /\/rpc\/action_globe_public_region_missions$/.test(new URL(route.request().url()).pathname) ? MISSION_PINS : []));
  await ctx.route('https://gibs.earthdata.nasa.gov/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: TILE }));
  await ctx.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: TILE }));
  if (process.env.CESIUM_DIR) await ctx.route('https://cesium.com/**/Build/Cesium/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.split('/Build/Cesium/')[1];
    if (!rel || rel.includes('..')) return route.abort();
    try { return route.fulfill({ body: await readFile(join(process.env.CESIUM_DIR, rel)), contentType: TYPES[extname(rel)] || 'application/octet-stream' }); }
    catch { return route.abort(); }
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  /* the browser's own resource log for a deliberate 500/503/404 fixture answer is the scenario, not an error of the page */
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (500|503|404)/.test(m.text())) errors.push('console: ' + m.text()); });
  return { ctx, page, errors, requests };
}
async function globeFrame(page) {
  for (let i = 0; i < 200; i++) {
    const f = page.frames().find((x) => x.url().includes('/action-globe.html'));
    if (f) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('the globe frame never appeared');
}
async function until(target, fn, arg, ms = 20000) { return target.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false); }
const fromGlobe = (page) => page.evaluate(() => window.__fromGlobe);
const env = (frame) => frame.evaluate(() => window.__mccEnvironmentLayers && window.__mccEnvironmentLayers());
const gov = (frame) => frame.evaluate(() => window.__mccGlobeGovernor && window.__mccGlobeGovernor());
const dir = (frame) => frame.evaluate(() => window.__mccSceneDirector && window.__mccSceneDirector());
const send = (page, msg) => page.evaluate((m) => window.__send(m), msg);
const widths = (target) => target.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
async function waitMessage(page, pred, ms = 20000) {
  const ok = await until(page, (src) => { const f = new Function('m', 'return ' + src); return window.__fromGlobe.some((m) => f(m)); }, pred, ms);
  if (!ok) return null;
  const all = await fromGlobe(page);
  const f = new Function('m', 'return ' + pred);
  return all.filter((m) => f(m)).pop();
}
async function settle(frame) { await frame.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 60000 }).catch(() => {}); }
/* setView changes the pose synchronously, but Cesium reports camera.changed and applies LOD on a later scene update.
   Observe a rendered frame at the requested height, not a polling deadline followed by an unrelated debug read. */
async function viewAtLod(frame, lon, lat, height, lod) {
  return frame.evaluate(({ lon, lat, height, lod }) => new Promise((resolve) => {
    const v = window.HuGlobe.viewer();
    const snapshot = () => ({ height: v.camera.positionCartographic.height, lod: window.__mccEnvironmentLayers().lod });
    const finish = (rendered, state = snapshot()) => {
      clearTimeout(timer);
      v.scene.postRender.removeEventListener(onFrame);
      resolve({ rendered, ...state });
    };
    const onFrame = () => {
      const state = snapshot();
      if (Math.abs(state.height - height) < 1 && state.lod === lod) finish(true, state);
    };
    const timer = setTimeout(() => finish(false), 20000);
    v.scene.postRender.addEventListener(onFrame);
    v.camera.cancelFlight();
    v.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, height) });
    v.scene.requestRender();
  }), { lon, lat, height, lod });
}
const fact = (payload, label) => (payload && Array.isArray(payload.facts) ? payload.facts.find((f) => f.label === label) : null);

await mkdir(OUT, { recursive: true });
const launchOptions = process.env.E2E_GL_ARGS === '1' || process.env.CI ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : {};
const browser = await chromium.launch(launchOptions);
const SIZES = [{ name: '390', viewport: { width: 390, height: 844 } }, { name: '1280', viewport: { width: 1280, height: 800 } }];
const firstDetection = FIX['layers-fires'].detections[0];
const detectionId = `fire:${firstDetection[5]}:${firstDetection[4]}:${firstDetection[0]}:${firstDetection[1]}`;

for (const size of SIZES) {
  const scope = size.name;
  const { ctx, page, errors, requests } = await context(size.viewport);
  await page.goto(`${HOST}?layers=on`, { waitUntil: 'load' });
  const frame = await globeFrame(page);
  check(scope, 'the frame says hu:globe-ready and the host activates the layers', await until(page, () => window.__ready && window.__activated > 0, null, 90000));
  const loaded = await until(frame, () => { const s = window.__mccEnvironmentLayers && window.__mccEnvironmentLayers(); return !!s && s.on && s.ready && s.counts.events === 62; }, null, 120000);
  const s0 = await env(frame);
  check(scope, 'every layer answered and every primitive is built', loaded, s0 && { ready: s0.ready, states: s0.states });
  await settle(frame);
  const gl = await frame.evaluate(() => { try { const gl = window.HuGlobe.viewer().scene.context._gl; const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { return 'unknown'; } });
  console.log(`INFO [${scope}] WebGL renderer: ${gl}`);
  const s = await env(frame);
  const c = s.counts;
  check(scope, 'quakes: 50 discs and 50 dots in the events layer (62 events)', c.events === 62 && c.quakes === 50 && c.quakeDiscs === 50, c);
  check(scope, 'fires: 600 footprints near and 20 summary cells far', c.firesNear === 600 && c.cells === FIX['layers-fires'].summary.cells.length, c);
  check(scope, 'perimeters: 50 fills with their exterior rings outlined', c.perimeters === 50 && c.perimeterRings === 50, c);
  check(scope, 'alerts: 70 polygons drawn, 25 zone-only and 5 rejected listed and never placed', c.alerts.drawn === 70 && c.alerts.zone_only === 25 && c.alerts.rejected === 5, c.alerts);
  check(scope, 'eonet: 11 reported points, 1 track of distinct positions, 1 polygon', c.eonetPoints === 11 && c.eonetTracks === 1 && c.eonetPolygons === 1, c);
  check(scope, 'tides: 14 station columns with their labels', c.tides === 14 && c.tideLabels === 14, c);
  const states = (await fromGlobe(page)).filter((m) => m.type === 'hu:environment-layer-state');
  const last = (layer) => states.filter((m) => m.layer === layer).pop();
  const fires = last('fires'), eonet = last('eonet'), tides = last('tides'), alerts = last('alerts'), perims = last('perimeters'), events = last('events');
  /* review RV2-3: the Worker sums both satellites into the areas, so the layer speaks for both records together: one label, the
     coverage and terms of each, and the newest retrieval (NOAA-21 at 19:59), which no acquisition in the merged cells can follow */
  check(scope, 'fires state copies fetched_at, last_success_at, attribution and licence from the Worker sources (both satellites that served the summed areas speak for the layer, with the newest retrieval, NOAA-21 at 19:59; both records travel)', !!fires && fires.status === 'available' && fires.source_id === 'firms_viirs_noaa20+firms_viirs_noaa21' && fires.label === 'NASA FIRMS VIIRS NOAA-20 and NOAA-21' && fires.fetched_at === '2026-11-17T19:59:00.000Z' && fires.last_success_at === '2026-11-17T19:59:00.000Z' && /VIIRS 375 m active fire product \(NOAA-20.* · .*\(NOAA-21/.test(fires.attribution) && /NOAA-20 .* · .*NOAA-21 /.test(fires.coverage) && fires.sources[0].fetched_at === '2026-11-17T19:58:00.000Z' && /CC0 1\.0/.test(fires.license) && fires.count === 600 && fires.total === 600 && fires.truncated === false && fires.sources.length === 2 && fires.digest.cells.length === 10 && fires.digest.cell_degrees === 1, fires && { status: fires.status, source_id: fires.source_id, label: fires.label, fetched_at: fires.fetched_at, attribution: fires.attribution, coverage: fires.coverage, count: fires.count });
  check(scope, 'eonet is reported stale with the provider reason, never invented', !!eonet && eonet.status === 'stale' && eonet.reason === 'upstream_error' && eonet.fetched_at === '2026-11-17T14:00:00.000Z' && eonet.last_success_at === '2026-11-17T14:00:00.000Z', eonet && { status: eonet.status, reason: eonet.reason });
  check(scope, 'tides state: 14 of 20 documented stations answered; the readings (retrieved 19:56), never the station catalogue (08:00), speak for the layer (G1R-3)', !!tides && tides.status === 'available' && tides.source_id === 'coops_latest' && tides.count === 14 && tides.total === 20 && tides.digest.answered === 14 && tides.digest.stations === 20 && tides.fetched_at === '2026-11-17T19:56:00.000Z' && tides.last_success_at === '2026-11-17T19:56:00.000Z' && /^The latest observed water level/.test(tides.coverage) && tides.sources.length === 2 && tides.sources[0].fetched_at === '2026-11-17T08:00:00.000Z', tides && { fetched_at: tides.fetched_at, coverage: tides.coverage, digest: tides.digest });
  check(scope, 'alerts digest carries the Worker counts', !!alerts && alerts.digest && alerts.digest.counts.polygon === 70 && alerts.digest.counts.zone_only === 25 && alerts.digest.counts.rejected === 5, alerts && alerts.digest);
  check(scope, 'perimeters digest: the ten largest with a real first vertex', !!perims && perims.digest.top.length === 10 && perims.digest.top[0].name === 'Fixture Ridge' && perims.digest.top[0].lat === 34.6 && typeof perims.digest.top[0].lon === 'number', perims && perims.digest.top[0]);
  check(scope, 'events state counts by provider', !!events && events.count === 62 && JSON.stringify(events.digest.by_provider) === JSON.stringify({ usgs: 50, nws: 5, eonet: 6, nhc: 1 }), events && events.digest);
  /* the feed providers' terms arrived with the pins (review G1R-10): the frame holds the feed's four records and no copy of its own */
  const termsHeld = (await env(frame)).feedTerms;
  check(scope, 'the pins carried the feed providers\' terms and the frame holds them (usgs, nws, eonet, nhc)', JSON.stringify(termsHeld) === JSON.stringify(['eonet', 'nhc', 'nws', 'usgs']), termsHeld);
  const legend = s.legend.join('\n');
  check(scope, 'the legend names every quantity', /Disc area shows magnitude \(energy, 10\^1\.5M\)/.test(legend) && /satellite detection \(375 m pixel\)/.test(legend) && /not a legal boundary/.test(legend) && /never placed/.test(legend) && /not a forecast or an inferred path/.test(legend) && /MLLW, metres/.test(legend) && /NASA Earth Observatory/.test(legend), s.legend);
  check(scope, 'the legend is a collapsed details element on the page, no logo', await frame.evaluate(() => { const d = document.getElementById('envLegend'); return !!d && !d.hidden && !d.open && d.querySelector('summary').textContent === 'Legend' && !d.querySelector('img') && !/Equity Uprise/.test(d.textContent) && d.querySelectorAll('li').length >= 6; }));
  await frame.evaluate(() => { document.getElementById('envLegend').open = true; });
  const wOpen = await widths(frame);
  const summaryBox = await frame.evaluate(() => { const r = document.querySelector('#envLegend summary').getBoundingClientRect(); const d = document.getElementById('envLegend').getBoundingClientRect(); return { summaryH: r.height, right: d.right, left: d.left, inner: innerWidth }; });
  check(scope, 'the open legend keeps scrollWidth === clientWidth, stays inside the frame and has a 44 px summary', wOpen.scrollW === wOpen.clientW && summaryBox.summaryH >= 44 && summaryBox.right <= summaryBox.inner && summaryBox.left >= 0, { wOpen, summaryBox });
  await frame.evaluate(() => { document.getElementById('envLegend').open = false; });
  /* the governor: on demand, 60 s of simulation time between idle frames, no holds once everything is built */
  const idle = await until(frame, () => { const g = window.__mccGlobeGovernor(); return g.enabled && g.holds.length === 0; }, null, 20000);
  const g0 = await gov(frame);
  check(scope, 'the governor is enabled, on demand with no holds, maximumRenderTimeChange 60', idle && g0.mode === 'on-demand' && g0.maximumRenderTimeChange === 60 && (await frame.evaluate(() => window.HuGlobe.viewer().scene.requestRenderMode)) === true, g0);
  /* focus a quake with a ShakeMap: the selection payload, the ripple's bounded hold, the contours and the modelled label */
  await page.evaluate(() => { window.__fromGlobe.length = 0; });
  const t0 = Date.now();
  await send(page, { type: 'hu:environment-focus', id: 'usgs:us7000tyhr' });
  const sel = await waitMessage(page, "m.type === 'hu:environment-selected' && m.id === 'usgs:us7000tyhr' && m.via === 'focus'", 20000);
  check(scope, 'focus answers hu:environment-selected with source, recorded time under its label, retrieval time, coverage and status', !!sel && sel.layer === 'events' && sel.kind === 'quake' && sel.source.label === 'USGS' && sel.source.url === 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000tyhr' && /Earthquake Hazards Program/.test(sel.source.attribution) && sel.observed_label === 'Observed' && sel.observed_at === '2026-11-16T04:24:11.718Z' && sel.fetched_at === '2026-11-17T20:54:00.000Z' && sel.coverage === 'Global earthquakes reported in the past day' && sel.status === 'available' && sel.reason === null && sel.lat === 37.3664 && sel.lon === 136.7444 && sel.illustrative === 'Ripple is illustrative: not a recording of shaking', sel);
  /* the ripple, the governor's holds and the legend read in ONE evaluate (review RV2-9: two reads once straddled the 4.5 s ripple's
     end on a loaded runner); a ripple already over by the time it is read is judged by the record it left: bounded, its hold gone */
  const rippleNow = await frame.evaluate(() => { const s = window.__mccEnvironmentLayers(), g = window.__mccGlobeGovernor(); return { ripple: s.ripple, lastRipple: s.lastRipple, holds: g.holds.slice(), legend: s.legend.slice() }; });
  const rippleLabel = 'Ripple is illustrative: not a recording of shaking';
  const rippleOk = rippleNow.ripple ? rippleNow.ripple.active === true && rippleNow.holds.includes('env-ripple') && rippleNow.legend.includes(rippleLabel)
    : !!rippleNow.lastRipple && !rippleNow.holds.includes('env-ripple') && rippleNow.lastRipple.endedAt - rippleNow.lastRipple.startedAt <= 6500;
  check(scope, 'the ripple runs under the bounded env-ripple hold and is labelled (in the legend while it runs, and in the selection it answered)', rippleOk && !!sel && sel.illustrative === rippleLabel, { running: !!rippleNow.ripple, holds: rippleNow.holds, ripple: rippleNow.ripple, lastRipple: rippleNow.lastRipple });
  const modelled = await waitMessage(page, "m.type === 'hu:environment-selected' && m.id === 'usgs:us7000tyhr' && m.modelled === true", 20000);
  const smLine = fact(modelled, 'ShakeMap');
  check(scope, 'the ShakeMap arrives with the modelled label (v5, automatic, max MMI 2.9, computed time)', !!modelled && !!smLine && smLine.value === 'modelled shaking (MMI), USGS ShakeMap v5 (automatic), max MMI 2.9, computed 2026-11-17T04:28:22.000Z' && modelled.observed_label === 'Observed', smLine);
  const smState = await waitMessage(page, "m.type === 'hu:environment-layer-state' && m.layer === 'shakemap' && m.digest && m.digest.available === true", 20000);
  check(scope, 'the shakemap layer state carries the digest and the two USGS sources, and speaks for the contours source (G1R-3)', !!smState && smState.digest.version === 5 && smState.digest.max_mmi === 2.9 && smState.digest.event_id === 'us7000tyhr' && smState.sources.length === 2 && smState.sources[1].label === 'USGS ShakeMap' && /Geological Survey ShakeMap/.test(smState.sources[1].attribution) && smState.fetched_at === '2026-11-17T20:01:00.000Z' && smState.source_id === 'usgs_shakemap' && smState.attribution === 'U.S. Geological Survey ShakeMap' && smState.url === 'https://earthquake.usgs.gov/data/shakemap/' && /^ShakeMap exists/.test(smState.coverage), smState && { digest: smState.digest, sources: smState.sources.map((s) => s.label), fetched_at: smState.fetched_at, attribution: smState.attribution });
  const built = await until(frame, () => window.__mccEnvironmentLayers().counts.shakemapLines === 10 && window.__mccEnvironmentLayers().built, null, 30000);
  check(scope, 'ten contour lines are drawn exactly as received', built, (await env(frame)).counts);
  /* the ripple's hold is bounded: the frame records when its ripple started and ended on its own clock */
  const ended = await until(frame, () => { const s = window.__mccEnvironmentLayers(); return s.ripple === null && !!s.lastRipple && !window.__mccGlobeGovernor().holds.includes('env-ripple'); }, null, 12000);
  const lastRipple = (await env(frame)).lastRipple;
  check(scope, 'the ripple and its env-ripple hold end within 6.5 s of the ripple\'s start', ended && !!lastRipple && lastRipple.endedAt - lastRipple.startedAt >= 1000 && lastRipple.endedAt - lastRipple.startedAt <= 6500, { lastRipple, rippleMs: lastRipple && lastRipple.endedAt - lastRipple.startedAt, sinceFocusMs: Date.now() - t0 });
  const released = await until(frame, () => window.__mccGlobeGovernor().holds.length === 0, null, 20000);
  check(scope, 'every hold is released (ripple, focus flight, selection fade, build): back on demand', released && (await env(frame)).ripple === null && (await gov(frame)).mode === 'on-demand', { governor: await gov(frame), sinceFocusMs: Date.now() - t0 });
  /* a ShakeMap with no contour, and an event with no ShakeMap at all */
  await send(page, { type: 'hu:environment-focus', id: 'usgs:us7000tyca' });
  const deep = await waitMessage(page, "m.type === 'hu:environment-selected' && m.id === 'usgs:us7000tyca' && m.modelled === true", 20000);
  check(scope, 'a ShakeMap without contours says so and draws no line', !!deep && !!fact(deep, 'ShakeMap contours') && /no contour \(deep event\)/.test(fact(deep, 'ShakeMap contours').value) && (await env(frame)).counts.shakemapLines === 0, deep && deep.facts);
  await send(page, { type: 'hu:environment-focus', id: 'usgs:nc75467542' });
  const none = await waitMessage(page, "m.type === 'hu:environment-selected' && m.id === 'usgs:nc75467542' && m.facts.some(f => f.label === 'ShakeMap')", 20000);
  check(scope, 'an event without a ShakeMap carries the reason, never a line', !!none && fact(none, 'ShakeMap').value === 'no contours shown: no_shakemap' && none.modelled === false, none && none.facts);
  /* selection payloads of the fetched layers, each with its own time under its own label and the layer's retrieval time */
  const expectations = [
    ['cell:-119:34', { layer: 'cells', kind: 'fire_cell', observed_label: 'Acquired', observed_at: '2026-11-17T19:30:00.000Z', fetched_at: '2026-11-17T19:59:00.000Z', status: 'available', coverage: /NOAA-20 .* · .*NOAA-21 /, license: /CC0/, label: 'NASA FIRMS VIIRS NOAA-20 and NOAA-21' }],
    [detectionId, { layer: 'fires', kind: 'fire_detection', observed_label: 'Acquired', observed_at: firstDetection[4], fetched_at: firstDetection[5] === 'NOAA-21' ? '2026-11-17T19:59:00.000Z' : '2026-11-17T19:58:00.000Z', status: 'available', coverage: new RegExp(firstDetection[5]), license: /CC0/ }],
    ['wfigs:2026-CAXXX-000001', { layer: 'perimeters', kind: 'perimeter', observed_label: 'Captured', observed_at: '2026-11-17T06:10:00.000Z', fetched_at: '2026-11-17T19:57:00.000Z', status: 'available', coverage: /United States wildland fire/, license: /NIFC disclaimer/ }],
    ['nws:fx-flood-az', { layer: 'alerts', kind: 'alert', observed_label: 'Sent', observed_at: '2026-11-17T15:21:00.000Z', fetched_at: '2026-11-17T20:00:00.000Z', status: 'available', coverage: /United States active alerts/, license: /Public domain/ }],
    ['coops:8518750', { layer: 'tides', kind: 'station', observed_label: 'Observed', observed_at: '2026-11-17T15:48:00.000Z', fetched_at: '2026-11-17T19:56:00.000Z', status: 'available', coverage: /^The latest observed water level/, license: /NOAA asks to be credited/ }],
    ['eonet:EONET_fx_storm_1', { layer: 'eonet', kind: 'natural', observed_label: 'Reported', observed_at: '2026-11-17T06:00:00.000Z', fetched_at: '2026-11-17T14:00:00.000Z', status: 'stale', coverage: /Global open natural-event reports/, license: /NASA open data/ }]
  ];
  for (const [id, want] of expectations) {
    await page.evaluate(() => { window.__fromGlobe.length = 0; });
    const picked = await frame.evaluate(([x, layer]) => window.MCC_ENVIRONMENT_LAYERS.select(x, 'pick', { layer }), [id, want.layer]);
    const m = await waitMessage(page, `m.type === 'hu:environment-selected' && m.id === ${JSON.stringify(id)}`, 10000);
    /* a retrieval never precedes the observation it carries (G1R-3: the station catalogue's 08:00 once stood for readings observed at 15:48) */
    const ok = picked && !!m && m.layer === want.layer && m.kind === want.kind && m.observed_label === want.observed_label && m.observed_at === want.observed_at && m.fetched_at === want.fetched_at && m.status === want.status && want.coverage.test(m.coverage) && want.license.test(m.source.license) && (!want.label || m.source.label === want.label) && m.via === 'pick' && m.observed_at !== m.fetched_at && Date.parse(m.fetched_at) >= Date.parse(m.observed_at);
    check(scope, `selection payload for ${want.kind} (${id})`, ok, m && { layer: m.layer, kind: m.kind, observed_label: m.observed_label, observed_at: m.observed_at, fetched_at: m.fetched_at, status: m.status, coverage: m.coverage, label: m.source && m.source.label, license: m.source && m.source.license });
    if (id === 'coops:8518750') check(scope, 'a station reads its level in metres above MLLW and its quality', !!fact(m, 'Observed water level') && fact(m, 'Observed water level').value === '1.024 m above MLLW' && fact(m, 'Quality').value === 'preliminary', m && m.facts);
    if (id === 'nws:fx-flood-az') check(scope, 'a placed alert answers with a vertex of its own polygon', !!m && m.lat === 32.97 && m.lon === -113.33 && fact(m, 'Severity').value === 'Severe', m && { lat: m.lat, lon: m.lon });
    if (id === 'eonet:EONET_fx_storm_1') check(scope, 'a natural event answers with its stale source reason', !!m && m.reason === 'upstream_error' && fact(m, 'Track') && /track points: 5/.test(fact(m, 'Track').value), m && m.facts);
  }
  /* level of detail: footprints up close, summary cells from far */
  const nearView = await viewAtLod(frame, -118.9, 34.6, 120000, 'near');
  check(scope, 'at 120 km the fire footprints are the near level of detail', nearView.rendered && nearView.lod === 'near' && Math.abs(nearView.height - 120000) < 1, nearView);
  /* a real pick on the Fixture Ridge perimeter fill (east of its hole, inside its ring), and a miss over the ocean that falls through */
  await frame.evaluate(() => window.HuGlobe.viewer().camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-118.75, 34.6, 120000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }));
  await settle(frame); await page.waitForTimeout(800);
  await page.evaluate(() => { window.__fromGlobe.length = 0; });
  const box = await frame.locator('#globe').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const hit = await waitMessage(page, "m.type === 'hu:environment-selected' && m.via === 'pick'", 15000);
  check(scope, 'a tap on the perimeter fill picks it through the frame\'s own pick order', !!hit && hit.id === 'wfigs:2026-CAXXX-000001' && hit.kind === 'perimeter', hit && { id: hit.id, kind: hit.kind });
  const farView = await viewAtLod(frame, -150, 8, 3000000, 'far');
  check(scope, 'from 3,000 km the fires are summarised per cell (far level of detail)', farView.rendered && farView.lod === 'far' && Math.abs(farView.height - 3000000) < 1, farView);
  await settle(frame); await page.waitForTimeout(600);
  await page.evaluate(() => { window.__fromGlobe.length = 0; });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(800);
  const missed = (await fromGlobe(page)).filter((m) => m.type === 'hu:environment-selected');
  check(scope, 'a tap on open ocean hits no environmental id and falls through as before', missed.length === 0 && !(await frame.evaluate(() => window.__huCountries && window.__huCountries().selected)), { missed: missed.length });
  /* a tap on land with no environmental geometry under it falls through to the countries layer exactly as before */
  await frame.evaluate(() => window.HuGlobe.viewer().camera.setView({ destination: Cesium.Cartesian3.fromDegrees(134, -25, 3000000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }));
  await settle(frame); await page.waitForTimeout(600);
  await page.evaluate(() => { window.__fromGlobe.length = 0; });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const country = await until(frame, () => window.__huCountries && window.__huCountries().selected === 'AU', null, 10000);
  const missedLand = (await fromGlobe(page)).filter((m) => m.type === 'hu:environment-selected');
  check(scope, 'a tap over central Australia selects the country, no environmental id in the way', country && missedLand.length === 0, { country, missed: missedLand.length, selected: await frame.evaluate(() => window.__huCountries && window.__huCountries().selected) });
  await frame.evaluate(() => { const c = document.querySelector('.country-card__close'); if (c) c.click(); });
  /* the director: the significance tour, pause, and the quake replay queue */
  await page.evaluate(() => { window.__fromGlobe.length = 0; });
  await send(page, { type: 'hu:environment-scene', action: 'play' });
  const playing = await waitMessage(page, "m.type === 'hu:environment-scene-state' && m.playing === true", 10000);
  check(scope, 'play starts the significance tour (12 scenes, newest first)', !!playing && playing.queue === 'significant' && playing.total === 12 && playing.index === 0 && playing.reason === null, playing);
  const toured = await waitMessage(page, "m.type === 'hu:environment-selected' && m.via === 'tour'", 15000);
  check(scope, 'arriving at a scene selects it with via tour', !!toured && toured.id === playing.id, toured && { id: toured.id, via: toured.via });
  await send(page, { type: 'hu:environment-scene', action: 'pause' });
  const paused = await waitMessage(page, "m.type === 'hu:environment-scene-state' && m.playing === false", 10000);
  check(scope, 'pause stops the tour and keeps its place', !!paused && paused.index === 0 && paused.reason === null, paused);
  await send(page, { type: 'hu:environment-layers', on: true, selected: '', replay: 'quakes-24h', layers: { fires: true, perimeters: true, alerts: true, eonet: true, tides: true } });
  const replayQueued = await until(frame, () => { const d = window.__mccSceneDirector(); return d.queue === 'quakes-24h' && d.total === 48; }, null, 10000);
  check(scope, 'the replay queues the last 24 h of quakes in recorded order (48 of 50)', replayQueued, await dir(frame));
  await send(page, { type: 'hu:environment-layers', on: true, selected: '', replay: null, layers: { fires: true, perimeters: true, alerts: true, eonet: true, tides: true } });
  check(scope, 'replay off restores the significance tour', await until(frame, () => window.__mccSceneDirector().queue === 'significant', null, 10000));
  /* the 2D view: the layers stay mounted, the counts stand, no error */
  await page.evaluate(() => { window.__fromGlobe.length = 0; });
  await send(page, { type: 'hu:environment-view', mode: '2d' });
  const morphed = await waitMessage(page, "m.type === 'hu:environment-view-state' && m.mode === '2d' && m.morphing === false", 15000);
  const is2d = await frame.evaluate(() => window.HuGlobe.viewer().scene.mode === Cesium.SceneMode.SCENE2D);
  const c2 = (await env(frame)).counts;
  check(scope, '2D map: the scene morphs, the typed layers stay and the counts stand', !!morphed && is2d && c2.quakeDiscs === c.quakeDiscs && c2.firesNear === c.firesNear && c2.perimeters === c.perimeters && c2.alerts.drawn === c.alerts.drawn && c2.tides === c.tides, { morphed: !!morphed, is2d, c2 });
  await send(page, { type: 'hu:environment-view', mode: '3d' });
  check(scope, 'back to the 3D globe', !!(await waitMessage(page, "m.type === 'hu:environment-view-state' && m.mode === '3d' && m.morphing === false", 15000)));
  /* ---------- event timeline slice S5: recognisable quakes, a real tap on a glyph, the push, the ripple, the rupture ---------- */
  const QUAKE = (id) => { const q = FIX.pins.find((i) => i.id === id); return { id, lon: q.lon, lat: q.lat }; };
  /* back to the same orbit, a push still under way stopped first (a script's setView does not stop a flight) */
  const orbit = async () => { await frame.evaluate(() => { const v = window.HuGlobe.viewer(); v.camera.cancelFlight(); v.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-95, -20, 17000000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); }); await until(frame, () => { const c = window.__mccEnvironmentLayers().camera; return !c || !c.flying; }, null, 5000); };
  const glyphAt = async (q) => (await frame.evaluate(([lon, lat]) => { const w = Cesium.SceneTransforms.worldToWindowCoordinates(window.HuGlobe.viewer().scene, Cesium.Cartesian3.fromDegrees(lon, lat, 2000)); return w ? { x: w.x, y: w.y } : null; }, [q.lon, q.lat])) || { x: -1000, y: -1000 };
  await orbit(); await settle(frame); await page.waitForTimeout(800);
  const atOrbit = await frame.evaluate(() => { const s = window.__mccEnvironmentLayers(), m = s.marks, P = window.MCC_ENVIRONMENT_QUAKE_MARKS.pure; return { marks: m, counts: s.counts, safe: P.safeArea(m.frame.width, m.frame.height), keep: P.keepOut(m.frame.width, m.frame.height) }; });
  {
    const m = atOrbit.marks, safe = atOrbit.safe, boxes = m.boxes || [];
    const over = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const inside = boxes.every((b) => b.x >= safe.left && b.y >= safe.top && b.x + b.w <= m.frame.width - safe.right && b.y + b.h <= m.frame.height - safe.bottom && !atOrbit.keep.some((k) => over(k, b)));
    const apart = boxes.every((b, i) => boxes.every((c, j) => i === j || !over(b, c)));
    check(scope, 'S5: every quake is a glyph (50, no quake dot) and from orbit the largest carry their magnitude and place, at least three, none overlapping, all inside the frame\'s free area', m.glyphs === 50 && atOrbit.counts.glyphs === 50 && m.visible >= 5 && boxes.length >= 3 && inside && apart, { glyphs: m.glyphs, visible: m.visible, labels: m.labels, boxes, frame: m.frame });
  }
  /* a real tap 15 px to the right of the M6.2 glyph off Chile: selected, the camera pushing in, the rings waiting for the landing */
  await page.evaluate(() => { window.__fromGlobe.length = 0; });
  const m62 = QUAKE('usgs:fx-m62'), gbox = await frame.locator('#globe').boundingBox(), w62 = await glyphAt(m62);
  await page.mouse.click(gbox.x + w62.x + 15, gbox.y + w62.y);
  const tapped = await waitMessage(page, "m.type === 'hu:environment-selected' && m.id === 'usgs:fx-m62' && m.via === 'pick'", 10000);
  const during = await env(frame);
  /* under software GL a read can come after a 1.7 s push has landed: then the record must show the flight and rings that began
     only when it landed */
  const pushed = !!during.camera && (during.camera.flying === true ? during.camera.id === 'usgs:fx-m62' && !!during.ripple && during.ripple.phase === 'waiting'
    : !!during.camera.last && during.camera.last.id === 'usgs:fx-m62' && during.camera.last.mode === 'flight' && !!(during.ripple || during.lastRipple) && (during.ripple || during.lastRipple).ringsAt >= during.camera.last.at - 50);
  check(scope, 'S5: a real tap 15 px from a glyph selects that quake (a 44 px target) and pushes the camera to it; its rings wait for the landing', !!tapped && pushed, { tapped: !!tapped, camera: during.camera, ripple: during.ripple, lastRipple: during.lastRipple });
  /* the visitor's hand wins: a press and drag on the globe right after a tap stops that push where it is, and the rings begin
     there (a press, not a wheel: under software GL the browser held a wheel back for seconds while the frame drew) */
  await orbit(); await settle(frame); await page.waitForTimeout(800);
  const m36 = QUAKE('usgs:fx-gen-36'), w36 = await glyphAt(m36);
  await page.mouse.click(gbox.x + w36.x + 12, gbox.y + w36.y - 6);
  await page.mouse.move(gbox.x + w36.x - 80, gbox.y + w36.y - 70);
  await page.mouse.down(); await page.mouse.move(gbox.x + w36.x - 50, gbox.y + w36.y - 50, { steps: 2 }); await page.mouse.up();
  const stopped = await until(frame, () => { const c = window.__mccEnvironmentLayers().camera; return !!c && !c.flying && !!c.last && c.last.id === 'usgs:fx-gen-36'; }, null, 8000);
  const afterHand = await env(frame);
  check(scope, 'S5: a press on the globe cancels the push at once (cancel, by input) and the rings then go where the camera stopped', stopped && afterHand.camera.last.how === 'cancel' && afterHand.camera.last.reason === 'input' && (!afterHand.ripple || afterHand.ripple.phase === 'rings'), { camera: afterHand.camera, ripple: afterHand.ripple });
  /* a tap that is left alone: the push lands on the regional frame (M6.2: 222 km away, 53.5 degrees down), the quake at the
     centre, its label inside the free area; the rings run and end within their bound; every hold is let go */
  await orbit(); await settle(frame); await page.waitForTimeout(800);
  const back = await glyphAt(m62), t61 = Date.now();
  await page.mouse.click(gbox.x + back.x - 10, gbox.y + back.y + 8);
  const landed = await until(frame, () => { const c = window.__mccEnvironmentLayers().camera; return !!c && !c.flying && !!c.last && c.last.id === 'usgs:fx-m62' && c.last.how === 'complete'; }, null, 15000);
  const view = await frame.evaluate(([lon, lat]) => { const v = window.HuGlobe.viewer(), s = window.__mccEnvironmentLayers(), w = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, Cesium.Cartesian3.fromDegrees(lon, lat, 2000)), P = window.MCC_ENVIRONMENT_QUAKE_MARKS.pure; return { height: Math.round(v.camera.positionCartographic.height), pitch: Math.round(Cesium.Math.toDegrees(v.camera.pitch) * 10) / 10, at: w ? { x: Math.round(w.x), y: Math.round(w.y) } : null, canvas: { w: v.scene.canvas.clientWidth, h: v.scene.canvas.clientHeight }, marks: s.marks, ripple: s.ripple, safe: P.safeArea(s.marks.frame.width, s.marks.frame.height), keep: P.keepOut(s.marks.frame.width, s.marks.frame.height) }; }, [m62.lon, m62.lat]);
  {
    const box = (view.marks.boxes || []).find((b) => b.id === 'usgs:fx-m62'), over = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const centred = !!view.at && Math.abs(view.at.x - view.canvas.w / 2) <= view.canvas.w * 0.06 && Math.abs(view.at.y - view.canvas.h / 2) <= view.canvas.h * 0.06;
    const labelOk = !!box && box.x >= view.safe.left && box.y >= view.safe.top && box.x + box.w <= view.canvas.w - view.safe.right && box.y + box.h <= view.canvas.h - view.safe.bottom && !view.keep.some((k) => over(k, box));
    check(scope, 'S5: left alone, the push lands on the quake\'s regional frame (about 178 km up, 53.5 degrees down), the quake at the centre, its label inside the free area', landed && Math.abs(view.height - 178500) < 15000 && Math.abs(view.pitch + 53.5) < 1.5 && centred && labelOk && view.marks.selected === 'usgs:fx-m62', { landed, height: view.height, pitch: view.pitch, at: view.at, canvas: view.canvas, box, selected: view.marks.selected });
  }
  const rang = await until(frame, () => { const s = window.__mccEnvironmentLayers(); return s.ripple === null && !!s.lastRipple && s.lastRipple.id === 'usgs:fx-m62' && !window.__mccGlobeGovernor().holds.includes('env-ripple'); }, null, 12000);
  const after = await env(frame), lr = after.lastRipple, landAt = after.camera && after.camera.last ? after.camera.last.at : null;
  check(scope, 'S5: the rings began when the push landed and ended within 6.5 s of the choice, their hold let go', rang && !!lr && lr.ringsAt !== null && landAt !== null && lr.ringsAt >= landAt - 50 && lr.endedAt - lr.startedAt <= 6500, { lr, landAt, sinceTapMs: Date.now() - t61 });
  check(scope, 'S5: every hold let go after the push and the rings: back on demand', await until(frame, () => { const g = window.__mccGlobeGovernor(); return g.enabled && g.holds.length === 0; }, null, 20000), await gov(frame));
  /* a documented rupture: the recorded M7.0 of 2026-10-22, 189 km ENE of Nagqu, China (USGS us6000u43g), joins the pins; its
     USGS finite-fault plane's modelled up-dip edge is drawn as one line and called a model in the selection and the legend */
  const nagqu = { id: 'usgs:us6000u43g', title: '189 km ENE of Nagqu, China', lat: 32.3376, lon: 93.7837, stale: false, category: 'quake', location_kind: 'reported_point', source: { label: 'USGS', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us6000u43g' }, observed_at: new Date(1792679620289).toISOString(), fetched_at: '2026-11-19T02:00:00.000Z', facts: [{ label: 'Magnitude', value: '7' }, { label: 'Depth', value: '18 km' }], significant: true };
  await page.evaluate((x) => window.__send({ type: 'hu:environment-pins', on: true, selected: '', items: window.__pinsFixture.concat([x]), sources: window.__pinsSources }), nagqu);
  check(scope, 'S5: the added quake is a glyph like the others', await until(frame, () => window.__mccEnvironmentLayers().counts.glyphs === 51, null, 10000), (await env(frame)).counts);
  await page.evaluate(() => { window.__fromGlobe.length = 0; });
  await send(page, { type: 'hu:environment-focus', id: 'usgs:us6000u43g' });
  const ruptured = await waitMessage(page, "m.type === 'hu:environment-selected' && m.id === 'usgs:us6000u43g' && m.facts.some((f) => f.label === 'Rupture')", 20000);
  const edge = await until(frame, () => { const s = window.__mccEnvironmentLayers(); return !!s.rupture && s.rupture.lines === 1 && s.rupture.available === true && s.built; }, null, 30000);
  const rLegend = (await env(frame)).legend;
  check(scope, 'S5: the M7.0\'s modelled up-dip edge is drawn as one line, the selection and the legend say it is a model and never a mapped crack', !!ruptured && edge && fact(ruptured, 'Rupture').value === 'modelled rupture plane (USGS finite fault): up-dip edge drawn, top at 0.1 km depth, model of 2026-11-03' && rLegend.some((l) => /modelled up-dip edge/.test(l) && /not a mapped crack/.test(l)), { rupture: ruptured && fact(ruptured, 'Rupture'), legend: rLegend.filter((l) => /rupture|up-dip/i.test(l)) });
  await page.evaluate(() => window.__send({ type: 'hu:environment-pins', on: true, selected: '', items: window.__pinsFixture, sources: window.__pinsSources }));
  /* deactivation: continuous loop again, legend hidden, no leftover hold */
  await send(page, { type: 'hu:environment-layers', on: false, selected: '', replay: null, layers: { fires: true, perimeters: true, alerts: true, eonet: true, tides: true } });
  const off = await until(frame, () => { const g = window.__mccGlobeGovernor(); return !g.enabled && !window.__mccEnvironmentLayers().on; }, null, 10000);
  check(scope, 'layers off: the governor is disabled, the loop continuous and the legend hidden', off && (await frame.evaluate(() => window.HuGlobe.viewer().scene.requestRenderMode === false && document.getElementById('envLegend').hidden === true)), await gov(frame));
  const wf = await widths(frame), wh = await widths(page);
  check(scope, 'scrollWidth === clientWidth in the frame and on the host', wf.scrollW === wf.clientW && wh.scrollW === wh.clientW, { frame: wf, host: wh });
  check(scope, 'the frame never requested the feed route', requests.filter((p) => p === '/v1/world/environment').length === 0, requests.filter((p) => p.startsWith('/v1/world/environment')));
  check(scope, 'no page errors', errors.length === 0, errors);
  await page.screenshot({ path: join(OUT, `environment-globe-${scope}.png`) }).catch(() => {});
  await ctx.close();
}

/* one layer unavailable, truthfully: the perimeters route answers 500 */
{
  const scope = '390-unavailable';
  const { ctx, page, errors } = await context({ width: 390, height: 844 }, { fail: 'perimeters' });
  await page.goto(`${HOST}?layers=on`, { waitUntil: 'load' });
  const frame = await globeFrame(page);
  const ready = await until(frame, () => { const s = window.__mccEnvironmentLayers && window.__mccEnvironmentLayers(); return !!s && s.on && s.ready; }, null, 120000);
  const s = await env(frame);
  const st = (await fromGlobe(page)).filter((m) => m.type === 'hu:environment-layer-state' && m.layer === 'perimeters').pop();
  check(scope, 'a failed route is reported unavailable with its HTTP reason and draws nothing', ready && !!st && st.status === 'unavailable' && st.reason === 'http_500' && st.fetched_at === null && st.count === 0 && s.counts.perimeters === 0 && s.counts.firesNear === 600, st && { status: st.status, reason: st.reason, counts: s.counts.perimeters });
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* the policy gate: 503 module_policy_unavailable and 404 module_disabled put every layer in the policy state and arm no retry */
for (const [status, code] of [[503, 'module_policy_unavailable'], [404, 'module_disabled']]) {
  const scope = `390-policy-${status}`;
  const { ctx, page, errors, requests } = await context({ width: 390, height: 844 }, { policy: status });
  await page.goto(`${HOST}?layers=on`, { waitUntil: 'load' });
  const frame = await globeFrame(page);
  const gated = await until(page, (c) => { const by = {}; for (const m of window.__fromGlobe) if (m.type === 'hu:environment-layer-state' && m.status === 'policy' && m.reason === c) by[m.layer] = true; return ['fires', 'perimeters', 'alerts', 'eonet', 'tides', 'shakemap'].every((l) => by[l]); }, code, 60000);
  const s = await env(frame);
  check(scope, `every layer reports status policy with reason ${code}`, gated && s.policy === true, s && s.states);
  /* E=UP slice S0 (2026-11-19), changed on purpose: off (404 module_disabled) and an outage (503) are two lines in the legend */
  const legendLine = status === 404 ? 'Environmental layers are turned off for now' : 'Environmental layers are not available right now';
  check(scope, `the legend says "${legendLine}"`, !!s && s.legend.includes(legendLine) && (await frame.evaluate((t) => !document.getElementById('envLegend').hidden && [...document.querySelectorAll('#envLegendList li')].some((li) => li.textContent === t), legendLine)), s && s.legend);
  const before = requests.filter((p) => p.startsWith('/v1/world/environment/')).length;
  await page.waitForTimeout(30000);
  const after = requests.filter((p) => p.startsWith('/v1/world/environment/')).length;
  check(scope, 'no retry request within 30 s of the refusal', before === after && before <= 5, { before, after });
  /* G1R-2: a layer whose 503 body was still being read when the first refusal landed used to end as 'unavailable http_503' after its
     'policy' message; the LAST state of every layer must be the policy state */
  const lastByLayer = {};
  for (const m of await fromGlobe(page)) if (m.type === 'hu:environment-layer-state') lastByLayer[m.layer] = [m.status, m.reason];
  check(scope, `the LAST state of every layer is policy with reason ${code}`, ['fires', 'perimeters', 'alerts', 'eonet', 'tides', 'shakemap'].every((l) => lastByLayer[l] && lastByLayer[l][0] === 'policy' && lastByLayer[l][1] === code), lastByLayer);
  check(scope, 'the frame never requested the feed route', requests.filter((p) => p === '/v1/world/environment').length === 0);
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* reduced motion: play refused, focus jumps, the ripple a still outline, animations off in the legend */
{
  const scope = '390-reduced-motion';
  const { ctx, page, errors } = await context({ width: 390, height: 844 }, { reducedMotion: 'reduce' });
  await page.goto(`${HOST}?layers=on`, { waitUntil: 'load' });
  const frame = await globeFrame(page);
  const ready = await until(frame, () => { const s = window.__mccEnvironmentLayers && window.__mccEnvironmentLayers(); return !!s && s.on && s.ready && s.counts.events === 62; }, null, 120000);
  check(scope, 'layers ready under reduced motion', ready);
  await send(page, { type: 'hu:environment-scene', action: 'play' });
  const refused = await waitMessage(page, "m.type === 'hu:environment-scene-state' && m.reason === 'reduced-motion'", 10000);
  check(scope, 'play is refused with reason reduced-motion', !!refused && refused.playing === false, refused);
  await page.evaluate(() => { window.__fromGlobe.length = 0; });
  await send(page, { type: 'hu:environment-focus', id: 'usgs:us7000tyhr' });
  const sel = await waitMessage(page, "m.type === 'hu:environment-selected' && m.id === 'usgs:us7000tyhr' && m.via === 'focus'", 15000);
  const height = await frame.evaluate(() => Math.round(window.HuGlobe.viewer().camera.positionCartographic.height));
  const s = await env(frame);
  /* E=UP event timeline slice S5 (2026-11-19), changed on purpose (decisions D14, D17): the focus still jumps with no flight, now to
     the quake's regional frame (M5.4: 174 km away, 49.5 degrees down, about 132 km up; before S5, 900 km straight down), and the
     ripple is a still outline at its regional radius, so the payload says it is illustrative (before S5: no ripple at all) */
  check(scope, 'focus jumps with no flight to the regional frame (about 132 km up), the ripple a still outline labelled illustrative', !!sel && sel.illustrative === 'Ripple is illustrative: not a recording of shaking' && !!s.ripple && s.ripple.phase === 'outline' && Math.abs(height - 132300) < 8000 && !!s.camera && s.camera.last && s.camera.last.how === 'jump', { height, ripple: s.ripple, camera: s.camera, illustrative: sel && sel.illustrative });
  check(scope, 'the legend says animations are off', s.legend.includes('(animations off)'), s.legend);
  /* a real tap on a glyph selects the quake and moves nothing: no push under reduced motion */
  await frame.evaluate(() => window.HuGlobe.viewer().camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-95, -20, 17000000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }));
  await settle(frame); await page.waitForTimeout(800);
  const q = FIX.pins.find((i) => i.id === 'usgs:fx-m62'), gb = await frame.locator('#globe').boundingBox();
  const w = await frame.evaluate(([lon, lat]) => { const p = Cesium.SceneTransforms.worldToWindowCoordinates(window.HuGlobe.viewer().scene, Cesium.Cartesian3.fromDegrees(lon, lat, 2000)); return p ? { x: p.x, y: p.y } : null; }, [q.lon, q.lat]);
  const before = await frame.evaluate(() => Math.round(window.HuGlobe.viewer().camera.positionCartographic.height));
  await page.evaluate(() => { window.__fromGlobe.length = 0; });
  await page.mouse.click(gb.x + w.x + 12, gb.y + w.y);
  const tapped = await waitMessage(page, "m.type === 'hu:environment-selected' && m.id === 'usgs:fx-m62' && m.via === 'pick'", 10000);
  await page.waitForTimeout(1500);
  const afterTap = await frame.evaluate(() => Math.round(window.HuGlobe.viewer().camera.positionCartographic.height));
  const s2 = await env(frame);
  check(scope, 'S5: a tap on a glyph selects the quake and the camera does not move', !!tapped && Math.abs(afterTap - before) < 2 && !s2.camera.flying && s2.camera.last.how === 'none' && !!s2.ripple && s2.ripple.phase === 'outline', { before, afterTap, camera: s2.camera, ripple: s2.ripple });
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* D16 (event timeline slice S5, default adopted pending Matthew's confirmation): with mission pins on the globe and the layers on,
   the missions' halos stand still at their resting size and take no legacy hold, so the globe draws on demand; with the layers
   off they breathe again under the legacy hold, exactly as before */
{
  const scope = '390-missions-d16';
  const { ctx, page, errors } = await context({ width: 390, height: 844 }, { missions: true });
  await page.goto(`${HOST}?layers=on&missions=1`, { waitUntil: 'load' });
  const frame = await globeFrame(page);
  const ready = await until(frame, () => { const s = window.__mccEnvironmentLayers && window.__mccEnvironmentLayers(); return !!s && s.on && s.ready && s.counts.events === 62 && window.__huMissionPins() > 0; }, null, 120000);
  check(scope, 'the mission pins are drawn and the layers ready', ready, { pins: await frame.evaluate(() => window.__huMissionPins && window.__huMissionPins()) });
  const halos = () => frame.evaluate(() => { const t = Cesium.JulianDate.now(); return window.HuGlobe.viewer().entities.values.filter((e) => e.properties && e.properties.halo).map((e) => Math.round(e.billboard.scale.getValue(t) * 1000) / 1000); });
  const onDemand = await until(frame, () => { const g = window.__mccGlobeGovernor(); return g.enabled && g.holds.length === 0 && g.mode === 'on-demand'; }, null, 30000);
  const h1 = await halos(); await page.waitForTimeout(450); const h2 = await halos();
  check(scope, 'D16: the layers on, the halos stand still at 1.12 and the globe renders on demand (no legacy hold)', onDemand && h1.length > 0 && h1.every((x) => x === 1.12) && JSON.stringify(h1) === JSON.stringify(h2), { governor: await gov(frame), h1, h2 });
  await send(page, { type: 'hu:environment-layers', on: false, selected: '', replay: null, layers: { fires: true, perimeters: true, alerts: true, eonet: true, tides: true } });
  const legacy = await until(frame, () => !window.__mccEnvironmentLayers().on && window.__mccGlobeGovernor().holds.includes('legacy'), null, 15000);
  const h3 = await halos(); await page.waitForTimeout(450); const h4 = await halos();
  check(scope, 'D16: the layers off, the halos breathe again under the legacy hold, as before', legacy && h3.length > 0 && JSON.stringify(h3) !== JSON.stringify(h4), { governor: await gov(frame), h3, h4 });
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();

/* the perf script in --check mode: a short run that must produce numbers for both modes */
{
  const perf = spawnSync(process.execPath, [join(ROOT, 'scripts/perf/environment-globe-perf.mjs'), '--check', join(OUT, 'perf-check')], { env: process.env, encoding: 'utf8', timeout: 600000 });
  console.log(perf.stdout.split('\n').filter((l) => /^(PASS|FAIL|INFO|RESULT)/.test(l)).join('\n'));
  check('perf', 'scripts/perf/environment-globe-perf.mjs --check exits 0', perf.status === 0, { status: perf.status, stderr: (perf.stderr || '').slice(0, 300) });
}

server.close();
await writeFile(join(OUT, 'summary.json'), JSON.stringify({ failed, at: new Date().toISOString() }, null, 1));
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
