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
const PRODUCTION_SUPABASE = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co'; // named only to compare headers; never requested
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
    /* the getUserMedia spy: every device request is counted and every stream kept, so the test can see each track
       end; __eulDeny makes the next requests refuse the way a denied prompt does */
    window.__eulGum = []; window.__eulStreams = []; window.__eulUrls = { created: [], revoked: [] };
    const md = navigator.mediaDevices;
    if (md && md.getUserMedia) {
      const real = md.getUserMedia.bind(md);
      md.getUserMedia = (constraints) => {
        window.__eulGum.push(JSON.stringify(constraints));
        if (window.__eulDeny) return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
        return real(constraints).then((stream) => { window.__eulStreams.push(stream); return stream; });
      };
    }
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (o) => { const u = create(o); window.__eulUrls.created.push(u); return u; };
    URL.revokeObjectURL = (u) => { window.__eulUrls.revoked.push(u); return revoke(u); };
  }, { session: as ? JSON.stringify(plane.session(as)) : null });
  await ctx.route('**/*', async (route) => {
    const req = route.request(), u = new URL(req.url());
    if (u.origin === PAGES) {
      /* a blank document of the same origin, for "another tab" in the switching scenario */
      if (u.pathname === '/__e2e_blank__') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Another tab</title><p>Another tab of the same site.</p>' });
      const r = await fileResponse(u.pathname);
      return route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers.entries()), body: Buffer.from(await r.arrayBuffer()) });
    }
    if (u.origin === WORLD) {
      const r = await companySiteResponse(new Request(req.url(), { method: req.method(), headers: await req.allHeaders() }), { PUBLIC_ORIGIN: UPSTREAM }, upstreamFetch);
      if (!r) return route.abort();
      const headers = Object.fromEntries(r.headers.entries());
      /* The plane stands in for the Supabase origin (its storage signs the grants), so the World's report-only policy
         names the plane where it names that origin. Without this, every upload logs its signed grant URL, token
         included, as a report-only violation; worldHost() checks the real header still allows the real origin. */
      if (headers['content-security-policy-report-only']) headers['content-security-policy-report-only'] = headers['content-security-policy-report-only'].split(PRODUCTION_SUPABASE).join(plane.supabase);
      return route.fulfill({ status: r.status, headers, body: Buffer.from(await r.arrayBuffer()) });
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

/* ------------------------------------------------------------------ helpers for the journey */
let keyCount = 0;
const key = (label) => `e2e-${label}-${Date.now().toString(36)}-${(keyCount += 1)}`;
async function owner(plane, method, path, body) {
  const r = await plane.call('owner', method, path, body);
  if (r.status !== 200 || !r.body?.ok) throw new Error(`owner ${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
async function memberAs(plane, as, method, path, body) {
  const r = await plane.call(as, method, path, body);
  if (r.status !== 200 || !r.body?.ok) throw new Error(`${as} ${method} ${path}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
const gum = (page) => page.evaluate(() => window.__eulGum.length);
const clickAct = (page, focusKey) => page.locator(`[data-eul-focus="${focusKey}"]`).click();
const waitOutcome = (page, slot, re, timeout = 25000) => page.waitForFunction(([slot, src]) => new RegExp(src).test(document.querySelector(`[data-eul-outcome="${slot}"]`)?.innerText || ''), [slot, re.source], { timeout });
const outcomeText = (page, slot) => page.locator(`[data-eul-outcome="${slot}"]`).innerText();
const waitSaved = (page, aid, timeout = 20000) => page.waitForFunction((aid) => /^Saved\./.test(document.querySelector(`[data-eul-save="${aid}"]`)?.textContent || ''), aid, { timeout });
const PASS = { mission_decision: 'pass', rights_decision: 'pass', safety_decision: 'pass' };
const utcDay = (days) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + days * 86400000).toISOString().slice(0, 10); };
const storedBySha = (plane) => new Map(plane.storage.paths().map((p) => [sha256(plane.storage.object(p).bytes), p]));
const fingerprintIn = (t) => (/Fingerprint \(SHA-256\): ([0-9a-f]{64})/.exec(t) || [])[1] || null;

/* The whole member loop as one tester, with the owner's side over HTTP. */
async function journey(viewport) {
  const scope = viewport.width + ' journey';
  const plane = await createLeaguePlane();
  try {
    const { campaign, mission } = await plane.seed({ testers: ['tester'] });
    const s = await open(plane, viewport, 'tester');
    const { page } = s;
    await page.goto(PAGES + PATH);
    await waitText(page, /Missions open to you/);
    let t = await text(page);
    check(scope, 'the invited tester sees the League heading and the song mission', /Environmental Justice League/.test(await page.locator('h1').innerText()) && /Write a song for a healthier world/.test(t), t.slice(0, 300));
    check(scope, 'the title names the program only after the read answered ok', (await page.title()) === 'Environmental Justice League · Equity Uprise', await page.title());
    check(scope, 'no camera or microphone was asked for on load or render', (await gum(page)) === 0);
    await audit(scope, 'catalogue', plane, s);

    /* 1. apply: a draft in the sheet; close returns focus; reload resumes the draft; submit */
    const applyKey = `apply:${mission.id}`;
    await clickAct(page, applyKey);
    await page.locator('[data-eul-sheet]').waitFor();
    check(scope, 'Apply opens a modal sheet with focus inside it', await page.evaluate(() => { const d = document.querySelector('[data-eul-sheet]'); return !!d && d.open && d.matches(':modal') && d.contains(document.activeElement); }));
    await page.locator('#eulSheetStatement').fill('Test fixture: I would like to write a song for a healthier world.');
    await clickAct(page, 'sheet-save');
    await waitOutcome(page, `app:${mission.id}`, /done/);
    await audit(scope, 'apply sheet with a saved draft', plane, s);
    await page.screenshot({ path: join(OUT, `journey-sheet-${viewport.width}.png`) });
    await clickAct(page, 'sheet-close');
    await page.locator('[data-eul-sheet]').waitFor({ state: 'detached' });
    check(scope, 'closing the sheet returns focus to the button that opened it', await page.evaluate((k) => document.activeElement?.getAttribute('data-eul-focus') === k, applyKey));
    await page.reload();
    await waitText(page, /Draft, not sent/);
    await clickAct(page, applyKey);
    await page.locator('[data-eul-sheet]').waitFor();
    check(scope, 'after a reload the saved draft resumes in the sheet', (await page.locator('#eulSheetStatement').inputValue()) === 'Test fixture: I would like to write a song for a healthier world.');
    await clickAct(page, 'sheet-submit');
    await page.locator('[data-eul-sheet]').waitFor({ state: 'detached' });
    await waitText(page, /Sent; waiting for a decision/);
    check(scope, 'submitted: the application says it waits for a decision', true);

    /* 2. the owner approves; the tester reads the offer and accepts the current requirements */
    const apps = (await owner(plane, 'GET', O(`applications?mission=${mission.id}&status=submitted`))).applications;
    const app = apps.find((a) => a.applicant === ACCOUNTS.tester);
    const decided = (await owner(plane, 'POST', O(`applications/${app.id}/decision`), { idempotency_key: key('approve'), expected_revision: app.revision, decision: 'approved' })).application;
    const aid = decided.assignment.id;
    await clickAct(page, 'reload');
    await waitText(page, /Participation notice/);
    t = await text(page);
    check(scope, 'after approval the offer shows the current requirements and the participation notice', /Original audio or video, lyrics/.test(t) && /TEST FIXTURE participation notice/.test(t));
    await audit(scope, 'offer', plane, s);
    await clickAct(page, `accept:${aid}`);
    await page.locator(`[data-eul-workspace="${aid}"]`).waitFor();
    check(scope, 'accepting opens the workspace', true);

    /* 3. autosave */
    await page.locator(`[data-eul-focus="title:${aid}"]`).fill('Test fixture: river song');
    await page.locator(`[data-eul-focus="lyrics:${aid}"]`).fill('Line one of the test fixture song\nLine two: the river runs clear');
    await waitSaved(page, aid);
    let me = (await memberAs(plane, 'tester', 'GET', M())).league;
    check(scope, 'autosave stored the draft, read back over HTTP', me.assignments[0].draft?.document?.lyrics === 'Line one of the test fixture song\nLine two: the river runs clear');
    await audit(scope, 'workspace', plane, s);

    /* 4. the owner changes the requirements: the next save is refused, the offer asks again, the text is kept */
    const cur = (await owner(plane, 'GET', O(`missions?campaign=${campaign.id}`))).missions.find((m) => m.id === mission.id);
    await owner(plane, 'PATCH', O(`missions/${mission.id}`), { idempotency_key: key('requirements'), expected_revision: cur.revision, mission: { requirements: 'Test fixture requirements, second version.\nWrite the words and record one take.' } });
    await page.locator(`[data-eul-focus="lyrics:${aid}"]`).fill('Line one of the test fixture song\nLine two: the river runs clear\nLine three, typed after the change');
    await waitText(page, /The requirements changed after you accepted them/);
    check(scope, 'a requirements change asks for acceptance again and shows the new text', /second version/.test(await text(page)));
    await clickAct(page, `accept:${aid}`);
    await page.locator(`[data-eul-workspace="${aid}"]`).waitFor();
    await waitSaved(page, aid);
    me = (await memberAs(plane, 'tester', 'GET', M())).league;
    check(scope, 're-accepted at version 2 and the text typed meanwhile was kept and saved', me.assignments[0].accepted_requirements_revision === 2 && /Line three/.test(me.assignments[0].draft?.document?.lyrics || ''));

    /* 5. another device resumes the same draft and uploads a file */
    const d2 = await open(plane, viewport, 'tester');
    await d2.page.goto(PAGES + PATH);
    await d2.page.locator(`[data-eul-workspace="${aid}"]`).waitFor();
    check(scope, 'another device resumes the same draft', (await d2.page.locator(`[data-eul-focus="lyrics:${aid}"]`).inputValue()).includes('Line three'));
    const FILE_AUDIO = synthAudio(1536, 1);
    await d2.page.locator(`[data-eul-focus="file:${aid}"]`).setInputFiles({ name: 'take-one.webm', mimeType: 'audio/webm', buffer: FILE_AUDIO });
    await d2.page.locator(`[data-eul-focus="use-take:${aid}"]`).click();
    await waitOutcome(d2.page, `upload:${aid}`, /Sealed\. Fingerprint/);
    check(scope, 'the other device sealed the file: its fingerprint is the SHA-256 of the stored bytes', fingerprintIn(await outcomeText(d2.page, `upload:${aid}`)) === sha256(FILE_AUDIO));
    await waitSaved(d2.page, aid);
    await audit(scope, 'second device', plane, d2);
    await d2.ctx.close();
    await clickAct(page, 'reload');
    await page.waitForFunction(() => document.querySelectorAll('[data-eul-upload-state="sealed"]').length === 1);
    check(scope, 'the first device sees the other device\'s take, included in the submission', await page.locator('[data-eul-bind="choose"]:checked').count() === 1);

    /* 6. record: nothing is asked for before Record; retake and cancel release everything; send with progress */
    check(scope, 'still no device asked for before Record', (await gum(page)) === 0);
    await clickAct(page, `record:audio:${aid}`);
    await page.locator('[data-eul-recording]').waitFor();
    check(scope, 'Record audio asks for the microphone once, from its own handler', (await gum(page)) === 1);
    await page.waitForTimeout(1500);
    await clickAct(page, `stop:${aid}`);
    await page.locator('[data-eul-preview]').waitFor();
    check(scope, 'the take plays back from a local object URL before anything is sent', await page.evaluate(() => /^blob:/.test(document.querySelector('[data-eul-preview-player]')?.src || '')));
    await audit(scope, 'take preview', plane, s);
    await clickAct(page, `retake:${aid}`);
    await page.locator('[data-eul-recording]').waitFor();
    check(scope, 'Retake asks again, and the first take\'s tracks are stopped and its URL revoked', (await gum(page)) === 2 && await page.evaluate(() => window.__eulStreams[0].getTracks().every((x) => x.readyState === 'ended') && window.__eulUrls.revoked.includes(window.__eulUrls.created[0])));
    await page.waitForTimeout(1200);
    await clickAct(page, `stop:${aid}`);
    await page.locator('[data-eul-preview]').waitFor();
    await clickAct(page, `cancel-take:${aid}`);
    await page.locator('[data-eul-preview]').waitFor({ state: 'detached' });
    check(scope, 'Cancel releases every track and revokes every object URL', await page.evaluate(() => window.__eulStreams.every((x) => x.getTracks().every((y) => y.readyState === 'ended')) && window.__eulUrls.created.every((u) => window.__eulUrls.revoked.includes(u))));
    await clickAct(page, `record:audio:${aid}`);
    await page.locator('[data-eul-recording]').waitFor();
    await page.waitForTimeout(1500);
    await clickAct(page, `stop:${aid}`);
    await page.locator('[data-eul-preview]').waitFor();
    await page.evaluate(() => { window.__eulSawProgress = false; const root = document.querySelector('[data-eul-main]'); new MutationObserver(() => { if (root.querySelector('[data-eul-progress]')) window.__eulSawProgress = true; }).observe(root, { childList: true, subtree: true }); });
    await clickAct(page, `use-take:${aid}`);
    await waitOutcome(page, `upload:${aid}`, /Sealed\. Fingerprint/);
    const recorded = fingerprintIn(await outcomeText(page, `upload:${aid}`));
    check(scope, 'the recorded take was sent with a progress bar and sealed; its fingerprint is the SHA-256 of the stored bytes', !!recorded && storedBySha(plane).has(recorded) && await page.evaluate(() => window.__eulSawProgress === true));
    check(scope, 'three Record presses, three device requests, and every track ended after the take was sent', (await gum(page)) === 3 && await page.evaluate(() => window.__eulStreams.every((x) => x.getTracks().every((y) => y.readyState === 'ended'))));
    await waitSaved(page, aid);
    await audit(scope, 'sealed take', plane, s);
    /* play the sealed take back through its 300 s signed link: the link lives in the media element and nowhere else */
    const takeId = await page.evaluate((fp) => [...document.querySelectorAll('[data-eul-upload]')].find((li) => li.innerText.includes(fp))?.getAttribute('data-eul-upload'), recorded);
    check(scope, 'an unplayed take shows no empty player', !(await page.locator(`[data-eul-player="${takeId}"]`).isVisible()));
    await clickAct(page, `play:${takeId}`);
    await page.waitForFunction(([id, origin]) => { const el = document.querySelector(`[data-eul-player="${id}"]`); return !!el && !el.hidden && el.src.startsWith(origin + '/storage/v1/object/sign/') && el.readyState >= 1; }, [takeId, plane.supabase], { timeout: 20000 });
    check(scope, 'Play loads the sealed take from its signed link (metadata read through a range request)', plane.log.some((e) => e.method === 'GET' && e.path.startsWith('/storage/v1/object/sign/') && e.status === 206));
    await audit(scope, 'playing a sealed take', plane, s);

    /* 7. denied permission keeps the other ways open; unsupported files are refused before anything is sent */
    await page.evaluate(() => { window.__eulDeny = true; });
    await clickAct(page, `record:video:${aid}`);
    await waitText(page, /permission was not given/);
    check(scope, 'denied: said in words, and the upload and statement paths stay open', (await gum(page)) === 4 && await page.locator(`[data-eul-focus="file:${aid}"]`).isEnabled() && (await page.locator(`[data-eul-focus="path:statement:${aid}"]`).getAttribute('aria-disabled')) === null);
    await page.evaluate(() => { window.__eulDeny = false; });
    const postsBefore = memberPosts(plane).length;
    await page.locator(`[data-eul-focus="file:${aid}"]`).setInputFiles({ name: 'notes.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><p>not media</p>') });
    await page.locator('[data-eul-file-note]').waitFor();
    check(scope, 'an unsupported file type is refused with a reason, and nothing is sent', /This file type is not accepted/.test(await page.locator('[data-eul-file-note]').innerText()) && memberPosts(plane).length === postsBefore);
    await page.locator(`[data-eul-focus="file:${aid}"]`).setInputFiles({ name: 'fake.webm', mimeType: 'audio/webm', buffer: Buffer.from('this is not a webm file at all') });
    await page.waitForFunction(() => /contents are not audio\/webm/.test(document.querySelector('[data-eul-file-note]')?.innerText || ''));
    check(scope, 'a file whose bytes are not its type is refused the same way', memberPosts(plane).length === postsBefore);
    await audit(scope, 'refused files', plane, s);

    /* 8. a cancelled upload: the bytes reached storage, the answer never came, Cancel discards the row and its object */
    const hang = plane.faults.add({ method: 'PUT', path: /\/storage\/v1\/object\/upload\/sign\//, mode: 'hang' });
    const CANCEL = synthAudio(2048, 7);
    await page.locator(`[data-eul-focus="file:${aid}"]`).setInputFiles({ name: 'take-cancel.webm', mimeType: 'audio/webm', buffer: CANCEL });
    await clickAct(page, `use-take:${aid}`);
    await page.locator(`[data-eul-focus="upload-cancel:${aid}"]`).waitFor();
    await page.waitForFunction(() => true);
    for (let i = 0; i < 50 && hang.hits === 0; i += 1) await page.waitForTimeout(100);
    await clickAct(page, `upload-cancel:${aid}`);
    await waitOutcome(page, `upload:${aid}`, /Upload cancelled/);
    const deletes = plane.storage.calls.filter((c) => c.method === 'DELETE').length;
    check(scope, 'a cancelled upload leaves no object in the storage double', hang.hits === 1 && !storedBySha(plane).has(sha256(CANCEL)) && deletes >= 1, { hits: hang.hits, deletes });
    await page.locator(`[data-eul-focus="cancel-take:${aid}"]`).click();

    /* 9. rights and credits; then submit privately, with the answer lost after the commit */
    for (const r of ['owns_master', 'controls_composition', 'samples_cleared', 'collaborators_cleared']) await page.locator(`[data-eul-focus="rights:${r}:yes:${aid}"]`).check();
    await page.locator(`[data-eul-focus="rights:parody_or_derivative:no:${aid}"]`).check();
    await page.locator(`[data-eul-focus="cn:0:${aid}"]`).fill('Journey Fixture Writer');
    await page.locator(`[data-eul-focus="cr:0:${aid}"]`).fill('lyrics');
    await waitSaved(page, aid);
    check(scope, 'with everything filled in, nothing is left on the to-do list and Submit is open', (await page.locator('[data-eul-todo]').count()) === 0 && (await page.locator(`[data-eul-focus="submit-proof:${aid}"]`).getAttribute('aria-disabled')) === null);
    const proofPath = M(`assignments/${aid}/proof`);
    const drop = plane.faults.add({ method: 'POST', path: proofPath, as: 'tester', mode: 'drop' });
    await clickAct(page, `submit-proof:${aid}`);
    await waitText(page, /it was recorded \(its key was found/);
    check(scope, 'a lost submit answer reads as unknown, then the receipt says it was recorded, and it was not resent', drop.hits === 1 && plane.log.filter((e) => e.method === 'POST' && e.path === proofPath).length === 1);
    await waitText(page, /Version 1: Submitted privately/);
    await audit(scope, 'submitted privately', plane, s);

    /* 10. needs changes, a revision, version 2 */
    let proof = (await owner(plane, 'GET', O(`proofs?assignment=${aid}`))).proofs[0];
    await owner(plane, 'POST', O(`proofs/${proof.id}/review`), { idempotency_key: key('review'), expected_revision: proof.revision, review: { asset_revision: proof.asset_revision, mission_decision: 'changes', rights_decision: 'pass', safety_decision: 'pass', reason: 'Test fixture: please add a chorus.' } });
    await clickAct(page, 'reload');
    await waitText(page, /please add a chorus/);
    check(scope, 'needs changes: the decision and its reason are shown, and the workspace is open to revise', /Changes requested/.test(await text(page)) && (await page.locator(`[data-eul-workspace="${aid}"]`).count()) === 1);
    await page.locator(`[data-eul-focus="lyrics:${aid}"]`).fill('Line one of the test fixture song\nLine two: the river runs clear\nLine three, typed after the change\nChorus: a test fixture chorus');
    await waitSaved(page, aid);
    await clickAct(page, `submit-proof:${aid}`);
    await waitText(page, /Version 2: Submitted privately/);
    check(scope, 'the revision is version 2', true);

    /* 11. accepted: completion credit; publication stays private until chosen */
    proof = (await owner(plane, 'GET', O(`proofs?assignment=${aid}`))).proofs[0];
    await owner(plane, 'POST', O(`proofs/${proof.id}/review`), { idempotency_key: key('review'), expected_revision: proof.revision, review: { asset_revision: proof.asset_revision, ...PASS } });
    await clickAct(page, 'reload');
    await waitText(page, /Completion credit recorded/);
    check(scope, 'accepted: the credit is shown and publication defaults to private', /Version 2: Accepted/.test(await text(page)) && (await page.locator('[data-eul-publication-state]').getAttribute('data-eul-publication-state')) === 'private');
    await audit(scope, 'accepted', plane, s);

    /* 12. consent (its answer hangs past a short deadline: unknown, then the receipt), publication, revocation */
    await page.locator(`[data-eul-focus="consent-date:${proof.id}"]`).fill(utcDay(30));
    await page.evaluate(() => document.getElementById('eulMount').eulController.setDeadline(2500));
    const hangConsent = plane.faults.add({ method: 'POST', path: M(`proofs/${proof.id}/consent`), as: 'tester', mode: 'hang' });
    await clickAct(page, `consent-grant:${proof.id}`);
    await waitText(page, /You allowed publication until/, 30000);
    check(scope, 'a consent whose answer never came: the deadline says unknown, the receipt says recorded, nothing resent', hangConsent.hits === 1 && plane.log.filter((e) => e.method === 'POST' && e.path === M(`proofs/${proof.id}/consent`)).length === 1);
    await page.evaluate(() => document.getElementById('eulMount').eulController.setDeadline(15000));
    const consent = (await owner(plane, 'GET', O(`consents?proof=${proof.id}`))).consents.find((c) => c.purpose === 'publish_proof' && c.state === 'open');
    check(scope, 'a consent publishes nothing by itself', (await page.locator('[data-eul-publication-state]').getAttribute('data-eul-publication-state')) === 'private');
    await owner(plane, 'POST', O(`proofs/${proof.id}/publication`), { idempotency_key: key('publish'), expected_revision: proof.revision, decision: 'published', consent_id: consent.id });
    await clickAct(page, 'reload');
    await waitText(page, /Shown to this campaign.s released audience/);
    await audit(scope, 'published', plane, s);
    await clickAct(page, `consent-revoke:${consent.id}`);
    await waitText(page, /publication was withdrawn \(you revoked your consent\)/);
    const credits = (await owner(plane, 'GET', O(`credits?mission=${mission.id}`))).credits;
    check(scope, 'revoking withdrew the publication; the credit is unchanged', credits.length === 1 && credits[0].proof_revision === 2 && /Completion credit recorded/.test(await text(page)));
    await audit(scope, 'revoked', plane, s);
    await page.screenshot({ path: join(OUT, `journey-end-${viewport.width}.png`), fullPage: true });
    await s.ctx.close();
  } finally { await plane.close(); }
}

/* The tester with an accepted assignment, made over HTTP so a scenario can start in the workspace. */
async function acceptedTester(plane, mission) {
  const app = (await memberAs(plane, 'tester', 'POST', M(`missions/${mission.id}/application`), { idempotency_key: key('apply'), expected_revision: 0, application: { submit: true, requirements_revision: mission.requirements_revision, statement: 'Test fixture: switching.' } })).application;
  const decided = (await owner(plane, 'POST', O(`applications/${app.id}/decision`), { idempotency_key: key('approve'), expected_revision: app.revision, decision: 'approved' })).application;
  const a = decided.assignment;
  await memberAs(plane, 'tester', 'POST', M(`assignments/${a.id}/accept`), { idempotency_key: key('accept'), expected_revision: a.revision, requirements_revision: mission.requirements_revision, notice_revision: (await owner(plane, 'GET', O('policy'))).policy.document.notices.participation.revision });
  return a.id;
}
const switchTo = (page, session, event = true) => page.evaluate(({ session, event }) => {
  localStorage.setItem('mccdb_session', session); localStorage.setItem('mcc_sess_keep', session);
  if (event) window.dispatchEvent(new CustomEvent('mcc:auth-changed', { detail: { signed_in: true } }));
  const main = document.querySelector('[data-eul-main]');
  return { text: main ? main.innerText : '', inflight: document.getElementById('eulMount').eulController.inflight(),
    tracksEnded: window.__eulStreams.every((x) => x.getTracks().every((y) => y.readyState === 'ended')),
    urlsRevoked: window.__eulUrls.created.every((u) => window.__eulUrls.revoked.includes(u)),
    media: [...document.querySelectorAll('[data-eul-main] audio[src], [data-eul-main] video[src]')].length };
}, { session, event });

/* Switching account mid-journey clears private data at once and never sends the old account's work as the new one. */
async function switching(viewport) {
  const scope = viewport.width + ' switching';
  const plane = await createLeaguePlane();
  try {
    const { mission } = await plane.seed({ testers: ['tester'] });
    const aid = await acceptedTester(plane, mission);
    const s = await open(plane, viewport, 'tester');
    const { page } = s;
    const B = JSON.stringify(plane.session('tester_b')), A = JSON.stringify(plane.session('tester'));
    await page.goto(PAGES + PATH);
    await page.locator(`[data-eul-workspace="${aid}"]`).waitFor();
    await page.locator(`[data-eul-focus="lyrics:${aid}"]`).fill('Private test fixture lyric that must vanish on an account switch');
    await waitSaved(page, aid);

    /* A. mcc:auth-changed while a recording runs and a draft save is in flight */
    await clickAct(page, `record:audio:${aid}`);
    await page.locator('[data-eul-recording]').waitFor();
    check(scope, 'the recording dot pulses only when motion is not reduced', (await page.locator('.eul-rec__dot').evaluate((el) => getComputedStyle(el).animationName)) === 'eul-pulse');
    const hang = plane.faults.add({ method: 'POST', path: M(`assignments/${aid}/draft`), as: 'tester', mode: 'hang' });
    await page.locator(`[data-eul-focus="lyrics:${aid}"]`).fill('Private test fixture lyric that must vanish on an account switch, edited');
    for (let i = 0; i < 60 && hang.hits === 0; i += 1) await page.waitForTimeout(100);
    const logAt = plane.log.length;
    const after = await switchTo(page, B);
    check(scope, 'at the switch: the private DOM is cleared in the same task', !/Private test fixture lyric|Write a song/.test(after.text) && after.media === 0, after.text.slice(0, 200));
    check(scope, 'at the switch: every request was aborted, every track stopped, every object URL revoked', hang.hits === 1 && after.inflight === 0 && after.tracksEnded && after.urlsRevoked, after);
    await page.locator('[data-eul-unavailable="not_available"]').waitFor();
    const afterLog = plane.log.slice(logAt);
    check(scope, 'after the switch: nothing was sent for the old work, as either account', !afterLog.some((e) => e.method === 'POST') && afterLog.every((e) => e.as !== 'tester'), afterLog);
    check(scope, 'after the switch: the new account sees only its own state (not available)', !/Private test fixture lyric/.test(await page.evaluate(() => document.body.innerText)));
    await audit(scope, 'after an event switch', plane, s);

    /* B. the session changed with no event: the identity guard at confirm sends nothing */
    await switchTo(page, A);
    await page.locator(`[data-eul-workspace="${aid}"]`).waitFor();
    check(scope, 'switching back reads the first account again, with its saved draft', /Private test fixture lyric/.test(await page.locator(`[data-eul-focus="lyrics:${aid}"]`).inputValue()));
    await switchTo(page, B, false);
    const quietAt = plane.log.length;
    await clickAct(page, `assign-withdraw:${aid}`);
    await page.locator('[data-eul-unavailable="not_available"]').waitFor();
    const quiet = plane.log.slice(quietAt);
    check(scope, 'a command confirmed after a silent session change is not sent, and the page is cleared', !quiet.some((e) => e.method === 'POST') && !/Private test fixture lyric/.test(await page.evaluate(() => document.body.innerText)), quiet);
    const me = (await memberAs(plane, 'tester', 'GET', M())).league;
    check(scope, 'the first account\'s assignment was not withdrawn', me.assignments.find((x) => x.id === aid)?.status === 'accepted');

    /* C. another tab signs in as someone else: the storage event clears this tab */
    await switchTo(page, A);
    await page.locator(`[data-eul-workspace="${aid}"]`).waitFor();
    const other = await s.ctx.newPage();
    await other.goto(PAGES + '/__e2e_blank__');
    await other.evaluate((session) => { localStorage.setItem('mccdb_session', session); localStorage.setItem('mcc_sess_keep', session); }, B);
    await page.locator('[data-eul-unavailable="not_available"]').waitFor();
    check(scope, 'a session written by another tab for another account clears this tab', !/Private test fixture lyric/.test(await page.evaluate(() => document.body.innerText)));
    await other.evaluate((session) => { localStorage.setItem('mccdb_session', session); localStorage.setItem('mcc_sess_keep', session); }, A);
    await page.locator(`[data-eul-workspace="${aid}"]`).waitFor();
    const refreshed = JSON.stringify({ ...plane.session('tester'), access_token: plane.signIn(ACCOUNTS.tester) });
    await page.locator(`[data-eul-focus="lyrics:${aid}"]`).fill('Private test fixture lyric kept across a token refresh');
    await other.evaluate((session) => { localStorage.setItem('mccdb_session', session); }, refreshed);
    await page.waitForTimeout(400);
    check(scope, 'a refreshed token for the same account clears nothing (unsaved text stays)', (await page.locator(`[data-eul-focus="lyrics:${aid}"]`).inputValue()) === 'Private test fixture lyric kept across a token refresh');
    await waitSaved(page, aid);
    check(scope, 'and the next save goes out with the refreshed token, as the same account', plane.log.filter((e) => e.method === 'POST' && e.path === M(`assignments/${aid}/draft`)).at(-1)?.as === 'signed-in');
    await other.close();
    await audit(scope, 'after the tab switches', plane, s);
    await s.ctx.close();
  } finally { await plane.close(); }
}

/* Keyboard only, with reduced motion: apply through the sheet, Escape, accept, type, and reach a refused button's reason. */
async function keyboard(viewport) {
  const scope = viewport.width + ' keyboard';
  const plane = await createLeaguePlane();
  try {
    const { mission } = await plane.seed({ testers: ['tester'] });
    const s = await open(plane, viewport, 'tester', { reduced: true });
    const { page } = s;
    await page.goto(PAGES + PATH);
    await waitText(page, /Missions open to you/);
    const focusKey = () => page.evaluate(() => document.activeElement?.getAttribute('data-eul-focus') || document.activeElement?.tagName || null);
    async function tabTo(target, limit = 60, back = false) {
      for (let i = 0; i < limit; i += 1) { if ((await focusKey()) === target) return true; await page.keyboard.press(back ? 'Shift+Tab' : 'Tab'); }
      return (await focusKey()) === target;
    }
    const applyKey = `apply:${mission.id}`;
    check(scope, 'Tab reaches Apply', await tabTo(applyKey));
    await page.keyboard.press('Enter');
    await page.locator('[data-eul-sheet]').waitFor();
    check(scope, 'Enter opens the sheet with focus in its first field', (await focusKey()) === 'sheet-statement');
    await page.keyboard.press('Escape');
    await page.locator('[data-eul-sheet]').waitFor({ state: 'detached' });
    check(scope, 'Escape closes the sheet and focus returns to Apply', (await focusKey()) === applyKey);
    await page.keyboard.press('Enter');
    await page.locator('[data-eul-sheet]').waitFor();
    await page.keyboard.type('Test fixture: typed with the keyboard only.');
    check(scope, 'Tab reaches Submit inside the sheet', await tabTo('sheet-submit', 10));
    await page.keyboard.press('Enter');
    await page.locator('[data-eul-sheet]').waitFor({ state: 'detached' });
    await waitText(page, /Sent; waiting for a decision/);
    check(scope, 'submitted by keyboard; focus is back on the button that opened the sheet', (await focusKey()) === applyKey);
    const app = (await owner(plane, 'GET', O(`applications?mission=${mission.id}&status=submitted`))).applications[0];
    const aid = (await owner(plane, 'POST', O(`applications/${app.id}/decision`), { idempotency_key: key('approve'), expected_revision: app.revision, decision: 'approved' })).application.assignment.id;
    check(scope, 'Shift+Tab reaches Check for updates', await tabTo('reload', 60, true));
    await page.keyboard.press('Enter');
    await waitText(page, /Participation notice/);
    check(scope, 'Tab reaches Accept', await tabTo(`accept:${aid}`));
    await page.keyboard.press('Enter');
    await page.locator(`[data-eul-workspace="${aid}"]`).waitFor();
    check(scope, 'Tab reaches the song title', await tabTo(`title:${aid}`));
    await page.keyboard.type('Test fixture: keyboard song');
    await page.keyboard.press('Tab');
    check(scope, 'the next Tab is the lyrics', (await focusKey()) === `lyrics:${aid}`);
    await page.keyboard.type('Typed line one\nTyped line two');
    await waitSaved(page, aid);
    check(scope, 'Tab reaches Submit even while it is refused, and Enter there says why and sends nothing', await tabTo(`submit-proof:${aid}`, 120));
    const before = memberPosts(plane).length;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const said = await page.locator('[data-eul-announce]').innerText();
    check(scope, 'the refused Submit announces its reason in words', /Not ready to submit yet/.test(said) && memberPosts(plane).length === before, said);
    check(scope, 'Tab reaches Record audio', await tabTo(`record:audio:${aid}`, 60, true));
    await page.keyboard.press('Enter');
    await page.locator('[data-eul-recording]').waitFor();
    check(scope, 'reduced motion: the recording dot does not animate', (await page.locator('.eul-rec__dot').evaluate((el) => getComputedStyle(el).animationName)) === 'none');
    check(scope, 'focus moves to Stop when the recording starts', (await focusKey()) === `stop:${aid}`);
    await page.waitForTimeout(1500); // a take of a second and a half, as a person would
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    check(scope, 'Stop is reachable by keyboard while recording', await tabTo(`stop:${aid}`, 10));
    await page.keyboard.press('Enter');
    await page.locator('[data-eul-preview]').waitFor();
    check(scope, 'focus moves to Send this take when the preview appears', (await focusKey()) === `use-take:${aid}`);
    check(scope, 'Cancel is reachable by keyboard on the preview', await tabTo(`cancel-take:${aid}`, 10));
    await page.keyboard.press('Enter');
    await page.locator('[data-eul-preview]').waitFor({ state: 'detached' });
    await audit(scope, 'keyboard pass', plane, s);
    await s.ctx.close();
  } finally { await plane.close(); }
}

/* The World host: https://mccluster.org/action/league.html through the real company-site router. */
async function worldHost(viewport) {
  const scope = viewport.width + ' world host';
  const plane = await createLeaguePlane();
  try {
    const { mission } = await plane.seed({ testers: ['tester'] });
    const aid = await acceptedTester(plane, mission);
    const s = await open(plane, viewport, 'tester');
    const { page } = s;
    const real = await companySiteResponse(new Request(WORLD + PATH), { PUBLIC_ORIGIN: UPSTREAM }, upstreamFetch);
    const connect = (/connect-src ([^;]*)/.exec(real.headers.get('content-security-policy-report-only') || '') || [])[1] || '';
    check(scope, 'the World host\'s report-only policy lets the page reach the API and the storage origin that signs grants', connect.split(' ').includes('https://api.mccluster.org') && connect.split(' ').includes(PRODUCTION_SUPABASE), connect);
    const response = await page.goto(WORLD + PATH);
    const h = response.headers();
    check(scope, 'the World host serves the page as a room: noindex, camera and microphone for this origin, report-only policy', h['x-robots-tag'] === 'noindex' && /camera=\(self\)/.test(h['permissions-policy'] || '') && /microphone=\(self\)/.test(h['permissions-policy'] || '') && !!h['content-security-policy-report-only'], h);
    await page.locator(`[data-eul-workspace="${aid}"]`).waitFor();
    check(scope, 'the member read answers on the World host', /Environmental Justice League/.test(await page.locator('h1').innerText()));
    await clickAct(page, `record:audio:${aid}`);
    await page.locator('[data-eul-recording]').waitFor();
    await page.waitForTimeout(1200);
    await clickAct(page, `stop:${aid}`);
    await page.locator('[data-eul-preview]').waitFor();
    await clickAct(page, `use-take:${aid}`);
    await waitOutcome(page, `upload:${aid}`, /Sealed\. Fingerprint/);
    const fp = fingerprintIn(await outcomeText(page, `upload:${aid}`));
    check(scope, 'record, upload and seal work from the World host', (await gum(page)) === 1 && !!fp && storedBySha(plane).has(fp));
    await audit(scope, 'world host', plane, s);
    await page.screenshot({ path: join(OUT, `world-host-${viewport.width}.png`), fullPage: true });
    await s.ctx.close();
  } finally { await plane.close(); }
}

/* Every scenario at 390x844 and 1440x900. EUL_E2E_ONLY=<name,name> and EUL_E2E_WIDTHS=<390,1440> narrow a run while
   working on one step; a full proof sets neither. */
const ONLY = (process.env.EUL_E2E_ONLY || '').split(',').filter(Boolean);
const WIDTHS = (process.env.EUL_E2E_WIDTHS || '').split(',').filter(Boolean).map(Number);
const runs = [{ width: 390, height: 844 }, { width: 1440, height: 900 }].filter((v) => !WIDTHS.length || WIDTHS.includes(v.width));
const SCENARIOS = { visibility, journey, switching, keyboard, worldHost };
{
  /* which tree the browser was given: the source checkout, or an export whose stamps were replaced and internals stripped */
  const page = await readFile(join(SERVE, 'action/league.html'), 'utf8');
  const exported = SERVE !== resolve(ROOT);
  console.log(`serving ${exported ? 'the export at ' : 'the source tree at '}${SERVE}`);
  if (exported) {
    let stripped = true;
    for (const internal of ['scripts', 'workers', 'supabase', 'docs']) { try { await stat(join(SERVE, internal)); stripped = false; } catch { /* absent, as published */ } }
    check('export', 'the page is the emitted one: stamps replaced, internals stripped', !page.includes('__STAMP__') && /\?v=[a-z0-9]+"/.test(page) && stripped);
  }
}
try {
  for (const viewport of runs) {
    for (const [name, fn] of Object.entries(SCENARIOS)) if (!ONLY.length || ONLY.includes(name)) await fn(viewport);
  }
} finally { await browser.close(); }
if (ONLY.length || WIDTHS.length) console.log('NARROWED RUN: ' + JSON.stringify({ only: ONLY, widths: WIDTHS }) + ' (not a full proof)');
if (results.some((r) => !r.pass)) process.exitCode = 1;
console.log(results.filter((r) => r.pass).length + '/' + results.length + ' checks passed');
