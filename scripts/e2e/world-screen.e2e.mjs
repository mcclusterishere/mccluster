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
             opening sign-in and sending nothing, Share still working;
     news:   the World's news (GDELT, ingested by the Worker and read from
             /v1/world/news with no session) one-for-one with the posts for a
             guest and a member, the GDELT credit, link-outs in a new tab, a
             story's place on the Earth, Load more on both streams, a failing
             news read that leaves the posts whole.

   Nothing here touches production. The fixture people and posts exist only
   in this file's memory.

   Run:  node scripts/e2e/world-screen.e2e.mjs [outDir]
   Needs Playwright (PLAYWRIGHT_DIR=/path/to/node_modules if it is not
   resolvable from here) and network access to the Cesium CDN and
   OpenStreetMap tiles. Exits non-zero on any failed check. */
import { createServer } from 'node:http';
import { withTravelAndMissions } from './world-switch.mjs';
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
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webm': 'video/webm' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try {
    let body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
    const type = TYPES[extname(path)] || 'application/octet-stream';
    /* the World as it ships is the social feed; the suites that guard Travel and Missions get them switched back on */
    if (/^[/\\]mnet\.html$/.test(path) && !/(?:^|; )world=social(?:;|$)/.test(req.headers.cookie || '')) body = Buffer.from(withTravelAndMissions(body));
    /* a video is read in ranges, the way storage serves it, so a player can seek */
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2])), end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 }); res.end(body.subarray(start, end + 1)); return;
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes' }); res.end(body);
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
const COHORT_ARCHIVE = JSON.parse(await readFile(join(ROOT, 'data/action/docket-516r-archive.json'), 'utf8'));
/* The table includes the pinned missions, an open mission without a pin
   (search must still find it), and a clip job (never a mission card).
   Public discovery requires an explicitly open status, just like the DB. */
const OPEN_MISSIONS = [
  ...MISSIONS.map((m) => ({ id: m.mission_id, campaign_id: 'camp-1', title: m.title, description: m.description, domain: m.action_path === 'create' ? 'creative' : 'community', discovery_category: m.action_path === 'create' ? 'create' : 'help', kind: 'mission', difficulty: 1, base_points: 10, proof_required: true, verification_mode: 'desk', skills: ['field'], capacity: null, status: 'open', starts_at: null, ends_at: null })),
  { id: '44444444-4444-4444-8444-444444444441', title: 'Write to the river council', description: 'Ask for a cleanup budget.', domain: 'advocacy', discovery_category: 'create', kind: 'mission', status: 'open' },
  { id: '44444444-4444-4444-8444-444444444442', title: 'Clip the river song', description: 'Paid clipping.', domain: 'music', kind: 'clip', status: 'open' },
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
  return { posts, id, requests: [], news: freshNews(now) };
}
/* WORLD NEWS (owner, 2026-10-15): what the Worker serves from its GDELT ingest. A story's place is where it MENTIONS somewhere. */
const GDELT = { name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' };
const NEWS_PLACES = [{ place: 'Nairobi, Nairobi Area, Kenya', lat: -1.28, lon: 36.82 }, { place: 'Lima, Lima, Peru', lat: -12.05, lon: -77.04 }, null, { place: 'Jakarta, Jakarta Raya, Indonesia', lat: -6.21, lon: 106.85 }];
const LONG_DOMAIN = 'a-very-long-publisher-domain-name-that-never-seems-to-end.example.co.uk';
/* the news heat map's day: a lopsided spread like the real one, from one story to hundreds */
const PUBLIC_REGIONS = [{ region_key: 'KE-110', region_label: 'Nairobi', country_code: 'KE', latitude: -1.29, longitude: 36.82, member_count: 12, verified_actions: 0 }, { region_key: 'KE-300', region_label: 'Coast', country_code: 'KE', latitude: -3.6, longitude: 39.5, member_count: 7, verified_actions: 0 }];
const HEAT_COUNTRIES = { US: 420, GB: 160, IN: 140, FR: 70, DE: 55, AU: 40, BR: 30, NG: 18, ZA: 12, KE: 8, PE: 8, ID: 7, EG: 4, AR: 3, JP: 2, MN: 1 };
function freshNews(now) {
  return Array.from({ length: 30 }, (_, k) => {
    const pl = NEWS_PLACES[k % 4];
    return { id: `ffffffff-ffff-4fff-8fff-${String(k + 1).padStart(12, '0')}`,
      title: k === 1 ? 'A deliberately long headline about water rights ' + 'that keeps on going '.repeat(10) + 'until a phone has to wrap and clamp it' : `World story ${k + 1}: councils weigh a budget for public transit`,
      url: `https://news${k % 3}.example/story/${k + 1}`, domain: k === 1 ? LONG_DOMAIN : `news${k % 3}.example`, seen_at: new Date(now - (k + 1) * 600e3).toISOString(),
      place: pl ? pl.place : null, lat: pl ? pl.lat : null, lon: pl ? pl.lon : null };
  });
}
const item = (p) => ({ item_type: 'post', post_id: p.id, occurred_at: p.created_at, actor: p.author, post: { id: p.id, body: p.body, visibility: p.visibility, created_at: p.created_at, content_id: p.content_id || null, like_count: p.like_count, liked_by_me: p.liked_by_me, author_m_uid: p.author.m_uid, media: p.media || [] } });
/* VIDEO POSTS (owner, 2026-10-20: "there's no thumbnail, just a black video"): the member's own clip with its picture,
   a peer's clip that has none, and a peer's clip this browser cannot decode. The clip is the repository's own WebM
   (Playwright's Chromium plays no MP4); the pictures are the owner's frames. */
const VID = { mine: asset(20), poster: asset(21), bare: asset(22), broken: asset(23), brokenPoster: asset(24) };
const VIDEO_MEDIA = {
  [VID.mine]: { path: 'assets/video/hero.webm', media_type: 'video' }, [VID.poster]: { path: 'assets/frames/affix_0001.jpg', media_type: 'image' },
  [VID.bare]: { path: 'assets/video/hero.webm', media_type: 'video' }, [VID.broken]: { path: 'assets/frames/church_0001.jpg', media_type: 'video' },
  [VID.brokenPoster]: { path: 'assets/frames/bussalick_0001.jpg', media_type: 'image' },
};
function addVideoPosts(world) {
  const now = Date.now(), at = (h) => new Date(now - h * 600e3).toISOString();
  world.videoPosts = {
    mine: { id: world.id(), author: ME, body: 'My clip from the river cleanup.', visibility: 'public', like_count: 0, liked_by_me: false, comments: [], created_at: at(1), media: [{ asset_id: VID.mine, type: 'video', mime_type: 'video/webm', poster_asset_id: VID.poster }] },
    bare: { id: world.id(), author: PEERS[0], body: 'A clip with no picture of its own.', visibility: 'public', like_count: 0, liked_by_me: false, comments: [], created_at: at(2), media: [{ asset_id: VID.bare, type: 'video', mime_type: 'video/webm' }] },
    broken: { id: world.id(), author: PEERS[1], body: 'A clip this browser cannot play.', visibility: 'public', like_count: 0, liked_by_me: false, comments: [], created_at: at(3), media: [{ asset_id: VID.broken, type: 'video', mime_type: 'video/quicktime', poster_asset_id: VID.brokenPoster }] },
  };
  world.posts.unshift(world.videoPosts.mine, world.videoPosts.bare, world.videoPosts.broken);
}
/* what the member uploaded, kept in this file's memory and served back from the fixture's storage */
const STORAGE = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object';
const TRAVEL_ROUTES = JSON.parse(await readFile(join(ROOT, 'scripts/e2e/fixtures/travel-new-haven-routes.json'), 'utf8')).routes;
const TRAVEL_ORIGIN = TRAVEL_ROUTES[0].origin, TRAVEL_DESTINATION = TRAVEL_ROUTES[0].destination;

async function routeBackends(ctx, world, { member, creator = true, verified = true }) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', (route) => {
    const u = route.request().url();
    /* STORAGE: a signed upload is kept; a signed read gives it back, open to any origin as storage is */
    if (u.startsWith(STORAGE + '/')) {
      const request = route.request(), method = request.method(), path = decodeURIComponent(new URL(u).pathname.replace(/^\/storage\/v1\/object\/(upload\/)?sign\/mnet-media\//, ''));
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,PUT,POST', 'access-control-allow-headers': 'apikey,authorization,content-type,x-upsert' } });
      if (method === 'PUT' || method === 'POST') {
        (world.blobs ||= {})[path] = { body: request.postDataBuffer(), type: request.headers()['content-type'] || 'application/octet-stream' };
        world.requests.push({ m: method, path: '/storage/' + path, auth: !!request.headers().authorization, bytes: world.blobs[path].body?.length || 0, type: world.blobs[path].type });
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ Key: 'mnet-media/' + path }) });
      }
      const blob = world.blobs && world.blobs[path];
      return blob ? route.fulfill({ status: 200, contentType: blob.type, headers: { 'access-control-allow-origin': '*' }, body: blob.body }) : route.fulfill({ status: 404, body: 'not found' });
    }
    if (u.includes('/rest/v1/travel_journeys')) {
      const request=route.request(),method=request.method();world.journeys ||= [];
      world.requests.push({m:method,path:'/travel_journeys',auth:!!request.headers().authorization,body:request.postDataJSON()});
      if(!member)return json(route,{error:'unauthorized'},401);
      if(world.journeyFail)return json(route,{error:'unavailable'},503);
      const id=new URL(u).searchParams.get('id')?.replace('eq.','');
      if(method==='POST'){const row={id:'99999999-9999-4999-8999-999999999999',plan:request.postDataJSON().plan,updated_at:new Date().toISOString()};world.journeys.push(row);return json(route,[row]);}
      if(method==='PATCH'){const row=world.journeys.find(x=>x.id===id);if(row)row.plan=request.postDataJSON().plan;return json(route,row?[row]:[]);}
      if(method==='DELETE'){world.journeys=world.journeys.filter(x=>x.id!==id);return json(route,[]);}
      return json(route,world.journeys);
    }
    if (u.includes('/auth/v1/user')) return member && world.userCheck ? json(route, { code: world.userCheck, error_code: 'session_not_found' }, world.userCheck) : member ? json(route, { id: 'auth-you', email: 'fixture@example.invalid' }) : json(route, { msg: 'no session' }, 401);
    if (u.includes('action_globe_public_region_missions')) return json(route, MISSIONS);
    /* members who share their region, five or more per region (the only consented member count): two of Kenya's */
    if (/\/rpc\/action_globe_public_regions$/.test(u)) return json(route, PUBLIC_REGIONS);
    if (u.includes('action_mission_stats')) return json(route, STATS);
    if (u.includes('clip_campaigns_open')) return json(route, CLIPS);
    if (u.includes('/rest/v1/action_missions?id=eq.')) { const m = OPEN_MISSIONS.find((x) => u.includes(x.id)); return json(route, m ? [m] : []); }
    if (u.includes('/rest/v1/action_missions?')) return json(route, OPEN_MISSIONS);
    if (u.includes('/rest/v1/action_mission_assignments?')) return json(route, []);
    /* the campaign's governed support rail is open for this fixture */
    if (/\/rpc\/action_bounty_public$/.test(u)) return json(route, { support_open: true, support_note: 'Allocations are verified by the desk.', bounties: [] });
    if (u.includes('/rest/v1/music_creator_profiles?')) return json(route, member && creator ? [{ handle: 'fixture-you' }] : []);
    /* the Action Record: whether this member has completed a mission decides whether Uprise is theirs yet */
    /* the house owner, as the database says (mnet_is_admin): only they are offered the newsroom */
    if (/\/rpc\/mnet_is_admin$/.test(u)) return json(route, !!(member && world.admin));
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
    if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': BASE, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' } });
    if (u.pathname === '/v1/travel/route') {
      if (auth || m !== 'POST' || u.search || !body || Object.keys(body).sort().join(',') !== 'destination,mode,origin') return json(route, { error:'Invalid public route request' }, 400);
      const fixture = TRAVEL_ROUTES.find(r => r.mode === body.mode && JSON.stringify(r.origin) === JSON.stringify(body.origin) && JSON.stringify(r.destination) === JSON.stringify(body.destination));
      const respond = () => world.routeFail ? json(route, { error:'Street directions are temporarily unavailable. Please try again.' }, 503)
        : fixture ? json(route, { ok:true, route:fixture }) : json(route, { error:'No recorded test route reaches those selected places.' }, 422);
      if (world.holdRoute) { (world.heldRoutes ||= []).push(() => respond().catch(() => {})); return; }
      return respond();
    }
    // These personas are ordinary members, not operators. A catch-all 200 must not grant admin navigation.
    if (u.pathname === '/v1/status') return world.owner && auth ? json(route, { ok: true }) : json(route, { error: 'Forbidden' }, 403);
    if (u.pathname === '/v1/action-archive/docket-516r-2025') return json(route, COHORT_ARCHIVE);
    /* THE COUNTRY FEED: off unless a scenario names the connection country the Worker would read from request.cf */
    if (u.pathname === '/v1/world/place-scope') return json(route, { ok: true, enabled: !!world.placeHome, country: world.placeHome || null, source: 'cloudflare_country' });
    if (u.pathname === '/v1/world/live-places') return json(route, { ok: true, places: world.placeHome ? [{ code: 'GB', count: 2 }] : [] });
    /* the Worker's rule (world-region-feed.js): without a member's session, the connection's country only */
    if (u.pathname === '/v1/world/region-feed' && !auth && u.searchParams.get('country') !== world.placeHome) return json(route, { error: 'Sign in to read another country\'s feed', detail: { sign_in: true, home: world.placeHome } }, 403);
    if (u.pathname === '/v1/world/region-feed') { const c = u.searchParams.get('country'); return json(route, { ok: true, available: true, country: c, posts: c === world.placeHome ? world.posts.slice(0, 3).filter((p) => p.visibility === 'public').map((p) => { const x = item(p); x.post.media_locked = x.post.media.length; delete x.post.media; delete x.post.author_m_uid; return x; }) : [], news: [], lives: c === world.placeHome ? [{ id: LIVE[0].id, title: LIVE[0].title, room_kind: 'mission', category_key: 'field', started_at: LIVE[0].started_at, country_code: c, host: { display_name: 'Fixture Ana', avatar_url: '' } }] : [], next_post_before: null, next_news_before: null }); }
    /* WORLD NEWS: free for everyone, never with a session; the cursor is opaque and must come back verbatim */
    /* the news heat map's counts: the fixture's stories by the country each mentions, and Kenya's as places */
    if (u.pathname === '/v1/world/news-heat') {
      const c = u.searchParams.get('country');
      /* Fixture: 19 Kenyan members explicitly opted into coarse region sharing; only a consented count reaches the public card. */
      if (c === null) return json(route, { ok: true, window_hours: 24, countries: HEAT_COUNTRIES, total: Object.values(HEAT_COUNTRIES).reduce((a, b) => a + b, 0), capped: false, posts: { KE: 3, US: 12 }, members: { KE: 19 }, member_regions: {}, attribution: GDELT });
      if (c === 'KE') return json(route, { ok: true, window_hours: 24, cell_degrees: 0.05, country: 'KE', cells: [[36.8, -1.3, 8]], total: 8, capped: false, attribution: GDELT });
      return json(route, { ok: true, window_hours: 24, cell_degrees: 0.05, country: c, cells: [], total: 0, capped: false, attribution: GDELT });
    }
    if (u.pathname === '/v1/world/news') {
      if (world.newsFail === 'abort') return route.abort('failed');
      if (world.newsFail === 'unavailable') return json(route, { ok: true, items: [], next_before: null, unavailable: true, attribution: GDELT });
      if (world.newsFail) return json(route, { error: 'upstream failed' }, world.newsFail);
      if (auth) return json(route, { error: 'the news read carries no session' }, 400);
      const cur = u.searchParams.get('before'), at = cur === null ? 0 : /^cur\|\d+$/.test(cur) ? Number(cur.slice(4)) : -1;
      if (at < 0) return json(route, { error: 'Invalid cursor' }, 400);
      const lim = Math.min(20, Number(u.searchParams.get('limit')) || 20);
      return json(route, { ok: true, items: world.news.slice(at, at + lim), next_before: at + lim < world.news.length ? 'cur|' + (at + lim) : null, attribution: GDELT });
    }
    /* Mimic the only circumstance in which the UI may expose news comments:
       the reviewed backend explicitly advertises that its table is available. */
    if (u.pathname === '/v1/world/news/comments-capability') {
      if (auth) return json(route, {error:'Capability must not require a user session'},400);
      return json(route, {available:true});
    }
    // Staged news-comment API fixture: source-backed and first-party only.
    const newsComment = u.pathname.match(/^\/v1\/world\/news\/([0-9a-f-]{36})\/comments$/);
    if (newsComment) {
      const story = world.news.find(x=>x.id===newsComment[1]);
      if (!story) return json(route,{error:'Story not found'},404);
      const comments = (world.newsComments ||= {})[story.id] ||= [];
      if (m === 'POST') {
        if (!auth) return json(route,{error:'Sign in to comment'},401);
        const value=String(body?.body||'').trim();
        if (!value||[...value].length>1000)return json(route,{error:'Invalid comment'},400);
        const comment={id:world.id(),body:value,actor:ME,created_at:new Date().toISOString()};
        comments.push(comment);
        return json(route,{comment},201);
      }
      return json(route,{comments});
    }
    const before = u.searchParams.get('before');
    if (before && Number.isNaN(Date.parse(before))) return json(route, { error: 'bad cursor' }, 400);
    const asOf = (list) => before ? list.filter((p) => p.created_at < before) : list;
    /* posts come in pages of world.postPage when it is set (the Load more scenario), else all at once */
    const pageOf = (list) => { if (!world.postPage) return { list, next: null }; const one = list.slice(0, world.postPage); return { list: one, next: list.length > one.length ? one[one.length - 1].created_at : null }; };
    /* the World's Cesium ion (scripts/e2e/world-ion.e2e.mjs drives it): off here, so this Earth is NASA's alone */
    if (u.pathname === '/v1/world/ion') return json(route, { ok: true, available: false, binding: null });
    if (u.pathname === '/v1/mnet/public-feed') {
      if (auth) return json(route, { error: 'a guest read carries no session' }, 400);
      const pg = pageOf(asOf(world.posts.filter((p) => p.visibility === 'public')));
      const pub = pg.list.map((p) => { const x = item(p); delete x.post.author_m_uid; delete x.post.content_id; x.post.media_locked = x.post.media.length; delete x.post.media; return x; });
      return json(route, { items: pub, scope: 'public', next_before: pg.next });
    }
    /* THE WORLD'S DATA LAYERS (owner, 2026-10-15): flights for everyone; satellites and launches for members, refused without a bearer */
    if (u.pathname === '/v1/world/layers/flights') return json(route, { ok: true, layer: 'flights', fetched_at: new Date().toISOString(), attribution: 'OpenSky Network', provider: 'opensky', credit: 'Flights: OpenSky', stale: false, count: 3, total: 3, aircraft: [['ab1644', 'UAL2405', -92.49, 32.99, 11567, 220, 188], ['4ca7b3', 'RYR12', -3.2, 51.5, 10900, 230, 95], ['7c6b2d', 'QFA1', 151.2, -33.9, 8000, 210, 10]] });
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
    if (u.pathname === '/v1/mnet/feed') { const pg = pageOf(asOf(world.posts)); return json(route, { items: pg.list.map(item), next_before: pg.next }); }
    if (u.pathname === '/v1/mnet/notifications') return json(route, { notifications: world.alertsRead ? [] : [{ id: 'n1', type: 'like', body: 'Fixture Ana liked your post', created_at: new Date().toISOString(), read_at: null },
      { id: 'n2', type: 'comment', body: 'commented on your post', metadata: { post_id: CONTENT, comment_id: M2 }, created_at: new Date().toISOString(), read_at: null },
      { id: 'n3', type: 'news_comment', body: 'also replied to a story you replied to', metadata: { article_id: M1, comment_id: M2 }, created_at: new Date().toISOString(), read_at: null }] });
    /* alerts on devices are off on this fixture server */
    if (u.pathname === '/v1/mnet/push') return json(route, { enabled: false });
    if (u.pathname === '/v1/mnet/notifications/read') { world.alertsRead = true; return json(route, {}); }
    if (u.pathname === '/v1/mnet/discover') { const q = (u.searchParams.get('q') || '').toLowerCase(); return json(route, { people: PEERS.filter((p) => (p.display_name + ' ' + p.mccluster_id).toLowerCase().includes(q)).map((p) => ({ ...p, following: false })) }); }
    if (u.pathname === '/v1/mnet/conversations') return json(route, { conversations: [{ conversation: { id: 'c1' }, my: { member_state: 'requested' }, members: [], last_message: null }] });
    if (u.pathname === '/v1/mnet/groups') return json(route, { groups: GROUPS });
    if (u.pathname === '/v1/mnet/groups/river-keepers') return json(route, { group: GROUPS[0], organization: null, campaigns: [], items: [] });
    /* one post, for a member: what a country feed's "Show these photos" loads */
    const onePost = m === 'GET' && u.pathname.match(/^\/v1\/mnet\/posts\/([0-9a-f-]{36})$/);
    if (onePost) { const p = world.posts.find((x) => x.id === onePost[1]); return !auth || !p ? json(route, { error: 'Post not found' }, 404) : json(route, item(p)); }
    if (u.pathname === '/v1/mnet/live/directory') return json(route, { sessions: LIVE });
    if (u.pathname === '/v1/mnet/live/eligibility') return json(route, { can_host: false, enabled: false });
    if (u.pathname === '/v1/analytics/my-creator') return json(route, { ok: true, creator: creator, audience: creator ? { countries: [{ country: 'US', views: 42 }, { country: 'GB', views: 7 }], elsewhere_views: 3, unknown_views: 1, min_views: 5 } : { countries: [] } });
    /* MEDIA, as mnet-media answers it: a signed upload slot, finalize, discard, and an hour-long read address */
    /* a cover upload the storage turns away, when a scenario asks for one */
    if (u.pathname === '/v1/mnet/media/upload-url' && m === 'POST' && world.failCover && /^image\//.test(String(body?.mime_type || ''))) { world.failCover--; return json(route, { error: 'Storage is busy.' }, 503); }
    if (u.pathname === '/v1/mnet/media/upload-url' && m === 'POST') {
      const id = asset(100 + (world.uploadN = (world.uploadN || 0) + 1)), mime = String(body?.mime_type || ''), kind = /^video\//.test(mime) ? 'video' : /^image\//.test(mime) ? 'image' : 'file';
      const path = `auth-you/${id}-${String(body?.file_name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '-')}`;
      (world.uploads ||= {})[id] = { path, mime, media_type: kind };
      return json(route, { ok: true, asset: { id, object_path: path, media_type: kind, mime_type: mime, status: 'staged' }, upload: { path, token: 'tok-' + world.uploadN, signed_url: null } });
    }
    if (u.pathname === '/v1/mnet/media/finalize' && m === 'POST') { const up = world.uploads?.[body?.asset_id]; return up ? json(route, { ok: true, asset: { id: body.asset_id, media_type: up.media_type, mime_type: up.mime, width: body.width ?? null, height: body.height ?? null, duration_ms: body.duration_ms ?? null, status: 'ready' } }) : json(route, { error: 'asset not found' }, 404); }
    if (u.pathname === '/v1/mnet/media/discard' && m === 'POST') return json(route, { ok: true, discarded: true });
    const upMedia = u.pathname.match(/^\/v1\/mnet\/media\/([0-9a-f-]{36})\/url$/), uploaded = upMedia && world.uploads?.[upMedia[1]], fixed = upMedia && VIDEO_MEDIA[upMedia[1]];
    if (uploaded) return json(route, { ok: true, asset_id: upMedia[1], url: `${STORAGE}/sign/mnet-media/${uploaded.path}?token=view`, expires_in: 3600, media_type: uploaded.media_type, mime_type: uploaded.mime });
    if (fixed) return json(route, { ok: true, asset_id: upMedia[1], url: `${BASE}/${fixed.path}`, expires_in: 3600, media_type: fixed.media_type });
    const media = u.pathname.match(/^\/v1\/mnet\/media\/eeeeeeee-eeee-4eee-8eee-0*(\d+)\/url$/);
    if (media) return json(route, { url: `${BASE}/${PHOTOS[(Number(media[1]) - 1) % PHOTOS.length]}`, media_type: 'image' });
    if (u.pathname === '/v1/mnet/posts' && m === 'POST') {
      if (!body || !String(body.body || '').trim()) return json(route, { error: 'empty' }, 400);
      const media = (body.media_asset_ids || []).map((id, i) => ({ asset_id: id, type: world.uploads?.[id]?.media_type || 'image', poster_asset_id: (body.poster_asset_ids || [])[i] || null }));
      const p = { id: world.id(), author: ME, body: body.body, visibility: body.visibility, like_count: 0, liked_by_me: false, comments: [], created_at: new Date().toISOString(), ...(media.length ? { media } : {}) };
      world.posts.unshift(p);
      return json(route, { post: item(p).post }, 201);
    }
    /* THE THUMBNAIL of the member's own video post (the Worker's rules: workers/mccluster/test/mnet-post-thumbnail.test.mjs) */
    const patchPost = m === 'PATCH' && u.pathname.match(/^\/v1\/mnet\/posts\/([0-9a-f-]{36})$/);
    if (patchPost) {
      const p = world.posts.find((x) => x.id === patchPost[1]);
      if (!p || p.author.m_uid !== ME.m_uid) return json(route, { error: 'Post not found' }, 404);
      for (const [video, picture] of Object.entries(body?.poster_by_media || {})) {
        const target = (p.media || []).find((x) => x.asset_id === video && x.type === 'video');
        if (!target || (picture !== null && world.uploads?.[picture]?.media_type !== 'image')) return json(route, { error: 'A thumbnail must be one of your images.' }, 400);
        target.poster_asset_id = picture;
      }
      return json(route, item(p));
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
    barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null, barHidden: !bar || getComputedStyle(bar).display === 'none', feedPad: Math.round(parseFloat(getComputedStyle(fe).paddingBottom)), feedRoom: Math.round(fe.scrollHeight - fe.clientHeight), clear: getComputedStyle(document.documentElement).getPropertyValue('--mn-bar-clear').trim(),
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
const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? {server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'} : undefined, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });

async function open(device, { member, creator = true, verified = true, bootFail = [], userCheck = 0, newsFail = 0, postPage = 0, noGlobe = false, geo = 'denied', travel = false, entryPath = '/action-globe.html', placeHome = null, admin = false, social = false, owner = false, videoPosts = false }) {
  const world = freshWorld();
  world.owner = owner;
  if (videoPosts) addVideoPosts(world);
  world.placeHome = placeHome;
  world.bootFail = bootFail.slice(); world.userCheck = userCheck; world.newsFail = newsFail; world.postPage = postPage; world.admin = admin;
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: device.viewport, deviceScaleFactor: 2, isMobile: device.mobile, hasTouch: device.mobile });
  /* social: the World exactly as it ships (scripts/e2e/world-switch.mjs) */
  if (social) await ctx.addCookies([{ name: 'world', value: 'social', url: BASE }]);
  /* every frame of the first seconds: did the sign-in form paint on the way into the World? (owner, 2026-10-20) */
  await ctx.addInitScript(() => {
    window.__gateFlash = 0;
    /* and no other screen either (owner, 2026-10-20: "other screens flash up instead of just a smooth transition"): the Live
       room before the World, a World screen with nothing in it, the bar drawing this page itself as a broken image, the
       globe frame's own standalone screen (its deck) inside the World */
    window.__liveFlash = 0; window.__blankWorld = 0; window.__barSelfImg = 0; window.__deckFlash = 0;
    const shown = (el) => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    const tick = () => {
      const g = document.getElementById('mnSignedOut'); if (g && !g.hidden && g.getClientRects().length) window.__gateFlash++;
      if (shown(document.getElementById('mnLiveView'))) window.__liveFlash++;
      const app = document.getElementById('mnApp');
      if (app && !shown(app) && !shown(g) && !shown(document.getElementById('mnProfileGate'))) window.__blankWorld++;
      for (const img of document.querySelectorAll('.appbar img')) if (img.getAttribute('src') && img.src === location.href) window.__barSelfImg++;
      if (/action-globe\.html$/.test(location.pathname) && window.parent !== window && shown(document.getElementById('deck'))) window.__deckFlash++;
      if (performance.now() < 8000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await ctx.addInitScript((m) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
    if (m && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); const exp = Math.floor(Date.now() / 1000) + 3600; localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).replace(/=+$/, '') + '.y', refresh_token: 'r', expires_at: exp })); }
    window.__shared = [];
    Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__shared.push(d.url); return Promise.resolve(); } });
  }, member);
  await ctx.addInitScript(({mode,origin}) => {
    window.__travelGeoMode=mode;window.__travelGeoRequests=0;window.__travelWatchStarts=0;window.__travelWatchStops=0;
    const watches=new Map();let nextWatch=0;
    const fix=(coordinates=window.__travelGeoCoordinates||origin,accuracy=12,timestamp=Date.now())=>({coords:{longitude:coordinates[0],latitude:coordinates[1],accuracy},timestamp});
    window.__travelWatchCount=()=>watches.size;
    window.__travelPushFix=(coordinates=origin,accuracy=12,timestamp=Date.now())=>{for(const watch of watches.values())watch.ok(fix(coordinates,accuracy,timestamp))};
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
      getCurrentPosition(ok,fail){window.__travelGeoRequests++;if(window.__travelGeoMode==='delayed')window.__travelGeoResolve=()=>ok(fix());else queueMicrotask(()=>window.__travelGeoMode==='granted'?ok(fix()):fail({code:1}));},
      watchPosition(ok,fail){const id=++nextWatch;window.__travelWatchStarts++;watches.set(id,{ok,fail});window.__travelLateFix=coordinates=>ok(fix(coordinates));queueMicrotask(()=>{if(watches.has(id))window.__travelGeoMode==='granted'?ok(fix()):fail({code:1})});return id;},
      clearWatch(id){if(watches.delete(id))window.__travelWatchStops++;}
    }});
  },{mode:geo,origin:TRAVEL_ORIGIN});
  await ctx.route('https://photon.komoot.io/**',async route=>{
    const q=new URL(route.request().url()).searchParams.get('q')||'';
    if(q.includes('unavailable'))return route.fulfill({status:503,body:'unavailable'});
    const address=/350|Fifth|Empire/i.test(q),lisbon=/Lisbon/i.test(q),station=/Union|Station/i.test(q);
    return route.fulfill({contentType:'application/json',body:JSON.stringify({features:[{geometry:{type:'Point',coordinates:address?[-73.9857,40.7484]:lisbon?[-9.14,38.72]:station?TRAVEL_DESTINATION:TRAVEL_ORIGIN},properties:address?{name:'Empire State Building',housenumber:'350',street:'Fifth Avenue',city:'New York',state:'New York',country:'United States'}:lisbon?{name:'Lisbon',country:'Portugal'}:station?{name:'Union Station',city:'New Haven',state:'Connecticut',country:'United States'}:{name:'New Haven',state:'Connecticut',country:'United States'}}]})});
  });
  if(noGlobe)await ctx.route('https://cesium.com/**',r=>r.abort());
  else if (process.env.CESIUM_DIR) await ctx.route('https://cesium.com/**/Build/Cesium/**', async route => {
    const rel = new URL(route.request().url()).pathname.split('/Build/Cesium/')[1];
    if (!rel || rel.includes('..')) return route.abort();
    try { return route.fulfill({ body: await readFile(join(process.env.CESIUM_DIR, rel)), contentType: TYPES[extname(rel)] || 'application/octet-stream' }); }
    catch { return route.abort(); }
  });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, r=>r.abort());
  await routeBackends(ctx, world, { member, creator, verified });
  const page = await ctx.newPage();
  const errors = [];
  const archiveNetwork = [];
  const archiveOutcome = (request, outcome, detail = {}) => {
    const url = new URL(request.url());
    if (url.pathname !== '/v1/action-archive/docket-516r-2025' && url.pathname !== '/data/action/docket-516r-archive.json') return;
    archiveNetwork.push({ at: new Date().toISOString(), outcome, method: request.method(), url: url.origin + url.pathname, ...detail });
  };
  page.on('request', request => archiveOutcome(request, 'request'));
  page.on('response', response => archiveOutcome(response.request(), 'response', { status: response.status(), contentType: response.headers()['content-type'] || null }));
  page.on('requestfinished', request => archiveOutcome(request, 'finished'));
  page.on('requestfailed', request => archiveOutcome(request, 'failed', { error: request.failure()?.errorText || null }));
  page.on('pageerror', (e) => errors.push(e.message));
  /* the globe catches its own start-up failure and only warns; that is still a failure here */
  page.on('console', (m) => { if (/TypeError|ReferenceError|SyntaxError/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.goto(BASE + entryPath, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(entryPath.startsWith('/mnet.html') ? /mnet\.html(?:\?|$)/ : /mnet\.html\?view=feed/, { timeout: 15000 });
  await page.waitForFunction(() => /pinned on the Earth|No missions are pinned|could not load|can.t run/.test((document.getElementById('mnWorldCaption') || {}).textContent || ''), null, { timeout: 90000 });
  await page.waitForSelector('#mnFeed [data-post-id]', { timeout: 20000, state:'attached' });
  await page.waitForFunction(()=>!!window.MCC_WORLD_MODE);
  if(!travel&&process.env.E2E_ONLY !== 'travel')await page.evaluate(()=>window.MCC_WORLD_MODE.set('posts'));
  /* evidence shots wait for the Earth's tiles, up to 25s */
  const globe = page.frame({ url: /action-globe\.html/ });
  if (globe&&!noGlobe) await globe.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return { ctx, page, world, errors, archiveNetwork };
}
const req = (world, m, re) => world.requests.filter((r) => r.m === m && re.test(r.path));

/* E2E_ONLY=layers (or any scope prefix) reruns one family of scenarios alone; the full run is the evidence */
const ONLY = process.env.E2E_ONLY || '';
const runs = (scope) => !ONLY || scope.startsWith(ONLY);

/* Travel acceptance: the shipping UI and real Cesium, with recorded public road routes.
   Provider fixtures never claim to be a live service, a fare or a dispatched ride. */
const chooseTravelPlace = async (page, id, query) => {
  // The prior address options may still be attached while Photon refreshes.
  // Wait for suggestions belonging to this query, and never select the stale first row.
  const expected = query === '350 Fifth Avenue' ? 'Empire State Building' : query;
  await page.fill('#'+id, query);
  await page.waitForFunction(({id, expected}) => {
    const input = document.getElementById(id), list = document.getElementById(id+'Results');
    return input?.getAttribute('aria-expanded') === 'true' && !input.hasAttribute('aria-busy')
      && list && !list.hidden && [...list.querySelectorAll('button')]
        .some(button => button.textContent?.includes(expected));
  }, {id, expected}, {timeout: 25000});
  // Diagnostic for the desktop-only CI interaction stall: check actual
  // viewport geometry, computed visibility and nearest clipping ancestor.
  // No addresses or private coordinates are printed, only boolean/layout data.
  if (process.env.E2E_ONLY === 'travel-desktop') {
    console.log('TRAVEL_SUGGEST_LAYOUT',JSON.stringify(await page.evaluate(({id,expected}) => {
      const list=document.getElementById(id+'Results');
      const row=[...list.querySelectorAll('button')].find(b=>b.textContent?.includes(expected));
      const rect=node=>{const r=node?.getBoundingClientRect();return r?{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}:null};
      const style=node=>{const s=node&&getComputedStyle(node);return s?{display:s.display,visibility:s.visibility,opacity:s.opacity,overflow:s.overflow}:null};
      const feed=document.getElementById('mnWorldFeed');
      return {row:rect(row),rowStyle:style(row),list:rect(list),listStyle:style(list),
        field:rect(list?.parentElement),fieldStyle:style(list?.parentElement),feed:rect(feed),feedStyle:style(feed),
        rootExpanded:document.documentElement.classList.contains('wt-expanded'),scrollTop:Math.round(feed?.scrollTop||0),
        rowVisible:!!(row?.offsetWidth&&row?.offsetHeight)};
    },{id,expected})));
  }
  const option = page.locator('#'+id+'Results button').filter({hasText:expected}).first();
  try { await option.click({noWaitAfter:true,timeout:5000}); }
  catch (error) {
    // The globe iframe shares the page's renderer, so on a slow CI runner the
    // click can be delivered while Playwright's input acknowledgement stalls
    // behind a Cesium frame. If the selection already landed (the field holds
    // the chosen place and the list closed), the click did its job; the same
    // outcome is asserted below. Otherwise fall back as before.
    const landed = await page.evaluate(({id, query, expected}) => {
      const input = document.getElementById(id);
      return !!input && input.value !== query && input.value.includes(expected) && input.getAttribute('aria-expanded') === 'false';
    }, {id, query, expected});
    if (!landed) {
    // The Cesium canvas continuously paints while the suggestion popup is
    // shown. If the intended option is truly exposed and enabled, an actual
    // forced pointer click can bypass Playwright's overly strict stable-frame
    // heuristic. Never bypass an obscured, disabled or hidden option.
    const exposed = await option.evaluate(el => {
      const r=el.getBoundingClientRect(), style=getComputedStyle(el);
      const x=(r.left+r.right)/2, y=(r.top+r.bottom)/2;
      const hit=document.elementFromPoint(x,y);
      return r.width>0&&r.height>0&&!el.disabled&&style.visibility==='visible'
        &&style.display!=='none'&&(hit===el||el.contains(hit));
    });
    if (!exposed) throw error;
    await option.click({force:true,noWaitAfter:true,timeout:5000});
    }
  }
  await page.waitForFunction(({id, query, expected}) => {
    const input = document.getElementById(id);
    return input && input.value !== query && input.value.includes(expected)
      && input.getAttribute('aria-expanded') === 'false';
  }, {id, query, expected}, {timeout: 15000});
};
const showTravelRoute = async page => {
  const label = await page.textContent('#wtNavigate');
  if (label === 'Get directions' || label === 'Try route again') await page.click('#wtNavigate');
  await page.waitForSelector('#wtRouteCard:not([hidden])');
  await page.waitForFunction(()=>document.getElementById('wtNavigate').textContent==='Go');
};
const releaseTravelRoutes = async world => { world.holdRoute=false; await Promise.all((world.heldRoutes||[]).splice(0).map(release=>release())); };
const waitForHeldTravelRoute = async (world, page) => {
  const deadline = Date.now() + 5000;
  while (!(world.heldRoutes || []).length && Date.now() < deadline) await page.waitForTimeout(25);
  if (!(world.heldRoutes || []).length) throw new Error('The route request did not reach the held provider fixture');
};
const panTravelMap = async (page, globe) => {
  // The mode tabs and transport legitimately move with viewport clearance.
  // Drag a point that is actually exposed in both documents, so this checks
  // real map input rather than accidentally clicking a floating control.
  const point = await globe.evaluate(() => {
    const canvas = document.querySelector('#globe canvas'), r = canvas.getBoundingClientRect();
    const frame = window.frameElement, f = frame.getBoundingClientRect();
    const exposed = (x,y) => document.elementFromPoint(x,y) === canvas && parent.document.elementFromPoint(f.left+x,f.top+y) === frame;
    for (const fy of [.35,.55,.75,.2,.85]) for (const fx of [.2,.4,.6]) {
      const x = r.left+r.width*fx, y = r.top+r.height*fy;
      if (exposed(x,y) && exposed(x+35,y+25)) return {x:f.left+x,y:f.top+y};
    }
    return null;
  });
  if (!point) throw new Error('No exposed canvas area is available for a navigation pan');
  await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+35,point.y+25,{steps:4});await page.mouse.up();
};

if(runs('travel')||ONLY.startsWith('travel-')) for(const device of DEVICES.filter(d=>!process.env.EDITORIAL_DEVICE||d.name===process.env.EDITORIAL_DEVICE)) {
  const member=device.name==='desktop',scope=`travel-${device.name}`;
  if(!runs(scope))continue;
  const {ctx,page,world,errors,archiveNetwork}=await open(device,{member,travel:true});
  try{
    const globe=page.frame({url:/action-globe\.html/});
    check(scope,'Travel opens with location and destination; flights and extra fields stay tucked away',await page.getAttribute('html','data-world-mode')==='travel'&&await page.isVisible('#wtPlanner')&&await page.isHidden('#wtGroundOptions')&&await page.isHidden('#wtOptions')&&await page.isHidden('[data-travel-kind=flight]')&&await page.isHidden('#wtDirections'));
    check(scope,'travel scene hides mission pins and keeps visible zoom controls',await globe.evaluate(()=>window.__huJourney().travel)&&await globe.isVisible('#ctlZoomIn'));
    /* the owner's sheet (2026-10-19): Where to?, pickup over destination with the globe pins inside the rows, Rides chosen,
       shortcuts that all do something real, and the two planning doors; no Home/Work, no priced rides */
    check(scope,'the Travel sheet reads Where to? with pickup over destination, Rides chosen, real shortcuts and planning doors',
      (await page.textContent('#wtTitle')).trim()==='Where to?'&&await page.getAttribute('#wtFrom','placeholder')==='Use my location'&&await page.isVisible('#wtActivity')
      &&await page.getAttribute('[data-travel-chip=rides]','aria-pressed')==='true'&&await page.isVisible('#wtGo')
      &&(await page.locator('#wtGo button').allTextContents()).map(t=>t.trim()).join('|')==='Near me|Airports|Hotels|On the globe|Saved'
      &&await page.isVisible('[data-travel-plan=flights]')&&await page.isVisible('[data-travel-plan=multi]')&&await page.isHidden('[data-travel-kind=flight]')
      &&await page.evaluate(()=>{const f=document.getElementById('wtFrom').getBoundingClientRect(),t=document.getElementById('wtTo').getBoundingClientRect(),p=document.getElementById('wtPickTo').getBoundingClientRect(),l=document.getElementById('wtLocate').getBoundingClientRect();return f.bottom<=t.top+1&&p.width>=44&&p.height>=44&&l.width>=44&&l.height>=44&&p.top>=t.top-12&&p.bottom<=t.bottom+12;}));
    /* the two tiles and their switches (owner, 2026-10-20): Rides is Directions or Rentals, Flights is Commercial or Private */
    const tiles=await page.evaluate(()=>({kinds:document.querySelectorAll('.wt-kind').length,subs:[...document.querySelectorAll('[data-travel-sub]')].map(b=>b.textContent.trim()).join('|'),
      directions:document.querySelector('[data-travel-sub=directions]')?.getAttribute('aria-pressed'),multi:document.querySelectorAll('[data-travel-chip=multi]').length}));
    check(scope,'Rides and Flights are two tiles, each split by an on/off switch',tiles.kinds===2&&tiles.subs==='Directions|Rentals|Commercial|Private'&&tiles.directions==='true'&&tiles.multi===0,tiles);
    await page.click('[data-travel-sub=rentals]');
    check(scope,'Rentals shows the Isabeata 2024 at $350 a week from Whip Equipped; the route tools step aside',await page.isVisible('#wtRentals')
      &&/Isabeata 2024/.test(await page.textContent('#wtCars'))&&/\$350\/week/.test((await page.textContent('#wtCars')).replace(/\s+/g,''))
      &&/Whip Equipped LLC, a separate company/.test(await page.textContent('#wtRentals'))&&await page.isHidden('#wtGo')
      &&await page.getAttribute('#wtCars a','href')==='https://matthew.mccluster.org/whip/rentals/?vehicle=we-rental-isabeata-2024'
      &&await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
    await page.screenshot({path:join(OUT,scope+'-rentals.png')});
    await page.click('[data-travel-sub=private]');
    const priv=await page.evaluate(()=>({shown:!document.getElementById('wtPrivate').hidden&&!!document.getElementById('wtPrivate').offsetHeight,rentals:!document.getElementById('wtRentals').offsetHeight,
      flights:document.querySelector('[data-travel-chip=flights]')?.getAttribute('aria-pressed'),sub:document.querySelector('[data-travel-sub=private]')?.getAttribute('aria-pressed')}));
    check(scope,'Private flights says it is not bookable yet, under the Flights tile',priv.shown&&priv.rentals&&priv.flights==='true'&&priv.sub==='true',priv);
    await page.click('[data-travel-sub=directions]');
    check(scope,'Directions brings the route tools back',await page.isVisible('#wtGo')&&await page.isHidden('#wtPrivate')&&await page.getAttribute('[data-travel-chip=rides]','aria-pressed')==='true');
    const [dock,expand,modes,credit,...controls]=await Promise.all([
      page.locator('.appbar').boundingBox(),page.locator('.mn__world-expand').boundingBox(),page.locator('.wt-world-modes').boundingBox(),
      globe.locator('.osm-credit a[href="https://www.openstreetmap.org/copyright"]').boundingBox(),
      ...['ctlLocate','ctlZoomIn','ctlZoomOut'].map(id=>globe.locator('#'+id).boundingBox())
    ]);
    const overlaps=(a,b)=>a&&b&&a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
    const clearChrome=controls.every(r=>r&&r.width>=44&&r.height>=44&&![dock,expand,modes].some(other=>overlaps(r,other)))&&!overlaps(credit,dock)&&!overlaps(credit,modes);
    check(scope,'44px map controls and attribution stay clear of the parent dock and overlays',clearChrome,clearChrome?undefined:{dock,expand,modes,credit,controls});
    await page.screenshot({path:join(OUT,scope+'-initial.png')});
    check(scope,'compact modes and header overlay share the globe',await page.evaluate(()=>{const g=document.getElementById('mnWorld').getBoundingClientRect(),h=document.querySelector('.mn__top').getBoundingClientRect(),m=document.querySelector('.wt-world-modes').getBoundingClientRect();return g.top===0&&h.top>=g.top&&h.bottom<g.bottom&&m.width<=240&&m.height<=44;}));
    if(!member)check(scope,'Join clears the shared account control',await page.evaluate(()=>document.getElementById('mnGuestJoin').getBoundingClientRect().right+6<=document.getElementById('mccAuthChip').getBoundingClientRect().left));
    check(scope,'location is requested once, denial keeps manual entry, no navigation watch starts',await page.evaluate(()=>window.__travelGeoRequests===1&&window.__travelWatchStarts===0)&&await page.isEnabled('#wtFrom')&&/Location access is off/.test(await page.textContent('#wtLocationStatus')));
    await chooseTravelPlace(page,'wtTo','350 Fifth Avenue');
    check(scope,'selected address reveals ground options and waits for a selected starting point',/Empire State Building/.test(await page.inputValue('#wtTo'))&&await page.isVisible('#wtGroundOptions')&&await page.isDisabled('#wtNavigate')&&await page.isHidden('[data-travel-kind=flight]')&&req(world,'POST',/^\/v1\/travel\/route$/).length===0);
    check(scope,'a destination with no pickup asks for the location from that tap, then points at the pickup',await page.waitForFunction(()=>window.__travelGeoRequests===2&&document.activeElement&&document.activeElement.id==='wtFrom',null,{timeout:5000}).then(()=>true,()=>false));
    await chooseTravelPlace(page,'wtTo','Union Station');await chooseTravelPlace(page,'wtFrom','New Haven');
    await showTravelRoute(page);
    check(scope,'selecting both endpoints automatically presents directions and Go',req(world,'POST',/^\/v1\/travel\/route$/).length===1&&await page.textContent('#wtNavigate')==='Go');
    await globe.waitForFunction(points=>window.__huNavigation().routeVisible&&window.__huNavigation().routePoints===points,TRAVEL_ROUTES[0].geometry.length,{timeout:15000});
    await page.waitForTimeout(1400);
    await globe.waitForFunction(()=>window.__huGlobeSettled(),null,{timeout:10000}).catch(()=>{});
    const posted=req(world,'POST',/^\/v1\/travel\/route$/);
    check(scope,'ground directions use a public POST containing only selected coordinates and mode',posted.length===1&&!posted[0].auth&&!posted[0].search&&JSON.stringify(posted[0].body)===JSON.stringify({origin:TRAVEL_ORIGIN,destination:TRAVEL_DESTINATION,mode:'drive'}),posted);
    check(scope,'street route and readable turn steps replace external-map navigation',await page.getAttribute('#wtNavigate','href')===null&&await page.locator('#wtRouteSteps [data-step-index]').count()===TRAVEL_ROUTES[0].steps.length&&/min/.test(await page.textContent('#wtRouteSummary'))&&await globe.evaluate(()=>__huNavigation().routeEntities===3&&__huIon().height<100000));
    await page.locator('#wtSteps').evaluate(e=>e.open=true);
    check(scope,'every displayed instruction comes from the selected route',JSON.stringify(await page.locator('#wtRouteSteps button > span').allTextContents())===JSON.stringify(TRAVEL_ROUTES[0].steps.map(s=>s.instruction)));
    await page.locator('#wtSteps').evaluate(e=>e.open=false);
    await page.evaluate(()=>document.getElementById('mnWorldFeed').scrollTop=0);await page.screenshot({path:join(OUT,scope+'-route.png')});
    await page.click('#wtRide');const uber=new URL(await page.getAttribute('#wtUber','href'));
    const pickup=JSON.parse(uber.searchParams.get('pickup')),dropoff=JSON.parse(uber.searchParams.get('drop[0]'));
    check(scope,'ride handoff names Uber, passes exact places and makes no dispatch or price promise',uber.origin==='https://m.uber.com'&&pickup.longitude===TRAVEL_ORIGIN[0]&&pickup.latitude===TRAVEL_ORIGIN[1]&&dropoff.longitude===TRAVEL_DESTINATION[0]&&dropoff.latitude===TRAVEL_DESTINATION[1]&&/not connected here yet/.test(await page.textContent('#wtRidePanel'))&&/confirm your ride in Uber/.test(await page.textContent('#wtRideHint')));
    await page.click('#wtRide');await page.evaluate(()=>window.__travelGeoMode='granted');await page.click('#wtNavigate');
    await page.waitForFunction(()=>document.documentElement.classList.contains('wt-navigating')&&window.__travelWatchCount()===1);
    await page.evaluate(coordinates=>window.__travelPushFix(coordinates,12,Date.now()+25),TRAVEL_ROUTES[0].geometry[15]);
    await globe.waitForFunction(()=>__huNavigation().following&&__huIon().height<2500);
    check(scope,'Go runs one live watch and displays the current maneuver',await page.isVisible('#wtNavigation')&&(await page.textContent('#wtNavInstruction')).length>0&&await page.evaluate(()=>window.__travelWatchStarts===1&&window.__travelWatchCount()===1));
    await page.screenshot({path:join(OUT,scope+'-navigation.png')});
    await panTravelMap(page,globe);
    await page.waitForSelector('#wtRecenter:not([hidden])');
    await page.evaluate(coordinates=>window.__travelPushFix(coordinates,12,Date.now()+50),TRAVEL_ROUTES[0].geometry[16]);
    await globe.waitForFunction(()=>!__huNavigation().following);
    check(scope,'dragging the map pauses following without stopping navigation',await page.isVisible('#wtRecenter')&&await page.evaluate(()=>__travelWatchCount()===1)&&await globe.evaluate(()=>!__huNavigation().following));
    await page.click('#wtRecenter');await globe.waitForFunction(()=>__huNavigation().following);
    check(scope,'Recenter resumes following through the existing location watch',await page.isHidden('#wtRecenter')&&await page.evaluate(()=>__travelWatchStarts===1&&__travelWatchCount()===1));
    await page.click('#wtStopNavigation');await page.evaluate(()=>window.__travelLateFix([0,0]));
    check(scope,'Stop clears the watch, rejects late fixes and preserves usable route steps',await page.evaluate(()=>window.__travelWatchCount()===0&&window.__travelWatchStops===1&&!document.documentElement.classList.contains('wt-navigating'))&&await page.isHidden('#wtNavigation')&&await page.locator('#wtRouteSteps button').count()===TRAVEL_ROUTES[0].steps.length);

    await chooseTravelPlace(page,'wtTo','Lisbon');await page.locator('#wtOptions').evaluate(e=>e.open=true);
    await page.click('[data-travel-kind=flight]');await page.fill('#wtDeparture','2026-11-04');await page.click('#wtPlan');
    await globe.waitForFunction(()=>window.__huJourney().entities===3,null,{timeout:6000});
    check(scope,'only explicit longer-trip selection creates the planned flight connection',await globe.evaluate(()=>__huJourney().points===2&&__huJourney().entities===3&&__huNavigation().routePoints===0));
    check(scope,'whole trip has four unconfirmed legs without invented fares',await page.locator('.wt-leg').count()===4&&!/\$\d/.test(await page.textContent('#wtItinerary')));
    await page.click('.wt-leg [data-edit=departureHub]');await page.fill('#wtDepartureHub','JFK Terminal 4');await page.fill('#wtArrivalHub','Lisbon airport');await page.fill('#wtStay','My stay, Lisbon');
    const transfer=new URL(await page.locator('.wt-leg a').first().getAttribute('href'));
    check(scope,'optional long-trip transfer link retains explicit origin and airport',transfer.searchParams.get('origin')===`${TRAVEL_ORIGIN[1]},${TRAVEL_ORIGIN[0]}`&&transfer.searchParams.get('destination')==='JFK Terminal 4');
    await page.locator('#wtDetails').evaluate(e=>e.open=false);
    const dimensions=await page.evaluate(()=>{const r=document.documentElement,f=document.getElementById('mnWorldFeed'),g=document.getElementById('mnWorld'),before=g.getBoundingClientRect().top;f.scrollTop=130;return{sw:r.scrollWidth,cw:r.clientWidth,fixed:before===g.getBoundingClientRect().top,pageY:scrollY,minInput:Math.min(...[...document.querySelectorAll('#wtForm input')].filter(e=>e.offsetParent).map(e=>parseFloat(getComputedStyle(e).fontSize)))}});
    check(scope,'readable controls, no document overflow and stationary globe',dimensions.sw===dimensions.cw&&dimensions.fixed&&dimensions.pageY===0&&dimensions.minInput>=16,dimensions);
    await page.locator('#wtOptions').evaluate(e=>e.open=false);await page.evaluate(()=>document.getElementById('mnWorldFeed').scrollTop=0);await page.screenshot({path:join(OUT,scope+'-journey.png')});
    await page.click('.wt-world-modes [data-world-mode=missions]');
    await globe.waitForFunction(()=>!__huNavigation().travel&&!__huNavigation().locationVisible&&!__huNavigation().routeVisible);
    await page.waitForSelector('.mn-swipe__card[data-mission="'+M1+'"]');
    check(scope,'Missions opens published missions and hides private navigation overlays',await page.isVisible('.mn-swipe__card[data-mission="'+M1+'"]')&&await page.isHidden('#wtPlanner')&&await globe.evaluate(()=>!__huNavigation().locationVisible&&!__huNavigation().routeVisible));
    try {
      await globe.waitForFunction(()=>__huCompletedMissions().on&&__huCompletedMissions().pins===1);
    } catch (error) {
      /* Preserve the original gate and failure. Each diagnostic read is bounded
         and isolated so a stalled frame cannot erase the other evidence. */
      const capture = async read => {
        let timer;
        try { return await Promise.race([Promise.resolve().then(read), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Diagnostic read timed out')), 5000); })]); }
        catch (failure) { return { diagnostic_error: failure.message || String(failure) }; }
        finally { clearTimeout(timer); }
      };
      const [parentState, globeState, screenshot] = await Promise.all([
        capture(() => page.evaluate(() => ({
          mode: document.documentElement.dataset.worldMode,
          modeApi: window.MCC_WORLD_MODE?.get?.(),
          showcaseAvailable: !!window.DocketCohortShowcase,
          seriesText: document.getElementById('mnCompletedSeries')?.innerText ?? null,
          capstonePresent: !!document.getElementById('dcPreviewCapstone'),
          caption: document.getElementById('mnWorldCaption')?.textContent ?? null,
          visibility: document.visibilityState
        }))),
        capture(() => globe.evaluate(() => ({
          completed: window.__huCompletedMissions?.(),
          navigation: window.__huNavigation?.(),
          settled: window.__huGlobeSettled?.(),
          visibility: document.visibilityState
        }))),
        capture(async () => { const path = join(OUT, scope + '-completed-marker-failure.png'); await page.screenshot({ path, timeout: 4500 }); return path; })
      ]);
      const diagnostic = { scope, failure: error.message, parentState, globeState, archiveNetwork, archiveRequests: world.requests.filter(request => request.path.startsWith('/v1/action-archive/')), errors: errors.slice(), screenshot };
      console.error('COMPLETED_MARKER_DIAGNOSTIC ' + JSON.stringify(diagnostic));
      await capture(() => writeFile(join(OUT, scope + '-completed-marker-failure.json'), JSON.stringify(diagnostic, null, 2)));
      throw error;
    }
    check(scope,'the completed capstone has its own public marker in Missions',await page.isVisible('.mn-swipe__filters [data-status="completed"]')&&await globe.evaluate(()=>__huCompletedMissions().events===1&&__huCompletedMissions().pins===1&&!__huNavigation().locationVisible&&!__huNavigation().routeVisible));
    await page.press('.wt-world-modes [data-world-mode=missions]','ArrowRight');check(scope,'keyboard switches to Posts',await page.getAttribute('html','data-world-mode')==='posts'&&await page.isVisible('#mnFeed'));
    await globe.waitForFunction(()=>!__huCompletedMissions().on&&__huCompletedMissions().pins===0);
    check(scope,'Posts hides completed markers and private navigation overlays',await globe.evaluate(()=>__huCompletedMissions().pins===0&&!__huNavigation().locationVisible&&!__huNavigation().routeVisible));
    await page.click('.wt-world-modes [data-world-mode=travel]');check(scope,'switching modes preserves the planning draft',/Lisbon/.test(await page.inputValue('#wtTo')));
    if(member){
      await page.click('#wtSave');await page.waitForFunction(()=>document.getElementById('wtDraftStatus').textContent==='Saved');
      check(scope,'explicit save uses canonical member persistence',world.journeys?.length===1&&req(world,'POST',/^\/travel_journeys$/)[0]?.auth);
      await page.click('#wtSaved');await page.waitForSelector('.wt-saved-row');await page.click('#wtNew');await globe.waitForFunction(()=>__huNavigation().routePoints===0&&!__huNavigation().location);check(scope,'new journey clears destination and precise map state',await page.inputValue('#wtTo')===''&&await globe.evaluate(()=>__huNavigation().routePoints===0&&!__huNavigation().location));
      await page.click('#wtSaved');await page.waitForSelector('.wt-saved-row');await page.locator('.wt-saved-row button').first().click();check(scope,'saved draft restores endpoints, not a live watch or route',await page.inputValue('#wtDepartureHub')==='JFK Terminal 4'&&await page.inputValue('#wtStay')==='My stay, Lisbon'&&await page.evaluate(()=>__travelWatchCount()===0));
      world.journeyFail=true;await page.locator('#wtOptions').evaluate(e=>e.open=true);await page.click('[data-travel-kind=stay]');await page.fill('#wtStay','Changed stay');await page.click('#wtSave');await page.waitForFunction(()=>/could not/.test(document.getElementById('wtMessage').textContent));check(scope,'failed save remains unsaved',await page.textContent('#wtDraftStatus')==='Unsaved');
    }else{
      check(scope,'guest Travel keeps saving out of the directions flow',await page.isHidden('#wtSaveRow')&&await page.isHidden('#wtSaveFooter')&&await page.isHidden('#wtDraftStatus')&&req(world,'POST',/^\/travel_journeys$/).length===0);
    }
    check(scope,'no JavaScript errors',errors.length===0,errors);
  }finally{await ctx.close();}
}

if(runs('travel-location')) for(const geo of ['granted','delayed','delayed-destination']){
  const {ctx,page,world}=await open(DEVICES[0],{member:false,noGlobe:true,geo:geo==='delayed-destination'?'delayed':geo,travel:true});
  try{
    if(geo==='granted')check('travel-location','approved GPS fills the starting point',await page.inputValue('#wtFrom')==='Current location');
    else if(geo==='delayed-destination'){
      await page.fill('#wtTo','350 Fifth Avenue');await page.evaluate(()=>window.__travelGeoResolve());
      await page.waitForFunction(()=>document.getElementById('wtFrom').value==='Current location');
      check('travel-location','typing a destination preserves an outstanding origin request',await page.inputValue('#wtFrom')==='Current location'&&await page.inputValue('#wtTo')==='350 Fifth Avenue');
    }
    else{await page.fill('#wtFrom','My chosen starting address');await page.evaluate(()=>window.__travelGeoResolve());check('travel-location','late GPS cannot replace an edited trip',await page.inputValue('#wtFrom')==='My chosen starting address');}
    await page.fill('#wtTo','unavailable address');await page.waitForSelector('#wtToResults .wt-search-note');
    check('travel-location','an address-provider outage keeps manual input and requires a selected destination',await page.isEnabled('#wtTo')&&await page.isHidden('#wtDirections')&&/suggestions/.test(await page.textContent('#wtEndpointHint'))&&req(world,'POST',/^\/v1\/travel\/route$/).length===0);
  }finally{await ctx.close();}
}

if(runs('travel-errors')){
  const {ctx,page,world,errors}=await open(DEVICES[0],{member:false,geo:'granted',travel:true});
  try{
    const globe=page.frame({url:/action-globe\.html/});await globe.waitForFunction(()=>__huNavigation().locationVisible&&__huIon().height<5000);
    world.routeFail=true;await chooseTravelPlace(page,'wtTo','Union Station');
    await page.waitForFunction(()=>document.getElementById('wtNavigate').textContent==='Try route again');
    check('travel-errors','provider failure shows an honest retry and no fabricated route',await page.isHidden('#wtRouteCard')&&/temporarily unavailable/.test(await page.textContent('#wtRouteMessage'))&&await globe.evaluate(()=>__huNavigation().routePoints===0));
    world.routeFail=false;await showTravelRoute(page);await page.click('#wtNavigate');await page.waitForFunction(()=>__travelWatchCount()===1);
    await page.fill('#wtTo','A different address');
    await globe.waitForFunction(()=>__huNavigation().routePoints===0);
    check('travel-errors','editing a destination cancels GPS and removes old maneuvers immediately',await page.evaluate(()=>__travelWatchCount()===0)&&await page.locator('#wtRouteSteps button').count()===0&&await globe.evaluate(()=>__huNavigation().routePoints===0));
    world.holdRoute=true;await chooseTravelPlace(page,'wtTo','Union Station');
    await page.waitForFunction(()=>document.getElementById('wtNavigate').disabled&&/Finding/.test(document.getElementById('wtNavigate').textContent));
    await waitForHeldTravelRoute(world, page);
    await page.fill('#wtTo','350 Fifth Avenue');await releaseTravelRoutes(world);await page.waitForTimeout(250);
    check('travel-errors','a route response arriving after an edit cannot restore stale steps or geometry',await page.isHidden('#wtRouteCard')&&await page.locator('#wtRouteSteps button').count()===0&&await globe.evaluate(()=>__huNavigation().routePoints===0));
    world.holdRoute=true;await chooseTravelPlace(page,'wtTo','Union Station');
    await waitForHeldTravelRoute(world, page);
    await page.click('.wt-world-modes [data-world-mode=posts]');await releaseTravelRoutes(world);await page.waitForTimeout(250);await page.click('.wt-world-modes [data-world-mode=travel]');
    check('travel-errors','leaving Travel cancels an outstanding route request',await page.isHidden('#wtRouteCard')&&await globe.evaluate(()=>__huNavigation().routePoints===0)&&await page.evaluate(()=>__travelWatchCount()===0));
    check('travel-errors','no JavaScript errors',errors.length===0,errors);
  }finally{await releaseTravelRoutes(world);await ctx.close();}
}

if(runs('travel-fallback')){
  const {ctx,page,world}=await open(DEVICES[0],{member:true,noGlobe:true,travel:true});
  try{
    await chooseTravelPlace(page,'wtTo','Union Station');await page.locator('#wtOptions').evaluate(e=>e.open=true);await page.click('[data-travel-kind=flight]');await page.click('#wtPlan');
    check('travel-fallback','long-trip planning focuses a missing starting point',await page.locator('#wtFrom').evaluate(e=>e===document.activeElement)&&/starting point/.test(await page.textContent('#wtMessage')));
    await chooseTravelPlace(page,'wtFrom','New Haven');await page.click('[data-travel-kind=drive]');await showTravelRoute(page);
    check('travel-fallback','directions remain usable when Cesium cannot load',await page.isVisible('#wtRouteCard')&&await page.locator('#wtRouteSteps button').count()===TRAVEL_ROUTES[0].steps.length&&req(world,'POST',/^\/v1\/travel\/route$/).length===1);
    await page.evaluate(()=>window.__travelGeoMode='granted');await page.click('#wtNavigate');await page.waitForFunction(()=>__travelWatchCount()===1);
    await page.evaluate(()=>{localStorage.removeItem('mccdb_session');window.dispatchEvent(new CustomEvent('mcc:auth-changed'));});
    await page.waitForFunction(()=>__travelWatchCount()===0&&document.getElementById('wtTo').value==='');
    check('travel-fallback','sign-out clears private directions and stops the location watch',await page.isHidden('#wtRouteCard')&&await page.locator('#wtRouteSteps button').count()===0&&await page.inputValue('#wtFrom')==='');
  }finally{await ctx.close();}
}

if(runs('travel-rides')){
  const {ctx,page,world}=await open(DEVICES[0],{member:false,noGlobe:true,geo:'granted',travel:true});
  try{
    await page.clock.install();await chooseTravelPlace(page,'wtTo','Union Station');await page.click('#wtRide');
    check('travel-rides','a fresh permitted GPS pickup can open the official Uber handoff',await page.isVisible('#wtUber')&&await page.textContent('#wtRidePickup')==='Pickup: Your current location');
    await page.clock.fastForward(31000);
    check('travel-rides','an expired device pickup requires a fresh location before handoff',await page.isHidden('#wtUber')&&await page.isVisible('#wtRideLocate')&&await page.getAttribute('#wtUber','href')===null);
    const freshPickup=[-72.9275,41.307];await page.evaluate(coordinates=>window.__travelGeoCoordinates=coordinates,freshPickup);
    await page.click('#wtRideLocate');await page.waitForSelector('#wtUber:not([hidden])');
    const refreshed=JSON.parse(new URL(await page.getAttribute('#wtUber','href')).searchParams.get('pickup'));
    check('travel-rides','refresh uses the new pickup and leaves the destination and draft in place',refreshed.longitude===freshPickup[0]&&refreshed.latitude===freshPickup[1]&&await page.isVisible('#wtRidePanel')&&await page.inputValue('#wtFrom')==='Current location'&&/Union Station/.test(await page.inputValue('#wtTo')));
    const beforeManual=req(world,'POST',/^\/v1\/travel\/route$/).length;
    await chooseTravelPlace(page,'wtFrom','New Haven');await showTravelRoute(page);if(await page.isHidden('#wtRidePanel'))await page.click('#wtRide');
    const manual=JSON.parse(new URL(await page.getAttribute('#wtUber','href')).searchParams.get('pickup'));
    check('travel-rides','a selected manual pickup is preserved even when the blue dot is elsewhere',manual.longitude===TRAVEL_ORIGIN[0]&&manual.latitude===TRAVEL_ORIGIN[1]&&await page.isHidden('#wtRideLocate')&&req(world,'POST',/^\/v1\/travel\/route$/).length===beforeManual+1);
  }finally{await ctx.close();}
}

/* A completed event link owns its focus, including when a later Travel GPS
   request finishes after the visitor has returned to Missions. */
if(runs('mission-archive')) {
  const scope='mission-archive-iphone', event=COHORT_ARCHIVE.event;
  const {ctx,page,world,errors}=await open(DEVICES[0],{member:false,geo:'delayed',travel:true,entryPath:'/mnet.html?mode=missions&completed='+encodeURIComponent(event.slug)});
  try{
    const globe=page.frame({url:/action-globe\.html/});
    await page.waitForSelector('#mnCompletedSeries .dc-series__card',{state:'attached'});
    await globe.waitForFunction(()=>__huCompletedMissions().pins===1&&Math.abs(__huIon().height-900000)<500);
    check(scope,'completed link opens Missions without requesting travel location',await page.getAttribute('html','data-world-mode')==='missions'&&await page.evaluate(()=>__travelGeoRequests===0&&__travelWatchStarts===0));
    const focus=await globe.evaluate(()=>__huFocusPlace());
    check(scope,'archive and real globe readiness produce the capstone focus',focus?.lat===event.latitude&&focus?.lon===event.longitude&&await globe.evaluate(()=>__huCompletedMissions().on&&!__huNavigation().location&&!__huNavigation().routeVisible),focus);
    await page.click('.wt-world-modes [data-world-mode=travel]');
    await page.waitForFunction(()=>__travelGeoRequests===1&&typeof __travelGeoResolve==='function');
    await page.click('.wt-world-modes [data-world-mode=missions]');
    const completedSeries=page.locator('#mnCompletedSeries .dc-series');
    if(!(await completedSeries.evaluate(e=>e.open)))await completedSeries.locator('summary').click();
    await completedSeries.getByRole('button',{name:'Show on globe'}).click();
    await page.evaluate(()=>__travelGeoResolve());
    await globe.waitForFunction(()=>__huCompletedMissions().pins===1&&Math.abs(__huIon().height-900000)<500);
    check(scope,'late Travel GPS cannot replace the capstone focus or restore private overlays',await page.getAttribute('html','data-world-mode')==='missions'&&await globe.evaluate(()=>!__huNavigation().location&&!__huNavigation().routeVisible&&__huCompletedMissions().pins===1)&&(await page.inputValue('#wtFrom'))==='');
    check(scope,'archive browsing makes no routing or persistence request',req(world,'POST',/^\/v1\/travel\/route$|^\/travel_journeys$/).length===0&&await page.evaluate(()=>__travelWatchStarts===0));
    check(scope,'completed link has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth&&innerWidth===390));
    await page.screenshot({path:join(OUT,scope+'.png')});
    check(scope,'no JavaScript errors',errors.length===0,errors);
  }finally{await ctx.close();}
}

/* A SIGNED-OUT VISITOR STAYS IN THEIR REGION (owner, 2026-10-20). With the country feed on, the feed opens on the
   connection country; another country tapped outside Travel asks for sign-in and the globe goes back home. */
if (runs('editorial') && (!process.env.EDITORIAL_DEVICE || process.env.EDITORIAL_DEVICE === 'iphone-portrait')) {
  const scope = 'editorial-visitor-region';
  const {ctx,page,world,errors} = await open(DEVICES[0],{member:false,placeHome:'US'});
  try {
    const globe = page.frame({url:/action-globe\.html/});
    await page.waitForFunction(()=>/United States/.test(document.getElementById('huRegionLabel').textContent),null,{timeout:10000}).catch(()=>{});
    check(scope,'a visitor opens on the country of their connection',/United States/.test(await page.textContent('#huRegionLabel')) && await page.getAttribute('[data-feed-scope=local]','aria-pressed')==='true');
    check(scope,'and reads that country\'s feed',world.requests.some(r=>r.path==='/v1/world/region-feed'&&/country=US/.test(r.search)));
    check(scope,'the country\'s lives lead its feed',await page.locator('#mnFeed .mn__place-lives .mn__place-live').count()===1 && /Live in United States/.test(await page.textContent('#mnFeed .mn__place-lives')));
    const row=await page.evaluate(()=>{const r=document.querySelector('.mn__place-lives-row');return r?[r.scrollWidth>0,document.documentElement.scrollWidth===document.documentElement.clientWidth]:[false,false];});
    check(scope,'the lives row scrolls inside itself, never the page',row[0]&&row[1],row);
    await globe.waitForFunction(()=>window.__huLivePlaces?.().GB===2,null,{timeout:15000}).catch(()=>{});
    check(scope,'the globe marks a country where a broadcast is on air',await globe.evaluate(()=>window.__huLivePlaces?.().GB)===2);
    await page.screenshot({path:join(OUT,scope+'-home.png')});
    await globe.waitForFunction(()=>window.__huCountries?.().ready);
    await globe.evaluate(()=>parent.postMessage({type:'hu:country',country:{code:'FR',name:'France'}},location.origin));
    await page.waitForFunction(()=>/other regions/.test((document.getElementById('mnGuestWhy')||{}).textContent||''),null,{timeout:5000}).catch(()=>{});
    check(scope,'another country asks the visitor to sign in',await page.textContent('#mnGuestWhy')==='Sign in to explore posts, news and conversations in other regions.');
    await globe.waitForFunction(()=>window.__huCountries?.().selected==='US',null,{timeout:5000}).catch(()=>{});
    check(scope,'the globe goes back to the visitor\'s country',await globe.evaluate(()=>window.__huCountries().selected)==='US');
    check(scope,'the feed never leaves it',/United States/.test(await page.textContent('#huRegionLabel')) && !world.requests.some(r=>r.path==='/v1/world/region-feed'&&/country=FR/.test(r.search)));
    await page.evaluate(()=>{const g=document.getElementById('mnGuestWhy');if(g)g.textContent='';});
    await page.evaluate(()=>document.querySelector('#mnFeed .mn__place-live').click());
    check(scope,'watching a placed live asks a visitor to sign in, as Live does',await page.textContent('#mnGuestWhy')==='Sign in to watch live rooms.');
    check(scope,'no JavaScript errors',errors.length===0,errors);
  }finally{await ctx.close();}
}

/* A MEMBER MAY TRAVEL (owner, 2026-10-20: "they can't region hop unless they're logged in"): their session rides with
   the country feed, so the Worker lets them read any country. */
if (runs('editorial') && (!process.env.EDITORIAL_DEVICE || process.env.EDITORIAL_DEVICE === 'iphone-portrait')) {
  const scope = 'editorial-member-region';
  const {ctx,page,world,errors} = await open(DEVICES[0],{member:true,placeHome:'US'});
  try {
    const globe = page.frame({url:/action-globe\.html/});
    await globe.waitForFunction(()=>window.__huCountries?.().ready,null,{timeout:25000});
    await globe.evaluate(()=>parent.postMessage({type:'hu:country',country:{code:'FR',name:'France'}},location.origin));
    await page.waitForFunction(()=>/France/.test(document.getElementById('huRegionLabel').textContent),null,{timeout:5000}).catch(()=>{});
    await page.waitForTimeout(300);
    const fr=world.requests.filter(r=>r.path==='/v1/world/region-feed'&&/country=FR/.test(r.search));
    check(scope,'a member reads another country, with their session',/France/.test(await page.textContent('#huRegionLabel'))&&fr.length>0&&fr.every(r=>r.auth),fr);
    check(scope,'and is never asked to sign in for it',!/Sign in to read another country/.test(await page.textContent('#mnFeed')));
    /* back home: a country feed carries no media ids, so a member loads the post itself to see its photos */
    await globe.evaluate(()=>parent.postMessage({type:'hu:country',country:{code:'US',name:'United States'}},location.origin));
    const locked=page.locator('#mnFeed [data-unlock-media]').first();
    await locked.waitFor({timeout:8000}).catch(()=>{});
    check(scope,'a member is offered the photos, not asked to sign in',await locked.count()===1&&/^Show these photos and videos$/.test(await locked.textContent())&&await page.locator('#mnFeed [data-guest-ask=media]').count()===0);
    const postId=await locked.getAttribute('data-unlock-media');
    await locked.click();
    await page.waitForSelector('#mnFeed article [data-mnet-media]',{timeout:8000}).catch(()=>{});
    check(scope,'and Show loads the post with their session and draws its photos',world.requests.some(r=>r.path==='/v1/mnet/posts/'+postId&&r.auth)&&await page.locator('#mnFeed [data-mnet-media]').count()===3&&await page.locator('#mnFeed [data-unlock-media]').count()===1);
    await page.evaluate(()=>{window.__copied=null;Object.defineProperty(navigator,'share',{value:undefined,configurable:true});navigator.clipboard.writeText=t=>{window.__copied=t;return Promise.resolve();};});
    await page.locator('#mnFeed [data-action=share][data-post="'+postId+'"]').click();
    await page.waitForFunction(()=>window.__copied,null,{timeout:3000}).catch(()=>{});
    check(scope,'a country feed\'s public post can be shared',String(await page.evaluate(()=>window.__copied)).includes('post='+postId)&&!/Only public posts can be shared/.test(await page.textContent('#mnFeedStatus')));
    check(scope,'no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
    check(scope,'no JavaScript errors',errors.length===0,errors);
  }finally{await ctx.close();}
}

/* A STATE (owner, 2026-10-21: "once you've selected a country ... select a state thereafter, but only after selecting the
   country already and double tapping the state"). The World as it ships, on a phone, with real taps on the real globe:
   Kenya's provinces, where the fixture's Nairobi stories are. */
if (runs('editorial-state') && (!process.env.EDITORIAL_DEVICE || process.env.EDITORIAL_DEVICE === 'iphone-portrait')) {
  const scope = 'editorial-state';
  const {ctx,page,errors} = await open(DEVICES[0],{member:true,social:true});
  try {
    const globe = page.frame({url:/action-globe\.html/});
    await globe.waitForFunction(()=>window.__huCountries?.().ready,null,{timeout:25000});
    await page.waitForSelector('#mnFeed [data-news-id]',{timeout:15000}).catch(()=>{});
    /* the news heat map from afar: the countries the day's stories mention, shaded by how many */
    await globe.waitForFunction(()=>window.__huCountries().heat?.countries===16,null,{timeout:20000}).catch(()=>{});
    for(const [name,lon,lat] of [['americas',-75,20],['eurafrica',20,20]]){await globe.evaluate(([lon,lat])=>window.__huCountriesCam.view(lon,lat,1.4e7),[lon,lat]);await page.waitForTimeout(2500);await page.screenshot({path:join(OUT,scope+'-heat-'+name+'.png')});}
    const legendBox=await page.evaluate(()=>{const f=document.getElementById('mnWorldFrame').getBoundingClientRect(),l=document.getElementById('mnWorldFrame').contentDocument.getElementById('heatLegend').getBoundingClientRect(),x=f.left+l.left+l.width/2,y=f.top+l.top+l.height/2,t=document.elementFromPoint(x,y);return{top:t&&t.id,w:Math.round(l.width),bottom:Math.round(f.height-l.bottom)}});
    check(scope,'the heat map\'s legend sits on the globe where nothing on the page covers it',legendBox.top==='mnWorldFrame'&&legendBox.w>=120,legendBox);
    await globe.evaluate(()=>window.__huCountriesCam.view(37.6,-0.4,1.5e6));
    await globe.waitForFunction(()=>window.__huCountries().lines===1,null,{timeout:15000}).catch(()=>{});
    await page.waitForTimeout(800);
    const frame = await page.locator('#mnWorldFrame').boundingBox();
    /* a place on the page, and what is on top of it there (the frame, or something covering the globe) */
    const at = async (lon,lat)=>{const s=await globe.evaluate(([lon,lat])=>window.__huCountriesCam.screen(lon,lat),[lon,lat]);const x=frame.x+s.x,y=frame.y+s.y;return {x,y,top:await page.evaluate(([x,y])=>{const t=document.elementFromPoint(x,y);return t&&t.id},[x,y])};};
    /* a double tap: two taps on the globe 150 ms apart by their own clock. Playwright's clicks each wait on a software-rendered
       frame and can land further apart than a person's, so the two go to the globe's tap directly (the single taps below
       are real clicks) */
    const twice = (p)=>globe.evaluate(({x,y})=>{const t=performance.now();window.__huCountriesCam.tap(x,y,t);window.__huCountriesCam.tap(x,y,t+150);},{x:p.x-frame.x,y:p.y-frame.y});
    const gap = ()=>page.waitForTimeout(700);
    const now = ()=>globe.evaluate(()=>({selected:window.__huCountries().selected,state:window.__huCountries().selectedState,card:window.__huCountries().card}));
    const eastern = await at(38.1,-1.3), nairobi = await at(37.05,-1.25);
    check(scope,'the taps land on the globe, nothing on the page covers them',eastern.top==='mnWorldFrame'&&nairobi.top==='mnWorldFrame',{eastern,nairobi});
    /* a double tap on a country not yet selected selects the country, and nothing more */
    await twice(eastern);
    await globe.waitForFunction(()=>window.__huCountries().selected==='KE',null,{timeout:5000}).catch(()=>{});
    await gap();
    const first = await now();
    check(scope,'a double tap on a country not yet selected selects the country only',first.selected==='KE'&&!first.state&&await page.textContent('#huRegionLabel')==='Kenya',first);
    check(scope,'its card says a state can be chosen',/Double-tap a state to choose it/.test(first.card||''),first.card);
    /* THE NEWS HEAT MAP: the card gives the count, and the country's states are shaded by the stories placed in them */
    await globe.waitForFunction(()=>window.__huCountries().heat?.stateFill,null,{timeout:15000}).catch(()=>{});
    const kh=await globe.evaluate(()=>window.__huCountries().heat);
    check(scope,'Kenya\'s states take the heat',kh&&kh.states===1&&kh.stateFill,kh);
    /* THE PLACE CARD (owner, 2026-10-21: "only in the middle ... how many users ... news articles ... posts"): the page draws
       it, centred and narrow, below the bar, uncovered, with the globe's buttons stepped out from under it */
    await page.waitForFunction(()=>{const c=document.getElementById('mnPlaceCard');return c&&!c.hidden&&/members/.test(c.textContent)&&/\b19\b/.test(c.textContent)},null,{timeout:10000}).catch(()=>{});
    const pc=await page.evaluate(()=>{const c=document.getElementById('mnPlaceCard'),r=c.getBoundingClientRect(),bar=document.querySelector('.mn__top').getBoundingClientRect(),st=document.getElementById('mnWorldStack').getBoundingClientRect(),t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      const stats=[...c.querySelectorAll('.mn__place-stat')].map(x=>x.textContent);return{text:c.textContent,stats,left:Math.round(r.left),right:Math.round(innerWidth-r.right),w:Math.round(r.width),vw:innerWidth,top:Math.round(r.top),barBottom:Math.round(bar.bottom),onTop:!!(t&&c.contains(t)),stackClear:!(st.width&&st.left<r.right&&st.right>r.left&&st.top<r.bottom&&st.bottom>r.top),liveClear:(()=>{const l=document.getElementById('mnWorldLive').getBoundingClientRect();return !(l.width&&l.left<r.right&&l.right>r.left&&l.top<r.bottom&&l.bottom>r.top)&&!(l.width&&st.width&&l.left<st.right&&l.right>st.left&&l.top<st.bottom&&l.bottom>st.top)})(),frameCard:getComputedStyle(document.getElementById('mnWorldFrame').contentDocument.getElementById('countryCard')).display}});
    check(scope,'the place card sits in the middle at the top, not the full width: centred, under the bar, nothing over it, the buttons stepped aside',Math.abs(pc.left-pc.right)<=2&&pc.w<=300&&pc.w<pc.vw-40&&pc.top>=pc.barBottom&&pc.onTop&&pc.stackClear&&pc.liveClear&&pc.frameCard==='none',pc);
    const under = await Promise.all([eastern,nairobi].map((p)=>page.evaluate(([x,y])=>{const t=document.elementFromPoint(x,y);return t&&t.id},[p.x,p.y])));
    check(scope,'with the card up, the places to tap are still the globe\'s',under.every((t)=>t==='mnWorldFrame'),under);
    check(scope,'it gives Kenya\'s three counts: news today, posts placed there, members who share their region',JSON.stringify(pc.stats)===JSON.stringify(['8news · 24 h','3posts','19members'])&&/Kenya/.test(pc.text)&&/Double-tap a state to choose it/.test(pc.text),pc.stats);
    await page.screenshot({path:join(OUT,scope+'-place-card.png')});
    await page.waitForFunction(()=>document.querySelectorAll('#mnFeed [data-news-id]').length>0,null,{timeout:8000}).catch(()=>{});
    const kenya = await page.locator('#mnFeed [data-news-id]').count();
    check(scope,'Local shows Kenya\'s stories',kenya>0&&await page.getAttribute('[data-feed-scope=local]','aria-pressed')==='true',kenya);
    /* with Kenya selected, a double tap picks the province under it */
    await twice(eastern);
    await globe.waitForFunction(()=>window.__huCountries().selectedState,null,{timeout:8000}).catch(()=>{});
    const east = await now();
    await page.waitForFunction(()=>document.getElementById('huRegionLabel').textContent==='Eastern, Kenya',null,{timeout:5000}).catch(()=>{});
    check(scope,'a double tap inside the selected country picks the state: lit, named on the card and the label',east.selected==='KE'&&!!east.state&&/^Eastern\s*Kenya\s*×?\s*0news · 24 h/.test(east.card||'')&&await page.textContent('#huRegionLabel')==='Eastern, Kenya',east);
    check(scope,'Local keeps only the stories placed in it: none in Eastern',await page.locator('#mnFeed [data-news-id]').count()===0&&/No story mentions Eastern, Kenya yet/.test(await page.textContent('#mnFeed')));
    await page.screenshot({path:join(OUT,scope+'-eastern.png')});
    await gap();
    /* another state of the same country: picked the same way, with no second read of the country */
    await twice(nairobi);
    await page.waitForFunction(()=>document.getElementById('huRegionLabel').textContent==='Nairobi, Kenya',null,{timeout:8000}).catch(()=>{});
    await page.waitForFunction(()=>document.querySelectorAll('#mnFeed [data-news-id]').length>0,null,{timeout:5000}).catch(()=>{});
    const nb = await now();
    check(scope,'a double tap on another state picks it, and its stories come back',/Nairobi/.test(nb.card||'')&&/8news · 24 h/.test(nb.card||'')&&await page.textContent('#huRegionLabel')==='Nairobi, Kenya'&&await page.locator('#mnFeed [data-news-id]').count()===kenya,{nb,count:await page.locator('#mnFeed [data-news-id]').count(),kenya});
    await page.screenshot({path:join(OUT,scope+'-nairobi.png')});
    await gap();
    /* a single tap inside the country goes back to the whole country; another lets the country go, as before */
    await page.mouse.click(eastern.x,eastern.y);
    await globe.waitForFunction(()=>!window.__huCountries().selectedState,null,{timeout:5000}).catch(()=>{});
    await gap();
    const back = await now();
    check(scope,'a single tap inside the country goes back to the whole country',back.selected==='KE'&&!back.state&&await page.textContent('#huRegionLabel')==='Kenya',back);
    await page.mouse.click(eastern.x,eastern.y);
    await globe.waitForFunction(()=>!window.__huCountries().selected,null,{timeout:5000}).catch(()=>{});
    await gap();
    check(scope,'and one more lets the country go, as it always has',!(await now()).selected&&await page.textContent('#huRegionLabel')==='All regions');
    check(scope,'no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
    check(scope,'no JavaScript errors',errors.length===0,errors);
  }finally{await ctx.close();}
}

/* THE NEWSROOM (owner, 2026-10-20): the house owner, and only the house owner, may also publish a post as an article on
   mccluster.org/news/; the Worker checks again (workers/mccluster/test/newsroom.test.mjs). */
if (runs('editorial') && (!process.env.EDITORIAL_DEVICE || process.env.EDITORIAL_DEVICE === 'iphone-portrait')) for (const admin of [true, false]) {
  const scope = admin ? 'editorial-newsroom-owner' : 'editorial-newsroom-member';
  const {ctx,page,world,errors} = await open(DEVICES[0],{member:true,admin});
  try {
    await page.waitForSelector('#mnPostBody');
    await page.focus('#mnPostBody');
    await page.waitForFunction(()=>document.getElementById('mnComposer').classList.contains('is-open'),null,{timeout:5000}).catch(()=>{});
    await page.waitForTimeout(400);
    const row=await page.evaluate(()=>{const r=document.getElementById('mnNewsroomRow');const b=r&&r.getBoundingClientRect();return {shown:!!r&&!r.hidden&&getComputedStyle(r).display!=='none',h:b?Math.round(b.height):0,box:document.querySelector('#mnNewsroom')?.getBoundingClientRect().width||0};});
    if (!admin) {
      check(scope,'a member is never offered the newsroom',!row.shown,row);
    } else {
      check(scope,'the house owner is offered the newsroom while writing, as a full-height tap target',row.shown&&row.h>=44,row);
      await page.fill('#mnPostBody','Morning brief: what moved yesterday\n\nThe story, in my words.');
      await page.check('#mnNewsroom');
      await page.selectOption('#mnVisibility','network');
      await page.click('#mnPost');
      check(scope,'a newsroom article must be public, and nothing is sent until it is',/is public/.test(await page.textContent('#mnPostStatus'))&&!req(world,'POST',/^\/v1\/mnet\/posts$/).length);
      await page.selectOption('#mnVisibility','public');
      await page.click('#mnPost');
      await page.waitForFunction(()=>/newsroom/.test(document.getElementById('mnPostStatus').textContent),null,{timeout:8000}).catch(()=>{});
      const sent=req(world,'POST',/^\/v1\/mnet\/posts$/).at(-1);
      check(scope,'Post sends the newsroom mark with the owner\'s session',!!sent&&sent.auth&&sent.body.newsroom===true&&sent.body.visibility==='public',sent&&sent.body);
      const link=await page.getAttribute('#mnPostStatus a','href');
      check(scope,'and links the article on McCluster Corp\'s site',/^https:\/\/mccluster\.org\/news\/[0-9a-f-]{36}$/.test(link||''),link);
      check(scope,'the tick clears for the next post',!(await page.isChecked('#mnNewsroom')));
    }
    check(scope,'no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
    check(scope,'no JavaScript errors',errors.length===0,errors);
  }finally{await ctx.close();}
}

/* NO BLACK VIDEOS (owner, 2026-10-20: "when people upload videos, there's no thumbnail, just a black video ... I want
   people to be even able to edit the videos they previously posted as a thumbnail"). A video post shows its picture; a
   video with none starts a tenth of a second in so a first frame paints; one this device cannot play shows its picture
   and says so; and the author changes the picture of their own video, by a frame or an image of their own. */
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
const thumbOf = (page, id) => page.locator(`#mnFeed article[data-post-id="${id}"] [data-mnet-media]`).first();
if (runs('editorial-video')) for (const device of DEVICES.filter((d) => ['iphone-portrait', 'desktop'].includes(d.name) && (!process.env.EDITORIAL_DEVICE || d.name === process.env.EDITORIAL_DEVICE))) {
  const scope = `editorial-video-poster-${device.name}`;
  const { ctx, page, world, errors } = await open(device, { member: true, videoPosts: true });
  try {
    const { mine, bare, broken } = world.videoPosts;
    await page.waitForSelector(`#mnFeed article[data-post-id="${mine.id}"] video[poster]`, { timeout: 15000 }).catch(() => {});
    const read = (id) => thumbOf(page, id).evaluate((n) => { const v = n.querySelector('video'); return v ? { poster: v.getAttribute('poster'), preload: v.getAttribute('preload'), src: v.getAttribute('src'), playsinline: v.hasAttribute('playsinline') } : { html: n.innerHTML.slice(0, 200) }; });
    const own = await read(mine.id);
    check(scope, 'a video post shows its picture: video[poster], preload=metadata, inline', /assets\/frames\/affix_0001\.jpg$/.test(own.poster || '') && own.preload === 'metadata' && own.playsinline && /hero\.webm$/.test(own.src || ''), own);
    await page.waitForSelector(`#mnFeed article[data-post-id="${bare.id}"] video`, { timeout: 10000 }).catch(() => {});
    const none = await read(bare.id);
    check(scope, 'a video with no picture starts a tenth of a second in (#t=0.1) so a first frame paints', !none.poster && /hero\.webm#t=0\.1$/.test(none.src || '') && none.preload === 'metadata', none);
    await page.waitForSelector(`#mnFeed article[data-post-id="${broken.id}"] .mn__video-note`, { timeout: 10000 }).catch(() => {});
    const bad = await thumbOf(page, broken.id).evaluate((n) => ({ note: (n.querySelector('.mn__video-note') || {}).textContent || '', img: (n.querySelector('img') || {}).src || '', video: !!n.querySelector('video') }));
    check(scope, 'a video this device cannot play shows its picture and says so', /can.t play on this device/.test(bad.note) && /bussalick_0001\.jpg$/.test(bad.img) && !bad.video, bad);
    check(scope, 'Thumbnail is offered on the member\'s own video post only, as a 44px tap target',
      await page.locator(`#mnFeed article[data-post-id="${mine.id}"] [data-action=thumbnail]`).count() === 1 &&
      await page.locator(`#mnFeed article[data-post-id="${bare.id}"] [data-action=thumbnail], #mnFeed article[data-post-id="${broken.id}"] [data-action=thumbnail]`).count() === 0 &&
      await page.locator(`#mnFeed article[data-post-id="${mine.id}"] [data-action=thumbnail]`).evaluate((b) => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }));
    check(scope, 'no horizontal overflow with video posts in the feed', await noSideways(page));
    const center = (id) => page.locator(`#mnFeed article[data-post-id="${id}"]`).evaluate((a) => a.scrollIntoView({ block: 'center' }));
    await center(mine.id);
    await page.waitForTimeout(400);
    await page.locator(`#mnFeed article[data-post-id="${mine.id}"]`).screenshot({ path: join(OUT, scope + '-card.png') });

    /* the editor: a frame of the video */
    /* a tap, as the feed may still be settling under a software-rendered globe */
    await page.locator(`#mnFeed article[data-post-id="${mine.id}"] [data-action=thumbnail]`).evaluate((b) => b.click());
    await page.waitForSelector('#mnThumbDialog[open]', { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => !document.getElementById('mnThumbPick').hidden, null, { timeout: 60000 }).catch(() => {});
    check(scope, 'the editor opens with the video\'s frames to pick from (same-origin storage: pixels readable)', !(await page.isHidden('#mnThumbPick')) && await page.isVisible('#mnThumbVideo'));
    const fresh = req(world, 'GET', new RegExp(`^/v1/mnet/media/${VID.mine}/url$`));
    check(scope, 'the editor asks for a fresh address for the video, with the member\'s session', fresh.length >= 2 && fresh.every((r) => r.auth), fresh.length);
    check(scope, 'the video is read with CORS, so a frame may become a picture', await page.getAttribute('#mnThumbVideo', 'crossorigin') === 'anonymous');
    await page.$eval('#mnThumbRange', (r) => { r.value = String(Math.round(Number(r.max) * 0.6)); r.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => { const v = document.getElementById('mnThumbVideo'); return v.readyState >= 2 && !v.seeking && v.currentTime > 1; }, null, { timeout: 8000 }).catch(() => {});
    const fit = await page.evaluate(() => {
      const d = document.getElementById('mnThumbDialog').getBoundingClientRect(), tall = (id) => document.getElementById(id).offsetHeight; /* layout size: the sheet's entrance scale does not count */
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, left: Math.round(d.left), right: Math.round(d.right), iw: innerWidth,
        inner: document.getElementById('mnThumbDialog').scrollWidth <= document.getElementById('mnThumbDialog').clientWidth,
        use: tall('mnThumbUseFrame'), upload: tall('mnThumbUpload'), range: tall('mnThumbRange'), close: tall('mnThumbClose') };
    });
    check(scope, 'the editor fits the screen: no horizontal scroll, nothing sideways inside it', fit.sw === fit.cw && fit.left >= 0 && fit.right <= fit.iw && fit.inner, fit);
    check(scope, 'the editor\'s controls are full tap targets (44px)', fit.use >= 44 && fit.upload >= 44 && fit.range >= 44 && fit.close >= 44, fit);
    /* a software-rendered globe under a blurred backdrop is slow to capture on a desktop runner */
    await page.screenshot({ path: join(OUT, scope + '-editor.png'), timeout: 90000 });
    const before = world.uploadN || 0;
    /* a save is an upload, a finalize and a PATCH; a loaded runner can take its time, so wait for the PATCH itself */
    const patches = () => req(world, 'PATCH', /^\/v1\/mnet\/posts\//).length;
    const saved = async (n, s = 60) => { for (let t = 0; t < s * 10 && patches() <= n; t++) await page.waitForTimeout(100); await page.waitForFunction(() => !document.getElementById('mnThumbDialog').open, null, { timeout: 15000 }).catch(() => {}); };
    const p1 = patches();
    await page.click('#mnThumbUseFrame');
    await saved(p1);
    const frameId = asset(100 + before + 1), patch = req(world, 'PATCH', /^\/v1\/mnet\/posts\//).at(-1);
    const up = world.requests.filter((r) => r.path === '/v1/mnet/media/upload-url').at(-1), fin = world.requests.filter((r) => r.path === '/v1/mnet/media/finalize').at(-1);
    check(scope, 'Use this frame uploads the frame as a JPEG and finalizes it with its size', world.uploadN === before + 1 && up.body.mime_type === 'image/jpeg' && fin.body.asset_id === frameId && fin.body.width > 0 && fin.body.height > 0 && Math.max(fin.body.width, fin.body.height) <= 1080, { up: up && up.body, fin: fin && fin.body });
    check(scope, 'and sends poster_by_media {video: new picture} for that post, with the member\'s session', !!patch && patch.auth && patch.path === '/v1/mnet/posts/' + mine.id && JSON.stringify(patch.body) === JSON.stringify({ poster_by_media: { [VID.mine]: frameId } }), patch && patch.body);
    await page.waitForFunction((id) => { const n = document.querySelector(`#mnFeed article[data-post-id="${id}"] video[poster]`); return n && /token=view$/.test(n.getAttribute('poster')); }, mine.id, { timeout: 8000 }).catch(() => {});
    const after = await read(mine.id);
    check(scope, 'the card draws its new picture at once, from the new asset', (after.poster || '').endsWith(`${frameId}-thumbnail-poster.jpg?token=view`) && await thumbOf(page, mine.id).getAttribute('data-poster-asset') === frameId, after);
    check(scope, 'the feed says so', /Thumbnail updated/.test(await page.textContent('#mnFeedStatus')));
    await center(mine.id);
    await page.waitForTimeout(600);
    await page.locator(`#mnFeed article[data-post-id="${mine.id}"]`).screenshot({ path: join(OUT, scope + '-card-after.png') });

    /* or a picture of the member's own */
    /* a tap, as the feed may still be settling under a software-rendered globe */
    await page.locator(`#mnFeed article[data-post-id="${mine.id}"] [data-action=thumbnail]`).evaluate((b) => b.click());
    await page.waitForSelector('#mnThumbDialog[open]', { timeout: 30000 }).catch(() => {});
    const p2 = patches(), picture = join(ROOT, 'assets/frames/church_0001.jpg');
    /* as a person does it: Upload an image opens the file chooser, and the picture is chosen there. The sheet rises in, and a
       software-rendered page can take a while to let it settle, so the tap waits until the button can take it */
    /* CI's software-rendered page (globe, feed videos and the editor's own video at once) can take minutes here: the editor
       is let finish loading its video, the tap and the save get the time that takes, and a miss says where it stopped */
    await page.waitForFunction(() => !/Loading the video/.test(document.getElementById('mnThumbStatus').textContent), null, { timeout: 120000 }).catch(() => {});
    let tapped = null;
    await page.click('#mnThumbUpload', { timeout: 60000, trial: true }).catch((e) => { tapped = 'trial: ' + String(e.message || e).split('\n')[0]; });
    const chooser = await Promise.all([page.waitForEvent('filechooser', { timeout: 60000 }), page.click('#mnThumbUpload', { timeout: 60000 })]).then(([c]) => c).catch((e) => { tapped = (tapped ? tapped + ' / ' : '') + String(e.message || e).split('\n')[0]; return null; });
    if (chooser) await chooser.setFiles(picture);
    await saved(p2, 180);
    const imageId = asset(100 + before + 2), patch2 = req(world, 'PATCH', /^\/v1\/mnet\/posts\//).at(-1), fin2 = world.requests.filter((r) => r.path === '/v1/mnet/media/finalize').at(-1);
    const said = await page.evaluate(() => { const f = document.getElementById('mnThumbFile'); return { open: document.getElementById('mnThumbDialog').open, status: document.getElementById('mnThumbStatus').textContent, disabled: f.disabled, files: f.files.length }; });
    said.chooser = !!chooser; said.tapped = tapped;
    if (said.open) await page.screenshot({ path: join(OUT, scope + '-upload-stuck.png') }).catch(() => {});
    check(scope, 'Upload an image sends that picture, finalized with its own size', JSON.stringify(patch2.body) === JSON.stringify({ poster_by_media: { [VID.mine]: imageId } }) && fin2.body.asset_id === imageId && fin2.body.width > 0, { patch: patch2.body, fin: fin2.body, said, uploads: world.uploadN });
    check(scope, 'no horizontal overflow after the edits', await noSideways(page));
    check(scope, 'no JavaScript errors', errors.length === 0, errors);
  } finally { await ctx.close(); }
}

/* the composer: the picture is taken while the clip uploads, shown on the chip, and posted beside the video */
if (runs('editorial-video') && (!process.env.EDITORIAL_DEVICE || process.env.EDITORIAL_DEVICE === 'iphone-portrait')) {
  const scope = 'editorial-video-composer';
  const { ctx, page, world, errors } = await open(DEVICES[0], { member: true });
  try {
    await page.waitForSelector('#mnPostBody');
    await page.focus('#mnPostBody');
    await page.waitForFunction(() => document.getElementById('mnComposer').classList.contains('is-open'), null, { timeout: 5000 }).catch(() => {});
    await page.setInputFiles('#mnMediaInput', join(ROOT, 'assets/video/hero.webm'));
    await page.waitForSelector('#mnMediaQueue .mn__media-chip.is-video', { timeout: 20000 }).catch(() => {});
    const chip = await page.evaluate(() => { const c = document.querySelector('#mnMediaQueue .mn__media-chip.is-video'); const img = c && c.querySelector('img'); return c ? { img: img ? img.src.slice(0, 5) : '', w: img ? img.naturalWidth : 0, play: !!c.querySelector('.mn__media-play'), video: !!c.querySelector('video') } : null; });
    check(scope, 'the chip shows the clip\'s picture with a play mark, not a black video', !!chip && chip.img === 'blob:' && chip.w > 0 && chip.play && !chip.video, chip);
    const ups = world.requests.filter((r) => r.path === '/v1/mnet/media/upload-url'), fins = world.requests.filter((r) => r.path === '/v1/mnet/media/finalize');
    const vUp = ups.find((r) => r.body.mime_type === 'video/webm'), pUp = ups.find((r) => r.body.mime_type === 'image/jpeg');
    const vId = vUp && asset(100 + ups.indexOf(vUp) + 1), pId = pUp && asset(100 + ups.indexOf(pUp) + 1);
    const vFin = fins.find((r) => r.body.asset_id === vId), pFin = fins.find((r) => r.body.asset_id === pId);
    check(scope, 'the clip and its picture both go up; the clip is finalized with its size and length', !!vFin && vFin.body.width === 1280 && vFin.body.height === 720 && Math.abs(vFin.body.duration_ms - 8042) < 100, vFin && vFin.body);
    check(scope, 'the picture is a JPEG no longer than 1080px, finalized with its size', !!pFin && pFin.body.width === 1080 && pFin.body.height === 608, pFin && pFin.body);
    const stored = world.blobs && Object.entries(world.blobs).find(([k]) => k.includes(pId || 'none'));
    check(scope, 'the picture uploaded is a real JPEG, not an empty frame', !!stored && stored[1].type === 'image/jpeg' && stored[1].body.length > 5000 && stored[1].body[0] === 0xff && stored[1].body[1] === 0xd8, stored && stored[1].body.length);
    check(scope, 'no horizontal overflow with the chip', await noSideways(page));
    await page.locator('#mnComposer').screenshot({ path: join(OUT, scope + '-chip.png') });
    await page.fill('#mnPostBody', 'Fresh clip from the river.');
    await page.click('#mnPost');
    await page.waitForFunction(() => /Posted/.test(document.getElementById('mnPostStatus').textContent), null, { timeout: 8000 }).catch(() => {});
    const sent = req(world, 'POST', /^\/v1\/mnet\/posts$/).at(-1);
    check(scope, 'Post sends the clip with its picture beside it', !!sent && JSON.stringify(sent.body.media_asset_ids) === JSON.stringify([vId]) && JSON.stringify(sent.body.poster_asset_ids) === JSON.stringify([pId]), sent && sent.body);
    const posted = world.posts[0];
    await page.waitForSelector(`#mnFeed article[data-post-id="${posted.id}"] video[poster]`, { timeout: 10000 }).catch(() => {});
    const card = await thumbOf(page, posted.id).evaluate((n) => { const v = n.querySelector('video'); return v ? { poster: v.getAttribute('poster'), preload: v.getAttribute('preload') } : null; }).catch(() => null);
    check(scope, 'the new post in the feed shows the picture that was taken, not black', !!card && (card.poster || '').startsWith(`https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/sign/mnet-media/auth-you/${pId}-`) && card.preload === 'metadata', card);
    await page.waitForFunction((id) => { const v = document.querySelector(`#mnFeed article[data-post-id="${id}"] video`); return v && v.readyState >= 1; }, posted.id, { timeout: 8000 }).catch(() => {});
    await page.locator(`#mnFeed article[data-post-id="${posted.id}"]`).evaluate((a) => a.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(600);
    await page.locator(`#mnFeed article[data-post-id="${posted.id}"]`).screenshot({ path: join(OUT, scope + '-feed-card.png') });
    check(scope, 'no JavaScript errors', errors.length === 0, errors);
  } finally { await ctx.close(); }
}

/* Create: a cover is taken while the clip uploads; a tap on a frame of the strip chooses another; Post sends it */
if (runs('editorial-video') && (!process.env.EDITORIAL_DEVICE || process.env.EDITORIAL_DEVICE === 'iphone-portrait')) {
  const scope = 'editorial-video-create-cover';
  const world = freshWorld();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: DEVICES[0].viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
    const exp = Math.floor(Date.now() / 1000) + 3600;
    localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).replace(/=+$/, '') + '.y', refresh_token: 'r', expires_at: exp }));
  });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.abort());
  await routeBackends(ctx, world, { member: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/TypeError|ReferenceError|SyntaxError/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  try {
    await page.goto(BASE + '/create.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#crMake:not([hidden])', { timeout: 30000 });
    await page.setInputFiles('#crLibrary', join(ROOT, 'assets/video/hero.webm'));
    await page.waitForFunction(() => !document.getElementById('crCoverImg').hidden, null, { timeout: 20000 }).catch(() => {});
    const covers = () => world.requests.filter((r) => r.path === '/v1/mnet/media/upload-url' && r.body.mime_type === 'image/jpeg');
    const idOf = (r) => r && asset(100 + world.requests.filter((x) => x.path === '/v1/mnet/media/upload-url').indexOf(r) + 1);
    /* the cover's upload request follows its picture by a tick (the session is checked first) */
    const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await page.waitForTimeout(100); return fn(); };
    await until(() => covers().length >= 1);
    check(scope, 'a cover is taken for the clip and shown on the Cover chip, with its mark on the strip', !(await page.isHidden('#crCoverImg')) && !(await page.isHidden('#crCoverMark')) && covers().length === 1, covers().length);
    await page.waitForFunction(() => /Uploaded/.test(document.getElementById('crUploadT').textContent), null, { timeout: 15000 }).catch(() => {});
    check(scope, 'the edit step fits a phone: no horizontal scroll', await noSideways(page));
    check(scope, 'Cover is a full tap target', await page.locator('#crCover').evaluate((b) => b.getBoundingClientRect().height >= 44));
    const first = covers()[0], firstId = idOf(first);
    const mark0 = await page.$eval('#crCoverMark', (m) => m.style.left);
    /* the last frame of the strip */
    const strip = await page.locator('#crStrip').boundingBox();
    await page.mouse.click(strip.x + strip.width - 30, strip.y + strip.height / 2);
    await page.waitForFunction((n) => document.getElementById('crCover').getAttribute('aria-busy') !== 'true' && document.getElementById('crCoverMark').style.left !== n, mark0, { timeout: 15000 }).catch(() => {});
    await until(() => covers().length >= 2 && world.requests.some((r) => r.path === '/v1/mnet/media/discard' && r.body.asset_id === firstId));
    const mark1 = await page.$eval('#crCoverMark', (m) => parseFloat(m.style.left));
    check(scope, 'a tap on a frame of the strip makes it the cover, and the old cover is discarded', covers().length === 2 && mark1 > 80 && !!firstId && world.requests.some((r) => r.path === '/v1/mnet/media/discard' && r.body.asset_id === firstId), { covers: covers().length, mark1 });
    await page.screenshot({ path: join(OUT, scope + '-edit.png') });
    /* a new cover that fails to go up gives the one before it back, and that one is still the post's */
    world.failCover = 1;
    const tried = covers().length;
    await page.mouse.click(strip.x + 30, strip.y + strip.height / 2);
    await until(() => covers().length > tried);
    await page.waitForFunction(() => document.getElementById('crCover').getAttribute('aria-busy') !== 'true' && parseFloat(document.getElementById('crCoverMark').style.left) > 80, null, { timeout: 15000 }).catch(() => {});
    const kept = await page.evaluate(() => ({ mark: parseFloat(document.getElementById('crCoverMark').style.left), shown: !document.getElementById('crCoverImg').hidden }));
    check(scope, 'a new cover that fails to go up gives back the one before it, and nothing is discarded', covers().length === tried + 1 && kept.mark > 80 && kept.shown && !world.requests.some((r) => r.path === '/v1/mnet/media/discard' && r.body.asset_id === idOf(covers()[1])), { kept, covers: covers().length });
    /* the account chip sits over Next at the top right of Create on a phone (as on main; reported, not changed here) */
    await page.$eval('#crEditNext', (b) => b.click());
    await page.waitForSelector('#crDetails:not([hidden])');
    check(scope, 'the details step shows the cover beside the caption', await page.locator('#crThumb img[alt="Cover"]').count() === 1);
    await page.fill('#crCaption', 'River cleanup, the cut.');
    await page.click('#crPost');
    await page.waitForSelector('#crDone:not([hidden])', { timeout: 15000 }).catch(() => {});
    const sent = req(world, 'POST', /^\/v1\/mnet\/posts$/).at(-1), video = world.requests.find((r) => r.path === '/v1/mnet/media/upload-url' && r.body.mime_type === 'video/webm');
    const coverId = idOf(covers()[1]);
    check(scope, 'Post sends the clip and its chosen cover side by side', !!sent && JSON.stringify(sent.body.media_asset_ids) === JSON.stringify([idOf(video)]) && JSON.stringify(sent.body.poster_asset_ids) === JSON.stringify([coverId]), sent && sent.body);
    check(scope, 'the cover sent is never discarded', !world.requests.some((r) => r.path === '/v1/mnet/media/discard' && r.body.asset_id === coverId));
    check(scope, 'no JavaScript errors', errors.length === 0, errors);
  } finally { await ctx.close(); }
}

/* THE WORLD IS THE SOCIAL FEED (owner, 2026-10-20: "the transport and the missions feature will be taken off and the social
   feature will be the only feature with no tab selecting between the other two"; "open missions belong in missions not inside
   the newsfeed"; "Notification should be a drop down menu not open a whole new page"). The page exactly as it ships. */
if (runs('editorial')) for (const device of DEVICES.filter(d=>(!process.env.EDITORIAL_DEVICE&&['iphone-portrait','desktop'].includes(d.name))||d.name===process.env.EDITORIAL_DEVICE)) for (const member of [false, true]) {
  const scope = `editorial-social-${device.name}-${member ? 'member' : 'guest'}`;
  const {ctx,page,world,errors} = await open(device,{member,social:true});
  try {
    const globe = page.frame({url:/action-globe\.html/});
    await page.waitForSelector('#mnFeed [data-post-id]',{timeout:15000}).catch(()=>{});
    const shell = await page.evaluate(()=>{const h=document.documentElement,visible=el=>!!el&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';
      return {social:h.classList.contains('hu-social-only'),mode:h.dataset.worldMode,tabs:[...document.querySelectorAll('.wt-world-modes,.wt-world-modes button')].some(visible),
        feed:!document.getElementById('mnFeedView').hidden,posts:document.querySelectorAll('#mnFeed [data-post-id]').length,
        planner:visible(document.getElementById('wtPlanner')),frame:document.getElementById('mnWorldFrame').getAttribute('src'),
        expand:document.querySelector('.mn__world-expand').getAttribute('href')};});
    check(scope,'the World is the social feed: no Travel or Missions tab, the feed is what it shows',shell.social&&shell.mode==='posts'&&!shell.tabs&&shell.feed&&shell.posts>0&&!shell.planner,shell);
    check(scope,'the globe, and the expanded globe, are told to leave missions out',/[?&]missions=0(&|$)/.test(shell.frame)&&/[?&]missions=0(&|$)/.test(shell.expand),shell);
    await globe.waitForFunction(()=>typeof window.__huMissionPins==='function'&&document.documentElement.classList.contains('globe-no-missions'),null,{timeout:25000}).catch(()=>{});
    await page.waitForTimeout(800);
    check(scope,'the Earth carries no mission pins',await globe.evaluate(()=>typeof window.__huMissionPins==='function'&&window.__huMissionPins()===0&&document.documentElement.classList.contains('globe-no-missions')));
    /* the World as it ships has the same World button where the controls menu was, and nothing on the page covers it */
    const worldBtn=await globe.evaluate(()=>{const w=document.getElementById('ctlWorld'),r=w&&w.getBoundingClientRect();return{inCorner:!!(w&&w.closest('.globe-editorial-world')),menu:!!document.querySelector('.globe-editorial-tools'),w:r&&Math.round(r.width),cx:r&&r.left+r.width/2,cy:r&&r.top+r.height/2,label:w&&w.getAttribute('aria-label')}});
    const worldAt=await page.evaluate(({cx,cy})=>{const f=document.getElementById('mnWorldFrame').getBoundingClientRect(),t=document.elementFromPoint(f.left+cx,f.top+cy);return t&&t.id},worldBtn);
    check(scope,'World, back to the whole Earth, is the button where the controls menu was, and nothing covers it',worldBtn.inCorner&&!worldBtn.menu&&worldBtn.w===44&&/whole world/i.test(worldBtn.label)&&worldAt==='mnWorldFrame',{worldBtn,worldAt});
    const missionBits = await page.evaluate(()=>[...document.querySelectorAll('[data-take-mission],.mn__actcard:not(.mn__actcard--collab),#mnFeedMissions,#mnClipDoor,.hu-mission-preview,[data-mn-view="missions"],#mnProfileRecord,.mn-swipe__card')].filter(el=>el.getClientRects().length>0).map(el=>el.id||el.className));
    check(scope,'no mission card, list or rail in the feed, and no door into Missions',missionBits.length===0,missionBits);
    const promoted = await page.evaluate(()=>{const t=document.body.innerText;return {rail:!!document.getElementById('mnRail'),words:/WAYS TO MOVE|Campaigns & missions|See campaigns/i.test(t)};});
    check(scope,'Ways to move is gone: no campaigns or missions promoted on the feed',!promoted.rail&&!promoted.words,promoted);
    /* swiping the feed sideways used to change tabs; there is nothing to change to */
    await page.evaluate(()=>{const f=document.getElementById('mnWorldFeed');const fire=(type,x)=>f.dispatchEvent(new TouchEvent(type,{bubbles:true,touches:type==='touchend'?[]:[new Touch({identifier:1,target:f,clientX:x,clientY:300})],changedTouches:[new Touch({identifier:1,target:f,clientX:x,clientY:300})]}));try{fire('touchstart',300);fire('touchend',60);}catch(_){}});
    check(scope,'a sideways swipe stays on the feed',await page.evaluate(()=>document.documentElement.dataset.worldMode)==='posts');
    if (member) {
      /* a search finds people and groups, never missions */
      /* on a phone the field opens from the search button */
      if (await page.isVisible('#huSearchToggle')) await page.click('#huSearchToggle');
      await page.fill('#mnSearchInput','Mill River');
      await page.waitForSelector('#mnSuggest:not([hidden])',{timeout:5000}).catch(()=>{});
      check(scope,'search lists no missions',await page.evaluate(()=>![...document.querySelectorAll('#mnSuggest [data-suggest="mission"],#mnSuggest [data-suggest="globe"]')].some(b=>b.getClientRects().length)));
      await page.fill('#mnSearchInput','');await page.keyboard.press('Escape');
      if (await page.getAttribute('#huSearchToggle','aria-expanded')==='true') await page.click('#huSearchToggle');
      /* a link into Missions lands on the feed */
      await page.evaluate(()=>window.MCC_MNET.setView('missions'));
      check(scope,'asking for Missions shows the feed',await page.evaluate(()=>!document.getElementById('mnFeedView').hidden&&document.getElementById('mnMissionsView').hidden));
      /* NOTIFICATIONS DROP DOWN FROM THE BELL */
      const before = await page.evaluate(()=>({feed:!document.getElementById('mnFeedView').hidden,scroll:document.getElementById('mnWorldFeed').scrollTop}));
      await page.click('#mnBell');
      await page.waitForSelector('#mnAlerts:not([hidden])',{timeout:5000}).catch(()=>{});
      await page.waitForFunction(()=>/Fixture Ana liked your post/.test(document.getElementById('mnNotifications').textContent),null,{timeout:10000}).catch(()=>{});
      const pop = await page.evaluate(()=>{const a=document.getElementById('mnAlerts').getBoundingClientRect(),b=document.getElementById('mnBell').getBoundingClientRect(),bar=document.querySelector('.appbar')?.getBoundingClientRect();
        return {open:!document.getElementById('mnAlerts').hidden,expanded:document.getElementById('mnBell').getAttribute('aria-expanded'),feed:!document.getElementById('mnFeedView').hidden,
          left:Math.round(a.left),right:Math.round(a.right),top:Math.round(a.top),bottom:Math.round(a.bottom),bellBottom:Math.round(b.bottom),iw:innerWidth,barTop:bar?Math.round(bar.top):null,
          text:/Fixture Ana liked your post/.test(document.getElementById('mnNotifications').textContent),sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth};});
      check(scope,'the bell drops the notifications down over the page, which stays the feed',pop.open&&pop.expanded==='true'&&pop.feed&&pop.text&&before.feed,pop);
      check(scope,'the drop down sits under the bell, inside the screen and above the bottom bar',pop.top>=pop.bellBottom-2&&pop.left>=16&&pop.right<=pop.iw-16&&(pop.barTop===null||pop.bottom<=pop.barTop)&&pop.sw===pop.cw,pop);
      await page.screenshot({path:join(OUT,scope+'-alerts.png')});
      await page.keyboard.press('Escape');
      check(scope,'Escape closes it, and the feed is where it was',await page.evaluate(b=>document.getElementById('mnAlerts').hidden&&document.getElementById('mnBell').getAttribute('aria-expanded')==='false'&&!document.getElementById('mnFeedView').hidden&&document.getElementById('mnWorldFeed').scrollTop===b.scroll,before));
      await page.click('#mnBell');
      await page.waitForSelector('#mnAlerts:not([hidden])',{timeout:5000}).catch(()=>{});
      await page.locator('.wt-headline').dispatchEvent('click');
      check(scope,'a tap outside closes it',await page.isHidden('#mnAlerts'));
      /* a tap on the globe happens inside its frame */
      await page.click('#mnBell'); await page.waitForSelector('#mnAlerts:not([hidden])',{timeout:5000}).catch(()=>{});
      await page.evaluate(()=>document.getElementById('mnWorldFrame').focus());
      await page.waitForFunction(()=>document.getElementById('mnAlerts').hidden,null,{timeout:3000}).catch(()=>{});
      check(scope,'a tap on the globe closes it too',await page.isHidden('#mnAlerts'));
      await page.click('#mnBell'); await page.waitForSelector('#mnAlerts:not([hidden])',{timeout:5000}).catch(()=>{});
      await page.click('#mnBell');
      check(scope,'the bell closes it again',await page.isHidden('#mnAlerts'));
    }
    check(scope,'no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
    await page.screenshot({path:join(OUT,scope+'.png')});
    check(scope,'no JavaScript errors',errors.length===0,errors);
  } finally { await ctx.close(); }
}

/* ALL THREE FOR THE HOUSE OWNER (owner, 2026-10-20: "keep the social feed on and then develop those other projects in the
   back end. Probably keep all three on admin"). The page as it ships; the server says this member is the house owner. */
if (runs('editorial')) for (const device of DEVICES.filter(d=>(!process.env.EDITORIAL_DEVICE&&d.name==='iphone-portrait')||d.name===process.env.EDITORIAL_DEVICE)) {
  const scope = `editorial-owner-${device.name}`;
  const {ctx,page,world,errors} = await open(device,{member:true,social:true,owner:true});
  try {
    /* the first time on this browser, the owner's answer opens the World again, once, with all three */
    await page.waitForFunction(()=>!document.documentElement.classList.contains('hu-social-only')&&document.documentElement.hasAttribute('data-world-owner'),null,{timeout:20000}).catch(()=>{});
    await page.waitForSelector('.wt-world-modes button',{state:'visible',timeout:15000}).catch(()=>{});
    const shell=await page.evaluate(()=>({modes:[...document.querySelectorAll('.wt-world-modes button')].filter(b=>b.getClientRects().length).map(b=>b.dataset.worldMode),
      mode:document.documentElement.dataset.worldMode,memo:JSON.parse(localStorage.getItem('mcc_world_owner')||'null'),reloaded:performance.getEntriesByType('navigation')[0].type,
      expand:document.querySelector('.mn__world-expand').getAttribute('href')}));
    check(scope,'the owner\'s World has Travel, Missions and Feed, and opens on the Feed',JSON.stringify(shell.modes)===JSON.stringify(['travel','missions','posts'])&&shell.mode==='posts',shell);
    check(scope,'the server\'s yes is remembered for this account; the World opened again once to show it',!!shell.memo&&/^aaaaaaaa/.test(shell.memo.sub)&&shell.reloaded==='reload',shell);
    check(scope,'the expanded globe shows the missions too',!/missions=0/.test(shell.expand),shell.expand);
    const globe=page.frame({url:/action-globe\.html/});
    await globe.waitForFunction(()=>typeof window.__huMissionPins==='function'&&window.__huMissionPins()>0,null,{timeout:25000}).catch(()=>{});
    check(scope,'the Earth carries the mission pins again for the owner',await globe.evaluate(()=>window.__huMissionPins()>0&&!document.documentElement.classList.contains('globe-no-missions')));
    await page.click('.wt-world-modes [data-world-mode=missions]');
    await page.waitForSelector('.mn-swipe__card',{timeout:15000}).catch(()=>{});
    check(scope,'Missions opens for the owner',await page.evaluate(()=>document.documentElement.dataset.worldMode==='missions'&&!!document.querySelector('.mn-swipe__card')));
    await page.click('.wt-world-modes [data-world-mode=travel]');
    check(scope,'Travel opens for the owner',await page.evaluate(()=>document.documentElement.dataset.worldMode==='travel'));
    /* the next World opens with all three straight away: no second opening */
    await page.goto(BASE+'/mnet.html',{waitUntil:'domcontentloaded'});
    const early=await page.evaluate(()=>({social:document.documentElement.classList.contains('hu-social-only'),type:performance.getEntriesByType('navigation')[0].type}));
    await page.waitForTimeout(2500);
    const after=await page.evaluate(()=>performance.getEntriesByType('navigation')[0].type);
    check(scope,'the next visit opens with all three from the first paint, without opening again',!early.social&&early.type==='navigate'&&after==='navigate',{early,after});
    /* signed out, the World is the social feed again */
    await page.evaluate(()=>localStorage.removeItem('mccdb_session'));
    await page.goto(BASE+'/mnet.html',{waitUntil:'domcontentloaded'});
    check(scope,'signed out, the World is the social feed and the remembered answer is gone',await page.evaluate(()=>document.documentElement.classList.contains('hu-social-only')&&!localStorage.getItem('mcc_world_owner')));
    /* this scope opens the World three times; a fetch the globe had out when it did (its borders) is cut off, not broken */
    const real=errors.filter(e=>!/Failed to fetch/.test(e));
    check(scope,'no JavaScript errors',real.length===0,real);
  } finally { await ctx.close(); }
}
/* and a member who is not the owner keeps the social feed, with nothing remembered */
if (runs('editorial')) {
  const {ctx,page,errors} = await open(DEVICES.find(d=>d.name==='iphone-portrait'),{member:true,social:true});
  try {
    await page.waitForSelector('#mnFeed [data-post-id]',{timeout:15000}).catch(()=>{});
    await page.waitForTimeout(2500);
    check('editorial-not-owner','a member the server does not call the owner keeps the social feed, nothing remembered, no second opening',await page.evaluate(()=>document.documentElement.classList.contains('hu-social-only')&&!localStorage.getItem('mcc_world_owner')&&performance.getEntriesByType('navigation')[0].type==='navigate'));
    check('editorial-not-owner','no JavaScript errors',errors.length===0,errors);
  } finally { await ctx.close(); }
}

/* The 2026-10-16 approved reference, including its explicit real-navigation exception.
   E2E_ONLY=editorial isolates this suite for CI; actual Cesium is never stubbed. */
if (runs('editorial')) for (const device of DEVICES.filter(d=>!process.env.EDITORIAL_DEVICE || d.name===process.env.EDITORIAL_DEVICE)) for (const member of [false, true]) {
  const scope = `editorial-${device.name}-${member ? 'member' : 'guest'}`;
  const {ctx,page,world,errors} = await open(device,{member});
  try {
    const globe = page.frame({url:/action-globe\.html/});
    check(scope,'the sign-in form never flashes on the way into the World',await page.evaluate(()=>window.__gateFlash)===0,await page.evaluate(()=>window.__gateFlash));
    /* NO SCREEN FLASHES (owner, 2026-10-20), counted on every frame of the first eight seconds */
    const flashes = await page.evaluate(()=>({live:window.__liveFlash,blank:window.__blankWorld,selfImg:window.__barSelfImg}));
    check(scope,'no other room shows on the way into the World: never the Live room, never an empty World screen',flashes.live===0&&flashes.blank===0,flashes);
    check(scope,'the bar never draws this page itself as a broken image',flashes.selfImg===0,flashes);
    check(scope,'the globe frame never shows its standalone screen (the deck) inside the World',await globe.evaluate(()=>window.__deckFlash)===0,await globe.evaluate(()=>window.__deckFlash));
    if (member) {
      /* a member without a photo wears the initial of their name in the middle tab, and it is actually drawn */
      await page.waitForSelector('.appbar [data-appnav="home"] .appbar__m--initial',{timeout:10000}).catch(()=>{});
      const coin = await page.evaluate(()=>{const c=document.querySelector('.appbar [data-appnav="home"] .appbar__m--initial'),r=c&&c.getBoundingClientRect();return {coin:!!c,text:c?c.textContent:'',w:r?Math.round(r.width):0,img:!!document.querySelector('.appbar [data-appnav="home"] img.appbar__m--creator')};});
      check(scope,'a member without a photo gets the initial of their name in the middle tab, drawn at full size, never an image',coin.coin&&coin.text==='F'&&coin.w>=20&&!coin.img,coin);
    }
    check(scope,'actual Cesium uses natural Earth colors, soft clouds and no starfield', await globe.evaluate(() => { const s=window.__huGlobeStyle?.();return s?.editorial && s.saturation===1.1 && s.cloudAlpha===.65 && s.atmosphereSaturation===.1 && !s.stars; }));
    await page.click('.wt-world-modes [data-world-mode=missions]');
    await page.waitForSelector('.mn-swipe__card[data-mission="'+M1+'"]');
    /* THE WORLD'S GLOBE (owner, 2026-10-20: "Replace the filter button with the button that zooms you all the way back out"):
       World sits where the controls menu was, nothing on the page covers it, and one tap takes the camera back to the whole Earth */
    const corner=await globe.evaluate(()=>{const w=document.getElementById('ctlWorld'),r=w&&w.getBoundingClientRect();return{inCorner:!!(w&&w.closest('.globe-editorial-world')),menu:!!document.querySelector('.globe-editorial-tools'),visible:!!(w&&w.getClientRects().length),w:r&&Math.round(r.width),h:r&&Math.round(r.height),cx:r&&r.left+r.width/2,cy:r&&r.top+r.height/2,label:w&&w.getAttribute('aria-label'),right:r&&Math.round(innerWidth-r.right),bottom:r&&Math.round(innerHeight-r.bottom)}});
    const at=await page.evaluate(({cx,cy})=>{const f=document.getElementById('mnWorldFrame').getBoundingClientRect(),x=f.left+cx,y=f.top+cy,top=document.elementFromPoint(x,y);return{x,y,top:top&&(top.id||top.className)}},corner);
    check(scope,'the World\'s globe: World, back to the whole Earth, is where the controls menu was, the same 44px round button, and nothing on the page covers it',corner.inCorner&&!corner.menu&&corner.visible&&corner.w===44&&corner.h===44&&corner.right<=16&&/whole world/i.test(corner.label)&&at.top==='mnWorldFrame',{corner,at});
    /* a camera flight is time-based and the software renderer is slow: settled is the same height for two seconds running */
    const settled=async()=>{let last=null,same=0;for(let n=0;n<60;n++){await page.waitForTimeout(500);const h=Math.round(await globe.evaluate(()=>window.__huIon().height));if(last!==null&&Math.abs(h-last)<50){if(++same>=4)return h}else same=0;last=h}return last};
    await page.mouse.click(at.x,at.y);const whole=await settled();
    await globe.evaluate(()=>window.__huCountriesCam&&window.__huCountriesCam.view(-73,41,2e6));
    const down=await globe.evaluate(()=>window.__huIon().height);
    const again=await page.evaluate(({x,y})=>{const t=document.elementFromPoint(x,y);return t&&(t.id||t.className)},at);
    const inFrame=await globe.evaluate(({cx,cy})=>{const t=document.elementFromPoint(cx,cy),b=t&&t.closest('button');return b?b.id:t&&t.tagName},corner);
    await page.screenshot({path:join(OUT,scope+'-world-button.png')});
    /* a loaded software renderer can go seconds between frames: wait for the flight to arrive, then for it to settle */
    await page.mouse.click(at.x,at.y);
    const back=await globe.waitForFunction(w=>window.__huIon().height>w*.98,whole,{timeout:45000}).then(settled,()=>globe.evaluate(()=>window.__huIon().height));
    check(scope,'one tap on World flies all the way back out to the whole Earth',whole>8e6&&down<2.5e6&&Math.abs(back-whole)<whole*0.02,{whole,down,back,again,inFrame});
    /* MISSIONS IS ONE SCREEN (owner, 2026-10-20): nothing scrolls, Pass and Accept clear the bar, a card takes the whole touch */
    const fit=await page.evaluate(()=>{const f=document.getElementById('mnWorldFeed'),a=document.querySelector('.mn-swipe__actions').getBoundingClientRect(),b=document.querySelector('.appbar').getBoundingClientRect(),c=document.querySelector('.mn-swipe__card');
      const overlap=a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;return{scroll:f.scrollHeight-f.clientHeight,bottom:Math.round(a.bottom),inner:innerHeight,overlap,touch:getComputedStyle(c).touchAction,card:Math.round(c.getBoundingClientRect().height)};});
    if(fit.inner>=560)check(scope,'Missions is one screen: nothing scrolls, Pass and Accept stay on screen clear of the bar, and a swipe is never a scroll',fit.scroll<=1&&fit.bottom<=fit.inner&&!fit.overlap&&fit.touch==='none'&&fit.card>=150,fit);
    /* a phone on its side is too short for that: the card keeps its full size and the sheet scrolls to Pass and Accept */
    else check(scope,'on a short screen the card keeps its full size, a swipe is never a scroll, and the sheet reaches Pass and Accept',fit.card>=220&&fit.touch==='none'
      &&await page.evaluate(()=>{const f=document.getElementById('mnWorldFeed');f.scrollTop=f.scrollHeight;const a=document.querySelector('.mn-swipe__actions').getBoundingClientRect(),b=document.querySelector('.appbar').getBoundingClientRect(),r=a.bottom<=innerHeight&&!(a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top);f.scrollTop=0;return r;}),fit);
    await page.screenshot({path:join(OUT,scope+'-missions.png')});
    if(!member){
      const dayM=await page.evaluate(()=>{const h=document.documentElement,was=h.getAttribute('data-daylight');h.setAttribute('data-daylight','day');const m=document.querySelector('.appbar__tab[data-appnav="home"] .appbar__m'),c=m?getComputedStyle(m).content:'';if(was===null)h.removeAttribute('data-daylight');else h.setAttribute('data-daylight',was);return c;});
      check(scope,'on the white daytime bar the M is the owner\'s supplied dark M',/m-mark-dark\.png/.test(dayM),dayM);
    }
    /* OVER THE GLOBE THE TOP STAYS TRANSPARENT (owner, 2026-10-20): by day as by night the header is a fade over the Earth,
       never a solid band, and its words stay white; every World mode */
    for(const mode of ['missions','travel','posts']){
      await page.click('.wt-world-modes [data-world-mode='+mode+']');
      const top=await page.evaluate(async()=>{const h=document.documentElement,was=h.getAttribute('data-daylight'),t=document.querySelector('.mn__top');
        const read=()=>{const c=getComputedStyle(t);return {color:c.backgroundColor,image:c.backgroundImage,brand:getComputedStyle(t.querySelector('.mn__brand small')||t).color};};
        h.setAttribute('data-daylight','day');await new Promise(r=>requestAnimationFrame(r));const day=read();
        h.setAttribute('data-daylight','night');await new Promise(r=>requestAnimationFrame(r));const night=read();
        if(was===null)h.removeAttribute('data-daylight');else h.setAttribute('data-daylight',was);return {day,night};});
      check(scope,'by day the top over the globe is the same transparent fade as by night ('+mode+')',
        top.day.color==='rgba(0, 0, 0, 0)'&&/linear-gradient/.test(top.day.image)&&top.day.image===top.night.image&&top.day.brand==='rgb(255, 255, 255)',top);
    }
    await page.click('.wt-world-modes [data-world-mode=missions]');
    check(scope,'published open missions populate the swipe deck and exclude clips',await page.locator('.mn-swipe__card').count()===1 && await page.textContent('.mn-swipe__count')===OPEN_MISSIONS.filter(m=>m.status==='open'&&m.kind!=='clip').length+' open missions');
    await page.click('.wt-world-modes [data-world-mode=posts]');
    const dims=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,iw:innerWidth,body:document.body.className,bar:document.querySelector('.appbar')?.getBoundingClientRect().toJSON(),overflow:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(0,15).map(e=>[e.tagName,e.id,e.className,e.getBoundingClientRect().right])}));
    check(scope,'no horizontal page overflow', dims.sw===dims.cw,dims);
    check(scope,'phone stack / iPad landscape split', await page.evaluate(()=>{
      const g=document.getElementById('mnWorld').getBoundingClientRect(),f=document.getElementById('mnWorldFeed').getBoundingClientRect();
      return (innerWidth>=1000 || (innerWidth>=600 && innerWidth>innerHeight)) ? f.left>=g.right-1 : Math.abs(f.top-g.bottom)<=8;
    }));
    const nav=await page.$$eval('.appbar [data-appnav]',els=>els.map(e=>e.dataset.appnav));
    check(scope,'canonical Music / M / World destinations are preserved',JSON.stringify(nav)===JSON.stringify(['music','home','world']),nav);
    check(scope,'globe and feed have no old raised-card decoration',await page.locator('#mnWorld').evaluate(e=>getComputedStyle(e).boxShadow==='none'));
    /* the World's song is random (owner, 2026-10-20) and a song with timed lyrics takes the headline while it plays */
    check(scope,'approved travel headline is visible above the globe, or the playing song\'s lyric in its place',await page.locator('.wt-headline').isVisible()
      && (await page.textContent('.wt-headline')==='The world is your feed.' || /\bis-lyric\b/.test(await page.getAttribute('.wt-headline','class')||'')));
    check(scope,'feed scrolls while globe and page remain stationary',await page.evaluate(()=>{
      const feed=document.getElementById('mnWorldFeed'),globe=document.getElementById('mnWorld'),before=globe.getBoundingClientRect().toJSON(),pageY=scrollY;
      feed.scrollTop=120;
      const after=globe.getBoundingClientRect();
      const ok=feed.scrollTop>0 && after.top===before.top && after.bottom===before.bottom && scrollY===pageY && after.top>=0 && after.bottom<=innerHeight && feed.getBoundingClientRect().bottom<=innerHeight+1;
      feed.scrollTop=0;return ok;
    }));
    if(member) check(scope,'Live remains compact',await page.locator('#mnWorldLive').evaluate(e=>{const r=e.getBoundingClientRect();return r.width<=100 && getComputedStyle(e).backgroundImage==='none';}));
    await page.screenshot({path:join(OUT,scope+'.png')});
    check(scope,'redundant globe region filter is removed from the visible canvas',await page.locator('#huWorldFilters').isHidden());
    check(scope,'mission status switch is available without category clutter',
      await page.locator('.mn-swipe__filters [data-status="open"]').count()===1&&await page.locator('.mn-swipe__filters [data-status="completed"]').count()===1);
    if(device.viewport.width<600)await page.click('#huSearchToggle');
    await page.fill('#mnSearchInput','Mill');
    await page.waitForSelector('#mnSuggestRows [data-suggest="globe"]');
    check(scope,'search still finds a published mission',/Clean up the Mill River/.test(await page.textContent('#mnSuggestRows')));
    await page.keyboard.press('Escape');
    // A visitor may browse another country before reading a worldwide mission.
    // Use the real country picker; a stale country filter must not swallow the choice.
    // In phone landscape, the mode pill crosses the canvas center. Keep the
    // same altitude and frame France above it; do not tap through parent UI.
    const cameraLatitude=device.name==='iphone-landscape'?30:47;
    await globe.waitForFunction(()=>window.__huCountries?.().ready);
    await globe.evaluate(lat=>window.__huCountriesCam.view(2,lat,15000000),cameraLatitude);
    await globe.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await globe.waitForFunction(()=>window.__huCountries?.().alpha.FR>=.15);
    const canvas=globe.locator('#globe canvas');
    const tap=await globe.evaluate(lat=>{
      const C=window.Cesium,canvas=document.querySelector('#globe canvas'),r=canvas.getBoundingClientRect(),frame=window.frameElement,f=frame.getBoundingClientRect();
      let x=r.width/2,y=r.height/2;
      if(lat!==47){
        // Cesium setView defaults to north-up, looking down, with a 60-degree
        // field of view on the longer axis. Project an interior France point
        // in that camera's east/north/up frame, then use the real pointer.
        const camera=C.Cartesian3.fromDegrees(2,lat,15000000),france=C.Cartesian3.fromDegrees(2,47);
        const inverse=C.Matrix4.inverseTransformation(C.Transforms.eastNorthUpToFixedFrame(camera),new C.Matrix4());
        const point=C.Matrix4.multiplyByPoint(inverse,france,new C.Cartesian3()),focal=Math.max(r.width,r.height)/(2*Math.tan(Math.PI/6));
        x+=point.x/-point.z*focal;y-=point.y/-point.z*focal;
      }
      const cx=r.left+x,cy=r.top+y;
      return {x,y,exposed:document.elementFromPoint(cx,cy)===canvas && parent.document.elementFromPoint(f.left+cx,f.top+cy)===frame};
    },cameraLatitude);
    check(scope,'country tap reaches the real canvas through both documents',tap.exposed,tap);
    await canvas.click({position:{x:tap.x,y:tap.y}});
    await globe.waitForFunction(()=>window.__huCountries?.().selected==='FR');
    check(scope,'country selection updates the region label',await page.textContent('#huRegionLabel')==='France');
    check(scope,'tapping a country narrows the one feed to it (Local) with no extra press',await page.getAttribute('[data-feed-scope=local]','aria-pressed')==='true');
    await page.click('.wt-world-modes [data-world-mode=missions]');
    await page.locator('.mn-swipe__card[data-mission="'+M1+'"] .mn-swipe__details').click();
    await page.waitForSelector('#mnMissionDialog[open]');
    check(scope,'Read full mission opens the canonical mission instructions',await page.textContent('#mnMissionTitle')===MISSIONS[0].title && (await page.textContent('#mnMissionDetail')).includes(MISSIONS[0].description));
    await page.click('#mnMissionClose');
    await page.waitForFunction(()=>!document.getElementById('mnWorldFocus').hidden && document.getElementById('huRegionLabel').textContent==='All regions',null,{timeout:5000}).catch(()=>{});
    check(scope,'a mission card outside the selected country opens and clears the country filter',await page.isVisible('#mnWorldFocus') && await page.textContent('#huRegionLabel')==='All regions' && await globe.evaluate(()=>window.__huCountries().selected===null));
    check(scope,'letting the tapped country go returns the feed to Global',await page.getAttribute('[data-feed-scope=global]','aria-pressed')==='true');
    check(scope,'mission card selects the real mission',/Clean up the Mill River/.test(await page.textContent('#mnWorldFocusTitle')));
    await page.click('#mnWorldFocusClear');
    await page.click('.wt-world-modes [data-world-mode=posts]');
    check(scope,'one Feed mode, no duplicate News deck or For you/Community tabs',
      (await page.locator('#worldNewsDeck,.hu-feed-tabs,.hu-section-label').count())===0 &&
      (await page.locator('.wt-world-modes [data-world-mode=posts]').textContent()).trim()==='News feed');
    check(scope,'the one feed interleaves community posts and publisher-attributed headlines',
      await page.locator('#mnFeed [data-post-id]').count()>0 && await page.locator('#mnFeed [data-news-id]').count()>0);
    await page.waitForSelector('#mnFeed [data-news-id] [data-discussion-toggle]',{timeout:15000});
    check(scope,'member posts and news use the same inline discussion control',
      await page.locator('#mnFeed [data-post-id] [data-discussion-toggle]').count()>0 &&
      await page.locator('#mnFeed [data-news-id] [data-discussion-toggle]').count()>0);
    if (member) {
      const firstPost=page.locator('#mnFeed [data-post-id]').first();
      await firstPost.locator('[data-discussion-toggle]').click();
      await firstPost.locator('.mn__comment-form input').fill('Ready to work on this together.');
      await firstPost.locator('.mn__comment-form button').click();
      await page.waitForFunction(()=>document.querySelector('#mnFeed [data-post-id] .mn__comment')?.textContent?.includes('Ready to work on this together.'),{timeout:5000}).catch(()=>{});
      check(scope,'member can post a comment on an existing member post',
        await firstPost.locator('.mn__comment').count()>0 &&
        (await firstPost.locator('.mn__comments-list').textContent()).includes('Ready to work on this together.'));
      const firstNews=page.locator('#mnFeed [data-news-id]').first();
      await firstNews.locator('[data-discussion-toggle]').click();
      await firstNews.locator('.mn__comment-form input').fill('Here is a community perspective on this headline.');
      await firstNews.locator('.mn__comment-form button').click();
      await page.waitForFunction(()=>document.querySelector('#mnFeed [data-news-id] .mn__comment')?.textContent?.includes('Here is a community perspective on this headline.'),{timeout:5000}).catch(()=>{});
      check(scope,'member can comment on source-backed news inside the same feed',
        await firstNews.locator('.mn__comment').count()>0 &&
        (await firstNews.locator('.mn__comments-list').textContent()).includes('Here is a community perspective on this headline.'));
    }
    await page.locator('#mnFeed [data-post-id]').first().scrollIntoViewIfNeeded();
    await page.screenshot({path:join(OUT,scope+'-feed.png')});
    if(member){
      await page.click('.wt-world-modes [data-world-mode=missions]');
      await page.click('#mnWorldEup');
      await page.waitForSelector('#mnMissionsView:not([hidden])');
      check(scope,'leaving World restores normal page scrolling',await page.evaluate(()=>!document.documentElement.classList.contains('mn-world-on') && getComputedStyle(document.documentElement).overflowY!=='hidden'));
      await page.click('#mnToWorld');
      await page.waitForFunction(()=>document.documentElement.classList.contains('mn-world-on'));
      await page.click('.wt-world-modes [data-world-mode=posts]');
      check(scope,'returning to World restores the scrolling feed',await page.locator('#mnWorldFeed').evaluate(e=>getComputedStyle(e).overflowY==='auto' && e.scrollHeight>e.clientHeight));
      /* alerts (owner, 2026-10-20): a comment alert opens its post with the discussion; the device-alerts row stays out
         of sight while the server has push off */
      await page.evaluate(()=>window.MCC_MNET.setView('notifications'));
      await page.waitForFunction(()=>!!document.querySelector('#mnNotifications a.mn__notification-action'),null,{timeout:10000}).catch(()=>{});
      check(scope,'a comment alert links to its post with the discussion open',await page.getAttribute('#mnNotifications a.mn__notification-action','href')===`mnet.html?view=feed&post=${CONTENT}&comments=1`);
      check(scope,'a news reply alert links to the story with its replies open',(await page.locator('#mnNotifications a.mn__notification-action').nth(1).getAttribute('href'))===`mnet.html?view=feed&news=${M1}&comments=1`);
      /* the page asks the server only after looking up this browser's own subscription */
      for(let i=0;i<50&&!req(world,'GET',/^\/v1\/mnet\/push$/).length;i++)await page.waitForTimeout(100);
      check(scope,'the device-alerts row stays hidden while the server has push off',req(world,'GET',/^\/v1\/mnet\/push$/).length>=1&&await page.isHidden('#mnPush'));
      await page.evaluate(()=>window.MCC_MNET.setView('feed'));
    }
    check(scope,'no JavaScript errors',errors.length===0,errors);
  } finally {await ctx.close();}
}

/* ---------- member, every device: composition and navigation ---------- */
for (const device of DEVICES) {
  if (!runs(device.name)) continue;
  const { ctx, page, world, errors } = await open(device, { member: true });
  const s = await split(page);
  check(device.name, 'opened on the World screen from action-globe.html', /mnet\.html\?view=feed/.test(page.url()));
  check(device.name, 'the visitor selects a mission; no context card opens by itself', await page.isHidden('#mnWorldFocus'));
  check(device.name, 'the real shared bar is visible and the feed has clearance', !s.barHidden && s.feedPad >= s.vh - s.barTop + 8, s);
  check(device.name, 'portrait stacks the fixed globe and scrolling feed; landscape adds a column', await page.evaluate(() => {
    const g=document.getElementById('mnWorld').getBoundingClientRect(), f=document.getElementById('mnWorldFeed').getBoundingClientRect();
    return (innerWidth >= 1000 || (innerWidth >= 600 && innerWidth > innerHeight)) ? f.left >= g.right - 1 : f.top >= g.bottom - 1;
  }), s);
  check(device.name, 'no sideways overflow', s.scrollW === s.clientW, s);
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
  check(scope, 'the phone feed scrolls while the page stays fixed', feedScroll.feed > 0 && feedScroll.page === 0, feedScroll);
  await page.evaluate(() => { document.getElementById('mnWorldFeed').scrollTop = 0; });

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
  check(scope, 'Alerts: the bell shows the unread count', (await page.isVisible('#mnNotifBadge')) && (await page.textContent('#mnNotifBadge')).trim() === '3');
  await page.click('#mnBell');
  await page.waitForSelector('#mnAlerts:not([hidden])');
  /* the list and the read receipt are two round trips; wait for both rather than a fixed beat */
  await page.waitForFunction(() => /Fixture Ana liked your post/.test(document.getElementById('mnNotifications').textContent) && document.getElementById('mnNotifBadge').hidden, null, { timeout: 10000 }).catch(() => {});
  check(scope, 'Alerts: the bell opens them and clears the count', /Fixture Ana liked your post/.test(await page.textContent('#mnNotifications')) && await page.isHidden('#mnNotifBadge'));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#mnAlerts', { state: 'hidden' });
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
  /* the access map (owner, 2026-10-15): seven toggles on screen; a member has the data layers and Whip Equipped; CCTV waits on its three checks */
  const lockedIds = locks.filter((l) => l.locked).map((l) => l.id).sort();
  check(scope, 'a member sees every toggle; only CCTV locked', locks.length === 7 && JSON.stringify(lockedIds) === JSON.stringify(['ctlCctv']) && ['ctlFlights', 'ctlSats', 'ctlLaunch'].every((id) => locks.some((l) => l.id === id && !l.locked && l.disabled === 'false')), locks);
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
  /* one free layer (owner, 2026-10-15): every other toggle on screen, shaded */
  check(scope, 'a guest sees Flights open and every other layer locked', locks.length === 7 && !locks[0].locked && locks.slice(1).every((l) => l.locked), locks);
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
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: device.viewport, deviceScaleFactor: 2, isMobile: device.mobile, hasTouch: device.mobile });
  await ctx.addInitScript((m) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
    if (m && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); const exp = Math.floor(Date.now() / 1000) + 3600; localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).replace(/=+$/, '') + '.y', refresh_token: 'r', expires_at: exp })); }
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

/* ---------- WORLD NEWS IN THE FEED (owner, 2026-10-15: "GDELT news as the feed … sprinkled into that. At a ratio to like one …
   from them."). One member post to one news item, for a guest and a member, free and with no session. ---------- */
const feedSeq = (page) => page.$$eval('#mnFeed > article', (a) => a.map((x) => x.hasAttribute('data-news-id') ? 'n' : x.hasAttribute('data-post-id') ? 'p' : '?').join(''));
const newsState = (page) => page.evaluate(() => {
  const credit = document.getElementById('mnNewsCredit'), a = credit && credit.querySelector('a'), more = document.getElementById('mnMore');
  const cards = [...document.querySelectorAll('#mnFeed [data-news-id]')];
  return { posts: document.querySelectorAll('#mnFeed [data-post-id]').length, news: cards.length, credit: !!credit && !credit.hidden && credit.getBoundingClientRect().height > 0,
    creditText: credit ? credit.textContent.trim() : '', href: a && a.getAttribute('href'), target: a && a.target, rel: a && a.rel, more: !!more && !more.hidden,
    status: (document.getElementById('mnFeedStatus') || {}).textContent || '', sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    cardsFit: cards.every((c) => c.scrollWidth <= c.clientWidth + 1 && c.getBoundingClientRect().right <= innerWidth + 0.5),
    /* a short publisher name is shown whole; only a long one is cut, inside its card */
    domains: cards.slice(0, 2).map((c) => { const d = c.querySelector('.mn__news-domain'); return d ? d.scrollWidth <= d.clientWidth : null; }),
    links: cards.map((c) => { const b = c.querySelector('button.mn__news-title'); return b && { id: b.dataset.newsOpen, href: b.getAttribute('href'), type: b.type }; }),
    imgs: cards.reduce((n, c) => n + c.querySelectorAll('img,picture').length, 0) };
});
/* the state without the per-card links, for a readable log line */
const brief = ({ posts, news, credit, creditText, href, target, rel, more, status, sw, cw, cardsFit, domains }) => ({ posts, news, credit, creditText, href, target, rel, more, status, sw, cw, cardsFit, domains });
const urlOf = (world, id) => (world.news.find((n) => n.id === id) || {}).url;
/* scroll the feed (only the feed: the page stays put) so the credit and the first cards are in view */
const showCredit = () => { const f = document.getElementById('mnWorldFeed'), c = document.getElementById('mnNewsCredit'); f.scrollTop += c.getBoundingClientRect().top - f.getBoundingClientRect().top - 8; };

if (runs('news-guest')) {
  const { ctx, page, world, errors } = await open(DEVICES[0], { member: false, postPage: 5 });
  const scope = 'news-guest';
  await page.waitForSelector('#mnFeed [data-news-id]', { timeout: 15000 });
  let st = await newsState(page), seq = await feedSeq(page);
  check(scope, 'one member post to one news item, then the news carries on once the loaded posts run out', seq === 'pn'.repeat(5) + 'n'.repeat(15) && st.posts === 5 && st.news === 20, seq);
  const reads = req(world, 'GET', /^\/v1\/world\/news$/);
  check(scope, 'the mixed feed and geographic news read the Worker without a session', reads.some((r) => /[?&]limit=20$/.test(r.search)) && reads.length <= 2 && reads.every((r) => !r.auth && /[?&]limit=(?:20|50)$/.test(r.search)), reads);
  check(scope, 'the GDELT credit is one line over the feed, visible with the news, to the project in a new tab', st.credit && st.creditText === 'World news from The GDELT Project' && st.href === 'https://www.gdeltproject.org/' && st.target === '_blank' && /noopener/.test(st.rel) && /noreferrer/.test(st.rel), brief(st));
  const ids = await page.$$eval('#mnFeed [data-news-id]', (a) => a.map((x) => x.getAttribute('data-news-id')));
   check(scope, 'every headline stays in-app, without publisher photos or logos; comment icons are allowed', st.links.length === 20 && st.links.every((l, k) => l && l.id === ids[k] && l.href === null && l.type === 'button') && st.imgs === 0, st.links.slice(0, 2));
   const worldUrlBeforeNews = page.url();
   await page.locator('#mnFeed [data-news-id] .mn__news-title').first().click();
   const modal = page.locator('#worldNewsReader');
   check(scope, 'headline opens the in-app record and does not navigate to publisher', await modal.isVisible() && page.url() === worldUrlBeforeNews && (await modal.locator('h3').textContent()) === world.news[0].title);
   await modal.getByRole('button', { name: 'Close' }).click();
  const meta = await page.$eval('#mnFeed [data-news-id]', (c) => c.querySelector('.mn__news-meta').textContent);
  check(scope, 'a card reads publisher · time ago · the place it mentions', /^news0\.example\s*·\s*\d+[mh]\s*·\s*Nairobi, Nairobi Area, Kenya$/.test(meta.trim()), meta);
  check(scope, 'a story\'s chip says where it is from (Kenya), not "On the Earth"', (await page.textContent('#mnFeed [data-news-id] [data-news-place]')).trim() === 'Kenya');
  check(scope, 'a card without a place has no "On the Earth"', (await page.$$eval('#mnFeed [data-news-id]', (a) => a.map((c) => !!c.querySelector('[data-news-place]')))).every((has, k) => has === (k % 4 !== 2)));
  check(scope, 'nothing scrolls sideways at 390 with the news in; the long headline and publisher are cut inside their card, a short publisher is whole', st.sw === st.cw && st.cardsFit && st.domains[0] === true && st.domains[1] === false, { sw: st.sw, cw: st.cw, fit: st.cardsFit, domains: st.domains });
  /* the evidence: the feed with the news in it */
  await page.evaluate(showCredit);
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, 'news-feed-iphone.png') });
  /* Search opens contextually on phone; Travel intentionally hides the World search control. */
  await page.locator('.wt-world-modes [data-world-mode="posts"]').click();
  await page.locator('#huSearchToggle').click();
  await page.locator('#mnSearchInput').waitFor({state:'visible'});
  /* search reads the news too: its headlines and its publishers */
  await page.fill('#mnSearchInput', 'transit'); await page.waitForTimeout(500);
  const byTitle = await newsState(page);
  await page.fill('#mnSearchInput', 'news2.example'); await page.waitForTimeout(500);
  const byDomain = await newsState(page);
  await page.fill('#mnSearchInput', ''); await page.waitForTimeout(400);
  check(scope, 'search matches news headlines and publishers', byTitle.news === 19 && byTitle.posts === 0 && byDomain.news === world.news.slice(0, 20).filter((n) => n.domain === 'news2.example').length && byDomain.posts === 0, { byTitle: byTitle.news, byDomain: byDomain.news });
  const globe = page.frame({ url: /action-globe\.html/ });
  /* THE NEWS HEAT MAP (owner, 2026-10-21: "instead of pins on the map ... a heat map of how many articles or mentions it
     has ... so people aren't just needlessly searching for tiny pins"): no pin per story; the countries carry the counts */
  const pinsAndCards = async () => { await page.waitForTimeout(500); return { pins: (await globe.evaluate(() => window.__huWorldNewsPins())).pins, cards: await page.$$eval('#mnFeed [data-news-id] [data-news-place]', (a) => a.length) }; };
  const pinsAll = await pinsAndCards();
  check(scope, 'no pin per story: the Earth carries no news pins, however many stories the feed shows', pinsAll.pins === 0 && pinsAll.cards > 0, pinsAll);
  await globe.waitForFunction(() => window.__huCountries?.().heat?.countries === 16, null, { timeout: 15000 }).catch(() => {});
  const heat = await globe.evaluate(() => ({ heat: window.__huCountries().heat, legend: !document.getElementById('heatLegend').hidden, text: document.getElementById('heatLegend').textContent, bar: getComputedStyle(document.querySelector('.heat-legend__bar')).backgroundImage }));
  check(scope, 'the countries the stories mention are shaded by how many, with a legend that says what the colours mean', heat.heat && heat.heat.countries === 16 && heat.heat.total === 978 && heat.legend && /News mentions · last 24 h/.test(heat.text) && /Fewer/.test(heat.text) && /More/.test(heat.text) && /linear-gradient/.test(heat.bar), heat);
  /* a story's place on the Earth, from its card */
  await page.click('#mnFeed [data-news-id] [data-news-place]');
  await globe.waitForFunction(() => window.__huFocusPlace && window.__huFocusPlace(), null, { timeout: 5000 }).catch(() => {});
  /* The flight is an animation: wait for the camera to arrive (bounded), not
     for a fixed instant that lands mid-descent on a slow runner. The check
     below still requires the final altitude; only the sampling moment moves. */
  await globe.waitForFunction(() => Math.abs(window.__huIon().height - 900000) < 60000, null, { timeout: 12000 }).catch(() => {});
  const sent = await globe.evaluate(() => ({ place: window.__huFocusPlace(), height: window.__huIon().height }));
  const firstPlaced = await page.$eval('#mnFeed [data-news-id] [data-news-place]', (b) => b.closest('[data-news-id]').getAttribute('data-news-id'));
  check(scope, 'a tapped story\'s place gets the one pin on the Earth, that story\'s', (await globe.evaluate(() => window.__huFocusedNewsPin())) === firstPlaced && (await globe.evaluate(() => window.__huWorldNewsPins())).pins === 1 && sent.place && sent.place.id === firstPlaced, { marked: await globe.evaluate(() => window.__huFocusedNewsPin()), pins: await globe.evaluate(() => window.__huWorldNewsPins()), firstPlaced });
  check(scope, '"On the Earth" sends the story\'s place to the globe (hu:focus-place), which flies there', !!sent.place && sent.place.lat === -1.28 && sent.place.lon === 36.82 && sent.place.label === 'Nairobi, Nairobi Area, Kenya' && Math.abs(sent.height - 900000) < 60000 && /Nairobi, Nairobi Area, Kenya · mentioned in this story\./.test(await page.textContent('#mnWorldCaption')), sent);
  /* the frame checks what it is sent: strings, out-of-range and missing numbers move nothing */
  await page.evaluate(() => { const w = document.getElementById('mnWorldFrame').contentWindow; [{ type: 'hu:focus-place', lat: '10', lon: 10 }, { type: 'hu:focus-place', lat: 95, lon: 0 }, { type: 'hu:focus-place', lat: 0, lon: 200 }, { type: 'hu:focus-place', lat: NaN, lon: 0 }, { type: 'hu:focus-place' }].forEach((m) => w.postMessage(m, location.origin)); });
  await page.waitForTimeout(500);
  const kept = await globe.evaluate(() => window.__huFocusPlace());
  check(scope, 'the frame refuses a place that is not two finite numbers in range', kept && kept.lat === -1.28 && kept.lon === 36.82, kept);
  /* a mission picked on the Earth narrows the feed to its posts: the news steps aside, and comes back */
  await globe.evaluate((id) => window.parent.postMessage({ type: 'hu:mission-selected', mission: { mission_id: id, title: 'Clean up the Mill River', region_label: 'Connecticut', action_path: 'show_up' } }, location.origin), M1);
  await page.waitForSelector('#mnWorldFocus:not([hidden])');
  const narrowed = await newsState(page);
  const pinsNarrowed = await pinsAndCards();
  await page.click('#mnWorldFocusClear');
  await page.waitForTimeout(300);
  const back = await newsState(page);
  check(scope, 'a mission picked on the Earth hides the news and its credit; letting it go brings them back', narrowed.news === 0 && !narrowed.credit && back.news === 20 && back.credit, { narrowed: narrowed.news, back: back.news });
  const pinsBack = await pinsAndCards();
  check(scope, 'and the story\'s pin follows the feed: gone while the mission narrows it, back after', pinsNarrowed.pins === 0 && pinsBack.pins === 1 && pinsBack.cards === pinsAll.cards, { pinsNarrowed, pinsBack });
  /* Load more pages both streams, each from its own cursor, the news cursor passed back verbatim */
  check(scope, 'Load more shows while either stream has another page', st.more);
  await page.click('#mnMore');
  await page.waitForFunction(() => document.querySelectorAll('#mnFeed [data-news-id]').length === 30 && document.querySelectorAll('#mnFeed [data-post-id]').length === 8, null, { timeout: 10000 }).catch(() => {});
  st = await newsState(page); seq = await feedSeq(page);
  const pageTwo = { posts: req(world, 'GET', /^\/v1\/mnet\/public-feed$/).filter((r) => /[?&]before=/.test(r.search)), news: req(world, 'GET', /^\/v1\/world\/news$/).filter((r) => /[?&]before=/.test(r.search)) };
  check(scope, 'Load more reads the next page of both: posts from theirs, news from its opaque cursor, sent back verbatim', st.posts === 8 && st.news === 30 && pageTwo.posts.length === 1 && pageTwo.news.length === 1 && /[?&]before=cur%7C20$/.test(pageTwo.news[0].search) && !pageTwo.news[0].auth, { st: { posts: st.posts, news: st.news }, pageTwo });
  check(scope, 'after the next page the feed is still one for one, and Load more goes when both are done', seq === 'pn'.repeat(8) + 'n'.repeat(22) && !st.more, seq);
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

if (runs('news-member')) {
  const { ctx, page, world, errors } = await open(DEVICES[0], { member: true });
  const scope = 'news-member';
  await page.waitForSelector('#mnFeed [data-news-id]', { timeout: 15000 });
  const seq = await feedSeq(page), st = await newsState(page);
  check(scope, 'a member gets the same: one of their posts, one news item, then the news carries on', seq === 'pn'.repeat(9) + 'n'.repeat(11), seq);
  const reads = req(world, 'GET', /^\/v1\/world\/news$/), feed = req(world, 'GET', /^\/v1\/mnet\/feed$/);
  check(scope, 'the member\'s own feed carries the session; the news never does', feed.length > 0 && feed.every((r) => r.auth) && reads.length === 1 && !reads[0].auth, { feed: feed.length, reads });
  check(scope, 'the credit is there for a member too, and nothing scrolls sideways', st.credit && st.href === 'https://www.gdeltproject.org/' && st.sw === st.cw && st.cardsFit, brief(st));
  /* a news card is not a post: tapping it does not narrow anything, and its chip clears the latest mission off the strip */
  check(scope, 'the strip opens on the latest mission', await page.isVisible('#mnWorldFocus'));
  await page.click('#mnFeed [data-news-id] [data-news-place]');
  await page.waitForTimeout(400);
  check(scope, '"On the Earth" lets the latest mission go and says what the place is', (await page.isHidden('#mnWorldFocus')) && /mentioned in this story/.test(await page.textContent('#mnWorldCaption')) && !!(await page.frame({ url: /action-globe\.html/ }).evaluate(() => window.__huFocusPlace())));
  check(scope, 'no page errors', errors.length === 0, errors);
  /* the desktop: the same feed, given room */
  await page.setViewportSize(DEVICES[4].viewport);
  await page.waitForTimeout(1500);
  await page.evaluate(showCredit);
  await page.waitForTimeout(600);
  const wide = await newsState(page);
  check(scope, 'on a desktop the news cards hold their place in the feed and nothing scrolls sideways', wide.news === 20 && wide.sw === wide.cw && wide.cardsFit, { news: wide.news, sw: wide.sw, cw: wide.cw });
  await page.screenshot({ path: join(OUT, 'news-feed-desktop.png') });
  await ctx.close();
}

/* a news read that fails, or answers with nothing to show, leaves the posts exactly as they were */
for (const variant of [{ scope: 'news-fail-500', member: false, newsFail: 500 }, { scope: 'news-fail-abort', member: true, newsFail: 'abort' }, { scope: 'news-unavailable', member: false, newsFail: 'unavailable' }]) {
  if (!runs(variant.scope)) continue;
  const { ctx, page, world, errors } = await open(DEVICES[0], { member: variant.member, newsFail: variant.newsFail });
  const scope = variant.scope;
  await page.waitForTimeout(800);
  const st = await newsState(page);
  check(scope, 'the posts are all there, with no news cards, no credit and no error line', st.posts === (variant.member ? 9 : 8) && st.news === 0 && !st.credit && !st.status && !st.more, brief(st));
  check(scope, 'the news was asked for, once, with no session', req(world, 'GET', /^\/v1\/world\/news$/).length === 1 && !req(world, 'GET', /^\/v1\/world\/news$/)[0].auth);
  check(scope, 'nothing scrolls sideways at 390', st.sw === st.cw, { sw: st.sw, cw: st.cw });
  check(scope, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
await writeFile(join(OUT, 'world-screen-e2e.json'), JSON.stringify({ ran_at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots and report in ${OUT}`);
process.exit(failed.length ? 1 : 0);
