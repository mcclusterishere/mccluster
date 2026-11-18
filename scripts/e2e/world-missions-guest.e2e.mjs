/* PUBLIC MISSIONS IN THE WORLD, FOR A GUEST (owner, 2026-11-17: "we need them on the globe for the signed out users so people
   can just go look at the missions, sign in, get that user flow"; "it should be another tab called the equity uprise tab ...
   on the feed section under the globe"; "Should start on everything"). AGENTS.md, "Public World", and
   docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md are the law this suite holds the shipped page to.

   The page exactly as it ships (mnet.html, with the Travel switch on, never a switch-removed copy), with the real globe
   (Cesium from CESIUM_DIR, as the other World suites run it) and a fake api.mccluster.org and Supabase in memory: no
   production call, no real sign-in, no real join. At 390x844, 820x1180 and 1280x800 a signed-out visitor sees:
   - no centre mode bar (Travel is the house owner's; Missions and E=UP are not modes any more), and nothing above the feed's
     row: no "News feed" and no "E=UP" written anywhere on the page or in the globe frame (owner, 2026-11-18: "There should be
     no tabs from news feed to E equals up. It should just be local, equity up, global, live news people.");
   - the feed's row in the owner's order: Local, the Equity Uprise tab (the supplied mark alone, named "Equity Uprise"),
     Global (pressed), Live, News, People; every tab at least 44px, the chosen one in view and marked; the arrow keys, Home
     and End walk it in that order, and a mouse drags it where it overflows;
   - the globe frame and the expanded globe without missions=0, and the published pins on the Earth;
   - the Equity Uprise tab: the mission posts (and, since slice G1, the environmental observation posts) with Environmental
     Justice above them, and back to Global;
   - ?mission=<id>: that mission's dialog over the World with Join; Join asks to sign in with mission= still in the address;
   - ?view=missions and All missions: the Equity Uprise tab, never a sign-in prompt;
   - by day at 390, the same row, the supplied dark mark on the white tab and the white mark on the pressed red;
   - scrollWidth === clientWidth everywhere.
   And the house owner's persona still gets Travel in the centre bar.

   MISSIONS AS POSTS (owner, 2026-11-17: "having the missions as like just another post in the newsfeed, not a big, large post,
   just the same size post as all the other [posts]"; "when you click on America, you should be able to say, see X amount of
   news, X amount of missions"). Three open missions are written exactly as the pending import writes them
   (tools/build-mission-import.mjs: three Project Drawdown missions with their details rows, open as its publish step sets
   them), beside three fixture missions with none. At each size, a guest:
   - Global mixes posts, news and missions: one mission after every three other items, newest first, each once, then the
     rest up to the page of 20; no mission post is taller than the tallest ordinary post plus 48px (the tallest is 119
     characters, the longest public post in production on 2026-11-17);
   - the Equity Uprise tab lists the mission posts and the observation posts, and nothing else;
   - a mission post's source line opens the dialog at its credit: the quotation with its credit directly beneath, the proof
     hint and safety line, the credit in full with its links; Share copies the mission's link on this origin;
   - a country picked with the globe's own tap gives the place card its counts (news, missions, posts, members) in two rows,
     and Local lists that country's missions: the ones pinned there and the ones pinned nowhere;
   - zero console errors and no 4xx.
   By day at 390, the dark mark on the joins too. As production stands today (the details table not there yet, the
   Environmental Justice module not released): no source lines, one details read for the whole visit (and none after a
   reload), one honest line in place of the panel, and only those two deliberate absences in the console. A member's Join on
   a post sends exactly one join_action_mission.

   AFTER THE REVIEW OF W2 (the W2 row of docs/control-plane/WORLD-FEED-AND-MISSIONS-20261117.md): every mission post lies within
   the ordinary posts' own range of heights (its source line sits in the head's second line, beside the difficulty and points);
   a slow missions read never holds back the posts and the news; a failed read offers Try again and is read again when the tab
   is chosen again; a country tapped on the Equity Uprise tab narrows the tab to the place's missions under the panel, and News
   comes back when a country is let go; Escape is the × (the mission leaves the address); a drag released outside the strip
   never swallows the next key on a tab; Local says which member posts the card counts that it cannot show; the panel reads
   4.5:1 or better by day; hostile rows run nothing on the World; a member's denied, malformed and in-flight joins each send
   one join_action_mission.

     CESIUM_DIR=/path/to/Build/Cesium node scripts/e2e/world-missions-guest.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR if not resolvable). Screenshots and results.json land in outDir. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { missionRow, detailsRow } from '../../tools/build-mission-import.mjs';

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

/* ---------- the fixture world: open missions (two pinned by the owner, three from the Drawdown catalog), public posts, news ---------- */
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();
const RIDE = '0e1f0000-0000-4000-8000-000000000001', RIVER = '0e1f0000-0000-4000-8000-000000000002', TREES = '0e1f0000-0000-4000-8000-000000000003';
const mission = (id, title, description, domain, created_at) => ({ id, campaign_id: null, title, description, domain, difficulty: 1, base_points: 10, proof_required: true, verification_mode: 'review', skills: ['service'], capacity: null, status: 'open', starts_at: null, ends_at: null, kind: 'civic', created_at });
/* the catalog's own rows, as the pending import and publish SQL write them (status open: the publish step) */
const CATALOG = JSON.parse(await readFile(join(ROOT, 'data/missions/drawdown/missions.json'), 'utf8')).missions;
const fromCatalog = (slug, days) => { const m = CATALOG.find((x) => x.slug === slug); return { row: { ...missionRow(m), status: 'open', created_at: ago(days) }, details: detailsRow(m), about: m.about, aboutCredit: m.about_credit }; };
const INSULATION = fromCatalog('drawdown-deploy-alternative-insulation-materials', 3);   // CC BY 4.0, with a quotation
const MANURE = fromCatalog('drawdown-improve-manure-management', 2);                     // used with permission, with a quotation
const COAL = fromCatalog('drawdown-manage-coal-mine-methane', 1);                        // CC BY 4.0, no quotation
const MISSIONS = [
  mission(RIDE, 'Give someone a free ride', 'Offer a ride to someone who needs one, and say where you took them.', 'community', ago(30)),
  mission(RIVER, 'Clean up the Mill River', 'Bag a block of shoreline with your neighbours.', 'environment', ago(20)),
  mission(TREES, 'Plant a street tree', 'Join a planting crew and plant one tree.', 'environment', ago(10)),
  INSULATION.row, MANURE.row, COAL.row
];
const DETAILS = [INSULATION.details, MANURE.details, COAL.details];
const NEWEST = [COAL.row.id, MANURE.row.id, INSULATION.row.id, TREES, RIVER, RIDE];
/* pins exist only where the owner placed a mission; the free ride and the catalog missions can be done anywhere and have none */
const PINS = [
  { mission_id: RIVER, title: 'Clean up the Mill River', description: 'Bag a block of shoreline with your neighbours.', action_path: 'show_up', region_key: 'US-CT', region_label: 'Connecticut', latitude: 41.6, longitude: -72.7 },
  { mission_id: TREES, title: 'Plant a street tree', description: 'Join a planting crew and plant one tree.', action_path: 'show_up', region_key: 'BR-SP', region_label: 'São Paulo', latitude: -23.5, longitude: -46.6 }
];
/* the United States' missions: pinned there (the river) or pinned nowhere; never the tree pinned in Brazil */
const US_MISSIONS = NEWEST.filter((id) => id !== TREES);
/* the missions pinned nowhere: every country's (France has no pin and no story today) */
const ANYWHERE = NEWEST.filter((id) => id !== TREES && id !== RIVER);
const PEER = { m_uid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mccluster_id: 'fixture.ana', display_name: 'Fixture Ana' };
const ME = { m_uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', mccluster_id: 'fixture.owner', display_name: 'Fixture Owner' };
const BODIES = [1, 2, 3, 4].map((k) => `Field note ${k}: what we did, what is next, and who can help.`)
  .concat('Field note 5: we cleaned two blocks of the Mill River today and logged every bag. Saturday we start at nine by the dam.');
const POSTS = BODIES.map((body, k) => ({ item_type: 'post', post_id: `dddddddd-dddd-4ddd-8ddd-00000000000${k + 1}`, occurred_at: new Date(Date.now() - (k + 1) * 3600e3).toISOString(), actor: PEER,
  post: { id: `dddddddd-dddd-4ddd-8ddd-00000000000${k + 1}`, body, visibility: 'public', created_at: new Date(Date.now() - (k + 1) * 3600e3).toISOString(), like_count: k, liked_by_me: false, media_locked: 0 } }));
/* the World's news, as the Worker serves its GDELT ingest: two stories each mentioning the United States, Brazil and Kenya */
const NEWS = [['US', 'Hartford, Connecticut, United States', 41.76, -72.68], ['BR', 'Sao Paulo, Sao Paulo, Brazil', -23.55, -46.63], ['KE', 'Nairobi, Nairobi Area, Kenya', -1.28, 36.82],
  ['US', 'Denver, Colorado, United States', 39.74, -104.99], ['KE', 'Mombasa, Coast, Kenya', -4.05, 39.67], ['BR', 'Recife, Pernambuco, Brazil', -8.05, -34.9]]
  .map(([country, place, lat, lon], k) => ({ id: `ffffffff-ffff-4fff-8fff-00000000000${k + 1}`, title: `World story ${k + 1}: councils weigh a budget for public transit`, url: `https://news${k % 2}.example/story/${k + 1}`, domain: `news${k % 2}.example`, seen_at: new Date(Date.now() - (k + 1) * 900e3).toISOString(), place, lat, lon, country }));
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

/* a browser context with the fake backends.
   owner: a signed-in member the server calls the house owner, remembered on this browser; member: a signed-in member who is not.
   details: 'absent' answers the details read as production does until its pending SQL is applied (404 PGRST205);
   environment: 'unavailable' answers as production does until the owner releases the module (503). Those two are the only
   deliberate absences; every console error and 4xx is recorded, and a scenario allows only the ones it names. */
/* missions / detailRows: the rows the fake database holds; missionsDelay: ms before the list read answers; missionsStatus: the
   list read's status, or a list of statuses answering one read each (the last one again); joinAnswer: 'ok', 'denied' (400 with a
   message) or 'malformed' (200 with no assignment), never named join, which is node:path's inside open(); joinDelay: ms before the join answers. */
async function open(device, path, { owner = false, member = false, details = 'present', environment = 'available', missions = MISSIONS, detailRows = DETAILS, missionsDelay = 0, missionsStatus = 200, joinAnswer = 'ok', joinDelay = 0 } = {}) {
  const signedIn = owner || member, missionsStatuses = Array.isArray(missionsStatus) ? missionsStatus.slice() : [missionsStatus];
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: device.viewport, deviceScaleFactor: 1, isMobile: device.mobile, hasTouch: device.mobile });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await ctx.addInitScript(({ who, house }) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
    localStorage.setItem('mnet_tour_seen', '1');
    window.__xss = 0;
    if (who) {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: who })).replace(/=+$/, '') + '.y', refresh_token: 'fixture', expires_at: exp }));
      /* the server's yes from an earlier visit (js/world-owner-modes.js), so this visit opens with Travel at once */
      if (house) localStorage.setItem('mcc_world_owner', JSON.stringify({ sub: who, at: new Date().toISOString() }));
    }
  }, { who: signedIn ? ME.m_uid : null, house: owner });
  const world = { requests: [], rpc: [], calls: [], details: 0, missionsList: 0, missionsAnswered: 0, dialogs: [], bad: [], console: [] };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }, body: JSON.stringify(body) });
  await ctx.route('https://api.mccluster.org/**', (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, auth = req.headers().authorization || '';
    world.requests.push({ m: req.method(), p, auth: !!auth });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (p === '/v1/status') return owner && auth ? json(route, { ok: true }) : json(route, { error: 'Forbidden' }, 403);
    if (p === '/v1/mnet/public-feed') return json(route, { items: POSTS, scope: 'public', next_before: null });
    if (p === '/v1/mnet/feed') return json(route, { items: POSTS, next_before: null });
    if (p === '/v1/mnet/bootstrap') return json(route, { identity: { m_uid: ME.m_uid, mccluster_id: ME.mccluster_id }, profile: { display_name: ME.display_name, mccluster_id: ME.mccluster_id }, next_step: null, tour_done_at: new Date().toISOString() });
    if (p === '/v1/world/news') {
      const c = u.searchParams.get('country');
      return json(route, { ok: true, items: c ? NEWS.filter((n) => n.country === c) : NEWS, next_before: null, attribution: { name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' } });
    }
    if (p === '/v1/world/place-scope') return json(route, { ok: true, enabled: false, country: null });
    if (p === '/v1/world/news-heat') {
      const c = u.searchParams.get('country');
      return c ? json(route, { ok: true, window_hours: 24, cell_degrees: 0.05, country: c, cells: [], total: 0, capped: false })
        : json(route, { ok: true, window_hours: 24, countries: { US: 2, BR: 2, KE: 2 }, total: 6, capped: false, posts: { US: 1 } });
    }
    /* members by the place of their latest signed-in visit: anyone but the house owner sees the countries of five or more */
    if (p === '/v1/world/members') return json(route, { ok: true, basis: 'accounts_by_latest_signed_in_ip_place', window_days: 400, exact: false, k: 5, countries: { US: 13 } });
    if (p === '/v1/world/access') return json(route, { release: { version: 'globe-admin-preview/v1', admin_preview: false }, level: 'public', unlocked_layers: [], locked_layers: [], layers: {} });
    if (p === '/v1/world/environment') return environment === 'unavailable' ? json(route, { error: 'module_policy_unavailable' }, 503) : json(route, ENVIRONMENT);
    return json(route, {});
  });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, rpc = (p.match(/\/rest\/v1\/rpc\/([a-z_]+)$/) || [])[1];
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (rpc) { world.rpc.push(rpc); let body = null; try { body = req.postDataJSON(); } catch (_) {} world.calls.push({ rpc, body }); }
    if (p === '/auth/v1/user') return signedIn ? json(route, { id: ME.m_uid, email: 'member@example.invalid' }) : json(route, { msg: 'no session' }, 401);
    if (p === '/auth/v1/settings') return json(route, { external: { email: true } });
    if (p === '/rest/v1/action_missions') {
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      if (!id) {
        /* the list read: counted, and slowed or failed as a scenario asks */
        world.missionsList++;
        const status = missionsStatuses.length > 1 ? missionsStatuses.shift() : missionsStatuses[0];
        if (missionsDelay) await new Promise((r) => setTimeout(r, missionsDelay));
        world.missionsAnswered++;
        if (status !== 200) return json(route, { message: 'fixture failure' }, status);
      }
      return json(route, id ? missions.filter((m) => m.id === id) : missions);
    }
    /* the pending details table (supabase/pending/20261117100100_action_mission_details.sql): rows by mission_id=in.(…) */
    if (p === '/rest/v1/action_mission_details') {
      world.details++;
      if (details === 'absent') return json(route, { code: 'PGRST205', details: null, hint: null, message: 'Could not find the table \'public.action_mission_details\' in the schema cache' }, 404);
      const ids = ((u.searchParams.get('mission_id') || '').match(/^in\.\((.*)\)$/) || [null, ''])[1].split(',');
      return json(route, detailRows.filter((d) => ids.includes(d.mission_id)));
    }
    if (p === '/rest/v1/action_mission_assignments') return json(route, []);
    if (rpc === 'action_globe_public_region_missions') return json(route, PINS);
    if (rpc === 'action_record') return json(route, { verified_actions: 0, points: 0, in_progress: 0, missions: [], skills: [], cohorts: [] });
    if (rpc === 'join_action_mission') {
      if (joinDelay) await new Promise((r) => setTimeout(r, joinDelay));
      if (joinAnswer === 'denied') return json(route, { code: 'P0001', message: 'This mission is full.' }, 400);
      if (joinAnswer === 'malformed') return json(route, {});
      return json(route, { assignment_id: '7a5e0000-0000-4000-8000-000000000001', status: 'in_progress' });
    }
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
  page.on('dialog', (d) => { world.dialogs.push(d.type() + ':' + d.message().slice(0, 80)); d.dismiss().catch(() => {}); });
  page.on('console', (m) => {
    if (/TypeError|ReferenceError|SyntaxError/.test(m.text())) errors.push(m.text().slice(0, 300));
    if (m.type() === 'error') world.console.push({ text: m.text().slice(0, 300), url: (m.location() && m.location().url) || '' });
  });
  page.on('response', (r) => { if (r.status() >= 400) world.bad.push({ status: r.status(), url: r.url().slice(0, 200) }); });
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
/* THE ROW IN THE OWNER'S ORDER, AND NOTHING ABOVE IT (owner, 2026-11-18: "There should be no tabs from news feed to E equals up.
   It should just be local, equity up, global, live news people."). What a signed-out visitor can read and press: the words are the
   page's and the globe frame's rendered text (innerText) and the names of everything rendered (aria-label, title, alt); "above
   the row" is every control the feed column renders before the row, and a mode button anywhere. The chosen tab is in the row's
   visible box, its ground differs from an unchosen tab's, and its words or mark read on it. */
const ROW = ['Local', 'Equity Uprise', 'Global', 'Live', 'News', 'People'];
const ROW_KEYS = ['local', 'equity', 'global', 'live', 'news', 'discover'];
const guestView = (page) => page.evaluate(async () => {
  /* a tab just chosen eases into its colours (css/style.css: buttons take .22s): read them once the row has settled */
  await Promise.all(document.getElementById('mnFeedScope').getAnimations({ subtree: true }).map((t) => t.finished.catch(() => {})));
  const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const frame = document.getElementById('mnWorldFrame'), inner = frame && frame.contentDocument;
  const docs = [document].concat(inner && inner.body ? [inner] : []);
  const words = docs.map((d) => d.body.innerText).join('\n') + '\n' + docs.flatMap((d) => [...d.querySelectorAll('[aria-label],[title],img[alt]')].filter(shown)
    .map((el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('alt')].filter(Boolean).join(' '))).join('\n');
  const row = document.getElementById('mnFeedScope'), feed = document.getElementById('mnWorldFeed');
  const above = [...feed.querySelectorAll('button, a[href], [role="tab"], input, select, textarea')]
    .filter((el) => shown(el) && !row.contains(el) && (row.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING)).map((el) => el.id || el.className || el.tagName);
  const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const lum = (a) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(a[0]) + 0.7152 * f(a[1]) + 0.0722 * f(a[2]); };
  const ratio = (x, y) => { const a = lum(rgb(x)), b = lum(rgb(y)); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
  const sr = row.getBoundingClientRect(), on = row.querySelector('[aria-pressed="true"]'), off = row.querySelector('[data-feed-scope][aria-pressed="false"]');
  const br = on && on.getBoundingClientRect(), ground = on && getComputedStyle(on).backgroundColor, ink = on && getComputedStyle(on).color;
  return {
    modeBar: [...document.querySelectorAll('.wt-world-modes, .wt-world-modes *, body [data-world-mode]')].some(shown),
    newsFeed: /news\s*feed/i.test(words), eup: /E\s*=\s*UP/i.test(words), above,
    buttons: [...row.querySelectorAll(':scope > button')].map((b) => { const r = b.getBoundingClientRect(); return { key: b.dataset.feedScope || b.dataset.mnView, name: b.getAttribute('aria-label') || b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), w: Math.round(r.width), h: Math.round(r.height) }; }),
    chosen: on ? { key: on.dataset.feedScope, inView: br.left >= sr.left - 1 && br.right <= sr.right + 1 && br.top >= 0 && br.bottom <= window.innerHeight, ground, unchosen: off && getComputedStyle(off).backgroundColor,
      ink, ratio: on.querySelector('img') ? null : ratio(ink, ground), mark: [...on.querySelectorAll('img')].filter(shown).map((i) => i.getAttribute('src')) } : null,
    row: { sw: row.scrollWidth, cw: row.clientWidth, overflowX: getComputedStyle(row).overflowX },
    page: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }
  };
});
/* the globe frame loaded and settled, so its own words are on screen before they are read */
async function globeReady(page) {
  await page.waitForFunction(() => { const f = document.getElementById('mnWorldFrame'); try { return !!f && /action-globe\.html/.test(f.contentWindow.location.href) && f.contentDocument.readyState === 'complete'; } catch (_) { return false; } }, null, { timeout: 30000 }).catch(() => {});
  const globe = globeOf(page);
  if (globe) await globe.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 25000 }).catch(() => {});
}
/* the arrow keys, Home and End walk the row: the name of the button in focus after each key */
async function walkRow(page) {
  await page.focus('#mnFeedScope > button:first-child');
  const at = () => page.evaluate(() => { const b = document.activeElement; return b && b.closest('#mnFeedScope') ? (b.getAttribute('aria-label') || b.textContent.trim()) : null; });
  const right = [await at()];
  for (let k = 1; k < 7; k++) { await page.keyboard.press('ArrowRight'); right.push(await at()); }
  await page.keyboard.press('ArrowLeft'); const left = await at();
  await page.keyboard.press('End'); const end = await at();
  await page.keyboard.press('Home'); const home = await at();
  return { right, left, end, home };
}
/* the row as the owner asked for it, at this size and in this phase */
function checkRow(scope, view, chosen) {
  check(scope, 'the row reads Local, the Equity Uprise tab, Global, Live, News, People, in that order, and nothing else', JSON.stringify(view.buttons.map((b) => b.name)) === JSON.stringify(ROW)
    && JSON.stringify(view.buttons.map((b) => b.key)) === JSON.stringify(ROW_KEYS) && !view.buttons.some((b) => /everything/i.test(b.name)), view.buttons);
  check(scope, `one tab is chosen, ${chosen}, in view in the row and marked: its own ground, its words or mark legible on it`, view.chosen && view.chosen.key === chosen && view.buttons.filter((b) => b.pressed === 'true').length === 1
    && view.chosen.inView && view.chosen.ground !== view.chosen.unchosen && (view.chosen.ratio === null ? view.chosen.mark.length === 1 : view.chosen.ratio >= 4.5), view.chosen);
  check(scope, 'every tab in the row is a tap target of 44px or more', view.buttons.every((b) => b.w >= 44 && b.h >= 44), view.buttons.map((b) => [b.name, b.w, b.h]));
  check(scope, 'a visitor sees nothing above the row: no mode bar, no control before it in the feed, no "News feed" and no "E=UP" written anywhere on the page or the globe',
    !view.modeBar && view.above.length === 0 && !view.newsFeed && !view.eup, { modeBar: view.modeBar, above: view.above, newsFeed: view.newsFeed, eup: view.eup });
  check(scope, 'the row fits or scrolls inside itself; the page never scrolls sideways', (view.row.sw <= view.row.cw || ['auto', 'scroll'].includes(view.row.overflowX)) && view.page.sw === view.page.cw, { row: view.row, page: view.page });
}
/* the feed in order: a member post (p), a news card (n), a mission post (m:<id>) */
const feedSeq = (page) => page.evaluate(() => [...document.querySelectorAll('#mnFeed > article')].map((a) => a.hasAttribute('data-mission-post') ? 'm:' + a.getAttribute('data-mission-post') : a.hasAttribute('data-news-id') ? 'n' : a.hasAttribute('data-post-id') ? 'p' : '?'));
/* the rule, written out again from the brief: one mission after every three other items; when the others run out, the rest
   carry on until the list holds a page of 20; each mission once, newest first */
function expectedSeq(others, missions) {
  const out = []; let at = 0;
  others.forEach((o, k) => { out.push(o); if ((k + 1) % 3 === 0 && at < missions.length) out.push('m:' + missions[at++]); });
  while (at < missions.length && out.length < 20) out.push('m:' + missions[at++]);
  return out;
}
/* what is on screen for the joins: the mark each shows */
const joinMarks = (page) => page.evaluate(() => [...document.querySelectorAll('#mnFeed [data-mission-join]')].map((b) => ({ name: b.getAttribute('aria-label'), words: b.textContent.trim(),
  shown: [...b.querySelectorAll('img')].filter((i) => i.getClientRects().length).map((i) => { const r = i.getBoundingClientRect(); return { src: i.getAttribute('src'), w: Math.round(r.width), h: Math.round(r.height) }; }) })));
/* every console error and every 4xx, except the ones a scenario names as deliberate fixture absences */
function noise(world, allow = []) {
  const ok = (url) => allow.some((re) => re.test(url));
  return { console: world.console.filter((c) => !(/^Failed to load resource/.test(c.text) && ok(c.url))), bad: world.bad.filter((b) => !ok(b.url)) };
}
/* pick a country with the globe's own tap (js/world-countries.js: its camera and tap hooks, the same path a finger takes) */
async function pickCountry(page, lon, lat) {
  const globe = globeOf(page);
  await globe.waitForFunction(() => window.__huCountries && window.__huCountries().ready && window.__huCountriesCam, null, { timeout: 60000 });
  await globe.evaluate(([x, y]) => window.__huCountriesCam.view(x, y, 9.5e6), [lon, lat]);
  await page.waitForTimeout(1200);
  const at = await globe.evaluate(([x, y]) => window.__huCountriesCam.screen(x, y), [lon, lat]);
  await globe.evaluate(({ x, y }) => window.__huCountriesCam.tap(x, y, performance.now()), at);
}

try {
  for (const device of VIEWPORTS) {
    /* ---------- a guest on the World: Global, then the Equity Uprise tab ---------- */
    {
      const scope = `guest-${device.name}`;
      /* by night (js/daylight.js follows the real Sun; ?daylight=night pins the phase for this run) */
      const { ctx, page, world, errors } = await open(device, '/mnet.html?view=feed&daylight=night');
      try {
        await page.waitForSelector('#mnFeed [data-post-id]', { timeout: 30000 });
        const shell = await page.evaluate(() => ({ travelOff: document.documentElement.classList.contains('hu-travel-off'), guest: document.documentElement.classList.contains('mn-guest'),
          bar: !!document.querySelector('.wt-world-modes') && document.querySelector('.wt-world-modes').getClientRects().length > 0, mode: window.MCC_WORLD_MODE.get(), scope: window.MCC_FEED_SCOPE.get(),
          frame: document.getElementById('mnWorldFrame').getAttribute('src'), expand: document.querySelector('.mn__world-expand').getAttribute('href') }));
        check(scope, 'a guest sees no centre mode bar: the feed is the one mode, Global is chosen', shell.travelOff && shell.guest && !shell.bar && shell.mode === 'posts' && shell.scope === 'global', shell);
        /* the owner's row (2026-11-18), once the globe frame has drawn its own words too */
        await globeReady(page);
        checkRow(scope, await guestView(page), 'global');
        const walk = await walkRow(page);
        check(scope, 'the arrow keys walk the row in the owner\'s order and wrap; Home and End reach its ends', JSON.stringify(walk.right) === JSON.stringify([...ROW, ROW[0]]) && walk.left === ROW[5] && walk.end === ROW[5] && walk.home === ROW[0], walk);
        const row = await strip(page);
        const eup = row.find((b) => b.key === 'equity');
        check(scope, 'the Equity Uprise tab is the supplied white mark alone by night, square-scaled, no words, named for assistive technology', eup.words === '' && eup.name === 'Equity Uprise' && eup.marks.length === 1
          && eup.marks[0].src === 'assets/img/equity-uprise-mark-white.png' && eup.marks[0].alt === '' && eup.marks[0].w === eup.marks[0].h && eup.marks[0].w >= 24 && eup.marks[0].w <= 44, eup);
        check(scope, 'the globe frame and the expanded globe ask for the missions (no missions=0)', !/missions=0/.test(shell.frame) && !/missions=0/.test(shell.expand), shell);
        const globe = globeOf(page);
        await globe.waitForFunction(() => typeof window.__huMissionPins === 'function' && window.__huMissionPins() > 0, null, { timeout: 60000 }).catch(() => {});
        check(scope, 'the Earth carries the published mission pins for a guest, and only those', await globe.evaluate((n) => window.__huMissionPins() === n && !document.documentElement.classList.contains('globe-no-missions'), PINS.length));
        await globe.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 25000 }).catch(() => {});

        /* GLOBAL: posts, news and missions in one stream (the five posts and six stories interleave one for one, then
           the stories carry on; one mission after every three of those, newest first, then the rest up to the page) */
        const others = ['p', 'n', 'p', 'n', 'p', 'n', 'p', 'n', 'p', 'n', 'n'];
        await page.waitForFunction((n) => document.querySelectorAll('#mnFeed > article').length === n, expectedSeq(others, NEWEST).length, { timeout: 30000 }).catch(() => {});
        const seq = await feedSeq(page);
        check(scope, 'Global keeps posts and news as they were, one for one', seq.filter((x) => !x.startsWith('m:')).join('') === others.join(''), seq);
        check(scope, 'Global puts one mission after every three other items, newest first, each once, then the rest up to the page', JSON.stringify(seq) === JSON.stringify(expectedSeq(others, NEWEST))
          && new Set(seq.filter((x) => x.startsWith('m:'))).size === MISSIONS.length, { seq, expected: expectedSeq(others, NEWEST) });
        const sizes = await page.evaluate(() => ({ posts: [...document.querySelectorAll('#mnFeed article[data-post-id]')].map((a) => Math.round(a.getBoundingClientRect().height)),
          missions: [...document.querySelectorAll('#mnFeed article[data-mission-post]')].map((a) => Math.round(a.getBoundingClientRect().height)),
          cards: [...document.querySelectorAll('#mnFeed article[data-mission-post]')].every((a) => a.classList.contains('mn__post-card') && !a.hasAttribute('data-post-id')) }));
        const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
        const heights = { ...sizes, medianPost: median(sizes.posts), medianMission: median(sizes.missions) };
        console.log(`[${scope}] card heights in px`, JSON.stringify(heights));
        /* the size of a post (owner: "just the same size post as all the other posts"): every mission post, sourced or not, lies within the
           ordinary posts' own range of heights, its title line and two-line description included (the tallest post, plus 8px of rounding) */
        check(scope, 'a mission post is a post\'s card, and none is taller than the tallest ordinary post', sizes.cards && sizes.missions.length === MISSIONS.length && Math.max(...sizes.missions) <= Math.max(...sizes.posts) + 8, heights);
        /* the words of a post: kind and field where the author is, difficulty and points where the handle is, with the source line beside
           them; the brand never written out */
        const post = await page.evaluate((id) => { const a = document.querySelector(`#mnFeed [data-mission-post="${id}"]`); return { head: a.querySelector('.mn__author-name').textContent, meta: a.querySelector('.mn__author-sub').textContent,
          title: a.querySelector('.mn__mission-post-title').textContent, clamp: getComputedStyle(a.querySelector('.mn__post-body')).webkitLineClamp, source: (a.querySelector('[data-mission-credit]') || {}).textContent || '', text: a.textContent,
          inHead: !!a.querySelector('.mn__author-sub [data-mission-credit]'), actions: [...a.querySelectorAll('.mn__post-actions > button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()) }; }, INSULATION.row.id);
        check(scope, 'a mission post reads kind and field, difficulty and points with its source line beside them, title, the description clamped, and Join, Details, Share', post.head === 'Civic mission · Research' && post.meta === 'Difficulty 2 · 100 points · Source: Project Drawdown · CC BY 4.0'
          && post.inHead && post.title === INSULATION.row.title && post.clamp === '2' && post.source === 'Source: Project Drawdown · CC BY 4.0' && JSON.stringify(post.actions) === JSON.stringify(['Join this mission', 'Details', 'Share this mission']) && !/equity uprise/i.test(post.text), post);
        check(scope, 'a mission with no details carries no source line', await page.evaluate((id) => !document.querySelector(`#mnFeed [data-mission-post="${id}"] [data-mission-credit]`), RIDE));
        const joins = await joinMarks(page);
        check(scope, 'by night each Join is the supplied white mark alone, square, no words, named "Join this mission"', joins.length === MISSIONS.length && joins.every((j) => j.name === 'Join this mission' && j.words === '' && j.shown.length === 1
          && j.shown[0].src === 'assets/img/equity-uprise-mark-white.png' && j.shown[0].w === j.shown[0].h && j.shown[0].w >= 24), joins[0]);
        let size = await fits(page);
        check(scope, 'nothing scrolls sideways on Global', size.sw === size.cw, size);
        await page.evaluate(() => { const f = document.getElementById('mnWorldFeed'), a = document.querySelector('#mnFeed [data-mission-post]'); if (f && a) f.scrollTop += a.getBoundingClientRect().top - f.getBoundingClientRect().top - 160; });
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(OUT, `guest-global-${device.name}.png`) });
        /* Share copies the mission's own link on this origin */
        await page.click(`#mnFeed [data-mission-post="${COAL.row.id}"] [data-mission-share]`);
        await page.waitForFunction((id) => /Copied/.test(document.querySelector(`#mnFeed [data-mission-post="${id}"] [data-mission-share]`).textContent), COAL.row.id, { timeout: 5000 }).catch(() => {});
        const copied = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => 'unreadable: ' + e.message);
        check(scope, 'Share copies the mission\'s link on this origin', copied === `${BASE}/mnet.html?mission=${COAL.row.id}`, copied);

        /* the source line opens the dialog at its credit: the quotation with its credit beneath, the credit in full with its links */
        await page.click(`#mnFeed [data-mission-post="${INSULATION.row.id}"] [data-mission-credit]`);
        await page.waitForSelector('#mnMissionDialog[open] #mnMissionCredit', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(400);
        const credit = await page.evaluate(() => {
          const d = document.getElementById('mnMissionDialog'), c = document.getElementById('mnMissionCredit'), fig = d.querySelector('#mnMissionDetail .mn__mission-about');
          if (!d.open || !c) return { open: d.open, credit: !!c };
          const dr = d.getBoundingClientRect(), cr = c.getBoundingClientRect(), q = fig && fig.querySelector('blockquote'), under = q && q.nextElementSibling;
          return { open: true, title: document.getElementById('mnMissionTitle').textContent, focused: document.activeElement === c, inView: cr.top >= dr.top && cr.top < dr.bottom - 20,
            quote: q && q.textContent, under: under && under.tagName === 'FIGCAPTION' ? under.textContent : null, words: c.querySelector('p:not(.mn__eyebrow)').textContent,
            links: [...c.querySelectorAll('a')].map((a) => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel })), notes: [...d.querySelectorAll('.mn__mission-note')].map((n) => n.textContent),
            join: !document.getElementById('mnMissionJoin').hidden, dialogFits: d.scrollWidth <= d.clientWidth };
        });
        check(scope, 'the source line opens the mission\'s dialog at its credit', credit.open && credit.title === INSULATION.row.title && credit.focused && credit.inView, credit);
        check(scope, 'the dialog shows the quotation with its credit directly beneath it, the proof hint and the safety line', credit.quote === INSULATION.about && credit.under === INSULATION.aboutCredit
          && JSON.stringify(credit.notes) === JSON.stringify(['Proof: ' + INSULATION.details.proof_hint, 'Safety: ' + INSULATION.details.safety_note]), credit);
        check(scope, 'the dialog shows the credit line in full, each address in it a link that opens apart from the World, and Join', credit.words === INSULATION.details.credit_line
          && JSON.stringify(credit.links.map((l) => l.href)) === JSON.stringify([INSULATION.details.source_url, INSULATION.details.doi, INSULATION.details.license_url])
          && credit.links.every((l) => l.target === '_blank' && /noopener/.test(l.rel) && /noreferrer/.test(l.rel)) && credit.join && credit.dialogFits, credit);
        size = await fits(page);
        check(scope, 'the open dialog pushes nothing sideways', size.sw === size.cw, size);
        await page.screenshot({ path: join(OUT, `guest-dialog-credit-${device.name}.png`) });
        await page.click('#mnMissionClose');

        /* the arrow keys walk the row: the Equity Uprise tab is next after Local */
        await page.focus('#mnFeedScope [data-feed-scope="local"]');
        await page.keyboard.press('ArrowRight');
        check(scope, 'the row is reachable by keyboard and the arrow key after Local is the Equity Uprise tab', await page.evaluate(() => document.activeElement && document.activeElement.dataset.feedScope === 'equity'));
        /* the Equity Uprise tab: the mission posts, with Environmental Justice above them */
        await page.keyboard.press('Enter');
        await page.waitForSelector('#wePanel:not([hidden])', { timeout: 15000 }).catch(() => {});
        await page.waitForSelector('#mnFeed [data-mission-post]', { timeout: 15000 }).catch(() => {});
        await page.waitForFunction(() => document.documentElement.getAttribute('data-we-feed') === 'ready', null, { timeout: 15000 }).catch(() => {});
        checkRow(scope, await guestView(page), 'equity');
        /* since slice G1 the tab also lists the environmental observations, by time with the missions (the brief's targets 4 and 13):
           this fixture's one official report is one observation post */
        await page.waitForSelector('#mnFeed [data-observation-post]', { timeout: 15000 }).catch(() => {});
        const tab = await page.evaluate(() => {
          const panel = document.getElementById('wePanel'), feed = document.getElementById('mnFeed'), row = document.getElementById('mnFeedScope');
          return { scope: window.MCC_FEED_SCOPE.get(), pressed: document.querySelector('#mnFeedScope [data-feed-scope="equity"]').getAttribute('aria-pressed'),
            others: [...document.querySelectorAll('#mnFeedScope [aria-pressed="true"]')].map((b) => b.dataset.feedScope),
            panel: !panel.hidden && panel.getClientRects().length > 0, heading: (document.getElementById('weTitle') || {}).textContent || '',
            above: !!(row.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(panel.compareDocumentPosition(feed) & Node.DOCUMENT_POSITION_FOLLOWING),
            missions: feed.querySelectorAll('[data-mission-post]').length, observations: feed.querySelectorAll('[data-observation-post]').length, articles: feed.querySelectorAll('article').length, posts: feed.querySelectorAll('[data-post-id]').length, news: feed.querySelectorAll('[data-news-id]').length,
            order: [...feed.querySelectorAll('[data-mission-post]')].map((a) => a.getAttribute('data-mission-post')),
            note: getComputedStyle(document.getElementById('weUnavailable')).display,
            composer: document.getElementById('mnComposer').getClientRects().length > 0, guestCard: document.getElementById('mnGuestCard').getClientRects().length > 0, mode: window.MCC_WORLD_MODE.get() };
        });
        check(scope, 'the Equity Uprise tab shows the mission posts, newest first, and the environmental observation posts, nothing else (no member posts or news), with the Environmental Justice panel above them', tab.scope === 'equity' && tab.pressed === 'true' && JSON.stringify(tab.others) === '["equity"]'
          && tab.panel && /See the evidence/.test(tab.heading) && tab.above && tab.missions === MISSIONS.length && tab.observations === ENVIRONMENT.events.length && tab.articles === MISSIONS.length + tab.observations && JSON.stringify(tab.order) === JSON.stringify(NEWEST)
          && tab.posts === 0 && tab.news === 0 && tab.note === 'none' && !tab.composer && !tab.guestCard && tab.mode === 'posts', tab);
        await page.waitForFunction(() => /Fixture government observation/.test(document.getElementById('wePanel').textContent), null, { timeout: 15000 }).catch(() => {});
        check(scope, 'the panel lists the official report on the same globe', await page.evaluate(() => /Fixture government observation/.test(document.getElementById('wePanel').textContent)));
        size = await fits(page);
        check(scope, 'nothing scrolls sideways on the Equity Uprise tab', size.sw === size.cw, size);
        await page.evaluate(() => { const f = document.getElementById('mnWorldFeed'), a = document.querySelector('#mnFeed [data-mission-post]'); if (f && a) f.scrollTop += a.getBoundingClientRect().top - f.getBoundingClientRect().top - 120; });
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(OUT, `guest-equity-${device.name}.png`) });
        /* leaving the tab is the whole feed again */
        await page.click('#mnFeedScope [data-feed-scope="global"]');
        check(scope, 'leaving the tab returns to Global: posts back, the panel gone', await page.evaluate(() => window.MCC_FEED_SCOPE.get() === 'global' && document.getElementById('wePanel').hidden && document.querySelectorAll('#mnFeed [data-post-id]').length > 0));
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
          /* a drag released below the strip sends its click elsewhere; the next key on a tab must still choose it */
          await page.mouse.move(box.x + box.width - 30, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width - 90, box.y + box.height / 2, { steps: 6 });
          await page.mouse.move(box.x + box.width - 150, box.y + box.height + 160, { steps: 6 });
          await page.mouse.up();
          await page.focus('#mnFeedScope [data-feed-scope="equity"]');
          await page.keyboard.press('Enter');
          await page.waitForTimeout(300);
          const firstEnter = await page.evaluate(() => window.MCC_FEED_SCOPE.get());
          check(scope, 'after a drag released outside the strip, the first Enter on the Equity Uprise tab chooses it', firstEnter === 'equity', firstEnter);
          await page.click('#mnFeedScope [data-feed-scope="global"]');
          await page.waitForSelector('#mnFeed [data-post-id]', { timeout: 15000 }).catch(() => {});
        }

        /* A COUNTRY (owner, 2026-11-17: "when you click on America ... see X amount of news, X amount of missions"): the globe's own
           tap picks the United States; the card counts its news, its missions (pinned there or nowhere), its posts and members,
           in two rows; the feed turns to Local, which lists that country's news and missions, never Brazil's tree */
        await pickCountry(page, -98, 39);
        await page.waitForFunction(() => /United States/.test(document.getElementById('mnPlaceCard').textContent) && window.MCC_FEED_SCOPE.get() === 'local', null, { timeout: 20000 }).catch(() => {});
        await page.waitForFunction((n) => document.querySelectorAll('#mnFeed [data-mission-post]').length === n, US_MISSIONS.length, { timeout: 20000 }).catch(() => {});
        const card = await page.evaluate(() => {
          const c = document.getElementById('mnPlaceCard'), stats = [...c.querySelectorAll('.mn__place-stat')], cr = c.getBoundingClientRect();
          const clash = ['mnWorldStack', 'mnWorldLive'].map((id) => document.getElementById(id)).filter((el) => el && !el.hidden && el.getClientRects().length).some((el) => { const r = el.getBoundingClientRect(); return r.left < cr.right && r.right > cr.left && r.top < cr.bottom && r.bottom > cr.top; });
          return { shown: !c.hidden && c.getClientRects().length > 0, name: (c.querySelector('.mn__place-name b') || {}).textContent, cells: stats.map((s) => [s.querySelector('small').textContent, s.querySelector('b').textContent]),
            rows: [c.querySelector('.mn__place-head'), c.querySelector('.mn__place-stats')].filter(Boolean).length, oneRow: new Set(stats.map((s) => Math.round(s.getBoundingClientRect().top))).size === 1, clash };
        });
        check(scope, 'picking a country shows its counts: news, missions (pinned there or nowhere), posts and members, in two rows, clear of the globe\'s buttons', card.shown && card.name === 'United States'
          && JSON.stringify(card.cells) === JSON.stringify([['news · 24 h', '2'], ['missions', String(US_MISSIONS.length)], ['posts', '1'], ['members', '13']]) && card.rows === 2 && card.oneRow && !card.clash, card);
        const local = await feedSeq(page);
        check(scope, 'Local lists that country\'s news and missions, interleaved the same way, newest first, never a mission pinned elsewhere', await page.evaluate(() => window.MCC_FEED_SCOPE.get() === 'local')
          && JSON.stringify(local) === JSON.stringify(expectedSeq(['n', 'n'], US_MISSIONS)) && !local.includes('m:' + TREES), local);
        /* member posts join Local only once the country feed is on (WORLD_PLACE_SCOPE_ENABLED): the one the card counts is said, not shown */
        const localNote = await page.evaluate(() => (document.querySelector('#mnFeed > .mn__feed-note') || {}).textContent || '');
        check(scope, 'Local says plainly that the member post the card counts is not in Local yet', localNote === '1 member post placed in United States is not in Local yet.', localNote);
        check(scope, 'the strip shows the tab the feed turned to', await page.evaluate(() => { const s = document.getElementById('mnFeedScope'), b = s.querySelector('[aria-pressed="true"]'), sr = s.getBoundingClientRect(), br = b.getBoundingClientRect(); return b.dataset.feedScope === 'local' && br.left >= sr.left - 1 && br.right <= sr.right + 1; }));
        size = await fits(page);
        check(scope, 'nothing scrolls sideways with a country picked', size.sw === size.cw, size);
        /* the software renderer is busy with the globe: let the page's own frames catch up before the evidence is taken */
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await page.waitForTimeout(2500);
        await page.screenshot({ path: join(OUT, `guest-country-local-${device.name}.png`) });
        if (device.name === '390') {
          /* a country with no story today and no pin: its card says so, and Local lists the missions that can be done anywhere
             under one honest line, never an empty feed */
          await pickCountry(page, 2.3, 46.6);
          await page.waitForFunction(() => /France/.test(document.getElementById('mnPlaceCard').textContent), null, { timeout: 20000 }).catch(() => {});
          await page.waitForFunction((n) => document.querySelectorAll('#mnFeed [data-mission-post]').length === n, ANYWHERE.length, { timeout: 20000 }).catch(() => {});
          const fr = await page.evaluate(() => ({ cells: [...document.querySelectorAll('#mnPlaceCard .mn__place-stat')].map((s) => [s.querySelector('small').textContent, s.querySelector('b').textContent]),
            note: (document.querySelector('#mnFeed > .mn__feed-note') || {}).textContent || '', missions: [...document.querySelectorAll('#mnFeed [data-mission-post]')].map((a) => a.getAttribute('data-mission-post')),
            news: document.querySelectorAll('#mnFeed [data-news-id]').length }));
          check(scope, 'a country with no news and no pin: news 0, the missions that can be done anywhere, posts 0, members under five', JSON.stringify(fr.cells) === JSON.stringify([['news · 24 h', '0'], ['missions', String(ANYWHERE.length)], ['posts', '0'], ['members', '<5']]), fr);
          check(scope, 'and Local says plainly it has no news today, above those missions', fr.note === 'No news from France in the last 24 hours.' && fr.news === 0 && JSON.stringify(fr.missions) === JSON.stringify(ANYWHERE), fr);
        }

        check(scope, 'a guest sent no join and no session', !world.rpc.some((r) => /^join_action_mission/.test(r)) && world.requests.every((r) => !r.auth));
        check(scope, 'the details of the missions on screen were read once, in one request, for the whole visit', world.details === 1, world.details);
        const heard = noise(world);
        check(scope, 'zero console errors and no 4xx', heard.console.length === 0 && heard.bad.length === 0, heard);
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
          signin: !document.getElementById('mnSignedOut').hidden, mission: new URL(location.href).searchParams.get('mission'), credit: !!document.getElementById('mnMissionCredit') }));
        check(scope, 'a guest\'s ?mission= opens that mission\'s dialog over the World, with Join, the Equity Uprise tab under it', dialog.title === 'Give someone a free ride' && /Offer a ride/.test(dialog.detail) && dialog.join
          && dialog.joinText === 'Take this mission' && /Sign in to join this mission/.test(dialog.status) && dialog.scope === 'equity' && dialog.view && !dialog.signin && dialog.mission === RIDE, dialog);
        check(scope, 'a mission with no details has no credit section', !dialog.credit, dialog);
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
        const heard = noise(world);
        check(scope, 'zero console errors and no 4xx', heard.console.length === 0 && heard.bad.length === 0, heard);
        check(scope, 'no JavaScript errors', errors.length === 0, errors);
      } finally { await ctx.close(); }
    }
  }

  /* ---------- a guest's Join on a mission post: asked to sign in, the mission kept in the address, nothing sent ---------- */
  {
    const scope = 'guest-post-join-390';
    const { ctx, page, world, errors } = await open(VIEWPORTS[0], '/mnet.html?view=feed&daylight=night');
    try {
      await page.waitForSelector(`#mnFeed [data-mission-post="${MANURE.row.id}"] [data-mission-join]`, { timeout: 30000 });
      await page.click(`#mnFeed [data-mission-post="${MANURE.row.id}"] [data-mission-join]`);
      await page.waitForSelector('#mnSignedOut:not([hidden])', { timeout: 15000 }).catch(() => {});
      const asked = await page.evaluate(() => ({ why: document.getElementById('mnGuestWhy').textContent, mission: new URL(location.href).searchParams.get('mission') }));
      check(scope, 'a guest\'s Join on a post asks them to sign in for that mission and keeps it in the address, as the dialog\'s Join does', asked.why === 'Sign in to join this mission.' && asked.mission === MANURE.row.id, asked);
      check(scope, 'no join was sent for a guest', !world.rpc.some((r) => /^join_action_mission/.test(r)), world.rpc);
      const heard = noise(world);
      check(scope, 'zero console errors and no 4xx', heard.console.length === 0 && heard.bad.length === 0, heard);
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }

  /* ---------- a member's Join on a mission post: the dialog's own path, exactly one join_action_mission ---------- */
  {
    const scope = 'member-post-join-390';
    const { ctx, page, world, errors } = await open(VIEWPORTS[0], '/mnet.html?view=feed&daylight=night', { member: true });
    try {
      await page.waitForSelector(`#mnFeed [data-mission-post="${INSULATION.row.id}"] [data-mission-join]`, { timeout: 30000 });
      check(scope, 'a member\'s Global carries the mission posts too', await page.evaluate(() => !document.documentElement.classList.contains('mn-guest') && document.querySelectorAll('#mnFeed [data-mission-post]').length > 0));
      await page.click(`#mnFeed [data-mission-post="${INSULATION.row.id}"] [data-mission-join]`);
      await page.waitForFunction(() => document.getElementById('mnMissionDialog').open && /Mission started/.test(document.getElementById('mnMissionDialogStatus').textContent), null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);
      const joined = world.calls.filter((c) => /^join_action_mission/.test(c.rpc));
      const shown = await page.evaluate(() => ({ open: document.getElementById('mnMissionDialog').open, title: document.getElementById('mnMissionTitle').textContent, status: document.getElementById('mnMissionDialogStatus').textContent,
        proof: !document.getElementById('mnMissionProof').hidden, join: !document.getElementById('mnMissionJoin').hidden }));
      check(scope, 'a member\'s Join on a post opens the mission\'s dialog and sends exactly one join_action_mission, for that mission', joined.length === 1 && joined[0].rpc === 'join_action_mission' && joined[0].body && joined[0].body.p_mission_id === INSULATION.row.id
        && shown.open && shown.title === INSULATION.row.title && /Mission started/.test(shown.status) && shown.proof && !shown.join, { joined, shown });
      /* the house owner check answers 403 for anyone else (requireHouseOwner): the server's honest answer, not a defect */
      const heard = noise(world, [/api\.mccluster\.org\/v1\/status$/]);
      check(scope, 'zero console errors and no 4xx besides the house-owner check\'s 403', heard.console.length === 0 && heard.bad.length === 0, heard);
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }

  /* ---------- a member's Join on a post, the server's say: refused, answered without an assignment, and a second tap while the join is out ---------- */
  for (const [kind, opts, expect] of [
    ['denied', { member: true, joinAnswer: 'denied' }, { status: /This mission is full\./, join: true }],
    ['malformed', { member: true, joinAnswer: 'malformed' }, { status: /has not returned an active assignment/, join: true }],
    ['in-flight', { member: true, joinDelay: 1500 }, { status: /Mission started/, join: false }]
  ]) {
    const scope = `member-join-${kind}-390`;
    const { ctx, page, world, errors } = await open(VIEWPORTS[0], '/mnet.html?view=feed&daylight=night', opts);
    try {
      await page.waitForSelector(`#mnFeed [data-mission-post="${MANURE.row.id}"] [data-mission-join]`, { timeout: 30000 });
      await page.click(`#mnFeed [data-mission-post="${MANURE.row.id}"] [data-mission-join]`);
      if (kind === 'in-flight') {
        await page.waitForFunction(() => document.getElementById('mnMissionDialog').open && document.getElementById('mnMissionJoin').disabled, null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(700);
        /* the second tap, on the post's emblem behind the dialog, while the first join is still out */
        await page.evaluate((id) => document.querySelector(`#mnFeed [data-mission-post="${id}"] [data-mission-join]`).click(), MANURE.row.id);
      }
      await page.waitForFunction((re) => new RegExp(re).test(document.getElementById('mnMissionDialogStatus').textContent), expect.status.source, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(600);
      const shown = await page.evaluate(() => ({ open: document.getElementById('mnMissionDialog').open, title: document.getElementById('mnMissionTitle').textContent, status: document.getElementById('mnMissionDialogStatus').textContent,
        join: !document.getElementById('mnMissionJoin').hidden, enabled: !document.getElementById('mnMissionJoin').disabled, proof: !document.getElementById('mnMissionProof').hidden }));
      const joins = world.calls.filter((c) => /^join_action_mission/.test(c.rpc));
      check(scope, kind === 'in-flight' ? 'a second tap while the join is out sends no second join: one join_action_mission, and the mission starts once'
        : kind === 'denied' ? 'a join the server refuses is said in the dialog; Join stays and nothing is started' : 'a join answered without an assignment is no acceptance: said in the dialog, Join stays',
        joins.length === 1 && joins[0].body && joins[0].body.p_mission_id === MANURE.row.id && shown.open && shown.title === MANURE.row.title && expect.status.test(shown.status) && shown.join === expect.join && shown.enabled && shown.proof === !expect.join, { joins: joins.length, shown });
      const heard = noise(world, [/api\.mccluster\.org\/v1\/status$/, /\/rest\/v1\/rpc\/join_action_mission$/]);
      check(scope, 'zero console errors and no 4xx besides the house-owner check\'s 403 and the refused join', heard.console.length === 0 && heard.bad.length === 0, heard);
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }

  /* ---------- hostile rows: nothing a catalog editor writes runs on the World ---------- */
  {
    const scope = 'hostile-rows-390';
    const X1 = '0e1f0000-0000-4000-8000-0000000000a1';
    const hostile = { ...mission(X1, '<img src=x onerror="window.__xss=1">Title "quoted" & \'single\'', '<script>window.__xss=2</script><b>bold</b> description <img src=x onerror=window.__xss=3>', '<svg onload=alert(4)>', ago(0.5)),
      kind: '<img src=x onerror=window.__xss=5>', discovery_category: 'create"><img src=x onerror=window.__xss=6>', difficulty: '<b>3</b>', base_points: '"><img src=x onerror=window.__xss=7>', skills: ['<img src=x onerror=window.__xss=8>'] };
    const hostileDetails = { mission_id: X1, catalog: '<b>cat</b>', slug: 'x', proof_hint: '<img src=x onerror=window.__xss=9>proof', safety_note: '<script>window.__xss=10</script>safety',
      credit_line: 'Adapted from Evil<img src=x onerror=window.__xss=11> Org (https://ok.example/path"><img src=x onerror=window.__xss=12>), see javascript:window.__xss=13 and data:text/html,<script>window.__xss=14</script>.',
      about: '<img src=x onerror=window.__xss=15>quote', about_credit: '<a href="javascript:window.__xss=16">cred</a>', source_url: 'javascript:window.__xss=17', license_name: '<i>Lic</i>', license_url: 'https://creativecommons.org/licenses/by/4.0/', doi: 'javascript:window.__xss=18' };
    const { ctx, page, world, errors } = await open(VIEWPORTS[0], '/mnet.html?view=feed&daylight=night', { missions: [...MISSIONS, hostile], detailRows: [...DETAILS, hostileDetails] });
    try {
      await page.waitForSelector(`#mnFeed [data-mission-post="${X1}"] [data-mission-credit]`, { timeout: 30000 });
      const post = await page.evaluate((id) => { const a = document.querySelector(`#mnFeed [data-mission-post="${id}"]`); return { title: a.querySelector('.mn__mission-post-title').textContent, body: a.querySelector('.mn__post-body').textContent, head: a.querySelector('.mn__author-name').textContent,
        source: a.querySelector('[data-mission-credit]').textContent, imgs: [...a.querySelectorAll('img')].map((i) => i.getAttribute('src')), markup: a.querySelectorAll('script, svg[onload], [onerror], b, i').length, xss: window.__xss }; }, X1);
      check(scope, 'a hostile row is words on the post: title, description, field and source as written, no markup, nothing run', post.title === hostile.title && post.body === hostile.description && post.head === 'Mission · <svg onload=alert(4)>'
        && post.source === 'Source: Evil<img src=x onerror=window.__xss=11> Org · <i>Lic</i>' && post.imgs.length === 2 && post.imgs.every((s) => /^assets\/img\/equity-uprise-mark(-white)?\.png$/.test(s)) && post.markup === 0 && post.xss === 0, post);
      await page.click(`#mnFeed [data-mission-post="${X1}"] [data-mission-credit]`);
      await page.waitForSelector('#mnMissionDialog[open]', { timeout: 15000 });
      await page.waitForTimeout(500);
      /* the dialog's own chrome (the proof form, the Anti-Social section) is static markup; what the row wrote lands in the title and #mnMissionDetail */
      const dialog = await page.evaluate(() => { const d = document.getElementById('mnMissionDetail'); return { title: document.getElementById('mnMissionTitle').textContent, links: [...d.querySelectorAll('a')].map((a) => a.getAttribute('href')), markup: d.querySelectorAll('script, svg, img, [onerror], [onload], b:not(.mn__mission-note > b), i, u').length,
        notes: [...d.querySelectorAll('.mn__mission-note')].map((n) => n.textContent), quote: (d.querySelector('.mn__mission-about blockquote') || {}).textContent, xss: window.__xss }; });
      check(scope, 'and in the dialog: words only, the proof hint, the safety line and the quotation as written, and the only links are its http(s) addresses', dialog.title === hostile.title && dialog.links.length === 2 && dialog.links.every((h) => /^https?:\/\//.test(h)) && dialog.markup === 0 && dialog.xss === 0
        && JSON.stringify(dialog.notes) === JSON.stringify(['Proof: ' + hostileDetails.proof_hint, 'Safety: ' + hostileDetails.safety_note]) && dialog.quote === hostileDetails.about, dialog);
      check(scope, 'no browser dialog opened and nothing ran', world.dialogs.length === 0 && await page.evaluate(() => window.__xss === 0), world.dialogs);
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }

  /* ---------- the Equity Uprise tab with a country picked on the globe, and News with one ---------- */
  {
    const scope = 'guest-equity-country-390';
    const { ctx, page, world, errors } = await open(VIEWPORTS[0], '/mnet.html?view=feed&daylight=night');
    try {
      await page.waitForSelector('#mnFeed [data-mission-post]', { timeout: 30000 });
      await page.click('#mnFeedScope [data-feed-scope="equity"]');
      await page.waitForFunction(() => document.documentElement.getAttribute('data-we-feed') === 'ready', null, { timeout: 15000 }).catch(() => {});
      await pickCountry(page, -98, 39);
      await page.waitForFunction(() => /United States/.test(document.getElementById('mnPlaceCard').textContent), null, { timeout: 20000 }).catch(() => {});
      await page.waitForFunction((n) => document.querySelectorAll('#mnFeed [data-mission-post]').length === n, US_MISSIONS.length, { timeout: 20000 }).catch(() => {});
      const picked = await page.evaluate(() => ({ scope: window.MCC_FEED_SCOPE.get(), pressed: document.querySelector('#mnFeedScope [aria-pressed="true"]').dataset.feedScope, panel: !document.getElementById('wePanel').hidden && getComputedStyle(document.getElementById('wePanel')).display !== 'none',
        missions: [...document.querySelectorAll('#mnFeed [data-mission-post]')].map((a) => a.getAttribute('data-mission-post')), note: (document.querySelector('#mnFeed [data-mission-feed-place]') || {}).textContent || '',
        others: document.querySelectorAll('#mnFeed [data-post-id], #mnFeed [data-news-id]').length, card: /United States/.test(document.getElementById('mnPlaceCard').textContent) }));
      check(scope, 'a country tapped on the Equity Uprise tab keeps the tab and its panel, and narrows the list to the place\'s missions (pinned there or nowhere) under one line that says so', picked.scope === 'equity' && picked.pressed === 'equity' && picked.panel && picked.card
        && JSON.stringify(picked.missions) === JSON.stringify(US_MISSIONS) && picked.note === 'Missions in United States: the ones pinned there and the ones that can be done anywhere.' && picked.others === 0, picked);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(OUT, 'guest-equity-country-390.png') });
      await page.click('#mnPlaceCard .mn__place-close');
      await page.waitForFunction((n) => document.querySelectorAll('#mnFeed [data-mission-post]').length === n, MISSIONS.length, { timeout: 20000 }).catch(() => {});
      const back = await page.evaluate(() => ({ scope: window.MCC_FEED_SCOPE.get(), card: !document.getElementById('mnPlaceCard').hidden, missions: document.querySelectorAll('#mnFeed [data-mission-post]').length, note: !!document.querySelector('#mnFeed [data-mission-feed-place]'), panel: getComputedStyle(document.getElementById('wePanel')).display !== 'none' }));
      check(scope, 'letting the country go lists every mission again, still on the tab with its panel', back.scope === 'equity' && !back.card && back.missions === MISSIONS.length && !back.note && back.panel, back);
      /* News: a tap turns the feed to Local, and letting the country go comes back to News */
      await page.click('#mnFeedScope [data-feed-scope="news"]');
      await pickCountry(page, 2.3, 46.6);
      await page.waitForFunction(() => /France/.test(document.getElementById('mnPlaceCard').textContent) && window.MCC_FEED_SCOPE.get() === 'local', null, { timeout: 20000 }).catch(() => {});
      const fromNews = await page.evaluate(() => window.MCC_FEED_SCOPE.get());
      await page.click('#mnPlaceCard .mn__place-close');
      await page.waitForFunction(() => window.MCC_FEED_SCOPE.get() !== 'local', null, { timeout: 20000 }).catch(() => {});
      const backToNews = await page.evaluate(() => ({ scope: window.MCC_FEED_SCOPE.get(), pressed: document.querySelector('#mnFeedScope [aria-pressed="true"]').dataset.feedScope }));
      check(scope, 'from News a country turns the feed to Local, and letting it go returns to News, not to Global', fromNews === 'local' && backToNews.scope === 'news' && backToNews.pressed === 'news', { fromNews, backToNews });
      const heard = noise(world);
      check(scope, 'zero console errors and no 4xx', heard.console.length === 0 && heard.bad.length === 0, heard);
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }

  /* ---------- a slow missions read never holds back the posts and the news ---------- */
  {
    const scope = 'guest-slow-missions-390';
    const { ctx, page, world, errors } = await open(VIEWPORTS[0], '/mnet.html?view=feed&daylight=night', { missionsDelay: 3500 });
    try {
      await page.waitForSelector('#mnFeed [data-post-id]', { timeout: 30000 });
      const first = { seq: await feedSeq(page), answered: world.missionsAnswered };
      await page.waitForFunction((n) => document.querySelectorAll('#mnFeed [data-mission-post]').length === n, MISSIONS.length, { timeout: 20000 }).catch(() => {});
      const later = await feedSeq(page);
      check(scope, 'the posts and the news draw before a slow missions read answers, and the missions join the stream when it does', first.answered === 0 && first.seq.includes('p') && first.seq.includes('n') && !first.seq.some((x) => x.startsWith('m:'))
        && JSON.stringify(later) === JSON.stringify(expectedSeq(['p', 'n', 'p', 'n', 'p', 'n', 'p', 'n', 'p', 'n', 'n'], NEWEST)) && world.missionsList === 1, { first, later, reads: world.missionsList });
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }

  /* ---------- a missions read that fails: Global keeps its posts and news; the tab offers Try again and reads again when chosen again ---------- */
  {
    const scope = 'guest-failed-missions-390';
    const failures = [/\/rest\/v1\/action_missions\?/];
    /* the first three list reads fail: the feed's own, the one choosing the tab makes, and the one choosing it again makes; Try again's succeeds */
    const { ctx, page, world, errors } = await open(VIEWPORTS[0], '/mnet.html?view=feed&daylight=night', { missionsStatus: [500, 500, 500, 200] });
    try {
      await page.waitForSelector('#mnFeed [data-post-id]', { timeout: 30000 });
      await page.waitForTimeout(800);
      const seq = await feedSeq(page);
      check(scope, 'Global shows its posts and news without the missions', seq.includes('p') && seq.includes('n') && !seq.some((x) => x.startsWith('m:')) && world.missionsList === 1, { seq, reads: world.missionsList });
      await page.click('#mnFeedScope [data-feed-scope="equity"]');
      await page.waitForSelector('#mnFeed [data-mission-feed-error]', { timeout: 15000 }).catch(() => {});
      const tab = await page.evaluate(() => ({ text: (document.querySelector('#mnFeed [data-mission-feed-error]') || {}).textContent || '', retry: !!document.querySelector('#mnFeed [data-mission-feed-retry]') }));
      check(scope, 'choosing the tab after a failed read reads again, and the tab says the missions could not load and offers Try again', world.missionsList === 2 && /could not load/.test(tab.text) && tab.retry, { tab, reads: world.missionsList });
      await page.click('#mnFeedScope [data-feed-scope="global"]');
      await page.click('#mnFeedScope [data-feed-scope="equity"]');
      await page.waitForFunction(() => !!document.querySelector('#mnFeed [data-mission-feed-retry]'), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);
      check(scope, 'choosing the tab again reads the missions again, once', world.missionsList === 3 && await page.evaluate(() => !!document.querySelector('#mnFeed [data-mission-feed-retry]')), world.missionsList);
      await page.click('#mnFeed [data-mission-feed-retry]');
      await page.waitForFunction((n) => document.querySelectorAll('#mnFeed [data-mission-post]').length === n, MISSIONS.length, { timeout: 20000 }).catch(() => {});
      const after = await page.evaluate(() => ({ missions: document.querySelectorAll('#mnFeed [data-mission-post]').length, error: !!document.querySelector('#mnFeed [data-mission-feed-error]') }));
      check(scope, 'Try again reads once more and lists the missions', world.missionsList === 4 && after.missions === MISSIONS.length && !after.error, { after, reads: world.missionsList });
      await page.click('#mnFeedScope [data-feed-scope="global"]');
      await page.waitForFunction(() => document.querySelectorAll('#mnFeed [data-mission-post]').length > 0, null, { timeout: 15000 }).catch(() => {});
      check(scope, 'and Global carries them too', (await feedSeq(page)).some((x) => x.startsWith('m:')));
      const heard = noise(world, failures);
      check(scope, 'no console error and no 4xx besides the three failed reads', heard.console.length === 0 && heard.bad.length === 0, heard);
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }

  /* ---------- Escape on the dialog is the ×: the mission leaves the address ---------- */
  {
    const scope = 'guest-escape-390';
    const { ctx, page, world, errors } = await open(VIEWPORTS[0], '/mnet.html?view=feed&daylight=night');
    try {
      await page.waitForSelector(`#mnFeed [data-mission-post="${COAL.row.id}"] [data-mission-details]`, { timeout: 30000 });
      await page.click(`#mnFeed [data-mission-post="${COAL.row.id}"] [data-mission-details]`);
      await page.waitForSelector('#mnMissionDialog[open]', { timeout: 15000 });
      const opened = await page.evaluate(() => new URL(location.href).searchParams.get('mission'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('mnMissionDialog').open, null, { timeout: 5000 }).catch(() => {});
      const after = await page.evaluate(() => ({ open: document.getElementById('mnMissionDialog').open, href: location.pathname + location.search, feed: !document.getElementById('mnFeedView').hidden }));
      check(scope, 'Escape closes the dialog as the × does: the mission leaves the address and the World stays', opened === COAL.row.id && !after.open && after.href === '/mnet.html' && after.feed, { opened, after });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#mnFeed [data-post-id]', { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      check(scope, 'a reload after Escape does not bring the dismissed mission back', await page.evaluate(() => !document.getElementById('mnMissionDialog').open && !new URL(location.href).searchParams.get('mission')));
      const heard = noise(world);
      check(scope, 'zero console errors and no 4xx', heard.console.length === 0 && heard.bad.length === 0, heard);
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }

  /* ---------- as production stands today: the details table not there yet, the Environmental Justice module not released ---------- */
  {
    const scope = 'guest-production-today-390';
    const absences = [/\/rest\/v1\/action_mission_details\?/, /api\.mccluster\.org\/v1\/world\/environment$/];
    const { ctx, page, world, errors } = await open(VIEWPORTS[0], '/mnet.html?view=feed&daylight=night', { details: 'absent', environment: 'unavailable' });
    try {
      await page.waitForFunction((n) => document.querySelectorAll('#mnFeed [data-mission-post]').length === n, MISSIONS.length, { timeout: 30000 }).catch(() => {});
      check(scope, 'the mission posts are there, without source lines, when the details table is absent', await page.evaluate((n) => document.querySelectorAll('#mnFeed [data-mission-post]').length === n && !document.querySelector('[data-mission-credit]'), MISSIONS.length));
      await page.click('#mnFeedScope [data-feed-scope="equity"]');
      await page.waitForFunction(() => document.documentElement.getAttribute('data-we-feed') === 'unavailable', null, { timeout: 15000 }).catch(() => {});
      const tab = await page.evaluate(() => { const note = document.getElementById('weUnavailable'); return { note: getComputedStyle(note).display, text: note.textContent.trim(), panel: getComputedStyle(document.getElementById('wePanel')).display, posts: document.querySelectorAll('#mnFeed [data-mission-post]').length }; });
      check(scope, 'while the Environmental Justice source is unavailable, the tab shows one honest line and no broken panel', tab.note === 'block' && tab.text === 'Environmental reports are not available right now.' && tab.panel === 'none' && tab.posts === MISSIONS.length, tab);
      await page.evaluate(() => { document.getElementById('mnFeedScope').scrollIntoView({ block: 'start' }); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, 'guest-production-today-equity-390.png') });
      await page.click(`#mnFeed [data-mission-post="${INSULATION.row.id}"] [data-mission-details]`);
      await page.waitForSelector('#mnMissionDialog[open]', { timeout: 15000 });
      check(scope, 'Details opens the dialog without a credit or quotation, and still with Join', await page.evaluate(() => !document.getElementById('mnMissionCredit') && !document.querySelector('#mnMissionDetail blockquote') && !document.getElementById('mnMissionJoin').hidden));
      await page.click('#mnMissionClose');
      await page.click('#mnFeedScope [data-feed-scope="global"]');
      await page.waitForTimeout(500);
      check(scope, 'the absent table is asked for once in the whole visit', world.details === 1, world.details);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction((n) => document.querySelectorAll('#mnFeed [data-mission-post]').length === n, MISSIONS.length, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      check(scope, 'and not again after a reload: its absence is remembered for the session', world.details === 1 && await page.evaluate(() => sessionStorage.getItem('mcc.missionDetails.absent') === '1'), world.details);
      const heard = noise(world, absences);
      check(scope, 'no console error and no 4xx but the two deliberate absences', heard.console.length === 0 && heard.bad.length === 0 && world.console.every((c) => absences.some((re) => re.test(c.url))), { heard, all: world.console });
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }

  /* ---------- ?view=missions and All missions are the Equity Uprise tab, never a sign-in prompt ---------- */
  {
    const scope = 'guest-browse-390';
    const { ctx, page, world, errors } = await open(VIEWPORTS[0], '/mnet.html?view=missions');
    try {
      await page.waitForFunction(() => window.MCC_FEED_SCOPE.get() === 'equity', null, { timeout: 30000 }).catch(() => {});
      check(scope, 'a guest\'s ?view=missions chooses the Equity Uprise tab and asks nobody to sign in', await page.evaluate(() => window.MCC_FEED_SCOPE.get() === 'equity' && document.getElementById('mnSignedOut').hidden && !document.getElementById('mnFeedView').hidden));
      await page.waitForSelector('#mnFeed [data-mission-post]', { timeout: 30000 }).catch(() => {});
      check(scope, 'and lists the open missions as posts', await page.evaluate((n) => document.querySelectorAll('#mnFeed [data-mission-post]').length === n, MISSIONS.length));
      await page.click('#mnFeedScope [data-feed-scope="global"]');
      await page.click('#huSearchToggle');
      await page.fill('#mnSearchInput', 'river');
      await page.waitForSelector('#mnSuggest:not([hidden]) [data-mn-feed="equity"]', { timeout: 10000 });
      await page.click('#mnSuggest [data-mn-feed="equity"]');
      check(scope, 'All missions in the search opens the Equity Uprise tab', await page.evaluate(() => window.MCC_FEED_SCOPE.get() === 'equity' && document.getElementById('mnSignedOut').hidden && document.getElementById('mnSuggest').hidden));
      const heard = noise(world);
      check(scope, 'zero console errors and no 4xx', heard.console.length === 0 && heard.bad.length === 0, heard);
      check(scope, 'no JavaScript errors', errors.length === 0, errors);
    } finally { await ctx.close(); }
  }

  /* ---------- by day at 390: the owner's row, the supplied dark mark on the white tab and on the joins, the white mark on the pressed red ---------- */
  {
    const scope = 'daylight-390';
    const { ctx, page, world, errors } = await open(VIEWPORTS[0], '/mnet.html?view=feed&daylight=day');
    try {
      await page.waitForSelector('#mnFeed [data-post-id]', { timeout: 30000 });
      await page.waitForSelector('#mnFeed [data-mission-post]', { timeout: 30000 }).catch(() => {});
      check(scope, 'the World is in its daylight look', await page.evaluate(() => document.documentElement.getAttribute('data-daylight') === 'day'));
      await globeReady(page);
      checkRow(scope, await guestView(page), 'global');
      const unpressed = (await strip(page)).find((b) => b.key === 'equity');
      check(scope, 'by day the unpressed tab shows the supplied dark mark alone', unpressed.marks.length === 1 && unpressed.marks[0].src === 'assets/img/equity-uprise-mark.png' && unpressed.words === '', unpressed);
      const joins = await joinMarks(page);
      check(scope, 'by day each Join on the white feed is the supplied dark mark alone', joins.length === MISSIONS.length && joins.every((j) => j.words === '' && j.shown.length === 1 && j.shown[0].src === 'assets/img/equity-uprise-mark.png' && j.shown[0].w === j.shown[0].h), joins[0]);
      await page.waitForTimeout(800);
      await page.evaluate(() => { const f = document.getElementById('mnWorldFeed'), a = document.querySelector('#mnFeed [data-mission-post]'); if (f && a) f.scrollTop += a.getBoundingClientRect().top - f.getBoundingClientRect().top - 160; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, 'daylight-global-390.png') });
      await page.click('#mnFeedScope [data-feed-scope="equity"]');
      checkRow(scope, await guestView(page), 'equity');
      const pressed = (await strip(page)).find((b) => b.key === 'equity');
      check(scope, 'by day the pressed tab (red) shows the supplied white mark alone', pressed.pressed === 'true' && pressed.marks.length === 1 && pressed.marks[0].src === 'assets/img/equity-uprise-mark-white.png', pressed);
      /* the Environmental Justice panel at the top of the tab, by day: the page's ink on the page's grounds (css/daylight.css) */
      await page.waitForFunction(() => document.documentElement.getAttribute('data-we-feed') === 'ready', null, { timeout: 15000 }).catch(() => {});
      const contrast = await page.evaluate(() => {
        const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b; } return 'rgb(255, 255, 255)'; };
        const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
        const lum = (a) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(a[0]) + 0.7152 * f(a[1]) + 0.0722 * f(a[2]); };
        const ratio = (x, y) => { const a = lum(rgb(x)), b = lum(rgb(y)); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100; };
        const of = (el) => (el ? { text: el.textContent.trim().slice(0, 40), ink: getComputedStyle(el).color, ground: bgOf(el), ratio: ratio(getComputedStyle(el).color, bgOf(el)) } : null);
        return { shown: getComputedStyle(document.getElementById('wePanel')).display !== 'none', title: of(document.getElementById('weTitle')), eyebrow: of(document.querySelector('#wePanel .we-eyebrow')), subtle: of(document.querySelector('#wePanel .we-subtle')), button: of(document.getElementById('weRefresh')) };
      });
      check(scope, 'by day the Environmental Justice panel at the top of the tab reads 4.5:1 or better: heading, eyebrow, small print and button', contrast.shown && [contrast.title, contrast.eyebrow, contrast.subtle, contrast.button].every((c) => c && c.ratio >= 4.5), contrast);
      const size = await fits(page);
      check(scope, 'nothing scrolls sideways by day', size.sw === size.cw, size);
      await page.evaluate(() => { document.getElementById('mnFeedScope').scrollIntoView({ block: 'start' }); });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, 'daylight-equity-390.png') });
      await page.click(`#mnFeed [data-mission-post="${INSULATION.row.id}"] [data-mission-credit]`);
      await page.waitForSelector('#mnMissionDialog[open] #mnMissionCredit', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(OUT, 'daylight-dialog-credit-390.png') });
      const heard = noise(world);
      check(scope, 'zero console errors and no 4xx', heard.console.length === 0 && heard.bad.length === 0, heard);
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
