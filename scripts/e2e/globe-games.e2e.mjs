/* GAMES ON THE GLOBE, IN A REAL BROWSER (owner, 2026-11-03). Real pages and scripts from this checkout; the server's answers
   (/v1/status, /v1/world/access) and everything else are synthetic fixtures, so production is never called. Cesium is
   served from a local Build directory, never downloaded by the test.
     owner  → the Games tab → United States → Connecticut → Bridgeport → storylines playing now / next → Start lands on the route
     member and guest → no Games tab, no globe Missions controls, no Missions room in the bar's Globe wing
   at 390, 768 and 1440 px, with no sideways overflow and no page errors.
   PLAYWRIGHT_DIR=<node_modules> CESIUM_DIR=<Cesium Build dir> node scripts/e2e/globe-games.e2e.mjs [outDir] */
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || '/tmp/globe-games-proof';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const BASE = 'https://matthew.mccluster.org', CESIUM = process.env.CESIUM_DIR;
if (!CESIUM) throw Error('CESIUM_DIR is required; the test never downloads runtime assets.');
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.geojson': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2' };
const OWNER = '11111111-1111-4111-8111-111111111111', MEMBER = '22222222-2222-4222-8222-222222222222';
const results = [];
function check(scope, name, ok, detail) { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + '[' + scope + '] ' + name + (ok ? '' : ' ' + JSON.stringify(detail))); }
await mkdir(OUT, { recursive: true });
const json = (r, b, s = 200) => r.fulfill({ status: s, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(b) });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
const served = [];
async function setup(viewport, who) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 1000, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const errors = [], gamesFetches = [];
  const owner = who === OWNER;
  await ctx.addInitScript(({ who }) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
    if (!who) return;
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: who, email: who + '@fixture.invalid' })).replace(/=+$/, '') + '.y', refresh_token: 'fixture', expires_at: exp, user: { id: who } }));
  }, { who });
  await ctx.route('**/*', async (r) => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.hostname === 'cesium.com') { const rel = p.split('/Build/Cesium/')[1]; const f = rel && resolve(CESIUM, rel); if (f && f.startsWith(resolve(CESIUM) + sep)) { try { return r.fulfill({ body: await readFile(f), contentType: TYPES[extname(f)] || 'application/octet-stream' }); } catch {} } return r.abort(); }
    if (u.origin === 'https://api.mccluster.org') {
      if (p === '/v1/status') return owner ? json(r, { ok: true, operator: { email: 'owner@fixture.invalid' } }) : json(r, { error: 'Forbidden' }, who ? 403 : 401);
      if (p === '/v1/world/access') return json(r, { release: { version: 'globe-admin-preview/v1', admin_preview: owner }, level: owner ? 'owner' : who ? 'member' : 'public', levels: [], unlocked_layers: [], locked_layers: [] });
      if (p === '/v1/mnet/bootstrap') return json(r, { identity: { mccluster_id: owner ? 'matthew' : 'member.one', m_uid: 'm-x' }, profile: { display_name: owner ? 'Matthew McCluster' : 'Member One' } });
      return json(r, { ok: true, items: [], threads: [], events: [], total: 0 });
    }
    if (u.hostname.endsWith('supabase.co')) { if (p === '/auth/v1/user') return who ? json(r, { id: who, email: who + '@fixture.invalid' }) : json(r, { error: 'no' }, 401); return json(r, []); }
    if (u.origin === BASE) {
      if (p === '/data/games/world.v1.json') gamesFetches.push(p);
      const rel = p === '/' ? 'index.html' : decodeURIComponent(p.replace(/^\//, ''));
      const f = resolve(ROOT, rel); if (!f.startsWith(resolve(ROOT) + sep)) return r.abort();
      /* a destination is proven by where the browser lands, not by booting another game engine */
      if (/^(fictional-city|prim3-transit|prim3-world)\.html$/.test(rel)) { served.push(rel + u.search); return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>destination</title><p id="landed">' + rel + '</p>' }); }
      try { return r.fulfill({ body: await readFile(f), contentType: TYPES[extname(f)] || 'application/octet-stream' }); } catch { return r.fulfill({ status: 404, body: '' }); }
    }
    return r.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
  return { ctx, page, errors, gamesFetches };
}
const shot = (page, path) => page.screenshot({ path, timeout: 90000 }).catch((e) => console.log('screenshot skipped: ' + path + ' (' + e.message.split('\n')[0] + ')'));
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const shown = (p, sel) => p.evaluate((s) => { const n = document.querySelector(s); if (!n) return false; const cs = getComputedStyle(n), r = n.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
async function openTools(page) {
  /* the full-screen globe folds its controls and data layers into the tools menu (css/globe-editorial.css) */
  const sum = await page.$('details.globe-editorial-tools > summary');
  if (sum && !(await page.evaluate(() => document.querySelector('details.globe-editorial-tools').open))) await sum.click();
}
async function globeReady(page) {
  await page.waitForFunction(() => !!window.__huAccess && window.__huAccess() !== null || document.documentElement.classList.contains('globe-owner'), null, { timeout: 30000 }).catch(() => {});
  await page.waitForSelector('details.globe-editorial-tools', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
}

try {
  for (const vp of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    /* ---------- the owner ---------- */
    {
      const scope = 'owner-' + vp.width; const { ctx, page, errors, gamesFetches } = await setup(vp, OWNER);
      await page.goto(BASE + '/action-globe.html?explore=1', { waitUntil: 'domcontentloaded' });
      await globeReady(page);
      await page.waitForFunction(() => document.documentElement.classList.contains('globe-owner'), null, { timeout: 30000 }).catch(() => {});
      await openTools(page);
      check(scope, 'the server\'s owner answer shows the Games tab in the globe\'s layers', await shown(page, '#ctlGames'), await page.evaluate(() => ({ cls: document.documentElement.className, access: window.__huAccess && window.__huAccess() })));
      check(scope, 'the owner-only gate on the globe\'s Missions mode, layer and feed is lifted for the owner', await page.evaluate(() => document.documentElement.classList.contains('globe-owner') && !getComputedStyle(document.getElementById('missionsLayer')).getPropertyValue('display').startsWith('none') || getComputedStyle(document.querySelector('.world-tools')).display === 'none'));
      check(scope, 'nothing of Games was fetched before it was opened', gamesFetches.length === 0, gamesFetches);
      await page.click('#ctlGames');
      await page.waitForSelector('#gamesSheet [data-country="us"]', { timeout: 15000 }).catch(() => {});
      check(scope, 'Games opens its own overlay on the country list, the United States first', await page.evaluate(() => { const s = document.getElementById('gamesSheet'); const first = s && s.querySelector('[data-country]'); return !!s && !s.hidden && first && first.dataset.country === 'us' && document.getElementById('ctlGames').getAttribute('aria-pressed') === 'true'; }));
      if (vp.width === 390) await shot(page, join(OUT, `owner-${vp.width}-1-countries.png`));
      await page.click('#gamesSheet [data-country="us"]');
      await page.click('#gamesSheet [data-state="connecticut"]');
      await page.click('#gamesSheet [data-town="bridgeport"]');
      await page.waitForSelector('#gamesSheet .games-story', { timeout: 5000 }).catch(() => {});
      const town = await page.evaluate(() => {
        const s = document.getElementById('gamesSheet');
        return { title: s.querySelector('h2').textContent, crumb: s.querySelector('.games-crumb').textContent,
          stories: [...s.querySelectorAll('.games-story')].map((x) => ({ id: x.dataset.storyline, now: x.querySelector('.games-now').textContent, next: x.querySelector('.games-next').textContent, start: x.querySelector('.games-start').getAttribute('href') })),
          entries: [...s.querySelectorAll('.games-entry .games-start')].map((a) => a.getAttribute('href')) };
      });
      check(scope, 'United States → Connecticut → Bridgeport', town.title === 'Bridgeport' && /United States · Connecticut/.test(town.crumb), town);
      check(scope, 'Bridgeport shows its three storylines, each with what is playing now and what is next', town.stories.map((s) => s.id).join() === 'robbery-1s,whip-equipped,b1-blind-the-floor' && town.stories.every((s) => s.now.length > 3 && /then .+ in \d/.test(s.next)), town.stories);
      check(scope, 'and its missions: the city, Bridgeport, the garage, the HQ and both sides of B1', ['fictional-city.html', 'fictional-city.html?entry=bridgeport', 'fictional-city.html?entry=garage', 'prim3-transit.html?level=equity-uprise-hq', 'prim3-transit.html?level=equity-uprise-b1&side=defend', 'prim3-transit.html?level=equity-uprise-b1&side=attack'].every((h) => town.entries.includes(h)), town.entries);
      check(scope, 'the town view does not scroll the page sideways', (await overflow(page)) === 0, await overflow(page));
      const box = await page.evaluate(() => { const r = document.getElementById('gamesSheet').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
      check(scope, 'the overlay sits inside the viewport', box.l >= 0 && box.r <= box.w, box);
      await shot(page, join(OUT, `owner-${vp.width}-2-bridgeport.png`));
      if (vp.width === 390) {
        await page.evaluate(() => { const d = document.querySelector('#gamesSheet .games-scenes'); if (d) d.open = true; });
        await shot(page, join(OUT, `owner-${vp.width}-3-scenes.png`));
      }
      check(scope, 'no page errors', errors.length === 0, errors);
      /* start one: the Robbery 1s lands on Bridgeport in the city */
      await Promise.all([page.waitForURL(/fictional-city\.html\?entry=bridgeport$/, { timeout: 20000 }).catch(() => {}), page.click('#gamesSheet [data-storyline="robbery-1s"] .games-start')]);
      check(scope, 'Start on the Robbery 1s lands on fictional-city.html?entry=bridgeport', /\/fictional-city\.html\?entry=bridgeport$/.test(page.url()), page.url());
      await ctx.close();
    }
    /* ---------- the owner's deep link opens a town directly; a mission starts from it ---------- */
    if (vp.width === 1440) {
      const scope = 'owner-deeplink'; const { ctx, page, errors } = await setup(vp, OWNER);
      await page.goto(BASE + '/action-globe.html?explore=1&games=us/connecticut/bridgeport', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#gamesSheet .games-story', { timeout: 60000 }).catch(() => {});
      check(scope, '?games=us/connecticut/bridgeport opens Bridgeport', await page.evaluate(() => (document.querySelector('#gamesSheet h2') || {}).textContent === 'Bridgeport'));
      await Promise.all([page.waitForURL(/side=attack$/, { timeout: 20000 }).catch(() => {}), page.click('#gamesSheet .games-entry[data-entry="b1-blind-the-floor"] .games-start')]);
      check(scope, 'B1 Blind the Floor starts on prim3-transit.html?level=equity-uprise-b1&side=attack', /\/prim3-transit\.html\?level=equity-uprise-b1&side=attack$/.test(page.url()), page.url());
      check(scope, 'no page errors', errors.length === 0, errors);
      await ctx.close();
    }
    /* ---------- a member and a guest ---------- */
    for (const [label, who] of [['member', MEMBER], ['guest', '']]) {
      const scope = label + '-' + vp.width; const { ctx, page, errors, gamesFetches } = await setup(vp, who);
      await page.goto(BASE + '/action-globe.html?explore=1&games=1', { waitUntil: 'domcontentloaded' });
      await globeReady(page);
      await page.waitForTimeout(1500);
      await openTools(page);
      const g = await page.evaluate(() => ({ owner: document.documentElement.classList.contains('globe-owner'), games: (() => { const b = document.getElementById('ctlGames'); return !!b && getComputedStyle(b).display !== 'none' && !b.hidden; })(), sheet: !!document.getElementById('gamesSheet'),
        missions: ['feedMode', 'missionsLayer', 'worldFeed'].map((id) => getComputedStyle(document.getElementById(id)).display) }));
      check(scope, 'no Games tab, no overlay, even with ?games=1', !g.owner && !g.games && !g.sheet, g);
      check(scope, 'the globe\'s Missions mode, layer and feed are not drawn', g.missions.every((d) => d === 'none'), g.missions);
      check(scope, 'nothing of Games was fetched', gamesFetches.length === 0, gamesFetches);
      check(scope, 'no sideways overflow', (await overflow(page)) === 0, await overflow(page));
      if (vp.width === 390) await shot(page, join(OUT, `${label}-${vp.width}-globe.png`));
      /* the bar's Globe wing: Account is there, Missions is not (its column is kept empty) */
      await page.evaluate(() => { const d = document.querySelector('details.globe-editorial-tools'); if (d) d.open = false; });
      const tab = await page.$('.appbar [data-appnav="world"]');
      if (tab) {
        const b = await tab.boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
        await page.waitForSelector('.appbar--morph', { timeout: 3000 }).catch(() => {});
        const wing = await page.evaluate(() => ({ morph: !!document.querySelector('.appbar--morph'), rooms: [...document.querySelectorAll('.appbar a[data-dock]')].map((a) => a.textContent.trim()), gated: document.querySelectorAll('.appbar .appbar__tab--gated').length, cells: document.querySelector('.appbar') ? document.querySelector('.appbar').children.length : 0 }));
        check(scope, 'the Globe wing opens with Account and no Missions room, keeping its three cells', wing.morph && wing.rooms.some((t) => /Account/.test(t)) && !wing.rooms.some((t) => /Missions/.test(t)) && wing.gated === 1 && wing.cells === 3, wing);
        if (vp.width === 390) await shot(page, join(OUT, `${label}-${vp.width}-globe-wing.png`));
      } else check(scope, 'the bar is on the page', false, 'no world tab');
      check(scope, 'no page errors', errors.length === 0, errors);
      await ctx.close();
    }
  }
} finally { await browser.close(); }
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed · screenshots in ${OUT}`);
process.exit(failed ? 1 : 0);
