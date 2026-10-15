/* THE EARTH UP CLOSE, end to end in a real browser (owner, 2026-10-15: "I added an ion, cesium ion key to the McCluster worker").

   Serves this checkout, fakes api.mccluster.org (the Worker's /v1/world/ion status and asset endpoints) and Supabase, and stands in
   for Cesium ion's tile hosts on this same server: a flat heightmap terrain, one imagery tile for every z/x/y, an empty 3D tileset.
   Real CesiumJS 1.131 from the CDN drives it, so the page's ion code runs exactly as it will against the Worker. Four worlds:

     off      the Worker has no token: the page asks for no asset, shows no ion credit, and the street map still takes over below 900 km;
     on       terrain before the Earth is drawn; aerial imagery only below 3,000 km and whole with the cloud gone by 1,200 km; the street
              map yields to it; buildings below 50 km; night and street looks hide ion; the way home hides it all again; Cesium
              never calls api.cesium.com and the page never sends an ion token; the asset token rides only to the asset host;
     failing  every asset endpoint answers 502: the Earth still draws on the flat ellipsoid, imagery tries each asset once and gives
              up, the street map takes over below 900 km as before;
     slow     the terrain endpoint does not answer for 8 s: the Earth draws flat after the 2.5 s wait and stays flat (no late swap).

   Nothing here touches production. Run:  node scripts/e2e/world-ion.e2e.mjs [outDir]
   ION_STANDIN=esri swaps the stand-in imagery tile for Esri World Imagery (network), for screenshots that look like aerial imagery.
   Needs Playwright and network access to the Cesium CDN and NASA GIBS. Exits non-zero on any failed check. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'world-ion');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

/* ---------- stand-ins for ion's tile hosts ---------- */
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function solidPng(r, g, b, size = 256) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + size * 3); for (let x = 0; x < size; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const TILE = solidPng(74, 110, 62);
/* heightmap-1.0: 65 x 65 heights (value / 5 - 1000 m, so 5000 is sea level), a child mask, a water mask */
const HEIGHTS = (() => { const b = Buffer.alloc(65 * 65 * 2 + 2); for (let i = 0; i < 65 * 65; i++) b.writeUInt16LE(5000, i * 2); return b; })();
const LAYER = { tilejson: '2.1.0', format: 'heightmap-1.0', version: '1.0.0', scheme: 'tms', tiles: ['{z}/{x}/{y}.terrain?v={version}'], projection: 'EPSG:4326', bounds: [-180, -90, 180, 90], available: [[{ startX: 0, startY: 0, endX: 1, endY: 0 }]] };
const TILESET = { asset: { version: '1.0' }, geometricError: 0, root: { boundingVolume: { region: [-3.15, -1.58, 3.15, 1.58, 0, 1] }, geometricError: 0, refine: 'ADD' } };
const hostSeen = [];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/__ion/')) {
    hostSeen.push({ path: url.pathname, auth: req.headers.authorization || '', client: req.headers['x-cesium-client'] || '' });
    if (url.pathname === '/__ion/terrain/layer.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(LAYER)); }
    if (/^\/__ion\/terrain\/\d+\/\d+\/\d+\.terrain$/.test(url.pathname)) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(HEIGHTS); }
    if (/^\/__ion\/tile\/\d+\/\d+\/\d+\.png$/.test(url.pathname)) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(TILE); }
    if (url.pathname === '/__ion/buildings/tileset.json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(TILESET)); }
    res.writeHead(404); return res.end('no');
  }
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^([.][.][/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ENDPOINTS = {
  1: { type: 'TERRAIN', url: `${BASE}/__ion/terrain/`, accessToken: 'asset-token-1', attributions: [{ html: '<span>Fixture terrain</span>', collapsible: true }] },
  3: { type: 'IMAGERY', externalType: 'URL_TEMPLATE', options: { url: process.env.ION_STANDIN === 'esri' ? ESRI : `${BASE}/__ion/tile/{z}/{x}/{y}.png`, maximumLevel: 18 }, attributions: [{ html: '<span>Fixture aerial imagery</span>', collapsible: true }] },
  96188: { type: '3DTILES', url: `${BASE}/__ion/buildings/tileset.json`, accessToken: 'asset-token-96188', attributions: [] }
};
const ASSETS = { terrain: 1, imagery: [3, 2, 3954], buildings: 96188 };
const MISSIONS = [{ mission_id: '11111111-1111-4111-8111-111111111111', title: 'Clean up the Hudson shoreline', description: 'Bag a block of shoreline.', action_path: 'show_up', region_key: 'US-NY', region_label: 'New York', latitude: 40.75, longitude: -73.98 }];

let failures = 0;
const check = (scope, ok, label, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} [${scope}] ${label}${detail ? ' :: ' + detail : ''}`); };
const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });

async function open(scope, mode, viewport = { width: 390, height: 844 }, mobile = true) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, geolocation: { latitude: 40.7484, longitude: -73.9857 }, permissions: ['geolocation'] });
  await ctx.addInitScript(() => localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() })));
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': BASE }, body: JSON.stringify(body) });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => json(route, route.request().url().includes('action_globe_public_region_missions') ? MISSIONS : []));
  const asked = [];
  await ctx.route('https://api.mccluster.org/**', async (route) => {
    const u = new URL(route.request().url());
    asked.push({ path: u.pathname, search: u.search, auth: route.request().headers().authorization || '' });
    if (u.pathname === '/v1/world/ion') return json(route, { ok: true, available: mode !== 'off', binding: mode === 'off' ? null : 'CESIUM_ION_TOKEN', assets: ASSETS });
    const m = u.pathname.match(/^\/v1\/world\/ion\/v1\/assets\/(\d+)\/endpoint$/);
    if (m) {
      const id = Number(m[1]);
      if (mode === 'failing') return json(route, { error: 'Cesium ion did not answer for this asset' }, 502);
      if (mode === 'slow' && id === 1) { await new Promise((r) => setTimeout(r, 8000)); return json(route, ENDPOINTS[1]).catch(() => {}); }
      return ENDPOINTS[id] ? json(route, ENDPOINTS[id]) : json(route, { error: 'Cesium ion did not answer for this asset' }, 502);
    }
    return json(route, { error: 'not found' }, 404);
  });
  const page = await ctx.newPage();
  const errors = [], outside = [], pending = new Map();
  page.on('request', (r) => pending.set(r, r.url()));
  page.on('requestfinished', (r) => pending.delete(r));
  page.on('requestfailed', (r) => pending.delete(r));
  page.__pending = pending;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/TypeError|ReferenceError|SyntaxError/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  page.on('request', (r) => { const h = new URL(r.url()).host; if (/(^|\.)cesium\.com$/.test(h) && !r.url().includes('/downloads/cesiumjs/')) outside.push(r.url()); });
  await page.goto(BASE + '/action-globe.html?explore=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__huIon && window.__huGlobeSettled, null, { timeout: 30000 });
  return { ctx, page, errors, outside, asked };
}
const ionState = (page) => page.evaluate(() => window.__huIon());
/* the Earth has every visible tile; on a timeout, say what was still loading */
const settle = (page, ms = 60000) => page.waitForFunction(() => window.__huGlobeSettled(), null, { timeout: ms }).then(() => true, async () => {
  const left = [...page.__pending.values()].map((u) => u.replace(/^https?:\/\/[^/]+/, (h) => h.split('/')[2])).slice(0, 6);
  console.log('     still loading: ' + JSON.stringify(left) + ' ion: ' + JSON.stringify(await ionState(page).catch(() => null)));
  return false;
});
const assetAsks = (asked) => asked.filter((a) => /\/assets\/\d+\/endpoint$/.test(a.path));
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
async function locate(page) { await page.click('#ctlLocate'); await page.waitForTimeout(2600); }
async function zoomIn(page, n) { for (let k = 0; k < n; k++) { await page.click('#ctlZoomIn'); await page.waitForTimeout(250); } await page.waitForTimeout(800); }

/* ---------- off: no token in the Worker ---------- */
{
  const scope = 'off';
  const { ctx, page, errors, outside, asked } = await open(scope, 'off');
  check(scope, await settle(page), 'the Earth settles as it always has');
  const s = await ionState(page);
  check(scope, !s.on && !s.terrain && !s.imagery, 'no ion at all', JSON.stringify(s));
  check(scope, assetAsks(asked).length === 0, 'no asset is asked for', JSON.stringify(assetAsks(asked)));
  check(scope, await page.evaluate(() => !document.documentElement.classList.contains('globe-ion') && getComputedStyle(document.getElementById('ionCredits')).display === 'none'), 'no ion credit on the line');
  await locate(page);
  check(scope, (await ionState(page)).street, 'below 900 km the street map takes over, as before');
  check(scope, outside.length === 0, 'nothing reaches api.cesium.com', outside.slice(0, 3).join(' '));
  check(scope, errors.length === 0, 'no page errors', errors.join(' | '));
  await page.screenshot({ path: join(OUT, 'off-near.png') });
  await ctx.close();
}

/* ---------- on: the Worker holds a token ---------- */
for (const [device, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['desktop', { width: 1440, height: 900 }, false]]) {
  const scope = 'on-' + device;
  const { ctx, page, errors, outside, asked } = await open(scope, 'on', viewport, mobile);
  await page.waitForFunction(() => window.__huIon().terrain, null, { timeout: 15000 }).catch(() => {});
  /* this sandbox draws without a GPU: at desktop size it manages a frame or two a second, and Cesium loads tiles between
     frames, so a desktop "settled" here measures the software renderer, not the page. The phone must settle; the desktop says
     how it went. */
  const settled = await settle(page);
  if (mobile) check(scope, settled, 'the Earth settles');
  else console.log(`note [${scope}] the Earth ${settled ? 'settled' : 'had not settled in 60 s under software rendering'}`);
  let s = await ionState(page);
  check(scope, s.on && s.ground && s.terrain, 'terrain is in before the Earth is drawn', JSON.stringify(s));
  check(scope, !s.imagery && !s.imageryShown && s.clouds === 1, 'far out the Earth is NASA\'s: no aerial imagery, the cloud whole', JSON.stringify(s));
  check(scope, !assetAsks(asked).some((a) => /\/assets\/(3|2|3954)\//.test(a.path)), 'imagery is not even asked for far out');
  check(scope, assetAsks(asked).every((a) => a.search === '' && !a.auth), 'the page sends no ion token and no session to the Worker', JSON.stringify(assetAsks(asked)));
  const credit = await page.evaluate(() => { const c = document.getElementById('ionCredits'); const b = c.getBoundingClientRect(); return { shown: getComputedStyle(c).display !== 'none' && b.width > 0, text: c.textContent, logo: !!c.querySelector('img') }; });
  check(scope, credit.shown && credit.logo && /Data attribution/.test(credit.text), 'Cesium ion is credited on the imagery line', JSON.stringify(credit));
  await page.screenshot({ path: join(OUT, scope + '-far.png') });

  await locate(page);
  await page.waitForFunction(() => window.__huIon().imagery, null, { timeout: 15000 }).catch(() => {});
  s = await ionState(page);
  check(scope, s.imagery && s.imageryShown, 'near: the aerial imagery is in', JSON.stringify(s));
  check(scope, s.clouds === 0, 'near: the cloud has eased out', JSON.stringify(s));
  check(scope, !s.street, 'near: the street map yields to the aerial imagery', JSON.stringify(s));
  check(scope, hostSeen.some((h) => h.path.startsWith('/__ion/terrain/') && h.auth === 'Bearer asset-token-1' && h.client === 'CesiumJS'), 'the asset token rides only to the asset host');
  await settle(page);
  await page.screenshot({ path: join(OUT, scope + '-near.png') });

  await zoomIn(page, 4);
  await page.waitForFunction(() => window.__huIon().buildingsShown, null, { timeout: 15000 }).catch(() => {});
  s = await ionState(page);
  check(scope, s.buildings && s.buildingsShown && s.height < 50000, 'street level: the buildings are up', JSON.stringify(s));
  await page.screenshot({ path: join(OUT, scope + '-street.png') });

  await page.click('#ctlLayers'); await page.waitForTimeout(600);
  s = await ionState(page);
  check(scope, !s.imageryShown && !s.buildingsShown, 'the night look hides ion', JSON.stringify(s));
  await page.click('#ctlLayers'); await page.waitForTimeout(600);
  s = await ionState(page);
  check(scope, s.street && !s.imageryShown, 'the street look is the street map', JSON.stringify(s));
  await page.click('#ctlLayers'); await page.waitForTimeout(600);
  s = await ionState(page);
  check(scope, !s.street && s.imageryShown && s.buildingsShown, 'back to the Earth: ion again', JSON.stringify(s));

  await page.click('#ctlWorld'); await page.waitForTimeout(2600);
  s = await ionState(page);
  check(scope, !s.imageryShown && !s.buildingsShown && s.clouds === 1, 'home again: NASA\'s Earth, the cloud back', JSON.stringify(s));
  check(scope, assetAsks(asked).filter((a) => /\/assets\/3\//.test(a.path)).length === 1, 'each asset is asked for once a page', JSON.stringify(assetAsks(asked).map((a) => a.path)));
  check(scope, !assetAsks(asked).some((a) => /\/assets\/(2|3954)\//.test(a.path)), 'the first imagery asset worked, so no fallback was tried');
  check(scope, outside.length === 0, 'nothing reaches api.cesium.com', outside.slice(0, 3).join(' '));
  if (mobile) check(scope, await noSideways(page), '390px: no sideways scroll');
  check(scope, errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ---------- the World page: the same Earth in its frame, the credit inside the frame's band ---------- */
{
  const scope = 'world-page';
  const { ctx, page } = await open(scope, 'on');
  await page.goto(BASE + '/mnet.html?view=feed', { waitUntil: 'domcontentloaded' });
  const frame = await page.waitForSelector('#mnWorldFrame', { timeout: 30000 }).then((h) => h.contentFrame());
  await frame.waitForFunction(() => window.__huIon && window.__huIon().terrain, null, { timeout: 30000 }).catch(() => {});
  const s = await frame.evaluate(() => window.__huIon());
  check(scope, s.on && s.terrain && !s.imagery, 'the World page\'s Earth has ion terrain and stays NASA\'s far out', JSON.stringify(s));
  const credit = await frame.evaluate(() => { const c = document.getElementById('ionCredits'), line = document.querySelector('.osm-credit').getBoundingClientRect(); return { shown: getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().width > 0, inside: line.left >= 0 && line.right <= innerWidth && line.bottom <= innerHeight }; });
  check(scope, credit.shown && credit.inside, 'Cesium ion is credited inside the frame', JSON.stringify(credit));
  check(scope, await noSideways(page), '390px: no sideways scroll');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, 'world-page.png') });
  await ctx.close();
}

/* ---------- failing: every asset endpoint is a 502 ---------- */
{
  const scope = 'failing';
  const { ctx, page, errors, outside, asked } = await open(scope, 'failing');
  check(scope, await settle(page), 'the Earth still settles');
  let s = await ionState(page);
  check(scope, s.on && !s.terrain, 'terrain fell back to the flat ellipsoid', JSON.stringify(s));
  await locate(page);
  await page.waitForTimeout(2500);
  s = await ionState(page);
  check(scope, !s.imagery && s.street && s.clouds === 1, 'no imagery: the street map takes over below 900 km as before', JSON.stringify(s));
  const tried = assetAsks(asked).map((a) => Number(a.path.match(/assets\/(\d+)/)[1]));
  check(scope, [3, 2, 3954].every((id) => tried.filter((t) => t === id).length === 1), 'imagery tried each asset once and gave up', JSON.stringify(tried));
  check(scope, outside.length === 0, 'nothing reaches api.cesium.com', outside.slice(0, 3).join(' '));
  check(scope, errors.length === 0, 'no page errors', errors.join(' | '));
  await page.screenshot({ path: join(OUT, 'failing-near.png') });
  await ctx.close();
}

/* ---------- slow: the terrain endpoint takes 8 s ---------- */
{
  const scope = 'slow';
  const t0 = Date.now();
  const { ctx, page, errors } = await open(scope, 'slow');
  await page.waitForFunction(() => window.__huIon().on, null, { timeout: 30000 }).catch(() => {});
  const t1 = Date.now();
  const grounded = await page.waitForFunction(() => window.__huIon().ground, null, { timeout: 4000 }).then(() => true, () => false);
  const early = await ionState(page);
  check(scope, grounded && !early.terrain, 'within the 2.5 s wait the Earth has its flat ground and draws', (Date.now() - t1) + ' ms ' + JSON.stringify(early));
  check(scope, await settle(page), 'the Earth settles');
  await page.waitForTimeout(Math.max(0, 9500 - (Date.now() - t0)));
  const s = await ionState(page);
  check(scope, !s.terrain, 'the late terrain is not swapped in under the visitor', JSON.stringify(s));
  check(scope, errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
