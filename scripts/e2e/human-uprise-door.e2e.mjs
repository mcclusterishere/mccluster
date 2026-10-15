/* HUMAN UPRISE'S OWN DOOR, IN A REAL BROWSER.
   ============================================================
   Three hosts, one bar. The Worker's host routers
   (workers/mccluster/src/company-site/router.js for https://mccluster.org,
   the World's door today; workers/mccluster/src/human-uprise/router.js for
   https://humanuprise.com, its own door when routed) answer in front of
   this checkout, so the World is opened at its own addresses by a real
   Chromium, and every link the bar writes is read back as the browser
   sees it. Matthew's site is a stub
   that records where a cross-site tap lands. On this checkout's own
   origin, a creator's front page is opened and the bar is watched taking
   that creator's perspective, keeping it on Music, and letting it go at
   the house.

   Backends are faked at the network edge (Supabase REST, the McCluster
   API); nothing here touches production. Cesium and the NASA tiles load
   from the network as they do for a visitor.

     node scripts/e2e/human-uprise-door.e2e.mjs [outDir]
   ============================================================ */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { humanUpriseResponse } from '../../workers/mccluster/src/human-uprise/router.js';
import { companySiteResponse } from '../../workers/mccluster/src/company-site/router.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || join(ROOT, 'e2e-out-door');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

/* ---------- this checkout, served ---------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([.][.][/\\])+/, '');
  const file = path === '/' ? 'index.html' : path.endsWith('/') ? path + 'index.html' : path;
  try {
    const body = await readFile(join(ROOT, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'max-age=600' }); res.end(body);
  } catch { res.writeHead(404, { 'content-type': 'text/html' }); res.end('<!doctype html><title>404</title>not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const HU = 'https://humanuprise.com';
const CO = 'https://mccluster.org';
const HOUSE = 'https://matthew.mccluster.org';

/* ---------- fixtures ---------- */
const M1 = '11111111-1111-4111-8111-111111111111';
const MISSIONS = [
  { mission_id: M1, title: 'Clean up the Mill River', description: 'Bag a block of shoreline.', action_path: 'show_up', region_key: 'US-CT', region_label: 'Connecticut', latitude: 41.6, longitude: -72.7 },
  { mission_id: '22222222-2222-4222-8222-222222222222', title: 'Amplify a local food pantry', description: 'Share the pantry hours.', action_path: 'amplify', region_key: 'GB-ENG', region_label: 'England', latitude: 52.3, longitude: -1.2 }
];
const ANA = { m_uid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', handle: 'fixture-ana', artist_name: 'Fixture Ana', bio: 'Songs from the river.', avatar_url: 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/creator-artwork/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/ana.jpg', verification_state: 'verified', status: 'active', settings: {} };
const DEV = { m_uid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', handle: 'fixture-dev', artist_name: 'Dev Fixture', bio: '', avatar_url: '', verification_state: 'none', status: 'active', settings: {} };
const TRACKS = [
  { id: 'tttttttt-tttt-4ttt-8ttt-000000000001', m_uid: ANA.m_uid, title: 'North Bank', artist: 'Fixture Ana', poster_url: '', audio_url: '', preview_bucket: '', preview_path: '', access_mode: 'public', genre: 'Folk', published_at: '2026-10-01T00:00:00Z', duration_ms: 180000 },
  { id: 'tttttttt-tttt-4ttt-8ttt-000000000002', m_uid: DEV.m_uid, title: 'Memo', artist: 'Dev Fixture', poster_url: '', audio_url: '', preview_bucket: '', preview_path: '', access_mode: 'public', genre: 'Spoken', published_at: '2026-09-20T00:00:00Z', duration_ms: 120000 }
];
const now = Date.now();
const POSTS = [0, 1, 2].map((k) => ({ item_type: 'post', post_id: `dddddddd-dddd-4ddd-8ddd-00000000000${k + 1}`, occurred_at: new Date(now - (k + 1) * 3600e3).toISOString(), actor: { mccluster_id: 'fixture.ana', display_name: 'Fixture Ana' }, post: { id: `dddddddd-dddd-4ddd-8ddd-00000000000${k + 1}`, body: `Field note ${k + 1}: the north bank, and who can help.`, visibility: 'public', created_at: new Date(now - (k + 1) * 3600e3).toISOString(), media_locked: 0 } }));

const landed = [];   // every cross-site arrival at Matthew's site
const served = [];   // every request the Human Uprise host answered

/* one M Account, every host: the session a member holds on Matthew's site,
   and the one Supabase mints for the World's host when the bar carries the
   sign-in across */
const jwt = (tag) => tag + '.' + btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, sub: 'auth-you' })).replace(/=+$/, '') + '.sig';
const SESSION = { token: jwt('house'), fresh: jwt('world') };
const ME = { m_uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', mccluster_id: 'fixture.you', display_name: 'Fixture You' };
const carried = { handoff: [], verify: [], bootstrap: [] };

const apiReads = [];
let nextStep = null;   // the bootstrap's next_step for the scenario that needs one
async function routeBackends(ctx) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
  await ctx.route('https://zmnhbrjyhxzhkxmhkexs.supabase.co/**', async (route) => {
    const u = route.request().url(), r = route.request();
    /* a creator's picture, where Creator Studio stores it */
    if (u.includes('/storage/v1/object/public/creator-artwork/')) return route.fulfill({ status: 200, contentType: 'image/jpeg', body: await readFile(join(ROOT, 'assets/img/peaceful-places.jpg')) });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type', 'access-control-allow-methods': 'GET,POST' } });
    if (u.includes('/auth/v1/user')) {
      const auth = (await r.allHeaders()).authorization || '';
      return [SESSION.token, SESSION.fresh].map((t) => 'Bearer ' + t).includes(auth) ? json(route, { id: 'auth-you', email: 'you@example.org' }) : json(route, { msg: 'no' }, 401);
    }
    /* a refresh keeps whichever session asked */
    if (u.includes('/auth/v1/token') && r.method() === 'POST') {
      const body = r.postDataJSON() || {};
      const tok = body.refresh_token === 'refresh-world' ? SESSION.fresh : SESSION.token;
      return json(route, { access_token: tok, refresh_token: body.refresh_token || '', token_type: 'bearer', expires_in: 3600, user: { id: 'auth-you' } });
    }
    /* the one-time magic-link token becomes a session of the arriving origin's own */
    if (u.includes('/auth/v1/verify') && r.method() === 'POST') {
      carried.verify.push({ origin: (await r.allHeaders()).origin || '', body: r.postDataJSON() });
      return json(route, { access_token: SESSION.fresh, refresh_token: 'refresh-world', token_type: 'bearer', expires_in: 3600, user: { id: 'auth-you' } });
    }
    if (u.includes('action_globe_public_region_missions')) return json(route, MISSIONS);
    if (u.includes('/rest/v1/music_creator_profiles?handle=eq.fixture-ana')) return json(route, [ANA]);
    if (u.includes('/rest/v1/music_creator_profiles?handle=eq.fixture-dev')) return json(route, [DEV]);
    if (u.includes('/rest/v1/music_creator_profiles?status=eq.active')) return json(route, [ANA, DEV]);
    if (u.includes('/rest/v1/creator_tracks?status=eq.published')) return json(route, TRACKS);
    if (u.includes('/rest/v1/creator_tracks?m_uid=eq.')) return json(route, TRACKS.filter((t) => u.includes(t.m_uid)));
    return json(route, []);
  });
  await ctx.route('https://api.mccluster.org/**', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,DELETE' } });
    apiReads.push({ path: u.pathname, auth: !!(await req.allHeaders()).authorization });
    if (u.pathname === '/v1/mnet/public-feed') return json(route, { items: POSTS, scope: 'public', next_before: null });
    /* the sign-in handoff: the arriving page's bearer and Origin, answered with a token hash */
    if (u.pathname === '/v1/auth/handoff' && req.method() === 'POST') {
      const h = await req.allHeaders();
      carried.handoff.push({ origin: h.origin || '', authorization: h.authorization || '' });
      if (h.authorization !== 'Bearer ' + SESSION.token) return json(route, { error: 'sign in first' }, 401);
      return json(route, { token_hash: 'th-fixture', type: 'magiclink', origin: h.origin });
    }
    if (u.pathname === '/v1/mnet/bootstrap') {
      carried.bootstrap.push({ origin: (await req.allHeaders()).origin || '', authorization: (await req.allHeaders()).authorization || '' });
      return json(route, { identity: ME, profile: nextStep ? null : ME, next_step: nextStep, tour_done_at: new Date().toISOString() });
    }
    if (u.pathname === '/v1/mnet/feed') return json(route, { items: POSTS.map((p) => ({ ...p, post: { ...p.post, author_m_uid: ME.m_uid, media: [] } })), next_before: null });
    if (u.pathname === '/v1/mnet/notifications') return json(route, { notifications: [] });
    if (u.pathname === '/v1/mnet/live/directory') return json(route, { sessions: [] });
    return json(route, {});
  });
  /* Matthew's site: a stub that remembers where the tap landed */
  await ctx.route(`${HOUSE}/**`, (route) => {
    landed.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><title>Matthew's site (stub)</title><p id="house">${route.request().url()}</p>` });
  });
  /* the World's hosts: the real Worker routers, in front of this checkout.
     The company host (mccluster.org) serves the World at its root today;
     Human Uprise's own door (humanuprise.com) does the same when routed. */
  for (const [host, respond] of [[HU, humanUpriseResponse], ['https://www.humanuprise.com', humanUpriseResponse], [CO, companySiteResponse], ['https://www.mccluster.org', companySiteResponse]]) {
    await ctx.route(`${host}/**`, async (route) => {
      const r = route.request();
      const headers = {};
      for (const [k, v] of Object.entries(await r.allHeaders())) if (!/^(:|host$|content-length$)/.test(k)) headers[k] = v;
      const res = await respond(new Request(r.url(), { method: r.method(), headers }), { PUBLIC_ORIGIN: BASE });
      served.push({ url: r.url(), status: res.status, location: res.headers.get('location'), robots: res.headers.get('x-robots-tag') });
      /* a fulfilled redirect is followed by Chromium's own network stack,
         outside interception, so the router's 301 is recorded above and
         walked here as a navigation the routes can see */
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><title>${res.status}</title><script>location.replace(${JSON.stringify(res.headers.get('location'))})</script>` });
      }
      const out = {};
      res.headers.forEach((v, k) => { out[k] = v; });
      return route.fulfill({ status: res.status, headers: out, body: Buffer.from(await res.arrayBuffer()) });
    });
  }
}

/* ---------- the harness ---------- */
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
function check(scope, name, ok, detail) {
  results.push({ scope, name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);
}
async function open(device, { memberOn = '' } = {}) {
  const ctx = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: 2, isMobile: device.mobile, hasTouch: device.mobile, serviceWorkers: 'block' });
  await ctx.addInitScript(({ memberOn, token }) => {
    localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-09-26', accepted_at: new Date().toISOString() }));
    localStorage.setItem('mnet_tour_seen', '1');
    /* signed in on one house only: the other must earn its own session */
    if (memberOn && location.origin === memberOn && !sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', '1'); localStorage.setItem('mccdb_session', JSON.stringify({ access_token: token, refresh_token: 'refresh-house', expires_at: Math.floor(Date.now() / 1000) + 3600 })); }
  }, { memberOn, token: SESSION.token });
  await routeBackends(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (/TypeError|ReferenceError|SyntaxError/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  return { ctx, page, errors };
}
const bar = (page) => page.evaluate(() => {
  const tab = (k) => document.querySelector(`.appbar [data-appnav="${k}"]`);
  const home = tab('home'), coin = home && home.querySelector('.appbar__m');
  return {
    music: tab('music') && tab('music').href, home: home && home.href, world: tab('world') && tab('world').href,
    lit: [...document.querySelectorAll('.appbar .is-here')].map((a) => a.getAttribute('data-appnav')),
    perspective: home && home.getAttribute('data-perspective'),
    label: home && home.querySelector('span:last-child') && home.querySelector('span:last-child').textContent,
    coin: coin ? { tag: coin.tagName, cls: coin.className, src: coin.getAttribute('src'), text: coin.textContent } : null,
    columns: [...document.querySelectorAll('.appbar > .appbar__tab')].map((a) => a.getAttribute('data-appnav'))
  };
});
const fits = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
const settleWorld = async (page) => {
  await page.waitForFunction(() => /pinned on the Earth|No missions are pinned|could not load|can.t run/.test((document.getElementById('mnWorldCaption') || {}).textContent || ''), null, { timeout: 90000 });
  await page.waitForSelector('#mnFeed [data-post-id]', { timeout: 20000 });
  const globe = page.frame({ url: /action-globe\.html/ });
  if (globe) await globe.waitForFunction(() => window.__huGlobeSettled && window.__huGlobeSettled(), null, { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return globe;
};

/* ---------- 1. the World at its own address, as a guest on an iPhone ---------- */
{
  const S = 'human-uprise-host';
  const { ctx, page, errors } = await open({ viewport: { width: 390, height: 844 }, mobile: true });
  await page.goto(`${HU}/`, { waitUntil: 'domcontentloaded' });
  const globe = await settleWorld(page);
  check(S, 'https://humanuprise.com/ is the World', page.url() === `${HU}/` && !!(await page.$('#mnWorld')), page.url());
  const head = await page.evaluate(() => ({ canonical: (document.querySelector('link[rel="canonical"]') || {}).href || null, robots: (document.querySelector('meta[name="robots"]') || {}).content || null, og: (document.querySelector('meta[property="og:url"]') || {}).content || null, title: document.title }));
  check(S, 'the page carries this host\'s canonical and no noindex', head.canonical === `${HU}/` && head.robots === null && head.og === `${HU}/`, head);
  check(S, 'the Earth is in a frame on the same host, so the bridge is same-origin', !!globe && globe.url().startsWith(`${HU}/action-globe.html`), globe && globe.url());
  const b = await bar(page);
  check(S, 'the bar is Music | M | Globe', b.columns.join('|') === 'music|home|world', b.columns);
  check(S, 'Music and the M go to Matthew\'s site outright', b.music === `${HOUSE}/listen.html` && b.home === `${HOUSE}/index.html`, { music: b.music, home: b.home });
  check(S, 'the Globe stays home, at the root of this host', b.world === `${HU}/?view=feed`, b.world);
  check(S, 'the Globe coin is lit at the root, not the M', b.lit.join(',') === 'world', b.lit);
  const files = served.filter((s) => s.status === 200).map((s) => new URL(s.url).pathname);
  check(S, 'the World\'s files came through this host', files.includes('/js/mnet.js') && files.includes('/css/mnet.css') && files.some((p) => p.startsWith('/assets/')), files.length);
  check(S, 'rooms carry noindex; the front door does not', served.some((s) => s.url === `${HU}/` && s.robots === null) && served.some((s) => s.url.startsWith(`${HU}/action-globe.html`) && s.robots === 'noindex'));
  check(S, 'nothing scrolls sideways at 390', (await fits(page)).sw === (await fits(page)).cw, await fits(page));
  await page.screenshot({ path: join(OUT, 'hu-guest-iphone.png') });
  check(S, 'no page errors', errors.length === 0, errors);

  /* the World's document name is the root here, query and all */
  const moved = (url) => served.find((x) => x.url === url && x.status === 301);
  await page.goto(`${HU}/mnet.html?view=missions`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${HU}/?view=missions`, { timeout: 15000 }).catch(() => {});
  check(S, '/mnet.html?view=missions is a 301 to /?view=missions', page.url() === `${HU}/?view=missions` && !!moved(`${HU}/mnet.html?view=missions`) && moved(`${HU}/mnet.html?view=missions`).location === `${HU}/?view=missions`, { url: page.url(), served: moved(`${HU}/mnet.html?view=missions`) });
  await page.goto('https://www.humanuprise.com/?view=feed', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${HU}/?view=feed`, { timeout: 15000 }).catch(() => {});
  check(S, 'www is a 301 to the apex', page.url() === `${HU}/?view=feed` && !!moved('https://www.humanuprise.com/?view=feed'), { url: page.url(), served: moved('https://www.humanuprise.com/?view=feed') });

  /* a tap on Music lands on Matthew's site */
  await settleWorld(page);
  landed.length = 0;
  await page.click('.appbar [data-appnav="music"]');
  await page.waitForURL(/matthew\.mccluster\.org/, { timeout: 15000 });
  check(S, 'tapping Music lands on matthew.mccluster.org/listen.html, and a guest carries nothing', page.url() === `${HOUSE}/listen.html` && landed[0] === `${HOUSE}/listen.html` && !/mcc_handoff/.test(page.url()), page.url());
  /* a record's address on this host is Matthew's */
  await page.goto(`${HU}/album.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${HOUSE}/album.html`, { timeout: 15000 }).catch(() => {});
  check(S, '/album.html on this host is a 301 to Matthew\'s site', page.url() === `${HOUSE}/album.html` && !!moved(`${HU}/album.html`) && moved(`${HU}/album.html`).location === `${HOUSE}/album.html`, { url: page.url(), served: moved(`${HU}/album.html`) });
  await ctx.close();
}

/* ---------- 2. a creator's perspective, on Matthew's site (this checkout) ---------- */
{
  const S = 'creator-perspective';
  const { ctx, page, errors } = await open({ viewport: { width: 390, height: 844 }, mobile: true });
  await page.goto(`${BASE}/music-creator.html?handle=fixture-ana`, { waitUntil: 'domcontentloaded' });
  /* the name is set as two spans, the last word in the artist's accent, so the text reads "FixtureAna" */
  await page.waitForFunction(() => /Fixture\s*Ana/.test((document.getElementById('creatorArtist') || {}).textContent || ''), null, { timeout: 20000 });
  await page.waitForFunction(() => !!document.querySelector('.appbar [data-appnav="home"][data-perspective]'), null, { timeout: 10000 }).catch(() => {});
  let b = await bar(page);
  check(S, 'on Fixture Ana\'s front page the middle cell is Ana', b.perspective === 'fixture-ana' && b.home === `${BASE}/music-creator.html?handle=fixture-ana`, { perspective: b.perspective, home: b.home });
  check(S, 'the coin is her own picture, round', b.coin && b.coin.tag === 'IMG' && /appbar__m--creator/.test(b.coin.cls) && b.coin.src === ANA.avatar_url, b.coin);
  check(S, 'the label is her name; her page lights her coin', b.label === 'Fixture' && b.lit.join(',') === 'home', { label: b.label, lit: b.lit });
  check(S, 'Music is unchanged and the Globe goes to the World at the company\'s root', b.music === `${BASE}/listen.html` && b.world === `${CO}/?view=feed`, { music: b.music, world: b.world });
  check(S, 'nothing scrolls sideways at 390', (await fits(page)).sw === (await fits(page)).cw, await fits(page));
  await page.screenshot({ path: join(OUT, 'perspective-creator-iphone.png') });

  /* Music keeps her in the middle, and shows the artists: the house first */
  await page.goto(`${BASE}/listen.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#artistsRow a.artist[href="music-creator.html?handle=fixture-ana"]', { timeout: 20000 });
  b = await bar(page);
  check(S, 'on Music the middle cell is still Ana, and it goes to her page', b.perspective === 'fixture-ana' && b.home === `${BASE}/music-creator.html?handle=fixture-ana`, { perspective: b.perspective, home: b.home });
  const artists = await page.evaluate(() => [...document.querySelectorAll('#artistsRow a.artist')].map((a) => ({ href: a.getAttribute('href'), name: a.querySelector('b').textContent, pic: a.querySelector('.artist__pic').tagName + (a.querySelector('.artist__pic').getAttribute('src') ? ':' + a.querySelector('.artist__pic').getAttribute('src') : ':' + a.querySelector('.artist__pic').textContent) })));
  check(S, 'the Artists rail: McCluster first (the house, the M as supplied), then each creator with their own picture or initial',
    artists[0] && artists[0].href === 'index.html' && artists[0].pic === 'IMG:assets/img/m-mark.png' &&
    artists.some((a) => a.href === 'music-creator.html?handle=fixture-ana' && a.pic === 'IMG:' + ANA.avatar_url) &&
    artists.some((a) => a.href === 'music-creator.html?handle=fixture-dev' && a.pic === 'SPAN:D'), artists);
  check(S, 'nothing scrolls sideways at 390', (await fits(page)).sw === (await fits(page)).cw, await fits(page));
  await page.screenshot({ path: join(OUT, 'perspective-music-iphone.png') });

  /* McCluster opens the house, and the house lets the perspective go */
  await page.click('#artistsRow a.artist--house');
  await page.waitForURL(/index\.html$|\/$/, { timeout: 15000 });
  await page.waitForFunction(() => !!document.querySelector('.appbar [data-appnav="home"]'), null, { timeout: 15000 });
  b = await bar(page);
  const stored = await page.evaluate(() => sessionStorage.getItem('mcc_perspective'));
  check(S, 'McCluster in Music opens the house: the M is back in the middle and the perspective is gone', /index\.html$|\/$/.test(page.url()) && !b.perspective && b.coin && b.coin.tag === 'IMG' && !/creator/.test(b.coin.cls) && /m-mark\.png$/.test(b.coin.src) && stored === null, { url: page.url(), coin: b.coin, stored });

  /* a creator with no picture: the initial */
  await page.goto(`${BASE}/music-creator.html?handle=fixture-dev`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('.appbar [data-appnav="home"][data-perspective="fixture-dev"]'), null, { timeout: 20000 }).catch(() => {});
  b = await bar(page);
  check(S, 'a creator without a picture gets their initial, never a drawn mark', b.perspective === 'fixture-dev' && b.coin && b.coin.tag === 'SPAN' && /appbar__m--initial/.test(b.coin.cls) && b.coin.text === 'D', b.coin);
  await page.screenshot({ path: join(OUT, 'perspective-initial-iphone.png') });
  check(S, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* ---------- 3. the held wing keeps the way to the house (desktop pointer) ---------- */
{
  const S = 'creator-wing';
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 800 }, mobile: false });
  await page.goto(`${BASE}/music-creator.html?handle=fixture-ana`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('.appbar [data-appnav="home"][data-perspective="fixture-ana"]'), null, { timeout: 20000 }).catch(() => {});
  const box = await (await page.$('.appbar [data-appnav="home"]')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  const wing = await page.evaluate(() => ({ morph: document.querySelector('.appbar').classList.contains('appbar--morph'), slots: [...document.querySelectorAll('.appbar .appbar__tab--slot')].map((a) => ({ href: a.getAttribute('href'), label: a.querySelector('span').textContent, mark: a.querySelector('img') ? a.querySelector('img').getAttribute('src') : null })) }));
  await page.mouse.up();
  check(S, 'holding Ana\'s coin opens her wing: McCluster (the M as supplied) beside Everything', wing.morph && wing.slots.length === 2 && wing.slots[0].label === 'McCluster' && /index\.html$/.test(wing.slots[0].href) && /m-mark\.png$/.test(wing.slots[0].mark || '') && wing.slots[1].label === 'Everything', wing);
  await page.screenshot({ path: join(OUT, 'perspective-wing-desktop.png') });
  check(S, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* ---------- 3b. the company's door: mccluster.org is the World today (owner, 2026-10-15) ---------- */
{
  const S = 'company-host';
  const { ctx, page, errors } = await open({ viewport: { width: 390, height: 844 }, mobile: true });
  await page.goto(`${CO}/`, { waitUntil: 'domcontentloaded' });
  const globe = await settleWorld(page);
  check(S, 'https://mccluster.org/ is the World', page.url() === `${CO}/` && !!(await page.$('#mnWorld')), page.url());
  const head = await page.evaluate(() => ({ canonical: document.querySelector('link[rel=canonical]') && document.querySelector('link[rel=canonical]').href, robots: document.querySelector('meta[name=robots]') && document.querySelector('meta[name=robots]').content, og: document.querySelector('meta[property="og:url"]') && document.querySelector('meta[property="og:url"]').content, site: document.querySelector('meta[property="og:site_name"]') && document.querySelector('meta[property="og:site_name"]').content, ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((n) => { try { return JSON.parse(n.textContent); } catch { return null; } }) }));
  check(S, 'the page carries the company host\'s canonical, McCluster Corp as the site, and no noindex', head.canonical === `${CO}/` && head.robots === null && head.og === `${CO}/` && head.site === 'McCluster Corp', head);
  check(S, 'the root belongs to the company WebSite and is about the Organization, stable @ids', head.ld.some((n) => n && n['@id'] === `${CO}/` && n.isPartOf && n.isPartOf['@id'] === `${CO}/#website` && n.about && n.about['@id'] === 'https://matthew.mccluster.org/#mccluster-corp'), head.ld);
  check(S, 'the Earth is in a frame on the same host, so the bridge is same-origin', !!globe && globe.url().startsWith(`${CO}/action-globe.html`), globe && globe.url());
  const b = await bar(page);
  check(S, 'the bar is Music | M | Globe', b.columns.join('|') === 'music|home|world', b.columns);
  check(S, 'Music and the M go to Matthew\'s site outright', b.music === `${HOUSE}/listen.html` && b.home === `${HOUSE}/index.html`, { music: b.music, home: b.home });
  check(S, 'the Globe stays home, at the root of this host', b.world === `${CO}/?view=feed`, b.world);
  check(S, 'the Globe coin is lit at the root, not the M', b.lit.join(',') === 'world', b.lit);
  const files = served.filter((x) => x.url.startsWith(CO)).map((x) => new URL(x.url).pathname);
  check(S, 'the World\'s files came through this host', files.includes('/js/mnet.js') && files.includes('/css/mnet.css') && files.some((p) => p.startsWith('/assets/')), files.length);
  check(S, 'rooms carry noindex; the front door does not', served.some((x) => x.url === `${CO}/` && x.robots === null) && served.some((x) => x.url.startsWith(`${CO}/action-globe.html`) && x.robots === 'noindex'));
  check(S, 'nothing scrolls sideways at 390', (await fits(page)).sw === (await fits(page)).cw, await fits(page));
  await page.screenshot({ path: join(OUT, 'company-host-guest-iphone.png') });
  check(S, 'no page errors', errors.length === 0, errors);
  const moved = (u) => served.find((x) => x.url === u && x.status === 301);
  await page.goto(`${CO}/mnet.html?view=missions`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => u.pathname === '/' && u.searchParams.get('view') === 'missions', { timeout: 15000 });
  check(S, '/mnet.html?view=missions is a 301 to /?view=missions', page.url() === `${CO}/?view=missions` && !!moved(`${CO}/mnet.html?view=missions`) && moved(`${CO}/mnet.html?view=missions`).location === `${CO}/?view=missions`, { url: page.url(), served: moved(`${CO}/mnet.html?view=missions`) });
  await page.goto('https://www.mccluster.org/?view=feed', { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => u.hostname === 'mccluster.org', { timeout: 15000 });
  check(S, 'www is a 301 to the apex', page.url() === `${CO}/?view=feed` && !!moved('https://www.mccluster.org/?view=feed'), { url: page.url(), served: moved('https://www.mccluster.org/?view=feed') });
  /* the company page, "What is McCluster Corp?", at /company */
  await page.goto(`${CO}/company`, { waitUntil: 'domcontentloaded' });
  const company = await page.evaluate(() => ({ title: document.title, canonical: document.querySelector('link[rel=canonical]') && document.querySelector('link[rel=canonical]').href, world: document.querySelector('header a.go') && document.querySelector('header a.go').href, scripts: [...document.scripts].filter((x) => x.type !== 'application/ld+json').length }));
  check(S, '/company is McCluster Corp\'s page, with its own canonical, no executable scripts, and a door to the World at the root', /^McCluster Corp/.test(company.title) && company.canonical === `${CO}/company` && company.world === `${CO}/` && company.scripts === 0, company);
  check(S, 'nothing scrolls sideways at 390 on the company page', (await fits(page)).sw === (await fits(page)).cw, await fits(page));
  await page.screenshot({ path: join(OUT, 'company-page-iphone.png') });
  /* everything else is Matthew's */
  await page.goto(`${CO}/album.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/matthew\.mccluster\.org/, { timeout: 15000 });
  check(S, '/album.html on this host is a 301 to Matthew\'s site', page.url() === `${HOUSE}/album.html` && !!moved(`${CO}/album.html`) && moved(`${CO}/album.html`).location === `${HOUSE}/album.html`, { url: page.url(), served: moved(`${CO}/album.html`) });
  await ctx.close();
}

/* ---------- 3c. until the owner routes mccluster.org/*: the zone rule lands the Globe's link on the house root, and the house forwards it to the World ---------- */
{
  const S = 'before-the-route';
  const { ctx, page, errors } = await open({ viewport: { width: 390, height: 844 }, mobile: true });
  /* the checkout's own root stands in for Matthew's root: index.html with the house bar */
  await page.goto(`${BASE}/?view=feed`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => /mnet\.html$/.test(u.pathname), { timeout: 15000 }).catch(() => {});
  check(S, 'the house root with the World\'s query goes on to the World on this origin, query intact', page.url() === `${BASE}/mnet.html?view=feed`, page.url());
  await page.goto(`${BASE}/index.html?view=missions#mcc_handoff=carried`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL((u) => /mnet\.html$/.test(u.pathname), { timeout: 15000 }).catch(() => {});
  check(S, 'index.html too, and a carried sign-in rides along in the fragment', page.url() === `${BASE}/mnet.html?view=missions` || page.url() === `${BASE}/mnet.html?view=missions#mcc_handoff=carried`, page.url());
  await page.goto(`${BASE}/listen.html?view=feed`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  check(S, 'only the root forwards: another page with a view query stays put', page.url() === `${BASE}/listen.html?view=feed`, page.url());
  check(S, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

/* ---------- 3d. the World first (owner, 2026-10-15: "me as a signed in user … I see no globe"): a member whose profile is unfinished ---------- */
{
  const S = 'finish-profile';
  nextStep = 'profile';
  const { ctx, page, errors } = await open({ viewport: { width: 390, height: 844 }, mobile: true }, { memberOn: BASE });
  await page.goto(`${BASE}/mnet.html?view=feed`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('mcc-auth-in') && !!document.querySelector('#mnFeed [data-post-id]'), null, { timeout: 60000 }).catch(() => {});
  await settleWorld(page);
  const seen = await page.evaluate(() => ({ signedIn: document.body.classList.contains('mcc-auth-in'), app: !document.getElementById('mnApp').hidden, gate: !document.getElementById('mnProfileGate').hidden, world: document.getElementById('mnWorld').getBoundingClientRect().height, frame: !!document.querySelector('#mnWorldFrame'), card: !document.getElementById('mnFinishCard').hidden, cardText: document.getElementById('mnFinishCard').textContent.replace(/\s+/g, ' ').trim(), composer: document.getElementById('mnComposer').hidden, posts: document.querySelectorAll('#mnFeed [data-post-id]').length }));
  check(S, 'signed in with an unfinished profile, the World is on screen: the Earth, the strip, the posts', seen.signedIn && seen.app && !seen.gate && seen.world > 200 && seen.frame && seen.posts > 0, seen);
  check(S, 'the step waits in a card where the composer would be', seen.card && /Finish your profile\./.test(seen.cardText) && seen.composer, { card: seen.card, composer: seen.composer, text: seen.cardText });
  const reads = apiReads.filter((r) => /\/v1\/mnet\/(public-feed|feed)$/.test(r.path));
  check(S, 'the feed read is the public one until the profile exists', reads.length > 0 && reads.every((r) => r.path === '/v1/mnet/public-feed' && !r.auth), reads);
  await page.screenshot({ path: join(OUT, 'finish-profile-iphone.png') });
  check(S, 'nothing scrolls sideways at 390', (await fits(page)).sw === (await fits(page)).cw, await fits(page));
  /* the join on the mission card asks to finish, with the reason, and the way back is the World */
  await page.waitForSelector('#mnWorldFocusJoin', { timeout: 15000 });
  await page.click('#mnWorldFocusJoin');
  await page.waitForSelector('#mnProfileGate:not([hidden])', { timeout: 10000 });
  const gate = await page.evaluate(() => ({ status: document.getElementById('mnProfileStatus').textContent, back: document.getElementById('mnProfileBack').hidden ? null : document.getElementById('mnProfileBack').textContent, app: !document.getElementById('mnApp').hidden }));
  check(S, 'joining a mission opens the profile form with the reason and a way back to the World', /Finish your profile to join a mission\./.test(gate.status) && gate.back === '← Back to the World' && !gate.app, gate);
  await page.click('#mnProfileBack');
  await page.waitForSelector('#mnApp:not([hidden])', { timeout: 10000 });
  check(S, 'Back returns to the World, not to a profile page', (await page.evaluate(() => !document.getElementById('mnFeedView').hidden && document.getElementById('mnWorld').getBoundingClientRect().height > 200)));
  await page.click('#mnFinishGo');
  await page.waitForSelector('#mnProfileGate:not([hidden])', { timeout: 10000 });
  check(S, 'the card opens the same form', await page.evaluate(() => !document.getElementById('mnProfileGate').hidden));
  check(S, 'no page errors', errors.length === 0, errors);
  await ctx.close();
  nextStep = null;
}

/* ---------- 4. one M Account, every host: a member taps the Globe, crosses to the World's door and comes back ---------- */
{
  const S = 'sign-in-handoff';
  const { ctx, page, errors } = await open({ viewport: { width: 390, height: 844 }, mobile: true }, { memberOn: BASE });
  await page.goto(`${BASE}/listen.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.classList.contains('mcc-auth-in'), null, { timeout: 20000 }).catch(() => {});
  const signedIn = await page.evaluate(() => document.body.classList.contains('mcc-auth-in'));
  check(S, 'signed in on Matthew\'s site', signedIn);
  /* the Globe tab itself: from Matthew's site it goes to the World at the company's root */
  const globeHref = await page.evaluate(() => document.querySelector('.appbar [data-appnav="world"]').href);
  check(S, 'the Globe tab goes to the World at the company\'s root', globeHref === `${CO}/?view=feed`, globeHref);
  await page.click('.appbar [data-appnav="world"]');
  await page.waitForURL((u) => u.origin === CO && !u.hash, { timeout: 30000 });
  await page.waitForFunction(() => document.body.classList.contains('mcc-auth-in') && !!document.querySelector('#mnFeed [data-post-id]'), null, { timeout: 60000 }).catch(() => {});
  const arrived = await page.evaluate(() => ({ url: location.href, hash: location.hash, signedIn: document.body.classList.contains('mcc-auth-in'), session: JSON.parse(localStorage.getItem('mccdb_session') || 'null'), composer: !!document.querySelector('.mn__create'), guestCard: !!document.querySelector('[data-guest-ask]') }));
  check(S, 'the World\'s host received the sign-in: the fragment is gone from the address', arrived.url === `${CO}/?view=feed` && arrived.hash === '', { url: arrived.url, hash: arrived.hash });
  /* (an earlier scenario forwarded a bogus fragment on the house, which a guest page tries to exchange and is refused; this is the member's) */
  check(S, 'the arriving page exchanged the carried token from its own origin', carried.handoff.some((h) => h.origin === CO && h.authorization === 'Bearer ' + SESSION.token), carried.handoff);
  check(S, 'Supabase turned the one-time token into a session of this origin\'s own', carried.verify.length >= 1 && carried.verify[0].body && carried.verify[0].body.type === 'magiclink' && carried.verify[0].body.token_hash === 'th-fixture', carried.verify);
  check(S, 'the session stored on the World\'s host is the fresh one, not the house\'s', arrived.session && arrived.session.access_token === SESSION.fresh && arrived.session.refresh_token === 'refresh-world', arrived.session);
  check(S, 'the World booted as a member: the composer, the member feed, the bar signed in', arrived.signedIn && arrived.composer && carried.bootstrap.some((b) => b.authorization === 'Bearer ' + SESSION.fresh && b.origin === CO), { signedIn: arrived.signedIn, composer: arrived.composer, bootstrap: carried.bootstrap });
  check(S, 'nothing scrolls sideways at 390', (await fits(page)).sw === (await fits(page)).cw, await fits(page));
  await page.screenshot({ path: join(OUT, 'handoff-member-iphone.png') });
  /* and back: the Music tab carries the World host's own fresh token to Matthew's site */
  await page.click('.appbar [data-appnav="music"]');
  await page.waitForURL(/matthew\.mccluster\.org/, { timeout: 15000 });
  const back = page.url();
  check(S, 'tapping Music from the World\'s host carries the sign-in back in the fragment', back.startsWith(`${HOUSE}/listen.html#mcc_handoff=`) && decodeURIComponent(back.split('mcc_handoff=')[1]) === SESSION.fresh && landed.includes(`${HOUSE}/listen.html`), back.replace(SESSION.fresh, '<fresh token>'));
  check(S, 'no page errors', errors.length === 0, errors);
  await ctx.close();
}

await browser.close();
server.close();
const failed = results.filter((r) => !r.ok);
await writeFile(join(OUT, 'report.json'), JSON.stringify({ results, served, landed, carried }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots and report in ${OUT}`);
process.exit(failed.length ? 1 : 0);
