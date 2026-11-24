/* THE CARRY, IN A REAL BROWSER (SPEC-PLATFORM 2.6 to 2.8 and the P1 acceptance of section 4).
   ============================================================
   Chromium, with its default storage partitioning, and every host of the site answered as P1 answers it: the platform
   (https://mccluster.org) by Worker mccluster's own site router run in-process, as workers/mccluster/src/entry-platform.js
   composes it, over this checkout's published files; Matthew's host (https://matthew.mccluster.org) by a model of GitHub
   Pages over the same files (it is not routed to the Worker until P3); the API and Supabase by fixtures that record what
   they were sent. Nothing here reaches production. Scenarios:

   1. Signed in on Matthew's host, a member opens the platform: one carry (a hidden same-site frame of his host's
      carry.html, the existing POST /v1/auth/handoff as a bearer header, Supabase's one-time token) signs the platform in.
      No request URL and no history entry holds a token; his host stays signed in; the carry asks once. On his host the
      bar points Music and the Globe at the platform, except that on his own Listen the Music tab is that page itself.
   2. Nothing to carry: the platform says one clear line on the sign-in page and on the account chip, for 30 days, and
      does not ask again.
   3. embed.html on the platform renders inside a page of a foreign origin; a page that is not the embed does not.
   4. The World opened over Music on the platform is a frame of the platform's own origin.
   5. The installed app's move card shows once, on Matthew's host in standalone mode only.
   6. Matthew's host still answers the installed app's start page, manifest.json and sw.js; the platform's manifest starts
      its own app on the World.

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
const LINE = `McCluster now lives at ${SITE.platform.host}. If you were signed in before, you still are; if not, sign in once here.`;
const results = [];
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
        return h.authorization === `Bearer ${HOUSE_TOKEN}` ? json(route, { token_hash: 'th-fixture', type: 'magiclink' }) : json(route, { error: 'sign in first' }, 401);
      }
      if (u.pathname === '/v1/status') return json(route, { error: 'House owner only' }, 403);
      return json(route, { ok: true, items: [], tracks: [], posts: [], events: [], missions: [], layers: [], features: [], sources: [], next_before: null });
    }
    if (u.hostname.endsWith('supabase.co')) {
      const h = await req.allHeaders();
      if (u.pathname === '/auth/v1/verify' && req.method() === 'POST') {
        api.verify.push({ origin: h.origin || '', body: req.postDataJSON() });
        return json(route, { access_token: PLATFORM_TOKEN, refresh_token: 'refresh-platform', token_type: 'bearer', expires_in: 3600, user: { id: USER } });
      }
      if (u.pathname === '/auth/v1/user') return [HOUSE_TOKEN, PLATFORM_TOKEN].map((t) => `Bearer ${t}`).includes(h.authorization) ? json(route, { id: USER, email: 'carry-fixture@invalid.test' }) : json(route, { msg: 'no' }, 401);
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
const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME, args: LAUNCH_ARGS } : { args: LAUNCH_ARGS });
async function open({ memberOn = '', standalone = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
  ctx.setDefaultTimeout(20000);
  await ctx.addInitScript(({ memberOn, token, standalone }) => {
    if (standalone) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    try {
      localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
      localStorage.setItem('mnet_tour_seen', '1');
      sessionStorage.setItem('mcc_premiere', '1');
      /* signed in on one host only: the other earns its own session */
      if (memberOn && location.origin === memberOn && !localStorage.getItem('mccdb_session')) {
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
    /* from his other pages, the HERE front door his host opens on among them, Music points at the platform's Listen */
    await page.goto(`${PROF}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.appbar [data-appnav="music"]', { timeout: 10000 }).catch(() => {});
    const bar = await barOf();
    check(S, 'on his host the bar points Music and the Globe at the platform and the M at his own root', bar.music === `${PLAT}/listen.html` && bar.world === `${PLAT}/?view=feed` && bar.home === `${PROF}/index.html`, bar);
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
    check(S, 'nobody was signed in and no token was asked for', !(await signedIn(page)) && api.handoff.length === 1 && api.verify.length === 1);
    check(S, 'nothing scrolls sideways at 390', (await fits(page)).sw === (await fits(page)).cw, await fits(page));
    await page.screenshot({ path: join(OUT, 'nothing-carried-account-390.png') });
    const asked = carryFrames(requests).length;
    await page.goto(`${PLAT}/listen.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => { const c = document.getElementById('mccAuthChip'); return !!(c && c.getAttribute('title')); }, null, { timeout: 15000 }).catch(() => {});
    check(S, 'the next page asks nothing and still says the line on the chip', carryFrames(requests).length === asked && asked === 1 &&
      await page.evaluate((line) => (document.getElementById('mccAuthChip') || {}).title === line, LINE));
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
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
await writeFile(join(OUT, 'report.json'), JSON.stringify({ stage: SITE.stage, results, handoff: api.handoff.map((h) => ({ origin: h.origin, bearer_is_house_token: h.authorization === `Bearer ${HOUSE_TOKEN}` })), verify: api.verify.length, served: served.length }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed at stage ${SITE.stage}. Screenshots and report in ${OUT}`);
process.exit(failed.length ? 1 : 0);
