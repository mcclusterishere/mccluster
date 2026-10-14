/* Human Uprise World screen, end to end in a real browser.

   Owner's contract: docs/action-network/WORLD-SCREEN-UX-HANDOFF-20261014.md.
   Serves this checkout, puts a fake in front of api.mccluster.org and
   Supabase (an in-memory feed with real request handling, so every
   interaction is a round trip whose request is checked), and drives:

     member: the composition on iPhone / iPad / desktop, posting, Like and
             unlike, comments, Share, the avatar menu, pin -> context strip
             and narrowed feed, post -> globe without narrowing, the
             three-column app bar;
     guest:  the same World, read-only through /v1/mnet/public-feed with no
             session sent, every member action opening sign-in and sending
             nothing, Share still working.

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

async function routeBackends(ctx, world, { member }) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => {
    const u = route.request().url();
    if (u.includes('/auth/v1/user')) return member ? json(route, { id: 'auth-you', email: 'fixture@example.invalid' }) : json(route, { msg: 'no session' }, 401);
    if (u.includes('action_globe_public_region_missions')) return json(route, MISSIONS);
    if (u.includes('action_mission_stats')) return json(route, STATS);
    if (u.includes('action_offer_cards')) {
      const linked = world.posts.filter((p) => p.content_id === CONTENT);
      return json(route, linked.map((p) => ({ post_id: p.id, mission_id: M1, content_id: CONTENT, title: MISSIONS[0].title, description: MISSIONS[0].description, mission_open: true })));
    }
    return json(route, []);
  });
  await ctx.route('https://api.mccluster.org/**', async (route) => {
    const req = route.request(), u = new URL(req.url()), m = req.method(), auth = req.headers().authorization || '';
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    world.requests.push({ m, path: u.pathname, auth: !!auth, body });
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': BASE, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,DELETE' } });
    if (u.pathname === '/v1/mnet/public-feed') {
      if (auth) return json(route, { error: 'a guest read carries no session' }, 400);
      const pub = world.posts.filter((p) => p.visibility === 'public').map((p) => { const x = item(p); delete x.post.author_m_uid; delete x.post.content_id; x.post.media_locked = x.post.media.length; delete x.post.media; return x; });
      return json(route, { items: pub, scope: 'public', next_before: null });
    }
    if (!/^Bearer \S+/.test(auth)) return json(route, { error: 'Authentication required' }, 401);
    if (u.pathname === '/v1/mnet/bootstrap') return json(route, { identity: { m_uid: ME.m_uid, mccluster_id: ME.mccluster_id }, profile: { display_name: ME.display_name, mccluster_id: ME.mccluster_id }, next_step: null, tour_done_at: new Date().toISOString() });
    if (u.pathname === '/v1/mnet/feed') return json(route, { items: world.posts.map(item), next_before: null });
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
      if (!p || body?.reaction !== 'like') return json(route, { error: 'bad reaction' }, 400);
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
  return { globe: pct(g.height), context: pct(c.height), feed: pct(f.height), feedTop: Math.round(f.top), feedBottom: Math.round(f.bottom), vh: h, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
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

async function open(device, { member }) {
  const world = freshWorld();
  const ctx = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 2, isMobile: device.mobile, hasTouch: device.mobile });
  await ctx.addInitScript((m) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() }));
    if (m) { const exp = Math.floor(Date.now() / 1000) + 3600; localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp })).replace(/=+$/, '') + '.y', refresh_token: 'r', expires_at: exp })); }
    window.__shared = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__shared.push(d.url); return Promise.resolve(); } });
  }, member);
  await routeBackends(ctx, world, { member });
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

/* ---------- member, every device: composition and navigation ---------- */
for (const device of DEVICES) {
  const { ctx, page, world, errors } = await open(device, { member: true });
  const s = await split(page);
  check(device.name, 'opened on the World screen from action-globe.html', /mnet\.html\?view=feed/.test(page.url()));
  check(device.name, 'globe, context strip and a real post all on screen at first load', s.feedTop < s.vh - 60 && s.feedBottom <= s.vh && s.feedBottom - s.feedTop >= Math.min(120, s.vh * 0.25), s);
  /* the owner's split, upright: globe 45-50%, context ~15% (never inflated past 17), feed 26%+ */
  if (device.viewport.height > device.viewport.width) check(device.name, 'portrait split matches the contract', s.globe >= 44 && s.context <= 17 && s.feed >= 26, s);
  if (device.fit) check(device.name, 'one screen: the page does not scroll, the feed does', await page.evaluate(() => document.documentElement.classList.contains('mn-world-fit')), s);
  check(device.name, 'no sideways overflow', s.scrollW === s.clientW, s);
  check(device.name, 'the strip opens on the newest pinned mission, labelled as the latest', (await page.isVisible('#mnWorldFocusFlag')) && /Latest/.test(await page.textContent('#mnWorldFocusFlag')));
  const bar = await page.$$eval('.appbar [data-appnav], .appbar [data-member-tab]', (a) => a.map((x) => x.getAttribute('data-appnav') || 'member:' + x.getAttribute('data-member-tab')));
  check(device.name, 'app bar is exactly Music | M | Globe', JSON.stringify(bar) === JSON.stringify(['music', 'home', 'world']), bar);
  check(device.name, 'feed shows member posts (author, text, Like/Comment/Share), not mission cards', await page.evaluate(() => {
    const c = document.querySelector('#mnFeed [data-post-id]');
    return !!(c && c.querySelector('.mn__author-name') && c.querySelector('[data-action=like]') && c.querySelector('[data-action=comments]') && c.querySelector('[data-action=share]')) && !document.querySelector('#mnFeed .world-story');
  }));
  await page.screenshot({ path: join(OUT, `member-${device.name}.png`) });
  check(device.name, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* ---------- member, iPhone: the actual interactions ---------- */
{
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

  // Like, then unlike
  const target = world.posts.find((p) => p.author === PEERS[1] && p.visibility === 'public');
  const like = `#mnFeed [data-post-id="${target.id}"] [data-action=like]`;
  const before = Number((await page.textContent(`${like} .mn__count`)) || 0);
  await page.click(like); await page.waitForTimeout(400);
  const afterLike = Number((await page.textContent(`${like} .mn__count`)) || 0);
  const likeReq = req(world, 'POST', /\/reactions$/).at(-1);
  check(scope, 'Like sends POST …/reactions {reaction:"like"} and the count goes up', likeReq && likeReq.auth && likeReq.body.reaction === 'like' && afterLike === before + 1 && (await page.getAttribute(like, 'aria-pressed')) === 'true', { before, afterLike, likeReq });
  await page.click(like); await page.waitForTimeout(400);
  const afterUnlike = Number((await page.textContent(`${like} .mn__count`)) || 0);
  check(scope, 'Unlike sends DELETE …/reactions and the count goes back', req(world, 'DELETE', /\/reactions$/).length === 1 && afterUnlike === before, { afterUnlike });

  // Comment
  const card = `#mnFeed [data-post-id="${target.id}"]`;
  await page.click(`${card} [data-action=comments]`);
  await page.waitForSelector(`${card} .mn__comment-form input`);
  await page.fill(`${card} .mn__comment-form input`, 'E2E: a comment from the World screen');
  await page.click(`${card} .mn__comment-form button`);
  await page.waitForFunction((sel) => /E2E: a comment from the World screen/.test(document.querySelector(sel + ' .mn__comments-list')?.textContent || ''), card, { timeout: 10000 });
  const commentReq = req(world, 'POST', /\/replies$/).at(-1);
  check(scope, 'Comment sends an authenticated POST …/replies and appears in the thread', commentReq && commentReq.auth && commentReq.body.body === 'E2E: a comment from the World screen', commentReq);
  await page.screenshot({ path: join(OUT, 'member-iphone-after-like-and-comment.png') });

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
  await page.click('[data-feed-tab="media"]');
  const mediaPosts = await page.$$eval('#mnFeed [data-post-id]', (a) => a.length);
  await page.click('[data-feed-tab="music"]');
  const musicEmpty = await page.textContent('#mnFeed');
  await page.click('[data-feed-tab="all"]');
  check(scope, 'feed tabs filter by what posts carry (2 with photos; no tracks -> honest empty state)', mediaPosts === 2 && /No posts with a track/.test(musicEmpty), { mediaPosts });
  if (!(await page.isVisible('#mnSearchInput'))) await page.click('#mnSearchToggle');
  await page.fill('#mnSearchInput', 'river');
  await page.waitForTimeout(500);
  const searched = await page.$$eval('#mnFeed [data-post-id]', (a) => a.length);
  await page.press('#mnSearchInput', 'Enter');
  await page.waitForSelector('#mnWorldFocus:not([hidden])');
  check(scope, 'search narrows the feed as you type and Enter flies to the matching mission', searched === 1 && /Mill River/.test(await page.textContent('#mnWorldFocusTitle')), { searched });
  check(scope, 'the mission card shows public joined/verified counts', /12 joined · 9 verified/.test(await page.textContent('#mnWorldFocusStats')));
  await page.fill('#mnSearchInput', ''); await page.waitForTimeout(400);
  const globeFrame = page.frame({ url: /action-globe\.html/ });
  const controls = await globeFrame.$$eval('.globe-controls button', (a) => a.map((b) => b.id));
  await globeFrame.click('#ctlLayers');
  check(scope, 'globe controls: world, locate, zoom in/out and a night/street layer switch', JSON.stringify(controls) === JSON.stringify(['ctlWorld', 'ctlLocate', 'ctlZoomIn', 'ctlZoomOut', 'ctlLayers']) && (await globeFrame.getAttribute('#ctlLayers', 'aria-pressed')) === 'true', controls);
  await globeFrame.click('#ctlLayers');
  await page.screenshot({ path: join(OUT, 'member-iphone-mission-card.png') });

  // The avatar menu keeps every room
  await page.click('#mnMe');
  const rooms = await page.$$eval('#mnMenu [data-mn-view], #mnMenu a', (a) => a.map((x) => x.textContent.trim()));
  check(scope, 'profile, inbox, alerts, missions, people, groups, clips, live, create, analytics and account are behind the avatar', rooms.length === 11, rooms);
  await page.screenshot({ path: join(OUT, 'member-iphone-avatar-menu.png') });
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* ---------- guest, iPhone and iPad: the same World, read-only ---------- */
for (const device of [DEVICES[0], DEVICES[2]]) {
  const { ctx, page, world, errors } = await open(device, { member: false });
  const scope = 'guest-' + device.name;
  const reads = req(world, 'GET', /^\/v1\/mnet\/public-feed$/);
  check(scope, 'reads /v1/mnet/public-feed and sends no session', reads.length > 0 && reads.every((r) => !r.auth), reads);
  const texts = await page.$$eval('#mnFeed [data-post-id]', (a) => a.map((x) => x.textContent));
  check(scope, 'shows public member posts, never network-only ones', texts.length === 8 && !texts.some((t) => /Network-only/.test(t)), texts.length);
  check(scope, 'the composer is replaced by an invitation to sign in', !(await page.isVisible('#mnComposer')) && await page.isVisible('#mnGuestCard'));
  check(scope, 'a guest sees that a post has photos, never where they live', (await page.$$eval('#mnFeed .mn__media-locked', (a) => a.length)) === 2 && !world.requests.some((r) => /\/media\//.test(r.path)));
  const s = await split(page);
  check(scope, 'same composition as a member: globe, strip and feed on one screen', s.feedTop < s.vh - 60 && s.globe >= 44 && s.context <= 17 && s.feed >= 26, s);
  await page.screenshot({ path: join(OUT, `guest-${device.name}.png`) });
  const first = await page.getAttribute('#mnFeed [data-post-id]', 'data-post-id');
  const sent = world.requests.length;
  await page.click(`#mnFeed [data-post-id="${first}"] [data-action=like]`);
  await page.waitForSelector('#mnSignedOut:not([hidden])');
  check(scope, 'Like opens sign-in with a reason, and nothing is sent', /Sign in to like posts/.test(await page.textContent('#mnGuestWhy')) && world.requests.slice(sent).every((r) => !/reactions|replies|posts$/.test(r.path)));
  await page.screenshot({ path: join(OUT, `guest-${device.name}-sign-in.png`) });
  await page.click('#mnSignedOutBack');
  await page.waitForSelector('#mnFeed [data-post-id]');
  await page.click(`#mnFeed [data-post-id="${first}"] [data-action=comments]`);
  check(scope, 'Comment opens sign-in too', await page.isVisible('#mnSignedOut'));
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
