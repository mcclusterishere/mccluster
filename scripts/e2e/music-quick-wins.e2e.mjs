/* THE MUSIC QUICK WINS, IN A REAL BROWSER (docs/music/MUSIC-RELEASE-20261119.md, "Quick wins (2026-11-23)").
   ============================================================
   Matthew, 2026-11-23: one McCluster profile, the artist (Q1); just albums and artists (Q2); whole covers, uniform
   (Q3); a creator is never asked to join (Q4); the closing song of CIA Mind Control stays listed but does not play,
   and says why (Q5); an album stops after its last song (Q6). Q7 (the approved listening events) is held by
   scripts/test/music-quick-wins.test.mjs.

   Every page is the real one, served from this checkout under Matthew McCluster's origin; the auth server,
   PostgREST, the music Edge function and the API Worker are the stand-ins in
   scripts/e2e/support/music-accounts-plane.mjs, with a few answers added here (a McCluster artist profile in the
   directory, a fixture creator's album, the house owner's own play of the closing song). Every song is answered
   with a short synthetic WAV, so an album reaches its end in seconds; every other host is aborted.

     node scripts/e2e/music-quick-wins.e2e.mjs [outDir]
   QW_ONLY=<regex> runs the scenarios whose name matches. QW_SHOTS=<dir> runs every page at device scale 2 and also
   writes the owner's screenshots (390 px, and 1280 px where the layout differs); the checks themselves run at scale 1.
   ============================================================ */
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePlane, HOUSE, PEOPLE, SBKEY, SB } from './support/music-accounts-plane.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const OUT = process.argv[2] || join(tmpdir(), 'music-quick-wins-e2e');
const ONLY = process.env.QW_ONLY ? new RegExp(process.env.QW_ONLY) : null;
const SHOTS = process.env.QW_SHOTS || '';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules', 'x'))('playwright')); }

const failures = [], checks = [];
const check = (ok, what, detail) => { checks.push({ ok: !!ok, what, detail: ok ? undefined : detail }); if (!ok) failures.push(what); console.log((ok ? 'ok   ' : 'FAIL ') + what + (ok || detail === undefined ? '' : ' ' + JSON.stringify(detail).slice(0, 500))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (page, fn, arg, timeout = 12000) => page.waitForFunction(fn, arg, { timeout, polling: 100 }).then(() => true, () => false);
/* the pop-up is open and has finished coming in (css/style.css gives every dialog a short scale-in, so a measure or a
   screenshot taken in its first third of a second sees it at 97 per cent) */
const holdOpen = (page, timeout) => until(page, () => { const d = document.getElementById('mccHold'); return !!d && d.open && d.getAnimations().every((a) => a.playState === 'finished'); }, null, timeout);

const CATALOG = JSON.parse(await readFile(join(ROOT, 'data/albums.json'), 'utf8')).albums;
const CIA = CATALOG.find((a) => a.slug === 'cia-mind-control');
const CLOSER = CIA.tracks[CIA.tracks.length - 1];             // the closing song: never named in this file
const CLOSER_KEY = String((CLOSER.gated && CLOSER.gated.object) || '').split('/')[0];
const HEAL = CATALOG.find((a) => a.slug === 'heal-the-3');

/* a short tone, as WAV bytes: every song is this long here */
function wav(seconds = 3) {
  const rate = 8000, n = Math.round(rate * seconds), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(i / 9) * 1200), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const HOUSE_ARTIST = { m_uid: '10000000-0000-4000-8000-0000000000c1', handle: 'mccluster', artist_name: 'McCluster', bio: '', avatar_url: '', banner_url: '', website_url: '', verification_state: 'unverified', status: 'active', settings: {} };
const ART_ID = '30000000-0000-4000-8000-0000000000d1';
const ARTWORK = `${SB}/storage/v1/object/public/creator-artwork/${ART_ID}/wide-cover.jpg`;
const FIXTURE_ARTIST = { m_uid: PEOPLE.creator.muid, handle: 'fixture-artist', artist_name: 'Fixture Artist', bio: 'Fixture biography.', avatar_url: '', banner_url: '', website_url: '', verification_state: 'unverified', status: 'active',
  settings: { albums: [{ id: 'alb_fixture01', title: 'Fixture Album', kind: 'album', release_date: '2026-11-01', description: '', cover_url: ARTWORK, tracks: ['40000000-0000-4000-8000-0000000000e1'] }], featured_album: 'alb_fixture01' } };
const FIXTURE_TRACK = { id: '40000000-0000-4000-8000-0000000000e1', title: 'Fixture Song', artist: 'Fixture Artist', description: '', poster_url: ARTWORK, audio_url: HOUSE + '/__fixture-song.wav',
  preview_bucket: null, preview_path: null, access_mode: 'public', genre: '', duration_ms: 3000, music_video_url: '', lyrics_url: '', experience: {}, published_at: '2026-11-01T00:00:00Z', m_uid: PEOPLE.creator.muid };

async function context(browser, plane, width = 390, opts = {}) {
  const mobile = width < 600;
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: opts.dsf || (SHOTS ? 2 : 1), serviceWorkers: 'block' });
  await plane.install(ctx, ROOT);
  const audio = [], events = [];
  /* registered after the plane, so these answer first; anything they do not take falls back to the plane */
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    let url; try { url = new URL(req.url()); } catch (e) { return route.fallback(); }
    /* the measurement wire, read here (it sends only with the visitor's consent) */
    if ((url.origin === 'https://api.mccluster.org' && url.pathname === '/v1/collect') || (url.origin === SB && url.pathname === '/functions/v1/collect')) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
      try { const body = JSON.parse(req.postData() || '{}'); (body.events || []).forEach((e) => events.push({ name: e && e.name, props: (e && e.props) || {} })); } catch (e) { events.push({ name: 'unreadable' }); }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' });
    }
    if (url.origin === HOUSE && (/^\/assets\/audio\//.test(url.pathname) || /^\/__(master|fixture-song)\.wav$/.test(url.pathname))) {
      audio.push({ t: Date.now(), path: url.pathname, page: (() => { try { return new URL(req.frame().url()).pathname; } catch (e) { return ''; } })() });
      /* served as Pages serves it, with byte ranges: a song that is not seekable lands any seek on 0:00 */
      const body = wav(opts.seconds || 3), range = /^bytes=(\d*)-(\d*)$/.exec(req.headers().range || '');
      if (!range) return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes' }, body });
      const from = range[1] === '' ? Math.max(0, body.length - Number(range[2])) : Number(range[1]);
      const to = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
      return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${from}-${to}/${body.length}` }, body: body.subarray(from, to + 1) });
    }
    if (url.origin === SB && url.pathname === '/rest/v1/music_creator_profiles' && req.method() === 'GET') {
      const handle = (url.searchParams.get('handle') || '').replace(/^eq\./, '');
      const muid = (url.searchParams.get('m_uid') || '').replace(/^eq\./, '');
      const rows = [HOUSE_ARTIST, FIXTURE_ARTIST].filter((p) => (!handle && !muid) || p.handle === handle || p.m_uid === muid);
      if (muid && !rows.length) return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(rows) });
    }
    if (url.origin === SB && url.pathname === '/rest/v1/creator_tracks' && req.method() === 'GET') {
      const muid = (url.searchParams.get('m_uid') || '').replace(/^eq\./, '');
      const rows = muid === PEOPLE.creator.muid ? [FIXTURE_TRACK] : [];
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(rows) });
    }
    if (url.origin === SB && url.pathname.startsWith('/storage/v1/object/public/creator-artwork/')) {
      return route.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: await readFile(join(ROOT, 'assets/img/cia-mind-control-cover.jpg')) });
    }
    if (url.origin === 'https://api.mccluster.org' && /^\/v1\/music\/gates\/[a-z0-9-]+\/play$/.test(url.pathname)) {
      const bearer = (/^bearer\s+(.+)$/i.exec(req.headers().authorization || '') || [])[1] || '';
      if (plane.classify(bearer) === 'fresh:owner') return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, url: HOUSE + '/__master.wav', expires_in: 600 }) });
      return route.fallback();
    }
    if (url.origin === HOUSE && url.pathname === '/__desk.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: DESK_HARNESS });
    return route.fallback();
  });
  return { ctx, audio, events };
}
/* the World's member desk on its own: the real js/mcc-auth.js, js/member-desk-core.js and js/member-desk.js over a stand-in
   for the World's identity (MCC_MNET) and its account menu */
const DESK_HARNESS = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>desk</title><link rel="stylesheet" href="css/member-desk.css"></head><body>
<nav id="mnMenu"><button data-mn-view="profile">Profile</button></nav>
<script>window.MCC_MNET={identity:function(){var s=null;try{s=JSON.parse(localStorage.getItem('mccdb_session'))}catch(e){}return s?{m_uid:window.__muid||'',mccluster_id:'fixture'}:{}},profile:function(){return{display_name:'Fixture'}}};</script>
<script src="js/mcc-auth.js"></script><script src="js/member-desk-core.js"></script><script src="js/member-desk.js"></script></body></html>`;

async function seed(page, items) {
  await page.goto(HOUSE + '/__blank');
  await page.evaluate((it) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('mcc_privacy_seen', JSON.stringify({ version: '2026-10-19', seen_at: new Date().toISOString() }));
    for (const k of Object.keys(it)) localStorage.setItem(k, it[k]);
  }, items || {});
}
const slots = (s) => { const v = JSON.stringify(s); return { mccdb_session: v, mcc_sess_keep: v }; };
async function fits(page, label) {
  const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  check(m.s === m.c, `${label}: scrollWidth ${m.s} === clientWidth ${m.c}`, m);
}
/* the owner's copy of what this page shows now, at device scale 2 */
/* the owner's screenshots only (QW_SHOTS): the house's sections fade in as they are scrolled to (js/masthead.js), so a
   screenshot first scrolls to what it shows, or, for a whole page, through the whole page, and waits for the fade */
async function shot(page, name, opts = {}) {
  if (!SHOTS) return;
  /* the album's once-a-session premiere curtain (js/chamber.js) lifts on its own: a shot waits for it, or it shows only
     the curtain */
  await page.waitForFunction(() => !document.getElementById('prem'), null, { timeout: 12000 }).catch(() => {});
  if (opts.full) {
    /* the house scrolls smoothly (scroll-behavior on <html>): each step is instant, so the page is where the shot says */
    await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(innerHeight * 0.6)) { scrollTo({ top: y, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 160)); } scrollTo({ top: 0, behavior: 'instant' }); });
    await sleep(1200);
  } else if (opts.at) {
    await page.evaluate((sel) => { const el = document.querySelector(sel); if (el) scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + scrollY - 72), behavior: 'instant' }); }, opts.at);
    await sleep(1200);
  }
  await page.screenshot({ path: join(SHOTS, name + '.png'), fullPage: !!opts.full });
}

/* what a cover element draws: its fit, anything behind it, its corners and shadow, and its box */
const COVER_STYLE = (sel) => Array.from(document.querySelectorAll(sel)).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map((e) => {
  const cs = getComputedStyle(e), r = e.getBoundingClientRect();
  return { sel, fit: cs.objectFit, bgSize: cs.backgroundSize, bgColor: cs.backgroundColor, radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius],
    shadow: cs.boxShadow, w: Math.round(r.width), h: Math.round(r.height), img: e.tagName === 'IMG' ? { nw: e.naturalWidth, nh: e.naturalHeight } : null, bgImage: cs.backgroundImage !== 'none' };
});
function coverOk(list, label, { span = false } = {}) {
  check(list.length > 0, `${label}: there are covers to look at`, list);
  for (const c of list.slice(0, 6)) {
    const whole = span ? /contain/.test(c.bgSize) : c.fit === 'contain';
    const nothingBehind = /rgba\(0, 0, 0, 0\)|transparent/.test(c.bgColor);
    const square = Math.abs(c.w - c.h) <= 1;
    const corners = c.radius.every((x) => x === '0px');
    check(whole && nothingBehind && square && corners && c.shadow === 'none', `${label}: ${c.sel} draws the whole cover in a uniform ${c.w} px square, nothing behind it, no corner cut`, c);
  }
}

/* WHAT SHOWS IN THE EMPTY PART OF A COVER'S SQUARE (review QW-R1). A cover that is not square leaves bands above
   and below it (or beside it), and a mark on a clear ground leaves its clear pixels: there the screen must show the
   ground the card sits on, never a plate added behind the artwork. Read from a real screenshot of the square: the
   middle of each band, and the artwork's own clear corners, against the ground just outside the card: above it (a
   shelf: outside the shelf itself), or beside it at the same height (a player whose own panel is a gradient: the
   pocket). coverOk above reads only the image's own background; a plate drawn by a container behind a transparent
   card passed it. */
async function groundOk(page, sel, label, { max = 8, settleMs = 800, ref = 'above' } = {}) {
  const n = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
  let looked = 0;
  for (let i = 0; i < Math.min(n, max); i++) {
    await page.evaluate(({ s, i }) => { const e = document.querySelectorAll(s)[i]; if (e) e.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); }, { s: sel, i });
    await sleep(settleMs);
    const m = await page.evaluate(async ({ s, i, ref }) => {
      const e = document.querySelectorAll(s)[i];
      if (!e) return { skip: 'gone' };
      const r = e.getBoundingClientRect();
      const src = e.tagName === 'VIDEO' ? (e.getAttribute('poster') || '') : (e.currentSrc || e.getAttribute('src') || '');
      if (!src || r.width < 8 || r.height < 8) return { skip: 'no picture' };
      const im = new Image(); im.src = src;
      try { await im.decode(); } catch (err) { return { skip: 'not decoded' }; }
      const nw = im.naturalWidth, nh = im.naturalHeight;
      const k = Math.min(r.width / nw, r.height / nh), dw = nw * k, dh = nh * k, dx = r.left + (r.width - dw) / 2, dy = r.top + (r.height - dh) / 2;
      const pts = [];
      if (dh < r.height - 4) pts.push(['band above', r.left + r.width / 2, r.top + (dy - r.top) / 2], ['band below', r.left + r.width / 2, dy + dh + (r.bottom - dy - dh) / 2]);
      if (dw < r.width - 4) pts.push(['band left', r.left + (dx - r.left) / 2, r.top + r.height / 2], ['band right', dx + dw + (r.right - dx - dw) / 2, r.top + r.height / 2]);
      const c = document.createElement('canvas'); c.width = nw; c.height = nh;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      for (const [fx, fy, name] of [[0.04, 0.04, 'clear top-left'], [0.96, 0.04, 'clear top-right'], [0.04, 0.96, 'clear bottom-left'], [0.96, 0.96, 'clear bottom-right']]) {
        if (g.getImageData(Math.floor(fx * (nw - 1)), Math.floor(fy * (nh - 1)), 1, 1).data[3] === 0) pts.push([name, dx + fx * dw, dy + fy * dh]);
      }
      const side = r.left >= 4 ? r.left - 3 : r.right + 3;
      const ground = (p) => (ref === 'beside' ? [side, p[2]] : r.top >= 4 ? [r.left + r.width / 2, r.top - 3] : [r.left - 3, r.top + r.height / 2]);
      return { file: src.split('/').pop().split('?')[0], nw, nh, box: { x: r.left, y: r.top, w: r.width, h: r.height }, pts: pts.map((p) => p.concat([ground(p)])), vw: innerWidth, vh: innerHeight };
    }, { s: sel, i, ref });
    if (m.skip || !m.pts.length) continue;   // a square, opaque cover fills its square: nothing can show behind it
    const xs = m.pts.flatMap((p) => [p[1], p[3][0]]), ys = m.pts.flatMap((p) => [p[2], p[3][1]]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 2), y0 = Math.max(0, Math.floor(Math.min(...ys)) - 2);
    const clip = { x: x0, y: y0, width: Math.min(m.vw - x0, Math.ceil(Math.max(...xs)) + 3 - x0), height: Math.min(m.vh - y0, Math.ceil(Math.max(...ys)) + 3 - y0) };
    if (clip.width < 3 || clip.height < 3) continue;
    const png = await page.screenshot({ clip });
    const px = await page.evaluate(async ({ b64, clip, pts }) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const g = c.getContext('2d'); g.drawImage(im, 0, 0);
      const k = im.width / clip.width;
      const at = (X, Y) => Array.from(g.getImageData(Math.min(im.width - 1, Math.round((X - clip.x) * k)), Math.min(im.height - 1, Math.round((Y - clip.y) * k)), 1, 1).data.slice(0, 3));
      return { pts: pts.map((p) => [p[0], at(p[1], p[2]), at(p[3][0], p[3][1])]) };
    }, { b64: png.toString('base64'), clip, pts: m.pts });
    const far = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    looked++;
    check(px.pts.every((p) => far(p[1], p[2]) <= 10), `${label}: ${m.file} (${m.nw} x ${m.nh}): the empty part of its square shows the ground it sits on, nothing added behind it`, px);
  }
  check(looked > 0, `${label}: there are covers with an empty part to look at`, { n });
}
/* the visitor agreed to measurement, so the wire carries what the page sends */
const CONSENT = () => ({ mcc_privacy_ack: JSON.stringify({ version: '2026-10-19', at: new Date().toISOString() }) });

const SCENARIOS = {
  /* ---------------------------------------------------------------- Q1 */
  async q1_one_mccluster(browser) {
    const plane = makePlane();
    const { ctx } = await context(browser, plane, 390);
    const page = await ctx.newPage();
    await seed(page, {});
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await until(page, () => document.querySelectorAll('#artistsRow a.artist').length >= 2);
    const rail = await page.evaluate(() => Array.from(document.querySelectorAll('#artistsRow a.artist')).map((a) => ({ href: a.getAttribute('href'), text: a.textContent.replace(/\s+/g, ' ').trim() })));
    check(rail[0] && rail[0].href === 'music-creator.html?handle=mccluster' && /McCluster/.test(rail[0].text) && /Artist/.test(rail[0].text), 'Q1 listen: McCluster is first, the artist, and opens his artist page', rail);
    check(rail.filter((a) => /McCluster/.test(a.text)).length === 1, 'Q1 listen: one McCluster on the Artists rail, not two', rail);
    check(!rail.some((a) => a.href === 'index.html') && !(await page.evaluate(() => /the house/i.test(document.getElementById('artistsWrap').textContent))), 'Q1 listen: no "house" card or words on the rail', rail);
    await fits(page, 'Q1 listen at 390');
    await shot(page, 'listen-390-artists-one-mccluster', { at: '#artistsWrap' });

    await page.goto(HOUSE + '/music-creator.html?handle=mccluster', { waitUntil: 'load' });
    await until(page, () => document.querySelectorAll('#apShelf .ap-card, #apHouseShelf .ap-card').length > 0, null, 15000);
    const ap = await page.evaluate(() => ({ name: document.getElementById('creatorArtist').textContent.replace(/\s+/g, ' ').trim(),
      albums: Array.from(document.querySelectorAll('#apHouseShelf a.ap-card')).map((a) => ({ href: a.getAttribute('href'), title: a.querySelector('b') && a.querySelector('b').textContent })),
      empty: /No published releases yet/.test(document.body.innerText) }));
    const houseAlbums = CATALOG.filter((a) => !a.artist).map((a) => 'album.html?album=' + a.slug);
    check(/McCluster/.test(ap.name), 'Q1 his artist page is McCluster', ap);
    check(houseAlbums.every((h) => ap.albums.some((x) => x.href === h)) && ap.albums.length === houseAlbums.length, 'Q1 his artist page carries his records, each opening its album', { ap, houseAlbums });
    check(!ap.empty, 'Q1 his artist page never says it has no releases', ap);
    await fits(page, 'Q1 McCluster\'s artist page at 390');
    await shot(page, 'artist-390-mccluster-one-profile');

    await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
    await until(page, () => !!document.querySelector('#albArtist a'));
    const by = await page.evaluate(() => { const a = document.querySelector('#albArtist a'); return a ? { text: a.textContent, href: a.getAttribute('href') } : null; });
    check(by && by.text === 'McCluster' && by.href === 'music-creator.html?handle=mccluster', 'Q1 album: the credit names McCluster the artist and opens his page', by);
    await page.click('#playAll');
    await until(page, () => navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.title);
    const md = await page.evaluate(() => ({ artist: navigator.mediaSession.metadata.artist, by: document.getElementById('nowBy').textContent }));
    check(md.artist === 'McCluster' && md.by === 'McCluster', 'Q1 album: the lock screen and the Now sheet credit McCluster', md);
    await ctx.close();

    /* the bar on his own page, signed in: the house stays the house (no second McCluster in the middle cell) */
    const p2 = makePlane();
    const { ctx: c2 } = await context(browser, p2, 390);
    const pg = await c2.newPage();
    await seed(pg, slots(p2.storedSession('member', 3600)));
    await pg.goto(HOUSE + '/music-creator.html?handle=mccluster', { waitUntil: 'load' });
    await sleep(3500);
    const bar = await pg.evaluate(() => { const h = document.querySelector('.appbar [data-appnav="home"]'); return h ? { perspective: h.getAttribute('data-perspective'), label: (h.querySelector('span:last-child') || {}).textContent } : null; });
    check(bar && !bar.perspective, 'Q1 bar: on McCluster\'s own page the middle cell stays the house, not a second McCluster', bar);
    await c2.close();
  },

  /* ---------------------------------------------------------------- Q2 */
  async q2_albums_and_artists(browser) {
    const plane = makePlane();
    for (const width of [390, 1280]) {
      const { ctx } = await context(browser, plane, width);
      const page = await ctx.newPage();
      await seed(page, {});
      await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
      await until(page, () => document.querySelectorAll('#shelf .feat__card').length > 0 && document.querySelectorAll('#artistsRow a.artist').length >= 2);
      const v = await page.evaluate(() => {
        const vis = (e) => { if (!e || e.closest('[hidden]')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return { heads: Array.from(document.querySelectorAll('.ls .lib__k')).filter(vis).map((e) => e.textContent.trim()),
          chips: !!document.getElementById('chips') && vis(document.getElementById('chips')),
          albums: Array.from(document.querySelectorAll('#shelf a.feat__card')).map((a) => a.getAttribute('href')),
          songs: vis(document.getElementById('allWrap')) };
      });
      check(JSON.stringify(v.heads) === JSON.stringify(['Artists', 'Albums']), `Q2 listen at ${width}: Artists and Albums, nothing else`, v.heads);
      check(!v.chips, `Q2 listen at ${width}: no filter row`, v);
      check(CATALOG.every((a) => v.albums.includes('album.html?album=' + a.slug)), `Q2 listen at ${width}: every album is reachable`, v.albums);
      check(!v.songs, `Q2 listen at ${width}: no song list until a search asks for one`, v);
      if (width === 390) await fits(page, 'Q2 listen at 390');
      await shot(page, `listen-${width}-albums-and-artists`, { full: true });
      await page.fill('#q', 'heal');
      await until(page, () => document.querySelectorAll('#all li a.row').length > 0);
      check(await page.evaluate(() => !document.getElementById('allWrap').hidden && document.querySelectorAll('#all li a.row').length >= 2), `Q2 listen at ${width}: a search still finds the songs`);
      await ctx.close();
    }
    const { ctx } = await context(browser, plane, 390);
    const page = await ctx.newPage();
    await seed(page, {});
    await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
    await until(page, () => document.querySelectorAll('#featRail .feat__card').length > 0);
    const a = await page.evaluate(() => ({ chips: !!document.getElementById('chips'), playlists: !!document.getElementById('plWrap'), text: document.body.innerText,
      featK: (document.getElementById('featK') || {}).textContent, tag: document.getElementById('albTag').textContent }));
    check(!a.chips && !a.playlists && !/Curated by the house|The playlists|My Rotation/.test(a.text), 'Q2 album: no playlists, no house shelf, no playlist filter', { chips: a.chips, playlists: a.playlists });
    check(a.featK === 'Albums', 'Q2 album: the shelf says Albums', a.featK);
    check(a.tag === 'Album · 6 songs', 'Q2 album: the record says plainly what it is', a.tag);
    await fits(page, 'Q2 album at 390');
    for (const [slug, want] of [['everything', '/listen.html'], ['my-rotation', '/listen.html'], ['the-civic-set', '/listen.html'], ['music-videos', '/music-videos.html'], ['the-films', '/music-videos.html']]) {
      await page.goto(HOUSE + '/album.html?playlist=' + slug, { waitUntil: 'load' }).catch(() => {});
      await page.waitForURL((u) => new URL(u).pathname === want, { timeout: 10000 }).catch(() => {});
      check(new URL(page.url()).pathname === want, `Q2 an old ${slug} playlist link lands on ${want}`, page.url());
    }
    await ctx.close();
  },

  /* ---------------------------------------------------------------- Q3 */
  async q3_whole_covers(browser) {
    const plane = makePlane();
    const { ctx } = await context(browser, plane, 390);
    const page = await ctx.newPage();
    await seed(page, {});
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await until(page, () => document.querySelectorAll('#shelf .feat__bg').length > 0 && Array.from(document.querySelectorAll('#shelf .feat__bg')).every((i) => i.complete));
    coverOk(await page.evaluate(COVER_STYLE, '#shelf .feat__bg'), 'Q3 listen shelf');
    await shot(page, 'listen-390-shelf-whole-covers', { at: '#shelfWrap' });
    await page.fill('#q', 'cia mind control');
    await until(page, () => document.querySelectorAll('#all li .th').length > 0);
    coverOk(await page.evaluate(COVER_STYLE, '#all .th'), 'Q3 listen rows', { span: true });
    await page.click('#all li button.music-inline-play');
    await until(page, () => !!document.getElementById('musicMiniArt') && document.getElementById('musicMiniArt').complete && !document.getElementById('musicMini').hidden);
    coverOk(await page.evaluate(COVER_STYLE, '#musicMiniArt'), 'Q3 listen mini player');
    await shot(page, 'listen-390-mini-player-whole-cover');
    await page.evaluate(() => window.MCC_MUSIC.openNow());
    await until(page, () => document.getElementById('musicNow') && document.getElementById('musicNow').classList.contains('is-open'));
    await sleep(500);
    coverOk(await page.evaluate(COVER_STYLE, '#musicNowArt'), 'Q3 listen Now Playing sheet');
    check(await page.evaluate(() => getComputedStyle(document.querySelector('.music-now__ambient')).display === 'none'), 'Q3 listen Now Playing: no blurred copy of the cover behind the sheet');
    await shot(page, 'listen-390-now-playing-whole-cover');

    /* here has a living sleeve in data/environments.json: the hero must still be the still, whole cover */
    await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
    await until(page, () => document.getElementById('albArt').complete && document.querySelectorAll('#featRail .feat__bg').length > 0);
    await sleep(1500);
    const sleeve = await page.evaluate(() => ({ env: !!document.querySelector('.env'), still: getComputedStyle(document.getElementById('albArt')).display !== 'none' }));
    check(!sleeve.env && sleeve.still, 'Q3 album hero: the still cover, not the living sleeve drawn over it', sleeve);
    coverOk(await page.evaluate(COVER_STYLE, '#albArt'), 'Q3 album hero (here)');
    await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
    await until(page, () => document.getElementById('albArt').complete && document.querySelectorAll('#featRail .feat__bg').length > 0);
    await sleep(700);
    coverOk(await page.evaluate(COVER_STYLE, '#albArt'), 'Q3 album hero');
    coverOk(await page.evaluate(COVER_STYLE, '#featRail .feat__bg'), 'Q3 album shelf');
    coverOk(await page.evaluate(COVER_STYLE, '#tracks .th'), 'Q3 album rows', { span: true });
    await shot(page, 'album-390-hero-whole-cover');
    await page.click('#playAll');
    await until(page, () => { const d = document.getElementById('deck'); return !d.paused && d.duration > 0 && d.currentTime > 0.3; });
    coverOk(await page.evaluate(COVER_STYLE, '.deckbar__art'), 'Q3 album mini player (the deck bar)');
    await shot(page, 'album-390-mini-player-whole-cover');
    await page.click('.deckbar__art');
    await until(page, () => document.getElementById('now').dataset.on === '1');
    await sleep(500);
    const sheet = await page.evaluate(() => { const w = document.querySelector('.now__art'), cs = getComputedStyle(w), f = getComputedStyle(document.getElementById('nowFilm'));
      return { cover: w.classList.contains('now__art--cover'), bg: cs.backgroundColor, shadow: cs.boxShadow, fit: f.objectFit, scrim: getComputedStyle(document.querySelector('.now__scrim')).display }; });
    check(sheet.cover && /rgba\(0, 0, 0, 0\)/.test(sheet.bg) && sheet.shadow === 'none' && sheet.fit === 'contain' && sheet.scrim === 'none', 'Q3 album Now sheet: a song with no film shows its whole cover, nothing behind or over it', sheet);

    await page.goto(HOUSE + '/catalogue.html', { waitUntil: 'load' });
    await until(page, () => document.querySelectorAll('#shelf .cov').length > 0 && Array.from(document.querySelectorAll('#shelf .cov')).every((i) => i.complete));
    coverOk(await page.evaluate(COVER_STYLE, '#shelf .cov'), 'Q3 catalogue shelf');
    await fits(page, 'Q3 catalogue at 390');

    await page.goto(HOUSE + '/music-creator.html?handle=fixture-artist', { waitUntil: 'load' });
    await until(page, () => document.getElementById('apAlbumArt') && document.getElementById('apAlbumArt').complete && !document.getElementById('apFeatured').hidden, null, 15000);
    coverOk(await page.evaluate(COVER_STYLE, '#apAlbumArt'), 'Q3 artist page album');
    coverOk(await page.evaluate(COVER_STYLE, '.ap-track img'), 'Q3 artist page rows');
    const hero = await page.evaluate(() => { const i = document.getElementById('apHeroImg'); return { hidden: i.hidden, src: i.getAttribute('src') || '' }; });
    check(hero.hidden || !/creator-artwork\/.*wide-cover/.test(hero.src), 'Q3 artist page: a cover is never cropped into the hero backdrop', hero);
    await fits(page, 'Q3 artist page at 390');

    await page.goto(HOUSE + '/music-creator.html?handle=mccluster', { waitUntil: 'load' });
    await until(page, () => document.querySelectorAll('#apHouseShelf .ap-card img').length > 0 && Array.from(document.querySelectorAll('#apHouseShelf .ap-card img')).every((i) => i.complete), null, 15000);
    coverOk(await page.evaluate(COVER_STYLE, '#apHouseShelf .ap-card img'), 'Q3 McCluster\'s albums on his page');

    await page.goto(HOUSE + '/embed.html?album=cia-mind-control', { waitUntil: 'load' });
    await until(page, () => document.getElementById('art').complete && document.getElementById('art').naturalWidth > 0);
    const em = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('art')); return { fit: cs.objectFit, radius: cs.borderTopLeftRadius }; });
    check(em.fit === 'contain' && em.radius === '0px', 'Q3 embedded player: the whole cover', em);
    await ctx.close();
  },

  /* ---------------------------------------------------------------- Q4 */
  async q4_creators_never_asked_to_join(browser) {
    const PITCH = /Put your music in the same ecosystem|For artists & creators/;
    const JOIN = /^(Become a creator|Make your own artist page|Sign in to make your own artist page)$/;
    /* the offer block is the one the page marks data-creator-offer inside the Creator Studio section (or the section itself) */
    const BOX = '.music-launch[data-creator-offer], .music-launch [data-creator-offer]';
    const offer = () => {
      const box = document.querySelector('.music-launch');
      const ob = document.querySelector('.music-launch[data-creator-offer], .music-launch [data-creator-offer]');
      const vis = (e) => { if (!e || e.closest('[hidden]')) return false; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return { text: Array.from(box.querySelectorAll('strong,span,small,a,b')).filter(vis).map((e) => e.textContent.replace(/\s+/g, ' ').trim()), pending: !!ob && ob.hasAttribute('data-offer-pending'), state: ob && ob.getAttribute('data-offer-state') };
    };
    for (const who of ['guest', 'member', 'creator', 'owner']) {
      for (const life of who === 'guest' ? [3600] : [3600, -7200]) {
        const plane = makePlane({ refreshDelayMs: life < 0 ? 600 : 0 });
        const { ctx } = await context(browser, plane, 390);
        const page = await ctx.newPage();
        await seed(page, who === 'guest' ? {} : slots(plane.storedSession(who, life)));
        await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
        await until(page, (sel) => { const b = document.querySelector(sel); return !!b && !b.hasAttribute('data-offer-pending') && !!b.getAttribute('data-offer-state'); }, BOX, 15000);
        const o = await page.evaluate(offer);
        const tag = `Q4 listen ${who}${life < 0 ? ' back after the token\'s hour' : ''}`;
        if (who === 'creator' || who === 'owner') {
          check(!o.text.some((t) => PITCH.test(t) || JOIN.test(t)), `${tag}: never the join pitch or a join offer`, o);
          check(o.text.some((t) => /^Open Creator Studio$/.test(t)), `${tag}: their Creator Studio`, o);
          if (life > 0 && who === 'creator') { await page.evaluate(() => document.querySelector('.music-launch').scrollIntoView({ block: 'center' })); await sleep(1200); await shot(page, 'listen-390-creator-no-join-offer'); }
        } else {
          check(o.text.some((t) => PITCH.test(t)), `${tag}: the join pitch`, o);
          check(o.text.some((t) => (who === 'guest' ? /^Sign in$/ : /^Become a creator$/).test(t)), `${tag}: the one offer for them`, o);
        }
        await page.goto(HOUSE + '/music-creator.html?handle=fixture-artist', { waitUntil: 'load' });
        await until(page, () => { const b = document.querySelector('[data-creator-offer]'); return b && b.getAttribute('data-offer-state'); }, null, 15000);
        const foot = await page.evaluate(() => Array.from(document.querySelectorAll('.ap-foot a')).filter((a) => !a.closest('[hidden]')).map((a) => a.textContent.trim()));
        if (who === 'creator' || who === 'owner') check(!foot.some((t) => JOIN.test(t)) && foot.includes('Open Creator Studio'), `${tag}: the artist page's foot is their studio, not a join offer`, foot);
        await ctx.close();
      }
    }
    /* right after sign-in, in another tab: the open Listen page follows without a reload */
    const plane = makePlane();
    const { ctx } = await context(browser, plane, 390);
    const page = await ctx.newPage();
    await seed(page, {});
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await until(page, (sel) => { const b = document.querySelector(sel); return !!b && !b.hasAttribute('data-offer-pending') && !!b.getAttribute('data-offer-state'); }, BOX);
    const other = await ctx.newPage();
    await other.goto(HOUSE + '/__blank');
    await other.evaluate((v) => { localStorage.setItem('mccdb_session', v); localStorage.setItem('mcc_sess_keep', v); }, JSON.stringify(plane.storedSession('creator', 3600)));
    const followed = await until(page, (sel) => { const b = document.querySelector(sel); return !!b && b.getAttribute('data-offer-state') === 'studio'; }, BOX, 15000);
    const after = await page.evaluate(offer);
    check(followed && !after.text.some((t) => PITCH.test(t) || JOIN.test(t)), 'Q4 listen: right after a creator signs in elsewhere, the join pitch is gone without a reload', after);
    await ctx.close();

    /* the World's desk: a creator is never offered "Become a creator", even when the answer does not come */
    for (const [who, broken, want] of [['member', false, true], ['creator', false, false], ['creator', true, false], ['owner', true, false]]) {
      const pl = makePlane();
      const { ctx: c } = await context(browser, pl, 390);
      if (broken) await c.route(SB + '/rest/v1/**', (r) => /music_creator_state|music_creator_profiles/.test(r.request().url()) ? r.fulfill({ status: 503, body: '{}' }) : r.fallback());
      const p = await c.newPage();
      await seed(p, slots(pl.storedSession(who, 3600)));
      await p.goto(HOUSE + '/__desk.html', { waitUntil: 'load' });
      await p.evaluate((m) => { window.__muid = m; }, PEOPLE[who].muid);
      await p.evaluate(() => window.HU_DESK && window.HU_DESK.open('profile'));
      await until(p, () => !!document.querySelector('#huDeskBody .hu-desk__who'), null, 15000);
      const desk = await p.evaluate(() => Array.from(document.querySelectorAll('#huDeskBody a')).map((a) => a.textContent.trim()));
      const tag = `Q4 desk ${who}${broken ? ' while the creator answer fails' : ''}`;
      check(desk.includes('Become a creator') === want, `${tag}: ${want ? 'offered' : 'never offered'} Become a creator`, desk);
      await c.close();
    }
  },

  /* ---------------------------------------------------------------- Q5 */
  async q5_closing_song_held(browser) {
    /* the closing song's row is the album's one gated row; it is found by that, and reported by its place, never by name */
    const HELD = '#tracks li[data-gated-object]';
    const onIndex = () => Array.from(document.querySelectorAll('#tracks li')).findIndex((r) => r.classList.contains('on'));
    const LAST = CIA.tracks.length - 1, PREV = CIA.tracks.length - 2;
    for (const who of ['guest', 'member']) {
      const plane = makePlane();
      const { ctx, audio } = await context(browser, plane, 390, { seconds: 3 });
      const page = await ctx.newPage();
      await seed(page, who === 'guest' ? {} : slots(plane.storedSession(who, 3600)));
      await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
      await until(page, (sel) => { const r = document.querySelector(sel); return r && r.getAttribute('data-gate') && r.getAttribute('data-gate') !== 'opening'; }, HELD, 15000);
      await sleep(800);
      const row = await page.evaluate((sel) => { const r = document.querySelector(sel); return { held: r.hasAttribute('data-hold'), src: r.getAttribute('data-src'), preview: r.getAttribute('data-preview-src') !== null, at: Array.from(r.parentNode.children).indexOf(r) }; }, HELD);
      check(row.at === LAST, `Q5 ${who}: the closing song stays listed, last on the album`, row);
      check(row.held && row.src === '' && !row.preview, `Q5 ${who}: its row is held, with no preview address to fetch`, row);
      await page.click(HELD);
      const shown = await holdOpen(page);
      const dlg = await page.evaluate(() => { const d = document.getElementById('mccHold'); return d ? { title: d.querySelector('h2').textContent, text: d.querySelector('p').textContent, action: { text: d.querySelector('a').textContent, href: d.querySelector('a').getAttribute('href') } } : null; });
      const deck0 = await page.evaluate(() => { const d = document.getElementById('deck'); return { paused: d.paused, src: !!d.currentSrc }; });
      check(shown && deck0.paused, `Q5 ${who}: tapping its row opens one pop-up and plays nothing`, { dlg, deck0 });
      if (who === 'guest') {
        check(dlg && /sign in/i.test(dlg.text) && /full profile/i.test(dlg.text) && /short questionnaire/i.test(dlg.text) && dlg.action.text === 'Sign in' && dlg.action.href === 'account.html?next=' + encodeURIComponent('/album.html?album=cia-mind-control'), 'Q5 guest: it says why, with Sign in', dlg);
      } else {
        check(dlg && /complete your full profile/i.test(dlg.text) && /questionnaire opens soon/i.test(dlg.text) && dlg.action.href === 'mnet.html?view=profile', 'Q5 member: it says to finish the profile, the questionnaire opens soon, with the profile button', dlg);
      }
      await fits(page, `Q5 ${who}: the pop-up at 390`);
      await shot(page, `album-390-closing-song-${who === 'guest' ? 'signed-out' : 'signed-in'}`);
      await page.keyboard.press('Escape');
      check(await until(page, () => { const d = document.getElementById('mccHold'); return !!d && !d.open; }), `Q5 ${who}: Escape closes it`);
      /* Next into it */
      await page.click(`#tracks li:nth-child(${PREV + 1})`);
      await until(page, () => !document.getElementById('deck').paused && document.getElementById('deck').currentTime > 0.2);
      await page.click('#tpNext');
      const next = await holdOpen(page);
      await sleep(400);
      const st = await page.evaluate((f) => ({ paused: document.getElementById('deck').paused, on: (new Function('return (' + f + ')()'))() }), onIndex.toString());
      check(next && st.paused && st.on === PREV, `Q5 ${who}: Next into it opens the pop-up and the album stops on the song before it`, st);
      await page.keyboard.press('Escape');
      /* the album reaching it */
      await page.click(`#tracks li:nth-child(${PREV + 1})`);
      await until(page, () => !document.getElementById('deck').paused);
      const reached = await holdOpen(page, 15000);
      await sleep(400);
      const end = await page.evaluate((f) => { const d = document.getElementById('deck'); return { paused: d.paused, on: (new Function('return (' + f + ')()'))(), np: navigator.mediaSession.playbackState }; }, onIndex.toString());
      check(reached && end.paused && end.on === PREV, `Q5 ${who}: the album reaching it opens the pop-up and stops`, end);
      const lock = await page.evaluate((t) => !!(navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === t), CLOSER.title);
      check(!lock, `Q5 ${who}: nothing of it on the lock screen`, { onLockScreen: lock });
      const reads = audio.filter((x) => x.path === '/' + CLOSER.src || x.path.includes(CLOSER_KEY)).length;
      check(reads === 0, `Q5 ${who}: no read of its preview or its master, ever`, { reads });
      const ledger = plane.log.filter((x) => x.path === '/v1/music/listens' && x.method === 'POST').length;
      const plays = plane.log.filter((x) => /\/v1\/music\/gates\/[^/]+\/play$/.test(x.path)).length;
      check(plays === 0, `Q5 ${who}: no stream request for it`, { plays, ledger });
      await ctx.close();
    }
    /* the listen engine: the inline play button and the lock screen */
    const plane = makePlane();
    const { ctx, audio } = await context(browser, plane, 390);
    const page = await ctx.newPage();
    await seed(page, {});
    await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await page.fill('#q', 'cia mind control');
    await until(page, () => document.querySelectorAll('#all li button.music-inline-play').length >= 3);
    await page.evaluate((t) => { const b = Array.from(document.querySelectorAll('#all li button.music-inline-play')).find((x) => x.getAttribute('data-track') === t); b.click(); }, CLOSER.title);
    const shown = await holdOpen(page);
    await sleep(800);
    const eng = await page.evaluate(() => ({ src: !!window.MCC_MUSIC.audio.currentSrc, current: !!window.MCC_MUSIC.current(), playing: window.MCC_MUSIC.playing() }));
    check(shown && !eng.src && !eng.current && !eng.playing, 'Q5 listen engine: its play button opens the pop-up and loads nothing', eng);
    check(audio.length === 0, 'Q5 listen engine: no read at all', { reads: audio.length });
    await ctx.close();
    /* the house owner plays it, as before */
    const p2 = makePlane();
    const { ctx: c2, audio: a2 } = await context(browser, p2, 390);
    const pg = await c2.newPage();
    await seed(pg, slots(p2.storedSession('owner', 3600)));
    await pg.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
    const earned = await until(pg, (sel) => { const r = document.querySelector(sel); return r && r.getAttribute('data-gate') === 'earned'; }, HELD, 15000);
    await pg.click(HELD);
    const played = await until(pg, () => /__master\.wav$/.test(document.getElementById('deck').currentSrc) && !document.getElementById('deck').paused, null, 15000);
    const popped = await pg.evaluate(() => { const d = document.getElementById('mccHold'); return !!(d && d.open); });
    check(earned && played && !popped, 'Q5 the house owner: his own play, no pop-up', { earned, played, popped, reads: a2.map((x) => x.path.replace(CLOSER_KEY, '<held>')) });
    await c2.close();
  },

  /* ---------------------------------------------------------------- Q6 */
  async q6_albums_stop_at_the_end(browser) {
    const plane = makePlane();
    const { ctx, audio } = await context(browser, plane, 390, { seconds: 2 });
    const page = await ctx.newPage();
    await seed(page, {});
    await page.goto(HOUSE + '/album.html?album=heal-the-3', { waitUntil: 'load' });
    await until(page, () => document.querySelectorAll('#tracks li').length === HEAL.tracks.length);
    await page.click(`#tracks li:nth-child(${HEAL.tracks.length})`);
    await until(page, () => !document.getElementById('deck').paused);
    const t0 = Date.now();
    await until(page, () => document.getElementById('deck').ended, null, 15000);
    await sleep(1500);
    const st = await page.evaluate(() => { const d = document.getElementById('deck'); return { paused: d.paused, at: d.currentTime, dur: d.duration, on: document.querySelector('#tracks li.on').getAttribute('data-title'), np: navigator.mediaSession.playbackState, play: document.getElementById('playAll').textContent.trim() }; });
    const later = audio.filter((x) => x.t > t0 && x.path === '/' + HEAL.tracks[0].src);
    check(st.paused && st.on === HEAL.tracks[HEAL.tracks.length - 1].title && Math.abs(st.at - st.dur) < 0.3 && later.length === 0, 'Q6 album: after its last song the album stops there, paused at the end, never back to the first song', { st, later });
    check(st.np === 'paused' && /Play/.test(st.play), 'Q6 album: Now Playing shows it paused', st);
    await shot(page, 'album-390-stopped-after-last-song');
    await page.click('#playAll');
    /* Play on a song at its end starts it again; Next is pressed while it is heard */
    await until(page, () => { const d = document.getElementById('deck'); return !d.paused && d.currentTime > 0.2; });
    await page.click('#tpNext');
    await sleep(600);
    const nx = await page.evaluate(() => { const d = document.getElementById('deck'); return { paused: d.paused, at: d.currentTime, dur: d.duration, on: document.querySelector('#tracks li.on').getAttribute('data-title') }; });
    check(nx.paused && nx.on === HEAL.tracks[HEAL.tracks.length - 1].title && Math.abs(nx.at - nx.dur) < 0.3, 'Q6 album: Next past the last song stops it at the end', nx);
    await ctx.close();

    const { ctx: c2, audio: a2 } = await context(browser, plane, 390, { seconds: 2 });
    const pg = await c2.newPage();
    await seed(pg, {});
    await pg.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
    await pg.fill('#q', 'heal the 3');
    const last = HEAL.tracks[HEAL.tracks.length - 1].title;
    await until(pg, (t) => Array.from(document.querySelectorAll('#all li button.music-inline-play')).some((b) => b.getAttribute('data-track') === t), last);
    await pg.evaluate((t) => Array.from(document.querySelectorAll('#all li button.music-inline-play')).find((b) => b.getAttribute('data-track') === t).click(), last);
    await until(pg, () => window.MCC_MUSIC && !window.MCC_MUSIC.audio.paused);
    const t1 = Date.now();
    await until(pg, () => window.MCC_MUSIC.audio.ended, null, 15000);
    await sleep(1500);
    const e = await pg.evaluate(() => ({ title: window.MCC_MUSIC.current().title, paused: window.MCC_MUSIC.audio.paused, playing: window.MCC_MUSIC.playing(), np: navigator.mediaSession.playbackState }));
    const reads = a2.filter((x) => x.t > t1);
    check(e.title === last && e.paused && !e.playing && reads.length === 0, 'Q6 listen engine: the album stops after its last song (no next album, no first song)', { e, reads });
    check(e.np === 'paused', 'Q6 listen engine: Now Playing shows it paused', e);
    await c2.close();
  },

  /* ---------------------------------------------------------------- the review's findings (QW-R1 .. QW-R8) */
  /* QW-R1: the album page's shelf of albums put every whole cover, and the M, PRIM3 and VAUNT marks, on a grey plate */
  async r1_nothing_behind_a_cover(browser) {
    for (const width of [390, 1280]) {
      const plane = makePlane();
      const { ctx } = await context(browser, plane, width);
      const page = await ctx.newPage();
      await seed(page, {});
      await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
      await until(page, (n) => { const i = document.querySelectorAll('#featRail .feat__bg'); return i.length === n && Array.from(i).every((x) => x.complete && x.naturalWidth > 0); }, CATALOG.length, 15000);
      /* the album's once-a-session premiere curtain (js/chamber.js) lifts on its own */
      await until(page, () => !document.getElementById('prem'), null, 10000);
      await groundOk(page, '#featRail .feat__bg', `QW-R1 album shelf at ${width}`, { max: CATALOG.length });
      const shelf = await page.evaluate(() => { const f = getComputedStyle(document.getElementById('featRail')); return { bg: f.backgroundColor, border: f.borderTopWidth, gap: f.columnGap }; });
      check(/rgba\(0, 0, 0, 0\)/.test(shelf.bg) && shelf.border === '0px' && shelf.gap === '12px', `QW-R1 album shelf at ${width}: no ground, no frame, the rail's own spacing`, shelf);
      if (width === 390) await fits(page, 'QW-R1 album at 390');
      await page.evaluate(() => { const w = document.getElementById('featWrap'); scrollTo({ top: Math.max(0, w.getBoundingClientRect().top + scrollY - 72), behavior: 'instant' }); document.getElementById('featRail').scrollLeft = 0; });
      await sleep(900);
      await shot(page, `album-${width}-shelf-whole-covers`);
      /* the other shelves, which were right, stay right */
      if (width === 390) {
        await page.goto(HOUSE + '/listen.html', { waitUntil: 'load' });
        await until(page, () => { const i = document.querySelectorAll('#shelf .feat__bg'); return i.length > 3 && Array.from(i).every((x) => x.complete && x.naturalWidth > 0); }, null, 15000);
        await groundOk(page, '#shelf .feat__bg', 'QW-R1 control: Listen shelf at 390', { max: CATALOG.length });
        await page.goto(HOUSE + '/catalogue.html', { waitUntil: 'load' });
        await until(page, () => { const i = document.querySelectorAll('#shelf .cov'); return i.length > 3 && Array.from(i).every((x) => x.complete && x.naturalWidth > 0); }, null, 15000);
        await groundOk(page, '#shelf .cov', 'QW-R1 control: catalogue shelf at 390', { max: CATALOG.length });
      }
      await ctx.close();
    }
  },

  /* QW-R2: the pocket (the mini player of every page that is not a music page) cropped a cover into a rounded tile, on
     black, under a dark gradient */
  async r2_pocket_whole_cover(browser) {
    const WHIP = CATALOG.find((a) => a.slug === 'whip-equipped');
    const coverSong = WHIP.tracks.find((t) => t.poster === WHIP.art && !t.music_video);
    const HERE = CATALOG.find((a) => a.slug === 'here');
    const filmSong = HERE.tracks.find((t) => t.music_video);
    const record = (a, t) => JSON.stringify({ src: t.src, title: t.title, album: a.slug, artist: 'McCluster', art: a.art, poster: t.poster || '',
      music_video: t.music_video || '', video: t.music_video || '', lyrics: '', t: 1, playing: false, at: Date.now() });
    const tile = () => {
      const t = document.querySelector('.pocket__tile'), f = document.querySelector('.pocket__film');
      const ct = getComputedStyle(t), cf = getComputedStyle(f), r = t.getBoundingClientRect();
      const shown = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };
      return { cover: t.classList.contains('pocket__tile--cover'), w: Math.round(r.width), h: Math.round(r.height), radius: ct.borderTopLeftRadius, bg: ct.backgroundColor,
        shadow: ct.boxShadow, fit: cf.objectFit, scrim: shown('.pocket__scrim'), lyr: shown('.pocket__lyr'), poster: (f.getAttribute('poster') || '').split('/').pop() };
    };
    for (const width of [320, 390, 1280]) {
      const plane = makePlane();
      const { ctx } = await context(browser, plane, width);
      const page = await ctx.newPage();
      await seed(page, { 'mcc-pocket': record(WHIP, coverSong) });
      await page.goto(HOUSE + '/catalogue.html', { waitUntil: 'load' });
      const mounted = await until(page, () => !!document.querySelector('.pocket.is-in .pocket__film'), null, 12000);
      await sleep(700);
      const s = mounted ? await page.evaluate(tile) : null;
      const side = width < 561 ? 50 : 56;
      check(!!s && s.cover && s.fit === 'contain' && s.radius === '0px' && /rgba\(0, 0, 0, 0\)/.test(s.bg) && s.shadow === 'none' && !s.scrim && !s.lyr && s.w === side && s.h === side,
        `QW-R2 pocket at ${width}: a song whose picture is its album's cover shows that cover whole, in a ${side} px square, nothing behind it or over it, no corner cut`, s);
      if (s) await groundOk(page, '.pocket__film', `QW-R2 pocket at ${width}`, { max: 1, settleMs: 200, ref: 'beside' });
      if (width < 600) await fits(page, `QW-R2 catalogue at ${width} with the pocket`);
      if (width === 390) await shot(page, 'pocket-390-whole-cover');
      await ctx.close();
    }
    /* a film keeps its tile */
    const plane = makePlane();
    const { ctx } = await context(browser, plane, 390);
    const page = await ctx.newPage();
    await seed(page, { 'mcc-pocket': record(HERE, filmSong) });
    await page.goto(HOUSE + '/catalogue.html', { waitUntil: 'load' });
    const mounted = await until(page, () => !!document.querySelector('.pocket.is-in .pocket__film'), null, 12000);
    await sleep(700);
    const f = mounted ? await page.evaluate(tile) : null;
    check(!!f && !f.cover && f.w === 64 && f.h === 50, 'QW-R2 pocket at 390: a song with a film keeps the film\'s tile', f);
    await ctx.close();
  },

  /* QW-R3: a pocket record of the closing song (its preview, banked before the hold) mounted on every other page and its
     Play read the preview to its end; a member's shared row carried it to other devices */
  async r3_pocket_never_carries_the_closing_song(browser) {
    const held = { src: CLOSER.src, title: CLOSER.title, album: CIA.slug, artist: 'McCluster', art: CIA.art, poster: CLOSER.poster || '',
      music_video: '', video: '', lyrics: '', t: 1, playing: false, at: Date.now() - 60000 };
    const readsOf = (audio) => audio.filter((x) => x.path === '/' + CLOSER.src || x.path.includes(CLOSER_KEY)).length;
    {
      const plane = makePlane();
      const { ctx, audio } = await context(browser, plane, 390);
      const page = await ctx.newPage();
      await seed(page, { 'mcc-pocket': JSON.stringify(held) });
      await page.goto(HOUSE + '/catalogue.html', { waitUntil: 'load' });
      await sleep(3500);
      const p = await page.evaluate(() => ({ mounted: !!document.querySelector('.pocket'), kept: localStorage.getItem('mcc-pocket') !== null }));
      check(!p.mounted, 'QW-R3 this device: a pocket record of the closing song mounts no player on another page', p);
      check(!p.kept, 'QW-R3 this device: and the record is not kept to come back', p);
      check(readsOf(audio) === 0, 'QW-R3 this device: nothing of it is read', { reads: readsOf(audio) });
      await ctx.close();
    }
    {
      const plane = makePlane();
      const { ctx, audio } = await context(browser, plane, 390);
      let asked = 0;
      await ctx.route(SB + '/rest/v1/listener_state**', (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        asked++;
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify([{ state: held, updated_at: new Date().toISOString() }]) });
      });
      const page = await ctx.newPage();
      await seed(page, slots(plane.storedSession('member', 3600)));
      /* a page outside music that reads the shared row (js/backend.js) and carries the pocket */
      await page.goto(HOUSE + '/press.html', { waitUntil: 'load' });
      await sleep(3500);
      const p = await page.evaluate(() => ({ mounted: !!document.querySelector('.pocket'), copied: localStorage.getItem('mcc-pocket') !== null }));
      check(asked > 0, 'QW-R3 another device: the member\'s shared row was asked', { asked });
      check(!p.mounted && !p.copied, 'QW-R3 another device: the shared row naming the closing song mounts nothing and is not copied here', p);
      check(readsOf(audio) === 0, 'QW-R3 another device: nothing of it is read', { reads: readsOf(audio) });
      await ctx.close();
    }
  },

  /* QW-R4 to QW-R7: the closing song's test card, the pop-up's own padding, a link or a stale seat to it, and the house
     owner's own play of it */
  async r4_to_r7_the_closing_song(browser) {
    const HELD = '#tracks li[data-gated-object]';
    const LAST = CIA.tracks.length - 1;
    const keyOf = (t) => (t.gated && t.gated.object ? String(t.gated.object).split('/')[0] : String(t.src || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').toLowerCase());
    const gateAnswered = (page) => until(page, (sel) => { const r = document.querySelector(sel); return r && r.getAttribute('data-gate') && r.getAttribute('data-gate') !== 'opening'; }, HELD, 15000);
    /* QW-R4: the song test's card for the closing song, by account; song_test_state answers as production does (two
       open songs and the gated one) */
    for (const [who, width] of [['member', 390], ['member', 320], ['owner', 390]]) {
      const plane = makePlane();
      const { ctx } = await context(browser, plane, width);
      await ctx.route(SB + '/rest/v1/rpc/song_test_state', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(CIA.tracks.map((t, i) => ({ track: keyOf(t), label: t.gated ? 'The earned track' : 'Song ' + (i + 1), question: 'Was this song racist? Why?', heard: false, gated: !!t.gated, answer: null, split: null }))) }));
      const page = await ctx.newPage();
      await seed(page, slots(plane.storedSession(who, 3600)));
      await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
      await gateAnswered(page);
      await until(page, () => document.querySelectorAll('.stq-card').length === 3, null, 15000);
      await sleep(600);
      const card = await page.evaluate((k) => { const c = document.querySelector('.stq-card[data-stq="' + k + '"]'); return c ? (c.querySelector('.stq-lock') || {}).textContent || '' : null; }, keyOf(CLOSER));
      const line = await page.evaluate(() => window.MCC_GATED.holdCopy(true).text);
      if (who === 'member') {
        check(card === line, `QW-R4 member at ${width}: the closing song's test card says what its pop-up says, never that an earned play opens it`, { card });
        await fits(page, `QW-R4 album at ${width} with the song test`);
        if (width === 390) {
          await page.evaluate(() => { const b = document.getElementById('albTest'); if (b) scrollTo({ top: Math.max(0, b.getBoundingClientRect().top + scrollY - 72), behavior: 'instant' }); });
          await sleep(900);
          await shot(page, 'album-390-song-test-held-card');
        }
      } else check(/spend your earned play/.test(card || ''), 'QW-R4 the house owner: his card keeps his own play', { card });
      await ctx.close();
    }
    /* QW-R5: a tap inside the pop-up, on its own padding, leaves it open; a tap on the backdrop closes it */
    {
      const plane = makePlane();
      const { ctx } = await context(browser, plane, 390, { dsf: 1 });
      const page = await ctx.newPage();
      await seed(page, {});
      await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
      await gateAnswered(page);
      await page.click(HELD);
      await holdOpen(page);
      const box = await page.evaluate(() => { const r = document.getElementById('mccHold').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, h: r.height }; });
      for (const [where, x, y] of [['top-left corner', box.l + 6, box.t + 6], ['bottom-right corner', box.r - 6, box.b - 6], ['beside the line', box.r - 8, box.t + box.h / 2]]) {
        await page.mouse.click(x, y);
        await sleep(300);
        const open = await page.evaluate(() => !!(document.getElementById('mccHold') || {}).open);
        check(open, `QW-R5 a tap 6 px inside the pop-up (${where}) leaves it open`, { box, x, y });
        if (!open) { await page.click(HELD); await holdOpen(page); }
      }
      await page.mouse.click(Math.max(2, box.l / 2), Math.max(2, box.t / 2));
      check(await until(page, () => !(document.getElementById('mccHold') || {}).open, null, 3000), 'QW-R5 a tap on the backdrop outside it closes it');
      await ctx.close();
    }
    /* QW-R6: a link to the closing song (the catalogue's registry, Listen's search rows), or this device's stale seat on
       it, seats nothing and says nothing on the wire; a tap on it still says why */
    for (const who of ['guest', 'member']) {
      for (const how of ['link', 'seat']) {
        const plane = makePlane();
        const { ctx, audio, events } = await context(browser, plane, 390);
        const page = await ctx.newPage();
        await seed(page, Object.assign(CONSENT(), who === 'guest' ? {} : slots(plane.storedSession(who, 3600)),
          how === 'seat' ? { mcc_here_radio: JSON.stringify({ album: CIA.slug, i: LAST, t: 1, paused: true }) } : {}));
        await page.goto(HOUSE + '/album.html?album=cia-mind-control' + (how === 'link' ? '&t=' + encodeURIComponent(CLOSER.title) : ''), { waitUntil: 'load' });
        await gateAnswered(page);
        await sleep(4000);
        const s = await page.evaluate(({ t, last }) => { const d = document.getElementById('deck'); const rows = Array.from(document.querySelectorAll('#tracks li'));
          return { titled: (document.getElementById('npTitle').textContent || '').trim() === t, on: rows.findIndex((r) => r.classList.contains('on')) === last, err: d.error ? d.error.code : 0 }; },
          { t: CLOSER.title, last: LAST });
        check(!s.titled && !s.on && !s.err, `QW-R6 ${who}, ${how === 'link' ? 'a link to it' : 'a stale seat on it'}: the closing song is not seated (no deck error, the deck bar not titled with it)`, s);
        const drops = events.filter((e) => e.name === 'music_interrupted' || e.name === 'music_error').map((e) => e.name);
        check(events.length > 0 && drops.length === 0, `QW-R6 ${who}, ${how === 'link' ? 'a link to it' : 'a stale seat on it'}: no music_interrupted or music_error on the wire for a song nobody asked to play`, { drops, watched: events.length });
        check(audio.filter((x) => x.path === '/' + CLOSER.src || x.path.includes(CLOSER_KEY)).length === 0, `QW-R6 ${who}, ${how}: nothing of it is read`);
        await page.click(HELD);
        check(await holdOpen(page), `QW-R6 ${who}, ${how}: a tap on it still says why`);
        await ctx.close();
      }
    }
    /* QW-R7: the house owner's own play banks nothing: no signed one-play URL on this device or in his shared row */
    {
      const plane = makePlane();
      const { ctx } = await context(browser, plane, 390);
      const sent = [];
      await ctx.route(SB + '/rest/v1/listener_state**', (route) => { if (route.request().method() === 'POST') sent.push(route.request().postData() || ''); return route.fallback(); });
      const page = await ctx.newPage();
      await seed(page, slots(plane.storedSession('owner', 3600)));
      await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
      await until(page, (sel) => { const r = document.querySelector(sel); return r && r.getAttribute('data-gate') === 'earned'; }, HELD, 15000);
      await page.click(HELD);
      const played = await until(page, () => /__master\.wav$/.test(document.getElementById('deck').currentSrc) && !document.getElementById('deck').paused && document.getElementById('deck').currentTime > 0.3, null, 15000);
      await page.click('#tpPlay');
      await sleep(1500);
      const kept = await page.evaluate(() => localStorage.getItem('mcc-pocket') || '');
      check(played, 'QW-R7 the house owner: his own play of the closing song plays the master', { played });
      check(!/__master/.test(kept), 'QW-R7 the house owner: the pocket keeps no signed one-play URL', { kept: kept ? 'a record' : 'nothing' });
      check(!sent.some((b) => /__master/.test(b)), 'QW-R7 the house owner: nothing of it is sent to his shared row', { posts: sent.length });
      await ctx.close();
    }
  },

  /* QW-R8: the heart on every album row said "Save to My Rotation", a list no music page shows since the quick wins */
  async r8_the_heart(browser) {
    const plane = makePlane();
    const { ctx } = await context(browser, plane, 390);
    const page = await ctx.newPage();
    await seed(page, {});
    await page.goto(HOUSE + '/album.html?album=here', { waitUntil: 'load' });
    await until(page, () => document.querySelectorAll('#tracks li [data-hrt]').length > 0, null, 15000);
    const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#tracks li')).map((li) => ({ title: li.getAttribute('data-title'), label: li.querySelector('[data-hrt]').getAttribute('aria-label') })));
    check(labels.length > 0 && labels.every((l) => l.label === 'Save ' + l.title), 'QW-R8 album: each heart says "Save" and the song, as Listen\'s does; none names a list the pages do not show', labels);
    /* and whether the song is saved, as Listen's heart does: pressed after a tap, not pressed after the next */
    const heart = () => page.evaluate(() => { const b = document.querySelector('#tracks li [data-hrt]'); return { pressed: b.getAttribute('aria-pressed'), on: b.classList.contains('on'), label: b.getAttribute('aria-label') }; });
    const before = await heart();
    await page.click('#tracks li [data-hrt]');
    const saved = await heart();
    await page.click('#tracks li [data-hrt]');
    const unsaved = await heart();
    check(before.pressed === 'false' && !before.on && saved.pressed === 'true' && saved.on && unsaved.pressed === 'false' && !unsaved.on && saved.label === before.label,
      'QW-R8 album: the heart says whether the song is saved (pressed after a tap, not after the next), its words unchanged', { before, saved, unsaved });
    await ctx.close();
  },

  /* VERIFICATION (2026-11-24): the house owner's own play of the closing song is his one play until it is spent: a
     pause and Play (the deck bar, its row, the lock screen) picks it up where it paused, with no second claim, and his
     song test card keeps his own line while it plays */
  async owner_keeps_his_play(browser) {
    const HELD = '#tracks li[data-gated-object]';
    const keyOf = (t) => (t.gated && t.gated.object ? String(t.gated.object).split('/')[0] : String(t.src || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').toLowerCase());
    const plane = makePlane();
    const { ctx } = await context(browser, plane, 390, { seconds: 30 });
    let claims = 0;
    await ctx.route('https://api.mccluster.org/v1/music/gates/**', (route) => { if (route.request().method() === 'POST' && /\/play$/.test(new URL(route.request().url()).pathname)) claims++; return route.fallback(); });
    await ctx.route(SB + '/rest/v1/rpc/song_test_state', (route) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(CIA.tracks.map((t, i) => ({ track: keyOf(t), label: 'Song ' + (i + 1), question: 'Was this song racist? Why?', heard: false, gated: !!t.gated, answer: null, split: null }))) }));
    const page = await ctx.newPage();
    await seed(page, slots(plane.storedSession('owner', 3600)));
    await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
    await until(page, (sel) => { const r = document.querySelector(sel); return r && r.getAttribute('data-gate') === 'earned'; }, HELD, 15000);
    await until(page, () => document.querySelectorAll('.stq-card').length === CIA.tracks.length, null, 15000);
    const card = () => page.evaluate((k) => { const c = document.querySelector('.stq-card[data-stq="' + k + '"] .stq-lock'); return c ? c.textContent : null; }, keyOf(CLOSER));
    const before = await card();
    await page.click(HELD);
    const playing = await until(page, () => { const d = document.getElementById('deck'); return /__master\.wav$/.test(d.currentSrc) && !d.paused && d.currentTime > 1.5; }, null, 15000);
    check(playing && claims === 1, 'owner: his own play of the closing song, one claim, the master', { playing, claims });
    check((await card()) === before && /earned play/.test(before || ''), 'owner: his song test card keeps his own line while his play is on', { same: (await card()) === before });
    for (const how of ['the deck bar\'s Play', 'its row', 'the lock screen\'s play']) {
      await page.click('#tpPlay');
      await until(page, () => document.getElementById('deck').paused, null, 5000);
      const at = await page.evaluate(() => document.getElementById('deck').currentTime);
      if (how === 'its row') await page.click(HELD);
      else if (how === 'the lock screen\'s play') await page.evaluate(() => window.MCC_NOW_PLAYING.command('play'));
      else await page.click('#tpPlay');
      await sleep(1200);
      const s = await page.evaluate(() => { const d = document.getElementById('deck'); return { paused: d.paused, t: d.currentTime, master: /__master\.wav$/.test(d.currentSrc), popup: !!(document.getElementById('mccHold') || {}).open }; });
      check(!s.paused && s.master && s.t >= at - 0.05 && claims === 1 && !s.popup, `owner: paused and played again by ${how}, it picks up where it paused with the same play (no second claim, never from 0:00)`, { at, s, claims });
    }
    await ctx.close();
  },

  /* ---------------------------------------------------------------- 320 px */
  async narrow(browser) {
    const plane = makePlane();
    const { ctx } = await context(browser, plane, 320);
    const page = await ctx.newPage();
    await seed(page, {});
    for (const path of ['/listen.html', '/album.html?album=cia-mind-control', '/album.html?album=here', '/music-creator.html?handle=mccluster', '/catalogue.html', '/embed.html?album=cia-mind-control']) {
      await page.goto(HOUSE + path, { waitUntil: 'load' });
      await sleep(2500);
      await fits(page, `320 ${path}`);
    }
    await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
    await until(page, () => { const r = document.querySelector('#tracks li[data-gated-object]'); return r && r.getAttribute('data-gate') && r.getAttribute('data-gate') !== 'opening'; }, null, 15000);
    await page.click('#tracks li[data-gated-object]');
    await holdOpen(page);
    await fits(page, '320 the pop-up');
    const btn = await page.evaluate(() => Array.from(document.querySelectorAll('#mccHold a, #mccHold button')).map((b) => { const r = b.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); }));
    check(btn.length >= 2 && btn.every((h) => h >= 44), '320 the pop-up\'s buttons are at least 44 px', btn);
    await ctx.close();
  }
};

/* the owner's screenshots at 1280 too, where the layout differs */
async function wide(browser) {
  if (!SHOTS) return;
  const plane = makePlane();
  const { ctx } = await context(browser, plane, 1280, { dsf: 2 });
  const page = await ctx.newPage();
  await seed(page, {});
  await page.goto(HOUSE + '/music-creator.html?handle=mccluster', { waitUntil: 'load' });
  await until(page, () => document.querySelectorAll('#apHouseShelf .ap-card').length > 0, null, 15000);
  await sleep(800); await shot(page, 'artist-1280-mccluster-one-profile');
  await page.goto(HOUSE + '/album.html?album=cia-mind-control', { waitUntil: 'load' });
  await until(page, () => document.getElementById('albArt').complete, null, 15000);
  /* the album's once-a-session premiere curtain (js/chamber.js) lifts on its own after about three seconds */
  await until(page, () => !document.getElementById('prem'), null, 10000);
  await sleep(800); await shot(page, 'album-1280-hero-whole-cover');
  await until(page, () => { const r = document.querySelector('#tracks li[data-gated-object]'); return r && r.getAttribute('data-gate') && r.getAttribute('data-gate') !== 'opening'; }, null, 15000);
  await page.click('#tracks li[data-gated-object]');
  await holdOpen(page);
  await shot(page, 'album-1280-closing-song-signed-out');
  await ctx.close();
}

await mkdir(OUT, { recursive: true });
if (SHOTS) await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const started = Date.now();
try {
  for (const [name, fn] of Object.entries(SCENARIOS)) {
    if (ONLY && !ONLY.test(name)) continue;
    const t = Date.now();
    try { await fn(browser); }
    catch (e) { check(false, `${name}: threw ${String(e && e.stack || e).slice(0, 400)}`); }
    console.log(`-- ${name} ${Math.round((Date.now() - t) / 1000)} s`);
  }
  if (SHOTS && !ONLY) await wide(browser);
} finally {
  await browser.close();
}
const seconds = Math.round((Date.now() - started) / 1000);
await writeFile(join(OUT, 'result.json'), JSON.stringify({ seconds, passed: checks.length - failures.length, failed: failures.length, checks }, null, 2) + '\n');
console.log(`\n${checks.length - failures.length} of ${checks.length} checks passed, ${seconds} s`);
if (failures.length) { console.error(`${failures.length} check(s) failed`); process.exit(1); }
console.log('music quick wins e2e: all checks passed');
