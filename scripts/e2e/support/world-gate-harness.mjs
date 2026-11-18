/* The shared harness of the door's two browser suites (scripts/e2e/world-gate.e2e.mjs and scripts/e2e/sign-in.e2e.mjs):
   the checkout served as it ships, a fake api.mccluster.org and Supabase in memory (no production call, no real sign-in),
   the real globe from CESIUM_DIR when there is one, and the measurements both suites take of the door: overflow,
   rectangles, the inert map, fonts, visible text and contrast measured from screenshot pixels with the glyphs masked.

   Fixtures are shaped like production on 2026-11-18: one open mission ("Give someone a free ride", mutual aid, 100 points),
   news from 183 countries in the last 24 hours (the story total capped), the Docket 516R archive as the repository holds it
   (data/action/docket-516r-archive.json), the World's public posts. Every request and console error is recorded. */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(import.meta.url);
export function loadChromium() {
  try { return require('playwright').chromium; }
  catch { return createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright').chromium; }
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain' };
export const SB = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co';
export const API = 'https://api.mccluster.org';

/* the checkout, as it ships. mnet.html carries the privacy notice's banner meta (the first-visit decision, owner 2026-11-17);
   a banner scenario adds it here, test-only, only if the page ever stops carrying it, so the banner is always what it tests */
export async function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^([.][.][/\\])+/, '');
    try {
      let body = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
      if (/mnet\.html$/.test(path) && /(?:^|[?&])wgbanner=1(?:&|$)/.test(url.search) && !/<meta name="mcc-privacy-notice" content="banner">/.test(String(body))) {
        body = Buffer.from(String(body).replace('<meta name="robots" content="noindex">', '<meta name="robots" content="noindex">\n  <meta name="mcc-privacy-notice" content="banner">'));
      }
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

/* ---------- fixtures ---------- */
export const ARCHIVE = JSON.parse(await readFile(join(ROOT, 'data/action/docket-516r-archive.json'), 'utf8'));
export const RIDE = '0e1f0000-0000-4000-8000-000000000001';
export function missionRow(id, title, domain, points, daysAgo) {
  return { id, title, description: 'Offer a ride to someone who needs one, and say where you took them.', domain, kind: 'civic', difficulty: 1, base_points: points, discovery_category: null, status: 'open', created_at: new Date(Date.now() - daysAgo * 864e5).toISOString() };
}
export const ONE_MISSION = [missionRow(RIDE, 'Give someone a free ride', 'mutual_aid', 100, 34)];
export const TWO_MISSIONS = [missionRow('0e1f0000-0000-4000-8000-000000000002', 'Plant a street tree', 'community', 25, 2), ONE_MISSION[0]];
export const MANY_MISSIONS = Array.from({ length: 500 }, (_, k) => missionRow(`0e1f0000-0000-4000-8000-${String(k + 10).padStart(12, '0')}`, `Fixture mission ${k + 1}`, 'community', 10, k + 1));
export function heat(kind) {
  if (kind === 'unavailable') return { ok: true, unavailable: true, countries: {} };
  if (kind === 'empty') return {};
  if (kind === 'single') return { ok: true, window_hours: 24, countries: { US: 1 }, total: 1, capped: false };
  if (kind === 'three') return { ok: true, window_hours: 24, countries: { US: 2, BR: 2, KE: 2 }, total: 6, capped: false, attribution: { name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' } };
  /* production on 2026-11-18: 183 countries, 12,296 stories, capped */
  const countries = {};
  for (let k = 0; k < 183; k++) countries[String.fromCharCode(65 + Math.floor(k / 26)) + String.fromCharCode(65 + (k % 26))] = 3 + (k % 7);
  countries.ZZ = 0;
  return { ok: true, window_hours: 24, countries, total: 12296, capped: true, attribution: { name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' } };
}
export const POSTS = [1, 2, 3, 4].map((k) => ({ item_type: 'post', post_id: `dddddddd-dddd-4ddd-8ddd-00000000000${k}`, occurred_at: new Date(Date.now() - k * 3600e3).toISOString(),
  actor: { m_uid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mccluster_id: 'fixture.ana', display_name: 'Fixture Ana' },
  post: { id: `dddddddd-dddd-4ddd-8ddd-00000000000${k}`, body: `Field note ${k}: what we did, what is next, and who can help.`, visibility: 'public', created_at: new Date(Date.now() - k * 3600e3).toISOString(), like_count: 0, liked_by_me: false, media_locked: 0 } }));
export const ME = { m_uid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'member@example.invalid' };

export const DEVICES = {
  390: { name: '390', viewport: { width: 390, height: 844 }, mobile: true },
  820: { name: '820', viewport: { width: 820, height: 1180 }, mobile: true },
  1280: { name: '1280', viewport: { width: 1280, height: 800 }, mobile: false },
  320: { name: '320', viewport: { width: 320, height: 640 }, mobile: true }
};
export const LAUNCH = { args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] };

/* A browser context with the fake backends and one page on the World.
   opts.phase: night | day. opts.missions: a list, or 'fail'. opts.heat: a heat() kind, '503' or 'timeout'. opts.archive: 'ok',
   'fail' (API 503, the static file serves), 'gone' (both fail), 'incomplete'. opts.settings: the auth settings answer.
   opts.token: 'ok' | 'invalid' | 'unconfirmed' | 'slow'. opts.signup: 'confirm' | 'session'. opts.member: a stored session and a
   bootstrap (next_step opts.nextStep). opts.reduced: prefers-reduced-motion. opts.banner: the privacy banner (no stored
   acknowledgement, the banner meta). opts.recordAuth: wrap MCC's auth calls so each call and its arguments are recorded
   (signInWithProvider is stubbed: it never leaves the page). opts.dpr: deviceScaleFactor (2 by default). opts.globe: false
   leaves the globe's library out even when CESIUM_DIR is set. */
export async function openWorld(browser, base, device, path, opts = {}) {
  const o = { phase: 'night', missions: ONE_MISSION, heat: 'production', archive: 'ok', settings: { external: { email: true } }, token: 'ok', signup: 'confirm', member: false, nextStep: null, reduced: false, banner: false, recordAuth: false, dpr: 2, ...opts };
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: device.viewport, deviceScaleFactor: o.dpr, isMobile: device.mobile, hasTouch: device.mobile, reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(({ banner, member, recordAuth, me }) => {
    /* the page's own storage; a frame with an opaque origin (no storage of its own) is left alone */
    try {
      if (!banner) localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
      localStorage.setItem('mnet_tour_seen', '1');
      if (member) {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        localStorage.setItem('mccdb_session', JSON.stringify({ access_token: 'x.' + btoa(JSON.stringify({ exp, sub: me })).replace(/=+$/, '') + '.y', refresh_token: 'fixture', expires_at: exp }));
      }
    } catch { /* no storage in this frame */ }
    /* every frame of the first seconds: did the door paint on the way in? (owner, 2026-10-20) */
    window.__doorFlash = 0;
    const tick = () => { const g = document.getElementById('mnSignedOut'); if (g && !g.hidden && g.getClientRects().length) window.__doorFlash++; if (performance.now() < 6000) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    if (recordAuth && window === window.top) {
      const calls = window.__authCalls = [];
      let real;
      Object.defineProperty(window, 'MCC', { configurable: true, enumerable: true, get() { return real; }, set(v) {
        real = v;
        ['signInWithPassword', 'signUpWithPassword', 'resendSignupVerification', 'requestPasswordReset', 'signInWithProvider'].forEach((name) => {
          const orig = v && v[name];
          if (typeof orig !== 'function') return;
          v[name] = function (...args) {
            calls.push({ name, args: JSON.parse(JSON.stringify(args)) });
            if (name === 'signInWithProvider') return Promise.resolve();
            return orig.apply(this, args);
          };
        });
      } });
    }
  }, { banner: o.banner, member: o.member, recordAuth: o.recordAuth, me: ME.m_uid });
  const world = { requests: [], auth: [], console: [], bad: [], errors: [], dialogs: [] };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  const frameOf = (req) => { try { const f = req.frame(); return f && f.parentFrame() ? 'globe' : 'main'; } catch { return 'main'; } };
  await ctx.route(API + '/**', async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    world.requests.push({ frame: frameOf(req), m: req.method(), host: 'api', p, q: u.search, at: Date.now() });
    if (p === '/v1/mnet/public-feed') return json(route, { items: POSTS, scope: 'public', next_before: null });
    if (p === '/v1/mnet/feed') return json(route, { items: POSTS, next_before: null });
    if (p === '/v1/mnet/bootstrap') return json(route, { identity: { m_uid: ME.m_uid, mccluster_id: o.nextStep === 'profile' ? null : 'fixture.member' }, profile: { display_name: o.nextStep === 'profile' ? '' : 'Fixture Member' }, next_step: o.nextStep, tour_done_at: new Date().toISOString() });
    if (p === '/v1/world/news') return json(route, { ok: true, items: [], next_before: null, attribution: { name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' } });
    if (p === '/v1/world/news-heat') {
      if (u.searchParams.get('country')) return json(route, { ok: true, cells: [], total: 0 });
      if (o.heat === '503') return json(route, { error: 'unavailable' }, 503);
      if (o.heat === 'timeout') { await new Promise((r) => setTimeout(r, 7000)); return json(route, heat('production')).catch(() => {}); }
      return json(route, heat(o.heat));
    }
    if (p === '/v1/action-archive/docket-516r-2025') {
      if (o.archive === 'fail' || o.archive === 'gone') return json(route, { error: 'unavailable' }, 503);
      if (o.archive === 'incomplete') return json(route, { ...ARCHIVE, project: { ...ARCHIVE.project, status: 'in_progress' } });
      return json(route, ARCHIVE);
    }
    /* the house owner check (js/tabbar.js): nobody here is the house owner */
    if (p === '/v1/status') return json(route, { error: 'Forbidden' }, 403);
    if (p === '/v1/world/place-scope') return json(route, { ok: true, enabled: false, country: null });
    if (p === '/v1/world/members') return json(route, { ok: true, unavailable: true, countries: {} });
    if (p === '/v1/world/access') return json(route, { release: { version: 'globe-admin-preview/v1', admin_preview: false }, level: 'public', unlocked_layers: [], locked_layers: [], layers: {} });
    if (p === '/v1/world/environment') return json(route, { ok: true, schema: 'world-environment/v1', sources: [], events: [], missions: [] });
    if (/^\/v1\/mnet\/people\//.test(p)) return json(route, { error: 'not found' }, 404);
    if (p === '/v1/mnet/profile') return json(route, { ok: true });
    return json(route, {});
  });
  await ctx.route(SB + '/**', async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    let body = null; try { body = req.postDataJSON(); } catch { body = null; }
    world.requests.push({ frame: frameOf(req), m: req.method(), host: 'sb', p, q: u.search, at: Date.now() });
    if (p.indexOf('/auth/v1/') === 0) world.auth.push({ m: req.method(), p, q: u.search, body, apikey: !!req.headers().apikey });
    if (p === '/auth/v1/settings') return json(route, o.settings);
    if (p === '/auth/v1/token') {
      if (u.searchParams.get('grant_type') === 'refresh_token') return json(route, { msg: 'no' }, 400);
      if (o.token === 'slow') await new Promise((r) => setTimeout(r, 4000));
      if (o.token === 'invalid') return json(route, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
      if (o.token === 'unconfirmed') return json(route, { code: 'email_not_confirmed', error_code: 'email_not_confirmed', msg: 'Email not confirmed' }, 400);
      const exp = Math.floor(Date.now() / 1000) + 3600;
      return json(route, { access_token: 'x.' + Buffer.from(JSON.stringify({ exp, sub: ME.m_uid })).toString('base64').replace(/=+$/, '') + '.y', refresh_token: 'fixture-refresh', expires_in: 3600, expires_at: exp, token_type: 'bearer', user: { id: ME.m_uid, email: ME.email, identities: [{ provider: 'email' }] } });
    }
    if (p === '/auth/v1/signup') {
      if (o.signup === 'session') {
        const exp = Math.floor(Date.now() / 1000) + 3600;
        return json(route, { access_token: 'x.' + Buffer.from(JSON.stringify({ exp, sub: ME.m_uid })).toString('base64').replace(/=+$/, '') + '.y', refresh_token: 'fixture-refresh', expires_at: exp, user: { id: ME.m_uid, email: ME.email, identities: [{ provider: 'email' }] } });
      }
      return json(route, { id: ME.m_uid, email: ME.email, identities: [{ id: 'fixture-identity', provider: 'email' }] });
    }
    if (p === '/auth/v1/resend') return json(route, {});
    if (p === '/auth/v1/user') {
      const auth = req.headers().authorization || '';
      return /^Bearer x\./.test(auth) ? json(route, { id: ME.m_uid, email: ME.email, identities: [{ provider: 'email' }], user_metadata: {} }) : json(route, { msg: 'no session' }, 401);
    }
    if (p === '/auth/v1/logout') return json(route, {});
    if (p === '/rest/v1/action_missions') {
      if (u.searchParams.get('id')) return json(route, (Array.isArray(o.missions) ? o.missions : ONE_MISSION).filter((m) => 'eq.' + m.id === u.searchParams.get('id')));
      if (o.missions === 'fail') return json(route, { message: 'fixture failure' }, 503);
      return json(route, o.missions);
    }
    if (p === '/rest/v1/action_mission_details') return json(route, []);
    if (p === '/rest/v1/action_mission_assignments') return json(route, []);
    if (p === '/rest/v1/fan_profiles') return json(route, req.method() === 'GET' ? [] : [{ ok: true }]);
    if (/\/rest\/v1\/rpc\/m_touch_app$/.test(p)) return json(route, { ok: true });
    return json(route, []);
  });
  /* every read failing: the record's static fallback fails too */
  if (o.archive === 'gone') await ctx.route('**/data/action/docket-516r-archive.json', (route) => route.fulfill({ status: 404, body: 'not found' }));
  /* opts.globe false keeps the globe's renderer off even with CESIUM_DIR: a scenario timing the door's own motion */
  if (process.env.CESIUM_DIR && o.globe !== false) await ctx.route('https://cesium.com/**/Build/Cesium/**', async (route) => {
    const rel = new URL(route.request().url()).pathname.split('/Build/Cesium/')[1];
    if (!rel || rel.includes('..')) return route.abort();
    try { return route.fulfill({ body: await readFile(join(process.env.CESIUM_DIR, rel)), contentType: TYPES[extname(rel)] || 'application/octet-stream' }); }
    catch { return route.abort(); }
  });
  else await ctx.route('https://cesium.com/**', (route) => route.abort());
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) => r.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => world.errors.push(e.message));
  page.on('dialog', (d) => { world.dialogs.push(d.type()); d.dismiss().catch(() => {}); });
  page.on('console', (m) => { if (m.type() === 'error') world.console.push({ text: m.text().slice(0, 300), url: (m.location() && m.location().url) || '' }); });
  page.on('response', (r) => { if (r.status() >= 400) world.bad.push({ status: r.status(), url: r.url().slice(0, 200) }); });
  page.on('requestfailed', (r) => { const f = r.failure(); if (f && !/ERR_ABORTED/.test(f.errorText) && !/cesium\.com|fonts\./.test(r.url())) world.bad.push({ status: 0, url: r.url().slice(0, 200), failure: f.errorText }); });
  const sep = path.includes('?') ? '&' : '?';
  await page.goto(base + path + sep + 'daylight=' + o.phase + (o.banner ? '&wgbanner=1' : ''), { waitUntil: 'domcontentloaded' });
  return { ctx, page, world };
}

/* the World is up: the feed has answered (a guest) or the member's World or pages are on screen */
export async function worldReady(page, what = 'guest') {
  if (what === 'guest') await page.waitForSelector('#mnFeed [data-post-id]', { timeout: 60000 });
  await page.waitForFunction(() => !!window.MCC_GATE && !!window.MCC, null, { timeout: 30000 });
}

/* the door's measurements in one frame */
export async function doorFrame(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rect = (el) => { if (!el || !el.getClientRects().length) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
    const door = q('#mnSignedOut');
    const inert = {};
    const main = door && door.parentNode;
    [...(main ? main.children : []), ...document.body.children].forEach((el) => {
      if (el === door || el === main || /^(SCRIPT|STYLE|LINK)$/.test(el.tagName)) return;
      inert[(el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''))] = el.inert === true;
    });
    const visibleText = door && !door.hidden ? door.innerText.replace(/\s+\n/g, '\n').trim().slice(0, 4000) : '';
    return {
      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, vw: innerWidth, vh: innerHeight,
      open: !!door && !door.hidden, mode: door && door.getAttribute('data-auth-mode'), label: door && door.getAttribute('aria-label'),
      sheet: rect(q('#wgSheet')), go: rect(q('#mnAuthGo')), banner: rect(q('#mccPrivacyNotice')), frame: rect(q('#mnWorldFrame')), veil: rect(q('#mnSignedOut .wg-veil')),
      stage: rect(q('#mnSignedOut .wg-stage')), pulse: rect(q('#wgPulse')), credit: rect(q('#wgCredit')), back: rect(q('#mnSignedOutBack')),
      more: !!q('#wgSheet') && q('#wgSheet').hasAttribute('data-more'),
      fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/"/g, '')} ${f.weight} ${f.style}`).sort(),
      inert, visibleText,
      cards: ['wgPulseMission', 'wgPulseNews', 'wgPulseRecord'].map((id) => { const el = document.getElementById(id); return { id, shown: !!el && !el.hidden, text: el && !el.hidden ? el.textContent.replace(/\s+/g, ' ').trim() : '' }; }),
      dateline: (() => { const d = q('#wgDateline'); return d && !d.hidden && d.getClientRects().length ? d.textContent.replace(/\s+/g, ' ').trim() : ''; })(),
      creditText: q('#wgCredit') ? q('#wgCredit').textContent.replace(/\s+/g, ' ').trim() : '',
      html: document.documentElement.className
    };
  });
}

/* CONTRAST FROM PIXELS, GLYPHS MASKED. Every text box inside the root (the door, or the onboarding pages) that is on screen: its
   colour as computed (the text fill colour where one is set), and the ground under it read from a screenshot taken with every
   glyph in the root made transparent. The worst pixel of the ground (the one nearest the text in luminance) decides; text at
   24 px and up, or 18.66 px bold and up, needs 3:1, everything else 4.5:1. */
/* still: no finite animation running and the sheet's scroll unchanged between two looks (a smooth scroll is not an Animation) */
export async function settle(page) {
  await page.evaluate(() => { window.__wgSettle = -1; });
  await page.waitForFunction(() => {
    /* the sheet still: its scroll, its top and its height (a banner leaving gives it room a moment later) */
    const sh = document.getElementById('wgSheet'), box = sh ? sh.getBoundingClientRect() : null;
    const now = sh ? [Math.round(sh.scrollTop), Math.round(box.top), Math.round(box.height)].join('|') : '', prev = window.__wgSettle;
    window.__wgSettle = now;
    const running = document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.getComputedTiming && a.effect.getComputedTiming().iterations !== Infinity);
    return running.length === 0 && prev === now;
  }, null, { timeout: 6000, polling: 150 }).catch(() => {});
}
export async function contrast(page, rootSel = '#mnSignedOut') {
  /* where things are: the sheet's scroll and box, and the page's scroll; a read and its masked picture must agree on it */
  const where = () => page.evaluate(() => { const sh = document.getElementById('wgSheet'), b = sh ? sh.getBoundingClientRect() : { top: 0, height: 0 }; return [sh ? Math.round(sh.scrollTop) : 0, Math.round(b.top), Math.round(b.height), Math.round(scrollY)].join('|'); });
  let items = [], shot = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await settle(page);
    const before = await where();
    items = await page.evaluate((rootSel) => {
      const root = document.querySelector(rootSel);
      if (!root || root.hidden) return [];
      const out = [], seen = new Set();
      const sheet = document.getElementById('wgSheet'), sr = sheet && sheet.contains ? sheet.getBoundingClientRect() : null, more = !!sheet && sheet.hasAttribute('data-more');
      /* shown: not hidden by style, not inside a closed <details> (its summary aside) */
      const visible = (el) => { for (let n = el; n && n !== document.documentElement; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false; if (n.parentElement && n.parentElement.tagName === 'DETAILS' && !n.parentElement.open && n.tagName !== 'SUMMARY') return false; } return true; };
      /* on top: the text's middle is not under something outside the root (the floating bar over a page's last line) */
      const onTop = (el, r) => { const e = document.elementFromPoint((r.x + r.r) / 2, (r.y + r.b) / 2); return !e || root.contains(e) || e === el; };
      const push = (el, rect, text, color, size, weight) => {
        const r = { x: Math.max(0, rect.left), y: Math.max(0, rect.top), r: Math.min(innerWidth, rect.right), b: Math.min(innerHeight, rect.bottom) };
        if (r.r - r.x < 2 || r.b - r.y < 2) return;
        if (!onTop(el, r)) return;
        if (sr && sheet.contains(el)) {
          r.y = Math.max(r.y, sr.top); r.b = Math.min(r.b, sr.bottom - (more ? 34 : 0));
          if (r.b - r.y < 4) return;
        }
        const key = `${Math.round(r.x)},${Math.round(r.y)},${text.slice(0, 20)}`;
        if (seen.has(key)) return; seen.add(key);
        out.push({ text: text.slice(0, 60), sel: (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0]), rect: r, color, size, weight });
      };
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const text = t.nodeValue.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const el = t.parentElement;
        if (!el || !visible(el) || el.closest('svg') || el.closest('.wg-sr')) continue;
        const cs = getComputedStyle(el);
        const fill = cs.webkitTextFillColor && !/rgba\(0, 0, 0, 0\)/.test(cs.webkitTextFillColor) && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color;
        const range = document.createRange(); range.selectNodeContents(t);
        for (const rect of range.getClientRects()) push(el, rect, text, fill, parseFloat(cs.fontSize), Number(cs.fontWeight) || 400);
      }
      root.querySelectorAll('input:not([type=checkbox]):not([type=hidden])').forEach((input) => {
        if (!visible(input) || !input.getClientRects().length) return;
        const cs = getComputedStyle(input);
        const text = input.value ? (input.type === 'password' ? '••••' : input.value) : input.placeholder;
        if (!text) return;
        const color = input.value ? cs.color : getComputedStyle(input, '::placeholder').color;
        const rect = input.getBoundingClientRect();
        push(input, rect, (input.value ? 'value: ' : 'placeholder: ') + text, color, parseFloat(cs.fontSize), Number(cs.fontWeight) || 400);
      });
      return out;
    }, rootSel);
    if (!items.length) return { items: [], failures: [] };
    const style = await page.addStyleTag({ content: `${rootSel}, ${rootSel} * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; text-decoration-color: transparent !important; transition: none !important; } ${rootSel} input::placeholder { color: transparent !important; }` });
    await page.waitForTimeout(60);
    shot = await page.screenshot({ type: 'png', timeout: 90000 });
    const after = await where();
    await style.evaluate((n) => n.remove());
    await page.waitForTimeout(30);
    /* something moved between the read and the picture (a late scroll, a banner leaving): read and take it again */
    if (before === after) break;
  }
  const measured = await page.evaluate(async ({ b64, items }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const k = img.width / innerWidth, c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = (p) => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
    const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; const v = m[1].split(',').map((x) => parseFloat(x)); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
    return items.map((it) => {
      const pts = [];
      const x0 = Math.floor(it.rect.x * k), y0 = Math.floor(it.rect.y * k), x1 = Math.ceil(it.rect.r * k) - 1, y1 = Math.ceil(it.rect.b * k) - 1;
      const sx = Math.max(1, Math.floor((x1 - x0) / 24)), sy = Math.max(1, Math.floor((y1 - y0) / 6));
      for (let y = y0; y <= y1; y += sy) for (let x = x0; x <= x1; x += sx) { const d = g.getImageData(Math.min(x, img.width - 1), Math.min(y, img.height - 1), 1, 1).data; pts.push([d[0], d[1], d[2]]); }
      const fg = parse(it.color);
      if (!fg || !pts.length) return { ...it, ratio: null };
      const ratios = pts.map((bg) => {
        const a = fg[3], mix = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
        const l1 = L(mix), l2 = L(bg);
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      }).sort((a, b) => a - b);
      const worst = ratios[Math.floor(ratios.length * 0.02)];
      const large = it.size >= 24 || (it.size >= 18.66 && it.weight >= 700);
      return { ...it, ratio: Math.round(worst * 100) / 100, need: large ? 3 : 4.5 };
    });
  }, { b64: shot.toString('base64'), items });
  return { items: measured, failures: measured.filter((m) => m.ratio !== null && m.ratio < m.need) };
}

/* every interactive element in the root: at least 44 x 44 CSS px */
export async function targets(page, rootSel = '#mnSignedOut') {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel);
    if (!root || root.hidden) return [];
    const closedAway = (el) => { for (let n = el; n && n !== root; n = n.parentElement) if (n.parentElement && n.parentElement.tagName === 'DETAILS' && !n.parentElement.open && n.tagName !== 'SUMMARY') return true; return false; };
    return [...root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !closedAway(el))
      .map((el) => { const r = el.getBoundingClientRect(); return { sel: el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className || '').split(' ')[0], text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((t) => t.w < 44 || t.h < 44);
  }, rootSel);
}
