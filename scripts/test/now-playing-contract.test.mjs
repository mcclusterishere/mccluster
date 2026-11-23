import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/* ONE NOW PLAYING EVERYWHERE (music slice M2).

   Matthew, 2026-11-19: "I can control the music from like my music engine when I
   swipe down my now playing and I need this to be the same for this site."

   Lane 03's bar probe (music map 03, probe E1, probes/external/bar-matrix.mjs) read
   every web player and derived the commands WebKit publishes to the lock screen,
   Control Center and AirPods from the Media Session handlers each one registers
   (WebKit RemoteCommandListenerCocoa.mm:65-129: no handler at all publishes play,
   pause, scrub and skip 15 s with no track buttons; seekbackward and seekforward
   publish skip 15 s next to the track buttons, and third-party reports say iOS then
   draws the skips instead of previous and next). It found the World soundtrack with
   no handlers, the album with skip buttons and its artwork labelled JPEG whatever
   the file, the pocket without "previous", and the engine with no position (music
   map 00, C2: PB-7, PB-9, PB-10, EXT-3, EXT-6).

   These are its checks as repository tests, and the contract of the one owner that
   replaces nine sets of handlers: js/now-playing.js. What iOS draws from it is
   Inferred until Matthew's devices run the checklist (docs/music/MUSIC-RELEASE-20261119.md,
   rows 4, 5 and 17); the browser proof is scripts/e2e/now-playing.e2e.mjs. */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = p => readFileSync(join(ROOT, p), 'utf8');
const ACTIONS = ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack', 'skipad'];

/* every web player the music maps list (lane 01 table P1-P9, lane 07 section 4.4), with
   the element its Now Playing is bound to. Not here, and why, is in the release record:
   the front page's scene engine (index.html, hard rule 3), the game hub's unused player,
   the owner's tools, and the World's member posts and voice rooms. */
const PLAYERS = [
  { id: 'listen engine (listen.html, music-creator.html, the game hub)', files: ['js/music-engine.js'], media: 'audio' },
  { id: 'album deck (album.html, js/label.js, js/chamber.js)', files: ['album.html', 'js/label.js', 'js/chamber.js'], media: 'deck' },
  { id: 'album shelf previews (album.html)', files: ['album.html'], media: 'pv', shared: true },
  { id: 'pocket (js/pip.js)', files: ['js/pip.js'], media: 'audio' },
  { id: 'World soundtrack (js/world-audio-continuity.js)', files: ['js/world-audio-continuity.js', 'js/mnet-audio.js'], media: 'audio' },
  { id: 'gateway score (js/gateway.js)', files: ['js/gateway.js'], media: 'a' },
  { id: 'docket release (docket-516.html)', files: ['docket-516.html'], media: 'audio' },
  { id: 'music video feed (music-videos.html)', files: ['music-videos.html'], media: 'deck' },
  { id: 'syndicated embed (embed.html)', files: ['embed.html'], media: 'deck' },
];

/* Comments say why; only code plays. Strips line and block comments, keeping strings
   and regular-expression literals (the same reader as music-background.test.mjs). */
function stripComments(src) {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; out += ' '; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '/' && regexCanStart(out)) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== '\n') {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') cls = true; else if (ch === ']') cls = false; else if (ch === '/' && !cls) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      out += src.slice(i, j); i = j; continue;
    }
    out += c; i++;
  }
  return out;
}
function regexCanStart(before) {
  const t = before.replace(/\s+$/, '');
  if (!t) return true;
  if (/[(,=:[!&|?{};+\-*%<>~^]$/.test(t)) return true;
  const w = /([A-Za-z_$][\w$]*)$/.exec(t);
  return !!(w && /^(?:return|typeof|case|do|else|in|of|void|delete|new|throw|yield|await)$/.test(w[1]));
}
function codeOf(path) {
  const src = read(path);
  if (!/\.html$/.test(path)) return stripComments(src);
  const blocks = [];
  for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=/.test(m[1]) || /ld\+json|application\/json/.test(m[1])) continue;
    blocks.push(stripComments(m[2]));
  }
  return blocks.join('\n;\n');
}
function blockFrom(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== c) { if (code[j] === '\\') j++; j++; }
      i = j; continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return code.slice(open, i + 1);
  }
  return code.slice(open);
}
function definitionsOf(code, name) {
  const out = [];
  const re = new RegExp('(?:function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{|(?:var|let|const)\\s+' + name + '\\s*=\\s*function\\b[^(]*\\([^)]*\\)\\s*\\{)', 'g');
  for (const m of code.matchAll(re)) out.push(blockFrom(code, m.index + m[0].length - 1));
  return out;
}

/* ---- the bar matrix (probe E1): what each player hands the lock screen ---- */
function find(src, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  return [...src.matchAll(g)].length;
}
/* the specs a player hands the one owner: MCC_NOW_PLAYING.bind(<media>, { ... }) or a named object */
function bindSpecs(code, media) {
  const specs = [];
  const re = new RegExp('MCC_NOW_PLAYING\\.bind\\(\\s*' + media.replace(/[$.]/g, '\\$&') + '\\s*,\\s*', 'g');
  for (const m of code.matchAll(re)) {
    const at = m.index + m[0].length;
    if (code[at] === '{') { specs.push(blockFrom(code, at)); continue; }
    const id = /^([A-Za-z_$][\w$]*)/.exec(code.slice(at));
    const def = id && new RegExp('(?:var|let|const)\\s+' + id[1] + '\\s*=\\s*\\{').exec(code);
    if (def) specs.push(blockFrom(code, def.index + def[0].length - 1));
  }
  return specs;
}
const hasKey = (spec, key) => new RegExp('(?:^|[{,\\s])' + key + '\\s*:').test(spec);
/* the actions a player gives the lock screen, read the two ways it can: handlers it
   registers itself (the way every player did before this slice), or a spec it hands
   js/now-playing.js, which registers play, pause, seek-to and stop for whoever plays,
   and previous and next from the spec (the module's own behaviour is tested below) */
function actionsOf(player) {
  const out = new Set();
  for (const f of player.files) {
    if (!existsSync(join(ROOT, f))) continue;
    const src = codeOf(f);
    if (!(player.shared && f === 'album.html') && /setActionHandler/.test(src)) {
      for (const a of ACTIONS) {
        const direct = find(src, new RegExp(`setActionHandler\\(\\s*["']${a}["']`));
        const mapped = find(src, new RegExp(`(?:^|[\\[{,\\s])["']?${a}["']?\\s*[:,\\]]`));
        if (direct || (mapped && /setActionHandler\(\s*name/.test(src))) out.add(a);
      }
    }
    for (const spec of bindSpecs(src, player.media)) {
      if (hasKey(spec, 'play')) out.add('play');
      if (hasKey(spec, 'pause')) out.add('pause');
      if (hasKey(spec, 'previous')) out.add('previoustrack');
      if (hasKey(spec, 'next')) out.add('nexttrack');
      out.add('seekto'); out.add('stop');
    }
  }
  return out;
}

/* ---- a stand-in browser for the module ---- */
function media({ duration = 200, currentTime = 0, rate = 1 } = {}) {
  const ls = {};
  const m = {
    duration, currentTime, playbackRate: rate, paused: true, ended: false, muted: false,
    addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
    removeEventListener(t, f) { ls[t] = (ls[t] || []).filter(x => x !== f); },
    fire(t) { (ls[t] || []).slice().forEach(f => f({ type: t, target: m })); },
    play() { m.paused = false; m.ended = false; m.fire('play'); m.fire('playing'); return Promise.resolve(); },
    pause() { if (m.paused) return; m.paused = true; m.fire('pause'); },
  };
  return m;
}
function browser({ withSession = true, script = 'https://matthew.mccluster.org/js/now-playing.js?v=stamp' } = {}) {
  const log = { positions: [], attempts: [], metadata: [], handlers: {}, states: [] };
  const session = withSession ? {
    _md: null, _state: 'none',
    get metadata() { return this._md; },
    set metadata(v) { this._md = v; log.metadata.push(v); },
    get playbackState() { return this._state; },
    set playbackState(v) { this._state = v; log.states.push(v); },
    setActionHandler(a, fn) {
      if (!['play', 'pause', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'skipad', 'stop', 'seekto'].includes(a)) throw new TypeError('unknown action ' + a);
      log.handlers[a] = fn;
    },
    setPositionState(st) {
      /* every call is seen, even one a browser would refuse; browsers refuse a NaN or negative length and
         take an infinite one as a live stream, so the owner itself must keep an unknown length off the scrubber */
      log.attempts.push(st === undefined ? 'cleared' : { ...st });
      if (st !== undefined) {
        if (!(st.duration >= 0)) throw new TypeError('duration');
        if (!(st.position >= 0) || st.position > st.duration) throw new TypeError('position');
        if (st.playbackRate === 0 || !Number.isFinite(st.playbackRate)) throw new TypeError('rate');
      }
      log.positions.push(st === undefined ? 'cleared' : { ...st });
    },
  } : undefined;
  const win = {
    navigator: withSession ? { userAgent: 'test', mediaSession: session } : { userAgent: 'test' },
    MediaMetadata: function (init) { Object.assign(this, JSON.parse(JSON.stringify(init))); },
    document: { readyState: 'loading', currentScript: { src: script }, addEventListener() {} },
    URL,
  };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext('Date.now = function () { return __now; }; var __now = 1000000;', ctx);
  vm.runInContext(read('js/now-playing.js'), ctx);
  return { win, ctx, log, session, tick: ms => vm.runInContext('__now += ' + ms, ctx) };
}

/* ---- the files: true size and type, read from the bytes (an oracle of the test's own) ---- */
function imageInfo(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: 'image/png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type: 'image/jpeg', w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = buf.toString('latin1', 12, 16);
    if (chunk === 'VP8 ') return { type: 'image/webp', w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { type: 'image/webp', w: (b & 0x3fff) + 1, h: ((b >>> 14) & 0x3fff) + 1 }; }
    if (chunk === 'VP8X') return { type: 'image/webp', w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
  }
  if (buf.toString('latin1', 0, 4) === 'GIF8') return { type: 'image/gif', w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  return null;
}
const albums = () => JSON.parse(read('data/albums.json')).albums;
const covers = () => [...new Set(albums().map(a => a.art).filter(Boolean).concat(['assets/img/m-mark.png']))].sort();

test('the bar: every player puts previous and next on the lock screen, and none a 15-second skip (lane 03 probe E1)', () => {
  const rows = PLAYERS.map(p => ({ id: p.id, actions: [...actionsOf(p)].sort() }));
  const bad = rows.filter(r => !r.actions.includes('previoustrack') || !r.actions.includes('nexttrack')
    || r.actions.includes('seekbackward') || r.actions.includes('seekforward'));
  assert.deepEqual(bad, [], 'previous and next on every music surface, no ±skip anywhere (decision D-4; AirPods double and ' +
    'triple press arrive as next and previous; WebKit publishes seekbackward/seekforward as 15-second skips):\n' +
    rows.map(r => `  ${r.id}: ${r.actions.join(', ') || 'no handlers (WebKit defaults: play, pause, scrub, skip 15 s)'}`).join('\n'));
});

test('one owner: only js/now-playing.js speaks to the lock screen, and every player binds to it with what it plays', () => {
  const offenders = [];
  const files = new Set(['album.html', 'listen.html', 'music-videos.html', 'docket-516.html', 'embed.html', 'heal-the-3rd-world.html']);
  const walk = dir => { for (const n of readdirSync(join(ROOT, dir))) { const r = dir + '/' + n; if (statSync(join(ROOT, r)).isDirectory()) walk(r); else if (/\.m?js$/.test(n)) files.add(r); } };
  walk('js');
  for (const f of files) {
    if (f === 'js/now-playing.js' || !existsSync(join(ROOT, f))) continue;
    if (/\bmediaSession\b|\bMediaMetadata\b|setActionHandler|setPositionState|playbackState/.test(codeOf(f))) offenders.push(f);
  }
  assert.deepEqual(offenders, [], 'these files set Media Session state themselves; with nine owners the lock screen shows whichever wrote last');
  for (const p of PLAYERS) {
    const specs = p.files.filter(f => existsSync(join(ROOT, f))).flatMap(f => bindSpecs(codeOf(f), p.media));
    assert.ok(specs.length > 0, `${p.id}: binds its ${p.media} element through MCC_NOW_PLAYING.bind`);
    for (const s of specs) for (const key of ['track', 'play', 'pause', 'previous', 'next']) {
      assert.ok(hasKey(s, key), `${p.id}: its Now Playing spec says ${key}: ${s.slice(0, 200)}`);
    }
  }
});

test('artwork: each supplied cover whole, declared with the true size and type read from its file', () => {
  const declared = [];
  for (const p of PLAYERS) for (const f of p.files) {
    if (!existsSync(join(ROOT, f))) continue;
    const code = codeOf(f);
    for (const m of code.matchAll(/artwork\s*:/g)) {
      const near = code.slice(m.index, m.index + 260);
      if (/\b(?:type|sizes)\s*:/.test(near)) declared.push(`${f}: ${near.slice(0, 120).replace(/\s+/g, ' ')}`);
    }
  }
  assert.deepEqual(declared, [], 'no player writes a size or a type of its own (album.html called every cover image/jpeg, js/label.js re-dressed one image as 96, 192 and 512)');

  const { win } = browser();
  const NP = win.MCC_NOW_PLAYING;
  assert.equal(typeof NP.artwork, 'function', 'js/now-playing.js describes artwork');
  const nonSquare = [];
  for (const c of covers()) {
    const info = imageInfo(readFileSync(join(ROOT, c)));
    assert.ok(info, `${c}: a readable image`);
    const got = JSON.parse(JSON.stringify(NP.artwork(c)));
    assert.deepEqual(got, [{ src: 'https://matthew.mccluster.org/' + c, sizes: `${info.w}x${info.h}`, type: info.type }],
      `${c}: one entry, the whole supplied file at its true size and type`);
    assert.deepEqual(JSON.parse(JSON.stringify(NP.artwork('https://matthew.mccluster.org/' + c + '?v=stamp'))), got, `${c}: the same answer for its absolute address`);
    if (info.w !== info.h) nonSquare.push(c);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(NP.artwork('https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/creator-artwork/a/b.jpg'))),
    [{ src: 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/creator-artwork/a/b.jpg' }],
    'a file this site cannot read (a creator\'s artwork) goes as it is, with no size or type claimed');
  assert.deepEqual(JSON.parse(JSON.stringify(NP.artwork(''))), [], 'no cover, no artwork');
  /* a cover that is not square goes whole, as supplied; only Matthew can supply a square one (hard rule 10) */
  const record = existsSync(join(ROOT, 'docs/music/MUSIC-RELEASE-20261119.md')) ? read('docs/music/MUSIC-RELEASE-20261119.md') : '';
  const m2 = record.split(/^## M2\b/m)[1] || '';
  for (const c of nonSquare) assert.ok(m2.includes(c), `the record lists ${c} for Matthew as needing a square variant`);
  assert.ok(nonSquare.length >= 1, 'the catalogue has covers that are not square today');
});

test('the module: metadata, playbackState and position from what the bound player is playing', () => {
  const { win, log, session } = browser();
  const NP = win.MCC_NOW_PLAYING;
  assert.equal(typeof NP.bind, 'function', 'js/now-playing.js binds players');
  const m = media({ duration: 130.4 });
  const calls = [];
  const spec = {
    surface: 'test',
    track: () => ({ title: 'Who Did The Shoot', artist: 'Matthew McCluster', album: 'I AM HERE', art: 'assets/img/here-cover.jpg' }),
    play: () => { calls.push('play'); m.play(); }, pause: () => { calls.push('pause'); m.pause(); },
    previous: () => calls.push('previous'), next: () => calls.push('next'),
  };
  const h = NP.bind(m, spec);
  assert.ok(h && typeof h.update === 'function' && typeof h.clear === 'function', 'bind() hands back update() and clear()');
  assert.equal(session.metadata, null, 'nothing is said before anything plays');
  m.play();
  const md = JSON.parse(JSON.stringify(session.metadata));
  assert.deepEqual(md, { title: 'Who Did The Shoot', artist: 'Matthew McCluster', album: 'I AM HERE',
    artwork: [{ src: 'https://matthew.mccluster.org/assets/img/here-cover.jpg', sizes: '1024x682', type: 'image/jpeg' }] });
  assert.equal(session.playbackState, 'playing');
  assert.deepEqual(log.positions.at(-1), { duration: 130.4, playbackRate: 1, position: 0 });
  for (const a of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto', 'stop']) assert.equal(typeof log.handlers[a], 'function', `${a} is handled`);
  for (const a of ['seekbackward', 'seekforward']) assert.equal(log.handlers[a], null, `${a} is explicitly off (no ±skip, decision D-4)`);
  m.pause();
  assert.equal(session.playbackState, 'paused');
  /* the same track again says nothing new: no artwork re-fetch on every play */
  const before = log.metadata.length;
  m.play();
  assert.equal(log.metadata.length, before, 'metadata is set once per track, not on every play');
});

test('position state: guarded against NaN and Infinity, clamped, sent on play, pause, seek and rate, and throttled on timeupdate', () => {
  const { win, log, tick } = browser();
  const m = media({ duration: NaN });
  win.MCC_NOW_PLAYING.bind(m, { track: () => ({ title: 'T' }), play() {}, pause() {}, previous() {}, next() {} });
  m.play();
  assert.equal(log.attempts.length, 0, 'an unknown length (NaN) says nothing rather than something false');
  m.duration = Infinity; m.fire('durationchange');
  assert.equal(log.attempts.length, 0, 'an endless length (Infinity) says nothing either');
  m.duration = 0; m.fire('durationchange');
  assert.equal(log.attempts.length, 0, 'nor a length of 0');
  m.duration = 200; m.currentTime = 250; m.fire('durationchange');
  assert.deepEqual(log.positions.at(-1), { duration: 200, playbackRate: 1, position: 200 }, 'a position past the end is clamped to the end');
  m.currentTime = NaN; m.fire('seeked');
  assert.deepEqual(log.positions.at(-1), { duration: 200, playbackRate: 1, position: 0 }, 'an unknown position is 0');
  m.currentTime = -3; m.fire('seeked');
  assert.equal(log.positions.at(-1).position, 0, 'never negative');
  m.currentTime = 10; m.playbackRate = 0; m.fire('ratechange');
  assert.deepEqual(log.positions.at(-1), { duration: 200, playbackRate: 1, position: 10 }, 'a rate of 0 (which setPositionState refuses) is sent as 1');
  m.playbackRate = 1.5; m.fire('ratechange');
  assert.equal(log.positions.at(-1).playbackRate, 1.5, 'a real rate is passed on');
  const n = log.positions.length;
  m.currentTime = 11; m.fire('timeupdate');
  tick(300); m.currentTime = 11.3; m.fire('timeupdate');
  tick(300); m.currentTime = 11.6; m.fire('timeupdate');
  assert.equal(log.positions.length, n, 'timeupdate within a second of the last report adds nothing');
  tick(500); m.currentTime = 12.1; m.fire('timeupdate');
  assert.equal(log.positions.length, n + 1, 'a second on, timeupdate reports once');
  m.currentTime = 40; m.fire('seeked');
  assert.equal(log.positions.length, n + 2, 'a seek reports at once, throttle or not');
  m.pause();
  assert.equal(log.positions.length, n + 3, 'so does a pause');
});

test('the lock screen\'s controls reach the playing surface: play, pause, previous, next, seek-to and stop', () => {
  const { win, log, session } = browser();
  const m = media({ duration: 100 });
  const calls = [];
  win.MCC_NOW_PLAYING.bind(m, {
    track: () => ({ title: 'Runway Walk' }),
    play: () => { calls.push('play'); m.play(); }, pause: () => { calls.push('pause'); m.pause(); },
    previous: () => calls.push('previous'), next: () => calls.push('next'),
    seek: t => { calls.push('seek ' + t); m.currentTime = t; },
  });
  m.play();
  log.handlers.pause(); log.handlers.play(); log.handlers.nexttrack(); log.handlers.previoustrack();
  log.handlers.seekto({ seekTime: 42 }); log.handlers.seekto({ seekTime: 500 }); log.handlers.seekto({ seekTime: -5 }); log.handlers.seekto({ seekTime: NaN }); log.handlers.seekto({});
  assert.deepEqual(calls, ['pause', 'play', 'next', 'previous', 'seek 42', 'seek 100', 'seek 0'],
    'each command reaches the player; seek-to is clamped to the song and a malformed one is dropped');
  log.handlers.stop();
  assert.equal(m.paused, true, 'stop pauses (a player without its own stop)');
  assert.equal(session.metadata, null, 'and hands the lock screen back');
  assert.equal(session.playbackState, 'none');

  /* a player with its own stop (the pocket's ×) is asked to stop */
  const b = browser(); const m2 = media({ duration: 90 }); let stopped = 0;
  const h2 = b.win.MCC_NOW_PLAYING.bind(m2, { track: () => ({ title: 'Here' }), play() {}, pause() {}, previous() {}, next() {}, stop: () => { stopped++; h2.clear(); } });
  m2.play(); b.log.handlers.stop();
  assert.equal(stopped, 1, 'the player\'s own stop runs');
  assert.equal(b.session.metadata, null);
  /* seek-to without a seek of its own sets the element's second */
  const c = browser(); const m3 = media({ duration: 90 });
  c.win.MCC_NOW_PLAYING.bind(m3, { track: () => ({ title: 'Here' }), play() {}, pause() {}, previous() {}, next() {} });
  m3.play(); c.log.handlers.seekto({ seekTime: 30.5 });
  assert.equal(m3.currentTime, 30.5);
});

test('two players on one page: whichever plays owns the lock screen, and only the owner can clear it', () => {
  const { win, session } = browser();
  const a = media({ duration: 100 }), b = media({ duration: 60 });
  const ha = win.MCC_NOW_PLAYING.bind(a, { track: () => ({ title: 'Deck song' }), play() {}, pause() {}, previous() {}, next() {} });
  const hb = win.MCC_NOW_PLAYING.bind(b, { track: () => ({ title: 'Shelf preview' }), play() {}, pause() {}, previous() {}, next() {} });
  a.play();
  assert.equal(session.metadata.title, 'Deck song');
  b.play(); a.pause();
  assert.equal(session.metadata.title, 'Shelf preview', 'the second player took the lock screen');
  assert.equal(session.playbackState, 'playing', 'the first one pausing does not pause the second one\'s state');
  assert.ok(hb.owns() && !ha.owns());
  ha.clear();
  assert.equal(session.metadata.title, 'Shelf preview', 'a player that does not own the lock screen cannot clear it');
  hb.clear();
  assert.equal(session.metadata, null);
  assert.equal(win.MCC_NOW_PLAYING.bind(a, { track: () => ({ title: 'Deck song' }), play() {}, pause() {}, previous() {}, next() {} }), ha, 'binding the same element twice keeps one binding');
  /* a player bound while it already plays owns the lock screen at once */
  const c = media({ duration: 50 }); c.paused = false;
  win.MCC_NOW_PLAYING.bind(c, { track: () => ({ title: 'Already playing' }), play() {}, pause() {}, previous() {}, next() {} });
  assert.equal(session.metadata.title, 'Already playing');
  assert.equal(session.playbackState, 'playing');
});

test('cleared on stop and when a queue ends: no title left standing for a player that stopped', () => {
  const { win, log, session } = browser();
  const m = media({ duration: 100 });
  const h = win.MCC_NOW_PLAYING.bind(m, { track: () => ({ title: 'Last song' }), play() {}, pause() {}, previous() {}, next() {} });
  m.play();
  h.clear();
  assert.equal(session.metadata, null);
  assert.equal(session.playbackState, 'none');
  assert.equal(log.positions.at(-1), 'cleared', 'setPositionState() with nothing clears the scrubber');
  for (const a of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto', 'stop']) assert.equal(log.handlers[a], null, `${a} is handed back`);
  m.play();
  assert.equal(session.metadata.title, 'Last song', 'a new play takes the lock screen again');
  /* where each queue ends, the player clears: the pocket's ×, a record of one, the docket's last track,
     the embed's song, the album shelf's preview */
  const ends = {
    'js/pip.js': ['shut', 'roll'],
    'docket-516.html': null,
    'embed.html': null,
    'album.html': ['pvStop'],
  };
  for (const [f, fns] of Object.entries(ends)) {
    const code = codeOf(f);
    if (!fns) { assert.match(code, /\.clear\(\)/, `${f}: the end of its queue clears Now Playing`); continue; }
    for (const fn of fns) {
      const body = definitionsOf(code, fn).join('\n');
      assert.match(body, /\.clear\(\)/, `${f}: ${fn}() clears Now Playing where the queue ends`);
    }
  }
});

test('with no Media Session at all (an old browser) nothing throws and every player still plays', () => {
  const { win } = browser({ withSession: false });
  const m = media({ duration: 10 });
  const h = win.MCC_NOW_PLAYING.bind(m, { track: () => ({ title: 'x' }), play() {}, pause() {}, previous() {}, next() {} });
  m.play(); m.fire('timeupdate'); m.pause(); h.update(); h.clear();
  assert.ok(true);
});

for (const withSession of [true, false]) {
  test(`installed controls observe and command the existing owner (Media Session: ${withSession})`, () => {
    const { win } = browser({ withSession });
    const p = win.MCC_NOW_PLAYING, m = media(), seen = [], calls = [];
    let title = 'Here';
    const h = p.bind(m, {
      surface: 'fixture', track: () => ({ title, artist: 'Fixture artist', album: 'Fixture album' }),
      play: () => { calls.push('play'); return m.play(); },
      pause: () => { calls.push('pause'); m.pause(); },
      previous: () => calls.push('previous'), next: () => calls.push('next'),
    });
    const unsubscribe = p.subscribe(s => seen.push(s));
    assert.equal(p.snapshot(), null);
    assert.equal(p.command('play'), false, 'the dock cannot select or autoplay an unowned player');
    m.play();
    const state = p.snapshot();
    assert.equal(state.title, 'Here'); assert.equal(state.artist, 'Fixture artist');
    assert.equal(state.playing, true); assert.equal(Object.isFrozen(state), true);
    assert.deepEqual(Object.keys(state).sort(), ['album','artist','canNext','canPause','canPlay','canPrevious','playing','status','surface','title'],
      'no media element, source URL or player mutation is exposed (status: why a player is quiet, music slice M3 review)');
    assert.equal(p.command('pause'), true); assert.equal(p.snapshot().playing, false);
    assert.equal(p.command('play'), true); assert.equal(p.snapshot().playing, true);
    p.command('previous'); p.command('next');
    assert.deepEqual(calls, ['pause', 'play', 'previous', 'next']);
    assert.equal(p.command('constructor'), false); assert.equal(p.command('seekbackward'), false);
    const count = seen.length; unsubscribe(); title = 'Next song'; h.update();
    assert.equal(p.snapshot().title, title); assert.equal(seen.length, count, 'unsubscribe stops delivery');
    h.clear(); assert.equal(p.snapshot(), null); assert.equal(p.command('pause'), false);
  });
}

/* A PLAYER IN TROUBLE (music slice M3, review PB-R3 and RL-6). While a song is picked up again after a dropped read,
   the player quiets its element and tries again. The lock screen said "paused" and offered only Play, which tried at
   once, so nothing could stop the tries; and the installed app's dock, which hides the mini player, said nothing at
   all. A player may now tell the owner what the listener asked for (playing) and why it is quiet (status). */
test('a player in trouble: the lock screen and the installed app\'s dock follow what the listener asked for, and say why it is quiet', () => {
  const { win, session } = browser();
  const NP = win.MCC_NOW_PLAYING, m = media();
  let wanted = true, status = '';
  const h = NP.bind(m, { surface: 'fixture', track: () => ({ title: 'Here', artist: 'Fixture artist', album: 'Fixture album' }),
    play: () => m.play(), pause: () => m.pause(), playing: () => wanted, status: () => status });
  m.play();
  assert.equal(session.playbackState, 'playing');
  assert.equal(NP.snapshot().status, '');
  status = 'Reconnecting…';
  m.pause();                                       // the player quiets the element itself while it picks the song up again
  assert.equal(session.playbackState, 'playing', 'the listener asked for music: the lock screen offers Pause, which stops the tries');
  assert.equal(NP.snapshot().playing, true);
  assert.equal(NP.snapshot().status, 'Reconnecting…', 'the dock can say why it is quiet');
  wanted = false; status = 'Connection lost · tap play';
  h.update();
  assert.equal(session.playbackState, 'paused');
  assert.equal(NP.snapshot().playing, false);
  assert.equal(NP.snapshot().status, 'Connection lost · tap play');
  /* a player without the hooks: the element decides, as before, and there is nothing to say */
  const { win: w2, session: s2 } = browser();
  const m2 = media();
  w2.MCC_NOW_PLAYING.bind(m2, { surface: 'plain', track: () => ({ title: 'Plain' }), play: () => m2.play(), pause: () => m2.pause() });
  m2.play(); m2.pause();
  assert.equal(s2.playbackState, 'paused');
  assert.equal(w2.MCC_NOW_PLAYING.snapshot().status, '');
});

test('a subscriber can switch players without older metadata overwriting the new owner', () => {
  const { win, session } = browser(); const p = win.MCC_NOW_PLAYING;
  const a = media(), b = media();
  p.bind(a, { surface:'a', track:()=>({title:'A'}), play:()=>a.play(), pause:()=>a.pause() });
  p.bind(b, { surface:'b', track:()=>({title:'B'}), play:()=>b.play(), pause:()=>b.pause() });
  p.subscribe(s => { if (s?.surface === 'a') b.play(); });
  a.play();
  assert.equal(p.owner(), 'b'); assert.equal(p.snapshot().title, 'B');
  assert.equal(session.metadata.title, 'B'); assert.equal(session.playbackState, 'playing');
});

test('a subscriber can start the next owner during clear without its session being erased', () => {
  const { win, session, log } = browser(); const p = win.MCC_NOW_PLAYING;
  const a = media(), b = media(); let armed = false;
  const ha = p.bind(a, { surface:'a', track:()=>({title:'A'}), play:()=>a.play(), pause:()=>a.pause() });
  p.bind(b, { surface:'b', track:()=>({title:'B'}), play:()=>b.play(), pause:()=>b.pause() });
  a.play();
  p.subscribe(s => { if (armed && s === null) b.play(); });
  armed = true; ha.clear();
  assert.equal(p.owner(), 'b'); assert.equal(p.snapshot().title, 'B');
  assert.equal(session.metadata.title, 'B'); assert.equal(session.playbackState, 'playing');
  assert.equal(typeof log.handlers.pause, 'function', 'new owner retains its device controls');
  log.handlers.pause(); assert.equal(b.paused, true);
});

test('nested owner changes never deliver the old state after the replacement to later subscribers', () => {
  const { win } = browser(); const p = win.MCC_NOW_PLAYING, seen = [];
  const a = media(), b = media();
  const ha = p.bind(a, { surface:'a', track:()=>({title:'A'}), play:()=>a.play(), pause:()=>a.pause() });
  p.bind(b, { surface:'b', track:()=>({title:'B'}), play:()=>b.play(), pause:()=>b.pause() });
  p.subscribe(s => { if (s?.surface === 'a') b.play(); });
  p.subscribe(s => seen.push(s && s.title));
  a.play();
  assert.deepEqual(seen, [null, 'B']);
  a.pause(); a.fire('loadedmetadata'); ha.clear();
  assert.deepEqual(seen, [null, 'B'], 'former-owner events cannot repaint or clear the dock');
});

test('every player asks for the playback audio session before each play(), the four of slice M1 and the rest', () => {
  const players = {
    'js/gateway.js': [/\ba\.play\(/g],
    'docket-516.html': [/\baudio\.play\(/g],
    'music-videos.html': [/\bdeck\.play\(/g],
    'embed.html': [/\bdeck\.play\(/g],
  };
  for (const [file, calls] of Object.entries(players)) {
    const code = codeOf(file);
    assert.match(code, /function audioSession\(\)\s*\{[^}]*MCC_NOW_PLAYING[^}]*\.claim\(\)/, `${file}: audioSession() asks js/now-playing.js`);
    let count = 0;
    for (const re of calls) for (const m of code.matchAll(re)) {
      count++;
      const before = code.slice(0, m.index);
      const claimAt = before.lastIndexOf('audioSession()'), fnAt = Math.max(before.lastIndexOf('function '), before.lastIndexOf('function('));
      assert.ok(claimAt > -1 && claimAt > fnAt, `${file}: ${m[0]} is not preceded by audioSession() in the same function:\n${code.slice(Math.max(0, m.index - 160), m.index + 20)}`);
    }
    assert.ok(count > 0, `${file}: has play() calls to guard`);
  }
  const embed = read('embed.html');
  assert.ok(embed.indexOf('js/now-playing.js') > -1 && embed.indexOf('js/now-playing.js') < embed.indexOf('getElementById("deck")'), 'embed.html loads the helper before its player');
});

test('the right names on the lock screen: an album\'s billed artist, never its tagline, and each record\'s own album', () => {
  const engine = codeOf('js/music-engine.js');
  assert.doesNotMatch(engine, /artist:\s*a\.artist\s*\|\|\s*a\.by/, 'js/music-engine.js named the album\'s tagline as its artist ("Have no fear." for I AM HERE)');
  /* the album page: a playlist's rows carry their own record's artist and album */
  const album = codeOf('album.html');
  assert.match(album, /data-artist="/, 'album.html: each row says whose record it is');
  assert.match(album, /data-album-name="/, 'album.html: and which album it is from');
  /* the docket's release: titles, artist, album and cover as data/albums.json has them */
  const byFile = {};
  for (const a of albums()) for (const t of a.tracks) byFile[t.src] = { title: t.title, artist: a.artist || 'McCluster', album: a.name, art: a.art };
  const docket = codeOf('docket-516.html');
  const tracks = [...docket.matchAll(/\{\s*id:\s*"([^"]+)",\s*src:\s*"([^"]+)"[^}]*\}/g)];
  assert.ok(tracks.length >= 2, 'the docket names its release');
  for (const [obj, , src] of tracks) {
    const want = byFile[src];
    assert.ok(want, `${src} is on the shelf`);
    for (const k of ['title', 'artist', 'album', 'art']) {
      const got = new RegExp('(?:^|[{,\\s])' + k + ':\\s*"([^"]*)"').exec(obj);
      assert.equal(got && got[1], want[k], `docket ${src}: ${k}`);
    }
  }
  /* the embed: the visible credit and the lock screen follow the album's billing */
  const embed = codeOf('embed.html');
  /* the house's own records are McCluster's, the artist (owner, 2026-11-23: "McCluster is the artist") */
  assert.match(embed, /alb\.artist\s*\|\|\s*"McCluster"/, 'embed.html credits the album\'s billed artist');
});

test('AirPlay: a picker where WebKit offers one, hidden everywhere else', () => {
  const button = () => {
    const ls = {};
    return { hidden: true, ls, addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); }, click() { (ls.click || []).forEach(f => f({})); } };
  };
  {
    const { win } = browser();
    assert.equal(typeof win.MCC_NOW_PLAYING.airplay, 'function', 'js/now-playing.js offers the picker');
    const b = button(), m = media();
    b.hidden = false;
    assert.equal(win.MCC_NOW_PLAYING.airplay(b, m), false, 'no WebKit picker (Chrome, Firefox): nothing to offer');
    assert.equal(b.hidden, true, 'and the button stays hidden');
  }
  {
    const { win } = browser();
    win.WebKitPlaybackTargetAvailabilityEvent = function () {};
    const b = button(), m = media();
    let shown = 0;
    m.webkitShowPlaybackTargetPicker = () => { shown++; };
    /* the availability event, as WebKit sends it to the element's listeners */
    const listeners = [];
    const add = m.addEventListener;
    m.addEventListener = function (t, f) { if (t === 'webkitplaybacktargetavailabilitychanged') listeners.push(f); return add.call(this, t, f); };
    const say = availability => listeners.forEach(f => f({ type: 'webkitplaybacktargetavailabilitychanged', availability }));
    assert.equal(win.MCC_NOW_PLAYING.airplay(b, m), true, 'WebKit offers the picker');
    assert.equal(b.hidden, true, 'hidden until WebKit says a device is in range');
    assert.ok(listeners.length > 0, 'it listens for WebKit\'s availability');
    say('available');
    assert.equal(b.hidden, false, 'a device in range shows the button');
    b.click();
    assert.equal(shown, 1, 'a tap opens the AirPlay picker');
    say('not-available');
    assert.equal(b.hidden, true, 'and it goes when the device does');
    assert.equal(win.MCC_NOW_PLAYING.airplay(null, m), false, 'no button, nothing to do');
  }
  /* on every music surface where WebKit offers it */
  assert.match(codeOf('js/label.js'), /MCC_NOW_PLAYING\.airplay\(\s*beamBtn\s*,\s*deck\s*\)/, 'the album\'s Now Playing sheet');
  assert.match(codeOf('js/music-engine.js'), /MCC_NOW_PLAYING\.airplay\(/, 'the listen engine\'s Now Playing sheet');
  assert.match(codeOf('js/pip.js'), /MCC_NOW_PLAYING\.airplay\(/, 'the pocket');
  assert.match(codeOf('music-videos.html'), /MCC_NOW_PLAYING\.airplay\(/, 'the music video feed');
});

test('resume where you left off across devices: the pocket store reaches listener_state on any page that knows the member', async () => {
  const USER = '33333333-3333-4333-8333-333333333333';
  const token = 'x.' + Buffer.from(JSON.stringify({ sub: USER, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.y';
  const requests = [];
  const store = {};
  const win = {
    MCC_MUSIC: {},   /* a page with its own player (listen.html): the pocket only lends its store */
    /* the shared auth as js/mcc-auth.js offers it (slice M4): the account, and a call made with a fresh token */
    MCC: {
      session: () => ({ access_token: token }), refreshIfNeeded: () => Promise.resolve({ access_token: token }), account: () => USER,
      authFetch: (url, init = {}) => win.fetch(url, Object.assign({}, init, { headers: Object.assign({}, init.headers, { authorization: 'Bearer ' + token }) })),
    },
    document: { currentScript: { src: 'https://matthew.mccluster.org/js/pip.js?v=stamp' }, readyState: 'complete', addEventListener() {}, querySelector: () => null },
    location: { pathname: '/listen.html', href: 'https://matthew.mccluster.org/listen.html' },
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: (url, opts = {}) => {
      const h = opts.headers || {};
      requests.push({ url, method: opts.method || 'GET', auth: h.Authorization || h.authorization, body: opts.body });
      if ((opts.method || 'GET') === 'GET') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ state: { src: 'assets/audio/runway-walk.mp3', title: 'Runway Walk', album: 'here', t: 42, at: Date.now() } }]) });
      return Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) });
    },
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    setTimeout, clearTimeout,
  };
  win.window = win;
  vm.runInContext(read('js/pip.js'), vm.createContext(win));
  assert.ok(win.MCC_POCKET && typeof win.MCC_POCKET.pull === 'function', 'the pocket lends its store');
  const far = await win.MCC_POCKET.pull();
  assert.equal(far && far.title, 'Runway Walk', 'the record left on another device is read on a page without js/backend.js (listen.html)');
  assert.ok(requests.some(r => r.method === 'GET' && /\/rest\/v1\/listener_state\?profile_id=eq\.33333333-3333-4333-8333-333333333333/.test(r.url) && r.auth === 'Bearer ' + token),
    'read as the member, with the member\'s own token: ' + JSON.stringify(requests));
  win.MCC_POCKET.save({ src: 'assets/audio/here.mp3', title: 'Here', album: 'here', t: 12, playing: true, at: Date.now() }, true);
  await new Promise(r => setTimeout(r, 20));
  const post = requests.find(r => r.method === 'POST');
  assert.ok(post && /\/rest\/v1\/listener_state$/.test(post.url) && JSON.parse(post.body).state.title === 'Here' && JSON.parse(post.body).profile_id === USER,
    'and written back for the next device: ' + JSON.stringify(requests));
  /* the listen engine banks what it plays and holds the last record for the next visit; the album asks
     the shared row when this device has no seat of its own; the pocket prefers the newer device */
  const engine = codeOf('js/music-engine.js');
  assert.match(engine, /MCC_POCKET\.save\(/, 'the listen engine banks its record (local and listener_state)');
  assert.match(engine, /MCC_POCKET\.pull\(/, 'and asks for the record left on another device');
  assert.match(codeOf('album.html'), /MCC_POCKET\.pull\(/, 'the album asks the shared row too');
  /* the album's seat (its own memory, the pocket's record, the shared row) is restored once the Now
     sheet it dresses is bound: restored earlier, load() threw on the unbound film and stopped short
     of the rows, the deck, the sheet's artist and the lock screen (found by the playlist e2e) */
  const album = codeOf('album.html');
  const restore = definitionsOf(album, 'restoreSeat').join('\n');
  assert.match(restore, /MCC_POCKET\.read\(\)/, 'album.html: restoreSeat() holds the seat restore');
  const bound = album.indexOf('nowFilm = el("nowFilm")'), call = album.search(/\n\s*restoreSeat\(\);/);
  assert.ok(bound > -1 && call > bound, 'album.html: the seat is restored after the Now sheet\'s elements are bound');
  const pip = codeOf('js/pip.js');
  assert.match(pip, /pullRemote\(\)/, 'the pocket reads the shared row');
});
