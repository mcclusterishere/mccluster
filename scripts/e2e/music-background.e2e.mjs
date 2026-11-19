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

   What an iPhone does with the screen locked is not shown here: Chromium only stands in
   for it. That stays Inferred until Matthew's devices run the checklist
   (docs/music/MUSIC-RELEASE-20261119.md).

     node scripts/e2e/music-background.e2e.mjs [outDir]
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
async function scenario(name, fn) {
  try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e && e.message || e).slice(0, 600)); }
}
function jwt() {
  return 'x.' + Buffer.from(JSON.stringify({ sub: USER, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.y';
}
const EARNED = { mode: 'rule', allowed: true, missing: [], missions: { have: 3, need: 3 }, identity_verified: true };

/* one browser context with every request answered from this checkout or a fixture */
async function setup({ width = 390, member = false, earned = false, ua, pocket = null, session = true, day = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: width < 700, userAgent: ua,
    reducedMotion: 'no-preference', serviceWorkers: 'block', timezoneId: 'America/New_York' });
  const requests = [], errors = [], stream = { token: '', hits: [] };
  await context.addInitScript(({ member, token, pocket, session }) => {
    try {
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
  }, { member, token: jwt(), pocket, session });
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
  async function audio(r, file, extra = {}) {
    const buf = await readFile(file), range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || '');
    const headers = Object.assign({ 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }, extra);
    const type = MIME[extname(file)] || 'application/octet-stream';
    if (!range) return r.fulfill({ status: 200, contentType: type, headers, body: buf });
    const start = Number(range[1]), end = Math.min(Number(range[2] || buf.length - 1), buf.length - 1);
    if (start >= buf.length) return r.fulfill({ status: 416, headers: { 'content-range': `bytes */${buf.length}` } });
    headers['content-range'] = `bytes ${start}-${end}/${buf.length}`;
    return r.fulfill({ status: 206, contentType: type, headers, body: buf.subarray(start, end + 1) });
  }
  await context.route('**/*', async r => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname;
    requests.push({ url: u.origin + p, type: req.resourceType(), method: req.method() });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.origin === API) {
      const s = /^\/v1\/music\/stream\/([0-9a-f]{64})$/.exec(p);
      if (s) {
        if (s[1] === stream.token) stream.hits.push({ type: req.resourceType(), range: req.headers().range || null });
        return audio(r, join(ROOT, 'assets/audio/pull-up.mp3'));
      }
      if (/^\/v1\/music\/listens/.test(p)) return r.abort();
      const g = /^\/v1\/music\/gates\/([a-z0-9-]+)(\/play)?$/.exec(p);
      if (g && !g[2]) return json(r, { ok: true, gate: earned && member ? EARNED : { mode: 'rule', allowed: false, missing: ['sign_in'], missions: { have: 0, need: 3 }, identity_verified: false } });
      if (g && g[2] && earned && member) {
        stream.token = (Date.now().toString(16) + 'b'.repeat(64)).slice(0, 64);
        return json(r, { ok: true, url: API + '/v1/music/stream/' + stream.token, expires_in: 300, gate: EARNED });
      }
      if (g) return json(r, { error: 'Sign in' }, 401);
      return json(r, { error: 'fixture' }, 404);
    }
    if (u.hostname.endsWith('supabase.co')) {
      if (p === '/auth/v1/user') return member ? json(r, { id: USER }) : json(r, { msg: 'no' }, 401);
      if (p.startsWith('/auth/')) return json(r, { error: 'fixture' }, 400);
      if (p.startsWith('/functions/')) return json(r, { error: 'fixture' }, 401);
      return json(r, []);
    }
    if (u.origin === WORLD) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>World</title><body>World fixture</body>' });
    if (u.origin === HOUSE) {
      if (p.startsWith('/assets/audio/')) {
        const file = resolve(ROOT, '.' + decodeURIComponent(p));
        if (!file.startsWith(resolve(ROOT) + sep)) return r.fulfill({ status: 403 });
        try { return await audio(r, file); } catch { return r.fulfill({ status: 404 }); }
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
  return { context, page, requests, errors, stream };
}
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
} finally {
  await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log(`${results.length - failed.length} of ${results.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}
