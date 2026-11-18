/* The environmental globe inside its frame (slice G1, 2026-11-17), in a real browser at 390 and 1280 with every layer
   route answered from the fixtures: counts per layer, the legend sentences, the selection payload per layer (source,
   recorded time under its own label, retrieval time, coverage, status), ShakeMap contours on the selected quake with
   the modelled label, the ripple's bounded hold, reduced motion, the 2D toggle, the policy gate (503 and 404), one
   layer unavailable and one stale reported truthfully, a real pick and a miss that falls through, the feed route never
   requested by the frame, scrollWidth === clientWidth, no page errors, and the perf script in --check mode.

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
for (const name of ['layers-fires', 'layers-perimeters', 'layers-alerts', 'layers-eonet', 'layers-tides', 'shakemap-us7000tyhr', 'shakemap-us7000tyca', 'shakemap-none', 'policy-503', 'policy-404', 'pins']) FIX[name] = JSON.parse(await readFile(join(FIXTURE_DIR, name + '.json'), 'utf8'));
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

async function context(viewport, { reducedMotion = 'no-preference', policy = null, fail = null } = {}) {
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
    if (p === '/v1/world/access') return json(route, { level: 'public', unlocked_layers: ['flights'], locked_layers: ['satellites', 'launches', 'intel', 'music', 'cctv', 'audience', 'transport'].map((id) => ({ id, reason: 'sign_in_required', next_step: 'sign_in' })), layers: {} });
    if (p === '/v1/world/ion') return json(route, { available: false });
    return json(route, {});
  });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => json(route, []));
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
  check(scope, 'fires state copies fetched_at, last_success_at, attribution and licence from the Worker sources', !!fires && fires.status === 'available' && fires.fetched_at === '2026-11-17T19:58:00.000Z' && fires.last_success_at === '2026-11-17T19:58:00.000Z' && /VIIRS 375 m active fire product/.test(fires.attribution) && /CC0 1\.0/.test(fires.license) && fires.count === 600 && fires.total === 600 && fires.truncated === false && fires.sources.length === 2 && fires.digest.cells.length === 10 && fires.digest.cell_degrees === 1, fires && { status: fires.status, fetched_at: fires.fetched_at, attribution: fires.attribution, count: fires.count });
  check(scope, 'eonet is reported stale with the provider reason, never invented', !!eonet && eonet.status === 'stale' && eonet.reason === 'upstream_error' && eonet.fetched_at === '2026-11-17T14:00:00.000Z' && eonet.last_success_at === '2026-11-17T14:00:00.000Z', eonet && { status: eonet.status, reason: eonet.reason });
  check(scope, 'tides state: 14 of 20 documented stations answered', !!tides && tides.status === 'available' && tides.count === 14 && tides.total === 20 && tides.digest.answered === 14 && tides.digest.stations === 20, tides && tides.digest);
  check(scope, 'alerts digest carries the Worker counts', !!alerts && alerts.digest && alerts.digest.counts.polygon === 70 && alerts.digest.counts.zone_only === 25 && alerts.digest.counts.rejected === 5, alerts && alerts.digest);
  check(scope, 'perimeters digest: the ten largest with a real first vertex', !!perims && perims.digest.top.length === 10 && perims.digest.top[0].name === 'Fixture Ridge' && perims.digest.top[0].lat === 34.6 && typeof perims.digest.top[0].lon === 'number', perims && perims.digest.top[0]);
  check(scope, 'events state counts by provider', !!events && events.count === 62 && JSON.stringify(events.digest.by_provider) === JSON.stringify({ usgs: 50, nws: 5, eonet: 6, nhc: 1 }), events && events.digest);
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
  check(scope, 'focus answers hu:environment-selected with source, recorded time under its label, retrieval time, coverage and status', !!sel && sel.layer === 'events' && sel.kind === 'quake' && sel.source.label === 'USGS' && sel.source.url === 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000tyhr' && /Earthquake Hazards Program/.test(sel.source.attribution) && sel.observed_label === 'Observed' && sel.observed_at === '2026-11-16T04:24:11.718Z' && sel.fetched_at === '2026-11-17T20:04:00.000Z' && sel.coverage === 'Global earthquakes reported in the past day' && sel.status === 'available' && sel.reason === null && sel.lat === 37.3664 && sel.lon === 136.7444 && sel.illustrative === 'Ripple is illustrative: not a recording of shaking', sel);
  const g1 = await gov(frame);
  const r1 = await env(frame);
  check(scope, 'the ripple runs under the bounded env-ripple hold and is labelled in the legend', !!r1.ripple && r1.ripple.active && g1.holds.includes('env-ripple') && r1.legend.includes('Ripple is illustrative: not a recording of shaking'), { holds: g1.holds, ripple: r1.ripple });
  const modelled = await waitMessage(page, "m.type === 'hu:environment-selected' && m.id === 'usgs:us7000tyhr' && m.modelled === true", 20000);
  const smLine = fact(modelled, 'ShakeMap');
  check(scope, 'the ShakeMap arrives with the modelled label (v5, automatic, max MMI 2.9, computed time)', !!modelled && !!smLine && smLine.value === 'modelled shaking (MMI), USGS ShakeMap v5 (automatic), max MMI 2.9, computed 2026-11-17T04:28:22.000Z' && modelled.observed_label === 'Observed', smLine);
  const smState = await waitMessage(page, "m.type === 'hu:environment-layer-state' && m.layer === 'shakemap' && m.digest && m.digest.available === true", 20000);
  check(scope, 'the shakemap layer state carries the digest and the two USGS sources', !!smState && smState.digest.version === 5 && smState.digest.max_mmi === 2.9 && smState.digest.event_id === 'us7000tyhr' && smState.sources.length === 2 && smState.sources[1].label === 'USGS ShakeMap' && /Geological Survey ShakeMap/.test(smState.sources[1].attribution) && smState.fetched_at === '2026-11-17T20:01:00.000Z', smState && { digest: smState.digest, sources: smState.sources.map((s) => s.label), fetched_at: smState.fetched_at });
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
    ['cell:-119:34', { layer: 'cells', kind: 'fire_cell', observed_label: 'Acquired', observed_at: '2026-11-17T19:30:00.000Z', fetched_at: '2026-11-17T19:58:00.000Z', status: 'available', coverage: /NOAA-20/, license: /CC0/ }],
    [detectionId, { layer: 'fires', kind: 'fire_detection', observed_label: 'Acquired', observed_at: firstDetection[4], fetched_at: firstDetection[5] === 'NOAA-21' ? '2026-11-17T19:59:00.000Z' : '2026-11-17T19:58:00.000Z', status: 'available', coverage: new RegExp(firstDetection[5]), license: /CC0/ }],
    ['wfigs:2026-CAXXX-000001', { layer: 'perimeters', kind: 'perimeter', observed_label: 'Captured', observed_at: '2026-11-17T06:10:00.000Z', fetched_at: '2026-11-17T19:57:00.000Z', status: 'available', coverage: /United States wildland fire/, license: /NIFC disclaimer/ }],
    ['nws:fx-flood-az', { layer: 'alerts', kind: 'alert', observed_label: 'Sent', observed_at: '2026-11-17T15:21:00.000Z', fetched_at: '2026-11-17T20:00:00.000Z', status: 'available', coverage: /United States active alerts/, license: /Public domain/ }],
    ['coops:8518750', { layer: 'tides', kind: 'station', observed_label: 'Observed', observed_at: '2026-11-17T15:48:00.000Z', fetched_at: '2026-11-17T08:00:00.000Z', status: 'available', coverage: /water-level stations/, license: /NOAA asks to be credited/ }],
    ['eonet:EONET_fx_storm_1', { layer: 'eonet', kind: 'natural', observed_label: 'Reported', observed_at: '2026-11-17T06:00:00.000Z', fetched_at: '2026-11-17T14:00:00.000Z', status: 'stale', coverage: /Global open natural-event reports/, license: /NASA open data/ }]
  ];
  for (const [id, want] of expectations) {
    await page.evaluate(() => { window.__fromGlobe.length = 0; });
    const picked = await frame.evaluate(([x, layer]) => window.MCC_ENVIRONMENT_LAYERS.select(x, 'pick', { layer }), [id, want.layer]);
    const m = await waitMessage(page, `m.type === 'hu:environment-selected' && m.id === ${JSON.stringify(id)}`, 10000);
    const ok = picked && !!m && m.layer === want.layer && m.kind === want.kind && m.observed_label === want.observed_label && m.observed_at === want.observed_at && m.fetched_at === want.fetched_at && m.status === want.status && want.coverage.test(m.coverage) && want.license.test(m.source.license) && m.via === 'pick' && m.observed_at !== m.fetched_at;
    check(scope, `selection payload for ${want.kind} (${id})`, ok, m && { layer: m.layer, kind: m.kind, observed_label: m.observed_label, observed_at: m.observed_at, fetched_at: m.fetched_at, status: m.status, coverage: m.coverage, license: m.source && m.source.license });
    if (id === 'coops:8518750') check(scope, 'a station reads its level in metres above MLLW and its quality', !!fact(m, 'Observed water level') && fact(m, 'Observed water level').value === '1.024 m above MLLW' && fact(m, 'Quality').value === 'preliminary', m && m.facts);
    if (id === 'nws:fx-flood-az') check(scope, 'a placed alert answers with a vertex of its own polygon', !!m && m.lat === 32.97 && m.lon === -113.33 && fact(m, 'Severity').value === 'Severe', m && { lat: m.lat, lon: m.lon });
    if (id === 'eonet:EONET_fx_storm_1') check(scope, 'a natural event answers with its stale source reason', !!m && m.reason === 'upstream_error' && fact(m, 'Track') && /track points: 5/.test(fact(m, 'Track').value), m && m.facts);
  }
  /* level of detail: footprints up close, summary cells from far */
  await frame.evaluate(() => window.HuGlobe.viewer().camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-118.9, 34.6, 120000) }));
  check(scope, 'at 120 km the fire footprints are the near level of detail', await until(frame, () => window.__mccEnvironmentLayers().lod === 'near', null, 5000), (await env(frame)).lod);
  /* a real pick on the Fixture Ridge perimeter fill (east of its hole, inside its ring), and a miss over the ocean that falls through */
  await frame.evaluate(() => window.HuGlobe.viewer().camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-118.75, 34.6, 120000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }));
  await settle(frame); await page.waitForTimeout(800);
  await page.evaluate(() => { window.__fromGlobe.length = 0; });
  const box = await frame.locator('#globe').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const hit = await waitMessage(page, "m.type === 'hu:environment-selected' && m.via === 'pick'", 15000);
  check(scope, 'a tap on the perimeter fill picks it through the frame\'s own pick order', !!hit && hit.id === 'wfigs:2026-CAXXX-000001' && hit.kind === 'perimeter', hit && { id: hit.id, kind: hit.kind });
  await frame.evaluate(() => window.HuGlobe.viewer().camera.setView({ destination: Cesium.Cartesian3.fromDegrees(-150, 8, 3000000) }));
  check(scope, 'from 3,000 km the fires are summarised per cell (far level of detail)', await until(frame, () => window.__mccEnvironmentLayers().lod === 'far', null, 5000), (await env(frame)).lod);
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
  check(scope, 'the legend says the layers are not available right now', !!s && s.legend.includes('Environmental layers are not available right now') && (await frame.evaluate(() => !document.getElementById('envLegend').hidden && [...document.querySelectorAll('#envLegendList li')].some((li) => li.textContent === 'Environmental layers are not available right now'))), s && s.legend);
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

/* reduced motion: play refused, focus jumps, no ripple, animations off in the legend */
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
  check(scope, 'focus jumps with setView (no flight), no ripple, nothing illustrative in the payload', !!sel && sel.illustrative === null && s.ripple === null && Math.abs(height - 900000) < 9000, { height, ripple: s.ripple, illustrative: sel && sel.illustrative });
  check(scope, 'the legend says animations are off', s.legend.includes('(animations off)'), s.legend);
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
