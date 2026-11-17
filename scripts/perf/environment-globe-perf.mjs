/* The environmental globe's render benchmark (slice G1, 2026-11-17), the scratch probe's pattern against a LOCAL page:
   CDP Performance metrics (TaskDuration, ScriptDuration, LayoutCount, RecalcStyleCount, JSHeapUsedSize) over a 10 s idle
   window after a 12 s settle, the frames rendered in that window (postRender), the frame time of a 3 s flight, the
   heap, the transfer sizes, at 390x844 and 1280x800 with the environmental layers off and on.

   It serves a repository root at 127.0.0.1 (--root, default: this checkout) but always serves the host page and the
   fixtures from THIS checkout, so the same page can be measured at an older head ("before") and at this one ("after").
   api.mccluster.org (the feed and the six layer routes from the fixtures; every other path {}), Supabase ([]), the NASA
   tiles (a local JPEG) and, with CESIUM_DIR, the Cesium CDN are answered in memory: nothing reaches the network but the
   CDN when CESIUM_DIR is unset.

   Run:  node scripts/perf/environment-globe-perf.mjs [--root <dir>] [--modes off,on] [--sizes 390,1280]
           [--settle 12000] [--window 10000] [--baseline <before.json>] [--check] [outDir]
   --baseline applies the pass rule against an earlier run's JSON and exits non-zero when a gating rule fails;
   --check is a short self-test (3 s settle, 3 s window, 390 only) used by scripts/e2e/environment-globe.e2e.mjs.
   Pass rule (docs/control-plane: the design of slice G1): after.on.idle10s.taskSec <= min(before.off.idle10s.taskSec,
   10.09) * 1.05 at each size; after.off.idle10s.taskSec <= before.off.idle10s.taskSec * 1.05; jsHeapMB(on) <=
   jsHeapMB(off) + 40; after.on.flight.p95Ms <= after.off.flight.p95Ms * 1.5 and after.on.flight.meanMs <= 33 at 1280
   gate only on a hardware GL path and are recorded as information under software GL (SwiftShader). */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback; };
const CHECK = args.includes('--check');
const ROOT = resolve(opt('--root', SELF_ROOT));
const MODES = (CHECK ? 'off,on' : opt('--modes', 'off,on')).split(',').map((s) => s.trim()).filter((s) => s === 'off' || s === 'on');
const SIZES = (CHECK ? '390' : opt('--sizes', '390,1280')).split(',').map(Number).filter(Boolean);
const SETTLE_MS = CHECK ? 3000 : Number(opt('--settle', 12000));
const WINDOW_MS = CHECK ? 3000 : Number(opt('--window', 10000));
const FLIGHT_MS = CHECK ? 1500 : 3000;
const BASELINE = opt('--baseline', null);
const OUT = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--') || ['--check'].includes(args[i - 1]))).pop() || join(SELF_ROOT, 'e2e-out', 'environment-globe-perf');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const FIXTURE_DIR = join(SELF_ROOT, 'scripts/e2e/fixtures/environment');
const FIX = {};
for (const name of ['layers-fires', 'layers-perimeters', 'layers-alerts', 'layers-eonet', 'layers-tides', 'shakemap-us7000tyhr', 'shakemap-us7000tyca', 'shakemap-none', 'policy-503']) FIX[name] = JSON.parse(await readFile(join(FIXTURE_DIR, name + '.json'), 'utf8'));
const TILE = await readFile(join(SELF_ROOT, 'assets/img/closet/seek-first/sf-33.jpg'));
const SELF_PATHS = ['/scripts/e2e/support/environment-globe-host.html', '/scripts/e2e/fixtures/environment/pins.json'];

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  const root = SELF_PATHS.includes(path) ? SELF_ROOT : ROOT;
  try { const body = await readFile(join(root, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const HOST = `${BASE}/scripts/e2e/support/environment-globe-host.html`;
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
const head = (() => { try { return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } })();

async function measure(browser, size, mode) {
  const viewport = size < 600 ? { width: size, height: 844 } : { width: size, height: 800 };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, deviceScaleFactor: 1, isMobile: size < 600, hasTouch: size < 600 });
  /* registered first so the specific routes below take precedence: anything else off this origin and off the CDN answers {} */
  await ctx.route((url) => !url.href.startsWith(BASE) && !/cesium\.com/.test(url.hostname), (route) => json(route, {}));
  await ctx.route('https://api.mccluster.org/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/v1/world/environment') return json(route, FIX['policy-503'], 503);
    const layer = /^\/v1\/world\/environment\/layers\/(fires|perimeters|alerts|eonet|tides)$/.exec(p);
    if (layer) return json(route, FIX['layers-' + layer[1]]);
    const sm = /^\/v1\/world\/environment\/quakes\/([a-z0-9]+)\/shakemap$/.exec(p);
    if (sm) return json(route, FIX['shakemap-' + sm[1]] || FIX['shakemap-none']);
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
  page.setDefaultTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Performance.enable');
  const sizes = {}, bytes = {};
  cdp.on('Network.responseReceived', (e) => { sizes[e.requestId] = e.response.url; });
  cdp.on('Network.loadingFinished', (e) => { const u = sizes[e.requestId] || ''; const k = /cesium\.com/.test(u) ? 'cesium' : /gibs\.earthdata|openstreetmap/.test(u) ? 'tiles' : /\.(js|mjs)(\?|$)/.test(u) ? 'js' : /\.css(\?|$)/.test(u) ? 'css' : /\.(png|jpe?g|webp|svg)(\?|$)/.test(u) ? 'img' : 'other'; bytes[k] = (bytes[k] || 0) + e.encodedDataLength; });
  const t0 = Date.now();
  await page.goto(`${HOST}?layers=${mode}`, { waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  await page.waitForFunction(() => window.__ready && window.__activated > 0, null, { timeout: 120000 });
  let frame = null;
  for (let i = 0; i < 300 && !frame; i++) { frame = page.frames().find((f) => f.url().includes('/action-globe.html')) || null; if (!frame) await page.waitForTimeout(100); }
  await frame.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 90000 }).catch(() => {});
  /* at this head the typed layers report readiness; at an older head there is nothing to wait for */
  await frame.waitForFunction(() => !window.__mccEnvironmentLayers || window.__mccEnvironmentLayers().ready, null, { timeout: 120000 }).catch(() => {});
  const typed = await frame.evaluate(() => !!window.__mccEnvironmentLayers);
  const gl = await frame.evaluate(() => { try { const gl = window.HuGlobe.viewer().scene.context._gl; const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch (e) { return 'unknown'; } });
  await page.waitForTimeout(SETTLE_MS);
  await frame.evaluate(() => { window.__perfFrames = 0; window.__perfCounter = () => { window.__perfFrames++; }; window.HuGlobe.viewer().scene.postRender.addEventListener(window.__perfCounter); });
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  await page.waitForTimeout(WINDOW_MS);
  const m2 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const frames = await frame.evaluate(() => { window.HuGlobe.viewer().scene.postRender.removeEventListener(window.__perfCounter); return window.__perfFrames; });
  const governor = await frame.evaluate(() => (window.__mccGlobeGovernor ? window.__mccGlobeGovernor() : null));
  const counts = await frame.evaluate(() => (window.__mccEnvironmentLayers ? window.__mccEnvironmentLayers().counts : null));
  /* the flight: the director's own play with the layers on, a plain flyTo of the same duration with them off */
  const sampler = (ms) => `new Promise((res) => { const scene = window.HuGlobe.viewer().scene, d = []; let last = performance.now(); const fn = () => { const t = performance.now(); d.push(t - last); last = t; }; scene.postRender.addEventListener(fn); setTimeout(() => { scene.postRender.removeEventListener(fn); d.shift(); const s = d.slice().sort((a, b) => a - b); res({ frames: d.length, meanMs: d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length * 10) / 10 : null, p95Ms: s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] * 10) / 10 : null }); }, ${ms}); })`;
  let flight;
  if (mode === 'on' && typed) {
    const pending = frame.evaluate(sampler(FLIGHT_MS));
    await page.evaluate(() => window.__send({ type: 'hu:environment-scene', action: 'play' }));
    flight = await pending;
    await page.evaluate(() => window.__send({ type: 'hu:environment-scene', action: 'stop' }));
  } else {
    flight = await frame.evaluate(`(() => { const v = window.HuGlobe.viewer(); v.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(136.7444, 37.3664, 900000), duration: ${FLIGHT_MS / 1000}, easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT }); return ${sampler(FLIGHT_MS)}; })()`);
  }
  const result = {
    mode, size, typedLayers: typed, loadMs, gl, errors,
    idle10s: { taskSec: +(m2.TaskDuration - m1.TaskDuration).toFixed(2), scriptSec: +(m2.ScriptDuration - m1.ScriptDuration).toFixed(2), layoutCount: m2.LayoutCount - m1.LayoutCount, recalcStyle: m2.RecalcStyleCount - m1.RecalcStyleCount, windowMs: WINDOW_MS },
    frames10s: frames, flight, jsHeapMB: Math.round(m2.JSHeapUsedSize / 1048576), governor, counts,
    transferKB: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, Math.round(v / 1024)]))
  };
  await ctx.close();
  return result;
}

await mkdir(OUT, { recursive: true });
const launchOptions = process.env.E2E_GL_ARGS === '1' || process.env.CI ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } : {};
const browser = await chromium.launch(launchOptions);
const results = {};
try {
  for (const size of SIZES) {
    results[size] = {};
    for (const mode of MODES) {
      const r = await measure(browser, size, mode);
      results[size][mode] = r;
      console.log(`RESULT [${size} layers=${mode}] idle${WINDOW_MS / 1000}s taskSec ${r.idle10s.taskSec} scriptSec ${r.idle10s.scriptSec} frames ${r.frames10s} flight ${JSON.stringify(r.flight)} heapMB ${r.jsHeapMB} loadMs ${r.loadMs} cesiumKB ${r.transferKB.cesium || 0} gl "${r.gl}" typed ${r.typedLayers}${r.governor ? ' governor ' + JSON.stringify({ enabled: r.governor.enabled, mode: r.governor.mode, holds: r.governor.holds }) : ''}${r.errors.length ? ' ERRORS ' + JSON.stringify(r.errors) : ''}`);
    }
  }
} finally { await browser.close(); server.close(); }

const software = Object.values(results).some((bySize) => Object.values(bySize).some((r) => /swiftshader|llvmpipe|software/i.test(r.gl)));
const report = { generated_at: new Date().toISOString(), root: ROOT, head, settleMs: SETTLE_MS, windowMs: WINDOW_MS, check: CHECK, softwareGL: software, results };
let verdict = [];
if (BASELINE) {
  const before = JSON.parse(await readFile(BASELINE, 'utf8'));
  const rule = (name, ok, detail) => { verdict.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} [perf] ${name} ${JSON.stringify(detail)}`); };
  for (const size of SIZES) {
    const b = before.results[size] && before.results[size].off, a = results[size];
    if (!b || !a || !a.off) { rule(`baseline and after present at ${size}`, false, { before: !!b, after: !!(a && a.off) }); continue; }
    rule(`${size}: after.off idle taskSec <= before.off * 1.05 (the layers-off page keeps its loop)`, a.off.idle10s.taskSec <= b.idle10s.taskSec * 1.05, { before: b.idle10s.taskSec, after: a.off.idle10s.taskSec });
    if (a.on) {
      rule(`${size}: after.on idle taskSec <= min(before.off, 10.09) * 1.05 (on demand with no holds)`, a.on.idle10s.taskSec <= Math.min(b.idle10s.taskSec, 10.09) * 1.05, { before: b.idle10s.taskSec, after: a.on.idle10s.taskSec, frames: a.on.frames10s });
      rule(`${size}: jsHeapMB(on) <= jsHeapMB(off) + 40`, a.on.jsHeapMB <= a.off.jsHeapMB + 40, { off: a.off.jsHeapMB, on: a.on.jsHeapMB });
      const flightOk = a.on.flight && a.off.flight && a.on.flight.p95Ms !== null && a.off.flight.p95Ms !== null ? a.on.flight.p95Ms <= a.off.flight.p95Ms * 1.5 : null;
      const meanOk = size === 1280 && a.on.flight && a.on.flight.meanMs !== null ? a.on.flight.meanMs <= 33 : null;
      if (software) console.log(`INFO [perf] ${size}: software GL (${a.on.gl}): flight p95 on ${a.on.flight && a.on.flight.p95Ms} vs off ${a.off.flight && a.off.flight.p95Ms} ms, mean on ${a.on.flight && a.on.flight.meanMs} ms recorded as information, not gated`);
      else { if (flightOk !== null) rule(`${size}: flight p95 on <= off * 1.5`, flightOk, { on: a.on.flight.p95Ms, off: a.off.flight.p95Ms }); if (meanOk !== null) rule(`${size}: flight mean <= 33 ms at 1280`, meanOk, { mean: a.on.flight.meanMs }); }
    }
  }
  report.baseline = { file: BASELINE, head: before.head || null };
  report.verdict = verdict;
}
if (CHECK) {
  const ok = SIZES.every((size) => MODES.every((mode) => results[size][mode] && Number.isFinite(results[size][mode].idle10s.taskSec) && results[size][mode].errors.length === 0)) && (!results[SIZES[0]].on || !results[SIZES[0]].on.typedLayers || (results[SIZES[0]].on.counts && results[SIZES[0]].on.counts.events === 62));
  verdict.push({ name: 'check: numbers for every mode, no page error, the layers ready', ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [perf] --check produced numbers for ${JSON.stringify(MODES)} at ${JSON.stringify(SIZES)} without page errors`);
  report.verdict = verdict;
}
await writeFile(join(OUT, CHECK ? 'perf-check.json' : 'perf.json'), JSON.stringify(report, null, 1));
console.log(`wrote ${join(OUT, CHECK ? 'perf-check.json' : 'perf.json')}`);
process.exit(verdict.some((v) => !v.ok) ? 1 : 0);
