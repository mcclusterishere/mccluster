/* PUBLIC MISSIONS IN THE WORLD, FOR A GUEST (owner, 2026-11-17: "we need them on the globe for the signed out users so people
   can just go look at the missions, sign in, get that user flow"; "it should be another tab called the equity uprise tab ...
   on the feed section under the globe"; "Should start on everything"). AGENTS.md, "Public World", and
   docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md are the law this suite holds the shipped page to.

   The page exactly as it ships (mnet.html, with the Travel switch on, never a switch-removed copy), with the real globe
   (Cesium from CESIUM_DIR, as the other World suites run it) and a fake api.mccluster.org and Supabase in memory: no
   production call, no sign-in, no join. At 390x844, 820x1180 and 1280x800 a signed-out visitor sees:
   - no centre mode bar (Travel is the house owner's; Missions and E=UP are not modes any more);
   - the feed strip Local, Everything (pressed), the Equity Uprise tab (the supplied mark alone, named "Equity Uprise"),
     Live, News, People; the arrow keys walk it, and a mouse drags it where it overflows;
   - the globe frame and the expanded globe without missions=0, and the published pins on the Earth;
   - the Equity Uprise tab: the mission feed's state with Environmental Justice above it, and back to Everything;
   - ?mission=<id>: that mission's dialog over the World with Join; Join asks to sign in with mission= still in the address;
   - ?view=missions and All missions: the Equity Uprise tab, never a sign-in prompt;
   - by day at 390, the supplied dark mark on the white tab and the white mark on the pressed red;
   - scrollWidth === clientWidth everywhere.
   And the house owner's persona still gets Travel in the centre bar.

     CESIUM_DIR=/path/to/Build/Cesium node scripts/e2e/world-missions-guest.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR if not resolvable). Screenshots and results.json land in outDir. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out', 'world-missions-guest');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

/* this checkout, as it ships */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------- the fixture world: open missions, two of them pinned by the owner, and public posts ---------- */
const RIDE = '0e1f0000-0000-4000-8000-000000000001', RIVER = '0e1f0000-0000-4000-8000-000000000002', TREES = '0e1f0000-0000-4000-8000-000000000003';
const mission = (id, title, description, domain) => ({ id, campaign_id: null, title, description, domain, difficulty: 1, base_points: 10, proof_required: true, verification_mode: 'review', skills: ['service'], capacity: null, status: 'open', starts_at: null, ends_at: null, kind: 'civic' });
const MISSIONS = [
  mission(RIDE, 'Give someone a free ride', 'Offer a ride to someone who needs one, and say where you took them.', 'community'),
  mission(RIVER, 'Clean up the Mill River', 'Bag a block of shoreline with your neighbours.', 'environment'),
  mission(TREES, 'Plant a street tree', 'Join a planting crew and plant one tree.', 'environment')
];
/* pins exist only where the owner placed a mission; the free ride can be done anywhere and has none */
const PINS = [
  { mission_id: RIVER, title: 'Clean up the Mill River', description: 'Bag a block of shoreline with your neighbours.', action_path: 'show_up', region_key: 'US-CT', region_label: 'Connecticut', latitude: 41.6, longitude: -72.7 },
  { mission_id: TREES, title: 'Plant a street tree', description: 'Join a planting crew and plant one tree.', action_path: 'show_up', region_key: 'BR-SP', region_label: 'São Paulo', latitude: -23.5, longitude: -46.6 }
];
const PEER = { m_uid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mccluster_id: 'fixture.ana', display_name: 'Fixture Ana' };
const ME = { m_uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', mccluster_id: 'fixture.owner', display_name: 'Fixture Owner' };
const POSTS = Array.from({ length: 4 }, (_, k) => ({ item_type: 'post', post_id: `dddddddd-dddd-4ddd-8ddd-00000000000${k + 1}`, occurred_at: new Date(Date.now() - (k + 1) * 3600e3).toISOString(), actor: PEER,
  post: { id: `dddddddd-dddd-4ddd-8ddd-00000000000${k + 1}`, body: `Field note ${k + 1}: what we did, what is next, and who can help.`, visibility: 'public', created_at: new Date(Date.now() - (k + 1) * 3600e3).toISOString(), like_count: k, liked_by_me: false, media_locked: 0 } }));
/* one official report, as the Environmental Justice module serves it; a report is not evidence of injustice */
const ENVIRONMENT = { schema: 'world-environment/v1', sources: [{ label: 'USGS', status: 'available', coverage: 'Global' }], missions: [],
  events: [{ id: 'usgs:fixture', title: 'Fixture government observation', category: 'Earthquake', lat: 41, lon: -73, observed_at: '2026-11-16T12:00:00Z', fetched_at: '2026-11-17T12:00:00Z', stale: false, source: { label: 'USGS', url: 'https://earthquake.usgs.gov/earthquakes/eventpage/fixture' }, actions: [] }] };

const results = [];
function check(scope, name, ok, detail) {
  results.push({ scope, name, ok: !!ok, ...(ok || detail === undefined ? {} : { detail }) });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${ok || detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 600)}`);
}

const VIEWPORTS = [
  { name: '390', viewport: { width: 390, height: 844 }, mobile: true },
  { name: '820', viewport: { width: 820, height: 1180 }, mobile: true },
  { name: '1280', viewport: { width: 1280, height: 800 }, mobile: false }
];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });

/* a browser context with the fake backends; owner: a signed-in member the server calls the house owner, remembered on this browser */
async function open(device, path, { owner = false } = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: device.viewport, deviceScaleFactor: 1, isMobile: device.mobile, hasTouch: device.mobile });
  await ctx.addInitScript((who) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
    localStorage.setItem('mnet_tour_seen', '1');
    if (who) {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: who })).replace(/=+$/, '') + '.y', refresh_token: 'fixture', expires_at: exp }));
      /* the server's yes from an earlier visit (js/world-owner-modes.js), so this visit opens with Travel at once */
      localStorage.setItem('mcc_world_owner', JSON.stringify({ sub: who, at: new Date().toISOString() }));
    }
  }, owner ? ME.m_uid : null);
  const world = { requests: [], rpc: [] };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
  await ctx.route('https://api.mccluster.org/**', (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, auth = req.headers().authorization || '';
    world.requests.push({ m: req.method(), p, auth: !!auth });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p === '/v1/status') return owner && auth ? json(route, { ok: true }) : json(route, { error: 'Forbidden' }, 403);
    if (p === '/v1/mnet/public-feed') return json(route, { items: POSTS, scope: 'public', next_before: null });
    if (p === '/v1/mnet/feed') return json(route, { items: POSTS, next_before: null });
    if (p === '/v1/mnet/bootstrap') return json(route, { identity: { m_uid: ME.m_uid, mccluster_id: ME.mccluster_id }, profile: { display_name: ME.display_name, mccluster_id: ME.mccluster_id }, next_step: null, tour_done_at: new Date().toISOString() });
    if (p === '/v1/world/news') return json(route, { ok: true, items: [], next_before: null });
    if (p === '/v1/world/place-scope') return json(route, { ok: true, enabled: false, country: null });
    if (p === '/v1/world/news-heat') return json(route, { ok: true, window_hours: 24, countries: {}, total: 0, capped: false, posts: {} });
    if (p === '/v1/world/access') return json(route, { release: { version: 'globe-admin-preview/v1', admin_preview: false }, level: 'public', unlocked_layers: [], locked_layers: [], layers: {} });
    if (p === '/v1/world/environment') return json(route, ENVIRONMENT);
    return json(route, {});
  });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, rpc = (p.match(/\/rest\/v1\/rpc\/([a-z_]+)$/) || [])[1];
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (rpc) world.rpc.push(rpc);
    if (p === '/auth/v1/user') return owner ? json(route, { id: ME.m_uid, email: 'owner@example.invalid' }) : json(route, { msg: 'no session' }, 401);
    if (p === '/auth/v1/settings') return json(route, { external: { email: true } });
    if (p === '/rest/v1/action_missions') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      return json(route, id ? MISSIONS.filter((m) => m.id === id) : MISSIONS);
    }
    if (p === '/rest/v1/action_mission_assignments') return json(route, []);
    if (rpc === 'action_globe_public_region_missions') return json(route, PINS);
    if (rpc === 'action_record') return json(route, { verified_actions: 0, points: 0, in_progress: 0, missions: [], skills: [], cohorts: [] });
    return json(route, []);
  });
  if (process.env.CESIUM_DIR) await ctx.route('https://cesium.com/**/Build/Cesium/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.split('/Build/Cesium/')[1];
    if (!rel || rel.includes('..')) return route.abort();
    try { return route.fulfill({ body: await readFile(join(process.env.CESIUM_DIR, rel)), contentType: TYPES[extname(rel)] || 'application/octet-stream' }); }
    catch { return route.abort(); }
  });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/TypeError|ReferenceError|SyntaxError/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.MCC_WORLD_MODE && !!window.MCC_FEED_SCOPE && document.documentElement.classList.contains('mn-world-on'), null, { timeout: 60000 });
  return { ctx, page, world, errors };
}
const fits = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
const globeOf = (page) => page.frame({ url: /action-globe\.html/ });
/* the strip as a reader meets it: each button's key, name, pressed state, words and the marks it shows */
const strip = (page) => page.evaluate(() => [...document.querySelectorAll('#mnFeedScope > button')].map((b) => ({
  key: b.dataset.feedScope || b.dataset.mnView, name: b.getAttribute('aria-label') || b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), words: b.textContent.trim(),
  marks: [...b.querySelectorAll('img')].filter((i) => i.getClientRects().length).map((i) => { const r = i.getBoundingClientRect(); return { src: i.getAttribute('src'), w: Math.round(r.width), h: Math.round(r.height), alt: i.getAttribute('alt') }; })
})));

try {
  for (const device of VIEWPORTS) {
    /* ---------- a guest on the World: Everything, then the Equity Uprise tab ---------- */
    {
      const scope = `guest-${device.name}`;
      /* by night (js/daylight.js follows the real Sun; ?daylight=night pins the phase for this run) */
      const { ctx, page, world, errors } = await open(device, '/mnet.html?view=feed&daylight=night');
      try {
        await page.waitForSelector('#mnFeed [data-post-id]', { timeout: 30000 });
        const shell = await page.evaluate(() => ({ travelOff: document.documentElement.classList.contains('hu-travel-off'), guest: document.documentElement.classList.contains('mn-guest'),
          bar: !!document.querySelector('.wt-world-modes') && document.querySelector('.wt-world-modes').getClientRects().length > 0, mode: window.MCC_WORLD_MODE.get(), scope: window.MCC_FEED_SCOPE.get(),
          frame: document.getElementById('mnWorldFrame').getAttribute('src'), expand: document.querySelector('.mn__world-expand').getAttribute('href') }));
        check(scope, 'a guest sees no centre mode bar: the feed is the one mode, Everything is chosen', shell.travelOff && shell.guest && !shell.bar && shell.mode === 'posts' && shell.scope === 'global', shell);
        const row = await strip(page);
        check(scope, 'the strip reads Local, Everything (pressed), Equity Uprise, Live, News, People', JSON.stringify(row.map((b) => b.name)) === JSON.stringify(['Local', 'Everything', 'Equity Uprise', 'Live', 'News', 'People'])
          && row[1].key === 'global' && row[1].pressed === 'true' && row.filter((b) => b.pressed === 'true').length === 1 && row[2].key === 'equity' && row[2].pressed === 'false', row);
        const eup = row[2];
        check(scope, 'the Equity Uprise tab is the supplied white mark alone by night, square-scaled, no words, named for assistive technology', eup.words === '' && eup.name === 'Equity Uprise' && eup.marks.length === 1
          && eup.marks[0].src === 'assets/img/equity-uprise-mark-white.png' && eup.marks[0].alt === '' && eup.marks[0].w === eup.marks[0].h && eup.marks[0].w >= 24 && eup.marks[0].w <= 44, eup);
        check(scope, 'the globe frame and the expanded globe ask for the missions (no missions=0)', !/missions=0/.test(shell.frame) && !/missions=0/.test(shell.expand), shell);
        const globe = globeOf(page);
        await globe.waitForFunction(() => typeof window.__huMissionPins === 'function' && window.__huMissionPins() > 0, null, { timeout: 60000 }).catch(() => {});
        check(scope, 'the Earth carries the published mission pins for a guest, and only those', await globe.evaluate((n) => window.__huMissionPins() === n && !document.documentElement.classList.contains('globe-no-missions'), PINS.length));
        await globe.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 25000 }).catch(() => {});
        let size = await fits(page);
        check(scope, 'nothing scrolls sideways on Everything', size.sw === size.cw, size);
        await page.screenshot({ path: join(OUT, `guest-everything-${device.name}.png`) });
        /* the arrow keys walk the strip */
        await page.focus('#mnFeedScope [data-feed-scope="global"]');
        await page.keyboard.press('ArrowRight');
        check(scope, 'the strip is reachable by keyboard and the arrow keys walk it', await page.evaluate(() => document.activeElement && document.activeElement.dataset.feedScope === 'equity'));
        /* the Equity Uprise tab: the mission feed, with Environmental Justice above it */
        await page.keyboard.press('Enter');
        await page.waitForSelector('#wePanel:not([hidden])', { timeout: 15000 }).catch(() => {});
        await page.waitForSelector('#mnFeed [data-mission-feed-empty]', { timeout: 15000 }).catch(() => {});
        const tab = await page.evaluate(() => {
          const panel = document.getElementById('wePanel'), feed = document.getElementById('mnFeed'), row = document.getElementById('mnFeedScope');
          return { scope: window.MCC_FEED_SCOPE.get(), pressed: document.querySelector('#mnFeedScope [data-feed-scope="equity"]').getAttribute('aria-pressed'),
            others: [...document.querySelectorAll('#mnFeedScope [aria-pressed="true"]')].map((b) => b.dataset.feedScope),
            panel: !panel.hidden && panel.getClientRects().length > 0, heading: (document.getElementById('weTitle') || {}).textContent || '',
            above: !!(row.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(panel.compareDocumentPosition(feed) & Node.DOCUMENT_POSITION_FOLLOWING),
            missions: !!feed.querySelector('[data-mission-feed-empty]'), posts: feed.querySelectorAll('[data-post-id]').length, news: feed.querySelectorAll('[data-news-id]').length,
            composer: document.getElementById('mnComposer').getClientRects().length > 0, guestCard: document.getElementById('mnGuestCard').getClientRects().length > 0, mode: window.MCC_WORLD_MODE.get() };
        });
        check(scope, 'the Equity Uprise tab shows the mission feed (no posts or news) with the Environmental Justice panel above it', tab.scope === 'equity' && tab.pressed === 'true' && JSON.stringify(tab.others) === '["equity"]'
          && tab.panel && /See the evidence/.test(tab.heading) && tab.above && tab.missions && tab.posts === 0 && tab.news === 0 && !tab.composer && !tab.guestCard && tab.mode === 'posts', tab);
        await page.waitForFunction(() => /Fixture government observation/.test(document.getElementById('wePanel').textContent), null, { timeout: 15000 }).catch(() => {});
        check(scope, 'the panel lists the official report on the same globe', await page.evaluate(() => /Fixture government observation/.test(document.getElementById('wePanel').textContent)));
        size = await fits(page);
        check(scope, 'nothing scrolls sideways on the Equity Uprise tab', size.sw === size.cw, size);
        await page.evaluate(() => { const r = document.getElementById('mnFeedScope'); r.scrollIntoView({ block: 'start' }); });
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(OUT, `guest-equity-${device.name}.png`) });
        /* leaving the tab is the whole feed again */
        await page.click('#mnFeedScope [data-feed-scope="global"]');
        check(scope, 'leaving the tab returns to Everything: posts back, the panel gone', await page.evaluate(() => window.MCC_FEED_SCOPE.get() === 'global' && document.getElementById('wePanel').hidden && document.querySelectorAll('#mnFeed [data-post-id]').length > 0));
        /* the strip drags: a finger scrolls it natively (overflow-x), a mouse drags it too, and a drag never chooses a tab */
        const over = await page.evaluate(() => { const r = document.getElementById('mnFeedScope'); return { sw: r.scrollWidth, cw: r.clientWidth, overflowX: getComputedStyle(r).overflowX }; });
        check(scope, 'the strip scrolls sideways inside itself, never the page', over.overflowX === 'auto' && (await fits(page)).sw === (await fits(page)).cw, over);
        if (over.sw > over.cw + 4) {
          const box = await page.locator('#mnFeedScope').boundingBox();
          await page.evaluate(() => { document.getElementById('mnFeedScope').scrollLeft = 0; });
          await page.mouse.move(box.x + box.width - 30, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width - 90, box.y + box.height / 2, { steps: 6 });
          await page.mouse.move(box.x + box.width - 150, box.y + box.height / 2, { steps: 6 });
          await page.mouse.up();
          const after = await page.evaluate(() => ({ left: document.getElementById('mnFeedScope').scrollLeft, scope: window.MCC_FEED_SCOPE.get(), live: !document.getElementById('mnLiveView').hidden, signin: !document.getElementById('mnSignedOut').hidden }));
          check(scope, 'a mouse drags the strip sideways, and the drag does not land as a tap', after.left > 40 && after.scope === 'global' && !after.live && !after.signin, after);
        }
        check(scope, 'a guest sent no join and no session', !world.rpc.some((r) => /^join_action_mission/.test(r)) && world.requests.every((r) => !r.auth));
        check(scope, 'no JavaScript errors', errors.length === 0, errors);
      } finally { await ctx.close(); }
    }

    /* ---------- a shared mission link: the dialog over the World, Join asks to sign in and keeps the mission ---------- */
    {
      const scope = `guest-mission-link-${device.name}`;
      const { ctx, page, world, errors } = await open(device, `/mnet.html?mission=${RIDE}`);
      try {
        await page.waitForSelector('#mnMissionDialog[open]', { timeout: 30000 });
        const dialog = await page.evaluate(() => ({ title: document.getElementById('mnMissionTitle').textContent, detail: document.getElementById('mnMissionDetail').textContent,
          join: !document.getElementById('mnMissionJoin').hidden && document.getElementById('mnMissionJoin').getClientRects().length > 0, joinText: document.getElementById('mnMissionJoin').textContent.trim(),
          joinGround: getComputedStyle(document.getElementById('mnMissionJoin')).backgroundColor, joinInk: getComputedStyle(document.getElementById('mnMissionJoin')).color,
          status: document.getElementById('mnMissionDialogStatus').textContent, scope: window.MCC_FEED_SCOPE.get(), view: !document.getElementById('mnFeedView').hidden,
          signin: !document.getElementById('mnSignedOut').hidden, mission: new URL(location.href).searchParams.get('mission') }));
        check(scope, 'a guest\'s ?mission= opens that mission\'s dialog over the World, with Join, the Equity Uprise tab under it', dialog.title === 'Give someone a free ride' && /Offer a ride/.test(dialog.detail) && dialog.join
          && dialog.joinText === 'Take this mission' && /Sign in to join this mission/.test(dialog.status) && dialog.scope === 'equity' && dialog.view && !dialog.signin && dialog.mission === RIDE, dialog);
        /* Join is a solid red button with white words by day and by night, never white words on nothing */
        check(scope, 'Join reads: white words on a solid red ground', /^rgb\((19[0-9]|2[0-5][0-9]), ([0-9]|[1-3][0-9]), ([0-9]|[1-5][0-9])\)$/.test(dialog.joinGround) && dialog.joinInk === 'rgb(255, 255, 255)', { ground: dialog.joinGround, ink: dialog.joinInk });
        let size = await fits(page);
        check(scope, 'the open dialog pushes nothing sideways', size.sw === size.cw, size);
        await page.screenshot({ path: join(OUT, `guest-mission-dialog-${device.name}.png`) });
        await page.click('#mnMissionJoin');
        await page.waitForSelector('#mnSignedOut:not([hidden])', { timeout: 15000 });
        const asked = await page.evaluate(() => ({ dialog: document.getElementById('mnMissionDialog').open, why: document.getElementById('mnGuestWhy').textContent, mission: new URL(location.href).searchParams.get('mission'), href: location.pathname + location.search }));
        check(scope, 'Join asks a guest to sign in for this mission and keeps mission= in the address', !asked.dialog && asked.why === 'Sign in to join this mission.' && asked.mission === RIDE, asked);
        check(scope, 'no join was sent for a guest', !world.rpc.some((r) => /^join_action_mission/.test(r)), world.rpc);
        size = await fits(page);
        check(scope, 'the sign-in panel pushes nothing sideways', size.sw === size.cw, size);
        check(scope, 'no JavaScript errors', errors.length === 0, errors);
      } finally { await ctx.close(); }
    }
  }

  /* ---------- ?view=missions and All missions are the Equity Uprise tab, never a sign-in prompt ---------- */
  {
    const scope = 'guest-browse-390';
    const { ctx, page, errors } = await open(VIEWPORTS[0], '/mnet.html?view=missions');
    try {
      await page.waitForFunction(() => window.MCC_FEED_SCOPE.get() === 'equity', null, { timeout: 30000 }).catch(() => {});
      check(scope, 'a guest\'s ?view=missions chooses the Equity Uprise tab and asks nobody to sign in', await page.evaluate(() => window.MCC_FEED_SCOPE.get() === 'equity' && document.getElementById('mnSignedOut').hidden && !document.getElementById('mnFeedView').hidden));
      await page.click('#mnFeedScope [data-feed-scope="global"]');
      await page.click('#huSearchToggle');
      await page.fill('#mnSearchInput', 'river');
      await page.waitForSelector('#mnSuggest:not([hidden]) [data-mn-feed="equity"]', { timeout: 10000 });
      await page.click('#mnSuggest [data-mn-feed="equity"]');
      check(scope, 'All missions in the search opens the Equity Uprise tab', await page.evaluate(() => window.MCC_FEED_SCOPE.get() === 'equity' && document.getElementById('mnSignedOut').hidden && document.getElementById('mnSuggest').hidden));
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }

  /* ---------- by day at 390: the supplied dark mark on the white tab, the white mark on the pressed red ---------- */
  {
    const scope = 'daylight-390';
    const { ctx, page, errors } = await open(VIEWPORTS[0], '/mnet.html?view=feed&daylight=day');
    try {
      await page.waitForSelector('#mnFeed [data-post-id]', { timeout: 30000 });
      check(scope, 'the World is in its daylight look', await page.evaluate(() => document.documentElement.getAttribute('data-daylight') === 'day'));
      const unpressed = (await strip(page))[2];
      check(scope, 'by day the unpressed tab shows the supplied dark mark alone', unpressed.marks.length === 1 && unpressed.marks[0].src === 'assets/img/equity-uprise-mark.png' && unpressed.words === '', unpressed);
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(OUT, 'daylight-everything-390.png') });
      await page.click('#mnFeedScope [data-feed-scope="equity"]');
      const pressed = (await strip(page))[2];
      check(scope, 'by day the pressed tab (red) shows the supplied white mark alone', pressed.pressed === 'true' && pressed.marks.length === 1 && pressed.marks[0].src === 'assets/img/equity-uprise-mark-white.png', pressed);
      const size = await fits(page);
      check(scope, 'nothing scrolls sideways by day', size.sw === size.cw, size);
      await page.evaluate(() => { document.getElementById('mnFeedScope').scrollIntoView({ block: 'start' }); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, 'daylight-equity-390.png') });
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }

  /* ---------- the house owner still gets Travel ---------- */
  for (const device of [VIEWPORTS[0], VIEWPORTS[2]]) {
    const scope = `owner-${device.name}`;
    const { ctx, page, errors } = await open(device, '/mnet.html?view=feed', { owner: true });
    try {
      await page.waitForSelector('.wt-world-modes button', { state: 'visible', timeout: 30000 }).catch(() => {});
      const bar = await page.evaluate(() => ({ travelOff: document.documentElement.classList.contains('hu-travel-off'), owner: document.documentElement.hasAttribute('data-world-owner'),
        modes: [...document.querySelectorAll('.wt-world-modes button')].filter((b) => b.getClientRects().length).map((b) => b.dataset.worldMode), mode: window.MCC_WORLD_MODE.get() }));
      check(scope, 'the house owner\'s World keeps Travel and News feed in the centre bar and opens on the feed', !bar.travelOff && bar.owner && JSON.stringify(bar.modes) === '["travel","posts"]' && bar.mode === 'posts', bar);
      await page.click('.wt-world-modes [data-world-mode="travel"]');
      check(scope, 'Travel opens for the house owner', await page.evaluate(() => window.MCC_WORLD_MODE.get() === 'travel' && document.getElementById('wtPlanner').getClientRects().length > 0));
      await page.click('.wt-world-modes [data-world-mode="posts"]');
      check(scope, 'the owner\'s strip has the Equity Uprise tab too', await page.evaluate(() => !!document.querySelector('#mnFeedScope [data-feed-scope="equity"]') && window.MCC_WORLD_MODE.get() === 'posts'));
      const size = await fits(page);
      check(scope, 'nothing scrolls sideways for the owner', size.sw === size.cw, size);
      await page.screenshot({ path: join(OUT, `owner-${device.name}.png`) });
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }
} finally {
  await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} checks passed. Screenshots and results in ${OUT}`);
assert.equal(failed.length, 0, failed.map((r) => `[${r.scope}] ${r.name}`).join('\n'));
