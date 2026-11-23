/* THE ALBUM KEEPS PLAYING WITH THE SCREEN LOCKED: the browser proof (music slice M1).

   Matthew, 2026-11-19: "when I'm playing music and I leave the browser, it stops
   playing music." The album room sent its deck through Web Audio for its light, and
   WebKit suspends Web Audio when Safari leaves the screen; the lane 01 probe S1 showed
   it in Chromium: with the page's AudioContexts suspended the deck still said
   "playing" and its clock stood still at 2.2 s.

   This drives the real pages in Chromium with default motion (the room's light on),
   every request answered by route fixtures from this checkout, nothing sent anywhere:
     1. album: every AudioContext the page made is suspended (what iOS does to Web Audio
        in the background) and the deck keeps advancing; the room still draws its light,
        from the measured peaks; hidden, blur, freeze and pagehide pause nothing
     2. album, an earned one-play: one request for the one play (lane 01 probe S3 made
        three: the deck, a second Audio probing the length, and the waveform's download)
     3. every player claims the playback audio session before it plays: the album deck,
        the listen engine, the pocket and the World soundtrack (navigator.audioSession is
        a WebKit API; Chromium has none, so a stand-in object records what is set)
     4. inside an in-app browser a music page says once where the music keeps playing
        with the screen locked; dismissed, it stays away for the session; day and night
     5. 390 px: every page this slice changed fits (scrollWidth === clientWidth)
     6. songs play to the end (music slice M3): a slow first read says Loading; a read that stops
        mid-track pauses the player honestly, says so, and picks up at the same second through the
        resolver that opened it (a public file, an earned one-play URL inside its time, a creator's
        signed URL signed again before it lapsed); an earned play whose time ran out is never claimed
        again by itself; a locked preview plays to its boundary and the album moves on; the World's
        stored mute never silences Music, and each music page shows its own Unmute; a music page reads
        no song before a tap

   What an iPhone does with the screen locked is not shown here: Chromium only stands in
   for it. That stays Inferred until Matthew's devices run the checklist
   (docs/music/MUSIC-RELEASE-20261119.md).

     node scripts/e2e/music-background.e2e.mjs [outDir]          (MUSIC_E2E_ONLY=<words>[|<words>]: those scenarios only)
   PLAYWRIGHT_DIR points at a node_modules folder with playwright (default /opt/node-tools/node_modules). */
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || '/tmp/music-background-proof';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const HOUSE = 'https://matthew.mccluster.org', WORLD = 'https://mccluster.org', API = 'https://api.mccluster.org';
const USER = '33333333-3333-4333-8333-333333333333';
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.gif': 'image/gif' };
const UA = {
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.3.21.111 (iPhone15,3; iOS 17_5; en_US; en; scale=3.00; 1290x2796; 600181178)',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
};
const HINT = 'To keep the music playing with your screen locked, open this page in Safari or Chrome.';

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--autoplay-policy=document-user-activation-required'] });
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: pass ? undefined : detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ' ' + JSON.stringify(detail)}`);
}
/* MUSIC_E2E_ONLY=<words>[|<words>] runs only the scenarios whose name holds them (a local check of one fix) */
const ONLY = (process.env.MUSIC_E2E_ONLY || '').split('|').filter(Boolean);
async function scenario(name, fn) {
  if (ONLY.length && !ONLY.some(w => name.includes(w))) return;
  try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e && e.message || e).slice(0, 600)); }
}
function jwt() {
  return 'x.' + Buffer.from(JSON.stringify({ sub: USER, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.y';
}
const EARNED = { mode: 'rule', allowed: true, missing: [], missions: { have: 3, need: 3 }, identity_verified: true };

/* one browser context with every request answered from this checkout or a fixture */
/* deliver(read) answers each audio read as the network would (music slice M3): null for a plain answer, or
   { delay } ms first, { cut } bytes at most (a short 206: the browser asks for the rest with a Range read),
   { status } instead of the bytes. read = { key, start, n } (n: that file's nth read). creator: a creator's
   release behind music-access, its signed URL's lifetime given by expiresIn(nth signing). */
async function setup({ width = 390, member = false, earned = false, ua, pocket = null, session = true, day = null,
  deliver = null, creator = null, expiresIn = 300, worldMute = false, standalone = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: width < 700, userAgent: ua,
    reducedMotion: 'no-preference', serviceWorkers: 'block', timezoneId: 'America/New_York' });
  const requests = [], errors = [], stream = { token: '', hits: [], claims: 0 }, reads = [], signed = [];
  /* the installed iPhone app (PR #820's dock): only navigator.standalone is stood in, as scripts/e2e/installed-app.e2e.mjs does */
  if (standalone) await context.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }); });
  await context.addInitScript(({ member, token, pocket, session, worldMute }) => {
    try {
      if (worldMute) localStorage.setItem('mcc_world_audio_preference', JSON.stringify({ muted: true }));
      localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
      sessionStorage.setItem('mcc_premiere', '1');   /* the once-a-session curtain is not what this proves */
      if (member && !localStorage.getItem('mccdb_session')) localStorage.setItem('mccdb_session', JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
      if (pocket && !sessionStorage.getItem('__pocketSeeded')) { localStorage.setItem('mcc-pocket', JSON.stringify(Object.assign({ at: Date.now() }, pocket))); sessionStorage.setItem('__pocketSeeded', '1'); }
    } catch (e) {}
    /* WebKit's audio session, stood in for: Chromium has no navigator.audioSession */
    if (session) Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } });
    window.__ctxs = []; window.__mes = []; window.__audios = [];
    const AC = window.AudioContext;
    if (AC) {
      const orig = AC.prototype.createMediaElementSource;
      AC.prototype.createMediaElementSource = function (el) { window.__mes.push(el.id || el.className || 'element'); return orig.call(this, el); };
      const Wrapped = function (...a) { const c = new AC(...a); window.__ctxs.push(c); return c; };
      Wrapped.prototype = AC.prototype;
      window.AudioContext = Wrapped; window.webkitAudioContext = Wrapped;
    }
    const NativeAudio = window.Audio;
    window.Audio = function (...a) { const x = new NativeAudio(...a); window.__audios.push(x); return x; };
    window.Audio.prototype = NativeAudio.prototype;
    /* what the page tells analytics and the listener, recorded on the way through */
    window.__events = []; window.__toasts = [];
    /* each function set is wrapped once, so a script that wraps it again (and calls the one it found) is
       recorded once and never loops */
    for (const [name, note] of [['MCC_TRACK', a => window.__events.push(a[0])], ['MCC_TOAST', a => window.__toasts.push(String(a[0]))]]) {
      let held, depth = 0;
      const wrap = v => typeof v !== 'function' ? v : function (...a) {
        if (!depth) note(a);
        depth++; try { return v.apply(this, a); } finally { depth--; }
      };
      Object.defineProperty(window, name, { configurable: true, get() { return held; }, set(v) { held = wrap(v); } });
    }
  }, { member, token: jwt(), pocket, session, worldMute });
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
  async function audio(r, file, extra = {}, key = '') {
    const buf = await readFile(file), range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || '');
    const read = { key: key || file.split(sep).pop(), start: range ? Number(range[1]) : 0, n: 0, at: Date.now(), status: 0 };
    read.n = reads.filter(q => q.key === read.key).length + 1;
    reads.push(read);
    const fault = deliver ? await deliver(read) : null;
    try {
      if (fault && fault.delay) await new Promise(res => setTimeout(res, fault.delay));
      if (fault && fault.status) { read.status = fault.status; read.at = Date.now(); return await r.fulfill({ status: fault.status, headers: { 'access-control-allow-origin': '*' }, body: '' }); }
      const headers = Object.assign({ 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, extra);
      const type = MIME[extname(file)] || 'application/octet-stream';
      if (!range) { read.status = 200; return await r.fulfill({ status: 200, contentType: type, headers, body: buf }); }
      const start = read.start;
      let end = Math.min(Number(range[2] || buf.length - 1), buf.length - 1);
      if (start >= buf.length) { read.status = 416; return await r.fulfill({ status: 416, headers: { 'content-range': `bytes */${buf.length}` } }); }
      if (fault && fault.cut) end = Math.min(end, start + fault.cut - 1);
      headers['content-range'] = `bytes ${start}-${end}/${buf.length}`;
      read.status = 206;
      return await r.fulfill({ status: 206, contentType: type, headers, body: buf.subarray(start, end + 1) });
    } catch (e) { /* the page moved on while this read was held */ }
  }
  await context.route('**/*', async r => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname;
    requests.push({ url: u.origin + p, type: req.resourceType(), method: req.method() });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.origin === API) {
      const s = /^\/v1\/music\/stream\/([0-9a-f]{64})$/.exec(p);
      if (s) {
        if (s[1] === stream.token) stream.hits.push({ type: req.resourceType(), range: req.headers().range || null });
        return audio(r, join(ROOT, 'assets/audio/pull-up.mp3'), {}, 'stream:' + s[1]);
      }
      if (/^\/v1\/music\/listens/.test(p)) return r.abort();
      const g = /^\/v1\/music\/gates\/([a-z0-9-]+)(\/play)?$/.exec(p);
      if (g && !g[2]) return json(r, { ok: true, gate: earned && member ? EARNED : { mode: 'rule', allowed: false, missing: ['sign_in'], missions: { have: 0, need: 3 }, identity_verified: false } });
      if (g && g[2] && earned && member) {
        stream.claims++;
        stream.token = (Date.now().toString(16) + 'b'.repeat(64)).slice(0, 64);
        return json(r, { ok: true, url: API + '/v1/music/stream/' + stream.token, expires_in: expiresIn, gate: EARNED });
      }
      if (g) return json(r, { error: 'Sign in' }, 401);
      return json(r, { error: 'fixture' }, 404);
    }
    if (u.hostname.endsWith('supabase.co')) {
      if (p === '/auth/v1/user') return member ? json(r, { id: USER }) : json(r, { msg: 'no' }, 401);
      if (p.startsWith('/auth/')) return json(r, { error: 'fixture' }, 400);
      if (p === '/functions/v1/music-access' && creator && member) {
        /* the creator's release, signed for this listener: the lifetime comes with the URL */
        signed.push(Date.now());
        const n = signed.length;
        return json(r, { ok: true, url: u.origin + '/storage/v1/object/sign/creator-audio/fixture-release.mp3?token=' + n, expires_in: creator.expiresIn(n) });
      }
      if (p.startsWith('/storage/v1/object/sign/') && creator) return audio(r, join(ROOT, 'assets/audio/pull-up.mp3'), {}, 'creator:' + u.searchParams.get('token'));
      if (p.startsWith('/functions/')) return json(r, { error: 'fixture' }, 401);
      return json(r, []);
    }
    if (u.origin === WORLD) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>World</title><body>World fixture</body>' });
    if (u.origin === HOUSE) {
      if (p.startsWith('/assets/audio/')) {
        const file = resolve(ROOT, '.' + decodeURIComponent(p));
        if (!file.startsWith(resolve(ROOT) + sep)) return r.fulfill({ status: 403 });
        try { await readFile(file); } catch { return r.fulfill({ status: 404 }); }
        return audio(r, file, {}, p.split('/').pop());
      }
      const path = resolve(ROOT, '.' + (p === '/' ? '/index.html' : decodeURIComponent(p)));
      if (path.startsWith(resolve(ROOT) + sep)) {
        try { return r.fulfill({ body: await readFile(path), contentType: MIME[extname(path)] || 'application/octet-stream', headers: { 'cache-control': 'no-store' } }); } catch {}
      }
      return r.fulfill({ status: 404, body: 'fixture: absent' });
    }
    return r.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 300)));
  if (day !== null) await page.clock.setFixedTime(new Date(day ? '2026-11-19T13:00:00-05:00' : '2026-11-19T22:30:00-05:00'));
  return { context, page, requests, errors, stream, reads, signed };
}
const sleep = ms => new Promise(res => setTimeout(res, ms));
/* ONE SONG'S MID-TRACK DROP (music slice M3). Its first read stops early, so the browser asks for the rest
   with a Range read; that read is held for a few seconds of playback and refused, and every read in the
   next `down` ms is refused too. After that each read from the top is cut short, so the way back to the
   second the song stopped is a Range read from the middle of the file. `first` may also hold a delay. */
function drop({ match, first, hold = 5000, down = 2500, status = 503, after = 65536 }) {
  const s = { failedAt: 0, refused: 0 };
  s.deliver = async (q) => {
    if (!match(q.key)) return null;
    if (!s.failedAt) {
      if (q.n === 1) return first;
      if (q.start > 0) { await sleep(hold); s.failedAt = Date.now(); s.refused++; return { status }; }
      return null;
    }
    if (Date.now() - s.failedAt < down) { s.refused++; return { status }; }
    return q.start === 0 ? { cut: after } : null;
  };
  return s;
}
/* every playing/pause/error on an element, with the second it happened at */
const traceOf = (page, expr) => page.evaluate(expr => {
  const a = eval(expr); window.__trace = [];
  for (const t of ['playing', 'pause', 'error', 'waiting']) a.addEventListener(t, () => window.__trace.push({ t, at: a.currentTime, paused: a.paused }));
}, expr);
const engineUi = page => page.evaluate(() => {
  const d = window.MCC_MUSIC.delivery ? MCC_MUSIC.delivery() : {};
  return { state: d.state, at: d.at, paused: MCC_MUSIC.audio.paused, t: MCC_MUSIC.audio.currentTime, muted: MCC_MUSIC.audio.muted,
    label: document.getElementById('musicMiniAccess').textContent, note: (document.getElementById('musicMiniNote') || {}).textContent || '',
    button: document.getElementById('musicMiniPlay').getAttribute('aria-label'), ms: navigator.mediaSession ? navigator.mediaSession.playbackState : null,
    live: (document.getElementById('musicMiniLive') || {}).textContent || '' };
});
const deckUi = page => page.evaluate(() => {
  const d = document.getElementById('deck'), s = document.getElementById('seekStatus');
  return { paused: d.paused, t: d.currentTime, muted: d.muted, src: d.currentSrc, time: document.getElementById('npTime').textContent,
    status: s && !s.hidden ? s.textContent : '', ms: navigator.mediaSession ? navigator.mediaSession.playbackState : null,
    button: /M7 5h3\.4v14H7z/.test(document.getElementById('tpPlayIc').innerHTML) ? 'Pause' : 'Play',
    /* the bar's own transport (its Music tab: is-sound shows the pause glyph) and the album's Play all */
    bar: (() => { const t = document.querySelector('[data-appnav="music"]'); return t ? (t.classList.contains('is-sound') ? 'Pause' : 'Play') : null; })(),
    playAll: (document.getElementById('playAll') || {}).textContent || '' };
});
const deckState = page => page.evaluate(() => { const d = document.getElementById('deck'); return { t: d.currentTime, paused: d.paused, src: d.currentSrc }; });
const fits = page => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
async function hide(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('freeze'));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  });
}
async function show(page) {
  await page.evaluate(() => { delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
}

try {
  await scenario('album, default motion', async () => {
    const { context, page, requests, errors } = await setup({ width: 390 });
    await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
    await page.waitForSelector('#tracks li', { timeout: 20000 });
    await page.locator('#tracks li').first().click();
    await page.waitForFunction(() => { const d = document.getElementById('deck'); return !d.paused && d.currentTime > 1.2; }, null, { timeout: 20000 });
    const song = (await deckState(page)).src;
    const wiring = await page.evaluate(() => ({ routed: window.__mes.slice(), contexts: window.__ctxs.length, chamber: document.documentElement.getAttribute('data-chamber'),
      live: document.documentElement.classList.contains('sig-live'), session: navigator.audioSession.type }));
    check('album: the deck is never routed through Web Audio (no createMediaElementSource)', wiring.routed.length === 0, wiring);
    check('album: the deck claimed the playback audio session before it played', wiring.session === 'playback', wiring);
    check('album: the room is drawn and lit while the record plays', ['gl', '2d'].includes(wiring.chamber) && wiring.live, wiring);
    const amps = [];
    for (let i = 0; i < 10; i++) { amps.push(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--amp')) || 0)); await page.waitForTimeout(160); }
    check('album: the room\'s light moves with the record', new Set(amps.map(a => a.toFixed(3))).size >= 4 && Math.max(...amps) > 0.05, amps);

    /* the background, stood in for: WebKit suspends Web Audio when Safari leaves the screen */
    const t0 = await page.evaluate(async () => { await Promise.all(window.__ctxs.map(c => c.suspend().catch(() => {}))); return document.getElementById('deck').currentTime; });
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ t: document.getElementById('deck').currentTime, paused: document.getElementById('deck').paused, contexts: window.__ctxs.map(c => c.state) }));
    check('album: with every AudioContext the page made suspended, the deck clock keeps advancing', !after.paused && after.t - t0 > 1.0, { t0, ...after });

    /* leaving the page in view pauses nothing, and draws nothing */
    await hide(page);
    const h0 = await deckState(page), amp0 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--amp'));
    await page.waitForTimeout(1200);
    const h1 = await deckState(page), amp1 = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--amp'));
    check('album: hidden, blur, freeze and pagehide do not pause the deck', !h1.paused && h1.t - h0.t > 0.8, { h0, h1 });
    check('album: the light stands still while the page is hidden', amp0 === amp1, { amp0, amp1 });
    await show(page);

    const songUrl = new URL(song).origin + new URL(song).pathname;
    const reads = requests.filter(q => q.url === songUrl);
    check('album: the song is read by the deck alone (no second download for the waveform)', reads.length > 0 && reads.every(q => q.type === 'media'), reads);
    const key = new URL(song).pathname.split('/').pop().replace(/\.[a-z0-9]+$/i, '');
    const peaks = requests.filter(q => q.url === HOUSE + '/data/peaks/' + key + '.json');
    check('album: the measured peaks are read once for the song', peaks.length === 1, peaks);

    await page.locator('.deckbar__meta').click();
    await page.waitForFunction(() => document.getElementById('now').getAttribute('data-on') === '1');
    await page.waitForTimeout(400);
    const wave = await page.evaluate(() => {
      const seek = document.getElementById('nowSeek'), cv = seek && seek.querySelector('canvas');
      if (!cv || !cv.width) return { on: seek && seek.classList.contains('wave-on'), drawn: 0 };
      const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let drawn = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) drawn++;
      return { on: seek.classList.contains('wave-on'), drawn };
    });
    check('album: the seek bar draws the record\'s waveform', wave.on && wave.drawn > 200, wave);
    check('album at 390: the page fits the screen', await fits(page));
    await page.screenshot({ path: join(OUT, 'album-390-playing.png') });
    check('album: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('album, earned one-play', async () => {
    const { context, page, stream, requests, errors } = await setup({ width: 390, member: true, earned: true });
    await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
    await page.waitForFunction(() => { const r = document.querySelector('#tracks li[data-gated-bucket]'); return r && r.getAttribute('data-gate') === 'earned'; }, null, { timeout: 20000 });
    await page.locator('#tracks li[data-gated-bucket]').click();
    await page.waitForFunction(() => /\/v1\/music\/stream\//.test(document.getElementById('deck').currentSrc), null, { timeout: 15000 });
    await page.waitForTimeout(3000);
    check('earned play: one request for the one play (no download for the waveform, no second Audio probing its length)',
      stream.hits.length === 1 && stream.hits[0].type === 'media', stream.hits);
    const peaks = requests.filter(q => /\/data\/peaks\//.test(q.url)).map(q => q.url);
    check('earned play: the private master is never asked for its shape (only public files have peaks)', peaks.every(u => /\/data\/peaks\/[a-z0-9._-]+\.json$/.test(u)) && !peaks.some(u => /niggy-nigg\.json$/.test(u)), peaks);
    check('earned play: the deck claimed the playback audio session', await page.evaluate(() => navigator.audioSession.type) === 'playback');
    /* lane 01 S3 (PB-2): the muted start that keeps the tap's permission once paused the claimed play at 0.01 s */
    const s3 = await deckState(page);
    check('earned play: the first tap plays the claimed song through (never paused at the start)', !s3.paused && s3.t > 1.5, s3);
    check('earned play: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('listen engine', async () => {
    const { context, page, errors } = await setup({ width: 390 });
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.MCC_MUSIC && document.querySelector('[data-music-play][data-album="here"]'), null, { timeout: 20000 });
    await page.locator('[data-music-play][data-album="here"]').first().click();
    await page.waitForFunction(() => !MCC_MUSIC.audio.paused && MCC_MUSIC.audio.currentTime > 0.3, null, { timeout: 15000 });
    check('listen: the engine claimed the playback audio session before it played', await page.evaluate(() => navigator.audioSession.type) === 'playback');
    await hide(page);
    const e0 = await page.evaluate(() => MCC_MUSIC.audio.currentTime);
    await page.waitForTimeout(1200);
    const e1 = await page.evaluate(() => ({ t: MCC_MUSIC.audio.currentTime, paused: MCC_MUSIC.audio.paused }));
    check('listen: hidden, blur, freeze and pagehide do not pause the engine', !e1.paused && e1.t - e0 > 0.8, { e0, e1 });
    await show(page);
    check('listen: no Web Audio anywhere on the page', await page.evaluate(() => window.__ctxs.length === 0 && window.__mes.length === 0));
    check('listen at 390: the page fits the screen', await fits(page));
    check('listen: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('pocket', async () => {
    const { context, page, errors } = await setup({ width: 390, pocket: { src: 'assets/audio/here.mp3', title: 'Here', album: 'here', artist: 'Matthew McCluster', t: 4, playing: true } });
    await page.goto(HOUSE + '/catalogue.html', { waitUntil: 'load' });
    await page.waitForSelector('.pocket .pocket__play', { timeout: 15000 });
    await page.waitForTimeout(600);
    const played = await page.evaluate(() => { const a = document.querySelector('.pocket__audio'); return !!a && !a.paused; });
    if (!played) await page.locator('.pocket .pocket__play').click({ force: true });   /* the tile breathes; a real tap all the same */
    await page.waitForFunction(() => { const a = document.querySelector('.pocket__audio'); return a && !a.paused && a.currentTime > 0; }, null, { timeout: 15000 });
    check('pocket: it claimed the playback audio session before it played', await page.evaluate(() => navigator.audioSession.type) === 'playback');
    check('catalogue with the pocket at 390: the page fits the screen', await fits(page));
    check('pocket: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('World soundtrack', async () => {
    const { context, page, errors } = await setup({ width: 390 });
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MCC_WORLD_AUDIO && !!window.MCC_BAR && !!window.MCC_MUSIC, null, { timeout: 20000 });
    await page.locator('.appbar [data-appnav="world"]').click();
    await page.waitForFunction(() => window.__audios.some(a => !a.paused && a.currentTime > 0.2), null, { timeout: 15000 });
    check('World soundtrack: it claimed the playback audio session before it played', await page.evaluate(() => navigator.audioSession.type) === 'playback');
    check('World soundtrack: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('in-app browser note', async () => {
    {
      const { context, page, errors } = await setup({ width: 390, ua: UA.instagram });
      await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
      const note = page.locator('.np-hint');
      await note.waitFor({ timeout: 10000 });
      check('in-app: the album says where the music keeps playing with the screen locked', (await note.innerText()).includes(HINT), await note.innerText());
      check('in-app: the note is one small line, not a wall', (await note.boundingBox()).height <= 96, await note.boundingBox());
      check('in-app album at 390: the page fits the screen with the note', await fits(page));
      await page.screenshot({ path: join(OUT, 'album-390-instagram-note.png') });
      await page.locator('.np-hint button').click();
      check('in-app: one tap puts the note away', await note.count() === 0 || !(await note.isVisible()));
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(800);
      check('in-app: put away, it stays away for the session', await page.locator('.np-hint').count() === 0);
      check('in-app: no redirect, the page stays the album', new URL(page.url()).pathname === '/album.html');
      check('in-app album: no script errors', errors.length === 0, errors);
      await context.close();
    }
    for (const day of [true, false]) {
      const { context, page, errors } = await setup({ width: 390, ua: UA.instagram, day });
      await page.goto(HOUSE + '/music-creator.html?handle=fixture-artist', { waitUntil: 'load' });
      const note = page.locator('.np-hint');
      await note.waitFor({ timeout: 10000 });
      const look = await page.evaluate(() => {
        const n = document.querySelector('.np-hint'), cs = getComputedStyle(n);
        const lum = c => { const m = c.match(/[\d.]+/g).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
        return { theme: document.documentElement.getAttribute('data-theme'), bg: lum(cs.backgroundColor), fg: lum(cs.color), room: lum(getComputedStyle(document.body).backgroundColor) };
      });
      const want = day ? 'light' : 'dark';
      check(`in-app ${day ? 'by day' : 'by night'} (${want} coat): the artist page's note wears the room's own surface and reads clearly`,
        look.theme === want && Math.abs(look.bg - look.fg) > 0.5 && ((look.room > 0.6) === (look.bg > 0.6)), look);
      check(`in-app artist page at 390 ${day ? 'by day' : 'by night'}: the page fits the screen with the note`, await fits(page));
      await page.screenshot({ path: join(OUT, `artist-390-instagram-${day ? 'day' : 'night'}.png`) });
      check(`in-app artist page ${day ? 'by day' : 'by night'}: no script errors`, errors.length === 0, errors);
      await context.close();
    }
    {
      const { context, page } = await setup({ width: 390, ua: UA.instagram });
      await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
      await page.locator('.np-hint').waitFor({ timeout: 10000 });
      check('in-app: a new session shows the note again, on the listen page too', await page.locator('.np-hint').isVisible());
      check('in-app listen at 390: the page fits the screen with the note', await fits(page));
      /* the other music rooms get the helper from the bar (js/tabbar.js loads it before the World soundtrack) */
      for (const room of ['/catalogue.html', '/license.html', '/prim3-artist.html']) {
        await page.goto(HOUSE + room, { waitUntil: 'load' });
        await page.locator('.np-hint').waitFor({ timeout: 10000 }).catch(() => {});
        const shown = await page.locator('.np-hint').count();
        check(`in-app ${room.slice(1)} at 390: one note, and the page fits the screen`, shown === 1 && await fits(page), { shown, fits: await fits(page) });
      }
      /* the lyric video feed plays video, which no browser keeps playing with the screen locked: the line would not be true there */
      await page.goto(HOUSE + '/music-videos.html', { waitUntil: 'load' });
      await page.waitForTimeout(1200);
      check('in-app music-videos.html: no note (a video feed), and the page fits the screen at 390', await page.locator('.np-hint').count() === 0 && await fits(page));
      await page.goto(HOUSE + '/account.html', { waitUntil: 'load' });
      await page.waitForTimeout(1200);
      check('in-app: a page that is not a music page carries no note', await page.locator('.np-hint').count() === 0);
      await context.close();
    }
    {
      const { context, page } = await setup({ width: 390, ua: UA.safari });
      await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
      await page.waitForTimeout(1200);
      check('Safari: no note, the browser already keeps the music playing', await page.locator('.np-hint').count() === 0);
      await context.close();
    }
  });

  /* ------------------------------------------------------------------------------------------------------
     SONGS PLAY TO THE END (music slice M3; music map 02 DEL-6/T6, 01 PB-4/PB-5/PB-6/PB-12)
     ------------------------------------------------------------------------------------------------------ */
  await scenario('listen engine, public song: slow first read, then a mid-track drop', async () => {
    const song = 'who-did-the-shoot.mp3';
    const fault = drop({ match: k => k === song, first: { delay: 4000, cut: 480000 } });
    const { context, page, errors, reads } = await setup({ width: 390, deliver: fault.deliver });
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.MCC_MUSIC && document.querySelector('[data-music-play][data-album="here"][data-track="Who Did The Shoot"]'), null, { timeout: 20000 });
    await traceOf(page, 'MCC_MUSIC.audio');
    await page.locator('[data-music-play][data-album="here"][data-track="Who Did The Shoot"]').first().click();
    await page.waitForFunction(() => window.MCC_MUSIC.delivery && MCC_MUSIC.delivery().state === 'loading', null, { timeout: 3800 }).catch(() => {});
    const slow = await engineUi(page);
    check('slow read: while the first bytes are on the way the player says Loading…, not Full track', slow.state === 'loading' && slow.label === 'Loading…', slow);
    await page.waitForFunction(() => !MCC_MUSIC.audio.paused && MCC_MUSIC.audio.currentTime > .5, null, { timeout: 15000 });
    check('slow read: once the sound starts the label is the song\'s own again', (await engineUi(page)).label === 'Full track', await engineUi(page));
    await page.waitForFunction(() => window.MCC_MUSIC.delivery && MCC_MUSIC.delivery().state === 'reconnecting', null, { timeout: 15000 }).catch(() => {});
    const down = await engineUi(page);
    /* the element is quiet and the player says why; its one button is Pause, which stops the tries, and the lock
       screen offers the same (review PB-R3: every transport offered only Play, and Play tried again at once) */
    check('mid-track drop: the element is quiet, the player says Reconnecting…, and its one button and the lock screen offer Pause',
      down.state === 'reconnecting' && down.paused && down.label === 'Reconnecting…' && down.button === 'Pause' && down.ms === 'playing', down);
    /* review RL-5: a live region inside the mini player's button is not read out; the spoken line sits beside it */
    const spoken = await page.evaluate(() => ({ inButton: document.querySelectorAll('#musicMini button [role=status], #musicMini button [aria-live]').length,
      live: document.getElementById('musicMiniLive') && !document.getElementById('musicMiniLive').closest('button') && document.getElementById('musicMiniLive').getAttribute('role') }));
    check('mid-track drop: the line is spoken from a live region outside the button, with the same words', spoken.inButton === 0 && spoken.live === 'status' && down.live === down.note, { spoken, down });
    check('mid-track drop: one short line says where it stopped and that it is picking up there', /^The connection dropped at 0:0\d\. Picking up there…$/.test(down.note), down.note);
    check('mid-track drop at 390: the page fits the screen with the line', await fits(page));
    await page.screenshot({ path: join(OUT, 'listen-390-reconnecting.png') });
    const at = down.at || 0;
    await page.waitForFunction(at => !MCC_MUSIC.audio.paused && MCC_MUSIC.audio.currentTime > at + 1, at, { timeout: 20000 }).catch(() => {});
    const back = await engineUi(page), trace = await page.evaluate(() => window.__trace);
    const resumed = trace.filter(e => e.t === 'playing').pop();
    check('mid-track drop: it picks up at the second it stopped, in the same player', !back.paused && resumed && resumed.at >= at - .5 && back.t > at, { at, back, resumed });
    const later = reads.filter(q => q.key === song && q.at >= fault.failedAt);
    check('mid-track drop: the way back is a Range read from the middle of the file', fault.refused >= 1 && later.some(q => q.start > 0 && q.status === 206), later);
    check('mid-track drop: back to its own label, the line gone', back.label === 'Full track' && back.note === '', back);
    const events = await page.evaluate(() => window.__events);
    check('mid-track drop: recorded as an interruption, never as a finished song', events.includes('music_interrupted') && !events.includes('music_complete'), events);
    check('listen engine, delivery: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('listen engine, a creator\'s release: signed again before it lapses; an expired URL picks up at the same second', async () => {
    let firstAt = 0;
    const state = {};
    const deliver = async (q) => {
      if (q.key === 'creator:1') {
        if (q.n === 1) { firstAt = Date.now(); return { cut: 240000 }; }
        if (q.n === 2 && q.start > 0) {
          for (let i = 0; i < 150 && state.signed().length < 2; i++) await sleep(100);   // held until the URL has been signed again (15 s at most)
          await sleep(Math.max(0, 5000 - (Date.now() - firstAt)));
          state.expiredAt = Date.now();
          return { status: 400 };                                    // what Storage answers an expired signature
        }
        return { status: 400 };
      }
      if (q.key === 'creator:2' && q.start === 0) return { cut: 65536 };
      return null;
    };
    const { context, page, errors, reads, signed } = await setup({ width: 390, member: true, deliver,
      creator: { expiresIn: n => n === 1 ? 62 : 3600 } });
    state.signed = () => signed;
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.MCC_MUSIC && MCC_MUSIC.registerCreatorTrack, null, { timeout: 20000 });
    await page.evaluate(() => {
      MCC_MUSIC.registerCreatorTrack({ id: 'fixture-release', title: 'Fixture Release', artist: 'Fixture Artist', access_mode: 'members' });
      const b = document.createElement('button'); b.id = '__fixturePlay'; b.type = 'button'; b.textContent = 'Play the fixture release';
      b.style.cssText = 'position:fixed;left:0;top:0;width:44px;height:44px;opacity:0;z-index:2147483647';
      b.onclick = () => MCC_MUSIC.playCreator('fixture-release');
      document.body.appendChild(b);
    });
    await traceOf(page, 'MCC_MUSIC.audio');
    await page.click('#__fixturePlay');
    await page.waitForFunction(() => !MCC_MUSIC.audio.paused && MCC_MUSIC.audio.currentTime > .5, null, { timeout: 15000 });
    await page.waitForFunction(() => window.MCC_MUSIC.delivery && MCC_MUSIC.delivery().state === 'reconnecting', null, { timeout: 20000 }).catch(() => {});
    const down = await engineUi(page);
    check('creator: the signed URL (62 s left) is signed again about a minute before it lapses, while the song plays',
      signed.length === 2 && signed[1] - signed[0] >= 1500 && signed[1] - signed[0] < 9000, signed.map(t => t - signed[0]));
    check('creator: the expired URL quiets the player honestly (Reconnecting…, its one button Pause, which stops the tries)', down.state === 'reconnecting' && down.paused && down.label === 'Reconnecting…' && down.button === 'Pause', down);
    const at = down.at || 0;
    await page.waitForFunction(at => !MCC_MUSIC.audio.paused && MCC_MUSIC.audio.currentTime > at + 1, at, { timeout: 20000 }).catch(() => {});
    const back = await engineUi(page), trace = await page.evaluate(() => window.__trace);
    const resumed = trace.filter(e => e.t === 'playing').pop();
    const fresh = reads.filter(q => q.key === 'creator:2');
    check('creator: it picks up at the same second on the URL signed ahead, with no further signing', !back.paused && resumed && resumed.at >= at - .5 && fresh.length > 0 && signed.length === 2,
      { at, back, resumed, fresh, signings: signed.length });
    check('creator: the way back reads the new URL from the middle of the file', fresh.some(q => q.start > 0 && q.status === 206), fresh);
    check('creator: the expired URL is not read again', reads.filter(q => q.key === 'creator:1').length === 2, reads.filter(q => q.key === 'creator:1'));
    check('listen engine, creator delivery: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('album, public song: a mid-track drop', async () => {
    const song = 'who-did-the-shoot.mp3';
    const fault = drop({ match: k => k === song, first: { cut: 480000 } });
    const { context, page, errors, reads } = await setup({ width: 390, deliver: fault.deliver });
    await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
    await page.waitForSelector('#tracks li', { timeout: 20000 });
    await traceOf(page, 'document.getElementById("deck")');
    await page.locator('#tracks li').first().click();
    await page.waitForFunction(() => { const d = document.getElementById('deck'); return !d.paused && d.currentTime > .5; }, null, { timeout: 15000 });
    await page.waitForFunction(() => /^Reconnecting…/.test(document.getElementById('npTime').textContent), null, { timeout: 15000 }).catch(() => {});
    const down = await deckUi(page);
    check('album drop: the deck is quiet and says Reconnecting…; the deck bar and the lock screen offer Pause, which stops the tries', down.paused && /^Reconnecting… · /.test(down.time) && down.button === 'Pause' && down.ms === 'playing', down);
    check('album drop: one short line says where it stopped and that it is picking up there', /^The connection dropped at 0:0\d\. Picking up there…$/.test(down.status), down.status);
    check('album drop: the bar\'s own transport and Play all offer Pause too (the browser\'s own pause after the error made them say Play)',
      down.bar === 'Pause' && /Pause/.test(down.playAll), { bar: down.bar, playAll: down.playAll });
    check('album drop at 390: the page fits the screen with the line', await fits(page));
    await page.screenshot({ path: join(OUT, 'album-390-reconnecting.png') });
    const at = (await page.evaluate(() => window.__trace.filter(e => e.t === 'error').map(e => e.at)))[0] || 0;
    await page.waitForFunction(at => { const d = document.getElementById('deck'); return !d.paused && d.currentTime > at + 1; }, at, { timeout: 20000 }).catch(() => {});
    const back = await deckUi(page), trace = await page.evaluate(() => window.__trace);
    const resumed = trace.filter(e => e.t === 'playing').pop();
    check('album drop: it picks up at the second it stopped', !back.paused && resumed && resumed.at >= at - .5 && back.t > at, { at, back, resumed });
    check('album drop: the way back is a Range read from the middle of the file', reads.some(q => q.key === song && q.at >= fault.failedAt && q.start > 0 && q.status === 206), reads.filter(q => q.key === song));
    check('album drop: the line is gone once it plays again', back.status === '' && !/Reconnecting/.test(back.time), back);
    const events = await page.evaluate(() => window.__events);
    check('album drop: recorded as an interruption, never as a finished song', events.includes('music_interrupted') && !events.includes('music_complete'), events);
    check('album, delivery: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('album, an earned one-play: a drop inside its time, and a play whose time ran out', async () => {
    {
      const fault = drop({ match: k => k.startsWith('stream:'), first: { cut: 240000 } });
      const { context, page, stream, reads, errors } = await setup({ width: 390, member: true, earned: true, deliver: fault.deliver });
      await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
      await page.waitForFunction(() => { const r = document.querySelector('#tracks li[data-gated-bucket]'); return r && r.getAttribute('data-gate') === 'earned'; }, null, { timeout: 20000 });
      await traceOf(page, 'document.getElementById("deck")');
      await page.locator('#tracks li[data-gated-bucket]').click();
      await page.waitForFunction(() => /^Reconnecting…/.test(document.getElementById('npTime').textContent), null, { timeout: 20000 }).catch(() => {});
      const down = await deckUi(page);
      check('earned play, drop inside its time: the deck pauses and says Reconnecting…', down.paused && /^Reconnecting… · /.test(down.time), down);
      const at = (await page.evaluate(() => window.__trace.filter(e => e.t === 'error').map(e => e.at)))[0] || 0;
      await page.waitForFunction(at => { const d = document.getElementById('deck'); return !d.paused && d.currentTime > at + 1; }, at, { timeout: 20000 }).catch(() => {});
      const back = await deckUi(page), resumed = (await page.evaluate(() => window.__trace)).filter(e => e.t === 'playing').pop();
      const tokens = new Set(reads.filter(q => q.key.startsWith('stream:')).map(q => q.key));
      check('earned play, drop inside its time: it picks up at the same second on the same play (one claim, one URL)',
        !back.paused && resumed && resumed.at >= at - .5 && stream.claims === 1 && tokens.size === 1, { at, back, resumed, claims: stream.claims, tokens: [...tokens].length });
      check('earned play, drop: the way back is a Range read from the middle of the master', reads.some(q => q.key.startsWith('stream:') && q.at >= fault.failedAt && q.start > 0 && q.status === 206));
      check('earned play, drop: no script errors', errors.length === 0, errors);
      await context.close();
    }
    {
      /* the play's time (12 s here, 300 s on the Worker) is within its last ten seconds when the read fails:
         the stream would refuse it, so the deck says the play is over and never claims another by itself */
      let held = 0;
      const deliver = async (q) => {
        if (!q.key.startsWith('stream:')) return null;
        if (q.n === 1) return { cut: 240000 };
        if (q.n === 2 && q.start > 0) { await sleep(4000); held = Date.now(); return { status: 410 }; }
        return { status: 410 };
      };
      const { context, page, stream, reads, errors } = await setup({ width: 390, member: true, earned: true, expiresIn: 12, deliver });
      await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
      await page.waitForFunction(() => { const r = document.querySelector('#tracks li[data-gated-bucket]'); return r && r.getAttribute('data-gate') === 'earned'; }, null, { timeout: 20000 });
      await page.locator('#tracks li[data-gated-bucket]').click();
      await page.waitForFunction(() => /time ran out/.test((document.getElementById('seekStatus') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
      await sleep(8000);
      const ui = await deckUi(page), toasts = await page.evaluate(() => window.__toasts);
      const after = reads.filter(q => q.key.startsWith('stream:') && held && q.at > held + 50);
      check('expired play: the deck stops and says so, never playing over silence', ui.paused && ui.status === 'The connection dropped and this play\'s time ran out. Playing it again starts a new play.', ui);
      check('expired play: never claimed again by itself, and the expired URL is not read again', stream.claims === 1 && after.length === 0, { claims: stream.claims, after });
      check('expired play: the listener is told once', toasts.filter(m => /time ran out/.test(m)).length === 1, toasts);
      check('expired play: the row goes back to its preview (the play is over)', await page.evaluate(() => !document.querySelector('#tracks li[data-gated-bucket]').hasAttribute('data-granted')));
      check('expired play at 390: the page fits the screen with the line', await fits(page));
      check('expired play: no script errors', errors.length === 0, errors);
      await context.close();
    }
  });

  await scenario('album, a locked preview', async () => {
    const { context, page, errors } = await setup({ width: 390 });
    await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
    await page.waitForSelector('#tracks li[data-gated-bucket]', { timeout: 20000 });
    await page.locator('#tracks li[data-gated-bucket] .t').click();   /* the title: the row's chip is a way to the full song */
    await page.waitForFunction(() => /niggy-nigg-preview/.test(document.getElementById('deck').currentSrc), null, { timeout: 15000 });
    await page.waitForFunction(() => { const d = document.getElementById('deck'); return !/niggy-nigg-preview/.test(d.currentSrc) && !d.paused && d.currentTime > .3; }, null, { timeout: 20000 }).catch(() => {});
    const ui = await deckUi(page), toasts = await page.evaluate(() => window.__toasts);
    check('locked preview: it plays to its boundary and the album moves on (never stops the record)', !ui.paused && /\/assets\/audio\/you-the-feds\.m4a$/.test(new URL(ui.src).pathname), ui);
    check('locked preview: one short line says what it was', toasts.some(m => /^That was the preview\./.test(m)), toasts);
    check('locked preview: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('the World\'s mute is the World\'s (decision D-7)', async () => {
    {
      const { context, page, errors } = await setup({ width: 390, worldMute: true });
      await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
      await page.waitForFunction(() => window.MCC_MUSIC && document.querySelector('[data-music-play][data-album="here"]'), null, { timeout: 20000 });
      await page.locator('[data-music-play][data-album="here"]').first().click();
      await page.waitForFunction(() => !MCC_MUSIC.audio.paused && MCC_MUSIC.audio.currentTime > .3, null, { timeout: 15000 });
      const heard = await engineUi(page);
      check('stored World mute: a Music song is not silenced by it', !heard.muted && heard.label === 'Full track', heard);
      await page.evaluate(() => { MCC_MUSIC.audio.muted = true; });
      await page.waitForFunction(() => document.getElementById('musicMiniAccess').textContent === 'Muted');
      const sound = page.locator('#musicMiniSound');
      const box = await sound.boundingBox();
      check('a muted Music song says Muted and shows its own Unmute (44 px)', await sound.isVisible() && box && box.height >= 44 && box.width >= 44, box);
      check('listen at 390 with Unmute showing: the page fits the screen', await fits(page));
      await page.screenshot({ path: join(OUT, 'listen-390-muted.png') });
      await sound.click();
      const un = await engineUi(page);
      check('Unmute brings the sound back on the Music page', !un.muted && un.label === 'Full track' && !(await sound.isVisible()), un);
      check('the World keeps its own stored mute', await page.evaluate(() => JSON.parse(localStorage.getItem('mcc_world_audio_preference') || '{}').muted === true));
      await page.evaluate(() => { MCC_MUSIC.audio.muted = true; });
      await page.waitForFunction(() => !document.getElementById('musicMiniSound').hidden);
      await page.focus('#musicMiniSound'); await page.keyboard.press('Enter');
      const kb = await page.evaluate(() => ({ muted: MCC_MUSIC.audio.muted, active: document.activeElement && (document.activeElement.id || document.activeElement.tagName) }));
      check('Unmute from the keyboard keeps the focus in the player, on its Play/Pause (review RL-4: it fell to the page)', !kb.muted && kb.active === 'musicMiniPlay', kb);
      check('stored World mute, listen: no script errors', errors.length === 0, errors);
      await context.close();
    }
    {
      const { context, page, errors } = await setup({ width: 390, worldMute: true });
      await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
      await page.waitForSelector('#tracks li', { timeout: 20000 });
      await page.locator('#tracks li').first().click();
      await page.waitForFunction(() => { const d = document.getElementById('deck'); return !d.paused && d.currentTime > .3; }, null, { timeout: 15000 });
      check('stored World mute: the album deck is not silenced by it', !(await deckUi(page)).muted);
      await page.evaluate(() => { document.getElementById('deck').muted = true; });
      const sound = page.locator('#deckSound');
      await sound.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      const box = await sound.boundingBox();
      check('a muted deck says Muted and shows its own Unmute (44 px)', /^Muted · /.test((await deckUi(page)).time) && box && box.height >= 44 && box.width >= 44, { time: (await deckUi(page)).time, box });
      check('album at 390 with Unmute showing: the page fits the screen', await fits(page));
      await page.screenshot({ path: join(OUT, 'album-390-muted.png') });
      await sound.click();
      check('Unmute brings the deck\'s sound back', !(await deckUi(page)).muted && !(await sound.isVisible()));
      await page.evaluate(() => { document.getElementById('deck').muted = true; });
      await page.waitForFunction(() => !document.getElementById('deckSound').hidden);
      await page.focus('#deckSound'); await page.keyboard.press('Enter');
      const kb = await page.evaluate(() => ({ muted: document.getElementById('deck').muted, active: document.activeElement && (document.activeElement.id || document.activeElement.tagName) }));
      check('album: Unmute from the keyboard keeps the focus in the player, on its Play/Pause (review RL-4)', !kb.muted && kb.active === 'tpPlay', kb);
      check('stored World mute, album: no script errors', errors.length === 0, errors);
      await context.close();
    }
  });

  /* ------------------------------------------------------------------------------------------------------
     THE REVIEW OF M3 (music slice M3, review round): each check below failed at 0e687e51.
     ------------------------------------------------------------------------------------------------------ */
  const WDTS = '[data-music-play][data-album="here"][data-track="Who Did The Shoot"]';
  async function listenPlay(page) {
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await page.waitForFunction(sel => window.MCC_MUSIC && document.querySelector(sel), WDTS, { timeout: 20000 });
    await page.locator(WDTS).first().click();
  }
  async function albumPlay(page) {
    await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
    await page.waitForSelector('#tracks li', { timeout: 20000 });
    await page.locator('#tracks li').first().click();
  }
  await scenario('listen engine: every try starts inside the ten seconds after the sound stopped, and a read that hangs is noticed in time', async () => {
    const song = 'who-did-the-shoot.mp3';
    {
      let failedAt = 0;
      const deliver = async (q) => {
        if (q.key !== song) return null;
        if (q.n === 1) return { cut: 96000 };
        if (!failedAt) failedAt = Date.now();
        return { status: 503 };                        // the network is down from here on
      };
      const { context, page, reads, errors } = await setup({ width: 390, deliver });
      await listenPlay(page);
      await page.waitForFunction(() => window.MCC_MUSIC.delivery && MCC_MUSIC.delivery().state === 'lost', null, { timeout: 30000 }).catch(() => {});
      const ui = await engineUi(page);
      const tries = reads.filter(q => q.key === song && q.n > 2).map(q => q.at - failedAt);
      check('network down: five tries, each starting inside the ten seconds after the sound stopped (review PB-R1: 0.5, 2, 5.5 and 13 s)',
        tries.length === 5 && tries.every(ms => ms < 9500), tries);
      check('network down: then it says so, and how to pick it up', ui.state === 'lost' && ui.label === 'Connection lost' && ui.button === 'Play' &&
        /^The connection dropped\. Tap play to pick up at 0:0\d\.$/.test(ui.note), ui);
      check('network down: no script errors', errors.length === 0, errors);
      await context.close();
    }
    {
      const deliver = async (q) => {
        if (q.key !== song) return null;
        if (q.n === 1) return { cut: 160000 };         // about four seconds of the song, then every read hangs
        return { delay: 14000, status: 503 };
      };
      const { context, page, reads, errors } = await setup({ width: 390, deliver });
      await listenPlay(page);
      await page.waitForFunction(() => !MCC_MUSIC.audio.paused && MCC_MUSIC.audio.currentTime > .5, null, { timeout: 15000 });
      const out = await page.evaluate(() => new Promise(res => {
        const a = MCC_MUSIC.audio; let waitingAt = 0, at = 0;
        a.addEventListener('waiting', () => { if (!waitingAt) { waitingAt = performance.now(); at = Date.now(); } });
        const iv = setInterval(() => {
          const st = MCC_MUSIC.delivery().state;
          if (waitingAt && (st === 'reconnecting' || st === 'lost')) { clearInterval(iv); res({ ms: Math.round(performance.now() - waitingAt), st, at }); }
        }, 50);
        setTimeout(() => { clearInterval(iv); res({ ms: null }); }, 30000);
      }));
      check('a read that hangs: the silence is noticed within about four seconds (review PB-R1: twelve)', out.ms !== null && out.ms < 5500, out);
      await page.waitForFunction(() => MCC_MUSIC.delivery().state === 'lost', null, { timeout: 20000 }).catch(() => {});
      const tries = reads.filter(q => q.key === song && q.n > 2).map(q => q.at - out.at);
      check('a read that hangs: each try that hangs gives way to the next, all inside the ten seconds, then Connection lost',
        tries.length >= 2 && tries.every(ms => ms < 9500) && (await engineUi(page)).label === 'Connection lost', { tries, ui: await engineUi(page) });
      check('a read that hangs: no script errors', errors.length === 0, errors);
      await context.close();
    }
  });

  await scenario('Pause while a song is being picked up again stops the tries (the mini player, the album deck bar)', async () => {
    const song = 'who-did-the-shoot.mp3';
    for (const where of ['listen', 'album']) {
      let down = true;
      const deliver = async (q) => { if (q.key !== song) return null; if (q.n === 1) return { cut: 96000 }; return down ? { status: 503 } : null; };
      const { context, page, reads, errors } = await setup({ width: 390, deliver });
      const ui = where === 'listen' ? () => engineUi(page) : () => deckUi(page);
      if (where === 'listen') {
        await listenPlay(page);
        await page.waitForFunction(() => window.MCC_MUSIC.delivery && MCC_MUSIC.delivery().state === 'reconnecting', null, { timeout: 20000 }).catch(() => {});
      } else {
        await albumPlay(page);
        await page.waitForFunction(() => /^Reconnecting…/.test(document.getElementById('npTime').textContent), null, { timeout: 20000 }).catch(() => {});
      }
      const before = await ui();
      check(`${where}: while it is picked up again the one button is Pause (review PB-R3: only Play, which tried again at once)`, before.button === 'Pause', before);
      const clickAt = Date.now();
      await page.click(where === 'listen' ? '#musicMiniPlay' : '#tpPlay');
      down = false;                                    // the network comes back
      await sleep(10000);
      const after = await ui();
      const later = reads.filter(q => q.key === song && q.at > clickAt + 50);
      check(`${where}: Pause stops the tries: nothing reads or plays behind the listener once the network is back`, after.paused && later.length === 0 && after.ms !== 'playing', { after, later });
      check(`${where}: and it says how to pick it up`, where === 'listen'
        ? after.label === 'Connection lost' && /Tap play to pick up at 0:0\d\./.test(after.note)
        : /^Connection lost · /.test(after.time) && /Tap play to pick up at 0:0\d\./.test(after.status), after);
      check(`${where} at 390 after Pause during the tries: the page fits the screen with the line`, await fits(page));
      await page.screenshot({ path: join(OUT, `${where}-390-paused-during-the-tries.png`) });
      check(`${where}, Pause during the tries: no script errors`, errors.length === 0, errors);
      await context.close();
    }
  });

  await scenario('a song whose file is not there: neither page calls it a dropped connection', async () => {
    const song = 'who-did-the-shoot.mp3';
    const deliver = async (q) => q.key === song ? { status: 404 } : null;
    {
      const { context, page, errors } = await setup({ width: 390, deliver });
      await listenPlay(page);
      await sleep(2000);
      const early = await engineUi(page);
      await page.waitForFunction(() => MCC_MUSIC.delivery && MCC_MUSIC.delivery().state === 'lost', null, { timeout: 20000 }).catch(() => {});
      const last = await engineUi(page);
      check('listen, missing file: while it tries, Loading… and "This song would not load. Trying again…" (review PB-R8/RL-1: "The connection dropped at 0:00")',
        early.label === 'Loading…' && early.note === 'This song would not load. Trying again…', early);
      check('listen, missing file: then "Could not load" and "This song could not load. Tap play to try again."', last.label === 'Could not load' &&
        last.note === 'This song could not load. Tap play to try again.' && !/connection|reconnect/i.test(early.label + early.note + last.label + last.note), last);
      check('listen, missing file at 390: the page fits the screen', await fits(page));
      await page.screenshot({ path: join(OUT, 'listen-390-could-not-load.png') });
      check('listen, missing file: no script errors', errors.length === 0, errors);
      await context.close();
    }
    {
      const { context, page, errors } = await setup({ width: 390, deliver });
      await albumPlay(page);
      await sleep(2000);
      const early = await deckUi(page), toasts = await page.evaluate(() => window.__toasts);
      await page.waitForFunction(() => /^Could not load/.test(document.getElementById('npTime').textContent), null, { timeout: 20000 }).catch(() => {});
      const last = await deckUi(page);
      check('album, missing file: the deck bar, the status line and the toast agree (review RL-1: the toast said it could not load, the bar "Connection lost")',
        /^Loading… · 0:00$/.test(early.time) && early.status === 'This song would not load. Trying again…' && toasts.some(m => /could not load/i.test(m)), { early, toasts });
      check('album, missing file: then "Could not load", and how to try again', /^Could not load · 0:00$/.test(last.time) &&
        last.status === 'This song could not load. Tap play to try again.' && !/connection|reconnect/i.test(early.time + early.status + last.time + last.status), last);
      check('album, missing file at 390: the page fits the screen', await fits(page));
      await page.screenshot({ path: join(OUT, 'album-390-could-not-load.png') });
      check('album, missing file: no script errors', errors.length === 0, errors);
      await context.close();
    }
  });

  for (const width of [320, 390]) {
    await scenario(`album sheet at ${width}: every transport target stays 44 px and round, and Unmute has its own`, async () => {
      const { context, page, errors } = await setup({ width });
      await albumPlay(page);
      await page.waitForFunction(() => { const d = document.getElementById('deck'); return !d.paused && d.currentTime > .3; }, null, { timeout: 15000 });
      await page.locator('.deckbar__meta').click();
      await sleep(700);
      await page.evaluate(() => { document.getElementById('deck').muted = true; });
      await page.waitForFunction(() => !document.getElementById('nowSound').hidden, null, { timeout: 5000 }).catch(() => {});
      await sleep(300);
      const m = await page.evaluate(() => {
        const shown = b => b && !b.hidden && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0;
        const row = [...document.querySelectorAll('.now__tp button')].filter(shown).map(b => { const r = b.getBoundingClientRect(); return { id: b.id, w: Math.round(r.width), h: Math.round(r.height) }; });
        const u = document.getElementById('nowSound'), ur = shown(u) ? u.getBoundingClientRect() : null;
        return { row, unmute: ur && { w: Math.round(ur.width), h: Math.round(ur.height), inRow: !!u.closest('.now__tp'), text: u.textContent.trim() },
          fits: document.documentElement.scrollWidth === document.documentElement.clientWidth };
      });
      /* Chromium shows the sheet's beam (Remote Playback) as WebKit does with an AirPlay device in range: five in the row */
      check(`album sheet ${width}: with the beam showing, every transport button is at least 44 px and round, the play 56 (review RL-3: 23 px at 320)`,
        m.row.length >= 4 && m.row.every(b => b.w >= 44 && Math.abs(b.w - b.h) <= 1) && m.row.filter(b => b.id === 'nowPlay').every(b => b.w >= 56), m);
      check(`album sheet ${width}: Unmute is its own 44 px chip under the transport, named in words`, !!m.unmute && m.unmute.h >= 44 && m.unmute.w >= 44 && !m.unmute.inRow && m.unmute.text === 'Unmute', m);
      check(`album sheet ${width}: the page fits the screen`, m.fits);
      if (width === 390) await page.screenshot({ path: join(OUT, 'album-390-sheet-muted.png') });
      check(`album sheet ${width}: no script errors`, errors.length === 0, errors);
      await context.close();
    });
  }

  await scenario('installed app: during a drop the dock says why the music is quiet and offers Pause', async () => {
    const song = 'who-did-the-shoot.mp3';
    const deliver = async (q) => { if (q.key !== song) return null; if (q.n === 1) return { cut: 96000 }; return { status: 503 }; };
    const { context, page, errors } = await setup({ width: 390, deliver, standalone: true });
    await listenPlay(page);
    await page.waitForFunction(() => window.MCC_MUSIC.delivery && MCC_MUSIC.delivery().state === 'reconnecting', null, { timeout: 20000 }).catch(() => {});
    await page.waitForFunction(() => { const d = document.getElementById('mccInstalledDock'); return d && /Reconnecting/.test((d.querySelector('[data-app-player="artist"]') || {}).textContent || ''); }, null, { timeout: 5000 }).catch(() => {});
    const dock = () => page.evaluate(() => {
      const d = document.getElementById('mccInstalledDock'), q = s => d && d.querySelector(s);
      return { active: document.documentElement.classList.contains('mcc-app-dock-active'), mini: getComputedStyle(document.getElementById('musicMini')).display,
        line: q('[data-app-player="artist"]') ? q('[data-app-player="artist"]').textContent : null,
        play: q('[data-app-player="play"]') ? q('[data-app-player="play"]').getAttribute('aria-label') : null,
        label: q('[data-app-player="open"]') ? q('[data-app-player="open"]').getAttribute('aria-label') : null };
    });
    const down = await dock();
    check('installed app: the dock stands in for the hidden mini player', down.active && down.mini === 'none', down);
    check('installed app: the dock says Reconnecting… and offers Pause, which stops the tries (review RL-6: it showed the artist and Play)',
      down.line === 'Reconnecting…' && down.play === 'Pause music' && /Reconnecting…/.test(down.label || ''), down);
    check('installed app at 390: the page fits the screen', await fits(page));
    /* the picture for Matthew: back at the top of the page, where the bar and its dock show */
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(600);
    await page.screenshot({ path: join(OUT, 'installed-listen-390-reconnecting.png') });
    await page.waitForFunction(() => MCC_MUSIC.delivery().state === 'lost', null, { timeout: 20000 }).catch(() => {});
    await sleep(200);
    const lost = await dock();
    check('installed app: once the tries give up, the dock says so and offers Play', lost.line === 'Connection lost · tap play' && lost.play === 'Play music', lost);
    check('installed app: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('a music page reads no song before a tap', async () => {
    const { context, page, reads } = await setup({ width: 390 });
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MCC_WORLD_AUDIO && !!window.MCC_MUSIC, null, { timeout: 20000 });
    await sleep(2500);
    check('listen: no song is read before a tap (the World\'s theme waits for the Globe; it was read twice)', reads.length === 0, reads.map(q => q.key + '@' + q.start));
    await context.close();
  });
} finally {
  await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log(`${results.length - failed.length} of ${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}
