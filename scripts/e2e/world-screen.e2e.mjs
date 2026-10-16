/* Human Uprise World screen, end to end in a real browser.

   Owner's contract: docs/action-network/WORLD-SCREEN-UX-HANDOFF-20261014.md.
   Serves this checkout, puts a fake in front of api.mccluster.org and
   Supabase (an in-memory feed with real request handling, so every
   interaction is a round trip whose request is checked), and drives:

     member: the composition on iPhone / iPad / desktop, posting, Like and
             unlike, comments, Share, pin -> context strip and narrowed feed,
             post -> globe without narrowing, the three-column app bar, and
             the consolidated navigation: the compact account menu, alerts
             on the bell, people/groups/missions in search, Live over the
             globe, Clips under the tabs, Create in the composer, a
             creator's analytics on the profile, and signing out;
     guest:  the same World, read-only through /v1/mnet/public-feed with no
             session sent, opening on Explore the world, every member action
             opening sign-in and sending nothing, Share still working.

   Nothing here touches production. The fixture people and posts exist only
   in this file's memory.

   Run:  node scripts/e2e/world-screen.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR=/path/to/node_modules if it is not
   resolvable from here) and network access to the Cesium CDN and
   OpenStreetMap tiles. Exits non-zero on any failed check. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

/* ---------- a static server for this checkout ---------- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------- the fixture world (memory only) ---------- */
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const CONTENT = '55555555-5555-4555-8555-555555555555';
const MISSIONS = [
  { mission_id: M1, title: 'Clean up the Mill River', description: 'Bag a block of shoreline.', action_path: 'show_up', region_key: 'US-CT', region_label: 'Connecticut', latitude: 41.6, longitude: -72.7 },
  { mission_id: M2, title: 'Amplify a local food pantry', description: 'Share the pantry hours.', action_path: 'amplify', region_key: 'GB-ENG', region_label: 'England', latitude: 52.3, longitude: -1.2 },
  { mission_id: '33333333-3333-4333-8333-333333333331', title: 'Record a neighbourhood oral history', description: 'Interview an elder about the block.', action_path: 'create', region_key: 'NG-LA', region_label: 'Lagos', latitude: 6.5, longitude: 3.4 },
  { mission_id: '33333333-3333-4333-8333-333333333332', title: 'Plant a street tree', description: 'Join the Saturday planting crew.', action_path: 'show_up', region_key: 'BR-SP', region_label: 'São Paulo', latitude: -23.5, longitude: -46.6 },
  { mission_id: '33333333-3333-4333-8333-333333333333', title: 'Translate the shelter guide', description: 'Make the guide readable in three languages.', action_path: 'create', region_key: 'JP-13', region_label: 'Tokyo', latitude: 35.7, longitude: 139.7 },
];
const STATS = [{ mission_id: M1, joined: 12, submitted: 3, verified: 9 }];
/* an open mission with no pin (search must still find it), and a clip job (never a mission) */
const OPEN_MISSIONS = [
  { id: '44444444-4444-4444-8444-444444444441', title: 'Write to the river council', description: 'Ask for a cleanup budget.', domain: 'civic', kind: 'mission' },
  { id: '44444444-4444-4444-8444-444444444442', title: 'Clip the river song', description: 'Paid clipping.', domain: 'music', kind: 'clip' },
];
const CLIPS = [{ mission_id: '44444444-4444-4444-8444-444444444442', title: 'Clip Docket 516R', base_cpm_cents: 300, platforms: ['instagram'] }];
const GROUPS = [{ id: 'g1', slug: 'river-keepers', name: 'River Keepers', purpose: 'Keep the Mill River clean.', visibility: 'open', member_count: 14, joined: false }];
const LIVE = [{ id: '66666666-6666-4666-8666-666666666661', title: 'Mill River cleanup, live', room_kind: 'mission', category_key: 'field', host: { display_name: 'Fixture Ana' }, room: { title: 'River room' }, started_at: new Date().toISOString(), metrics: { joined: 3, verified: 1 } }];
/* fixture pictures: the owner's own frames already in this repository */
const PHOTOS = ['assets/frames/affix_0001.jpg', 'assets/frames/bussalick_0001.jpg', 'assets/frames/church_0001.jpg', 'assets/img/peaceful-places.jpg'];
const asset = (n) => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, '0')}`;
const ME = { m_uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', mccluster_id: 'fixture.you', display_name: 'Fixture You' };
const PEERS = [
  { m_uid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mccluster_id: 'fixture.ana', display_name: 'Fixture Ana' },
  { m_uid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', mccluster_id: 'fixture.dev', display_name: 'Fixture Dev' },
];
function freshWorld() {
  let n = 0;
  const id = () => `dddddddd-dddd-4ddd-8ddd-${String(++n).padStart(12, '0')}`;
  const now = Date.now();
  const posts = [
    { id: id(), author: PEERS[0], body: 'Bagged the whole north bank of the Mill River today. Two more blocks Saturday.', visibility: 'public', content_id: CONTENT, like_count: 3, liked_by_me: false, comments: [{ actor: PEERS[1], body: 'Count me in for Saturday.' }], media: [{ asset_id: asset(1), type: 'image' }, { asset_id: asset(2), type: 'image' }, { asset_id: asset(3), type: 'image' }] },
    { id: id(), author: PEERS[1], body: 'Listening to Docket 516R on repeat while I write the memo.', visibility: 'public', like_count: 1, liked_by_me: false, comments: [], media: [{ asset_id: asset(4), type: 'image' }] },
    { id: id(), author: PEERS[0], body: 'Network-only update for the people I follow.', visibility: 'network', like_count: 0, liked_by_me: false, comments: [] },
    ...Array.from({ length: 6 }, (_, k) => ({ id: id(), author: PEERS[k % 2], body: `Field note ${k + 1}: what we did, what is next, and who can help.`, visibility: 'public', like_count: k, liked_by_me: false, comments: [] })),
  ].map((p, k) => ({ ...p, created_at: new Date(now - (k + 1) * 3600e3).toISOString() }));
  return { posts, id, requests: [] };
}
const item = (p) => ({ item_type: 'post', post_id: p.id, occurred_at: p.created_at, actor: p.author, post: { id: p.id, body: p.body, visibility: p.visibility, created_at: p.created_at, content_id: p.content_id || null, like_count: p.like_count, liked_by_me: p.liked_by_me, author_m_uid: p.author.m_uid, media: p.media || [] } });

async function routeBackends(ctx, world, { member, creator = true, verified = true }) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => {
    const u = route.request().url();
    if (u.includes('/auth/v1/user')) return member && world.userCheck ? json(route, { code: world.userCheck, error_code: 'session_not_found' }, world.userCheck) : member ? json(route, { id: 'auth-you', email: 'fixture@example.invalid' }) : json(route, { msg: 'no session' }, 401);
    if (u.includes('action_globe_public_region_missions')) return json(route, MISSIONS);
    if (u.includes('action_mission_stats')) return json(route, STATS);
    if (u.includes('clip_campaigns_open')) return json(route, CLIPS);
    if (u.includes('/rest/v1/action_missions?id=eq.')) { const m = MISSIONS.find((x) => u.includes(x.mission_id)); return json(route, m ? [{ id: m.mission_id, campaign_id: 'camp-1', title: m.title, description: m.description, domain: 'civic', difficulty: 1, base_points: 10, proof_required: true, verification_mode: 'desk', skills: ['field'], capacity: null, status: 'open', starts_at: null, ends_at: null }] : []); }
    if (u.includes('/rest/v1/action_missions?')) return json(route, OPEN_MISSIONS);
    if (u.includes('/rest/v1/action_mission_assignments?')) return json(route, []);
    /* the campaign's governed support rail is open for this fixture */
    if (/\/rpc\/action_bounty_public$/.test(u)) return json(route, { support_open: true, support_note: 'Allocations are verified by the desk.', bounties: [] });
    if (u.includes('/rest/v1/music_creator_profiles?')) return json(route, member && creator ? [{ handle: 'fixture-you' }] : []);
    /* the Action Record: whether this member has completed a mission decides whether Uprise is theirs yet */
    if (/\/rpc\/action_record$/.test(u)) return json(route, { verified_actions: verified ? 1 : 0, points: 0, in_progress: 0, missions: [], skills: [], cohorts: [] });
    if (u.includes('action_offer_cards')) {
      const linked = world.posts.filter((p) => p.content_id === CONTENT);
      return json(route, linked.map((p) => ({ post_id: p.id, mission_id: M1, content_id: CONTENT, title: MISSIONS[0].title, description: MISSIONS[0].description, mission_open: true })));
    }
    return json(route, []);
  });
  await ctx.route('https://api.mccluster.org/**', async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), auth = req.headers().authorization || '';
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    world.requests.push({ m, path: u.pathname, search: u.search, auth: !!auth, body });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': BASE, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,DELETE' } });
    const before = u.searchParams.get('before');
    if (before && Number.isNaN(Date.parse(before))) return json(route, { error: 'bad cursor' }, 400);
    const asOf = (list) => before ? list.filter((p) => p.created_at < before) : list;
    /* the World's Cesium ion (scripts/e2e/world-ion.e2e.mjs drives it): off here, so this Earth is NASA's alone */
    if (u.pathname === '/v1/world/ion') return json(route, { ok: true, available: false, binding: null });
    if (u.pathname === '/v1/mnet/public-feed') {
      if (auth) return json(route, { error: 'a guest read carries no session' }, 400);
      const pub = asOf(world.posts.filter((p) => p.visibility === 'public')).map((p) => { const x = item(p); delete x.post.author_m_uid; delete x.post.content_id; x.post.media_locked = x.post.media.length; delete x.post.media; return x; });
      return json(route, { items: pub, scope: 'public', next_before: null });
    }
    /* THE WORLD'S DATA LAYERS (owner, 2026-10-15): flights for everyone; satellites and launches for members, refused without a bearer */
    if (u.pathname === '/v1/world/layers/flights') return json(route, { ok: true, layer: 'flights', fetched_at: new Date().toISOString(), attribution: 'OpenSky Network', stale: false, count: 3, total: 3, aircraft: [['ab1644', 'UAL2405', -92.49, 32.99, 11567, 220, 188], ['4ca7b3', 'RYR12', -3.2, 51.5, 10900, 230, 95], ['7c6b2d', 'QFA1', 151.2, -33.9, 8000, 210, 10]] });
    if (u.pathname === '/v1/world/layers/satellites' || u.pathname === '/v1/world/layers/launches') {
      if (!/^Bearer \S+/.test(auth)) return json(route, { error: 'Sign in to see ' + u.pathname.split('/').pop(), detail: { members_only: true } }, 401);
      if (u.pathname.endsWith('satellites')) return json(route, { ok: true, layer: 'satellites', fetched_at: new Date().toISOString(), attribution: 'CelesTrak (celestrak.org), Dr. T.S. Kelso', stale: false, count: 2, satellites: [
        { id: '25544', name: 'ISS (ZARYA)', group: 'stations', tle1: '1 25544U 98067A   26286.82178372  .00006592  00000+0  12831-3 0  9991', tle2: '2 25544  51.6325  76.5471 0003201 125.0532 235.0866 15.49721212537052' },
        { id: '20580', name: 'HST', group: 'visual', tle1: '1 20580U 90037B   26286.50000000  .00001000  00000+0  50000-4 0  9991', tle2: '2 20580  28.4700 100.0000 0002500  90.0000 270.0000 15.09000000100000' }] });
      return json(route, { ok: true, layer: 'launches', fetched_at: new Date().toISOString(), attribution: 'Launch Library 2 — The Space Devs', stale: false, count: 2, launches: [
        { id: 'L1', name: 'Falcon 9 Block 5 | Starlink Group 10-1', net: '2026-10-16T12:00:00Z', status: 'Go', provider: 'SpaceX', pad: { name: 'SLC-40', location: 'Cape Canaveral, FL, USA', lat: 28.56, lon: -80.57 }, mission: { name: 'Starlink Group 10-1', type: 'Communications' }, url: null },
        { id: 'L2', name: 'Ariane 6 | Galileo L14', net: '2026-10-20T08:00:00Z', status: 'TBC', provider: 'Arianespace', pad: { name: 'ELA-4', location: 'Kourou, French Guiana', lat: 5.26, lon: -52.79 }, mission: { name: 'Galileo L14', type: 'Navigation' }, url: null }] });
    }
    if (!/^Bearer \S+/.test(auth)) return json(route, { error: 'Authentication required' }, 401);
    /* a bootstrap that fails: the World must still open (owner, 2026-10-15: "logged in as Benji Chase … not seeing the globe") */
    if (u.pathname === '/v1/mnet/bootstrap' && world.bootFail && world.bootFail.length) { const st = world.bootFail.shift(); return json(route, { error: st === 401 ? 'sign in first' : 'upstream failed' }, st); }
    if (u.pathname === '/v1/mnet/bootstrap') return json(route, { identity: { m_uid: ME.m_uid, mccluster_id: ME.mccluster_id }, profile: { display_name: ME.display_name, mccluster_id: ME.mccluster_id }, next_step: null, tour_done_at: new Date().toISOString() });
    if (u.pathname === '/v1/mnet/feed') return json(route, { items: asOf(world.posts).map(item), next_before: null });
    if (u.pathname === '/v1/mnet/notifications') return json(route, { notifications: world.alertsRead ? [] : [{ id: 'n1', type: 'like', body: 'Fixture Ana liked your post', created_at: new Date().toISOString(), read_at: null }] });
    if (u.pathname === '/v1/mnet/notifications/read') { world.alertsRead = true; return json(route, {}); }
    if (u.pathname === '/v1/mnet/discover') { const q = (u.searchParams.get('q') || '').toLowerCase(); return json(route, { people: PEERS.filter((p) => (p.display_name + ' ' + p.mccluster_id).toLowerCase().includes(q)).map((p) => ({ ...p, following: false })) }); }
    if (u.pathname === '/v1/mnet/conversations') return json(route, { conversations: [{ conversation: { id: 'c1' }, my: { member_state: 'requested' }, members: [], last_message: null }] });
    if (u.pathname === '/v1/mnet/groups') return json(route, { groups: GROUPS });
    if (u.pathname === '/v1/mnet/groups/river-keepers') return json(route, { group: GROUPS[0], organization: null, campaigns: [], items: [] });
    if (u.pathname === '/v1/mnet/live/directory') return json(route, { sessions: LIVE });
    if (u.pathname === '/v1/mnet/live/eligibility') return json(route, { can_host: false, enabled: false });
    if (u.pathname === '/v1/analytics/my-creator') return json(route, { ok: true, creator: creator, audience: creator ? { countries: [{ country: 'US', views: 42 }, { country: 'GB', views: 7 }], elsewhere_views: 3, unknown_views: 1, min_views: 5 } : { countries: [] } });
    const media = u.pathname.match(/^\/v1\/mnet\/media\/eeeeeeee-eeee-4eee-8eee-0*(\d+)\/url$/);
    if (media) return json(route, { url: `${BASE}/${PHOTOS[(Number(media[1]) - 1) % PHOTOS.length]}`, media_type: 'image' });
    if (u.pathname === '/v1/mnet/posts' && m === 'POST') {
      if (!body || !String(body.body || '').trim()) return json(route, { error: 'empty' }, 400);
      const p = { id: world.id(), author: ME, body: body.body, visibility: body.visibility, like_count: 0, liked_by_me: false, comments: [], created_at: new Date().toISOString() };
      world.posts.unshift(p);
      return json(route, { post: item(p).post }, 201);
    }
    const react = u.pathname.match(/^\/v1\/mnet\/posts\/([^/]+)\/reactions$/);
    if (react) {
      const p = world.posts.find((x) => x.id === react[1]);
      if (!p || body?.reaction !== 'uprise') return json(route, { error: 'bad reaction' }, 400);
      if (m === 'POST' && !verified) return json(route, { error: 'Complete a mission to uprise posts. Your first verified action unlocks it.', detail: { reason: 'no_verified_action' } }, 403);
      if (m === 'POST' && !p.liked_by_me) { p.liked_by_me = true; p.like_count++; }
      if (m === 'DELETE' && p.liked_by_me) { p.liked_by_me = false; p.like_count--; }
      return json(route, { liked: p.liked_by_me, like_count: p.like_count });
    }
    const replies = u.pathname.match(/^\/v1\/mnet\/posts\/([^/]+)\/replies$/);
    if (replies) {
      const p = world.posts.find((x) => x.id === replies[1]);
      if (!p) return json(route, { error: 'Post not found' }, 404);
      if (m === 'POST') { if (!String(body?.body || '').trim()) return json(route, { error: 'empty' }, 400); p.comments.push({ actor: ME, body: body.body }); return json(route, { comment: { body: body.body } }, 201); }
      return json(route, { comments: p.comments });
    }
    return json(route, {});
  });
}

/* ---------- checks ---------- */
const results = [];
function check(scope, name, ok, detail) { results.push({ scope, name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); }
const split = (page) => page.evaluate(() => {
  const h = innerHeight, r = (id) => document.getElementById(id).getBoundingClientRect(), pct = (x) => Math.round(x / h * 100);
  const g = r('mnWorld'), c = r('mnWorldContext'), f = r('mnWorldFeed');
  const bar = document.querySelector('.appbar'), fe = document.getElementById('mnWorldFeed');
  return { globe: pct(g.height), context: pct(c.height), feed: pct(f.height), feedTop: Math.round(f.top), feedBottom: Math.round(f.bottom), vh: h, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null, feedPad: Math.round(parseFloat(getComputedStyle(fe).paddingBottom)), feedRoom: Math.round(fe.scrollHeight - fe.clientHeight), clear: getComputedStyle(document.documentElement).getPropertyValue('--mn-bar-clear').trim(),
    ctxBottom: Math.round(c.bottom), ctxPad: Math.round(parseFloat(getComputedStyle(document.getElementById('mnWorldContext')).paddingBottom)) };
});

const DEVICES = [
  { name: 'iphone-portrait', viewport: { width: 390, height: 844 }, mobile: true, fit: true },
  { name: 'iphone-landscape', viewport: { width: 844, height: 390 }, mobile: true, fit: true },
  { name: 'ipad-portrait', viewport: { width: 820, height: 1180 }, mobile: true, fit: true },
  { name: 'ipad-landscape', viewport: { width: 1180, height: 820 }, mobile: true, fit: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, mobile: false, fit: true },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

async function open(device, { member, creator = true, verified = true, bootFail = [], userCheck = 0 }) {
  const world = freshWorld();
  world.bootFail = bootFail.slice(); world.userCheck = userCheck;
  const ctx = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 2, isMobile: device.mobile, hasTouch: device.mobile });
  await ctx.addInitScript((m) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() }));
    if (m && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); const exp = Math.floor(Date.now() / 1000) + 3600; localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp })).replace(/=+$/, '') + '.y', refresh_token: 'r', expires_at: exp })); }
    window.__shared = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__shared.push(d.url); return Promise.resolve(); } });
  }, member);
  await routeBackends(ctx, world, { member, creator, verified });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  /* the globe catches its own start-up failure and only warns; that is still a failure here */
  page.on('console', (m) => { if (/TypeError|ReferenceError|SyntaxError/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.goto(BASE + '/action-globe.html', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/mnet\.html\?view=feed/, { timeout: 15000 });
  await page.waitForFunction(() => /pinned on the Earth|No missions are pinned|could not load|can.t run/.test((document.getElementById('mnWorldCaption') || {}).textContent || ''), null, { timeout: 90000 });
  await page.waitForSelector('#mnFeed [data-post-id]', { timeout: 20000 });
  /* evidence shots wait for the Earth's tiles, up to 25s */
  const globe = page.frame({ url: /action-globe\.html/ });
  if (globe) await globe.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return { ctx, page, world, errors };
}
const req = (world, m, re) => world.requests.filter((r) => r.m === m && re.test(r.path));

/* E2E_ONLY=layers (or any scope prefix) reruns one family of scenarios alone; the full run is the evidence */
const ONLY = process.env.E2E_ONLY || '';
const runs = (scope) => !ONLY || scope.startsWith(ONLY);

/* ---------- member, every device: composition and navigation ---------- */
for (const device of DEVICES) {
  if (!runs(device.name)) continue;
  const { ctx, page, world, errors } = await open(device, { member: true });
  const s = await split(page);
  check(device.name, 'opened on the World screen from action-globe.html', /mnet\.html\?view=feed/.test(page.url()));
  check(device.name, 'globe, context strip and a real post all on screen at first load', s.feedTop < s.vh - 60 && s.feedBottom <= s.vh && s.feedBottom - s.feedTop >= Math.min(120, s.vh * 0.25), s);
  /* the whole screen (owner, 2026-10-15): the feed runs to the bottom edge, under the floating bar, with room to clear it */
  if (device.viewport.height > device.viewport.width) check(device.name, 'the feed runs to the bottom of the screen, under the bar, and its padding clears the bar', s.feedBottom >= s.vh - 1 && s.barTop !== null && s.barTop < s.vh && s.feedPad >= (s.vh - s.barTop) + 8 && Math.abs(parseFloat(s.clear) - (s.vh - s.barTop + 10)) <= 1, s);
  /* on a desktop the strip is the bottom-left of the grid: it reaches the bottom edge and its own padding keeps its controls above the bar */
  if (device.name === 'desktop') check(device.name, 'the desktop strip runs to the bottom edge with its controls clear of the bar', s.ctxBottom >= s.vh - 1 && s.barTop !== null && s.ctxPad >= (s.vh - s.barTop) + 8 && s.feedBottom >= s.vh - 1 && s.feedPad >= (s.vh - s.barTop) + 8, s);
  /* the owner's split, upright: globe 45-50%, context ~15% (never inflated past 17), feed 26%+ */
  if (device.viewport.height > device.viewport.width) check(device.name, 'portrait split matches the contract', s.globe >= 44 && s.context <= 17 && s.feed >= 26, s);
  if (device.fit) check(device.name, 'one screen: the page does not scroll, the feed does', await page.evaluate(() => document.documentElement.classList.contains('mn-world-fit')), s);
  check(device.name, 'no sideways overflow', s.scrollW === s.clientW, s);
  check(device.name, 'the strip opens on the newest pinned mission, labelled as the latest', (await page.isVisible('#mnWorldFocusFlag')) && /Latest/.test(await page.textContent('#mnWorldFocusFlag')));
  const bar = await page.$$eval('.appbar [data-appnav], .appbar [data-member-tab]', (a) => a.map((x) => x.getAttribute('data-appnav') || 'member:' + x.getAttribute('data-member-tab')));
  check(device.name, 'app bar is exactly Music | M | Globe', JSON.stringify(bar) === JSON.stringify(['music', 'home', 'world']), bar);
  check(device.name, 'feed shows member posts (author, text, Share; no like, comment or reaction), not mission cards', await page.evaluate(() => {
    const c = document.querySelector('#mnFeed [data-post-id]');
    return !!(c && c.querySelector('.mn__author-name') && c.querySelector('[data-action=share]')) && !c.querySelector('[data-action=like]') && !c.querySelector('[data-action=comments]') && !c.querySelector('[data-action=uprise]') && !document.querySelector('#mnFeed .world-story');
  }));
  await page.screenshot({ path: join(OUT, `member-${device.name}.png`) });
  check(device.name, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* ---------- member, iPhone: the actual interactions ---------- */
if (runs('member-interactions')) {
  const device = DEVICES[0];
  const { ctx, page, world, errors } = await open(device, { member: true });
  const scope = 'member-interactions';
  const feedScroll = await page.evaluate(async () => { const f = document.getElementById('mnWorldFeed'); f.scrollTop = 400; await new Promise((r) => setTimeout(r, 300)); return { feed: f.scrollTop, page: scrollY }; });
  check(scope, 'the feed scrolls on its own and the page stays put', feedScroll.feed > 0 && feedScroll.page === 0, feedScroll);
  await page.$eval('#mnWorldFeed', (f) => { f.scrollTop = 0; });

  // Post
  await page.fill('#mnPostBody', 'E2E: posted from the World screen');
  await page.click('#mnPost');
  await page.waitForFunction(() => /E2E: posted from the World screen/.test(document.querySelector('#mnFeed [data-post-id]')?.textContent || ''), null, { timeout: 10000 });
  const posted = req(world, 'POST', /^\/v1\/mnet\/posts$/).at(-1);
  check(scope, 'Post sends an authenticated POST /v1/mnet/posts and the post lands at the top', posted && posted.auth && posted.body.body === 'E2E: posted from the World screen', posted);
  check(scope, 'the composer folds once the post is away', !(await page.$eval('#mnComposer', (c) => c.classList.contains('is-open'))));

  // the emblem or Fund: the post that carries a mission offers both; the rest offer neither. The mark is never written out (owner, 2026-10-14).
  const target = world.posts.find((p) => p.content_id === CONTENT);
  const card = `#mnFeed [data-post-id="${target.id}"]`;
  await page.waitForSelector(`${card} .mn__actcard .mn__primary--eup`, { timeout: 10000 });
  await page.waitForFunction((sel) => /12 joined/.test(document.querySelector(sel + ' .mn__actcard')?.textContent || ''), card, { timeout: 8000 }).catch(() => {});
  const banner = await page.textContent(`${card} .mn__actcard`);
  const eupJoin = await page.$eval(`${card} .mn__primary--eup`, (a) => ({ text: a.textContent.trim(), label: a.getAttribute('aria-label'), imgs: a.querySelectorAll('img').length, box: a.getBoundingClientRect().toJSON(), img: a.querySelector('img') && a.querySelector('img').getBoundingClientRect().toJSON(), natural: a.querySelector('img') ? [a.querySelector('img').naturalWidth, a.querySelector('img').naturalHeight] : null })).catch(() => null);
  check(scope, 'a mission post offers the join as the owner\'s emblem alone (no words, the complete artwork scaled only) and Fund, with the mission\'s public counts', !!eupJoin && eupJoin.text === '' && eupJoin.label === 'Join this mission and do it' && eupJoin.imgs === 1 && Math.abs(eupJoin.img.width - eupJoin.img.height) < 1 && eupJoin.box.height >= 44 && eupJoin.box.width >= 44 && /12 joined · 9 verified/.test(banner) && !!(await page.$(`${card} [data-fund-mission]`)) && /assets\/img\/equity-uprise-mark-white\.png$/.test(await page.getAttribute(`${card} .mn__eup`, 'src')), { eupJoin, banner });
  check(scope, 'nothing on the screen writes the mark out', !/E\s*=\s*Up/i.test(await page.evaluate(() => document.body.innerText)));
  const plain = world.posts.find((p) => !p.content_id && p.visibility === 'public');
  check(scope, 'a post with no mission has no join emblem, Fund, like, comment or reaction', !(await page.$(`#mnFeed [data-post-id="${plain.id}"] [data-take-mission], #mnFeed [data-post-id="${plain.id}"] [data-fund-mission], #mnFeed [data-action=like], #mnFeed [data-action=comments], #mnFeed [data-action=uprise]`)));
  await page.click(`${card} [data-fund-mission]`);
  await page.waitForSelector(`${card} .mn__fund-line a`, { timeout: 8000 }).catch(() => {});
  check(scope, 'Fund tells the truth for this mission: its campaign\'s governed support rail, open', /governed support rail/.test((await page.textContent(`${card} .mn__fund-line`).catch(() => '')) || '') && (await page.getAttribute(`${card} .mn__fund-line a`, 'href').catch(() => '')) === 'give.html' && /verified by the desk/.test(await page.textContent(`${card} .mn__fund-line`)));
  await page.screenshot({ path: join(OUT, 'member-iphone-fund.png') });
  await page.click(`${card} .mn__primary--eup`);
  await page.waitForSelector('#mnMissionDialog[open]', { timeout: 10000 });
  await page.waitForFunction(() => /support rail|isn’t open/.test(document.getElementById('mnMissionFund')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
  check(scope, 'the emblem opens the mission to join it and do it, and the dialog says whether funding is open', /Clean up the Mill River/.test(await page.textContent('#mnMissionTitle')) && (await page.isVisible('#mnMissionJoin')) && /governed support rail/.test(await page.textContent('#mnMissionFund')));
  await page.screenshot({ path: join(OUT, 'member-iphone-eup.png') });
  await page.click('#mnMissionClose');
  await page.click('#mnToWorld');
  await page.waitForSelector('#mnFeedView:not([hidden])');
  await page.waitForSelector(`${card}`);

  // Share
  await page.click(`${card} [data-action=share]`);
  const shared = await page.evaluate(() => window.__shared.at(-1));
  check(scope, 'Share hands the system share sheet a link to this post', shared && shared.includes('view=feed') && shared.includes('post=' + target.id), shared);

  // Pin -> context strip + narrowed feed; the globe stays
  const frame = page.frame({ url: /action-globe\.html/ });
  await frame.evaluate((id) => window.parent.postMessage({ type: 'hu:mission-selected', mission: { mission_id: id, title: 'Clean up the Mill River', region_label: 'Connecticut', action_path: 'show_up' } }, location.origin), M1);
  await page.waitForSelector('#mnWorldFocus:not([hidden])');
  const narrowed = await page.$$eval('#mnFeed [data-post-id]', (a) => a.length);
  const strip = await page.textContent('#mnWorldFocus');
  check(scope, 'tapping a pin fills the context strip and narrows the feed to the post about it', /Connecticut/.test(strip) && narrowed === 1 && await page.isVisible('#mnWorldFrame'), { narrowed });
  await page.screenshot({ path: join(OUT, 'member-iphone-pin-selected.png') });
  await page.click('#mnWorldFocusClear');

  // Post -> globe, feed left whole
  const linked = world.posts.find((p) => p.content_id === CONTENT);
  await page.click(`#mnFeed [data-post-id="${linked.id}"] [data-globe-mission]`);
  await page.waitForSelector('#mnWorldFocus:not([hidden])');
  check(scope, 'Locate on globe shows the mission without narrowing the feed', (await page.getAttribute('#mnWorldFocusFilter', 'aria-pressed')) === 'false' && (await page.$$eval('#mnFeed [data-post-id]', (a) => a.length)) > 1);

  // The World look: mission card, tabs, search, thumbnails, globe controls
  await page.click('#mnWorldFocusClear');
  check(scope, 'with nothing picked the strip falls back to the caption', await page.isVisible('#mnWorldIdle'));
  const thumb = `#mnFeed [data-post-id="${linked.id}"] .mn__post-media`;
  check(scope, 'a post with three photos shows one thumbnail with a 1/3 badge', (await page.$eval(thumb, (n) => getComputedStyle(n, '::after').content)) === '"1/3"' && (await page.$$eval(`${thumb} .mn__post-media-item img`, (a) => a.filter((x) => x.offsetParent).length)) === 1);
  await page.click(`${thumb} .mn__post-media-item`);
  check(scope, 'tapping the thumbnail opens all three across the card', (await page.$$eval(`${thumb} .mn__post-media-item img`, (a) => a.filter((x) => x.offsetParent).length)) === 3);
  await page.click(`${thumb} .mn__post-media-item`);
  check(scope, 'the feed is the feed: no filter row (owner, 2026-10-15)', (await page.$$('[data-feed-tab], #mnFeedTabs')).length === 0);
  await page.fill('#mnSearchInput', 'river');
  await page.waitForTimeout(500);
  await page.waitForFunction(() => /River Keepers/.test(document.getElementById('mnSuggest')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
  const sug = await page.$$eval('#mnSuggest [data-suggest]', (a) => a.map((b) => b.getAttribute('data-suggest') + ':' + b.querySelector('span').textContent));
  check(scope, 'search suggests the pinned mission, an unpinned open mission (never a clip job), people and groups', sug.includes('globe:Clean up the Mill River') && sug.includes('mission:Write to the river council') && !sug.some((x) => /Clip the river song/.test(x)) && sug.includes('group:River Keepers') && sug.some((x) => /^people:Search people for/.test(x)) && sug.some((x) => /^groups:Groups about/.test(x)), sug);
  const foot = await page.$$eval('#mnSuggest .mn__suggest-foot [data-mn-view]', (a) => a.map((b) => b.getAttribute('data-mn-view')));
  check(scope, 'search keeps the full lists one tap away: all missions, people, groups', JSON.stringify(foot) === JSON.stringify(['missions', 'discover', 'groups']), foot);
  const sugBox = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(scope, 'the suggestions never push the page sideways', sugBox.sw === sugBox.cw, sugBox);
  await page.screenshot({ path: join(OUT, 'member-iphone-search-suggestions.png') });
  const searched = await page.$$eval('#mnFeed [data-post-id]', (a) => a.length);
  await page.press('#mnSearchInput', 'Enter');
  await page.waitForSelector('#mnWorldFocus:not([hidden])');
  check(scope, 'search narrows the feed as you type and Enter flies to the matching mission', searched === 1 && /Mill River/.test(await page.textContent('#mnWorldFocusTitle')), { searched });
  check(scope, 'the mission card shows public joined/verified counts', /12 joined · 9 verified/.test(await page.textContent('#mnWorldFocusStats')));
  await page.fill('#mnSearchInput', ''); await page.waitForTimeout(400);
  const globeFrame = page.frame({ url: /action-globe\.html/ });
  const controls = await globeFrame.$$eval('.globe-controls button', (a) => a.map((b) => b.id));
  await globeFrame.click('#ctlLayers');
  const night = await globeFrame.getAttribute('#ctlLayers', 'title');
  await globeFrame.click('#ctlLayers');
  const street = await globeFrame.getAttribute('#ctlLayers', 'title');
  await globeFrame.click('#ctlLayers');
  check(scope, 'globe controls: world, locate, zoom in/out, a layers switch that cycles Earth, night and street, and (for a creator) the audience layer', JSON.stringify(controls) === JSON.stringify(['ctlWorld', 'ctlLocate', 'ctlZoomIn', 'ctlZoomOut', 'ctlLayers', 'ctlAudience']) && /^Night Earth/.test(night) && /^Street map/.test(street) && (await globeFrame.getAttribute('#ctlLayers', 'aria-pressed')) === 'false' && await globeFrame.isVisible('#ctlAudience'), { controls, night, street });
  // Analytics for a creator: an optional layer on the same globe, from the Worker's measurement
  await globeFrame.click('#ctlAudience');
  await page.waitForFunction(() => /Your audience, last 30 days/.test(document.getElementById('mnWorldCaption').textContent), null, { timeout: 8000 }).catch(() => {});
  const audienceLine = await page.textContent('#mnWorldCaption');
  const audiencePins = await globeFrame.evaluate(() => window.__huAudienceCount());
  check(scope, 'a creator turns on the audience layer: country points on the globe and a measured summary', audiencePins === 2 && /49 views of your creator page from 2 countries, and 4 from places with under 5 views or unknown/.test(audienceLine) && req(world, 'GET', /^\/v1\/analytics\/my-creator$/).every((r) => r.auth), { audiencePins, audienceLine });
  await page.screenshot({ path: join(OUT, 'member-iphone-creator-audience.png') });
  await globeFrame.click('#ctlAudience');
  await page.waitForTimeout(300);
  check(scope, 'turning it off clears the points', (await globeFrame.evaluate(() => window.__huAudienceCount())) === 0);
  await page.screenshot({ path: join(OUT, 'member-iphone-mission-card.png') });

  check(scope, 'Time rewind is tucked away: no panel on the screen', (await page.$$('[data-rewind], #mnRewind')).length === 0);

  // Clips: a door at the top of the feed while campaigns are open, with the real terms
  await page.waitForSelector('#mnClipDoor:not([hidden])', { timeout: 8000 }).catch(() => {});
  const clipLine = await page.textContent('#mnClipDoor');
  check(scope, 'Clips: the door shows the clipping campaigns with real terms, without a tab to find it under', /1 campaign open · from \$3\.00 per 1,000 views/.test(clipLine) && await page.isVisible('#mnClipDoor'), clipLine);

  // Live: a badge over the globe while something is on air, opening the live rooms
  await page.waitForSelector('#mnWorldLive:not([hidden])', { timeout: 8000 }).catch(() => {});
  check(scope, 'Live: the badge over the globe shows while a room is on air', await page.isVisible('#mnWorldLive'));
  await page.screenshot({ path: join(OUT, 'member-iphone-live-badge.png') });
  await page.click('#mnWorldLive');
  await page.waitForSelector('#mnLiveView:not([hidden])');
  check(scope, 'Live: tapping it opens the live rooms, with the way back to the World', /Mill River cleanup, live|River room/.test(await page.textContent('#mnLiveTrack')) && await page.isVisible('#mnToWorld'));
  await page.click('#mnToWorld');
  await page.waitForSelector('#mnFeedView:not([hidden])');

  // Create: one tap from the folded composer
  check(scope, 'Create: the folded composer has a visible Record or create button', (await page.isVisible('#mnComposer .mn__create')) && (await page.getAttribute('#mnComposer .mn__create', 'href')) === 'create.html');

  // Alerts: the bell carries the count and opens them
  check(scope, 'Alerts: the bell shows the unread count', (await page.isVisible('#mnNotifBadge')) && (await page.textContent('#mnNotifBadge')).trim() === '1');
  await page.click('#mnBell');
  await page.waitForSelector('#mnNotificationsView:not([hidden])');
  /* the list and the read receipt are two round trips; wait for both rather than a fixed beat */
  await page.waitForFunction(() => /Fixture Ana liked your post/.test(document.getElementById('mnNotifications').textContent) && document.getElementById('mnNotifBadge').hidden, null, { timeout: 10000 }).catch(() => {});
  check(scope, 'Alerts: the bell opens them and clears the count', /Fixture Ana liked your post/.test(await page.textContent('#mnNotifications')) && await page.isHidden('#mnNotifBadge'));
  await page.click('#mnToWorld');
  await page.waitForSelector('#mnFeedView:not([hidden])');

  // Groups from search: a matching group opens directly
  await page.fill('#mnSearchInput', 'keepers');
  await page.waitForSelector('#mnSuggest [data-suggest="group"]', { timeout: 8000 });
  await page.click('#mnSuggest [data-suggest="group"]');
  await page.waitForSelector('#mnGroupsOne:not([hidden])');
  check(scope, 'Groups: a group found in search opens', req(world, 'GET', /^\/v1\/mnet\/groups\/river-keepers$/).length === 1);
  await page.click('#mnToWorld');
  await page.waitForSelector('#mnFeedView:not([hidden])');
  // People from search: the full people search, with the words carried over
  await page.fill('#mnSearchInput', 'ana');
  await page.waitForSelector('#mnSuggest [data-suggest="person"]', { timeout: 8000 });
  check(scope, 'People: members who match appear as you type', /Fixture Ana/.test(await page.textContent('#mnSuggest')));
  await page.click('#mnSuggest [data-suggest="people"]');
  await page.waitForSelector('#mnDiscoverView:not([hidden])');
  await page.waitForTimeout(400);
  check(scope, 'People: "Search people" opens the people search with the words carried over', (await page.inputValue('#mnDiscoverQuery')) === 'ana' && /Fixture Ana/.test(await page.textContent('#mnDiscoverResults')));
  await page.click('#mnToWorld');
  await page.waitForSelector('#mnFeedView:not([hidden])');
  await page.fill('#mnSearchInput', ''); await page.waitForTimeout(300);

  // The account menu: whose account, View profile, Messages, Settings & account, Sign out
  await page.click('#mnMe');
  const rooms = await page.$$eval('#mnMenu button, #mnMenu a', (a) => a.map((x) => { const c = x.cloneNode(true); c.querySelectorAll('.mn__badge').forEach((b) => b.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); }));
  check(scope, 'the avatar opens a compact account menu: four entries and nothing else', JSON.stringify(rooms) === JSON.stringify(['View profile', 'Messages', 'Settings & account', 'Sign out']), rooms);
  check(scope, 'a waiting message request shows on the avatar and on Messages, without opening Messages', (await page.isVisible('#mnMeDot')) && (await page.textContent('#mnMessageBadge')).trim() === '1');
  check(scope, 'the account menu says whose account it is', (await page.textContent('#mnMenuName')) === 'Fixture You' && (await page.textContent('#mnMenuHandle')) === '@fixture.you');
  check(scope, 'Settings & account is the M Account', (await page.getAttribute('#mnMenu a', 'href')) === 'account.html?stay=1');
  await page.screenshot({ path: join(OUT, 'member-iphone-account-menu.png') });
  await page.click('#mnMenu [data-mn-view="profile"]');
  await page.waitForSelector('#mnProfileView:not([hidden])');
  await page.waitForSelector('#mnProfileAnalytics:not([hidden])', { timeout: 8000 }).catch(() => {});
  check(scope, 'a creator finds their analytics on their profile; the Action Record and block list are there too', (await page.isVisible('#mnProfileAnalytics')) && (await page.isVisible('#mnProfileRecord')) && (await page.isVisible('#mnProfileBlocked')));
  await page.click('#mnToWorld');
  await page.waitForSelector('#mnFeedView:not([hidden])');
  check(scope, 'no page errors', errors.length === 0, errors);

  // Sign out: the session ends and the World reopens as a guest
  await page.click('#mnMe');
  await Promise.all([page.waitForURL(/\/mnet\.html$/, { timeout: 15000 }), page.click('#mnSignOut')]);
  await page.waitForSelector('#mnGuestBar:not([hidden])', { timeout: 20000 });
  check(scope, 'Sign out ends the session and reopens the World as a guest', !(await page.evaluate(() => localStorage.getItem('mccdb_session'))) && await page.isVisible('#mnGuestBar'));
  await ctx.close();
}

/* ---------- the data layers (owner, 2026-10-15): flights for everyone with the Vaunt lead; satellites and launches for members ---------- */
if (runs('layers-member')) {
  const { ctx, page, world, errors } = await open(DEVICES[0], { member: true });
  const scope = 'layers-member';
  const globe = page.frame({ url: /action-globe\.html/ });
  const locks = await globe.$$eval('.globe-data .globe-ctl', (a) => a.map((b) => ({ id: b.id, locked: b.classList.contains('is-locked'), disabled: b.getAttribute('aria-disabled') })));
  check(scope, 'a member sees three toggles, none locked', locks.length === 3 && locks.every((l) => !l.locked && l.disabled === 'false'), locks);
  await globe.click('#ctlFlights');
  await globe.waitForFunction(() => window.__huLayerOn && window.__huLayerOn('flights'), null, { timeout: 15000 });
  await page.waitForFunction(() => !document.getElementById('mnWorldLayers').hidden, null, { timeout: 5000 });
  let line = await page.$eval('#mnWorldLayers', (p) => ({ text: p.textContent, lead: p.querySelector('a.mn__world-lead') && { href: p.querySelector('a.mn__world-lead').href, target: p.querySelector('a.mn__world-lead').target, rel: p.querySelector('a.mn__world-lead').rel, text: p.querySelector('a.mn__world-lead').textContent } }));
  check(scope, 'Flights draws the aircraft and the line over the Earth counts them', (await globe.evaluate(() => window.__huLayerCounts().flights)) === 3 && /3 aircraft in the air right now/.test(line.text), line.text);
  check(scope, 'Flights carries the owner\'s Vaunt lead: Fly Vaunt, the referral link, a new tab', !!line.lead && line.lead.href === 'https://vauntapi.flyvaunt.com/referral/nuao1K' && line.lead.target === '_blank' && /noopener/.test(line.lead.rel) && line.lead.text === 'Fly Vaunt →', line.lead);
  const flightsReq = req(world, 'GET', /^\/v1\/world\/layers\/flights$/);
  check(scope, 'the flights read is public: no session sent', flightsReq.length === 1 && !flightsReq[0].auth, flightsReq);
  await globe.click('#ctlSats');
  await globe.waitForFunction(() => window.__huLayerOn && window.__huLayerOn('satellites'), null, { timeout: 20000 });
  const sats = await globe.evaluate(() => ({ count: window.__huLayerCounts().satellites, lib: !!window.satellite, labels: [...document.querySelectorAll('canvas')].length > 0 }));
  check(scope, 'Satellites loads SGP4 on first use and propagates every element set it was given', sats.count === 2 && sats.lib, sats);
  await globe.click('#ctlLaunch');
  await globe.waitForFunction(() => window.__huLayerOn && window.__huLayerOn('launches'), null, { timeout: 15000 });
  check(scope, 'Launches pins every launch with a pad', (await globe.evaluate(() => window.__huLayerCounts().launches)) === 2);
  const gated = req(world, 'GET', /^\/v1\/world\/layers\/(satellites|launches)$/);
  check(scope, 'the members-only reads carried the session', gated.length === 2 && gated.every((r) => r.auth), gated);
  line = await page.$eval('#mnWorldLayers', (p) => p.textContent);
  check(scope, 'the line names all three, with the next launch', /3 aircraft/.test(line) && /2 satellites overhead, moving live/.test(line) && /2 launches coming up · next: Falcon 9 Block 5 · Oct 16 · Cape Canaveral/.test(line), line);
  const credits = await globe.$eval('#layerCredits', (c) => c.textContent);
  check(scope, 'each source is credited on the imagery line while it is on', /Flights: OpenSky/.test(credits) && /Satellites: CelesTrak/.test(credits) && /Launches: The Space Devs/.test(credits), credits);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(OUT, 'member-iphone-layers.png') });
  const fit = await split(page);
  check(scope, 'nothing scrolls sideways with the layers on', fit.scrollW === fit.clientW, fit);
  await globe.click('#ctlFlights');
  await globe.waitForFunction(() => window.__huLayerOn && !window.__huLayerOn('flights'), null, { timeout: 5000 });
  line = await page.$eval('#mnWorldLayers', (p) => p.textContent);
  check(scope, 'switching Flights off clears its points and its line, the others stay', (await globe.evaluate(() => window.__huLayerCounts().flights)) === 0 && !/aircraft/.test(line) && /satellites/.test(line), line);
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}
/* ---------- A MEMBER WHOSE WORLD DID NOT LOAD STILL GETS THE WORLD (owner, 2026-10-15: "when I'm logged in as Benji Chase … not seeing
   the globe"). On the live site every member's bootstrap was refused by the browser (the API answered its preflight 401); the page then
   showed a shell with no globe. Whatever fails, the Earth opens. ---------- */
const worldState = (page) => page.evaluate(() => {
  const q = (s) => document.querySelector(s), shown = (s) => { const el = q(s); return !!el && !el.hidden && getComputedStyle(el).display !== 'none'; };
  return { feedView: shown('#mnFeedView'), world: q('#mnWorld') ? Math.round(q('#mnWorld').getBoundingClientRect().height) : 0, frame: !!q('#mnWorldFrame'), card: shown('#mnFinishCard'), title: (q('#mnFinishTitle') || {}).textContent, go: (q('#mnFinishGo') || {}).textContent, alt: shown('#mnStallSignIn'), composer: shown('#mnComposer'), guestCard: shown('#mnGuestCard'), guest: document.documentElement.classList.contains('mn-guest'), stored: !!localStorage.getItem('mccdb_session'), posts: document.querySelectorAll('#mnFeed [data-post-id]').length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
});
for (const variant of [{ scope: 'stall-retry', bootFail: [500] }, { scope: 'stall-signin', bootFail: [401] }, { scope: 'stall-unverified', userCheck: 403 }]) {
  if (!runs(variant.scope)) continue;
  const { ctx, page, world, errors } = await open(DEVICES[0], { member: true, bootFail: variant.bootFail || [], userCheck: variant.userCheck || 0 });
  const scope = variant.scope;
  const globe = page.frame({ url: /action-globe\.html/ });
  const canvas = globe ? await globe.evaluate(() => { const c = document.querySelector('canvas'); return c ? Math.round(c.getBoundingClientRect().height) : 0; }) : 0;
  let st = await worldState(page);
  check(scope, 'the World opens anyway: the feed view, the Earth in its frame, the public posts', st.feedView && st.world > 200 && st.frame && canvas > 200 && st.posts > 0, { ...st, canvas });
  const reads = req(world, 'GET', /^\/v1\/mnet\/(public-feed|feed)$/);
  check(scope, 'the posts are the public ones, read without the session', reads.length > 0 && reads.every((r) => r.path === '/v1/mnet/public-feed' && !r.auth), reads.map((r) => r.path + (r.auth ? '+auth' : '')));
  if (scope === 'stall-signin') {
    check(scope, 'the session the API refused is let go: a guest, one card to sign in again, not the guest card beside it', !st.stored && st.guest && st.card && st.title === 'Your sign-in ended.' && /Sign in again/.test(st.go) && !st.alt && !st.guestCard && !st.composer, st);
    await page.screenshot({ path: join(OUT, 'stall-signin-iphone.png') });
    await page.click('#mnFinishGo');
    await page.waitForSelector('#mnSignedOut:not([hidden])', { timeout: 8000 });
    check(scope, 'the card opens sign-in with the reason', /Your sign-in ended\. Sign in again\./.test(await page.textContent('#mnGuestWhy')));
  } else {
    check(scope, 'the session stays; the card says the feed did not load, with Try again and Sign in again; the composer waits', st.stored && !st.guest && st.card && st.title === 'Your feed didn’t load.' && /Try again/.test(st.go) && st.alt && !st.composer, st);
    await page.screenshot({ path: join(OUT, scope + '-iphone.png') });
    if (scope === 'stall-retry') {
      await page.click('#mnFinishGo');
      await page.waitForFunction(() => document.getElementById('mnFinishCard').hidden, null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
      st = await worldState(page);
      const memberRead = req(world, 'GET', /^\/v1\/mnet\/feed$/).some((r) => r.auth);
      check(scope, 'Try again: the bootstrap answers, the card goes, the composer is back, the feed is the member\'s own, the Earth never left', !st.card && st.composer && memberRead && st.world > 200, { st, memberRead });
    }
  }
  check(scope, 'nothing scrolls sideways at 390', st.sw === st.cw, { sw: st.sw, cw: st.cw });
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

if (runs('layers-guest')) {
  const { ctx, page, world, errors } = await open(DEVICES[0], { member: false });
  const scope = 'layers-guest';
  const globe = page.frame({ url: /action-globe\.html/ });
  const locks = await globe.$$eval('.globe-data .globe-ctl', (a) => a.map((b) => ({ id: b.id, locked: b.classList.contains('is-locked'), disabled: b.getAttribute('aria-disabled') })));
  check(scope, 'a guest sees Flights open and Satellites and Launches locked', locks.length === 3 && !locks[0].locked && locks[1].locked && locks[2].locked, locks);
  await globe.$eval('#ctlSats', (b) => b.click());   /* aria-disabled, so Playwright's own click would wait forever; a tap does this */
  await page.waitForSelector('#mnSignedOut:not([hidden])', { timeout: 10000 });
  check(scope, 'a locked layer opens sign-in with the reason, and sends nothing', /Sign in to see satellites and space missions/.test(await page.textContent('#mnGuestWhy')) && req(world, 'GET', /^\/v1\/world\/layers\/(satellites|launches)$/).length === 0, await page.textContent('#mnGuestWhy'));
  await page.click('#mnSignedOutBack');
  await page.waitForSelector('#mnFeed [data-post-id]');
  await globe.click('#ctlFlights');
  await globe.waitForFunction(() => window.__huLayerOn && window.__huLayerOn('flights'), null, { timeout: 15000 });
  await page.waitForFunction(() => !document.getElementById('mnWorldLayers').hidden, null, { timeout: 5000 });
  const line = await page.$eval('#mnWorldLayers', (p) => ({ text: p.textContent, lead: p.querySelector('a.mn__world-lead') && p.querySelector('a.mn__world-lead').href }));
  check(scope, 'a guest turns Flights on and meets the Vaunt lead', /3 aircraft in the air right now/.test(line.text) && line.lead === 'https://vauntapi.flyvaunt.com/referral/nuao1K', line);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, 'guest-iphone-layers.png') });
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* ---------- THE FULL WORLD (owner, 2026-10-15: "if they click the world, it'll allow them to see that in a full pane … without
   the whole 30, 40 rule"): "Full world ↗" opens action-globe.html?explore=1 on its own, the Earth edge to edge ---------- */
async function openExplore(device, { member }) {
  const world = freshWorld();
  const ctx = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 2, isMobile: device.mobile, hasTouch: device.mobile });
  await ctx.addInitScript((m) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() }));
    if (m && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); const exp = Math.floor(Date.now() / 1000) + 3600; localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp })).replace(/=+$/, '') + '.y', refresh_token: 'r', expires_at: exp })); }
  }, member);
  await routeBackends(ctx, world, { member, creator: false, verified: false });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/TypeError|ReferenceError|SyntaxError/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.goto(BASE + '/action-globe.html?explore=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 60000 }).catch(() => {});
  await page.waitForSelector('.appbar', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return { ctx, page, world, errors };
}
const rects = (page) => page.evaluate(() => {
  const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height), w: Math.round(b.width), shown: cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && b.height > 0 }; };
  return { vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, globe: r('#globe'), back: r('#worldBack'), strong: r('header strong'), mode: r('.world-mode'), tools: r('.world-tools'), feed: r('#worldFeed'), deck: r('#deck'), data: r('.globe-data'), controls: r('.globe-controls'), credit: r('.osm-credit'), bar: r('.appbar'), line: r('#exploreLine'), vars: { bar: getComputedStyle(document.documentElement).getPropertyValue('--hu-bar-h').trim(), sheet: getComputedStyle(document.documentElement).getPropertyValue('--hu-sheet-h').trim() } };
});
/* a swipe up on the sheet steps to the next mission, as the deck always has; this is how a pin is chosen without aiming at Cesium */
const swipeSheet = (page) => page.evaluate(() => { const d = document.getElementById('deck'); const t = (y) => new Touch({ identifier: 1, target: d, clientX: 180, clientY: y }); d.dispatchEvent(new TouchEvent('touchstart', { touches: [t(600)], bubbles: true })); d.dispatchEvent(new TouchEvent('touchend', { changedTouches: [t(500)], bubbles: true })); });
for (const member of [false, true]) {
  const scope = 'explore-' + (member ? 'member' : 'guest');
  if (!runs(scope)) continue;
  const { ctx, page, world, errors } = await openExplore(DEVICES[0], { member });
  check(scope, 'the page stays its own: no hand-over to the World screen', /action-globe\.html\?explore=1$/.test(page.url()), page.url());
  let r = await rects(page);
  check(scope, 'the Earth is edge to edge: the globe fills the viewport', r.globe && r.globe.top === 0 && r.globe.left === 0 && r.globe.w === r.vw && r.globe.h === r.vh, { globe: r.globe, vw: r.vw, vh: r.vh });
  check(scope, 'the old 45/15/35 chrome stays home: no Map/Missions switch, no tool row, no story feed, no banner', (!r.mode || !r.mode.shown) && (!r.tools || !r.tools.shown) && (!r.feed || !r.feed.shown) && (!r.strong || !r.strong.shown), { mode: r.mode, tools: r.tools, feed: r.feed, strong: r.strong });
  check(scope, 'the way back is the World, top left', r.back && r.back.shown && r.back.top < 60 && r.back.left < 30 && (await page.$eval('#worldBack', (a) => a.textContent.trim() + ' ' + a.getAttribute('href'))) === '← World mnet.html?view=feed', r.back);
  check(scope, 'the bar is measured where its top is and the sheet sits on it', r.bar && r.bar.shown && Math.abs(parseFloat(r.vars.bar) - (r.vh - r.bar.top)) <= 1 && r.deck && r.deck.shown && Math.abs(r.deck.bottom - r.bar.top) <= 1, { bar: r.bar, deck: r.deck, vars: r.vars, vh: r.vh });
  check(scope, 'the sheet is compact until a pin is chosen: a hint, under a third of the screen', r.deck.h < r.vh / 3 && /Tap a pin/.test(await page.$eval('#worldFilters p', (p) => p.textContent)), { deck: r.deck, vh: r.vh });
  const stacked = (r) => r.data && r.controls && r.credit && r.deck && r.data.shown && r.controls.shown && r.credit.shown && r.data.bottom <= r.credit.top + 1 && r.controls.bottom <= r.credit.top + 1 && r.credit.bottom <= r.deck.top + 1 && r.data.left >= 0 && r.controls.right <= r.vw;
  check(scope, 'the toggles and the controls float above the credit, the credit above the sheet, all on screen', stacked(r), { data: r.data, controls: r.controls, credit: r.credit, deck: r.deck });
  /* choose a pin: the sheet grows with the mission and everything above it lifts */
  await swipeSheet(page);
  await page.waitForSelector('#mission:not([hidden])', { timeout: 10000 });
  await page.waitForTimeout(600);
  r = await rects(page);
  const mission = await page.evaluate(() => ({ title: document.getElementById('title').textContent, join: document.getElementById('missionLink').getAttribute('href'), read: getComputedStyle(document.getElementById('openFeed')).display }));
  check(scope, 'a chosen pin opens its mission in the sheet, with the join leading into the World and no "Read below"', MISSIONS.some((m) => m.title === mission.title && mission.join === 'mnet.html?mission=' + m.mission_id) && mission.read === 'none', mission);
  const row = await page.evaluate(() => { const d = document.getElementById('deck').getBoundingClientRect(), j = document.getElementById('missionLink').getBoundingClientRect(); return { sheetBottom: Math.round(d.bottom), joinBottom: Math.round(j.bottom), joinTop: Math.round(j.top), scrolled: document.getElementById('deck').scrollHeight - document.getElementById('deck').clientHeight }; });
  check(scope, 'the sheet grew to the mission: the join and the prev/next row are inside it, nothing clipped or scrolled', r.deck.h > 160 && r.vars.sheet === r.deck.h + 'px' && stacked(r) && row.joinBottom <= row.sheetBottom && row.joinTop > 0 && row.scrolled === 0, { deck: r.deck, vars: r.vars, row });
  /* the data layers, on their own page */
  await page.click('#ctlFlights');
  await page.waitForFunction(() => window.__huLayerOn && window.__huLayerOn('flights'), null, { timeout: 15000 });
  await page.waitForSelector('#exploreLine:not([hidden])', { timeout: 5000 });
  const line = await page.$eval('#exploreLine', (p) => ({ text: p.textContent, lead: p.querySelector('a.explore-lead') && p.querySelector('a.explore-lead').href }));
  check(scope, 'Flights on: the line over the Earth counts the aircraft and carries the Vaunt lead, with no parent page to do it', /3 aircraft in the air right now/.test(line.text) && line.lead === 'https://vauntapi.flyvaunt.com/referral/nuao1K', line);
  r = await rects(page);
  check(scope, 'the line sits above the toggles, on screen', r.line && r.line.shown && r.line.bottom <= r.data.top + 1 && r.line.top > 40, { line: r.line, data: r.data });
  await page.$eval('#ctlSats', (b) => b.click());
  if (member) {
    await page.waitForFunction(() => window.__huLayerOn && window.__huLayerOn('satellites'), null, { timeout: 15000 });
    const both = await page.$eval('#exploreLine', (p) => p.textContent);
    check(scope, 'a member turns Satellites on too, and the line says both', /3 aircraft/.test(both) && /2 satellites overhead, moving live/.test(both), both);
  } else {
    await page.waitForFunction(() => /Sign in to see satellites/.test(document.getElementById('exploreLine').textContent), null, { timeout: 5000 });
    check(scope, 'a guest\'s locked layer says so on the line, offers sign-in, and sends nothing', req(world, 'GET', /^\/v1\/world\/layers\/(satellites|launches)$/).length === 0 && (await page.$eval('#exploreLine a', (a) => a.getAttribute('href'))) === 'account.html?stay=1');
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, scope + '-iphone.png') });
  r = await rects(page);
  check(scope, 'nothing scrolls sideways at 390', r.sw === r.cw, { sw: r.sw, cw: r.cw });
  if (member) {
    await page.setViewportSize(DEVICES[4].viewport);
    await page.waitForTimeout(1200);
    r = await rects(page);
    check(scope, 'on a desktop the Earth still fills the pane, the sheet narrows and centres, and the stack holds', r.globe.w === r.vw && r.globe.h === r.vh && r.deck.w <= 620 && Math.abs((r.deck.left + r.deck.right) / 2 - r.vw / 2) <= 2 && stacked(r), { globe: r.globe, deck: r.deck, vw: r.vw });
    await page.screenshot({ path: join(OUT, scope + '-desktop.png') });
  }
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* ---------- member, no creator profile: no analytics door ---------- */
if (runs('member-not-creator')) {
  const { ctx, page, world, errors } = await open(DEVICES[0], { member: true, creator: false, verified: false });
  const scope = 'member-not-creator';
  void world;
  await page.click('#mnMe');
  await page.click('#mnMenu [data-mn-view="profile"]');
  await page.waitForSelector('#mnProfileView:not([hidden])');
  await page.waitForTimeout(1000);
  check(scope, 'a member without a music creator profile sees no analytics door', await page.isHidden('#mnProfileAnalytics'));
  const plainGlobe = page.frame({ url: /action-globe\.html/ });
  check(scope, '…and no audience layer switch on the globe', await plainGlobe.isHidden('#ctlAudience'));
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* ---------- guest, iPhone and iPad: the same World, read-only ---------- */
for (const device of [DEVICES[0], DEVICES[2]]) {
  if (!runs('guest-')) continue;
  const { ctx, page, world, errors } = await open(device, { member: false });
  const scope = 'guest-' + device.name;
  const reads = req(world, 'GET', /^\/v1\/mnet\/public-feed$/);
  check(scope, 'reads /v1/mnet/public-feed and sends no session', reads.length > 0 && reads.every((r) => !r.auth), reads);
  const texts = await page.$$eval('#mnFeed [data-post-id]', (a) => a.map((x) => x.textContent));
  check(scope, 'shows public member posts, never network-only ones', texts.length === 8 && !texts.some((t) => /Network-only/.test(t)), texts.length);
  check(scope, 'the composer is replaced by "Member posts live here." and a way in', !(await page.isVisible('#mnComposer')) && await page.isVisible('#mnGuestCard') && /Member posts live here\./.test(await page.textContent('#mnGuestCard')));
  check(scope, 'a guest opens on Explore the world, with Missions, Regional impact, Policy and Near me', (await page.isVisible('#mnWorldIdle')) && (await page.isHidden('#mnWorldFocus')) && /Find a mission or region/.test(await page.textContent('#mnWorldIdle')) &&
    JSON.stringify(await page.$$eval('.mn__world-chips > *', (a) => a.map((x) => x.textContent.replace(/\s+/g, ' ').trim().replace(/ \d+$/, '')))) === JSON.stringify(['Missions', 'Regional impact', 'Policy ↗', 'Near me']));
  check(scope, 'a guest sees that a post has photos, never where they live', (await page.$$eval('#mnFeed .mn__media-locked', (a) => a.length)) === 2 && !world.requests.some((r) => /\/media\//.test(r.path)));
  const s = await split(page);
  check(scope, 'same composition as a member: globe, strip and feed on one screen', s.feedTop < s.vh - 60 && s.globe >= 44 && s.context <= 17 && s.feed >= 26 && s.scrollW === s.clientW, s);
  await page.screenshot({ path: join(OUT, `guest-${device.name}.png`) });
  await page.click('[data-world-chip="regional"]');
  await page.waitForFunction(() => /Regional impact is hidden/.test(document.getElementById('mnWorldCaption').textContent), null, { timeout: 8000 }).catch(() => {});
  check(scope, 'Regional impact switches the counted regions on the globe and says so', (await page.getAttribute('[data-world-chip="regional"]', 'aria-pressed')) === 'false' && /Regional impact is hidden/.test(await page.textContent('#mnWorldCaption')));
  await page.click('[data-world-chip="regional"]');
  await page.click('[data-world-chip="missions"]');
  await page.waitForSelector('#mnWorldFocus:not([hidden])', { timeout: 8000 }).catch(() => {});
  check(scope, 'the Missions chip steps to a pinned mission on the globe', await page.isVisible('#mnWorldFocus'));
  await page.click('#mnWorldFocusFund');
  await page.waitForSelector('#mnWorldFocus .mn__fund-line a', { timeout: 8000 }).catch(() => {});
  check(scope, 'Fund on the mission card answers a guest too: the campaign\'s governed support rail', /governed support rail/.test((await page.textContent('#mnWorldFocus .mn__fund-line').catch(() => '')) || ''));
  await page.screenshot({ path: join(OUT, `guest-${device.name}-mission.png`) });
  await page.click('#mnWorldFocusFund');
  const guestSentEup = world.requests.length;
  const cardJoin = await page.$eval('#mnWorldFocusJoin', (b) => ({ text: b.textContent.trim(), label: b.getAttribute('aria-label'), imgs: b.querySelectorAll('img').length, box: b.getBoundingClientRect().toJSON() }));
  check(scope, 'the mission card\'s join is the emblem alone, a real tap target, with no words', cardJoin.text === '' && cardJoin.label === 'Join this mission and do it' && cardJoin.imgs === 1 && cardJoin.box.height >= 36 && cardJoin.box.width >= 44 && !/E\s*=\s*Up/i.test(await page.evaluate(() => document.body.innerText)), cardJoin);
  await page.click('#mnWorldFocusJoin');
  await page.waitForSelector('#mnSignedOut:not([hidden])');
  check(scope, 'the emblem as a guest opens sign-in with the reason, and sends nothing', /Sign in to join this mission/.test(await page.textContent('#mnGuestWhy')) && world.requests.slice(guestSentEup).every((r) => !/posts|missions/.test(r.path)));
  await page.click('#mnSignedOutBack');
  await page.waitForSelector('#mnFeed [data-post-id]');
  await page.waitForSelector('#mnWorldFocus:not([hidden])', { timeout: 8000 }).catch(() => {});
  await page.click('#mnWorldFocusClear');
  await page.fill('#mnSearchInput', 'ana');
  await page.waitForSelector('#mnSuggest [data-suggest="people"]', { timeout: 8000 });
  const guestSent = world.requests.length;
  await page.click('#mnSuggest [data-suggest="people"]');
  await page.waitForSelector('#mnSignedOut:not([hidden])');
  check(scope, 'people search asks a guest to sign in and sends nothing', /Sign in to search for people/.test(await page.textContent('#mnGuestWhy')) && world.requests.slice(guestSent).every((r) => !/discover|groups/.test(r.path)));
  await page.click('#mnSignedOutBack');
  await page.waitForSelector('#mnFeed [data-post-id]');
  await page.fill('#mnSearchInput', ''); await page.waitForTimeout(300);
  const first = await page.getAttribute('#mnFeed [data-post-id]', 'data-post-id');
  const sent = world.requests.length;
  check(scope, 'a guest\'s cards carry Share and Save only: no like, comment or reaction, and no mission tie (those need a session)', !(await page.$('#mnFeed [data-action=like], #mnFeed [data-action=comments], #mnFeed [data-action=uprise], #mnFeed [data-take-mission], #mnFeed [data-fund-mission]')));
  await page.click(`#mnFeed [data-post-id="${first}"] [data-action=save]`);
  await page.waitForSelector('#mnSignedOut:not([hidden])');
  check(scope, 'Save opens sign-in with a reason, and nothing is sent', /Sign in to save posts/.test(await page.textContent('#mnGuestWhy')) && world.requests.slice(sent).every((r) => !/bookmarks|reactions|replies|posts$/.test(r.path)));
  await page.screenshot({ path: join(OUT, `guest-${device.name}-sign-in.png`) });
  await page.click('#mnSignedOutBack');
  await page.waitForSelector('#mnFeed [data-post-id]');
  await page.click(`#mnFeed [data-post-id="${first}"] [data-action=share]`);
  check(scope, 'Share still works for a guest (every guest post is public)', (await page.evaluate(() => window.__shared.at(-1) || '')).includes('post=' + first));
  const bar = await page.$$eval('.appbar [data-appnav]', (a) => a.map((x) => x.getAttribute('data-appnav')));
  check(scope, 'guest app bar is the same Music | M | Globe', JSON.stringify(bar) === JSON.stringify(['music', 'home', 'world']), bar);
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
await writeFile(join(OUT, 'world-screen-e2e.json'), JSON.stringify({ ran_at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots and report in ${OUT}`);
process.exit(failed.length ? 1 : 0);
