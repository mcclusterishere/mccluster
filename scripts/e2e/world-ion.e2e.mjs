/* THE EARTH UP CLOSE, end to end in a real browser (owner, 2026-10-15: "I added an ion, cesium ion key to the McCluster worker").

   Serves this checkout, fakes api.mccluster.org (the Worker's /v1/world/ion status and asset endpoints) and Supabase, and stands in
   for Cesium ion's tile hosts on this same server: a flat heightmap terrain, one imagery tile for every z/x/y, an empty 3D tileset.
   Real CesiumJS 1.131 from the CDN drives it, so the page's ion code runs exactly as it will against the Worker. The asset endpoint
   stand-in behaves as the Worker does: members only, so it answers 401 unless the request carries an accepted member session as a
   bearer header. Every world below except "anon" and "refused" is a signed-in member's page. The worlds:

     anon     logged out, the Worker holding a token: the page asks neither the ion status nor any asset, and nothing reaches
              api.cesium.com or assets.ion.cesium.com; NASA's Earth and the street map as before;
     refused  a member whose session the Worker refuses (401): ion steps aside once and the Earth is NASA's, with no request loop;
     rotate   the member's session rotates in this tab mid-visit: the stale one's 401 is retried with the new one, and ion carries on;

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

const MEMBER = 'member-e2e-session';
async function open(scope, mode, viewport = { width: 390, height: 844 }, mobile = true, { statusDelay = 0, geo = { latitude: 40.7484, longitude: -73.9857 }, session = MEMBER, accepted = new Set([MEMBER]) } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, geolocation: geo, permissions: ['geolocation'] });
  await ctx.addInitScript((member) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() }));
    if (member) localStorage.setItem('mccdb_session', JSON.stringify({ access_token: member, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
  }, session);
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': BASE }, body: JSON.stringify(body) });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => json(route, route.request().url().includes('action_globe_public_region_missions') ? MISSIONS : []));
  const asked = [];
  await ctx.route('https://api.mccluster.org/**', async (route) => {
    const u = new URL(route.request().url());
    asked.push({ path: u.pathname, search: u.search, auth: route.request().headers().authorization || '' });
    if (u.pathname === '/v1/world/ion') { if (statusDelay) await new Promise((r) => setTimeout(r, statusDelay)); return json(route, { ok: true, available: mode !== 'off', binding: mode === 'off' ? null : 'CESIUM_ION_TOKEN', assets: ASSETS }).catch(() => {}); }
    const m = u.pathname.match(/^\/v1\/world\/ion\/v1\/assets\/(\d+)\/endpoint$/);
    if (m) {
      const id = Number(m[1]);
      const bearer = (route.request().headers().authorization || '').replace(/^Bearer /, '');
      if (!accepted.has(bearer)) return json(route, { error: 'Sign in to see the World\'s terrain, aerial imagery and 3D buildings', detail: { members_only: true } }, 401);
      if (mode === 'failing') return json(route, { error: 'Cesium ion did not answer for this asset' }, 502);
      if (mode === 'slow' && id === 1) { await new Promise((r) => setTimeout(r, 8000)); return json(route, ENDPOINTS[1]).catch(() => {}); }
      return ENDPOINTS[id] ? json(route, ENDPOINTS[id]) : json(route, { error: 'Cesium ion did not answer for this asset' }, 502);
    }
    return json(route, { error: 'not found' }, 404);
  });
  const page = await ctx.newPage();
  const errors = [], outside = [], warnings = [], pending = new Map();
  page.on('request', (r) => pending.set(r, r.url()));
  page.on('requestfinished', (r) => pending.delete(r));
  page.on('requestfailed', (r) => pending.delete(r));
  page.__pending = pending;
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/TypeError|ReferenceError|SyntaxError/.test(m.text())) errors.push(m.text().slice(0, 300)); if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text().slice(0, 200)); });
  page.on('request', (r) => { const h = new URL(r.url()).host; if (/(^|\.)cesium\.com$/.test(h) && !r.url().includes('/downloads/cesiumjs/')) outside.push(r.url()); });
  await page.goto(BASE + '/action-globe.html?explore=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__huIon, null, { timeout: 30000 });
  return { ctx, page, errors, outside, asked, warnings, accepted };
}
const ionState = (page) => page.evaluate(() => window.__huIon());
const earth = (page) => page.waitForFunction(() => window.__huGlobeSettled, null, { timeout: 30000 });
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
  const { ctx, page, errors, outside, asked } = await open(scope, 'off', undefined, true, { statusDelay: 1400 });
  /* the status takes 1.4 s here: the bar, the sheet and the credit line are laid out before it answers */
  await page.waitForSelector('.appbar', { timeout: 10000 });
  await page.waitForTimeout(250);
  const early = await page.evaluate(() => ({ earth: !!window.__huGlobeSettled, bar: getComputedStyle(document.documentElement).getPropertyValue('--hu-bar-h').trim(), deckBottom: Math.round(document.getElementById('deck').getBoundingClientRect().bottom), barTop: Math.round(document.querySelector('.appbar').getBoundingClientRect().top) }));
  check(scope, !early.earth && early.bar !== '0px' && early.bar !== '' && early.deckBottom <= early.barTop + 1, 'while the status is pending the sheet already sits above the bar', JSON.stringify(early));
  await earth(page);
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
  await earth(page);
  await page.waitForFunction(() => window.__huIon().terrain, null, { timeout: 15000 }).catch(() => {});
  /* this sandbox draws without a GPU: at desktop size it manages a frame or two a second, and Cesium loads tiles between
     frames, so a desktop "settled" here measures the software renderer, not the page. The phone must settle; the desktop says
     how it went. */
  const settled = await settle(page);
  if (mobile) check(scope, settled, 'the Earth settles');
  else console.log(`note [${scope}] the Earth ${settled ? 'settled' : 'had not settled in 60 s under software rendering'}`);
  let s = await ionState(page);
  check(scope, s.on && s.ground && s.terrain, 'terrain is in before the Earth is drawn', JSON.stringify(s));
  check(scope, !s.imagery && !s.imageryShown && s.clouds === 1 && s.nightLights === 1, 'far out the Earth is NASA\'s: no aerial imagery, the cloud and the night lights whole', JSON.stringify(s));
  check(scope, !assetAsks(asked).some((a) => /\/assets\/(3|2|3954)\//.test(a.path)), 'imagery is not even asked for far out');
  check(scope, assetAsks(asked).length > 0 && assetAsks(asked).every((a) => a.search === '' && a.auth === `Bearer ${MEMBER}`), 'the page sends the member\'s session as a bearer header and nothing in the URL', JSON.stringify(assetAsks(asked)));
  const credit = await page.evaluate(() => { const c = document.getElementById('ionCredits'); const b = c.getBoundingClientRect(); return { shown: getComputedStyle(c).display !== 'none' && b.width > 0, text: c.textContent, logo: !!c.querySelector('img') }; });
  check(scope, credit.shown && credit.logo && /Data attribution/.test(credit.text), 'Cesium ion is credited on the imagery line', JSON.stringify(credit));
  await page.screenshot({ path: join(OUT, scope + '-far.png') });

  await locate(page);
  await page.waitForFunction(() => window.__huIon().imagery, null, { timeout: 15000 }).catch(() => {});
  s = await ionState(page);
  check(scope, s.imagery && s.imageryShown, 'near: the aerial imagery is in', JSON.stringify(s));
  check(scope, s.clouds === 0 && s.nightLights === 0, 'near: the cloud and the night lights have eased out', JSON.stringify(s));
  check(scope, !s.street, 'near: the street map yields to the aerial imagery', JSON.stringify(s));
  check(scope, hostSeen.some((h) => h.path.startsWith('/__ion/terrain/') && h.auth === 'Bearer asset-token-1' && h.client === 'CesiumJS'), 'the asset token rides only to the asset host');
  check(scope, !hostSeen.some((h) => h.auth.includes(MEMBER)), 'the member\'s session never goes to the asset host');
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
  check(scope, !s.imageryShown && !s.buildingsShown && s.clouds === 1 && s.nightLights === 1, 'home again: NASA\'s Earth, the cloud and the night lights back', JSON.stringify(s));
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
  /* a phone's credits panel fills the frame and its close button can sit under the World page's header: any tap closes it */
  await frame.click('.cesium-credit-expand-link');
  const opened = await frame.evaluate(() => getComputedStyle(document.querySelector('.cesium-credit-lightbox-overlay')).display !== 'none');
  await page.screenshot({ path: join(OUT, 'world-page-credits.png') });
  const box = await (await frame.$('.cesium-credit-lightbox')).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.6);
  await page.waitForTimeout(300);
  const closed = await frame.evaluate(() => getComputedStyle(document.querySelector('.cesium-credit-lightbox-overlay')).display === 'none');
  check(scope, opened && closed, '"Data attribution" opens the credits, and a tap on them closes them', JSON.stringify({ opened, closed }));
  await ctx.close();
}

/* ---------- night: Near me where it is night right now; the aerial imagery must not hide under the night lights ---------- */
{
  const scope = 'night';
  const now = new Date(), utc = now.getUTCHours() + now.getUTCMinutes() / 60;
  const lon = ((((12 - utc) * 15 + 180) + 540) % 360) - 180;
  const { ctx, page, errors } = await open(scope, 'on', undefined, true, { geo: { latitude: 30, longitude: Math.round(lon * 100) / 100 } });
  await earth(page);
  await locate(page);
  await page.waitForFunction(() => window.__huIon().imagery, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  const s = await ionState(page);
  check(scope, s.imageryShown && s.nightLights === 0 && !s.street, 'at local midnight, 350 km up: the aerial imagery shows, the night lights have given way', JSON.stringify({ lon, ...s }));
  check(scope, errors.length === 0, 'no page errors', errors.join(' | '));
  await page.screenshot({ path: join(OUT, 'night-near.png') });
  await ctx.close();
}

/* ---------- failing: every asset endpoint is a 502 ---------- */
{
  const scope = 'failing';
  const { ctx, page, errors, outside, asked } = await open(scope, 'failing');
  await earth(page);
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

/* ---------- anon: logged out while the Worker holds a token ---------- */
{
  const scope = 'anon';
  const hostBefore = hostSeen.length;
  const { ctx, page, errors, outside, asked } = await open(scope, 'on', undefined, true, { session: null });
  await earth(page);
  check(scope, await settle(page), 'the Earth settles');
  let s = await ionState(page);
  check(scope, !s.on && !s.terrain && !s.imagery && !s.buildings, 'no ion at all', JSON.stringify(s));
  await locate(page);
  await zoomIn(page, 4);
  await page.waitForTimeout(1500);
  s = await ionState(page);
  check(scope, s.street && !s.imagery && !s.buildings, 'near and at street level: the street map, as before', JSON.stringify(s));
  const ionAsks = asked.filter((a) => a.path === '/v1/world/ion' || a.path.startsWith('/v1/world/ion/'));
  check(scope, ionAsks.length === 0, 'zero requests to the Worker\'s ion route (status included)', JSON.stringify(ionAsks));
  check(scope, outside.length === 0, 'zero requests to api.cesium.com or assets.ion.cesium.com', outside.slice(0, 3).join(' '));
  check(scope, hostSeen.length === hostBefore, 'zero requests to the ion asset stand-in');
  check(scope, await page.evaluate(() => !document.documentElement.classList.contains('globe-ion')), 'no ion credit');
  check(scope, await noSideways(page), '390px: no sideways scroll');
  check(scope, errors.length === 0, 'no page errors', errors.join(' | '));
  await page.screenshot({ path: join(OUT, 'anon-street.png') });
  await ctx.close();
}

/* ---------- refused: a member's session the Worker does not accept ---------- */
{
  const scope = 'refused';
  const { ctx, page, errors, outside, asked, warnings } = await open(scope, 'on', undefined, true, { accepted: new Set() });
  await earth(page);
  check(scope, await settle(page), 'the Earth settles');
  await locate(page);
  await zoomIn(page, 4);
  await page.waitForTimeout(2500);
  const s = await ionState(page);
  check(scope, !s.on && !s.terrain && !s.imagery && !s.buildings && s.street && s.clouds === 1, 'ion stepped aside: the flat Earth, NASA\'s imagery, the street map below 900 km', JSON.stringify(s));
  const tried = assetAsks(asked);
  check(scope, tried.length >= 1 && tried.length <= 2, 'one refusal (terrain; buildings never asked) and no loop', JSON.stringify(tried.map((a) => a.path)));
  await page.waitForTimeout(3000);
  check(scope, assetAsks(asked).length === tried.length, 'and nothing more is asked later');
  const ionWarnings = warnings.filter((w) => w.includes('[world ion]'));
  check(scope, ionWarnings.length <= 1, 'at most one console line from ion', JSON.stringify(ionWarnings));
  check(scope, !hostSeen.some((h) => h.auth.includes(MEMBER)), 'the session never reached the asset host');
  check(scope, outside.length === 0, 'nothing reaches api.cesium.com', outside.slice(0, 3).join(' '));
  check(scope, errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ---------- rotate: the session changes in this tab (no storage event); the stale one's 401 is retried with the new one ---------- */
{
  const scope = 'rotate';
  const { ctx, page, errors, asked, accepted } = await open(scope, 'on');
  await earth(page);
  await page.waitForFunction(() => window.__huIon().terrain, null, { timeout: 15000 }).catch(() => {});
  /* the session rotates: the Worker accepts only the new one, and this tab's storage holds it */
  accepted.clear(); accepted.add('member-e2e-session-2');
  await page.evaluate(() => localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'member-e2e-session-2', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 })));
  await locate(page);
  await page.waitForFunction(() => window.__huIon().imagery, null, { timeout: 15000 }).catch(() => {});
  const s = await ionState(page);
  check(scope, s.on && s.terrain && s.imagery && s.imageryShown, 'ion carried on with the new session', JSON.stringify(s));
  const img = assetAsks(asked).filter((a) => /\/assets\/3\//.test(a.path)).map((a) => a.auth);
  check(scope, img.length === 2 && img[0] === `Bearer ${MEMBER}` && img[1] === 'Bearer member-e2e-session-2', 'the stale session was refused once and the new one retried', JSON.stringify(img));
  check(scope, errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

/* ---------- slow: the terrain endpoint takes 8 s ---------- */
{
  const scope = 'slow';
  const t0 = Date.now();
  const { ctx, page, errors, asked } = await open(scope, 'slow');
  await page.waitForFunction(() => window.__huIon().on, null, { timeout: 30000 }).catch(() => {});
  const t1 = Date.now();
  const grounded = await page.waitForFunction(() => window.__huIon().ground, null, { timeout: 4000 }).then(() => true, () => false);
  const early = await ionState(page);
  check(scope, grounded && !early.terrain, 'within the 2.5 s wait the Earth has its flat ground and draws', (Date.now() - t1) + ' ms ' + JSON.stringify(early));
  check(scope, await settle(page), 'the Earth settles');
  await page.waitForTimeout(Math.max(0, 9500 - (Date.now() - t0)));
  const s = await ionState(page);
  check(scope, !s.terrain, 'the late terrain is not swapped in under the visitor', JSON.stringify(s));
  await locate(page); await zoomIn(page, 4); await page.waitForTimeout(1500);
  const low = await ionState(page);
  check(scope, low.height < 50000 && low.imagery && !low.buildings && !asked.some((a) => /\/assets\/96188\//.test(a.path)), 'on the flat fallback the buildings are never asked for (they would float or sink)', JSON.stringify(low));
  check(scope, errors.length === 0, 'no page errors', errors.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
