/* ANTI-SOCIAL — GET SOCIAL, IN A REAL BROWSER.
   ============================================================
   One mission, three levels, as a member on an iPhone, against a fake
   backend that answers the way the real RPCs do (the SQL itself is proven
   by scripts/test-antisocial-db.sh on a scratch Postgres). This run reads
   the page back: the dialog's 1 / 3 · 2 / 3 · 3 / 3 list, Level 1 and
   Level 2 submitted through submit_antisocial_level, the desk's verdict
   moving the next level open, Level 3 publishing together through
   publish_antisocial_collaboration with a connected partner, a project
   published with me confirmed with one tap, Connect on a member's profile,
   a connection request answered from the bell, the made-together card
   under a vouched post, and the record reading n / 3.

     node scripts/e2e/anti-social.e2e.mjs [outDir]
   ============================================================ */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out-anti-social');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  try { const body = await readFile(join(ROOT, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------- the fixture world ---------- */
const MISSION = 'a17050c1-a551-4c5c-80c1-5a1750c1a001';
const ME = { m_uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', mccluster_id: 'fixture.you', display_name: 'Fixture You' };
const ANA = { m_uid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mccluster_id: 'fixture.ana', display_name: 'Fixture Ana' };
const ASSIGNMENT = '77777777-7777-4777-8777-777777777777';
const POST = 'dddddddd-dddd-4ddd-8ddd-000000000099';
const jwt = () => 'x.' + btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: 'auth-you' })).replace(/=+$/, '') + '.y';
const world = {
  mission: { id: MISSION, campaign_id: null, title: 'Anti-Social — Get Social', description: '1. High Five. 2. Five High Fives. 3. Make Something Together.', domain: 'community', difficulty: 1, base_points: 150, proof_required: true, verification_mode: 'review', skills: ['community', 'collaboration', 'creativity'], capacity: null, status: 'open', starts_at: null, ends_at: null, kind: 'civic' },
  assignment: null,            // { id, status }
  levels: {},                  // level -> { level, status, review_note }
  connection: { status: 'none' },  // between me and Ana
  connections: [],             // my_connections rows
  published: [],               // action_collaboration_posts-like rows (post_id, initiator, partner, title, kind, link)
  withMe: [],                  // projects published with me (by Ana)
  notifications: [],
  calls: [],
};
const posts = [{ item_type: 'post', post_id: POST, occurred_at: new Date().toISOString(), actor: ANA, post: { id: POST, body: 'North Bank — made together by Fixture Ana and Fixture You.', visibility: 'public', created_at: new Date().toISOString(), author_m_uid: ANA.m_uid, media: [], metadata: { collaboration: { mission_id: MISSION, title: 'North Bank', kind: 'song', credits: [{ m_uid: ANA.m_uid, name: 'Fixture Ana', handle: 'fixture.ana' }, { m_uid: ME.m_uid, name: 'Fixture You', handle: 'fixture.you' }] } } } }];

async function routeBackends(ctx) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': BASE, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', async (route) => {
    const r = route.request(), u = new URL(r.url()), rpc = (u.pathname.match(/\/rest\/v1\/rpc\/([a-z_]+)$/) || [])[1];
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': BASE, 'access-control-allow-headers': 'authorization,apikey,content-type,prefer', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' } });
    if (u.pathname.includes('/auth/v1/user')) return json(route, { id: 'auth-you', email: 'you@example.org' });
    const body = r.method() === 'POST' ? (r.postDataJSON() || {}) : {};
    if (rpc) world.calls.push({ rpc, body });
    /* the mission system */
    if (u.pathname.endsWith('/rest/v1/action_missions')) return json(route, [world.mission]);
    if (rpc === 'action_mission_stats') return json(route, [{ mission_id: MISSION, joined: 4, in_progress: 2, submitted: 1, verified: 1, rejected: 0 }]);
    if (rpc === 'action_record') return json(route, { verified_actions: 0, points: 0, in_progress: world.assignment ? 1 : 0, missions: world.assignment ? [{ assignment_id: ASSIGNMENT, mission_id: MISSION, title: world.mission.title, domain: 'community', skills: [], status: world.assignment.status, joined_at: new Date().toISOString(), levels: Object.values(world.levels), level_count: 3 }] : [], skills: [], cohorts: [] });
    if (u.pathname.endsWith('/rest/v1/action_mission_assignments')) return json(route, world.assignment ? [world.assignment] : []);
    if (rpc === 'join_action_mission') { world.assignment = { id: ASSIGNMENT, status: 'in_progress' }; return json(route, { assignment_id: ASSIGNMENT, status: 'in_progress', mission_id: MISSION }); }
    if (u.pathname.endsWith('/rest/v1/action_antisocial_levels')) return json(route, Object.values(world.levels));
    if (rpc === 'submit_antisocial_level') {
      const lvl = Number(body.p_level);
      if (lvl > 1 && !(world.levels[lvl - 1] && world.levels[lvl - 1].status === 'verified')) return json(route, { message: 'finish the previous level first' }, 400);
      if (lvl < 3 && !body.p_proof_url && !body.p_media_asset_id) return json(route, { message: 'submit a consent-safe clip or a secure video link' }, 400);
      world.levels[lvl] = { level: lvl, status: 'pending', review_note: null, post_id: body.p_post_id || null, collaborator: body.p_collaborator_m_uid || null };
      if (lvl === 3) world.withMe = world.withMe.map((w) => ({ ...w, mine_status: 'pending' }));
      return json(route, { level: lvl, status: 'pending', assignment_id: ASSIGNMENT });
    }
    if (rpc === 'my_connections') return json(route, world.connections);
    if (rpc === 'antisocial_collaborations_for_me') return json(route, world.withMe);
    if (rpc === 'publish_antisocial_collaboration') {
      if (!(world.levels[1]?.status === 'verified' && world.levels[2]?.status === 'verified')) return json(route, { message: 'finish levels 1 and 2 first' }, 400);
      if (!world.connections.some((c) => c.m_uid === body.p_partner_m_uid)) return json(route, { message: 'connect with your collaborator on Action Network first' }, 400);
      world.published.push({ post_id: POST, partner: body.p_partner_m_uid, title: body.p_title, kind: body.p_kind, link: body.p_link });
      world.levels[3] = { level: 3, status: 'pending', review_note: null, post_id: POST, collaborator: body.p_partner_m_uid };
      return json(route, { post_id: POST, level: 3, status: 'pending', assignment_id: ASSIGNMENT });
    }
    if (rpc === 'action_collaboration_cards') return json(route, (body.p_post_ids || []).includes(POST) ? [{ post_id: POST, mission_id: MISSION, title: 'North Bank', kind: 'song', link: 'https://example.org/north-bank', credits: [{ m_uid: ANA.m_uid, name: 'Fixture Ana', handle: 'fixture.ana' }, { m_uid: ME.m_uid, name: 'Fixture You', handle: 'fixture.you' }], verified: false, mission_open: true }] : []);
    if (rpc === 'request_connection') { world.connection = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'pending', direction: 'sent' }; return json(route, world.connection); }
    if (rpc === 'answer_connection') { world.connection = { id: body.p_connection_id, status: body.p_accept ? 'accepted' : 'declined', direction: 'both' }; if (body.p_accept) world.connections = [{ m_uid: ANA.m_uid, display_name: 'Fixture Ana', mccluster_id: 'fixture.ana', since: new Date().toISOString() }]; return json(route, world.connection); }
    if (rpc === 'action_offer_cards' || rpc === 'action_feed_cards') return json(route, []);
    if (rpc === 'antisocial_public_collaborations') return json(route, []);
    if (rpc === 'action_bounty_public') return json(route, { support_open: false, support_note: '' });
    if (rpc === 'action_globe_public_region_missions') return json(route, []);
    if (u.pathname.includes('/rest/v1/music_creator_profiles')) return json(route, []);
    return json(route, []);
  });
  await ctx.route('https://api.mccluster.org/**', (route) => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': BASE, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,DELETE,PATCH' } });
    /* the World's Cesium ion (scripts/e2e/world-ion.e2e.mjs drives it): off here, so this Earth is NASA's alone */
    if (u.pathname === '/v1/world/ion') return json(route, { ok: true, available: false, binding: null });
    /* the World's news (GDELT, ingested by the Worker; scripts/e2e/world-screen.e2e.mjs drives it): free, never with a session */
    if (u.pathname === '/v1/world/news') return json(route, { ok: true, items: [{ id: 'ffffffff-ffff-4fff-8fff-000000000001', title: 'Councils weigh a budget for public transit', url: 'https://news.example/story/1', domain: 'news.example', seen_at: new Date(Date.now() - 600e3).toISOString(), place: 'Nairobi, Nairobi Area, Kenya', lat: -1.28, lon: 36.82 }, { id: 'ffffffff-ffff-4fff-8fff-000000000002', title: 'A port reopens after the storm', url: 'https://news.example/story/2', domain: 'news.example', seen_at: new Date(Date.now() - 1200e3).toISOString(), place: null, lat: null, lon: null }], next_before: null, attribution: { name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' } });
    if (u.pathname === '/v1/mnet/bootstrap') return json(route, { identity: ME, profile: ME, next_step: null, tour_done_at: new Date().toISOString() });
    if (u.pathname === '/v1/mnet/feed') return json(route, { items: posts, next_before: null });
    if (u.pathname === '/v1/mnet/notifications') return json(route, { notifications: world.notifications });
    if (u.pathname === '/v1/mnet/notifications/read') return json(route, {});
    if (u.pathname === '/v1/mnet/people/fixture.ana') return json(route, { identity: ANA, profile: { ...ANA, visibility: 'public' }, following: false, blocked: false, muted: false, connection: world.connection, counts: { followers: 1, following: 2, posts: 1 } });
    if (u.pathname === '/v1/mnet/people/fixture.ana/posts') return json(route, { posts: posts, next_before: null });
    if (u.pathname === '/v1/mnet/live/directory') return json(route, { sessions: [] });
    if (u.pathname === '/v1/mnet/conversations') return json(route, { conversations: [] });
    return json(route, {});
  });
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
function check(scope, name, ok, detail) { results.push({ scope, name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); }
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
await ctx.addInitScript((token) => {
  localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() }));
  localStorage.setItem('mnet_tour_seen', '1');
  localStorage.setItem('mccdb_session', JSON.stringify({ access_token: token, refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
}, jwt());
await routeBackends(ctx);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (/TypeError|ReferenceError|SyntaxError/.test(m.text())) errors.push(m.text().slice(0, 300)); });
const fits = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
const levelsRead = () => page.evaluate(() => [...document.querySelectorAll('#mnAntisocialProgress li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
const S = 'anti-social';

/* 1. the mission opens as one card with three levels; joining starts Level 1 */
await page.goto(`${BASE}/mnet.html?mission=${MISSION}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => { const d = document.getElementById('mnMissionDialog'); return d && d.open && /Anti-Social/.test(document.getElementById('mnMissionTitle').textContent); }, null, { timeout: 60000 });
await page.waitForFunction(() => !document.getElementById('mnAntisocialLevels').hidden, null, { timeout: 15000 });
check(S, 'the mission dialog shows one mission with three levels', (await levelsRead()).length === 3, await levelsRead());
check(S, 'before joining, the level form waits', await page.evaluate(() => document.getElementById('mnAntisocialForm').hidden && /Join to start Level 1/.test(document.getElementById('mnAntisocialStatus').textContent)));
await page.click('#mnMissionJoin');
await page.waitForFunction(() => !document.getElementById('mnAntisocialForm').hidden, null, { timeout: 15000 });
check(S, 'joining opens Level 1 · High Five', /Level 1\/3 · High Five/.test(await page.textContent('#mnAntisocialNext')) && (await levelsRead())[0].includes('Ready'), await levelsRead());
check(S, 'the consent line is on the dialog', await page.evaluate(() => /Record yourself or ask before filming anyone else/.test(document.getElementById('mnAntisocialLevels').textContent)));
await page.screenshot({ path: join(OUT, 'level-1-ready.png') });

/* 2. Level 1: a link, submitted; the desk verifies; Level 2 opens */
await page.fill('#mnAntisocialStatement', 'One high five, with permission.');
await page.fill('#mnAntisocialLink', 'https://example.org/high-five');
await page.click('#mnAntisocialGo');
await page.waitForFunction(() => /Awaiting review for Level 1/.test(document.getElementById('mnAntisocialStatus').textContent), null, { timeout: 15000 });
const l1 = world.calls.find((c) => c.rpc === 'submit_antisocial_level');
check(S, 'Level 1 goes to submit_antisocial_level with the recap and the link', l1 && l1.body.p_level === 1 && l1.body.p_proof_url === 'https://example.org/high-five' && l1.body.p_statement === 'One high five, with permission.', l1 && l1.body);
check(S, 'the list reads 1/3 awaiting review, 2/3 locked', (await levelsRead())[0].includes('Awaiting review') && (await levelsRead())[1].includes('Locked'), await levelsRead());
world.levels[1].status = 'verified';
await page.click('#mnMissionClose'); await page.goto(`${BASE}/mnet.html?mission=${MISSION}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /Level 2\/3 · Five High Fives/.test((document.getElementById('mnAntisocialNext') || {}).textContent || ''), null, { timeout: 60000 });
check(S, 'verified Level 1 opens Level 2 · Five High Fives', (await levelsRead())[0].includes('Verified') && (await levelsRead())[1].includes('Ready'), await levelsRead());
await page.fill('#mnAntisocialStatement', 'Five people, five high fives, all asked first.');
await page.fill('#mnAntisocialLink', 'https://example.org/five-high-fives');
await page.click('#mnAntisocialGo');
await page.waitForFunction(() => /Awaiting review for Level 2/.test(document.getElementById('mnAntisocialStatus').textContent), null, { timeout: 15000 });
world.levels[2].status = 'verified';

/* 3. Level 3 without a connection: the form says to find a member */
await page.click('#mnMissionClose'); await page.goto(`${BASE}/mnet.html?mission=${MISSION}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /Level 3\/3 · Make Something Together/.test((document.getElementById('mnAntisocialNext') || {}).textContent || ''), null, { timeout: 60000 });
await page.waitForFunction(() => /No connections yet/.test(document.getElementById('mnAntisocialPartner').textContent), null, { timeout: 15000 });
check(S, 'Level 3 opens with the publish-together form and no partner yet', !(await page.evaluate(() => document.getElementById('mnAntisocialCollab').hidden)) && /Publish together and submit Level 3/.test(await page.textContent('#mnAntisocialGo')) && /No connections yet/.test(await page.textContent('#mnAntisocialPartner')));
check(S, 'the way to a partner is written down', await page.evaluate(() => !!document.querySelector('#mnAntisocialCollab a[href="mnet.html?view=discover"]')));
await page.screenshot({ path: join(OUT, 'level-3-no-partner.png') });

/* 4. Connect on Ana's profile: Connect → Requested; Ana accepts (through the bell, as if she had asked us) */
await page.click('#mnMissionClose');
/* a profile opens from a post's author, as it does for a member */
await page.goto(`${BASE}/mnet.html?view=feed`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.mn__post-card .mn__author-link[data-person="fixture.ana"]', { timeout: 60000 });
await page.click('.mn__post-card .mn__author-link[data-person="fixture.ana"]');
await page.waitForSelector('#mnPersonConnect', { timeout: 60000 });
check(S, 'a member\'s profile offers Connect', (await page.textContent('#mnPersonConnect')).trim() === 'Connect');
await page.click('#mnPersonConnect');
await page.waitForFunction(() => /Requested/.test((document.getElementById('mnPersonConnect') || {}).textContent || ''), null, { timeout: 15000 });
check(S, 'tapping it asks the server and reads Requested', world.calls.some((c) => c.rpc === 'request_connection' && c.body.p_target_m_uid === ANA.m_uid) && /Requested/.test(await page.textContent('#mnPersonConnect')));
await page.screenshot({ path: join(OUT, 'connect-requested.png') });
/* the other side: a request to me, answered from the bell */
world.connection = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'pending', direction: 'received' };
world.notifications = [{ id: 'n1', type: 'connection_request', body: 'Fixture Ana wants to connect', created_at: new Date().toISOString(), read_at: null, metadata: { connection_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', actor_m_uid: ANA.m_uid, handle: 'fixture.ana' } }];
await page.click('#mnPersonClose');
await page.click('#mnBell');
await page.waitForSelector('[data-connection-answer][data-accept="1"]', { timeout: 15000 });
check(S, 'a connection request shows Accept and Decline in the bell', await page.evaluate(() => !!document.querySelector('[data-connection-answer][data-accept="1"]') && !!document.querySelector('[data-connection-answer][data-accept="0"]')));
await page.click('[data-connection-answer][data-accept="1"]');
await page.waitForFunction(() => /Connected/.test(document.querySelector('#mnNotifications .mn__notification strong').textContent), null, { timeout: 15000 });
check(S, 'Accept answers the server and reads Connected', world.calls.some((c) => c.rpc === 'answer_connection' && c.body.p_accept === true));
await page.screenshot({ path: join(OUT, 'bell-connected.png') });

/* 5. Level 3 publishes together: partner from my connections, title, kind, link */
await page.goto(`${BASE}/mnet.html?mission=${MISSION}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /Level 3\/3/.test((document.getElementById('mnAntisocialNext') || {}).textContent || '') && document.querySelector('#mnAntisocialPartner option[value="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]'), null, { timeout: 60000 });
check(S, 'the partner list is my connections, by name and handle', /Fixture Ana · @fixture.ana/.test(await page.textContent('#mnAntisocialPartner')));
await page.selectOption('#mnAntisocialPartner', ANA.m_uid);
await page.fill('#mnAntisocialTitle', 'North Bank');
await page.selectOption('#mnAntisocialKind', 'song');
await page.fill('#mnAntisocialLink', 'https://example.org/north-bank');
await page.fill('#mnAntisocialStatement', 'Two voices, one river.');
await page.click('#mnAntisocialGo');
await page.waitForFunction(() => /Awaiting review for Level 3/.test(document.getElementById('mnAntisocialStatus').textContent), null, { timeout: 15000 });
const pub = world.calls.find((c) => c.rpc === 'publish_antisocial_collaboration');
check(S, 'Level 3 publishes together through the platform', pub && pub.body.p_partner_m_uid === ANA.m_uid && pub.body.p_title === 'North Bank' && pub.body.p_kind === 'song' && pub.body.p_link === 'https://example.org/north-bank' && pub.body.p_statement === 'Two voices, one river.', pub && pub.body);
check(S, 'the list reads 3/3 awaiting review', (await levelsRead())[2].includes('Awaiting review'), await levelsRead());
await page.screenshot({ path: join(OUT, 'level-3-published.png') });

/* 6. the record reads 2 / 3 · Awaiting review; the feed card reads Made together with both names */
await page.click('#mnMissionClose');
await page.goto(`${BASE}/mnet.html?view=missions`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /2 \/ 3/.test((document.getElementById('mnRecord') || {}).textContent || ''), null, { timeout: 60000 });
check(S, 'the Action Record reads 2 / 3 · Awaiting review', /2 \/ 3 · Awaiting review/.test(await page.textContent('#mnRecord')));
check(S, 'the Missions card says one mission, three levels · you: 2 / 3', /One mission, three levels · you: 2 \/ 3/.test(await page.textContent('#mnMissionList')));
await page.screenshot({ path: join(OUT, 'record-2-of-3.png') });
await page.goto(`${BASE}/mnet.html?view=feed`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.mn__actcard--collab', { timeout: 60000 });
/* the evidence shot waits for the Earth's tiles (up to 25s) and brings the card into view */
const globe = page.frame({ url: /action-globe\.html/ });
if (globe) await globe.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 25000 }).catch(() => {});
await page.evaluate(() => { const c = document.querySelector('.mn__actcard--collab'); c.scrollIntoView({ block: 'center' }); });
await page.waitForTimeout(800);
const card = await page.evaluate(() => { const c = document.querySelector('.mn__actcard--collab'); return { eyebrow: c.querySelector('.mn__actcard-eyebrow').textContent, title: c.querySelector('.mn__actcard-title').textContent, by: c.querySelector('.mn__collab-by').textContent.replace(/\s+/g, ' '), link: (c.querySelector('a[target="_blank"]') || {}).href || '' }; });
check(S, 'the feed card reads Made together with both names and the work', card.eyebrow === 'Made together · in review' && card.title === 'North Bank' && /Fixture Ana & Fixture You/.test(card.by) && card.link === 'https://example.org/north-bank', card);
check(S, 'the card is drawn from the server\'s vouch, not the post\'s own metadata', world.calls.some((c) => c.rpc === 'action_collaboration_cards' && (c.body.p_post_ids || []).includes(POST)));
check(S, 'nothing scrolls sideways at 390', (await fits()).sw === (await fits()).cw, await fits());
await page.screenshot({ path: join(OUT, 'feed-made-together.png') });

/* 7. the other side: a project published with me, confirmed with one tap */
world.levels = { 1: { level: 1, status: 'verified' }, 2: { level: 2, status: 'verified' } };
world.withMe = [{ post_id: POST, title: 'North Bank', kind: 'song', link: 'https://example.org/north-bank', initiator_m_uid: ANA.m_uid, initiator_name: 'Fixture Ana', initiator_handle: 'fixture.ana', created_at: new Date().toISOString(), mine_status: null }];
await page.goto(`${BASE}/mnet.html?mission=${MISSION}`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-confirm-collab]', { timeout: 60000 });
check(S, 'a project published with me is offered: Confirm as my Level 3', /Published with you/.test(await page.textContent('#mnAntisocialWithMe')) && /North Bank/.test(await page.textContent('#mnAntisocialWithMe')));
await page.click('[data-confirm-collab]');
await page.waitForFunction(() => /Confirmed · awaiting review/.test(document.getElementById('mnAntisocialWithMe').textContent), null, { timeout: 15000 });
const confirm = world.calls.filter((c) => c.rpc === 'submit_antisocial_level').pop();
check(S, 'confirming is my Level 3 with the same post and reciprocal credit', confirm && confirm.body.p_level === 3 && confirm.body.p_post_id === POST && confirm.body.p_collaborator_m_uid === ANA.m_uid, confirm && confirm.body);
await page.screenshot({ path: join(OUT, 'level-3-confirmed.png') });
check(S, 'no page errors', errors.length === 0, errors);

await ctx.close(); await browser.close(); server.close();
const failed = results.filter((r) => !r.ok);
await writeFile(join(OUT, 'report.json'), JSON.stringify({ results, calls: world.calls }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots and report in ${OUT}`);
process.exit(failed.length ? 1 : 0);
