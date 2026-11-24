/* THE CARRY, IN A REAL BROWSER (SPEC-PLATFORM 2.6 to 2.8 and the P1 acceptance of section 4).
   ============================================================
   Chromium with its own default storage partitioning (Playwright launches it with ThirdPartyStoragePartitioning
   disabled, so the suite takes that one feature back out of the list Playwright passes; scenario 7 checks partitioning
   is on instead of assuming it), and every host of the site answered as P1 answers it: the platform
   (https://mccluster.org) by Worker mccluster's own site router run in-process, as workers/mccluster/src/entry-platform.js
   composes it, over this checkout's published files; Matthew's host (https://matthew.mccluster.org) by a model of GitHub
   Pages over the same files (it is not routed to the Worker until P3); the API and Supabase by fixtures that record what
   they were sent. Nothing here reaches production. Scenarios:

   1. Signed in on Matthew's host, a member opens the platform: one carry (a hidden same-site frame of his host's
      carry.html, the existing POST /v1/auth/handoff as a bearer header, Supabase's one-time token) signs the platform in.
      No request URL and no history entry holds a token; his host stays signed in; the carry asks once. On his host the
      bar points the Globe at the platform's World and the M at his own root, and until P3 Music and the account chip
      stay on his host (the P1 amendment of 2026-11-24: a song playing on his album keeps playing, as at P0).
   2. Nothing to carry: the platform says one clear line on the sign-in page and on the account chip, for 30 days, and
      does not ask again; on a phone the chip shows it under itself, visibly, at 390 and 320, until it is closed.
   3. embed.html on the platform renders inside a page of a foreign origin; a page that is not the embed does not.
   4. The World opened over Music on the platform is a frame of the platform's own origin.
   5. The installed app's move card shows once, on Matthew's host in standalone mode only.
   6. Matthew's host still answers the installed app's start page, manifest.json and sw.js; the platform's manifest starts
      its own app on the World.
   7. A token in a link is never a way in (review SEC-P1-1): a guest who opens a platform address whose fragment holds
      another account's access token (#mcc_handoff=) sends it nowhere and is signed in as nobody; a member signed in on
      Matthew's host who opens the same link is signed in as themselves, by the carry. And the carry page framed by
      another site sees an empty partition, not his host's storage (review SEC-P1-3).
   8. Songs kept at the old address: his host's vault holds songs; on the platform one line offers them, in the bar's own
      card, at 390 and 320 with nothing scrolling sideways; a tap keeps the same files at the same paths in the
      platform's vault, and his host keeps its copies (SPEC-PLATFORM 2.7, review VP1-1).

     node scripts/e2e/carry.e2e.mjs [outDir]
   ============================================================ */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadSite, localFetcher } from './platform-hosts.e2e.mjs';

const OUT = process.argv[2] || join(fileURLToPath(new URL('../../', import.meta.url)), 'e2e-out-carry');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const SITE = await loadSite(ROOT);
const PLAT = SITE.platform.origin;
const PROF = SITE.profile.origin;
const FOREIGN = 'https://foreign-embed.example';
const USER = '11111111-1111-4111-8111-111111111111';
const jwt = (tag) => `${tag}.${Buffer.from(JSON.stringify({ sub: USER, exp: Math.floor(Date.now() / 1000) + 3600, email: 'carry-fixture@invalid.test' })).toString('base64url')}.sig`;
const HOUSE_TOKEN = jwt('house');
const PLATFORM_TOKEN = jwt('platform');
/* another account's access token, as a crafted link would carry it; the hand-off route mints a session for any account
   whose bearer it is given (workers/mccluster/src/auth-handoff.js), so the fixture does too */
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const OTHER_TOKEN = `other.${Buffer.from(JSON.stringify({ sub: OTHER_USER, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.sig`;
const OTHER_SESSION = `other-platform.${Buffer.from(JSON.stringify({ sub: OTHER_USER, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.sig`;
const LINE = `McCluster now lives at ${SITE.platform.host}. If you were signed in before, you still are; if not, sign in once here.`;
const results = [];
/* a tap on a control that may be missing: null when tapped, else what stopped it (a missing control is a failed check,
   not a crash, so every later scenario still reports) */
const tap = (page, selector) => page.click(selector, { timeout: 5000 }).then(() => null, (e) => String((e && e.message) || e).split('\n')[0]);
function check(scope, name, ok, detail) {
  results.push({ scope, name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${scope}] ${name}${ok || detail === undefined ? '' : ' :: ' + JSON.stringify(detail).slice(0, 600)}`);
}

const fetchOne = await localFetcher(SITE, { root: ROOT });
const served = [];     // every answer a site host gave: url, status, the framing headers
const api = { handoff: [], verify: [] };

async function routes(ctx) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.hostname === 'api.mccluster.org') {
      const h = await req.allHeaders();
      if (u.pathname === '/v1/auth/handoff' && req.method() === 'POST') {
        api.handoff.push({ origin: h.origin || '', authorization: h.authorization || '', url: req.url() });
        if (h.authorization === `Bearer ${OTHER_TOKEN}`) return json(route, { token_hash: 'th-other', type: 'magiclink' });
        return h.authorization === `Bearer ${HOUSE_TOKEN}` ? json(route, { token_hash: 'th-fixture', type: 'magiclink' }) : json(route, { error: 'sign in first' }, 401);
      }
      if (u.pathname === '/v1/status') return json(route, { error: 'House owner only' }, 403);
      return json(route, { ok: true, items: [], tracks: [], posts: [], events: [], missions: [], layers: [], features: [], sources: [], next_before: null });
    }
    if (u.hostname.endsWith('supabase.co')) {
      const h = await req.allHeaders();
      if (u.pathname === '/auth/v1/verify' && req.method() === 'POST') {
        const body = req.postDataJSON();
        api.verify.push({ origin: h.origin || '', body });
        if (body && body.token_hash === 'th-other') return json(route, { access_token: OTHER_SESSION, refresh_token: 'refresh-other', token_type: 'bearer', expires_in: 3600, user: { id: OTHER_USER } });
        return json(route, { access_token: PLATFORM_TOKEN, refresh_token: 'refresh-platform', token_type: 'bearer', expires_in: 3600, user: { id: USER } });
      }
      if (u.pathname === '/auth/v1/user') {
        if (h.authorization === `Bearer ${OTHER_SESSION}`) return json(route, { id: OTHER_USER, email: 'other-fixture@invalid.test' });
        return [HOUSE_TOKEN, PLATFORM_TOKEN].map((t) => `Bearer ${t}`).includes(h.authorization) ? json(route, { id: USER, email: 'carry-fixture@invalid.test' }) : json(route, { msg: 'no' }, 401);
      }
      if (u.pathname === '/auth/v1/token') return json(route, { access_token: HOUSE_TOKEN, refresh_token: 'refresh-house', token_type: 'bearer', expires_in: 3600, user: { id: USER } });
      return json(route, []);
    }
    if (u.origin === FOREIGN) {
      const src = u.searchParams.get('frame') || `${PLAT}/embed.html?album=here`;
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><title>Someone else's page</title><p>An embed:</p><iframe id="embed" src="${src}" width="360" height="420"></iframe>` });
    }
    if (SITE.hostRole(u.hostname)) {
      if (!['GET', 'HEAD'].includes(req.method())) return route.fulfill({ status: 405, body: '' });
      let res;
      try { res = await fetchOne(u.href); } catch (e) { return route.abort(); }
      const headers = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      served.push({ url: u.href, status: res.status, csp: headers['content-security-policy'] || null, xfo: headers['x-frame-options'] || null, type: req.resourceType() });
      /* a fulfilled redirect is followed by Chromium's own network stack, outside interception: a document's is walked here
         as a navigation the routes see (scripts/e2e/human-uprise-door.e2e.mjs does the same) */
      if (res.status >= 300 && res.status < 400 && headers.location && req.resourceType() === 'document') {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: `<!doctype html><script>location.replace(${JSON.stringify(headers.location)})</script>` });
      }
      return route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
    }
    return route.abort();
  });
}

const LAUNCH_ARGS = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'];
/* Chromium partitions a frame's storage by the top-level site (SPEC-PLATFORM 2.6 measured it so; risk 3 counts on it).
   Playwright launches Chromium with ThirdPartyStoragePartitioning in its own default --disable-features list
   (playwright issue 32230), so a plain launch runs unpartitioned. The list is read from the launch Playwright makes
   with these options, that one feature is taken out, and the rest is passed as it was. */
const PARTITIONING_OFF = 'ThirdPartyStoragePartitioning';
async function launchPartitioned() {
  const options = process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME, args: LAUNCH_ARGS } : { args: LAUNCH_ARGS };
  const probe = await chromium.launchServer(options);
  const defaults = probe.process().spawnargs.filter((a) => a.startsWith('--disable-features='));
  await probe.close();
  const rest = defaults.flatMap((a) => a.slice('--disable-features='.length).split(',')).filter((f) => f && f !== PARTITIONING_OFF);
  return { defaults, rest, browser: await chromium.launch({ ...options, ignoreDefaultArgs: defaults, args: [...LAUNCH_ARGS, ...(rest.length ? ['--disable-features=' + rest.join(',')] : [])] }) };
}
const launched = await launchPartitioned();
const browser = launched.browser;
check('launch', `Chromium ${browser.version()} runs with storage partitioning (Playwright's default list had it ${launched.defaults.some((a) => a.includes(PARTITIONING_OFF)) ? 'off; taken out' : 'on already'})`, !launched.rest.includes(PARTITIONING_OFF), launched.rest);
async function open({ memberOn = '', standalone = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  ctx.setDefaultTimeout(20000);
  await ctx.addInitScript(({ memberOn, token, standalone }) => {
    if (standalone) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    try {
      localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
      localStorage.setItem('mnet_tour_seen', '1');
      sessionStorage.setItem('mcc_premiere', '1');
      /* signed in on one host only, in its own first-party storage (a top-level visit; never inside a frame, so a frame
         reads only what the browser lets it read): the other earns its own session */
      if (memberOn && window.top === window && location.origin === memberOn && !localStorage.getItem('mccdb_session')) {
        localStorage.setItem('mccdb_session', JSON.stringify({ access_token: token, refresh_token: 'refresh-house', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
      }
    } catch (e) { /* a frame without storage */ }
  }, { memberOn, token: HOUSE_TOKEN, standalone });
  await routes(ctx);
  const requests = [];
  ctx.on('request', (r) => requests.push(r.url()));
  const page = await ctx.newPage();
  const navigations = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, requests, navigations, errors };
}
const session = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('mccdb_session') || 'null'); } catch { return null; } });
const mark = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('mcc_carry_v1') || 'null'); } catch { return null; } });
const signedIn = (page) => page.evaluate(() => document.body.classList.contains('mcc-auth-in'));
const fits = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
const carryFrames = (requests) => requests.filter((u) => new URL(u).pathname === '/carry.html');
const secretIn = (list) => list.filter((u) => u.includes(HOUSE_TOKEN) || u.includes(PLATFORM_TOKEN) || /mcc_handoff|access_token|token_hash/.test(u));

await mkdir(OUT, { recursive: true });
try {
  /* ---------- 1. a member signed in on Matthew's host opens the platform ---------- */
  {
    const S = 'carry-signed-in';
    const { ctx, page, requests, navigations, errors } = await open({ memberOn: PROF });
    await page.goto(`${PROF}/listen.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.classList.contains('mcc-auth-in'), null, { timeout: 20000 }).catch(() => {});
    check(S, 'signed in on Matthew\'s host', await signedIn(page) && (await session(page))?.access_token === HOUSE_TOKEN);
    const barOf = () => page.evaluate(() => ({ music: document.querySelector('.appbar [data-appnav="music"]')?.href, home: document.querySelector('.appbar [data-appnav="home"]')?.href, world: document.querySelector('.appbar [data-appnav="world"]')?.href }));
    /* standing on his own Listen the Music tab is this page (pageOrHere in js/tabbar.js): the player's own Play and Pause,
       never a load of the platform's copy of the page, which would stop the song */
    const onListen = await barOf();
    check(S, 'on his own Listen the Music tab is this page, the Globe points at the platform and the M at his own root', onListen.music === `${PROF}/listen.html` && onListen.world === `${PLAT}/?view=feed` && onListen.home === `${PROF}/index.html`, onListen);
    /* CHANGED ON PURPOSE (the P1 amendment of 2026-11-24, SPEC-PLATFORM 4; review VP1-3): this said Music pointed at the
       platform's Listen from his other pages. A tap to another origin is a page load, which ends a song playing on his
       album or artist page (P0 opened Listen over it as a view and the song kept going). Matthew: "We must prepare
       without breaking anything to do that" and "I want a singular fucking music engine with 1 fucking player at all
       times". So until P3 Music stays on his host, from every page there, the HERE front door his host opens on among
       them; the Globe was already the platform's World at P0 and stays so */
    await page.goto(`${PROF}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.appbar [data-appnav="music"]', { timeout: 10000 }).catch(() => {});
    const bar = await barOf();
    check(S, 'on his host the bar keeps Music on his host until P3, points the Globe at the platform\'s World and the M at his own root', bar.music === `${PROF}/listen.html` && bar.world === `${PLAT}/?view=feed` && bar.home === `${PROF}/index.html`, bar);
    await page.goto(`${PLAT}/listen.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!localStorage.getItem('mcc_carry_v1'), null, { timeout: 20000 }).catch(() => {});
    await page.waitForFunction(() => document.body.classList.contains('mcc-auth-in'), null, { timeout: 20000 }).catch(() => {});
    const here = await session(page);
    check(S, 'the platform is signed in after one carry, with a session of its own', await signedIn(page) && here?.access_token === PLATFORM_TOKEN && here?.refresh_token === 'refresh-platform', here && { access: here.access_token === PLATFORM_TOKEN, refresh: here.refresh_token });
    check(S, 'the mark records the carry', (await mark(page))?.result === 'carried', await mark(page));
    check(S, 'the token crossed once, as a bearer header from the platform\'s own origin, to the existing POST /v1/auth/handoff',
      api.handoff.length === 1 && api.handoff[0].origin === PLAT && api.handoff[0].authorization === `Bearer ${HOUSE_TOKEN}` && !secretIn([api.handoff[0].url]).length, api.handoff.map((h) => ({ origin: h.origin, bearer: h.authorization === `Bearer ${HOUSE_TOKEN}` })));
    check(S, 'Supabase turned the one-time token into the platform\'s session', api.verify.length === 1 && api.verify[0].body?.type === 'magiclink' && api.verify[0].body?.token_hash === 'th-fixture', api.verify);
    check(S, 'the frame asked was his host\'s carry page, at its exact address, and it is gone', carryFrames(requests).length === 1 && carryFrames(requests)[0] === `${PROF}/carry.html` && await page.evaluate(() => !document.querySelector('iframe[title="Sign-in carry"]')), carryFrames(requests));
    check(S, 'no request URL holds a token', secretIn(requests).length === 0, secretIn(requests).map((u) => u.replace(HOUSE_TOKEN, '<house>').replace(PLATFORM_TOKEN, '<platform>')));
    check(S, 'no history entry holds a token', secretIn(navigations).length === 0 && !secretIn([await page.evaluate(() => location.href)]).length, navigations);
    const chip = await page.evaluate(() => (document.querySelector('#mccAuthChip .mcc-auth-chip__text') || {}).textContent);
    check(S, 'the account chip says the member is in', chip === 'Profile', chip);
    const pb = await page.evaluate(() => ({ music: document.querySelector('.appbar [data-appnav="music"]')?.href, home: document.querySelector('.appbar [data-appnav="home"]')?.href, world: document.querySelector('.appbar [data-appnav="world"]')?.href }));
    check(S, 'on the platform the bar is local: Music listen.html, the M index.html, the Globe its root', pb.music === `${PLAT}/listen.html` && pb.home === `${PLAT}/index.html` && pb.world === `${PLAT}/?view=feed`, pb);
    check(S, 'nothing scrolls sideways at 390', (await fits(page)).sw === (await fits(page)).cw, await fits(page));
    await page.screenshot({ path: join(OUT, 'carried-listen-390.png') });
    /* asked once: a reload signs in from the stored session and frames nothing */
    const before = carryFrames(requests).length;
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.body.classList.contains('mcc-auth-in'), null, { timeout: 20000 }).catch(() => {});
    check(S, 'a later page asks nothing: signed in from its own session', await signedIn(page) && carryFrames(requests).length === before && api.handoff.length === 1);
    /* the old host is left as it was */
    await page.goto(`${PROF}/listen.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.body.classList.contains('mcc-auth-in'), null, { timeout: 20000 }).catch(() => {});
    check(S, 'Matthew\'s host is still signed in, with its own session', await signedIn(page) && (await session(page))?.access_token === HOUSE_TOKEN && (await session(page))?.refresh_token === 'refresh-house');
    check(S, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---------- 1b. a guest on his album: the bar's Music and the account chip stay on his host until P3 ---------- */
  {
    /* the P1 amendment of 2026-11-24 (review VP1-3): a door to another origin is a page load, which would end the song
       his album plays; his host's own Listen and account page open over the album as views (scripts/e2e/music-shell.e2e.mjs
       plays the song through them). On the platform nothing changes: everything stays there (scenario 2 below). */
    const S = 'his-host-bar';
    const { ctx, page, errors } = await open();
    await page.goto(`${PROF}/album.html?album=here`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!document.getElementById('mccAuthChip'), null, { timeout: 15000 }).catch(() => {});
    const links = await page.evaluate(() => ({ music: document.querySelector('.appbar [data-appnav="music"]')?.href, home: document.querySelector('.appbar [data-appnav="home"]')?.href,
      world: document.querySelector('.appbar [data-appnav="world"]')?.href, chip: (document.getElementById('mccAuthChip') || {}).href,
      house: window.MCC_BAR && window.MCC_BAR.navigation && window.MCC_BAR.navigation.house }));
    check(S, 'on his album the Music tab is his own Listen and the signed-out chip his own account page', links.music === `${PROF}/listen.html` && links.chip === `${PROF}/account.html`, links);
    check(S, 'the Globe is the platform\'s World and the M his own root, as at P0', links.world === `${PLAT}/?view=feed` && links.home === `${PROF}/index.html`, links);
    check(S, 'the bar\'s house (the installed dock opens the player there) is his own host', links.house === `${PROF}/`, links.house);
    check(S, 'no carry on his host: he is the one asked, never the asker', await page.evaluate(() => !document.querySelector('script[data-mcc-carry]') && !window.MCC_CARRY));
    check(S, 'nothing scrolls sideways at 390', (await fits(page)).sw === (await fits(page)).cw, await fits(page));
    check(S, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---------- 2. nothing to carry: one clear line, for 30 days, asked once ---------- */
  {
    const S = 'carry-nothing';
    const { ctx, page, requests, errors } = await open();
    await page.goto(`${PLAT}/account.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!localStorage.getItem('mcc_carry_v1'), null, { timeout: 20000 }).catch(() => {});
    check(S, 'the carry found nothing and says so in its mark', (await mark(page))?.result === 'none', await mark(page));
    await page.waitForSelector('#mccCarryLine', { timeout: 10000 }).catch(() => {});
    const line = await page.evaluate(() => { const n = document.getElementById('mccCarryLine'); return n && { text: n.textContent, visible: !!(n.offsetWidth || n.offsetHeight), inPane: !!n.closest('#acSignInPane') }; });
    check(S, 'the sign-in page shows the one clear line', line && line.text === LINE && line.visible && line.inPane, line);
    await page.waitForFunction(() => !!document.getElementById('mccAuthChip'), null, { timeout: 10000 }).catch(() => {});
    const chip = await page.evaluate(() => { const c = document.getElementById('mccAuthChip'); const d = c && c.getAttribute('aria-describedby'); return c && { title: c.getAttribute('title'), described: d && (document.getElementById(d) || {}).textContent }; });
    check(S, 'the account chip carries the same line', chip && chip.title === LINE && chip.described === LINE, chip);
    /* on the sign-in page the pane says it: the note under the chip waits hidden, so the screen says it once */
    check(S, 'on the sign-in page the line is said once, in the pane', await page.evaluate(() => { const n = document.getElementById('mccCarryNote'); return !n || n.hidden || getComputedStyle(n).display === 'none'; }));
    check(S, 'nobody was signed in and no token was asked for', !(await signedIn(page)) && api.handoff.length === 1 && api.verify.length === 1);
    check(S, 'nothing scrolls sideways at 390', (await fits(page)).sw === (await fits(page)).cw, await fits(page));
    await page.screenshot({ path: join(OUT, 'nothing-carried-account-390.png') });
    const asked = carryFrames(requests).length;
    await page.goto(`${PLAT}/listen.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const c = document.getElementById('mccAuthChip'); return !!(c && c.getAttribute('title')); }, null, { timeout: 15000 }).catch(() => {});
    check(S, 'the next page asks nothing and still says the line on the chip', carryFrames(requests).length === asked && asked === 1 &&
      await page.evaluate((line) => (document.getElementById('mccAuthChip') || {}).title === line, LINE));
    /* SPEC-PLATFORM 2.6.5 on a phone (review VP1-2): a title is never seen on a touch screen, so the chip shows the line
       under itself, visibly, at 390 and at 320, with nothing scrolling sideways; its close is a 44 px target at 16 px or
       more; closed, it stays closed, and the chip keeps the line as its title and description for the rest of the 30 days */
    const noteAt = () => page.evaluate(() => {
      const n = document.getElementById('mccCarryNote'), chipEl = document.getElementById('mccAuthChip');
      if (!n || !chipEl) return null;
      const r = n.getBoundingClientRect(), cs = getComputedStyle(n), c = chipEl.getBoundingClientRect();
      const x = n.querySelector('button'), xr = x && x.getBoundingClientRect();
      return { text: (document.getElementById('mccCarryNoteText') || {}).textContent, hidden: n.hidden, display: cs.display, visibility: cs.visibility, opacity: Number(cs.opacity),
        box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], vw: innerWidth, vh: innerHeight, chipBottom: Math.round(c.bottom),
        close: xr && { w: Math.round(xr.width), h: Math.round(xr.height), font: parseFloat(getComputedStyle(x).fontSize), name: x.getAttribute('aria-label') } };
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => { const n = document.getElementById('mccCarryNote'); return !!n && !n.hidden; }, null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(300);
      const seen = await noteAt();
      const shown = !!seen && seen.text === LINE && !seen.hidden && seen.display !== 'none' && seen.visibility === 'visible' && seen.opacity > 0.5 &&
        seen.box[2] - seen.box[0] > 0 && seen.box[3] - seen.box[1] > 0 && seen.box[0] >= 0 && seen.box[2] <= seen.vw && seen.box[3] <= seen.vh && seen.box[1] >= seen.chipBottom;
      check(S, `${width} px: the chip shows the one line under itself, inside the screen`, shown, seen);
      check(S, `${width} px: its close is a 44 px target, 16 px or more, named for what it does`, !!seen && !!seen.close && seen.close.w >= 44 && seen.close.h >= 44 && seen.close.font >= 16 && /close/i.test(seen.close.name || ''), seen && seen.close);
      check(S, `${width} px: nothing scrolls sideways`, (await fits(page)).sw === (await fits(page)).cw, await fits(page));
      await page.screenshot({ path: join(OUT, `chip-line-${width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const closeTap = await tap(page, '#mccCarryNote button');
    check(S, 'the note under the chip has its close', closeTap === null, closeTap);
    check(S, 'closed, the line under the chip goes', await page.evaluate(() => { const n = document.getElementById('mccCarryNote'); return !n || n.hidden || getComputedStyle(n).display === 'none'; }));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => { const c = document.getElementById('mccAuthChip'); return !!(c && c.getAttribute('title')); }, null, { timeout: 15000 }).catch(() => {});
    check(S, 'and stays closed on the next page, while the chip keeps the line as its title', await page.evaluate((line) => { const n = document.getElementById('mccCarryNote'); return (!n || n.hidden) && (document.getElementById('mccAuthChip') || {}).title === line; }, LINE));
    /* after 30 days the line is gone */
    await page.evaluate(() => localStorage.setItem('mcc_carry_v1', JSON.stringify({ v: 1, result: 'none', at: new Date(Date.now() - 31 * 864e5).toISOString() })));
    await page.goto(`${PLAT}/account.html`, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    check(S, 'after 30 days nothing is said', await page.evaluate(() => !document.getElementById('mccCarryLine') && !(document.getElementById('mccAuthChip') || {}).title));
    check(S, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---------- 3. embed.html on another site ---------- */
  {
    const S = 'embed-foreign';
    const { ctx, page, errors } = await open();
    await page.goto(`${FOREIGN}/`, { waitUntil: 'load' });
    const frame = await (await page.waitForSelector('#embed')).contentFrame();
    await frame.waitForLoadState('load').catch(() => {});
    const inside = await frame.evaluate(() => ({ href: location.href, title: document.title, body: document.body ? document.body.innerText.length : 0 })).catch((e) => ({ error: String(e.message || e) }));
    const head = served.filter((s) => s.url.startsWith(`${PLAT}/embed.html`)).at(-1);
    check(S, 'the platform answers embed.html with no frame restriction', head && head.status === 200 && head.csp === 'frame-ancestors *' && head.xfo === null, head);
    check(S, 'and it renders inside a page of a foreign origin', inside && inside.href === `${PLAT}/embed.html?album=here` && inside.body > 0, inside);
    await page.screenshot({ path: join(OUT, 'embed-foreign-390.png') });
    /* the control: a page that is not the embed is refused a frame there */
    await page.goto(`${FOREIGN}/?frame=${encodeURIComponent(`${PLAT}/listen.html`)}`, { waitUntil: 'load' });
    const other = await (await page.waitForSelector('#embed')).contentFrame();
    await page.waitForTimeout(800);
    const blocked = await other.evaluate(() => location.href).catch(() => 'not reachable');
    check(S, 'a page that is not the embed does not render inside another site', blocked !== `${PLAT}/listen.html`, blocked);
    check(S, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---------- 4. the World over Music on the platform is the platform's own origin ---------- */
  {
    const S = 'world-over-music';
    const { ctx, page, errors } = await open();
    await page.goto(`${PLAT}/listen.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MCC_WORLD_AUDIO && !!window.MCC_BAR && !!window.MCC_MUSIC, null, { timeout: 20000 });
    await page.locator('.appbar [data-appnav="world"]').click();
    await page.waitForFunction(() => { const f = document.getElementById('mccWorldAudioFrame'); return !!(f && f.getAttribute('src')); }, null, { timeout: 20000 }).catch(() => {});
    const src = await page.evaluate(() => (document.getElementById('mccWorldAudioFrame') || {}).getAttribute?.('src') || null);
    const frame = await (await page.$('#mccWorldAudioFrame'))?.contentFrame();
    if (frame) await frame.waitForLoadState('domcontentloaded').catch(() => {});
    const same = frame ? await frame.evaluate(() => ({ origin: location.origin, parent: window.parent.location.origin })).catch((e) => ({ error: String(e.message || e) })) : null;
    check(S, 'from Music on the platform the Globe opens the World over the page, at the platform\'s root', /\/listen\.html\?world=1$/.test(page.url()) && !!src && new URL(src).origin === PLAT && new URL(src).pathname === '/' && !/mcc_handoff/.test(src), { url: page.url(), src });
    check(S, 'the World\'s frame is the same origin as Music (the frame reads its parent)', same && same.origin === PLAT && same.parent === PLAT, same);
    check(S, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }

  /* ---------- 5. the installed app's move card ---------- */
  {
    const S = 'move-card';
    const app = await open({ standalone: true });
    await app.page.goto(`${PROF}/index.html`, { waitUntil: 'load' });
    await app.page.waitForSelector('#mccAppMoved', { timeout: 15000 }).catch(() => {});
    const card = await app.page.evaluate(() => { const c = document.getElementById('mccAppMoved'); return c && { text: c.innerText, cls: c.className, go: (c.querySelector('.dk-peek__go') || {}).textContent }; });
    check(S, 'Matthew\'s installed app shows the card on launch', card && /The app now lives at mccluster\.org\./i.test(card.text) && /add it to your Home Screen; your sign-in and kept songs come with you\./.test(card.text) && card.cls === 'dk-peek' && card.go === `Open ${SITE.platform.host}`, card);
    check(S, 'nothing scrolls sideways at 390', (await fits(app.page)).sw === (await fits(app.page)).cw, await fits(app.page));
    await app.page.screenshot({ path: join(OUT, 'move-card-390.png') });
    await app.page.reload({ waitUntil: 'load' });
    await app.page.waitForFunction(() => !!window.MCC_BAR, null, { timeout: 15000 }).catch(() => {});
    await app.page.waitForTimeout(800);
    check(S, 'once: the next launch shows no card', await app.page.evaluate(() => !document.getElementById('mccAppMoved')));
    check(S, 'no page errors', app.errors.length === 0, app.errors);
    await app.ctx.close();
    for (const [label, opts, url] of [['the platform\'s own app', { standalone: true }, `${PLAT}/index.html`], ['his host in a browser tab', {}, `${PROF}/index.html`]]) {
      const o = await open(opts);
      await o.page.goto(url, { waitUntil: 'load' });
      await o.page.waitForFunction(() => !!window.MCC_BAR, null, { timeout: 15000 }).catch(() => {});
      await o.page.waitForTimeout(800);
      check(S, `no card for ${label}`, await o.page.evaluate(() => !document.getElementById('mccAppMoved')));
      await o.ctx.close();
    }
  }

  /* ---------- 6. Matthew's host still answers the installed app; the platform's manifest is its own ---------- */
  {
    const S = 'profile-host-files';
    const { ctx, page } = await open();
    await page.goto(`${PROF}/carry.html`, { waitUntil: 'load' });
    const his = await page.evaluate(async () => {
      const out = {};
      for (const p of ['/index.html', '/manifest.json', '/sw.js']) { const r = await fetch(p, { cache: 'no-store' }); out[p] = r.status; }
      out.start = (await (await fetch('/manifest.json', { cache: 'no-store' })).json()).start_url;
      return out;
    });
    check(S, 'Matthew\'s host answers his app\'s start page, manifest.json and sw.js', his['/index.html'] === 200 && his['/manifest.json'] === 200 && his['/sw.js'] === 200, his);
    check(S, 'his app still starts on his HERE page', his.start === './index.html', his.start);
    await page.goto(`${PLAT}/carry.html`, { waitUntil: 'load' });
    const plat = await page.evaluate(async () => {
      const r = await fetch('/manifest.json', { cache: 'no-store' });
      return { status: r.status, start: (await r.json()).start_url, sw: (await fetch('/sw.js', { cache: 'no-store' })).status };
    });
    check(S, 'the platform answers manifest.json and sw.js, and its app starts on the World', plat.status === 200 && plat.sw === 200 && plat.start === '/', plat);
    await ctx.close();
  }

  /* ---------- 7. a token in a link is never a way in; the carry page framed by another site sees nothing ---------- */
  {
    const S = 'link-token';
    const crafted = `${PLAT}/listen.html#mcc_handoff=${encodeURIComponent(OTHER_TOKEN)}`;
    const tradedOther = (from) => api.handoff.slice(from).filter((h) => h.authorization === `Bearer ${OTHER_TOKEN}`);
    /* R1: a guest */
    {
      const from = api.handoff.length;
      const { ctx, page, errors } = await open();
      await page.goto(crafted, { waitUntil: 'load' });
      await page.waitForFunction(() => !!localStorage.getItem('mcc_carry_v1'), null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      check(S, 'a guest who opens a platform link holding another account\'s token sends that token nowhere', tradedOther(from).length === 0, tradedOther(from).map((h) => h.origin));
      const held = await session(page);
      check(S, 'and is signed in as nobody: no session was stored', !held && !(await signedIn(page)), held && { access: held.access_token === OTHER_SESSION ? '<the link\'s account>' : 'another' });
      check(S, 'the token is scrubbed from the address', !/mcc_handoff/.test(await page.evaluate(() => location.href)), await page.evaluate(() => location.href.replace(/mcc_handoff=[^&]*/, 'mcc_handoff=<token>')));
      check(S, 'the carry still asked his host once, and found nothing', (await mark(page))?.result === 'none', await mark(page));
      check(S, 'no page errors (guest)', errors.length === 0, errors);
      await ctx.close();
    }
    /* R2: a member signed in on Matthew's host opens the same link */
    {
      const from = api.handoff.length;
      const { ctx, page, errors } = await open({ memberOn: PROF });
      await page.goto(`${PROF}/listen.html`, { waitUntil: 'load' });
      await page.waitForFunction(() => document.body.classList.contains('mcc-auth-in'), null, { timeout: 20000 }).catch(() => {});
      await page.goto(crafted, { waitUntil: 'load' });
      await page.waitForFunction(() => !!localStorage.getItem('mcc_carry_v1'), null, { timeout: 20000 }).catch(() => {});
      await page.waitForFunction(() => document.body.classList.contains('mcc-auth-in'), null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const held = await session(page);
      check(S, 'a member signed in on his host who opens it is signed in as themselves, by the carry', held?.access_token === PLATFORM_TOKEN && (await mark(page))?.result === 'carried', { session: held ? (held.access_token === PLATFORM_TOKEN ? 'own' : held.access_token === OTHER_SESSION ? '<the link\'s account>' : 'other') : null, mark: await mark(page) });
      check(S, 'and the link\'s token was sent nowhere', tradedOther(from).length === 0 && api.handoff.slice(from).every((h) => h.authorization === `Bearer ${HOUSE_TOKEN}` && h.origin === PLAT), api.handoff.slice(from).map((h) => ({ origin: h.origin, own: h.authorization === `Bearer ${HOUSE_TOKEN}` })));
      check(S, 'no page errors (member)', errors.length === 0, errors);
      /* the carry page framed by another site reads that site's own partition of his host's storage: empty */
      await page.goto(`${FOREIGN}/?frame=${encodeURIComponent(`${PROF}/carry.html`)}`, { waitUntil: 'load' });
      const frame = await (await page.waitForSelector('#embed')).contentFrame();
      await frame.waitForLoadState('load').catch(() => {});
      const inside = await frame.evaluate(() => { try { return { origin: location.origin, stored: localStorage.getItem('mccdb_session') }; } catch (e) { return { origin: location.origin, blocked: String(e && e.message || e) }; } }).catch((e) => ({ error: String(e.message || e) }));
      check(S, 'his carry page framed by another site sees an empty partition, not his host\'s session', inside && inside.origin === PROF && !inside.error && !inside.stored, inside && { origin: inside.origin, stored: inside.stored ? '<a session>' : inside.stored, blocked: inside.blocked, error: inside.error });
      await page.goto(`${PROF}/carry.html`, { waitUntil: 'load' });
      check(S, 'while his host itself still holds it', (await session(page))?.access_token === HOUSE_TOKEN);
      await ctx.close();
    }
  }

  /* ---------- 8. songs kept at the old address are offered once on the platform, and kept there on a tap ---------- */
  {
    /* SPEC-PLATFORM 2.7 (review VP1-1): the move card promises "your sign-in and kept songs come with you". His host's
       vault (the cache the album's "Keep the masters" fills, js/label.js) holds two songs and a song's lyrics; the
       platform says one line in the bar's own card and keeps the same files at the same paths on a tap */
    const S = 'kept-songs';
    const KEPT_FILES = ['/assets/audio/got-wifi.mp3', '/assets/audio/iot.mp3', '/data/lyrics/iot.json'];
    const { ctx, page, errors } = await open();
    await page.goto(`${PROF}/carry.html`, { waitUntil: 'load' });
    await page.evaluate(async (files) => { const c = await caches.open('mcc-vault-v1'); await c.addAll(files); }, KEPT_FILES);
    const vaultOf = () => page.evaluate(async () => (await (await caches.open('mcc-vault-v1')).keys()).map((r) => new URL(r.url).pathname).sort());
    check(S, 'his host keeps two songs and a song\'s lyrics', JSON.stringify(await vaultOf()) === JSON.stringify([...KEPT_FILES].sort()), await vaultOf());
    await page.goto(`${PLAT}/listen.html`, { waitUntil: 'load' });
    await page.waitForSelector('#mccKeptOffer', { timeout: 20000 }).catch(() => {});
    const LINE_KEPT = 'You kept 2 songs at the old address. Keep them here too?';
    const offerAt = () => page.evaluate(() => {
      const c = document.getElementById('mccKeptOffer');
      if (!c) return null;
      const r = c.getBoundingClientRect(), line = c.querySelector('[role="status"]');
      const btns = [...c.querySelectorAll('button')].filter((b) => !b.hidden).map((b) => { const q = b.getBoundingClientRect(); return { text: b.textContent, w: Math.round(q.width), h: Math.round(q.height), font: parseFloat(getComputedStyle(b).fontSize) }; });
      return { cls: c.className, line: line && line.textContent, box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], vw: innerWidth, vh: innerHeight, btns };
    });
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(300);
      const o = await offerAt();
      check(S, `${width} px: the platform says the one line, in the bar's own card, inside the screen`, !!o && o.line === LINE_KEPT && o.cls === 'dk-peek' &&
        o.box[0] >= 0 && o.box[2] <= o.vw && o.box[1] >= 0 && o.box[3] <= o.vh, o);
      check(S, `${width} px: Keep them here and Not now are 44 px targets at 16 px or more`, !!o && o.btns.length === 2 && o.btns.every((b) => b.w >= 44 && b.h >= 44 && b.font >= 16) &&
        o.btns[0].text === 'Keep them here' && o.btns[1].text === 'Not now', o && o.btns);
      check(S, `${width} px: nothing scrolls sideways`, (await fits(page)).sw === (await fits(page)).cw, await fits(page));
      await page.screenshot({ path: join(OUT, `kept-songs-${width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const keepTap = await tap(page, '#mccKeptOffer .dk-peek__go');
    check(S, 'Keep them here can be tapped', keepTap === null, keepTap);
    await page.waitForFunction(() => /here too\.$|did not download\.$/.test(((document.querySelector('#mccKeptOffer [role="status"]') || {}).textContent) || ''), null, { timeout: 30000 }).catch(() => {});
    const done = await offerAt();
    check(S, 'a tap keeps them and says so', !!done && done.line === 'Kept 2 songs here too.', done);
    check(S, 'the platform\'s vault holds the same files at the same paths', JSON.stringify(await vaultOf()) === JSON.stringify([...KEPT_FILES].sort()), await vaultOf());
    check(S, 'asked once: the offer is gone from storage', await page.evaluate(() => localStorage.getItem('mcc_carry_kept_v1') === null));
    const doneTap = await tap(page, '#mccKeptOffer .dk-peek__alt');
    check(S, 'Done can be tapped', doneTap === null, doneTap);
    check(S, 'Done closes the card', await page.evaluate(() => !document.getElementById('mccKeptOffer')));
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(1500);
    check(S, 'the next page offers nothing', await page.evaluate(() => !document.getElementById('mccKeptOffer')));
    await page.goto(`${PROF}/carry.html`, { waitUntil: 'load' });
    check(S, 'his host keeps its copies', JSON.stringify(await vaultOf()) === JSON.stringify([...KEPT_FILES].sort()), await vaultOf());
    check(S, 'no page errors', errors.length === 0, errors);
    await ctx.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
await writeFile(join(OUT, 'report.json'), JSON.stringify({ stage: SITE.stage, results, handoff: api.handoff.map((h) => ({ origin: h.origin, bearer_is_house_token: h.authorization === `Bearer ${HOUSE_TOKEN}` })), verify: api.verify.length, served: served.length }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed at stage ${SITE.stage}. Screenshots and report in ${OUT}`);
process.exit(failed.length ? 1 : 0);
