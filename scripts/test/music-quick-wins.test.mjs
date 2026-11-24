/* THE MUSIC QUICK WINS (docs/music/MUSIC-RELEASE-20261119.md, "Quick wins (2026-11-23)").

   Matthew, 2026-11-23, in his words:
     Q1 "McCluster has two profiles. One says the house, one says the artist. It needs to be one profile. McCluster
        is the artist."
     Q2 "the albums need to be just fucking albums, and the playlist... We don't have enough music to necessarily
        even have playlists right now. So just list albums and artists right now."
     Q3 "The full covers aren't shown, and I agree. We should fix that." "as long as everything's uniform"
     Q4 "The shit should know whether you have a creator's account or not already."
     Q5 the closing song of CIA Mind Control: "We keep the song up, but it won't play... it'll tell you why it won't
        play when you try to click play."
     Q6 "end of the album, and just leave" (an album stops after its last song)
     Q7 "For 6, I approved them" (music_interrupted and the would-not-load event)

   Each test here failed at the slice's base (5d8c533e) and passes after it, except where a test says it is a
   control. The browser half is scripts/e2e/music-quick-wins.e2e.mjs. The closing song is never named here: it is
   found as the last track of the album cia-mind-control. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const json = (path) => JSON.parse(read(path));
const settle = () => new Promise((resolve) => setImmediate(resolve));
/* values made in a vm realm, compared as plain data */
const plain = (v) => JSON.parse(JSON.stringify(v));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function slice(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `could not find ${from.slice(0, 60)} ... ${to.slice(0, 60)}`);
  return src.slice(a, b);
}

/* ------------------------------------------------------------------ the media and clock stand-ins (as in the races test) */
class Media extends EventTarget {
  constructor() {
    super();
    this.paused = true; this.currentTime = 0; this.duration = 180; this.readyState = 1;
    this.playCalls = 0; this.muted = false; this._src = ''; this.error = null; this.loads = [];
  }
  setAttribute() {}
  get src() { return this._src; }
  set src(value) { this._src = value; this.currentTime = 0; this.paused = true; this.error = null; this.loads.push(value); }
  load() {}
  play() { this.playCalls++; this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { const changed = !this.paused; this.paused = true; if (changed) this.dispatchEvent(new Event('pause')); }
  fire(type) { this.dispatchEvent(new Event(type)); }
  fail(code = 2) { this.error = { code }; this.dispatchEvent(new Event('error')); }
  /* the song plays to its end, as a browser ends it: paused, at its length, then "ended" */
  end() { this.currentTime = this.duration; this.paused = true; this.dispatchEvent(new Event('pause')); this.dispatchEvent(new Event('ended')); }
}
function clockOf() {
  let now = Date.parse('2026-11-23T19:00:00Z'), id = 0;
  const due = new Map();
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  return {
    Date: FakeDate, now: () => now,
    setTimeout: (fn, ms = 0) => { const k = ++id; due.set(k, { at: now + Math.max(0, Number(ms) || 0), fn }); return k; },
    clearTimeout: (k) => { due.delete(k); },
    async tick(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [k, t] of due) if (t.at <= end && (!next || t.at < next[1].at)) next = [k, t];
        if (!next) break;
        due.delete(next[0]); now = next[1].at; next[1].fn(); await settle();
      }
      now = end; await settle();
    }
  };
}
async function until(clock, cond, step = 100, max = 60000) {
  let waited = 0;
  while (!cond() && waited < max) { await clock.tick(step); waited += step; }
  return waited;
}

/* ------------------------------------------------------------------ the listen engine in Node, with two albums */
/* album "alpha": two songs and a held closer (its own gate, held for everyone but the house owner); album "beta": one song,
   first on the shelf, so a queue that ran on past a record's end would reach Alpha one after it */
const ALPHA = [
  { title: 'Alpha one', src: 'alpha-one.mp3', seconds: 180 },
  { title: 'Alpha two', src: 'alpha-two.mp3', seconds: 180 },
  { title: 'Alpha closer', src: 'alpha-closer-preview.mp3', gated: { bucket: 'private', object: 'alpha-closer/alpha-closer.mp3', preview_seconds: 4 }, hold: 'profile' }
];
const BETA = [{ title: 'Beta one', src: 'beta-one.mp3', seconds: 180 }];
function engine(options = {}) {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      const attrs = {};
      nodes.set(id, {
        id, style: {}, hidden: false, textContent: '', innerHTML: '', src: '',
        classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
        setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
        addEventListener() {}, parentNode: { appendChild() {} }
      });
    }
    return nodes.get(id);
  }
  const document = new EventTarget();
  Object.assign(document, { readyState: 'complete', body: node('body'),
    getElementById: (id) => id === 'musicNow' ? null : node(id), querySelectorAll: () => [], createElement: () => node('created') });
  const events = [], notices = [], np = { spec: null, updates: 0, cleared: 0 };
  let claims = 0;
  /* the gate as js/gated-audio.js answers it: a guest is a guest, a member is locked, the house owner has earned it as
     the house's own (operator) */
  const who = options.who || 'guest';
  const gate = {
    resolve: async () => who === 'owner' ? { state: 'earned', operator: true } : who === 'member' ? { state: 'locked', gate: { reason: 'gate_not_ready' } } : { state: 'preview', reason: 'account' },
    claim: async () => { claims++; return { state: 'full', url: 'held-master.mp3', expires_in: 600 }; },
    forget() {}, onChange() {}, signedIn: () => who !== 'guest',
    /* what the slice adds: whether a held song plays for whoever is listening, and the one pop-up saying why not */
    holdDecision: async () => ({ play: who === 'owner', signedIn: who !== 'guest' }),
    holdNotice: (o) => { notices.push(o); }
  };
  const window = new EventTarget();
  const clock = options.clock;
  Object.assign(window, {
    document, Audio: Media, Event, console,
    CustomEvent: class extends Event { constructor(type, o) { super(type); this.detail = o?.detail; } },
    fetch: async () => ({ ok: true, json: async () => ({ albums: [{ slug: 'beta', name: 'Beta', artist: 'Beta artist', tracks: BETA }, { slug: 'alpha', name: 'Alpha', tracks: ALPHA }] }) }),
    MCC_GATED: gate,
    MCC_TRACK: (name, props) => events.push({ name, ...props }),
    MCC_NOW_PLAYING: { claim() {}, airplay() {}, bind: (media, spec) => { np.spec = spec; return { update() { np.updates++; }, clear() { np.cleared++; }, owns: () => true, media }; } },
    setTimeout: clock ? clock.setTimeout : setTimeout, clearTimeout: clock ? clock.clearTimeout : clearTimeout
  });
  if (clock) window.Date = clock.Date;
  if (who !== 'guest') window.MCC = { session: () => ({ access_token: 'fixture-token' }) };
  if (options.listens) window.MCC_LISTENS = options.listens;
  window.window = window;
  vm.runInContext(read('js/music-engine.js'), vm.createContext(window), { filename: 'js/music-engine.js' });
  return { music: window.MCC_MUSIC, events, notices, np, claims: () => claims, text: (id) => node(id).textContent, win: window };
}
function ledgerOf() {
  const L = { starts: [], finishes: [], releases: [] };
  Object.assign(L, { keyOf: (t) => String(t && t.src || ''), start: (k) => { L.starts.push(k); return { k }; }, adopt: () => null,
    finish: (h) => { L.finishes.push(h && h.k); return Promise.resolve({ counted: true }); }, release: (h) => { L.releases.push(h && h.k); }, onFinish() {} });
  return L;
}

/* ================================================================== Q1: one McCluster, the artist */

/* the Artists rail of the listen page (js/music-community.js) in Node, with the public directory answering */
function communityRail(profiles) {
  const els = new Map();
  const el = (id) => els.get(id) || null;
  const ls = { insertBefore(n) { els.set(n.id, n); }, appendChild(n) { els.set(n.id, n); }, querySelector: () => null };
  const document = {
    body: { classList: { contains: (c) => c === 'music-room--listen' } },
    querySelector: (s) => s === '.ls' ? ls : null,
    getElementById: (id) => {
      if (id === 'artistsRow' && els.has('artistsWrap')) { if (!els.has('artistsRow')) els.set('artistsRow', { id: 'artistsRow', innerHTML: '' }); return els.get('artistsRow'); }
      return el(id);
    },
    createElement: (t) => {
      if (t === 'i') { let s = ''; return { set textContent(v) { s = String(v); }, get innerHTML() { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }; }
      const n = { tagName: t, id: '', className: '', innerHTML: '', setAttribute() {} };
      return n;
    }
  };
  const answered = deferred();
  const window = {
    document, console, Promise,
    fetch: (url) => {
      const u = String(url);
      const body = /music_creator_profiles/.test(u) ? profiles : [];
      if (/music_creator_profiles/.test(u)) setImmediate(() => answered.resolve());
      return Promise.resolve({ ok: true, json: async () => body });
    }
  };
  window.window = window;
  vm.runInContext(read('js/music-community.js'), vm.createContext(window), { filename: 'js/music-community.js' });
  return { rail: () => (els.get('artistsRow') || {}).innerHTML || '', wrap: () => els.get('artistsWrap'), answered: answered.promise };
}
const MCC_PROFILE = { m_uid: 'm-house', handle: 'mccluster', artist_name: 'McCluster', avatar_url: '', verification_state: 'unverified' };
const OTHER = { m_uid: 'm-other', handle: 'fixture-artist', artist_name: 'Fixture Artist', avatar_url: '', verification_state: 'unverified' };
const cards = (html) => html.split('<a ').slice(1).map((a) => ({ href: (a.match(/href="([^"]*)"/) || [])[1], text: a.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }));

test('Q1 the Artists rail shows McCluster once, as the artist, first; no house card, and his directory row is not a second one', async () => {
  const r = communityRail([OTHER, MCC_PROFILE]);
  const before = cards(r.rail());
  assert.ok(before.length >= 1, 'McCluster is painted before the directory answers');
  assert.equal(before[0].href, 'music-creator.html?handle=mccluster', 'before the answer: McCluster opens his artist page');
  await r.answered; await settle(); await settle();
  const after = cards(r.rail());
  assert.equal(after[0].href, 'music-creator.html?handle=mccluster', 'McCluster is first, and opens his artist page: ' + JSON.stringify(after));
  assert.match(after[0].text, /McCluster/);
  assert.match(after[0].text, /\bArtist\b/, 'his card says what he is: an artist');
  assert.equal(after.filter((c) => /handle=mccluster\b/.test(c.href)).length, 1, 'one McCluster, not two: ' + JSON.stringify(after));
  assert.equal(after.filter((c) => /McCluster/.test(c.text)).length, 1, 'one card names McCluster');
  assert.ok(!after.some((c) => c.href === 'index.html'), 'no card opens the house as if it were an artist');
  assert.doesNotMatch(r.rail() + (r.wrap() ? r.wrap().innerHTML : ''), /the house/i, 'nothing on the rail calls McCluster "the house"');
  assert.ok(after.some((c) => c.href === 'music-creator.html?handle=fixture-artist'), 'every other creator follows');
});

test('Q1 credits name McCluster the artist, on every player that falls back to the house artist, and open his one page', () => {
  const album = read('album.html');
  assert.match(album, /var HOUSE = "McCluster";/, 'the album credits the house\'s records to McCluster');
  assert.match(album, /var HOUSE_PAGE = "music-creator\.html\?handle=mccluster";/, 'and his name opens his artist page');
  assert.match(album, /var artistHref = ARTIST === HOUSE \? HOUSE_PAGE/, 'the byline links the artist, not the person page');
  for (const [file, src] of [['js/music-engine.js', read('js/music-engine.js')], ['js/world-audio-continuity.js', read('js/world-audio-continuity.js')],
    ['js/pip.js', read('js/pip.js')], ['embed.html', read('embed.html')], ['album.html', album], ['js/label.js', read('js/label.js')],
    ['music-videos.html', read('music-videos.html')]]) {
    assert.doesNotMatch(src, /\|\|\s*"Matthew McCluster"/, `${file}: the default artist is McCluster, the artist`);
    assert.doesNotMatch(src, /artist\s*:\s*"Matthew McCluster"/, `${file}: no song is credited to the person by default`);
  }
  assert.match(read('embed.html'), /<span id="by">McCluster<\/span>/);
});

test('Q1 McCluster\'s own artist page keeps the house in the bar and carries his records from the catalogue', () => {
  const page = read('js/music-creator-profile.js');
  assert.match(page, /var HOUSE_ARTIST = "mccluster";/, 'the page knows which handle is the house\'s own artist');
  assert.match(page, /mcc:perspective-house/, 'on his own page the bar stays the house: no second McCluster in the middle cell');
  /* his page opens as a view over Listen (music slice M5): the bar is the retained document's, so the view's word for the
     house is passed up to it, as the word for any other artist is (found by the door suite) */
  assert.match(read('js/music-shell.js'), /win\.addEventListener\("mcc:perspective-house",\s*function\s*\(\)\s*\{\s*emit\("mcc:perspective-house"\)/,
    'a view of his page tells the bar it is the house');
  assert.match(page, /fetch\("data\/albums\.json"/, 'his albums come from the catalogue the album pages play');
  assert.match(page, /album\.html\?album=/, 'each opens on the album page');
});

/* ================================================================== Q2: albums and artists only */

test('Q2 the album page lists albums only: no playlists, no "Curated by the house", no filter for playlists', () => {
  const album = read('album.html');
  assert.doesNotMatch(album, /data-chip="playlists"/, 'no filter for playlists');
  assert.doesNotMatch(album, /Curated by the house/, 'no house shelf heading');
  assert.doesNotMatch(album, /id="plWrap"|The playlists|class="pll__art"/, 'no playlists section');
  assert.doesNotMatch(album, /fetch\("data\/playlists\.json"/, 'the page reads no playlists');
  assert.match(album, /<p class="lib__k" id="featK">Albums<\/p>/, 'the shelf says what it is: Albums');
  assert.doesNotMatch(album, /id="albTag" data-daypart/, 'the album kicker says what the record is, not the time of day');
});

test('Q2 an old playlist link lands somewhere sensible, never a dead end', () => {
  const album = read('album.html');
  const fn = album.match(/function playlistDoor\(slug\) \{[\s\S]*?\n    \}/);
  assert.ok(fn, 'album.html has one place that says where an old playlist link goes');
  const door = vm.runInNewContext('(' + fn[0].replace(/^function playlistDoor/, 'function') + ')');
  assert.equal(door('music-videos'), 'music-videos.html', 'the music videos playlist was the music videos');
  assert.equal(door('the-films'), 'music-videos.html', 'its old name too');
  for (const s of ['everything', 'my-rotation', 'the-civic-set', 'the-agency-tape', 'no-such-list']) assert.equal(door(s), 'listen.html', s + ': the albums and artists');
  assert.match(album, /if \(PL\) \{ location\.replace\(playlistDoor\(PL\)\); return; \}/, 'the page goes there before it paints anything');
});

test('Q2 the listen page shows Artists and Albums; the song rails rest until there is more music, and a search still finds songs', () => {
  const html = read('listen.html'), js = read('js/listen.js');
  assert.doesNotMatch(html, /<div class="chips" id="chips"/, 'no filter row: there are two things to list');
  assert.match(js, /var SONG_RAILS = false;/, 'one switch rests the song rails (owner, 2026-11-23: "just list albums and artists right now")');
  assert.match(js, /el\("allWrap"\)\.hidden = !searching;/, 'the song list is a search result, not a shelf');
  assert.match(html, /<p class="lib__k">Albums<\/p>/);
  assert.match(read('js/music-community.js'), /'<p class="lib__k">Artists<\/p>'/);
  assert.doesNotMatch(html, /the songs people are actually reaching for/, 'the page does not promise rails it does not show');
});

test('Q2 labels say plainly what each thing is: an album is an album, with its artist', () => {
  const album = read('album.html'), js = read('js/listen.js');
  assert.match(album, /function albumKicker\(n\) \{ return "Album · " \+ n \+ \(n === 1 \? " song" : " songs"\); \}/);
  assert.match(js, /"<small>" \+ esc\(a\.artist \|\| "McCluster"\) \+ "<\/small>"/, 'an album card names its artist');
});

/* ================================================================== Q3: whole covers, uniform squares */

const COVERS = ['.feat__bg', '.alb__art', '.deckbar__art', '.tr .th', '.music-mini__art', '.music-now__art', '.now__art--cover .now__film',
  '.ap-album__art', '.ap-card img', '.ap-track img', '.shelf .cov', '.creator-track img'];
test('Q3 one rule for every music cover: the whole artwork, scaled inside its square, nothing behind it, no corner cut', () => {
  const css = read('css/music-system-v2.css');
  const block = slice(css, '/* WHOLE COVERS', '/* WHOLE COVERS END */');
  for (const sel of COVERS) assert.ok(block.includes('.music-v2 ' + sel), `${sel} is in the one cover rule`);
  for (const decl of [/object-fit:\s*contain\s*!important/, /object-position:\s*center\s*!important/, /background-color:\s*transparent\s*!important/,
    /border-radius:\s*0\s*!important/, /box-shadow:\s*none\s*!important/, /background-size:\s*contain\s*!important/, /background-repeat:\s*no-repeat\s*!important/])
    assert.match(block, decl);
  assert.match(block, /\.music-v2 \.music-now__ambient\{display:none!important\}/, 'no blurred copy of the cover behind the Now Playing sheet');
  assert.match(read('embed.html'), /\.art \{[^}]*object-fit: contain;[^}]*\}/, 'the embedded player too');
  assert.doesNotMatch(read('embed.html'), /\.art \{[^}]*border-radius/);
});

test('Q3 the album hero shows the still, whole cover: the living sleeve (cropped and drawn over) is not mounted', () => {
  assert.doesNotMatch(read('album.html'), /MCC_ENV\.mount\(/);
});

test('Q3 control: the lock screen\'s artwork registry hands each cover whole, at its own size (true at the base too)', async () => {
  const { registry, check } = await import('../../scripts/music-artwork.mjs');
  const r = registry();
  assert.deepEqual(r.problems, []);
  for (const e of r.entries) {
    const { imageInfo } = await import('../../scripts/music-artwork.mjs');
    const info = imageInfo(readFileSync(new URL('../../' + e.path, import.meta.url)));
    assert.equal(e.sizes, `${info.w}x${info.h}`, `${e.path}: declared at its own size, never squared`);
  }
  assert.equal(check().ok, true, 'the registry in js/now-playing.js is current');
  assert.doesNotMatch(read('js/now-playing.js'), /getContext\(|drawImage|toDataURL|OffscreenCanvas/, 'nothing draws, crops or pads a cover for the lock screen');
});

/* ================================================================== Q4: creators are never asked to join */

test('Q4 the desk tells a creator from a member only by the server\'s answer; anything else is not known, and never a join offer', () => {
  const core = read('js/member-desk-core.js');
  const sandbox = {};
  vm.runInNewContext(core, sandbox);
  const C = sandbox.MCC_DESK_CORE;   // the module's browser branch puts it on the global it runs in
  assert.ok(C, 'the desk rules load');
  assert.equal(typeof C.creatorFrom, 'function', 'one rule reads the answer');
  assert.equal(C.creatorFrom({ ok: true, creator: true }), true);
  assert.equal(C.creatorFrom({ ok: true, creator: false }), false, 'a member the server says is not a creator');
  for (const unknown of [null, undefined, {}, { ok: false, error: 'not_signed_in' }, { error: 'boom' }, 'text'])
    assert.equal(C.creatorFrom(unknown), null, 'not known: ' + JSON.stringify(unknown));
  const desk = read('js/member-desk.js');
  assert.match(desk, /S\.caps && S\.caps\.creator === false \?/, 'the join door is for a known member only');
  assert.doesNotMatch(desk, /S\.caps && !S\.caps\.creator \?/, 'never for an answer that did not come');
});

test('Q4 the listen page\'s pitch follows the account: the join words for a guest or a member, Creator Studio for a creator', () => {
  const html = read('listen.html');
  const box = slice(html, '<section class="music-launch"', '</section>');
  assert.match(box, /<section class="music-launch" aria-label="Creator Studio" data-creator-offer data-offer-pending>/, 'the whole box is the offer');
  assert.match(box, /<div class="music-launch__pitch" data-offer="signin become" hidden>/, 'the join pitch is for those who can join');
  assert.match(box, /<div class="music-launch__pitch" data-offer="studio">/, 'a creator sees their studio, never the pitch');
  const onboard = read('js/creator-onboarding.js');
  assert.match(onboard, /var ks = String\(el\.getAttribute\("data-offer"\) \|\| ""\)\.split\(\/\\s\+\/\);/, 'an offer can stand for more than one answer');
});

/* ================================================================== Q5: the closing song is held */

const closing = () => { const a = json('data/albums.json').albums.find((x) => x.slug === 'cia-mind-control'); return a.tracks[a.tracks.length - 1]; };
test('Q5 the closing song is held, and only it: it stays listed', () => {
  const albums = json('data/albums.json').albums;
  const held = albums.flatMap((a) => a.tracks.filter((t) => t.hold).map((t) => ({ a: a.slug, t })));
  assert.equal(held.length, 1, 'one held song');
  assert.equal(held[0].a, 'cia-mind-control');
  assert.equal(closing().hold, 'profile', 'the closing song waits for a full profile and a short questionnaire');
  assert.ok(closing().gated && closing().gated.object, 'its gate (the house owner\'s own play) is untouched');
});

function gatedModule(opts = {}) {
  const calls = [];
  const window = {
    console, Promise, location: { pathname: '/album.html', search: '?album=cia-mind-control', origin: 'https://matthew.mccluster.org' },
    MCC: opts.signedIn ? { session: () => ({ access_token: 'fixture' }), authFetch: (u, i) => { calls.push(u); return Promise.resolve({ status: 200, json: async () => opts.gate }); } } : { session: () => null },
    fetch: (u) => { calls.push(String(u)); return Promise.resolve({ status: 200, json: async () => opts.gate }); },
    addEventListener() {}, dispatchEvent() {}, CustomEvent: class { constructor(t) { this.type = t; } },
    document: { readyState: 'complete', addEventListener() {}, body: null }
  };
  window.window = window;
  vm.runInContext(read('js/gated-audio.js'), vm.createContext(window), { filename: 'js/gated-audio.js' });
  return { G: window.MCC_GATED, calls };
}
test('Q5 the pop-up says why, in plain words, by account state', () => {
  const { G } = gatedModule();
  assert.equal(typeof G.holdCopy, 'function');
  const out = G.holdCopy(false, '/album.html?album=cia-mind-control');
  assert.match(out.text, /sign in/i); assert.match(out.text, /full profile/i); assert.match(out.text, /short questionnaire/i);
  assert.equal(out.action.label, 'Sign in');
  assert.equal(out.action.href, 'account.html?next=' + encodeURIComponent('/album.html?album=cia-mind-control'));
  const member = G.holdCopy(true, '/album.html?album=cia-mind-control');
  assert.match(member.text, /complete your full profile/i);
  assert.match(member.text, /questionnaire opens soon/i, 'the questionnaire does not exist yet, and it says so');
  assert.equal(member.action.href, 'mnet.html?view=profile', 'a button to the profile');
  for (const c of [out, member]) assert.ok(c.title && c.title.length < 60, 'a short title');
});

test('Q5 only the house owner\'s own play opens it: a guest is not asked over the network, a member is told no', async () => {
  const guest = gatedModule();
  assert.deepEqual(plain(await guest.G.holdDecision({ bucket: 'b', object: 'k/k.mp3' })), { play: false, signedIn: false });
  assert.equal(guest.calls.length, 0, 'a guest is told why without a request');
  const member = gatedModule({ signedIn: true, gate: { ok: true, gate: { allowed: false, reason: 'gate_not_ready', missing: ['gate_not_ready'] } } });
  assert.deepEqual(plain(await member.G.holdDecision({ bucket: 'b', object: 'm/m.mp3' })), { play: false, signedIn: true });
  const earnedByRule = gatedModule({ signedIn: true, gate: { ok: true, gate: { allowed: true, operator: false } } });
  assert.deepEqual(plain(await earnedByRule.G.holdDecision({ bucket: 'b', object: 'r/r.mp3' })), { play: false, signedIn: true }, 'a rule that would open it does not, until the full gate exists');
  const owner = gatedModule({ signedIn: true, gate: { ok: true, gate: { allowed: true, operator: true } } });
  assert.deepEqual(plain(await owner.G.holdDecision({ bucket: 'b', object: 'o/o.mp3' })), { play: true, signedIn: true });
});

test('Q5 listen engine: tapping the held song asks for nothing it would play: no stream, no listen, no lock screen, one pop-up', async () => {
  const L = ledgerOf();
  const e = engine({ who: 'guest', listens: L });
  await e.music.play('alpha', 'Alpha one');
  const loads = e.music.audio.loads.length, updates = e.np.updates;
  const out = await e.music.play('alpha', 'Alpha closer');
  assert.equal(out && out.state, 'held');
  assert.equal(e.music.audio.loads.length, loads, 'no stream request: not even the preview');
  assert.equal(e.music.current().title, 'Alpha one', 'what was playing stays');
  assert.equal(e.np.updates, updates, 'nothing new on the lock screen');
  assert.deepEqual(e.notices.map((n) => n.signedIn), [false], 'one pop-up, signed out');
  assert.ok(!e.events.some((x) => /^music_(play|preview_play|full_play)$/.test(x.name) && x.source === 'discovery' && e.events.indexOf(x) > 1), 'no play is counted for it');
  assert.ok(L.starts.every((k) => !/closer/.test(k)), 'no listen started for it');
  const m = engine({ who: 'member' });
  await m.music.play('alpha', 'Alpha closer');
  assert.deepEqual(m.notices.map((n) => n.signedIn), [true], 'a member is told to finish the profile');
  assert.equal(m.music.audio.loads.length, 0);
});

test('Q5 listen engine: the queue reaching the held last song opens the pop-up and the album stops there', async () => {
  const e = engine({ who: 'member' });
  await e.music.play('alpha', 'Alpha two');
  e.music.audio.end();
  await settle(); await settle(); await settle();
  assert.equal(e.notices.length, 1, 'the pop-up says why');
  assert.equal(e.music.current().title, 'Alpha two', 'the album stopped on its last song that plays');
  assert.equal(e.music.audio.paused, true);
  assert.ok(!e.music.audio.loads.some((s) => /closer|beta-one|alpha-one/.test(s)), 'no preview, no next album, no first song again: ' + e.music.audio.loads.join(', '));
  assert.equal(e.music.playing(), false, 'the lock screen is told it stopped');
});

test('Q5 listen engine: the house owner\'s own play is as it was (the gate, one claim, the master)', async () => {
  const e = engine({ who: 'owner' });
  await e.music.play('alpha', 'Alpha closer');
  await settle();
  assert.equal(e.notices.length, 0);
  assert.equal(e.claims(), 1);
  assert.equal(e.music.audio.src, 'held-master.mp3');
});

/* the album page's player, sliced out of album.html as the races test does it, with a held last row */
function album(options = {}) {
  const source = read('album.html');
  const begin = source.indexOf('    function load(i, at) {');
  const end = source.indexOf('    /* The one play is over', begin);
  const ended = source.indexOf('    deck.addEventListener("ended", function () {');
  const bank = source.indexOf('    /* ============================================================\n       BANKING', ended);
  assert.ok(begin > 0 && end > begin && ended > end && bank > ended);
  const attrs = (entries) => ({ values: { ...entries }, getAttribute(k) { return this.values[k] ?? null; }, hasAttribute(k) { return k in this.values; },
    setAttribute(k, v) { this.values[k] = v; }, removeAttribute(k) { delete this.values[k]; }, querySelector() { return null; } });
  const rows = [
    attrs({ 'data-title': 'Song A', 'data-src': 'a.mp3', 'data-key': 'a', 'data-seconds': '180' }),
    attrs({ 'data-title': 'Song B', 'data-src': 'b.mp3', 'data-key': 'b', 'data-seconds': '180' }),
    attrs({ 'data-title': 'Held closer', 'data-src': '', 'data-key': 'held', 'data-gated-bucket': 'private', 'data-gated-object': 'held/held.mp3', 'data-hold': 'profile', 'data-gate': options.gate || 'preview' })
  ];
  if (options.owner) rows[2]._gateOut = { state: 'earned', operator: true };
  const deck = new Media(); deck.src = 'a.mp3';
  const notices = [], loads = [], claims = [];
  const elNode = (id) => ({ id, textContent: '', innerHTML: '', hidden: true, style: {}, dataset: {}, setAttribute() {}, getAttribute() { return null; }, addEventListener() {} });
  const context = {
    rows, deck, Promise, console, ALBUM: 'fixture', ARTIST: 'McCluster', LIC_SLUG: {},
    document: { documentElement: { style: { setProperty() {} } }, querySelector: () => attrs({}), getElementById: () => attrs({}) },
    window: {
      MCC_GATED: { signedIn: () => !!options.signedIn, claim: () => { claims.push(1); return Promise.resolve({ state: 'full', url: 'held-master.mp3', expires_in: 600 }); }, forget() {},
        holdDecision: () => Promise.resolve({ play: !!options.owner, signedIn: !!options.signedIn }), holdNotice: (o) => notices.push(o) },
      MCC_LISTENS: { finish: () => Promise.resolve({ counted: true }), release() {} }, MCC_TOAST() {},
      MCC_TRACK: (name, props) => { if (options.events) options.events.push({ name, ...props }); }
    },
    audioSession() {}, spend() {}, media() {}, paintRows() {}, paintDeck() {}, announce() {}, paintSheet() {},
    loadReel() {}, setRoom() {}, loadLyrics() {}, priming: false, countStart() {}, save() {}, roomPlay() {},
    el: elNode, bar: elNode('deckbar'), granted: () => false, gateSpec: (row) => ({ bucket: row.getAttribute('data-gated-bucket'), object: row.getAttribute('data-gated-object') }),
    /* the page's paintGate keeps the gate's last answer on the row (row._gateOut); a test that needs that answer asks for it */
    paintGate: options.keepGateOut ? (row, out) => { row._gateOut = out; } : () => {}, setTimeout, clearTimeout, Date,
    fmt: (x) => String(x), ICO_PLAY: '', ICO_PAUSE: ''
  };
  const script = 'var cur = 0, listen = null, grantMax = 0, songTest = null, wantSound = true;\n' +
    'function deckIntends() { return wantSound; }\n' +
    source.slice(begin, end) + '\n' + source.slice(ended, bank) + '\n' +
    source.match(/function next\(\) \{[^\n]+/)[0] + '\n' + source.match(/function prev\(\) \{[^\n]+/)[0] + '\n' +
    'function deckAt() { return deck.currentTime || 0; } function userSeek(t) { deck.currentTime = t; return true; }\n' +
    'this.player = { play: play, next: next, prev: prev, load: load, current: function () { return cur; }, wants: function () { return wantSound; } };';
  vm.runInContext(script, vm.createContext(context), { filename: 'album.html playback' });
  return { ...context.player, deck, rows, notices, claims, loads };
}

test('Q5 album: tapping the held row loads nothing (no preview, no stream) and opens one pop-up; what plays keeps playing', async () => {
  const a = album({ signedIn: false });
  a.play(0); await settle();
  const before = a.deck.loads.length;
  a.play(2); await settle(); await settle();
  assert.equal(a.deck.loads.length, before, 'nothing loaded for the held song');
  assert.equal(a.current(), 0, 'the song that plays keeps playing');
  assert.equal(a.deck.paused, false);
  assert.deepEqual(a.notices.map((n) => n.signedIn), [false]);
});

test('Q5 album: Next into the held last song, or the album reaching it, opens the pop-up and the album stops', async () => {
  const a = album({ signedIn: true });
  a.play(1); await settle();
  a.next(); await settle(); await settle();
  assert.deepEqual(a.notices.map((n) => n.signedIn), [true], 'Next into it: the pop-up');
  assert.equal(a.current(), 1);
  assert.equal(a.deck.paused, true, 'the album stopped');
  assert.ok(!a.deck.loads.includes(''), 'the held row was never loaded');
  const b = album({ signedIn: true });
  b.play(1); await settle();
  b.deck.end(); await settle(); await settle(); await settle();
  assert.equal(b.notices.length, 1, 'the album reaching it: the pop-up');
  assert.equal(b.current(), 1, 'stopped on the last song that plays, never back to the first');
  assert.ok(!b.deck.loads.slice(2).includes('a.mp3'), 'no wrap to the first song: ' + b.deck.loads.join(', '));
  assert.equal(b.wants(), false, 'nobody is told music is wanted');
});

test('Q5 album: the house owner\'s own play of it is unchanged (one claim, the master)', async () => {
  const a = album({ signedIn: true, owner: true, gate: 'earned' });
  a.play(2); await settle(); await settle();
  assert.equal(a.notices.length, 0);
  assert.equal(a.claims.length, 1);
  assert.equal(a.deck.src, 'held-master.mp3');
});

test('Q5 album: the held row is written with no preview to fetch, and nothing reads one for it', () => {
  const album = read('album.html');
  assert.match(album, /\(t\.hold \? ' data-hold="' \+ escAttr\(t\.hold\) \+ '"' : ""\)/, 'the row says it is held');
  assert.match(album, /var src = t\.hold \? "" : t\.src;/, 'a held row carries no preview address at all');
  assert.match(album, /if \(row\.hasAttribute\("data-hold"\)\) return;\s*\/\* a held song's length is nobody's to fetch/, 'no duration probe reads the preview');
  const label = read('js/label.js');
  assert.match(label, /if \(li\.hasAttribute\("data-hold"\)\) return;/, 'keeping the album offline leaves the held song out');
});

test('Q5 album: the held row is never offered for sale (the direct checkout skips it)', () => {
  /* its one direct offer is inactive in production (read 2026-11-23); the row itself never carries a buy button either */
  const direct = read('js/music-direct.js');
  const sel = direct.match(/querySelectorAll\("(\[data-albslug\]\[data-title\][^"]*)"\)/);
  assert.ok(sel, 'the direct checkout picks its rows with one selector');
  assert.match(sel[1], /:not\(\[data-hold\]\)/, 'a held row is not one of them');
});

test('Q5 the pocket and the embedded player never play a held or gated song', () => {
  const pip = read('js/pip.js');
  assert.match(pip, /if \(!next \|\| next\.gated \|\| next\.hold\)/, 'the pocket stops before it');
  const embed = read('embed.html');
  assert.match(embed, /if \(t\.hold \|\| t\.gated\) \{/, 'the embed holds it');
});

/* ================================================================== Q6: albums stop after their last song */

test('Q6 listen engine: the last song of an album ends and the album stops there (no next album, no first song again)', async () => {
  const e = engine({ who: 'guest' });
  await e.music.play('beta', 'Beta one');
  e.music.audio.end(); await settle(); await settle();
  assert.equal(e.music.current().title, 'Beta one');
  assert.equal(e.music.audio.paused, true);
  assert.equal(e.music.audio.loads.filter((s) => s !== 'beta-one.mp3').length, 0, 'nothing else was loaded: ' + e.music.audio.loads.join(', '));
  assert.equal(e.music.playing(), false);
  assert.equal(e.music.audio.currentTime, e.music.audio.duration, 'paused at the end');
});

test('Q6 listen engine: Next past the last song stops the album at the end; Previous at the first song starts it again', async () => {
  const e = engine({ who: 'guest' });
  await e.music.play('beta', 'Beta one');
  e.music.audio.currentTime = 30;
  await e.music.next(); await settle();
  assert.equal(e.music.current().title, 'Beta one');
  assert.equal(e.music.audio.paused, true, 'skipped past: the album stops');
  assert.ok(e.music.audio.duration - e.music.audio.currentTime <= 0.1, 'Now Playing shows it paused at the end (a hair before it: a seek to the very end lands on 0:00 in Chromium)');
  const f = engine({ who: 'guest' });
  await f.music.play('alpha', 'Alpha one');
  f.music.audio.currentTime = 2;
  await f.music.previous(); await settle();
  assert.equal(f.music.current().title, 'Alpha one', 'no wrap to the end of the catalogue');
  assert.equal(f.music.audio.currentTime, 0);
});

test('Q6 listen engine: a guest\'s 30-second preview of a release\'s last song stops the record at the preview\'s end, never past it, and says so once', async () => {
  /* a creator's release (the engine itself stops a locked preview at 30 s, inside the whole file): when its last song
     is a guest's preview, the record stops where that listener's song stops. A seek to the end of the file passed the
     preview's boundary, and its timeupdate ended the preview a second time */
  const e = engine({ who: 'guest' });
  const base = { m_uid: 'creator-1', artist: 'Fixture creator', poster_url: '', genre: '', published_at: '2026-11-01T00:00:00Z' };
  e.music.registerCreatorTrack({ ...base, id: 'c-one', title: 'Creator one', access_mode: 'public', previewUrl: 'creator-one.mp3' });
  e.music.registerCreatorTrack({ ...base, id: 'c-last', title: 'Creator last', access_mode: 'account', previewUrl: 'creator-last-preview.mp3' });
  await e.music.playCreator('c-last'); await settle(); await settle();
  assert.equal(e.music.access(), 'preview');
  assert.equal(e.music.audio.paused, false, 'the preview plays');
  e.music.audio.currentTime = 30; e.music.audio.fire('timeupdate'); await settle(); await settle();
  assert.equal(e.music.current().creatorTrackId, 'c-last', 'the record stops on its last song');
  assert.equal(e.music.audio.paused, true);
  assert.ok(e.music.audio.currentTime < 30, 'never past the preview\'s boundary: ' + e.music.audio.currentTime);
  e.music.audio.fire('timeupdate'); await settle();     // the browser's timeupdate after any seek
  assert.equal(e.events.filter((x) => x.name === 'music_preview_complete').length, 1, 'the preview ended once');
  assert.deepEqual(plain(e.music.audio.loads), ['creator-last-preview.mp3'], 'nothing else was loaded');
  /* Play there starts the preview again from its beginning, not at its boundary (where it would stop at once) */
  await e.music.resume(); await settle();
  assert.equal(e.music.audio.currentTime, 0);
  assert.equal(e.music.audio.paused, false);
});

test('Q6 listen engine: a creator\'s songs listed by Listen and again by their artist page stay one record: Next moves on within it, then stops', async () => {
  /* Listen's "From creators" rail registers a creator's songs first (no release named), then the artist page registers
     them again with their release. The queue keeps the first registrations, the song that plays is the latest: the
     record must be read the same way for both, or Next stops at once (found by the M5 shell suite; at the base the record
     never stopped, running on to its first song again) */
  const e = engine({ who: 'guest' });
  const base = { m_uid: 'creator-1', artist: 'Fixture creator', poster_url: '', genre: '', published_at: '2026-11-01T00:00:00Z', access_mode: 'public' };
  const one = { ...base, id: 'c-one', title: 'Creator one', previewUrl: 'creator-one.mp3' };
  const two = { ...base, id: 'c-two', title: 'Creator two', previewUrl: 'creator-two.mp3' };
  e.music.registerCreatorTrack(one); e.music.registerCreatorTrack(two);                      // Listen's rail
  e.music.registerCreatorTrack({ ...one, release_name: 'Singles' }); e.music.registerCreatorTrack({ ...two, release_name: 'Singles' });   // the artist page
  await e.music.playCreator('c-one'); await settle(); await settle();
  await e.music.next(); await settle(); await settle();
  assert.equal(e.music.current().creatorTrackId, 'c-two', 'Next moved on to the release\'s next song');
  assert.equal(e.music.audio.paused, false);
  await e.music.next(); await settle(); await settle();
  assert.equal(e.music.current().creatorTrackId, 'c-two', 'and the record stops after its last song');
  assert.equal(e.music.audio.paused, true);
});

test('Q6 album: the last row ends and the album stops; Next on the last row stops it at the end', async () => {
  const a = album({ signedIn: false });
  a.rows.pop();                                   // an album with no held song
  a.play(1); await settle();
  a.deck.end(); await settle(); await settle();
  assert.equal(a.current(), 1);
  assert.equal(a.deck.paused, true);
  assert.equal(a.deck.loads.filter((s) => s === 'a.mp3').length, 1, 'the first song was never loaded again');
  a.play(1); await settle();
  a.next(); await settle();
  assert.equal(a.current(), 1);
  assert.equal(a.deck.paused, true);
  assert.ok(a.deck.duration - a.deck.currentTime <= 0.1, 'paused at the end (a hair before it)');
});

/* ================================================================== Q7: the approved listening events */

function sender() {
  const src = read('js/analytics.js');
  const code = slice(src, 'var MCC_PRIVACY_REQUIRED_VERSION', '/* EVENT_OUTBOX_FACTORY_END */') +
    slice(src, 'window.MCC_TRACK = (function () {', '\n/* ============================================================\n   MCC_MODEL');
  const area = () => { const m = new Map(); return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const localStorage = area(), sessionStorage = area();
  localStorage.setItem('mcc_privacy_ack', JSON.stringify({ version: '2026-10-19', accepted_at: '2026-11-23T00:00:00Z' }));
  localStorage.setItem('mcc_acq', JSON.stringify({ src: 'direct', med: 'none', cmp: '', plug: '', at: '2026-11-23' }));
  const listeners = {}, sent = [];
  const document = { referrer: '', cookie: '', visibilityState: 'visible', currentScript: null, addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); } };
  const context = { document, localStorage, sessionStorage, URL, URLSearchParams, Intl, Uint8Array,
    navigator: { onLine: true, language: 'en-US', platform: 'test', userAgent: 'test', vendor: '', maxTouchPoints: 0 },
    screen: { width: 390, height: 844, availWidth: 390, availHeight: 844 }, innerWidth: 390, innerHeight: 844, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }), addEventListener() {},
    location: { pathname: '/listen.html', search: '', hostname: 'matthew.mccluster.org', origin: 'https://matthew.mccluster.org', href: 'https://matthew.mccluster.org/listen.html' },
    crypto: { randomUUID }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, console,
    fetch: async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, clone: () => ({ json: async () => ({ ok: true }) }) }; } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'js/analytics.js' });
  return { track: (n, p) => context.MCC_TRACK(n, p), async flush() { document.visibilityState = 'hidden'; (listeners.visibilitychange || []).forEach((fn) => fn()); await settle(); },
    names: () => sent.flatMap((b) => b.events.map((e) => e.name)) };
}
test('Q7 approved: the dropped connection and the song that would not load are sent, and nothing is held back', async () => {
  const s = sender();
  s.track('music_interrupted', { reason: 'error', at_s: 42, attempt: 0, path: 'public' });
  s.track('music_error', { code: 4 });
  await s.flush();
  assert.deepEqual(s.names().filter((n) => /^music_/.test(n)).sort(), ['music_error', 'music_interrupted']);
  assert.doesNotMatch(read('js/analytics.js'), /AWAITING_APPROVAL/, 'the hold is gone');
});

test('Q7 both are in the measurement dictionary, with what they mean and who sends them', async () => {
  const { EVENT_DICTIONARY } = await import('../../workers/mccluster/src/analytics/measurement-dictionary.js');
  const row = (n) => EVENT_DICTIONARY.find((e) => e.event_name === n);
  for (const n of ['music_interrupted', 'music_error']) {
    assert.ok(row(n), n + ' is reviewed into the dictionary');
    assert.equal(row(n).source_stage, 'ops', n + ': a delivery signal, not a listen');
    assert.equal(row(n).verified_outcome, false);
    assert.match(row(n).meaning, /once per/i, n + ': it says it is counted once, not per read');
  }
  assert.deepEqual(row('music_interrupted').producer.references, ['album.html', 'js/music-engine.js']);
  assert.deepEqual(row('music_error').producer.references, ['js/music-engine.js']);
});

test('Q7 one dropped connection is one music_interrupted, however many reads fail (engine)', async () => {
  const c = clockOf();
  const e = engine({ clock: c, who: 'guest' });
  await e.music.play('beta', 'Beta one');
  e.music.audio.currentTime = 60;
  e.music.audio.fail(2);
  for (let i = 0; i < 5; i++) {
    const n = e.music.audio.loads.length;
    await until(c, () => e.music.audio.loads.length > n, 50, 20000);
    e.music.audio.fail(2);
  }
  await c.tick(20000);
  assert.equal(e.events.filter((x) => x.name === 'music_interrupted').length, 1, 'one drop, one event (it was one per failed read)');
  assert.equal(e.events.filter((x) => x.name === 'music_error').length, 1);
});

test('Q7 one dropped connection is one music_interrupted on the album too', async () => {
  const source = read('album.html');
  const fn = slice(source, '    function deckFailed(why, since) {', '    /* the next try, at its time from the moment the sound stopped');
  assert.match(fn, /var fresh = !deckTrouble \|\| deckTrouble\.row !== row \|\| deckTrouble\.state === "loading" \|\| !deckTrouble\.since;/);
  assert.match(fn, /if \(fresh && window\.MCC_TRACK\) window\.MCC_TRACK\("music_interrupted"/, 'sent when a drop begins, not on every failed try');
  const eng = read('js/music-engine.js');
  assert.match(eng, /if \(fresh\) trackEvent\("music_interrupted"/);
});

/* ================================================================== the review's findings (QW-R1 .. QW-R8)

   An independent review of the slice found four blockers and four minors (docs/music/MUSIC-RELEASE-20261119.md,
   "Quick wins", "Review and fixes"). Each test below failed at the branch head the review read (the quick wins as
   merged, 1580bde5) and passes after its fix. The browser half is in scripts/e2e/music-quick-wins.e2e.mjs. */

/* QW-R1: the album page's shelf of albums set every whole cover, and the M, PRIM3 and VAUNT marks, on a grey plate:
   css/music-director.css gives that shelf the rule colour as its ground (a gallery of 1 px rules), and the v2 cards
   over it are transparent, so the ground filled the empty part of every square. */
test('QW-R1 the album page\'s shelf puts nothing behind its covers: no gallery ground, no frame, the same rail as Listen', () => {
  const block = slice(read('css/music-system-v2.css'), '/* WHOLE COVERS', '/* WHOLE COVERS END */');
  const rule = block.match(/\.music-v2\.music-room--album \.feat\{([^}]*)\}/);
  assert.ok(rule, 'the album page\'s shelf has its line in the one cover rule (three classes: it outranks the gallery rule)');
  assert.match(rule[1], /background:none!important/, 'no ground behind the cards, so none in the empty part of a square');
  assert.match(rule[1], /border:0!important/, 'no frame drawn round the covers');
  assert.match(rule[1], /gap:12px/, 'the cards keep the rail\'s spacing, as on Listen');
});

/* js/pip.js in Node: on a page that owns a player (MCC_MUSIC) it defines MCC_POCKET and stops, so its pure helpers
   can be asked without a page */
function pocketApi() {
  const store = new Map();
  const area = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const window = { console, Promise, JSON, localStorage: area, sessionStorage: area, MCC_MUSIC: {}, location: { pathname: '/listen.html' },
    document: { currentScript: { src: 'https://matthew.mccluster.org/js/pip.js?v=1' } } };
  window.window = window;
  vm.runInContext(read('js/pip.js'), vm.createContext(window), { filename: 'js/pip.js' });
  return window.MCC_POCKET;
}

/* QW-R2: the pocket (the mini player on every page that is not a music page) cropped a cover into a 74 x 56 tile
   (64 x 50 on a phone), cut its corners, set it on black and laid a dark gradient over it */
test('QW-R2 the pocket shows a song\'s album cover whole, in a square, with nothing behind or over it; a film keeps its tile', () => {
  const P = pocketApi();
  assert.equal(typeof P.picture, 'function', 'the pocket says what its picture is');
  const whip = json('data/albums.json').albums.find((a) => a.slug === 'whip-equipped');
  const coverSong = whip.tracks.find((t) => t.poster === whip.art && !t.music_video);
  assert.equal(P.picture({ poster: coverSong.poster, art: whip.art, music_video: '' }), 'cover', 'a song whose picture is its album\'s cover');
  assert.equal(P.picture({ poster: coverSong.poster, art: '', music_video: '' }, whip.art), 'cover', 'the cover known from the catalogue');
  assert.equal(P.picture({ poster: '', art: whip.art, music_video: '' }), 'cover', 'no picture of its own: its album\'s cover, whole');
  const filmSong = whip.tracks.find((t) => t.poster === whip.art && t.music_video);
  assert.equal(P.picture({ poster: filmSong.poster, art: whip.art, music_video: filmSong.music_video }), 'film', 'a film keeps its tile');
  const here = json('data/albums.json').albums.find((a) => a.slug === 'here');
  assert.equal(P.picture({ poster: here.tracks[0].poster, art: here.art, music_video: here.tracks[0].music_video }), 'film');
  assert.equal(P.picture({ poster: here.tracks[0].poster, art: here.art, music_video: '' }), 'film', 'a film still is not a cover');
  const pip = read('js/pip.js');
  assert.match(pip, /classList\.toggle\("pocket__tile--cover"/, 'the tile is told when it shows a cover');
  const css = slice(read('css/style.css'), '/* WHOLE COVERS IN THE POCKET', '/* WHOLE COVERS IN THE POCKET END */');
  const tile = css.match(/\.pocket \.pocket__tile--cover \{([^}]*)\}/);
  assert.ok(tile, 'the cover tile has its rule');
  for (const d of [/width:\s*50px/, /height:\s*50px/, /border-radius:\s*0/, /background:\s*transparent/, /box-shadow:\s*none/]) assert.match(tile[1], d);
  assert.match(css, /\.pocket \.pocket__tile--cover \.pocket__film \{[^}]*object-fit:\s*contain[^}]*\}/, 'the whole cover, scaled inside the square');
  assert.match(css, /\.pocket \.pocket__tile--cover \.pocket__scrim,\s*\.pocket \.pocket__tile--cover \.pocket__lyr \{\s*display:\s*none;\s*\}/, 'nothing laid over it');
  assert.match(css, /@media \(min-width: 561px\) \{\s*\.pocket \.pocket__tile--cover \{ width: 56px; height: 56px; \}\s*\}/, 'wider screens only give it room');
  assert.doesNotMatch(css, /max-width/, 'phone first');
});

/* QW-R3: a pocket record of the closing song (its public preview, banked before the hold, on this device or in a
   member's shared row) mounted on every other page, named the song, and its Play read the preview to its end */
test('QW-R3 the pocket never carries a held or gated song, found by album and title or by its file; unread, a preview file is never its to play', () => {
  const P = pocketApi();
  assert.equal(typeof P.carries, 'function', 'the pocket asks whether it may carry a record');
  const albums = json('data/albums.json').albums;
  const cia = albums.find((a) => a.slug === 'cia-mind-control');
  const held = cia.tracks[cia.tracks.length - 1];
  assert.equal(P.carries({ src: held.src, title: held.title, album: cia.slug }, albums), false, 'the record the album banked before the hold');
  assert.equal(P.carries({ src: held.src, title: '', album: '' }, albums), false, 'found by its file');
  assert.equal(P.carries({ src: 'assets/audio/elsewhere.m4a', title: held.title, album: cia.slug }, albums), false, 'found by its album and title');
  assert.equal(P.carries({ src: cia.tracks[0].src, title: cia.tracks[0].title, album: cia.slug }, albums), true, 'the album\'s other songs ride as before');
  const here = albums.find((a) => a.slug === 'here');
  assert.equal(P.carries({ src: here.tracks[0].src, title: here.tracks[0].title, album: 'here' }, albums), true);
  assert.equal(P.carries({ src: here.tracks[0].src, title: here.tracks[0].title, album: 'here' }, null), true, 'the catalogue unread: an ordinary song rides');
  assert.equal(P.carries({ src: held.src, title: held.title, album: cia.slug }, null), false, 'the catalogue unread: a preview file is never the pocket\'s to play');
  assert.equal(P.carries(null, albums), false);
  assert.equal(P.carries({ src: '' }, albums), false);
});

/* the song test's cards in Node: js/song-test.js over a small stand-in for the page, the answer of song_test_state given */
async function songCards(rows, opts = {}) {
  class El {
    constructor(tag) { this.tagName = tag; this.kids = []; this.className = ''; this.text = ''; this.attrs = {}; this.style = {};
      this.classList = { add: (c) => { this.className = (this.className + ' ' + c).trim(); }, remove() {}, contains: (c) => this.className.split(/\s+/).includes(c) }; }
    appendChild(n) { this.kids.push(n); return n; }
    set textContent(v) { this.kids = []; this.text = String(v); }
    get textContent() { return this.text + this.kids.map((k) => k.textContent).join(''); }
    setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    addEventListener() {} querySelector() { return null; } scrollIntoView() {}
    all(cls) { const out = []; const walk = (n) => { if (n.className && n.className.split(/\s+/).includes(cls)) out.push(n); (n.kids || []).forEach(walk); }; walk(this); return out; }
  }
  const document = { createElement: (t) => new El(t), createTextNode: (t) => { const n = new El('#text'); n.text = String(t); return n; } };
  const window = { console, Promise, JSON, setTimeout, addEventListener() {},
    localStorage: { getItem: () => JSON.stringify({ access_token: 'fixture' }) }, MCC: { session: () => ({ access_token: 'fixture' }) },
    fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(rows) }), MCC_GATED: opts.gated };
  window.window = window; window.document = document;
  vm.runInContext(read('js/song-test.js'), vm.createContext(window), { filename: 'js/song-test.js' });
  const box = new El('div');
  const api = window.MCC_SONGTEST.mount(box, 'cia-mind-control', { signin: 'account.html', held: opts.held });
  for (let i = 0; i < 5; i++) await settle();
  const lock = () => Object.fromEntries(box.all('stq-card').map((c) => [c.getAttribute('data-stq'), (c.all('stq-lock')[0] || { textContent: '' }).textContent]));
  return { api, box, lock };
}

/* QW-R4: the closing song's card in the song test still promised "Unlocks after you spend your earned play on it in
   the album player", beside the pop-up that says it plays only for members with a full profile and a short
   questionnaire; since the hold no member can spend a play on it */
test('QW-R4 the closing song\'s test card says what its pop-up says, never that an earned play opens it; the house owner\'s card keeps his play', async () => {
  const { G } = gatedModule();
  const member = G.holdCopy(true).text;
  const rows = [
    { track: 'first-song', label: 'Song 1', question: 'Was this song racist? Why?', heard: false, gated: false, answer: null, split: null },
    { track: 'held-song', label: 'The earned track', question: 'Was this song racist? Why?', heard: false, gated: true, answer: null, split: null }
  ];
  const m = await songCards(rows, { gated: G, held: (key) => key === 'held-song' });
  assert.equal(m.lock()['held-song'], member, 'the card says what the pop-up says');
  assert.doesNotMatch(m.lock()['held-song'], /earned play/);
  assert.match(m.lock()['first-song'], /hear the whole song/i, 'the other cards as before');
  assert.equal(typeof m.api.paint, 'function', 'the album repaints the cards when the gate answers');
  const owner = await songCards(rows, { gated: G, held: () => false });
  assert.match(owner.lock()['held-song'], /spend your earned play/, 'the house owner still opens it with his own play');
  const noGate = await songCards(rows, { held: (key) => key === 'held-song' });
  assert.equal(noGate.lock()['held-song'], member, 'the same words before the gate\'s script has loaded');
  const album = read('album.html');
  assert.match(album, /MCC_SONGTEST\.mount\([^;]*held: function \(key\)/, 'the album tells the card which song is held for this listener');
});

/* the album's gate paint over the held row on its own, counting how often the song test's cards are drawn again */
function heldGate() {
  const source = read('album.html');
  const begin = source.indexOf('    /* the held song is held for everyone but the house owner');
  const end = source.indexOf('    function hasStoredSession() {', begin);
  assert.ok(begin > 0 && end > begin, 'the album decides in one place whom the held song is held for');
  let paints = 0;
  const row = { values: { 'data-hold': 'profile', 'data-src': '', 'data-key': 'held' }, getAttribute(k) { return this.values[k] ?? null; },
    hasAttribute(k) { return k in this.values; }, setAttribute(k, v) { this.values[k] = v; }, classList: { add() {}, remove() {} }, querySelector: () => ({ innerHTML: '' }) };
  const context = { window: {}, location: { pathname: '/album.html', search: '' }, esc: String, escAttr: String, chip: () => '', swapCurrent() {}, probeDuration() {},
    songTest: { paint: () => { paints++; } } };
  vm.runInContext(source.slice(begin, end) + '\nthis.paintGate = paintGate;', vm.createContext(context), { filename: 'album.html gate' });
  return { paint: (out) => context.paintGate(row, out), paints: () => paints };
}

test('QW-R4 the album draws the cards again when whom the held song is held for changes, and only then', () => {
  const g = heldGate();
  g.paint({ state: 'preview' });
  assert.equal(g.paints(), 1, 'the gate\'s first answer: the cards are drawn for this listener');
  g.paint({ state: 'preview' }); g.paint({ state: 'locked' });
  assert.equal(g.paints(), 1, 'the gate asked again with the same outcome (another tab\'s session, a counted song): a card being written is not drawn again');
  g.paint({ state: 'earned', operator: true });
  assert.equal(g.paints(), 2, 'the house owner: his card opens with his own play');
  g.paint({ state: 'earned', operator: true });
  assert.equal(g.paints(), 2);
  g.paint({ state: 'preview' });
  assert.equal(g.paints(), 3, 'signed out: held again');
});

/* the pop-up on its own, over a small stand-in for the page */
function holdDialog() {
  const make = (tag) => {
    const n = { tagName: tag, id: '', className: '', open: false, attrs: {}, kids: {}, listeners: {},
      setAttribute(k, v) { this.attrs[k] = v; if (k === 'open') this.open = true; },
      removeAttribute(k) { delete this.attrs[k]; if (k === 'open') this.open = false; },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      fire(t, e) { (this.listeners[t] || []).forEach((fn) => fn(e)); },
      querySelector(sel) { return this.kids[sel] || (this.kids[sel] = make(sel)); },
      showModal() { this.open = true; }, close() { this.open = false; }, focus() {}, contains(x) { return x === this; },
      /* where the pop-up sits on a 390 px screen (measured in Chromium): 358 x 244 */
      getBoundingClientRect: () => ({ left: 16, top: 300, right: 374, bottom: 544, width: 358, height: 244 }) };
    n.innerHTML = '';
    return n;
  };
  let dialog = null;
  const document = { readyState: 'complete', addEventListener() {}, createElement: make,
    body: { appendChild(n) { dialog = n; return n; } }, getElementById: (id) => (dialog && dialog.id === id ? dialog : null) };
  const listeners = [];
  const window = { console, Promise, document, location: { pathname: '/album.html', search: '?album=cia-mind-control' }, MCC: { session: () => null },
    addEventListener(type, fn, options) { listeners.push({ type, fn, options }); }, dispatchEvent() {}, CustomEvent: class { constructor(t) { this.type = t; } } };
  window.window = window;
  vm.runInContext(read('js/gated-audio.js'), vm.createContext(window), { filename: 'js/gated-audio.js' });
  return { G: window.MCC_GATED, dialog: () => dialog, windowListeners: () => listeners.slice() };
}

/* QW-R5: a click on the dialog's own padding has the dialog itself as its target, as a click on the backdrop does, so
   a tap beside the buttons or between the line and the buttons closed it */
test('QW-R5 a tap inside the pop-up, on its own padding, leaves it open; a tap on the backdrop outside it closes it', () => {
  const h = holdDialog();
  h.G.holdNotice({ signedIn: false });
  const d = h.dialog();
  assert.ok(d && d.open, 'the pop-up is open');
  for (const [x, y, where] of [[22, 306, 'top-left corner'], [368, 538, 'bottom-right corner'], [366, 422, 'beside the line']]) {
    d.fire('click', { target: d, clientX: x, clientY: y });
    assert.equal(d.open, true, `a tap 6 px inside its ${where} leaves it open`);
  }
  d.fire('click', { target: d, clientX: 8, clientY: 200 });
  assert.equal(d.open, false, 'a tap on the backdrop closes it');
});

/* JRN-3 (the engine stage 0 review): the pop-up's way forward (Sign in for a guest, Complete your profile for a member) is a
   link the music shell (an account view over Listen) and the World (its profile page) take in the document's capture
   phase and stop there, so the modal pop-up stayed open over the account form, or under the World. It hears its own link
   on the window, which comes before every document listener, and closes; nothing else changes. */
test('JRN-3 following the pop-up\'s way forward closes it first, whoever takes the link; a tap with a modifier, or elsewhere, leaves it', () => {
  const h = holdDialog();
  h.G.holdNotice({ signedIn: false });
  const d = h.dialog(), go = d.querySelector('.mcc-hold__go');
  const early = () => h.windowListeners().filter((l) => l.type === 'click' && (l.options === true || !!(l.options && l.options.capture)));
  assert.equal(early().length, 1, 'one click listener on the window, in the capture phase (before the shell\'s and the World\'s)');
  const click = (target, extra = {}) => early().forEach((l) => l.fn({ target, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...extra }));
  click(go, { metaKey: true });
  assert.equal(d.open, true, 'its link opened elsewhere with a modifier (a new tab): the pop-up stays');
  click({ tagName: 'P' });
  assert.equal(d.open, true, 'a tap that is not its way forward leaves it to its own rules (Close, Escape, the backdrop)');
  click(go);
  assert.equal(d.open, false, 'its Sign in closes it');
  h.G.holdNotice({ signedIn: true });
  assert.equal(d.open, true, 'shown again, for a member');
  click(go);
  assert.equal(d.open, false, 'its Complete your profile closes it too');
  assert.equal(early().length, 1, 'one listener however often it shows');
});

/* QW-R6: a link to the closing song (album.html?album=...&t=, from the catalogue's registry and Listen's search), a
   stale album seat or a stale pocket record seated it in the deck with no source; Chromium reports an empty source
   as error 4, and the deck counted that as a dropped connection: music_interrupted on the wire for a song nobody
   asked to play */
test('QW-R6 an empty held source is not a drop: seating the held row sends no music_interrupted', async () => {
  const events = [];
  const a = album({ signedIn: false, events });
  a.load(2, 0);                  // the held row, seated as a link or a stale seat did
  a.deck.fail(4);                // what Chromium does with an empty source
  await settle(); await settle();
  assert.deepEqual(events.filter((e) => e.name === 'music_interrupted' || e.name === 'music_error').map((e) => e.name), []);
});

/* the album's seat-restoring block (a link, the pocket, this device's seat, the shared row) on its own */
async function restoredSeat(opts = {}) {
  const source = read('album.html');
  const code = slice(source, '    /* the memory: pick up exactly where you left off', '    /* THE DISSOLVE');
  const attrs = (entries) => ({ values: { ...entries }, getAttribute(k) { return this.values[k] ?? null; }, hasAttribute(k) { return k in this.values; } });
  const rows = [
    attrs({ 'data-title': 'Song A', 'data-src': 'a.mp3', 'data-albslug': 'fixture' }),
    attrs({ 'data-title': 'Song B', 'data-src': 'b.mp3', 'data-albslug': 'fixture' }),
    attrs({ 'data-title': 'Held closer', 'data-src': '', 'data-hold': 'profile', 'data-gated-object': 'held/held.mp3', 'data-albslug': 'fixture' })
  ];
  const loads = [], events = [];
  const context = { rows, KEY: 'mcc_here_radio', WANT: opts.want || '', ALBUM: 'fixture', cur: -1, deck: { paused: true }, JSON, Number, Math, Date, Promise,
    localStorage: { getItem: (k) => (k === 'mcc_here_radio' && opts.seat ? JSON.stringify(opts.seat) : null) },
    window: { MCC_POCKET: { read: () => opts.pocket || null, pull: () => Promise.resolve(opts.far || null) }, MCC_TRACK: (n, p) => events.push({ name: n, ...p }) } };
  context.load = (i) => { loads.push(i); context.cur = i; };
  vm.runInContext(code + '\nrestoreSeat();', vm.createContext(context), { filename: 'album.html restoreSeat' });
  for (let i = 0; i < 4; i++) await settle();
  return { loads, events };
}
test('QW-R6 a link, the pocket, this device\'s seat or the shared row never seats the held song; other songs as before', async () => {
  assert.deepEqual((await restoredSeat({ want: 'held closer' })).loads, [], 'a link to it opens the album with nothing chosen');
  assert.deepEqual((await restoredSeat({ want: 'held closer' })).events.filter((e) => e.name === 'listen_open'), [], 'and nothing is said to have opened');
  assert.deepEqual((await restoredSeat({ want: 'held closer', seat: { album: 'fixture', i: 1, t: 3 } })).loads, [], 'the link still wins over an older seat');
  assert.deepEqual((await restoredSeat({ pocket: { title: 'Held closer', t: 1 } })).loads, [], 'a stale pocket record of it');
  assert.deepEqual((await restoredSeat({ seat: { album: 'fixture', i: 2, t: 1 } })).loads, [], 'this device\'s stale seat on it');
  assert.deepEqual((await restoredSeat({ far: { title: 'Held closer', album: 'fixture', t: 1 } })).loads, [], 'the shared row naming it');
  assert.deepEqual((await restoredSeat({ want: 'song b' })).loads, [1], 'a link to another song seats it');
  assert.deepEqual((await restoredSeat({ seat: { album: 'fixture', i: 1, t: 2 } })).loads, [1], 'a seat on another song is kept');
});

/* QW-R7: the house owner's own play of the closing song banked its signed one-play URL (the master) in the pocket,
   and the pocket's save sends that to his shared row on every device: the held row has no public preview to bank */
test('QW-R7 the album banks nothing for the held song: no signed one-play URL in the pocket or the shared row', () => {
  const source = read('album.html');
  const code = slice(source, '    function pocket(force) {', '    function paintRows() {');
  const attrs = (entries) => ({ values: { ...entries }, getAttribute(k) { return this.values[k] ?? null; }, hasAttribute(k) { return k in this.values; } });
  const rows = [
    attrs({ 'data-title': 'Song A', 'data-src': 'a.mp3', 'data-albslug': 'fixture' }),
    attrs({ 'data-title': 'Held closer', 'data-src': 'https://example.invalid/signed/master?token=one-play', 'data-granted': '', 'data-hold': 'profile', 'data-gated-object': 'held/held.mp3', 'data-albslug': 'fixture' })
  ];
  const saved = [], cleared = [];
  const context = { rows, cur: 1, ALBUM: 'fixture', ARTIST: 'McCluster', deck: { currentTime: 12, paused: false }, Date,
    window: { MCC_POCKET: { save: (s) => saved.push(s), clear: () => cleared.push(1) } } };
  vm.runInContext(code + '\nthis.bank = pocket;', vm.createContext(context), { filename: 'album.html pocket' });
  context.bank(true);
  assert.deepEqual(saved, [], 'nothing of the held song is banked');
  assert.equal(cleared.length, 1, 'the pocket holds nothing it could not play');
  context.cur = 0;
  context.bank(true);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].src, 'a.mp3', 'every other song is banked as before');
});

/* QW-R8: the heart on every album row said "Save to My Rotation", but since the quick wins no music page shows the
   rotation (the song rails are off): a label naming a list that is gone */
test('QW-R8 the album\'s heart says what it does in the words Listen uses, and names no list the pages do not show', () => {
  const album = read('album.html');
  assert.doesNotMatch(album, /Save to My Rotation/);
  assert.match(album, /'<button class="hrt" type="button" data-hrt aria-pressed="false" aria-label="Save ' \+ escAttr\(t\.title\) \+ '">/);
  /* and, as Listen's heart does, it says whether the song is saved: painted from the saves, and on every tap */
  assert.match(album, /function heartOn\(b, on\) \{\s*b\.classList\.toggle\("on", !!on\);\s*b\.setAttribute\("aria-pressed", on \? "true" : "false"\);/);
  assert.match(album, /if \(b\) heartOn\(b, inRotation\(/, 'painted from the saves');
  assert.match(album, /heartOn\(b, toggleRotation\(/, 'and on every tap');
  assert.match(read('js/listen.js'), /'" aria-label="Save ' \+ escAttr\(t\.title\) \+ '">' \+ HEART/, 'Listen\'s heart, the same words');
});

/* VERIFICATION (2026-11-24): the house owner's own play of the held song is his one play until it is spent. Once his
   claim has answered with the master (the row is granted, its gate answer "full"), a pause and Play (the deck bar, the
   row, the lock screen) picks it up where it paused, as every other earned play does; it never claims a second play
   and never starts the song again from 0:00. */
test('VQW the house owner\'s own play of the held song, paused and played again, picks up where it paused with the same play', async () => {
  for (const how of ['deck bar or lock screen Play', 'a tap on its row']) {
    const a = album({ signedIn: true, owner: true, gate: 'earned', keepGateOut: true });
    a.play(2); await settle(); await settle();
    assert.equal(a.claims.length, 1, 'his play: one claim');
    assert.equal(a.deck.src, 'held-master.mp3', 'the master');
    a.deck.currentTime = 42;
    a.deck.pause();
    const loads = a.deck.loads.length;
    if (how === 'a tap on its row') a.play(2); else a.play();
    await settle(); await settle(); await settle();
    assert.equal(a.claims.length, 1, how + ': no second play is claimed');
    assert.equal(a.deck.loads.length, loads, how + ': nothing is loaded again');
    assert.equal(a.deck.currentTime, 42, how + ': it picks up where it paused, never from 0:00');
    assert.equal(a.deck.paused, false, how + ': it plays');
    assert.equal(a.notices.length, 0, how + ': no pop-up for the house owner');
  }
});

test('VQW the house owner\'s card keeps his own line while his play of the held song is on (the gate answered "full")', () => {
  const source = read('album.html');
  const begin = source.indexOf('    /* the held song is held for everyone but the house owner');
  const end = source.indexOf('    function hasStoredSession() {', begin);
  assert.ok(begin > 0 && end > begin);
  let paints = 0;
  const row = { values: { 'data-hold': 'profile', 'data-src': '', 'data-key': 'held' }, getAttribute(k) { return this.values[k] ?? null; },
    hasAttribute(k) { return k in this.values; }, setAttribute(k, v) { this.values[k] = v; }, removeAttribute(k) { delete this.values[k]; },
    classList: { add() {}, remove() {} }, querySelector: () => ({ innerHTML: '' }) };
  const context = { window: {}, location: { pathname: '/album.html', search: '' }, esc: String, escAttr: String, chip: () => '', swapCurrent() {}, probeDuration() {},
    songTest: { paint: () => { paints++; } } };
  vm.runInContext(source.slice(begin, end) + '\nthis.paintGate = paintGate; this.heldFor = heldFor;', vm.createContext(context), { filename: 'album.html gate' });
  context.paintGate(row, { state: 'earned', operator: true });
  assert.equal(paints, 1, 'his gate answers operator: his card');
  assert.equal(context.heldFor(row), false);
  /* his claim answers with the master: the row is granted and the gate's answer is the play itself */
  row.setAttribute('data-src', 'held-master.mp3');
  row.setAttribute('data-granted', '');
  context.paintGate(row, { state: 'full', url: 'held-master.mp3' });
  assert.equal(context.heldFor(row), false, 'his granted play is his, not held');
  assert.equal(paints, 1, 'his card is not drawn again with the held line while his play is on');
  /* the play is spent: the row goes back to asking the gate, which answers operator again */
  row.removeAttribute('data-granted');
  context.paintGate(row, { state: 'earned', operator: true });
  assert.equal(paints, 1);
  /* anyone else stays held, granted or not never comes to them */
  context.paintGate(row, { state: 'locked' });
  assert.equal(context.heldFor(row), true);
  assert.equal(paints, 2, 'signed out or a member: held, the card says why');
});
