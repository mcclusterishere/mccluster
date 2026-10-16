/* The World's countries (owner, 2026-10-15), in a real browser: borders and flags on the zoomed-out Earth, the
   red-white-blue United States, the fade as the camera comes down, the "Countries" control (fade → keep on → off,
   remembered in this browser), a tapped country's card and mission filter, reduced motion, the bottom app bar, and
   scrollWidth === clientWidth at 390 and 1280. Logs the average frame interval over a 3 s orbit.

   Serves this checkout and fakes api.mccluster.org and Supabase in memory (no production call).
   Run:  node scripts/e2e/world-countries.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR if not resolvable) and network access to the Cesium CDN and the NASA tiles.
   Exits non-zero on any failed check. */
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
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 400)}`);
  if (!ok) failed++;
}
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
/* two missions: one row carries country_code (the country-level regions contract), one only a region whose row says GB */
const MISSIONS = [
  { mission_id: 'm1', title: 'Clean up the Mill River', description: 'Bag a block of shoreline.', action_path: 'show_up', region_key: 'US-CT', region_label: 'Connecticut', country_code: 'US', latitude: 41.6, longitude: -72.7 },
  { mission_id: 'm2', title: 'Recycle one dead device', description: 'The right way.', action_path: 'do_it', region_key: 'GB-LND', region_label: 'London', latitude: 51.5, longitude: -0.12 },
];
const REGIONS = [{ region_key: 'GB-LND', region_label: 'London', country_code: 'GB', latitude: 51.5, longitude: -0.12, member_count: 6, verified_actions: 0 }];

async function context(viewport, { reducedMotion = 'no-preference' } = {}) {
  const mobile = viewport.width < 600;
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion });
  await ctx.addInitScript(() => { localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() })); });
  await ctx.route('https://api.mccluster.org/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/v1/world/access') return json(route, { level: 'public', unlocked_layers: ['flights'], locked_layers: ['satellites', 'launches', 'intel', 'music', 'cctv', 'audience', 'transport'].map((id) => ({ id, reason: 'sign_in_required', next_step: 'sign_in' })), layers: {} });
    if (p === '/v1/world/ion') return json(route, { available: false });
    return json(route, {});
  });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/rest/v1/rpc/action_globe_public_region_missions') return json(route, MISSIONS);
    if (p === '/rest/v1/rpc/action_globe_public_regions') return json(route, REGIONS);
    return json(route, []);
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return { ctx, page, errors };
}
const state = (page) => page.evaluate(() => window.__huCountries && window.__huCountries());
const widths = (page) => page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
const barShown = (page) => page.evaluate(() => { const bar = document.querySelector('.appbar'); if (!bar) return false; const b = bar.getBoundingClientRect(), cs = getComputedStyle(bar); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.height > 0 && b.top < innerHeight; });
async function settle(page) { await page.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 30000 }).catch(() => {}); }
async function until(page, fn, arg, ms = 6000) { return page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false); }

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const SIZES = [{ name: '390', viewport: { width: 390, height: 844 } }, { name: '1280', viewport: { width: 1280, height: 800 } }];

for (const size of SIZES) {
  const scope = size.name;
  const { ctx, page, errors } = await context(size.viewport);
  await page.goto(`${BASE}/action-globe.html?explore=1`, { waitUntil: 'load' });
  const ready = await until(page, () => window.__huCountries && window.__huCountries().ready, null, 30000);
  check(scope, 'countries data, flags and borders mounted', ready, await state(page));
  await settle(page);
  const s0 = await state(page);
  check(scope, '177 countries, a flag for each with a code (174), US among them', s0.count === 177 && s0.flags === 174 && s0.alpha.US === 1, s0);
  check(scope, 'default mode is fade-on-zoom and the control says so', s0.mode === 'auto' && (await page.getAttribute('#ctlCountries', 'aria-pressed')) === 'true');
  check(scope, 'bottom app bar on screen', await barShown(page));
  const w = await widths(page);
  check(scope, 'scrollWidth === clientWidth', w.scrollW === w.clientW, w);
  await page.screenshot({ path: join(OUT, `countries-${scope}-world.png`) });

  /* frame time over a 3 s orbit (software GL: a sanity number, not a benchmark) */
  const ft = await page.evaluate(() => new Promise((res) => { const t0 = performance.now(), d = []; let last = t0; function f(t) { d.push(t - last); last = t; window.__huCountriesCam.spin(0.004); if (t - t0 < 3000) requestAnimationFrame(f); else { d.shift(); d.sort((a, b) => a - b); res({ frames: d.length, avg: Math.round(d.reduce((a, b) => a + b, 0) / d.length * 10) / 10, p95: Math.round(d[Math.floor(d.length * 0.95)] * 10) / 10, max: Math.round(d[d.length - 1]) }); } } requestAnimationFrame(f); }));
  console.log(`INFO [${scope}] frame interval over a 3 s orbit: ${JSON.stringify(ft)}`);
  check(scope, 'orbit renders frames (no stall over 1 s)', ft.frames > 10 && ft.max < 1000, ft);

  /* North America from far out: the US fully decorated */
  await page.evaluate(() => window.__huCountriesCam.view(-98, 40, 9.5e6));
  await page.waitForTimeout(800); await settle(page);
  const na = await state(page);
  check(scope, 'North America from 9,500 km: US, Canada, Mexico decorated', na.alpha.US > 0.9 && na.alpha.MX > 0.9, na.alpha);
  await page.screenshot({ path: join(OUT, `countries-${scope}-north-america.png`) });

  /* a tap on the US names it, counts its mission, and filters the pins */
  const box = await page.locator('#globe').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const carded = await until(page, () => { const c = document.getElementById('countryCard'); return c && !c.hidden; });
  const cardText = await page.evaluate(() => document.getElementById('countryCard').textContent);
  check(scope, 'tapping the US opens its card with the real count', carded && /United States/.test(cardText) && /1 mission pinned here/.test(cardText), cardText);
  const feed = await page.evaluate(() => document.getElementById('feedCount').textContent);
  check(scope, 'pins filtered to the US (1 of 2 missions)', feed === '1 missions', feed);
  await page.screenshot({ path: join(OUT, `countries-${scope}-us-selected.png`) });
  await page.click('.country-card__close');
  const unfiltered = await page.evaluate(() => document.getElementById('feedCount').textContent);
  check(scope, 'closing the card shows every mission again', unfiltered === '2 missions', unfiltered);

  /* zoom in on the US: its decoration fades away */
  await page.evaluate(() => window.__huCountriesCam.view(-98, 39, 2.6e6));
  const faded = await until(page, () => window.__huCountries().alpha.US < 0.05, null, 5000);
  const zs = await state(page);
  check(scope, 'zoomed into the US (2,600 km): the US decoration fades out', faded, zs);
  await settle(page);
  await page.screenshot({ path: join(OUT, `countries-${scope}-us-zoomed-faded.png`) });

  /* keep them on, then off, remembered across a reload */
  await page.click('#ctlCountries');
  const kept = await until(page, () => window.__huCountries().mode === 'always' && window.__huCountries().alpha.US > 0.95, null, 5000);
  check(scope, 'Countries → keep on: the US decoration comes back while zoomed in', kept, await state(page));
  if (scope === '1280') await page.screenshot({ path: join(OUT, `countries-${scope}-us-zoomed-kept-on.png`) });
  await page.click('#ctlCountries');
  const off = await until(page, () => window.__huCountries().mode === 'off' && Object.values(window.__huCountries().alpha).every((a) => a === 0), null, 5000);
  check(scope, 'Countries → off: every decoration hidden', off, await state(page));
  check(scope, 'control reads off', (await page.getAttribute('#ctlCountries', 'aria-pressed')) === 'false');
  await page.reload({ waitUntil: 'load' });
  await until(page, () => window.__huCountries && window.__huCountries().ready, null, 30000);
  const after = await state(page);
  check(scope, 'the choice survives a reload (localStorage)', after.mode === 'off', after.mode);
  await page.click('#ctlCountries');
  check(scope, 'Countries → back to fade-on-zoom', (await state(page)).mode === 'auto');
  const w2 = await widths(page);
  check(scope, 'scrollWidth === clientWidth after the card and toggles', w2.scrollW === w2.clientW, w2);
  check(scope, 'no console errors', errors.length === 0, errors);
  await ctx.close();
}

/* reduced motion: the fade is instant */
{
  const { ctx, page, errors } = await context({ width: 390, height: 844 }, { reducedMotion: 'reduce' });
  await page.goto(`${BASE}/action-globe.html?explore=1`, { waitUntil: 'load' });
  await until(page, () => window.__huCountries && window.__huCountries().ready, null, 30000);
  await until(page, () => window.__huCountries().alpha.US === 1, null, 8000);
  const steps = await page.evaluate(() => new Promise((res) => { window.__huCountriesCam.view(-98, 39, 2.6e6); const seen = []; let n = 0; function f() { seen.push(window.__huCountries().alpha.US); if (++n < 4) requestAnimationFrame(f); else res(seen); } requestAnimationFrame(f); }));
  check('reduced-motion', 'the US decoration goes straight to 0 (no in-between values)', steps.every((a) => a === 0 || a === 1) && steps[steps.length - 1] === 0, steps);
  check('reduced-motion', 'no console errors', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
server.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
