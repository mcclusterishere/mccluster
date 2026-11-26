/* ONE NOW PLAYING EVERYWHERE: the browser proof (music slice M2).

   Matthew, 2026-11-19: "I can control the music from like my music engine when I swipe
   down my now playing and I need this to be the same for this site."

   Lane 01's probe S1c found the listen engine sending no position (0 setPositionState
   calls, playbackState "none"); lane 03 found the World soundtrack with no Media Session
   at all, the album with 15-second skips and mislabelled artwork, the pocket with no
   "previous" (music maps 01 and 03; C2: PB-7, PB-9, PB-10, EXT-3, EXT-6). This drives
   the real pages in Chromium, every request answered by route fixtures from this checkout
   (audio is a synthetic WAV), nothing sent anywhere, and reads what each player hands
   the browser's Media Session:
     1. after a play on every surface (the listen engine, the album, its shelf previews,
        the World soundtrack standalone and from the Globe, the pocket, the gateway, the
        docket's release, the music video feed and the embed): title, artist, album and
        artwork at the cover's true size and type; playbackState "playing"; a position
        with a finite duration; previous and next, and no 15-second skips
     2. previous and next move each surface's own queue to the right song
     3. stop, and the end of a queue, hand the lock screen back
     4. the AirPlay picker where WebKit offers it (stood in for: Chromium has none), hidden elsewhere
     5. resume where you left off across devices through listener_state
     6. 390 px: every page this slice changed fits (scrollWidth === clientWidth)

   What iOS draws from this is not shown here: Chromium only stands in. That stays
   Inferred until Matthew's devices run the checklist (docs/music/MUSIC-RELEASE-20261119.md).

     node scripts/e2e/now-playing.e2e.mjs [outDir]
   PLAYWRIGHT_DIR points at a node_modules folder with playwright (default /opt/node-tools/node_modules).
   NOW_PLAYING_SHOTS=1 also saves renders for Matthew at device scale 2. */
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.argv[2] || '/tmp/now-playing-proof';
const SHOTS = process.env.NOW_PLAYING_SHOTS === '1';
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright');
const HOUSE = 'https://matthew.mccluster.org', WORLD = 'https://mccluster.org', API = 'https://api.mccluster.org';
const USER = '33333333-3333-4333-8333-333333333333';
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.gif': 'image/gif', '.webmanifest': 'application/manifest+json' };
const SHELF = JSON.parse(readFileSync(join(ROOT, 'data/albums.json'), 'utf8')).albums;
const ALBUM = slug => SHELF.find(a => a.slug === slug);
/* the house's records are credited to McCluster, the artist (Matthew, 2026-11-23, "Quick wins" Q1 in
   docs/music/MUSIC-RELEASE-20261119.md); a record that bills its own artist keeps it */
const artistOf = a => a.artist || 'McCluster';
/* the covers' true sizes and types, read off the files here (the unit test proves the reader) */
function imageInfo(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) return { type: 'image/png', sizes: `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}` };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'image/jpeg', sizes: `${buf.readUInt16BE(i + 7)}x${buf.readUInt16BE(i + 5)}` };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  if (buf.toString('latin1', 8, 12) === 'WEBP') {
    const c = buf.toString('latin1', 12, 16);
    if (c === 'VP8 ') return { type: 'image/webp', sizes: `${buf.readUInt16LE(26) & 0x3fff}x${buf.readUInt16LE(28) & 0x3fff}` };
    if (c === 'VP8L') { const b = buf.readUInt32LE(21); return { type: 'image/webp', sizes: `${(b & 0x3fff) + 1}x${((b >>> 14) & 0x3fff) + 1}` }; }
    if (c === 'VP8X') return { type: 'image/webp', sizes: `${buf.readUIntLE(24, 3) + 1}x${buf.readUIntLE(27, 3) + 1}` };
  }
  return null;
}
const cover = (origin, path) => ({ src: origin + '/' + path, ...imageInfo(readFileSync(join(ROOT, path))) });

/* one synthetic song for every audio request: two minutes of a quiet tone */
function wav(seconds = 120) {
  const rate = 8000, count = rate * seconds, b = Buffer.alloc(44 + count * 2);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / rate) * 600), 44 + i * 2);
  return b;
}
const AUDIO = wav();

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--autoplay-policy=document-user-activation-required'] });
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: pass ? undefined : detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${pass ? '' : ' ' + JSON.stringify(detail)}`);
}
/* NOW_PLAYING_ONLY=<words> runs only the scenarios whose name holds one of them (a quicker loop while fixing) */
const ONLY = (process.env.NOW_PLAYING_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
async function scenario(name, fn) {
  if (ONLY.length && !ONLY.some(w => name.includes(w))) return;
  try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e && e.message || e).slice(0, 600)); }
}
function jwt() { return 'x.' + Buffer.from(JSON.stringify({ sub: USER, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.y'; }

async function setup({ width = 390, scale = SHOTS ? 2 : 1, member = false, pocket = null, remote = null, webkit = false, random = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: scale, hasTouch: true, isMobile: width < 700,
    reducedMotion: 'reduce', serviceWorkers: 'block', timezoneId: 'America/New_York' });
  const requests = [], errors = [], writes = [];
  await context.addInitScript(({ member, token, pocket, webkit, random }) => {
    try {
      localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: new Date().toISOString() }));
      sessionStorage.setItem('mcc_premiere', '1');
      if (member && !localStorage.getItem('mccdb_session')) localStorage.setItem('mccdb_session', JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 }));
      if (pocket && !sessionStorage.getItem('__pocketSeeded')) { localStorage.setItem('mcc-pocket', JSON.stringify(Object.assign({ at: Date.now() }, pocket))); sessionStorage.setItem('__pocketSeeded', '1'); }
    } catch (e) {}
    Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } });
    if (random !== null) Math.random = () => random;
    /* what the page hands the browser's Media Session, recorded as it goes through */
    window.__ms = { handlers: {}, positions: [] };
    const ms = navigator.mediaSession;
    if (ms) {
      const set = ms.setActionHandler.bind(ms), pos = ms.setPositionState ? ms.setPositionState.bind(ms) : null;
      ms.setActionHandler = function (a, fn) { window.__ms.handlers[a] = fn; return set(a, fn); };
      if (pos) ms.setPositionState = function (s) { window.__ms.positions.push(s === undefined ? 'cleared' : JSON.parse(JSON.stringify(s))); return pos(s); };
    }
    /* WebKit's AirPlay picker, stood in for (Chromium has none) */
    if (webkit) {
      window.WebKitPlaybackTargetAvailabilityEvent = function () {};
      HTMLMediaElement.prototype.webkitShowPlaybackTargetPicker = function () { window.__airplay = (window.__airplay || 0) + 1; };
    }
    window.__audios = [];
    const NativeAudio = window.Audio;
    window.Audio = function (...a) { const x = new NativeAudio(...a); window.__audios.push(x); return x; };
    window.Audio.prototype = NativeAudio.prototype;
  }, { member, token: jwt(), pocket, webkit, random });
  const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify(body) });
  function audio(r) {
    const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || '');
    const headers = { 'accept-ranges': 'bytes', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    if (!range) return r.fulfill({ status: 200, contentType: 'audio/wav', headers, body: AUDIO });
    const start = Number(range[1]), end = Math.min(Number(range[2] || AUDIO.length - 1), AUDIO.length - 1);
    if (start >= AUDIO.length) return r.fulfill({ status: 416, headers: { 'content-range': `bytes */${AUDIO.length}` } });
    headers['content-range'] = `bytes ${start}-${end}/${AUDIO.length}`;
    return r.fulfill({ status: 206, contentType: 'audio/wav', headers, body: AUDIO.subarray(start, end + 1) });
  }
  await context.route('**/*', async r => {
    const req = r.request(), u = new URL(req.url()), p = u.pathname;
    requests.push({ url: u.origin + p, method: req.method() });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (u.origin === API) {
      if (/^\/v1\/music\/listens/.test(p)) return r.abort();
      if (/^\/v1\/music\/gates\//.test(p)) return json(r, { ok: true, gate: { mode: 'rule', allowed: false, missing: ['sign_in'], missions: { have: 0, need: 3 }, identity_verified: false } });
      if (p === '/v1/status') return json(r, { ok: false }, 403);
      if (p === '/v1/mnet/bootstrap') return json(r, { ok: true, profile: null, needs_onboarding: false, stats: {} });
      return json(r, { ok: true, threads: [], posts: [], events: [], missions: [], layers: [], features: [], sources: [], locations: [], rights: {} });
    }
    if (u.hostname.endsWith('supabase.co')) {
      if (p === '/auth/v1/user') return member ? json(r, { id: USER }) : json(r, { msg: 'no' }, 401);
      if (p.startsWith('/auth/')) return json(r, { error: 'fixture' }, 400);
      if (p === '/rest/v1/listener_state') {
        if (req.method() === 'GET') return json(r, remote ? [{ state: remote, updated_at: new Date().toISOString() }] : []);
        writes.push({ method: req.method(), body: req.postData(), auth: req.headers().authorization || '' });
        return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      }
      if (p.startsWith('/functions/')) return json(r, { error: 'fixture' }, 401);
      return json(r, []);
    }
    if (u.origin === HOUSE || u.origin === WORLD) {
      if (p.startsWith('/assets/audio/')) return audio(r);
      const path = resolve(ROOT, '.' + (p === '/' ? (u.origin === WORLD ? '/mnet.html' : '/index.html') : decodeURIComponent(p)));
      if (path.startsWith(resolve(ROOT) + sep)) {
        try { return r.fulfill({ body: await readFile(path), contentType: MIME[extname(path)] || 'application/octet-stream', headers: { 'cache-control': 'no-store' } }); } catch {}
      }
      return r.fulfill({ status: 404, body: 'fixture: absent' });
    }
    return r.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 300)));
  return { context, page, requests, errors, writes };
}
/* what the page has handed the browser's Media Session */
const np = page => page.evaluate(() => {
  const ms = navigator.mediaSession, md = ms.metadata, h = window.__ms.handlers;
  return {
    title: md ? md.title : null, artist: md ? md.artist : null, album: md ? md.album : null,
    artwork: md ? Array.from(md.artwork || []).map(a => ({ src: a.src, sizes: a.sizes || '', type: a.type || '' })) : [],
    state: ms.playbackState, positions: window.__ms.positions.length, last: window.__ms.positions[window.__ms.positions.length - 1] || null,
    actions: Object.keys(h).filter(k => typeof h[k] === 'function').sort(),
  };
});
const press = (page, action, extra = {}) => page.evaluate(([a, x]) => { const f = window.__ms.handlers[a]; if (typeof f !== 'function') throw new Error('no ' + a + ' handler'); f(Object.assign({ action: a }, x)); }, [action, extra]);
const fits = page => page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth);
const playingTitle = page => np(page).then(s => s.title);
/* the same artwork list, whatever order each entry's keys came in */
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
function same(a, b) { return canon(a) === canon(b); }
/* the lock screen after a play: what it says, how it says it, and which buttons it offers */
async function nowPlayingChecks(page, label, want) {
  await page.waitForFunction(t => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === t, want.title, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const s = await np(page);
  check(`${label}: the lock screen names the song, its artist and its album`, s.title === want.title && s.artist === want.artist && s.album === want.album,
    { got: { title: s.title, artist: s.artist, album: s.album }, want });
  check(`${label}: the cover whole, at its true size and type`, same(s.artwork, [want.art]), { got: s.artwork, want: want.art });
  check(`${label}: playbackState is "playing"`, s.state === 'playing', s.state);
  check(`${label}: a position with a finite duration`, s.positions > 0 && s.last && Number.isFinite(s.last.duration) && s.last.duration > 0
    && s.last.position >= 0 && s.last.position <= s.last.duration, { positions: s.positions, last: s.last });
  check(`${label}: previous and next, no 15-second skips`, s.actions.includes('previoustrack') && s.actions.includes('nexttrack')
    && !s.actions.includes('seekbackward') && !s.actions.includes('seekforward'), s.actions);
  return s;
}

/* Listen lists albums and artists (Matthew, 2026-11-23, "Quick wins" Q2 in docs/music/MUSIC-RELEASE-20261119.md): a song's own play button is in its search results */
async function findSong(page, album, title) {
  const sel = `[data-music-play][data-album="${album}"][data-track="${title}"]`;
  await page.waitForFunction(() => !!window.MCC_MUSIC && !!document.getElementById('q'), null, { timeout: 20000 });
  await page.fill('#q', title);
  await page.waitForFunction(s => !!document.querySelector(s), sel, { timeout: 20000 });
  return page.locator(sel).first();
}

try {
  await scenario('listen engine', async () => {
    const { context, page, errors } = await setup({ webkit: true });
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    const here = ALBUM('here');
    await (await findSong(page, 'here', here.tracks[0].title)).click();
    await page.waitForFunction(() => !MCC_MUSIC.audio.paused && MCC_MUSIC.audio.currentTime > 0.3, null, { timeout: 15000 });
    await nowPlayingChecks(page, 'listen', { title: here.tracks[0].title, artist: artistOf(here), album: here.name, art: cover(HOUSE, here.art) });
    /* the throttle: three seconds of playing add a handful of reports, not one per timeupdate */
    const p0 = (await np(page)).positions;
    await page.waitForTimeout(3000);
    const p1 = (await np(page)).positions;
    check('listen: the position is reported about once a second while playing, not on every timeupdate', p1 - p0 >= 1 && p1 - p0 <= 5, { during3s: p1 - p0 });
    await press(page, 'nexttrack');
    await page.waitForFunction(t => MCC_MUSIC.current() && MCC_MUSIC.current().title === t && !MCC_MUSIC.audio.paused, here.tracks[1].title, { timeout: 10000 }).catch(() => {});
    check('listen: next on the lock screen plays the next song in the queue', await playingTitle(page) === here.tracks[1].title
      && await page.evaluate(() => MCC_MUSIC.current().title) === here.tracks[1].title, await np(page));
    await press(page, 'previoustrack');
    await page.waitForFunction(t => MCC_MUSIC.current() && MCC_MUSIC.current().title === t && !MCC_MUSIC.audio.paused, here.tracks[0].title, { timeout: 10000 }).catch(() => {});
    check('listen: previous goes back to the song before', await playingTitle(page) === here.tracks[0].title, await np(page));
    await press(page, 'seekto', { seekTime: 30 });
    await page.waitForTimeout(300);
    const sought = await page.evaluate(() => ({ t: MCC_MUSIC.audio.currentTime, last: window.__ms.positions[window.__ms.positions.length - 1] }));
    check('listen: seek-to moves the song and reports the new position at once', sought.t >= 29.5 && sought.last && sought.last.position >= 29.5, sought);
    await press(page, 'pause');
    await page.waitForTimeout(300);
    check('listen: pause from the lock screen pauses, and says so', await page.evaluate(() => MCC_MUSIC.audio.paused) && (await np(page)).state === 'paused');
    await press(page, 'play');
    await page.waitForFunction(() => !MCC_MUSIC.audio.paused, null, { timeout: 5000 }).catch(() => {});
    check('listen: play from the lock screen plays again', (await np(page)).state === 'playing');
    /* AirPlay where WebKit offers it: in the Now Playing sheet, shown once a device is in range */
    await page.locator('.appbar [data-app-player="open"]').or(page.locator('#musicMiniOpen:visible')).click();
    await page.waitForTimeout(500);
    const air = page.locator('#musicNowAirplay');
    check('listen: the Now Playing sheet has an AirPlay button, hidden until a device is in range', await air.count() === 1 && !(await air.isVisible()));
    await page.evaluate(() => { const e = new Event('webkitplaybacktargetavailabilitychanged'); e.availability = 'available'; MCC_MUSIC.audio.dispatchEvent(e); });
    await page.waitForTimeout(200);
    const box = await air.boundingBox().catch(() => null);
    check('listen: with a device in range the AirPlay button shows, a 44 px target', await air.isVisible() && box && box.width >= 44 && box.height >= 44, box);
    await air.click();
    check('listen: a tap opens the AirPlay picker', await page.evaluate(() => window.__airplay === 1));
    check('listen at 390 with the sheet and AirPlay: the page fits the screen', await fits(page));
    if (SHOTS) await page.screenshot({ path: join(OUT, 'listen-390-now-sheet-airplay.png') });
    check('listen: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('listen engine without a WebKit picker', async () => {
    const { context, page } = await setup();
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await (await findSong(page, 'here', 'Who Did The Shoot')).click();
    await page.waitForFunction(() => !MCC_MUSIC.audio.paused, null, { timeout: 15000 });
    await page.locator('.appbar [data-app-player="open"]').or(page.locator('#musicMiniOpen:visible')).click();
    await page.waitForTimeout(400);
    check('listen without WebKit\'s picker (Chrome, Firefox): no AirPlay button shows', !(await page.locator('#musicNowAirplay').isVisible().catch(() => false)));
    await context.close();
  });

  await scenario('album deck', async () => {
    const { context, page, errors } = await setup({ webkit: true });
    const here = ALBUM('here');
    await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
    await page.waitForSelector('#tracks li', { timeout: 20000 });
    await page.locator('#tracks li').first().click();
    await page.waitForFunction(() => { const d = document.getElementById('deck'); return !d.paused && d.currentTime > 0.3; }, null, { timeout: 15000 });
    await nowPlayingChecks(page, 'album', { title: here.tracks[0].title, artist: artistOf(here), album: here.name, art: cover(HOUSE, here.art) });
    await press(page, 'nexttrack');
    await page.waitForFunction(t => document.querySelector('#tracks li.on')?.getAttribute('data-title') === t && !document.getElementById('deck').paused, here.tracks[1].title, { timeout: 10000 }).catch(() => {});
    check('album: next plays the next row', await playingTitle(page) === here.tracks[1].title
      && await page.evaluate(() => document.querySelector('#tracks li.on').getAttribute('data-title')) === here.tracks[1].title, await np(page));
    await press(page, 'previoustrack');
    await page.waitForFunction(t => document.querySelector('#tracks li.on')?.getAttribute('data-title') === t, here.tracks[0].title, { timeout: 10000 }).catch(() => {});
    check('album: previous (in the first seconds of a song) plays the row before', await playingTitle(page) === here.tracks[0].title, await np(page));
    /* the AirPlay button of the open sheet (the album's beam) follows WebKit's availability */
    await page.locator('.appbar [data-app-player="open"]').click();
    await page.waitForTimeout(500);
    const beam = page.locator('#nowBeam');
    check('album: the AirPlay button waits for a device in range', !(await beam.isVisible()),
      await page.evaluate(() => { const b = document.getElementById('nowBeam'); return { hidden: b.hidden, display: getComputedStyle(b).display }; }));
    await page.evaluate(() => { const e = new Event('webkitplaybacktargetavailabilitychanged'); e.availability = 'available'; document.getElementById('deck').dispatchEvent(e); });
    await page.waitForTimeout(200);
    check('album: with a device in range it shows', await beam.isVisible());
    await beam.click();
    check('album: a tap opens the AirPlay picker', await page.evaluate(() => window.__airplay === 1));
    check('album at 390 with the sheet open: the page fits the screen', await fits(page));
    if (SHOTS) await page.screenshot({ path: join(OUT, 'album-390-sheet-airplay.png') });
    check('album: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('album, a PNG cover, credited to its own artist', async () => {
    const { context, page, errors } = await setup();
    const prim3 = ALBUM('prim3');
    await page.goto(HOUSE + '/album.html?album=prim3', { waitUntil: 'load' });
    await page.waitForSelector('#tracks li', { timeout: 20000 });
    await page.locator('#tracks li').first().click();
    await page.waitForFunction(() => !document.getElementById('deck').paused, null, { timeout: 15000 });
    await nowPlayingChecks(page, 'album (Cyber Security Specialist, a PNG cover)', { title: prim3.tracks[0].title, artist: artistOf(prim3), album: prim3.name, art: cover(HOUSE, prim3.art) });
    /* the playlists are gone (Matthew, 2026-11-23, "Quick wins" Q2): the album's own sheet credits its own artist */
    check('album: the sheet credits the song\'s own artist', await page.locator('#nowBy').textContent() === artistOf(prim3), await page.locator('#nowBy').textContent());
    check('album (PNG cover): no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('album shelf previews', async () => {
    const { context, page, errors } = await setup();
    await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
    await page.waitForSelector('#featRail [data-pv]', { timeout: 20000 });
    const chips = await page.locator('#featRail [data-pv]').evaluateAll(bs => bs.map(b => b.getAttribute('data-pv')));
    const a1 = ALBUM(chips[1].replace(/^alb:/, '')), a2 = ALBUM(chips[2].replace(/^alb:/, ''));
    await page.locator('#featRail [data-pv]').nth(1).click();
    await page.waitForFunction(() => window.__audios.some(a => !a.paused && a.currentTime > 0.2), null, { timeout: 15000 });
    await nowPlayingChecks(page, 'shelf preview', { title: a1.tracks[0].title, artist: artistOf(a1), album: a1.name, art: cover(HOUSE, a1.art) });
    await press(page, 'nexttrack');
    await page.waitForFunction(t => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === t, a2.tracks[0].title, { timeout: 8000 }).catch(() => {});
    check('shelf preview: next tastes the next record on the shelf', await playingTitle(page) === a2.tracks[0].title
      && await page.evaluate(() => document.querySelectorAll('#featRail [data-pv].on').length === 1 && document.querySelectorAll('#featRail [data-pv]')[2].classList.contains('on')), await np(page));
    await press(page, 'previoustrack');
    await page.waitForFunction(t => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === t, a1.tracks[0].title, { timeout: 8000 }).catch(() => {});
    check('shelf preview: previous goes back one record', await playingTitle(page) === a1.tracks[0].title);
    check('shelf preview: no script errors', errors.length === 0, errors);
    await context.close();
  });

  /* the World's draw pinned: the first song is Heal the 3rd World, the next one the shelf's next public song */
  const publicSongs = SHELF.flatMap(a => (a.tracks || []).filter(t => !t.gated && /^assets\/audio\/[a-z0-9._-]+\.(?:mp3|m4a)$/i.test(t.src || '') && !/preview/i.test(t.src)).map(t => ({ t, a })));
  const heal = publicSongs.findIndex(x => x.t.src === 'assets/audio/heal-the-3rd-world.m4a');
  const pinned = (heal + 0.5) / publicSongs.length;
  const afterHeal = publicSongs[(heal + 1) % publicSongs.length];

  await scenario('World soundtrack, standalone World', async () => {
    const { context, page, errors } = await setup({ random: pinned });
    await page.goto(WORLD + '/?view=feed', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MCC_WORLD_AUDIO && window.MCC_WORLD_AUDIO.song() && window.MCC_WORLD_AUDIO.song().pool > 1 && document.getElementById('mnWorldPlay'), null, { timeout: 25000 });
    await page.locator('#mnWorldPlay').click();
    await page.waitForFunction(() => window.__audios.some(a => !a.paused && a.currentTime > 0.2), null, { timeout: 15000 });
    const h = publicSongs[heal];
    check('World (setup): the pinned draw is Heal the 3rd World', await page.evaluate(() => MCC_WORLD_AUDIO.song().slug) === 'heal-the-3rd-world');
    await nowPlayingChecks(page, 'World soundtrack', { title: h.t.title, artist: artistOf(h.a), album: h.a.name, art: cover(WORLD, h.a.art) });
    await press(page, 'nexttrack');
    await page.waitForFunction(t => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === t && window.__audios.some(a => !a.paused), afterHeal.t.title, { timeout: 8000 }).catch(() => {});
    const n = await np(page);
    check('World: next plays another song from the rotation, and names it', n.title === afterHeal.t.title && n.album === afterHeal.a.name
      && same(n.artwork, [cover(WORLD, afterHeal.a.art)]) && await page.evaluate(() => MCC_WORLD_AUDIO.song().slug) !== 'heal-the-3rd-world', n);
    await press(page, 'previoustrack');
    await page.waitForFunction(t => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === t, h.t.title, { timeout: 8000 }).catch(() => {});
    check('World: previous goes back to the song before', await playingTitle(page) === h.t.title && await page.evaluate(() => MCC_WORLD_AUDIO.song().slug) === 'heal-the-3rd-world');
    check('World: one song at a time', await page.evaluate(() => window.__audios.filter(a => !a.paused).length) === 1);
    check('World at 390: the page fits the screen', await fits(page));
    check('World: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('World soundtrack from the Globe, nothing selected', async () => {
    const { context, page, errors } = await setup({ random: pinned });
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MCC_WORLD_AUDIO && !!window.MCC_BAR && !!window.MCC_MUSIC && MCC_WORLD_AUDIO.song() && MCC_WORLD_AUDIO.song().pool > 1, null, { timeout: 20000 });
    await page.locator('.appbar [data-appnav="world"]').click();
    await page.waitForFunction(() => window.__audios.some(a => !a.paused && a.currentTime > 0.2), null, { timeout: 15000 });
    const h = publicSongs[heal];
    await nowPlayingChecks(page, 'World soundtrack from the Globe', { title: h.t.title, artist: artistOf(h.a), album: h.a.name, art: cover(HOUSE, h.a.art) });
    await press(page, 'nexttrack');
    await page.waitForFunction(t => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === t, afterHeal.t.title, { timeout: 8000 }).catch(() => {});
    check('World from the Globe: next moves the rotation', await playingTitle(page) === afterHeal.t.title);
    check('World from the Globe: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('pocket', async () => {
    const here = ALBUM('here');
    const at = here.tracks.findIndex(t => t.title === 'Here');
    const { context, page, errors } = await setup({ webkit: true, pocket: { src: here.tracks[at].src, title: 'Here', album: 'here', artist: 'McCluster', poster: here.tracks[at].poster, t: 4, playing: true } });
    await page.goto(HOUSE + '/catalogue.html', { waitUntil: 'load' });
    await page.waitForSelector('.pocket .pocket__play', { timeout: 15000 });
    await page.waitForTimeout(600);
    if (!(await page.evaluate(() => { const a = document.querySelector('.pocket__audio'); return !!a && !a.paused; }))) await page.locator('.pocket .pocket__play').click({ force: true });
    await page.waitForFunction(() => { const a = document.querySelector('.pocket__audio'); return a && !a.paused && a.currentTime > 0; }, null, { timeout: 15000 });
    await nowPlayingChecks(page, 'pocket', { title: 'Here', artist: artistOf(here), album: here.name, art: cover(HOUSE, here.art) });
    await press(page, 'nexttrack');
    await page.waitForFunction(t => document.querySelector('.pocket__title')?.textContent === t, here.tracks[at + 1].title, { timeout: 10000 }).catch(() => {});
    check('pocket: next rolls into the next song of the record', await playingTitle(page) === here.tracks[at + 1].title
      && await page.locator('.pocket__title').textContent() === here.tracks[at + 1].title, await np(page));
    await press(page, 'previoustrack');
    await page.waitForFunction(t => document.querySelector('.pocket__title')?.textContent === t, 'Here', { timeout: 10000 }).catch(() => {});
    check('pocket: previous goes back to the song before', await playingTitle(page) === 'Here');
    await page.evaluate(() => { const e = new Event('webkitplaybacktargetavailabilitychanged'); e.availability = 'available'; document.querySelector('.pocket__audio').dispatchEvent(e); });
    await page.waitForTimeout(200);
    const air = page.locator('.pocket .pocket__air');
    const box = await air.boundingBox().catch(() => null);
    check('pocket: AirPlay shows with a device in range, a 44 px target that fits the tile', await air.isVisible() && box && box.width >= 44 && box.height >= 44, box);
    check('catalogue with the pocket and AirPlay at 390: the page fits the screen', await fits(page));
    if (SHOTS) await page.screenshot({ path: join(OUT, 'catalogue-390-pocket-airplay.png') });
    await press(page, 'stop');
    await page.waitForTimeout(500);
    const s = await np(page);
    check('pocket: stop puts the record away and hands the lock screen back', s.title === null && s.state === 'none' && await page.locator('.pocket').count() === 0, s);
    check('pocket: no script errors', errors.length === 0, errors);
    await context.close();
  });

  /* the lock screen's Next on the record's last song (and toward a gated or held one): the pocket marked itself held
     and cleared Now Playing while the song went on playing, and its next timeupdate wrote playing:true back over the
     stopped state (review of the release branch) */
  await scenario('pocket at the end of the record', async () => {
    for (const [slug, title, why] of [['here', ALBUM('here').tracks.at(-1).title, 'the last song'], ['cia-mind-control', ALBUM('cia-mind-control').tracks[1].title, 'the song before a gated one']]) {
      const alb = ALBUM(slug), song = alb.tracks.find(t => t.title === title);
      const { context, page, errors } = await setup({ webkit: true, pocket: { src: song.src, title, album: slug, artist: 'McCluster', poster: song.poster, t: 4, playing: true } });
      await page.goto(HOUSE + '/catalogue.html', { waitUntil: 'load' });
      await page.waitForSelector('.pocket .pocket__play', { timeout: 15000 });
      await page.waitForTimeout(600);
      if (!(await page.evaluate(() => { const a = document.querySelector('.pocket__audio'); return !!a && !a.paused; }))) await page.locator('.pocket .pocket__play').click({ force: true });
      await page.waitForFunction(() => { const a = document.querySelector('.pocket__audio'); return a && !a.paused && a.currentTime > 0; }, null, { timeout: 15000 });
      await press(page, 'nexttrack');
      await page.waitForFunction(() => document.querySelector('.pocket').classList.contains('is-held'), null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);   // longer than the pocket's 900 ms between saves: a song still playing writes over the stop
      const s = await page.evaluate(() => { const a = document.querySelector('.pocket__audio'), f = document.querySelector('.pocket__film'), b = document.querySelector('.pocket');
        return { held: b.classList.contains('is-held'), audioPaused: a.paused, filmPaused: f.paused, title: document.querySelector('.pocket__title').textContent,
          saved: (JSON.parse(localStorage.getItem('mcc-pocket') || '{}')).playing } });
      check(`pocket, Next on ${why}: the record stops on that song, shown held`, s.held && s.title === title, s);
      check(`pocket, Next on ${why}: the sound and the film stop with it`, s.audioPaused && s.filmPaused, s);
      check(`pocket, Next on ${why}: the saved record says stopped, and stays so`, s.saved === false, s);
      check(`pocket, Next on ${why}: no script errors`, errors.length === 0, errors);
      await context.close();
    }
  });

  await scenario('gateway score', async () => {
    const { context, page, errors } = await setup();
    await page.goto(HOUSE + '/heal-the-3rd-world.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MCC_NOW_PLAYING, null, { timeout: 15000 }).catch(() => {});
    const cfg = await page.evaluate(() => JSON.parse(document.getElementById('gwConfig').textContent));
    await page.locator('#gwSound').click();
    await page.waitForFunction(() => window.__audios.some(a => !a.paused && a.currentTime > 0.2), null, { timeout: 15000 });
    const first = await page.evaluate(() => { const a = window.__audios.find(x => !x.paused); return a && a.getAttribute('src'); });
    const key = Object.keys(cfg.songs).find(k => cfg.songs[k].src === first);
    await nowPlayingChecks(page, 'gateway', { title: cfg.songs[key].title, artist: cfg.media.artist, album: cfg.media.album, art: cover(HOUSE, cfg.media.art) });
    check('gateway: the score asked for the playback audio session', await page.evaluate(() => navigator.audioSession.type) === 'playback');
    const other = Object.keys(cfg.songs).find(k => k !== key);
    await press(page, 'nexttrack');
    await page.waitForFunction(t => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === t, cfg.songs[other].title, { timeout: 8000 }).catch(() => {});
    check('gateway: next plays the record\'s other side', await playingTitle(page) === cfg.songs[other].title);
    check('gateway at 390: the page fits the screen', await fits(page));
    check('gateway: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('docket release', async () => {
    const { context, page, errors } = await setup();
    await page.goto(HOUSE + '/docket-516.html', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__DKT_TRACKS && !!window.MCC_NOW_PLAYING, null, { timeout: 15000 }).catch(() => {});
    const tracks = await page.evaluate(() => window.__DKT_TRACKS.map(t => t.src));
    const by = src => { for (const a of SHELF) for (const t of a.tracks) if (t.src === src) return { t, a }; return null; };
    const one = by(tracks[0]), two = by(tracks[1]);
    await page.locator('#dktPlay').click();
    await page.waitForFunction(() => window.__audios.some(a => !a.paused && a.currentTime > 0.2), null, { timeout: 15000 });
    await nowPlayingChecks(page, 'docket', { title: one.t.title, artist: artistOf(one.a), album: one.a.name, art: cover(HOUSE, one.a.art) });
    check('docket: the release asked for the playback audio session', await page.evaluate(() => navigator.audioSession.type) === 'playback');
    await press(page, 'nexttrack');
    await page.waitForFunction(t => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === t, two.t.title, { timeout: 8000 }).catch(() => {});
    check('docket: next plays the release\'s next track', await playingTitle(page) === two.t.title);
    /* the release ends after its last track: the lock screen is handed back */
    /* the next track's length is known once its metadata loads */
    await page.waitForFunction(() => window.__audios.some(x => !x.paused && isFinite(x.duration) && x.duration > 1), null, { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => { const a = window.__audios.find(x => !x.paused && isFinite(x.duration)); a.currentTime = Math.max(0, a.duration - 0.4); });
    await page.waitForFunction(() => navigator.mediaSession.metadata === null, null, { timeout: 8000 }).catch(() => {});
    const s = await np(page);
    check('docket: when the release ends the lock screen is handed back', s.title === null && s.state === 'none', s);
    check('docket at 390: the page fits the screen', await fits(page));
    check('docket: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('music video feed', async () => {
    const { context, page, errors } = await setup({ webkit: true });
    await page.goto(HOUSE + '/music-videos.html', { waitUntil: 'load' });
    await page.waitForSelector('.fc[data-i="1"]', { timeout: 20000 });
    const reel = SHELF.flatMap(a => a.tracks.filter(t => t.music_video || t.video || t.reel).map(t => ({ t, a })));
    await page.locator('#fa').dispatchEvent('pointerdown');
    await page.waitForFunction(() => { const d = document.getElementById('deck'); return !d.paused && d.currentTime > 0.2; }, null, { timeout: 15000 });
    await nowPlayingChecks(page, 'music video feed', { title: reel[0].t.title, artist: artistOf(reel[0].a), album: reel[0].a.name, art: cover(HOUSE, reel[0].a.art) });
    await press(page, 'nexttrack');
    await page.waitForFunction(t => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === t, reel[1].t.title, { timeout: 8000 }).catch(() => {});
    check('music videos: next plays the next card\'s record', await playingTitle(page) === reel[1].t.title && await page.evaluate(() => !document.getElementById('deck').paused));
    await press(page, 'previoustrack');
    await page.waitForFunction(t => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === t, reel[0].t.title, { timeout: 8000 }).catch(() => {});
    check('music videos: previous plays the card before', await playingTitle(page) === reel[0].t.title);
    await page.evaluate(() => { const e = new Event('webkitplaybacktargetavailabilitychanged'); e.availability = 'available'; document.getElementById('deck').dispatchEvent(e); });
    await page.waitForTimeout(200);
    check('music videos: AirPlay shows on the card with a device in range', await page.locator('.fc[data-i="0"] [data-air]').isVisible());
    check('music videos at 390: the page fits the screen', await fits(page));
    if (SHOTS) await page.screenshot({ path: join(OUT, 'music-videos-390-airplay.png') });
    check('music videos: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('embed', async () => {
    const { context, page, errors } = await setup();
    const prim3 = ALBUM('prim3');
    await page.goto(HOUSE + '/embed.html?album=prim3', { waitUntil: 'load' });
    await page.waitForFunction(t => document.getElementById('title').textContent === t, prim3.tracks[0].title, { timeout: 15000 });
    check('embed: the card credits the album\'s billed artist', (await page.locator('.by').textContent()).includes(artistOf(prim3)) && !(await page.locator('.by').textContent()).includes('Matthew McCluster'),
      await page.locator('.by').textContent());
    await page.locator('#play').click();
    await page.waitForFunction(() => !document.getElementById('deck').paused, null, { timeout: 15000 });
    await nowPlayingChecks(page, 'embed', { title: prim3.tracks[0].title, artist: artistOf(prim3), album: prim3.name, art: cover(HOUSE, prim3.art) });
    await press(page, 'nexttrack');
    await page.waitForFunction(t => document.getElementById('title').textContent === t, prim3.tracks[1].title, { timeout: 8000 }).catch(() => {});
    check('embed: next plays the album\'s next song', await playingTitle(page) === prim3.tracks[1].title && await page.locator('#title').textContent() === prim3.tracks[1].title);
    check('embed at 390: fits', await fits(page));
    if (SHOTS) await page.screenshot({ path: join(OUT, 'embed-390-prim3.png') });
    check('embed: no script errors', errors.length === 0, errors);
    await context.close();
  });

  await scenario('resume across devices', async () => {
    const here = ALBUM('here');
    const runway = here.tracks.find(t => t.title === 'Runway Walk');
    const remote = { src: runway.src, title: runway.title, album: 'here', artist: 'McCluster', art: here.art, t: 42, playing: true, at: Date.now() };
    {
      const { context, page, errors, writes } = await setup({ member: true, remote });
      await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
      await page.waitForFunction(() => { const m = document.getElementById('musicMini'); return m && !m.hidden; }, null, { timeout: 15000 }).catch(() => {});
      const held = await page.evaluate(() => ({ title: document.getElementById('musicMiniTitle')?.textContent, shown: !!document.getElementById('musicMini') && !document.getElementById('musicMini').hidden,
        playing: !MCC_MUSIC.audio.paused, line: document.getElementById('musicMiniAlbum')?.textContent }));
      check('resume: the listen page holds the record left on another device, without playing it', held.shown && held.title === runway.title && !held.playing, held);
      if (SHOTS) await page.screenshot({ path: join(OUT, 'listen-390-resume-held.png') });
      check('resume: listen at 390 with the held record fits', await fits(page));
      await page.locator('.appbar [data-app-player="play"]').click();
      await page.waitForFunction(() => !MCC_MUSIC.audio.paused && MCC_MUSIC.audio.currentTime > 0, null, { timeout: 15000 }).catch(() => {});
      const t = await page.evaluate(() => MCC_MUSIC.audio.currentTime);
      check('resume: one tap picks it up at its second', t >= 41 && t < 60, { t });
      await page.waitForTimeout(1200);
      await page.evaluate(() => MCC_MUSIC.pause());
      await page.waitForTimeout(800);
      const banked = writes.map(w => { try { return JSON.parse(w.body); } catch { return null; } }).filter(Boolean);
      check('resume: what plays here is written back for the next device', banked.some(b => b.profile_id === USER && b.state && b.state.title === runway.title), writes);
      check('resume (listen): no script errors', errors.length === 0, errors);
      await context.close();
    }
    {
      const { context, page, errors } = await setup({ member: true, remote });
      await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
      await page.waitForFunction(t => document.querySelector('#tracks li.on')?.getAttribute('data-title') === t, runway.title, { timeout: 15000 }).catch(() => {});
      const st = await page.evaluate(() => ({ on: document.querySelector('#tracks li.on')?.getAttribute('data-title'), t: document.getElementById('deck').currentTime, paused: document.getElementById('deck').paused }));
      check('resume: the album opens on the record left on another device, at its second, paused', st.on === runway.title && st.paused && st.t >= 41, st);
      check('resume (album): no script errors', errors.length === 0, errors);
      await context.close();
    }
    {
      const older = { src: here.tracks[0].src, title: here.tracks[0].title, album: 'here', t: 4, playing: true, at: Date.now() - 3600 * 1000 };
      const { context, page, errors } = await setup({ member: true, remote, pocket: older });
      await page.goto(HOUSE + '/account.html', { waitUntil: 'load' });
      await page.waitForSelector('.pocket .pocket__title', { timeout: 15000 }).catch(() => {});
      check('resume: the pocket prefers the newer record from another device over this device\'s older one',
        await page.locator('.pocket .pocket__title').textContent().catch(() => null) === runway.title);
      check('resume (pocket): no script errors', errors.length === 0, errors);
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
