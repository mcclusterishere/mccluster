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
  const audio = [];
  /* registered after the plane, so these answer first; anything they do not take falls back to the plane */
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    let url; try { url = new URL(req.url()); } catch (e) { return route.fallback(); }
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
  return { ctx, audio };
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
