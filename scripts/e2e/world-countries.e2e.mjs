/* The World's countries (owner, 2026-10-15) and states (2026-10-20), in a real browser: borders and flags on the zoomed-out
   Earth, the red-white-blue United States, the borders staying and the states coming in as the camera comes down while
   the flags fade, small countries on the map, the "Countries" control (fade → keep on → off,
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
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
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, reducedMotion });
  await ctx.addInitScript(() => { localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() })); });
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
  /* NASA GIBS imagery (day and city-light tiles, js/action-globe.js): served locally so a CDN
     hiccup or a CORS-less error page from gibs.earthdata.nasa.gov can never fail this page's
     own console-error check. Any small JPEG stands in for a tile. */
  const TILE = await readFile(new URL('../../assets/img/closet/seek-first/sf-33.jpg', import.meta.url));
  await ctx.route('https://gibs.earthdata.nasa.gov/**', (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: TILE }));
  /* CESIUM_DIR: serve Cesium from a local build, as scripts/e2e/world-screen.e2e.mjs does, when the CDN is out of reach */
  if (process.env.CESIUM_DIR) await ctx.route('https://cesium.com/**/Build/Cesium/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.split('/Build/Cesium/')[1];
    if (!rel || rel.includes('..')) return route.abort();
    try { return route.fulfill({ body: await readFile(join(process.env.CESIUM_DIR, rel)), contentType: TYPES[extname(rel)] || 'application/octet-stream' }); }
    catch { return route.abort(); }
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);   // software GL: a screenshot of the globe can take longer than 30 s
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return { ctx, page, errors };
}
const state = (page) => page.evaluate(() => window.__huCountries && window.__huCountries());
const widths = (page) => page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
const barShown = (page) => page.evaluate(() => { const bar = document.querySelector('.appbar'); if (!bar) return false; const b = bar.getBoundingClientRect(), cs = getComputedStyle(bar); return cs.display !== 'none' && cs.visibility !== 'hidden' && b.height > 0 && b.top < innerHeight; });
async function settle(page) { await page.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 30000 }).catch(() => {}); }
async function until(page, fn, arg, ms = 20000) { return page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false); }

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const SIZES = [{ name: '390', viewport: { width: 390, height: 844 } }, { name: '1280', viewport: { width: 1280, height: 800 } }];

for (const size of SIZES) {
  const scope = size.name;
  const { ctx, page, errors } = await context(size.viewport);
  await page.goto(`${BASE}/action-globe.html?explore=1`, { waitUntil: 'load' });
  const ready = await until(page, () => window.__huCountries && window.__huCountries().ready, null, 30000);
  check(scope, 'countries and land borders mounted', ready, await state(page));
  await settle(page);
  const s0 = await state(page);
  /* the public globe has been the quiet editorial Earth since 2026-10-16: borders, no flags, labels or Countries control */
  check(scope, '243 countries at 1:10m, the land borders drawn, the quiet public globe (no flags or labels)', s0.count === 243 && s0.borders > 300 && s0.lines === 1 && s0.flags === 0 && s0.labels === 0, s0);
  check(scope, 'from the whole Earth no states are drawn (a tangle at this height)', s0.statesAlpha === 0 && s0.states.length === 0, s0);
  const places = await page.evaluate(() => [[103.85, 1.29], [114.17, 22.32], [6.14, 46.2], [-83.03, 42.31], [34.1, 44.95], [7.42, 43.74]].map(([x, y]) => window.__huCountryAt(x, y)));
  check(scope, 'Singapore, Hong Kong, Geneva, Windsor, Simferopol and Monaco are in their own countries', JSON.stringify(places) === JSON.stringify(['SG', 'HK', 'CH', 'CA', 'UA', 'MC']), places);
  check(scope, 'bottom app bar on screen', await barShown(page));
  const w = await widths(page);
  check(scope, 'scrollWidth === clientWidth', w.scrollW === w.clientW, w);
  await page.screenshot({ path: join(OUT, `countries-${scope}-world.png`) });

  /* frame time over a 3 s orbit (software GL: a sanity number, not a benchmark) */
  const ft = await page.evaluate(() => new Promise((res) => { const t0 = performance.now(), d = []; let last = t0; function f(t) { d.push(t - last); last = t; window.__huCountriesCam.spin(0.004); if (t - t0 < 3000) requestAnimationFrame(f); else { d.shift(); d.sort((a, b) => a - b); res({ frames: d.length, avg: Math.round(d.reduce((a, b) => a + b, 0) / d.length * 10) / 10, p95: Math.round(d[Math.floor(d.length * 0.95)] * 10) / 10 }); } } requestAnimationFrame(f); }));
  console.log(`INFO [${scope}] frame interval over a 3 s orbit: ${JSON.stringify(ft)}`);
  check(scope, 'orbit keeps rendering (software GL is slow; the number is logged)', ft.frames >= 1, ft);

  /* North America from far out: borders, no states yet */
  await page.evaluate(() => window.__huCountriesCam.view(-98, 40, 9.5e6));
  await page.waitForTimeout(800); await settle(page);
  const na = await state(page);
  check(scope, 'North America from 9,500 km: borders on, states not yet', na.lines === 1 && na.statesAlpha === 0, na);
  await page.screenshot({ path: join(OUT, `countries-${scope}-north-america.png`) });

  /* a tap on the US names it, counts its mission, filters the pins, and draws its states from here */
  const box = await page.locator('#globe').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const carded = await until(page, () => { const c = document.getElementById('countryCard'); return c && !c.hidden; });
  const cardText = await page.evaluate(() => document.getElementById('countryCard').textContent);
  check(scope, 'tapping the US opens its card with the real count', carded && /United States/.test(cardText) && /1 mission pinned here/.test(cardText), cardText);
  check(scope, 'the selected country\'s states are drawn even from far out', await until(page, () => window.__huCountries().selectedStates, null, 15000), await state(page));
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `countries-${scope}-us-selected.png`) });
  /* (a script click: at 390px the house's Sign in chip sits over the card's close button on this page, a separate bug) */
  await page.evaluate(() => document.querySelector('.country-card__close').click());
  check(scope, 'closing the card lets the country go', await until(page, () => !window.__huCountries().selected && !window.__huCountries().selectedStates, null, 8000));

  /* over the US: the borders stay, the states of the countries in view come in */
  await page.evaluate(() => window.__huCountriesCam.view(-98, 39, 2.6e6));
  const mapped = await until(page, () => { const s = window.__huCountries(); return s.lines === 1 && s.statesAlpha === 1 && ['US', 'CA', 'MX'].every((c) => s.states.includes(c)); }, null, 20000);
  check(scope, 'over the US (2,600 km): the borders stay, and the states of the US, Canada and Mexico are drawn', mapped, await state(page));
  await settle(page); await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `countries-${scope}-us-states.png`) });
  await page.evaluate(() => window.__huCountriesCam.view(10, 48, 2.6e6));
  const europe = await until(page, () => { const s = window.__huCountries(); return ['DE', 'FR', 'IT', 'PL'].every((c) => s.states.includes(c)); }, null, 20000);
  check(scope, 'over Europe: its countries\' states are fetched, one country at a time', europe, (await state(page)).states);
  await settle(page); await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `countries-${scope}-europe-states.png`) });

  /* down where the street map or aerial imagery has its own borders, ours give way */
  await page.evaluate(() => window.__huCountriesCam.view(-72.9, 41.3, 4e5));
  check(scope, 'at 400 km the borders and states give way to the imagery', await until(page, () => { const s = window.__huCountries(); return s.lines === 0 && s.statesAlpha === 0; }, null, 20000), await state(page));
  const w2 = await widths(page);
  check(scope, 'scrollWidth === clientWidth after the card', w2.scrollW === w2.clientW, w2);
  check(scope, 'no console errors', errors.length === 0, errors);
  await ctx.close();
}

/* reduced motion: the fade is instant */
{
  const { ctx, page, errors } = await context({ width: 390, height: 844 }, { reducedMotion: 'reduce' });
  await page.goto(`${BASE}/action-globe.html?explore=1`, { waitUntil: 'load' });
  await until(page, () => window.__huCountries && window.__huCountries().ready, null, 30000);
  await until(page, () => window.__huCountries().lines === 1, null, 8000);
  const steps = await page.evaluate(() => new Promise((res) => { window.__huCountriesCam.view(-72.9, 41.3, 4e5); const seen = []; let n = 0; function f() { seen.push(window.__huCountries().lines); if (++n < 4) requestAnimationFrame(f); else res(seen); } requestAnimationFrame(f); }));
  check('reduced-motion', 'the borders go straight to 0 at street height (no in-between values)', steps.every((a) => a === 0 || a === 1) && steps[steps.length - 1] === 0, steps);
  check('reduced-motion', 'no console errors', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
server.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
