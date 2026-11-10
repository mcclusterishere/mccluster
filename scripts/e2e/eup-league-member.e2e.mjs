/* Environmental Justice League member page: browser proof against the in-process League plane.

     PGLITE_MODULE=<pglite>/dist/index.js PLAYWRIGHT_DIR=<node_modules> CHROMIUM_EXECUTABLE=<chromium> \
       node scripts/e2e/eup-league-member.e2e.mjs [outDir]
     MCC_SERVE_ROOT=<export dir> ... the same, against scripts/build-public-export.sh output

   The page is the real action/league.html with its real scripts, served from the repository (or from the emitted
   export when MCC_SERVE_ROOT names one). Every /v1/eup* call the page makes and every storage URL a grant or a signed
   read names is answered by scripts/test/support/eup-league-plane.mjs: the REAL Worker router over the REAL pending SQL
   in PGlite, with the media lane's storage double. The owner's side of the journey (approve, review, publish, change
   the requirements) is HTTP through the same plane, as the owner. https://mccluster.org/action/league.html is served by
   the real company-site router (workers/mccluster/src/company-site/router.js on world-host.js) passing the page
   through from the same files, so the World host's headers are the ones a browser would get.
   Chromium runs with fake media devices (--use-fake-device-for-media-stream, --use-fake-ui-for-media-stream). A
   getUserMedia spy counts every device request; "permission denied" is that spy rejecting with NotAllowedError, so
   the browser's own permission prompt is not exercised.

   What this does NOT prove: real cameras and microphones, real permission prompts, iOS Safari, Android Chrome or
   Firefox recording formats, backgrounding, long takes, real Supabase Storage (grant lifetime, CORS, size limit, range
   playback), real PostgREST and GoTrue (tokens here never expire mid-journey), assistive-technology behaviour beyond
   what the DOM exposes, and concurrency (PGlite is one session). */
import { createRequire } from 'node:module';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLeaguePlane, ACCOUNTS } from '../test/support/eup-league-plane.mjs';
import { companySiteResponse } from '../../workers/mccluster/src/company-site/router.js';
import * as C from '../../workers/mccluster/src/eup/league-contract.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SERVE = resolve(process.env.MCC_SERVE_ROOT || ROOT);
const OUT = process.argv[2] || '/tmp/eup-league-member-proof';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const PAGES = 'https://matthew.mccluster.org';
const WORLD = 'https://mccluster.org';
const UPSTREAM = 'https://pages.invalid'; // where the World host's router fetches the page from (served from SERVE)
const PATH = '/action/league.html';
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const M = (rest = '') => `${C.PREFIX.member}${rest ? `/${rest}` : ''}`;
const O = (rest = '') => `${C.PREFIX.owner}${rest ? `/${rest}` : ''}`;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const results = [];
function check(scope, name, condition, detail) {
  results.push({ scope, name, pass: !!condition });
  console.log((condition ? 'PASS ' : 'FAIL ') + '[' + scope + '] ' + name + (condition ? '' : ' ' + JSON.stringify(detail ?? null).slice(0, 600)));
}
await mkdir(OUT, { recursive: true });

/* ------------------------------------------------------------------ static files: the page and its scripts */
async function fileResponse(pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.replace(/^\//, ''));
  let file = resolve(SERVE, rel);
  if (!file.startsWith(SERVE + sep)) return new Response('', { status: 404 });
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); } catch { return new Response('', { status: 404 }); }
  try { return new Response(await readFile(file), { status: 200, headers: { 'content-type': TYPES[extname(file)] || 'application/octet-stream' } }); } catch { return new Response('', { status: 404 }); }
}
const upstreamFetch = async (input) => { const u = new URL(input instanceof Request ? input.url : String(input)); return u.origin === UPSTREAM ? fileResponse(u.pathname) : new Response('', { status: 404 }); };
const json = (body, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

/* synthetic media: the contract's WebM magic, then filler. It describes no recording. */
const WEBM = C.bytesFromHex(C.MAGIC_VECTORS.find((v) => v.name === 'webm').hex);
function synthAudio(size, seed) { const b = new Uint8Array(size); b.set(WEBM); for (let i = WEBM.length; i < size; i += 1) b[i] = (i * 131 + seed * 17) & 0xff; return Buffer.from(b); }

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
});

/* one browser context signed in as `as` (an account name, or null for none) */
async function open(plane, viewport, as, { reduced = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewport.width < 1000, ignoreHTTPSErrors: true, serviceWorkers: 'block', reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const errors = [], consoleLines = [];
  await ctx.addInitScript(({ session }) => {
    try {
      localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
      if (session && !sessionStorage.getItem('eul-e2e-started')) { localStorage.setItem('mccdb_session', session); localStorage.setItem('mcc_sess_keep', session); }
      sessionStorage.setItem('eul-e2e-started', '1');
    } catch (e) { /* storage blocked */ }
    /* the getUserMedia spy: every device request is counted; __eulDeny makes the next ones refuse like a denied prompt */
    window.__eulGum = [];
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia) {
      const real = md.getUserMedia.bind(md);
      md.getUserMedia = (constraints) => {
        window.__eulGum.push(JSON.stringify(constraints));
        if (window.__eulDeny) return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
        return real(constraints);
      };
    }
  }, { session: as ? JSON.stringify(plane.session(as)) : null });
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === PAGES) {
      const r = await fileResponse(u.pathname);
      return route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers.entries()), body: Buffer.from(await r.arrayBuffer()) });
    }
    if (u.origin === WORLD) {
      const r = await companySiteResponse(new Request(req.url(), { method: req.method(), headers: await req.allHeaders() }), { PUBLIC_ORIGIN: UPSTREAM }, upstreamFetch);
      if (!r) return route.abort();
      return route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers.entries()), body: Buffer.from(await r.arrayBuffer()) });
    }
    if (u.hostname.endsWith('supabase.co')) {
      if (u.pathname.startsWith('/rest/v1/site_content')) return route.fulfill(json([]));
      return route.fulfill(json({ code: 401, msg: 'fixture: not answered here' }, 401));
    }
    return route.abort();
  });
  await plane.attach(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => consoleLines.push(m.type() + ': ' + m.text()));
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return { ctx, page, errors, consoleLines };
}

const main = (page) => page.locator('[data-eul-main]');
const text = (page) => main(page).innerText();
const waitText = (page, re, timeout = 15000) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-eul-main]')?.innerText || ''), re.source, { timeout });
const overflowFree = (page) => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
const memberPosts = (plane, from = 0) => plane.log.slice(from).filter((e) => e.method === 'POST' && e.path.startsWith(C.PREFIX.member));

/* What must never be readable outside the media element that plays it: signed locations, grants and bearer tokens. */
function secretsOf(plane) { return Object.keys(ACCOUNTS).map((n) => plane.token(n)); }
async function audit(scope, step, plane, s) {
  const tokens = secretsOf(plane);
  const leak = await s.page.evaluate((tokens) => {
    const bad = (v) => typeof v === 'string' && (v.includes('token=') || v.includes('/object/sign/') || v.includes('/upload/sign/') || tokens.some((t) => v.includes(t)));
    const found = [];
    if (bad(document.documentElement.innerText)) found.push('DOM text');
    for (const el of document.querySelectorAll('*')) {
      for (const a of el.attributes) {
        const mediaSrc = a.name === 'src' && (el.tagName === 'AUDIO' || el.tagName === 'VIDEO') && el.closest('[data-eul-main]');
        if (!mediaSrc && bad(a.value)) found.push(el.tagName + '[' + a.name + ']');
      }
    }
    for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); if (k !== 'mccdb_session' && k !== 'mcc_sess_keep' && bad(localStorage.getItem(k))) found.push('localStorage ' + k); }
    for (let i = 0; i < sessionStorage.length; i += 1) { const k = sessionStorage.key(i); if (bad(sessionStorage.getItem(k))) found.push('sessionStorage ' + k); }
    return found;
  }, tokens);
  const consoleLeak = s.consoleLines.filter((l) => l.includes('token=') || l.includes('/object/sign/') || l.includes('/upload/sign/') || tokens.some((t) => l.includes(t)));
  check(scope, step + ': no horizontal overflow (scrollWidth === clientWidth)', await overflowFree(s.page), await s.page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]));
  check(scope, step + ': no signed URL, grant or token in DOM text, attributes, storage or console', leak.length === 0 && consoleLeak.length === 0, { leak, consoleLeak });
  check(scope, step + ': no page errors', s.errors.length === 0, s.errors);
}

/* ------------------------------------------------------------------ scenarios */
async function visibility(viewport) {
  const scope = viewport.width + ' visibility';
  const plane = await createLeaguePlane();
  try {
    await plane.seed({ testers: ['tester'] });
    for (const [as, kind] of [[null, 'signed_out'], ['outsider', 'not_available'], ['tester_b', 'not_available']]) {
      const s = await open(plane, viewport, as);
      const before = plane.log.length;
      await s.page.goto(PAGES + PATH);
      await s.page.locator('[data-eul-unavailable="' + kind + '"]').waitFor({ timeout: 15000 });
      const t = await text(s.page);
      check(scope, (as || 'signed out') + ': neutral "Not available" state, nothing else', /Not available/.test(t) && !/Environmental Justice League|Write a song|healthier world|campaign/i.test(await s.page.evaluate(() => document.body.innerText)), t);
      check(scope, (as || 'signed out') + ': the page title names no program', (await s.page.title()) === 'Equity Uprise');
      check(scope, (as || 'signed out') + ': ' + (as ? 'offers another account' : 'offers sign-in, and asked the API nothing'), as ? /Use another account/.test(t) : /Sign in/.test(t) && plane.log.slice(before).every((e) => !e.path.startsWith(C.PREFIX.member)));
      await audit(scope, (as || 'signed out'), plane, s);
      await s.page.screenshot({ path: join(OUT, `visibility-${as || 'signed-out'}-${viewport.width}.png`), fullPage: true });
      await s.ctx.close();
    }
  } finally { await plane.close(); }
}

const runs = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];
try {
  for (const viewport of runs) {
    await visibility(viewport);
  }
} finally { await browser.close(); }
if (results.some((r) => !r.pass)) process.exitCode = 1;
console.log(results.filter((r) => r.pass).length + '/' + results.length + ' checks passed');
