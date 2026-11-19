import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

/* THE ALBUM KEEPS PLAYING WITH THE SCREEN LOCKED (music slice M1).

   Matthew, 2026-11-19: "when I'm playing music and I leave the browser, it stops
   playing music." The album room sent its deck through Web Audio
   (js/chamber.js, createMediaElementSource) for its light, and js/filament.js
   downloaded and decoded every song again in a second AudioContext for its
   waveform. WebKit restricts Web Audio in a background process unless the page
   declares a playback audio session, and no page declared one (music map 01
   PB-1, 03 EXT-1, 00 G-8). A plain <audio> element is what iOS keeps playing.

   These are the static contracts that keep it that way. The browser proof
   (every AudioContext suspended and the deck still advancing, one request per
   play, the audio session, the in-app note) is scripts/e2e/music-background.e2e.mjs.
   What an iPhone actually does is Inferred until Matthew's devices run the
   checklist (docs/music/MUSIC-RELEASE-20261119.md). */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = p => readFileSync(join(ROOT, p), 'utf8');

/* every page of the music module: the listening rooms, the artist page,
   Creator Studio and the pages around them */
const MUSIC_PAGES = ['album.html', 'listen.html', 'catalogue.html', 'music-creator.html', 'creator.html',
  'music-creator-terms.html', 'prim3-artist.html', 'music-videos.html', 'license.html', 'purchase.html'];
/* the four players this slice names: the album deck, the listen engine, the pocket
   and the World soundtrack (with the shelf's preview chips on the album page) */
const PLAYERS = {
  'album.html': [/\bdeck\.play\(/g, /\bpv\.play\(/g],
  'js/music-engine.js': [/\baudio\.play\(/g],
  'js/pip.js': [/\baudio\.play\(/g],
  'js/world-audio-continuity.js': [/\baudio\.play\(/g, /\bp\.play\(/g, /\bdeck\.play\(/g],
};

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = dir + '/' + name;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...jsFiles(rel));
    else if (/\.(?:m?js)$/.test(name)) out.push(rel);
  }
  return out;
}

/* Comments say why; only code can route a song. Strips line and block comments
   while keeping strings and regular-expression literals intact. */
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
/* the code of a file: a script as is, a page's inline scripts joined */
function codeOf(path) {
  const src = read(path);
  if (!/\.html$/.test(path)) return stripComments(src);
  const blocks = [];
  for (const m of src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc=/.test(m[1]) || /ld\+json/.test(m[1])) continue;
    blocks.push(stripComments(m[2]));
  }
  return blocks.join('\n;\n');
}
/* the balanced block that starts at code[open] === "{" (strings skipped) */
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
/* a handler and the local functions it calls, two levels down */
function expand(code, body, depth = 2) {
  const seen = new Set([body]);
  let frontier = [body];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const b of frontier) {
      for (const m of b.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (/^(?:if|for|while|switch|catch|function|return|typeof)$/.test(m[1])) continue;
        for (const def of definitionsOf(code, m[1])) if (!seen.has(def)) { seen.add(def); next.push(def); }
      }
    }
    frontier = next;
  }
  return [...seen].join('\n');
}
function lifecycleHandlers(code) {
  const found = [];
  const re = /addEventListener\(\s*(["'])(visibilitychange|pagehide|blur|freeze)\1\s*,\s*/g;
  for (const m of code.matchAll(re)) {
    const at = m.index + m[0].length, rest = code.slice(at);
    const fn = /^(?:async\s+)?function\b[^(]*\([^)]*\)\s*\{/.exec(rest) || /^(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/.exec(rest);
    if (fn) { found.push({ event: m[2], body: blockFrom(code, at + fn[0].length - 1) }); continue; }
    const arrow = /^(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*([^)]*)\)/.exec(rest);
    if (arrow) { found.push({ event: m[2], body: arrow[1] }); continue; }
    const id = /^([A-Za-z_$][\w$]*)\s*[,)]/.exec(rest);
    const defs = id ? definitionsOf(code, id[1]) : [];
    if (defs.length) { for (const body of defs) found.push({ event: m[2], body, name: id[1] }); continue; }
    found.push({ event: m[2], body: null, unresolved: rest.slice(0, 80) });
  }
  for (const m of code.matchAll(/\.on(visibilitychange|pagehide|blur|freeze)\s*=\s*/g)) {
    found.push({ event: m[1], body: null, unresolved: code.slice(m.index, m.index + 80) });
  }
  return found;
}
/* the scripts a page loads from the house (same-origin js/ only) */
function scriptsOf(page) {
  return [...read(page).matchAll(/<script\b[^>]*\bsrc="(js\/[^"?]+)/g)].map(m => m[1]);
}
function sandbox(navigatorValue) {
  const win = { navigator: navigatorValue, document: { readyState: 'loading', addEventListener() {} } };
  win.window = win;
  return vm.createContext(win);
}

test('no music element is routed through Web Audio, anywhere in js/ or on the music pages', () => {
  const hits = [];
  for (const f of [...jsFiles('js'), ...MUSIC_PAGES]) {
    if (/createMediaElementSource\s*\(/.test(codeOf(f))) hits.push(f);
  }
  assert.deepEqual(hits, [], 'iOS silences Web Audio in the background (WebKit MediaSessionManagerIOS: WebAudio, ' +
    'BackgroundProcessPlaybackRestricted); a song reaches the speaker only from a plain <audio> element');
});

test('the album room draws its light and waveform without an AudioContext and without the song', () => {
  for (const f of ['js/chamber.js', 'js/filament.js', 'js/peaks.js']) {
    assert.ok(existsSync(join(ROOT, f)), `${f} exists`);
    const code = codeOf(f);
    assert.doesNotMatch(code, /AudioContext|decodeAudioData|createAnalyser|getByteFrequencyData|MediaElementAudioSource/,
      `${f} must not open Web Audio: the light and the waveform are measured once (scripts/music-peaks.mjs)`);
  }
  assert.doesNotMatch(codeOf('js/chamber.js'), /\bfetch\s*\(/, 'chamber reads the measured light through js/peaks.js');
  assert.doesNotMatch(codeOf('js/filament.js'), /\bfetch\s*\(/, 'the waveform never downloads the song (music map G-8)');
  const peaks = codeOf('js/peaks.js');
  const fetches = [...peaks.matchAll(/\bfetch\s*\(([^)]*)/g)].map(m => m[1]);
  assert.equal(fetches.length, 1, 'js/peaks.js has one fetch');
  assert.match(fetches[0], /data\/peaks\//, 'and it reads data/peaks, never audio');
  const album = read('album.html'), tag = name => album.indexOf('<script src="js/' + name);
  assert.ok(tag('peaks.js') > -1 && tag('peaks.js') < tag('chamber.js') && tag('peaks.js') < tag('filament.js'),
    'album.html loads js/peaks.js before the light and the waveform');
  /* the room's light is the measured light at the deck's second, and it follows what is heard */
  const body = definitionsOf(codeOf('js/chamber.js'), 'bands')[0];
  assert.ok(body, 'js/chamber.js has bands()');
  const light = (deck, PEAKS) => JSON.parse(JSON.stringify(vm.runInContext('(function bands() ' + body + ')()',
    vm.createContext({ deck, PEAKS, measured: { light: 'measured' } }))));
  const asked = [];
  const PEAKS = { at: (p, t) => { asked.push([p.light, t]); return { bass: 0.9, mid: 0.6, high: 0.4 }; } };
  assert.deepEqual(light({ currentTime: 42.5, muted: false, volume: 1 }, PEAKS), { bass: 0.9, mid: 0.6, high: 0.4 });
  assert.deepEqual(asked, [['measured', 42.5]], 'read at the deck\'s current second');
  assert.deepEqual(light({ currentTime: 42.5, muted: true, volume: 1 }, PEAKS), { bass: 0, mid: 0, high: 0 }, 'muted: dark');
  assert.deepEqual(light({ currentTime: 42.5, muted: false, volume: 0 }, PEAKS), { bass: 0, mid: 0, high: 0 }, 'volume 0: dark');
});

test('js/peaks.js only ever names a public catalogue file, so a private master is never fetched for its shape', () => {
  const fetched = [];
  const win = {
    location: { href: 'https://matthew.mccluster.org/album.html?album=here', origin: 'https://matthew.mccluster.org' },
    document: { currentScript: { src: 'https://matthew.mccluster.org/js/peaks.js?v=stamp' } },
    fetch: url => { fetched.push(url); return Promise.resolve({ ok: false, json: () => Promise.resolve(null) }); },
    atob: s => Buffer.from(s, 'base64').toString('binary'), URL,
  };
  win.window = win;
  vm.runInContext(read('js/peaks.js'), vm.createContext(win));
  const P = win.MCC_PEAKS;
  assert.equal(P.keyOf('https://matthew.mccluster.org/assets/audio/Who-Did-The-Shoot.mp3'), 'who-did-the-shoot');
  assert.equal(P.keyOf('assets/audio/deep-end.m4a'), 'deep-end');
  assert.equal(P.keyOf('assets/audio/niggy-nigg-preview.mp3'), 'niggy-nigg-preview', 'the gated row\'s public preview is measured');
  for (const privateSource of [
    'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/sign/mcc-gated-audio/niggy-nigg/niggy-nigg.mp3?token=abc',
    'https://api.mccluster.org/v1/music/stream/' + 'a'.repeat(64),
    'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/creator-previews/x/y.mp3',
    'https://matthew.mccluster.org/assets/audio/../data/peaks/x.json', 'blob:https://matthew.mccluster.org/1', '',
  ]) assert.equal(P.keyOf(privateSource), null, privateSource);
  P.load('https://api.mccluster.org/v1/music/stream/' + 'a'.repeat(64));
  P.load('https://matthew.mccluster.org/assets/audio/here.mp3');
  assert.deepEqual(fetched, ['https://matthew.mccluster.org/data/peaks/here.json'], 'one file for the public song, nothing for the master');
  const quiet = P.at(null, 12);
  assert.ok(quiet.bass > 0 && quiet.bass < 0.3 && quiet.mid < quiet.bass && quiet.high < quiet.mid, 'an unmeasured record gets a quiet, even light');
  const light = { rate: 20, bass: new Uint8Array([0, 255]), mid: new Uint8Array([0, 102]), high: new Uint8Array([51, 51]) };
  const mid = P.at({ light }, 0.025);
  assert.ok(Math.abs(mid.bass - 0.5) < 1e-9 && Math.abs(mid.mid - 0.2) < 1e-9 && Math.abs(mid.high - 0.2) < 1e-9, 'read between two measures');
  assert.deepEqual(JSON.parse(JSON.stringify(P.at({ light }, 99))), { bass: 1, mid: 0.4, high: 0.2 }, 'past the end holds the last measure');
});

test('js/now-playing.js sets the playback audio session only where the browser has one', () => {
  assert.ok(existsSync(join(ROOT, 'js/now-playing.js')), 'js/now-playing.js exists');
  const src = read('js/now-playing.js');

  const none = sandbox({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/153.0 Safari/537.36' });
  vm.runInContext(src, none);
  assert.equal(none.MCC_NOW_PLAYING.claim(), false, 'no audio session API (Chrome, Firefox): nothing to set');
  assert.equal('audioSession' in none.navigator, false, 'and nothing is invented on navigator');

  const safari = sandbox({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.1 Mobile/15E148 Safari/604.1', audioSession: { type: 'auto' } });
  vm.runInContext(src, safari);
  assert.equal(safari.MCC_NOW_PLAYING.claim(), true);
  assert.equal(safari.navigator.audioSession.type, 'playback', 'iOS keeps a playback session going when the screen locks');
  assert.equal(safari.MCC_NOW_PLAYING.claim(), true, 'claiming twice is harmless');

  const recording = sandbox({ userAgent: 'x', audioSession: { type: 'play-and-record' } });
  vm.runInContext(src, recording);
  assert.equal(recording.MCC_NOW_PLAYING.claim(), false);
  assert.equal(recording.navigator.audioSession.type, 'play-and-record', 'a call or a recording keeps its session');

  const refusing = sandbox({ userAgent: 'x', audioSession: { get type() { return 'auto'; }, set type(v) { throw new Error('no'); } } });
  vm.runInContext(src, refusing);
  assert.equal(refusing.MCC_NOW_PLAYING.claim(), false, 'a refusal never throws into a play');
});

test('every player claims the playback audio session, through the one helper, before each play()', () => {
  for (const [file, calls] of Object.entries(PLAYERS)) {
    const code = codeOf(file);
    assert.match(code, /function audioSession\(\)\s*\{[^}]*MCC_NOW_PLAYING[^}]*\.claim\(\)/, `${file}: audioSession() asks js/now-playing.js`);
    assert.doesNotMatch(code, /audioSession\.type\s*=/, `${file}: only js/now-playing.js sets the session type`);
    let count = 0;
    for (const re of calls) {
      for (const m of code.matchAll(re)) {
        count++;
        const before = code.slice(0, m.index);
        const claimAt = before.lastIndexOf('audioSession()');
        const fnAt = Math.max(before.lastIndexOf('function '), before.lastIndexOf('function('));
        assert.ok(claimAt > -1 && claimAt > fnAt,
          `${file}: ${m[0]} at ${m.index} is not preceded by audioSession() in the same function:\n${code.slice(Math.max(0, m.index - 160), m.index + 20)}`);
      }
    }
    assert.ok(count > 0, `${file}: has play() calls to guard`);
  }
});

test('every page that plays music has the helper before its first play', () => {
  const order = (page, first, then) => {
    const html = read(page), a = html.indexOf(first), b = html.indexOf(then);
    assert.ok(a > -1 && b > -1 && a < b, `${page}: ${first} loads before ${then}`);
  };
  /* the album: before the inline player that calls deck.play() */
  const album = read('album.html');
  const player = album.indexOf('THE I AM HERE PLAYER');
  assert.ok(album.indexOf('js/now-playing.js') > -1 && album.indexOf('js/now-playing.js') < player, 'album.html: js/now-playing.js before the player');
  order('listen.html', 'js/now-playing.js', 'js/music-engine.js');
  order('music-creator.html', 'js/now-playing.js', 'js/music-engine.js');
  /* the game hub imports the engine by hand: the helper first */
  const hub = read('js/game-hub/shared-music.mjs');
  assert.ok(hub.indexOf("'now-playing.js'") > -1 && hub.indexOf("'now-playing.js'") < hub.indexOf("'music-engine.js'"), 'the game hub imports the helper first');
  /* the World soundtrack is loaded by the bar: its loader, run against a stand-in
     document, adds the helper first, and neither script is async, so they run in order */
  const loader = definitionsOf(codeOf('js/tabbar.js'), 'loadWorldAudio')[0] || '';
  assert.ok(loader, 'tabbar.js has loadWorldAudio');
  const added = (helperThere) => {
    const scripts = [];
    const document = { querySelector: () => null, head: { appendChild: el => scripts.push(el) },
      createElement: tag => ({ tag, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() {} }) };
    const box = vm.createContext({ document, Promise });
    box.window = box;
    if (helperThere) box.MCC_NOW_PLAYING = {};
    vm.runInContext('var ROOT = "/", worldAudioReady = null;\nfunction loadWorldAudio() ' + loader + '\nloadWorldAudio();', box);
    return JSON.parse(JSON.stringify(scripts.map(el => ({ src: String(el.src).replace(/\?.*$/, ''), async: el.async }))));
  };
  assert.deepEqual(added(false), [{ src: '/js/now-playing.js', async: false }, { src: '/js/world-audio-continuity.js', async: false }],
    'tabbar.js adds the helper before the World soundtrack, and the two run in the order they were added');
  assert.deepEqual(added(true), [{ src: '/js/world-audio-continuity.js', async: false }], 'with the helper already on the page, only the soundtrack is added');
  /* the pocket rides about fifty pages: it mounts only once the helper has run */
  const pip = codeOf('js/pip.js');
  assert.match(pip, /function withNowPlaying\(/, 'js/pip.js waits for the helper');
  for (const m of pip.matchAll(/\bbegin\((?:st|far)\)/g)) {
    const line = pip.slice(Math.max(0, m.index - 60), m.index);
    assert.match(line, /withNowPlaying\(function \(\) \{\s*$/, `the pocket mounts inside withNowPlaying: ${line}${m[0]}`);
  }
});

test('no page pauses music on visibilitychange, pagehide, blur or freeze', () => {
  /* leaving the page in view is not leaving the music: the scripts of every music page,
     the four players and their helpers. Banking a position is fine; pausing is not. */
  const files = new Set(['js/pip.js', 'js/world-audio-continuity.js', 'js/now-playing.js', 'js/peaks.js', 'js/chamber.js', 'js/filament.js', 'js/tabbar.js', 'js/music-engine.js']);
  for (const page of MUSIC_PAGES) { files.add(page); for (const s of scriptsOf(page)) files.add(s); }
  const checked = [];
  for (const f of files) {
    if (!existsSync(join(ROOT, f))) continue;
    const code = codeOf(f);
    for (const h of lifecycleHandlers(code)) {
      assert.ok(h.body !== null, `${f}: a ${h.event} handler this guard cannot read: ${h.unresolved}`);
      const all = expand(code, h.body);
      assert.doesNotMatch(all, /\.pause\s*\(|\.suspend\s*\(|\.muted\s*=\s*true|\.volume\s*=\s*0(?![.\d])/,
        `${f}: a ${h.event} handler pauses, mutes or suspends: ${h.body.slice(0, 240)}`);
      checked.push(`${f}:${h.event}`);
    }
  }
  assert.ok(checked.length >= 10, `the guard reads the handlers it should (${checked.length})`);
  assert.ok(checked.some(c => c === 'album.html:visibilitychange') && checked.some(c => c === 'js/pip.js:pagehide'), 'the players\' own banking handlers are among them');
});

test('one request per play: the album asks nothing else of a song it is playing', () => {
  const album = codeOf('album.html');
  const claim = definitionsOf(album, 'claimThenPlay')[0] || '';
  assert.ok(claim, 'claimThenPlay exists');
  assert.doesNotMatch(claim, /probeDuration\(/, 'the earned play is not probed by a second Audio (its token counts every request)');
  assert.doesNotMatch(codeOf('js/filament.js'), /\bfetch\s*\(|new Audio\(/, 'the waveform does not fetch the song');
});

test('in an in-app browser a music page says, once, where the music keeps playing with the screen locked', () => {
  const src = read('js/now-playing.js');
  const box = sandbox({ userAgent: 'x' });
  vm.runInContext(src, box);
  const inApp = box.MCC_NOW_PLAYING.inApp;
  const apps = {
    Instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.3.21.111 (iPhone15,3; iOS 17_5; en_US; en; scale=3.00; 1290x2796; 600181178)',
    'Instagram ': 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36 Instagram 331.0.0.37.90 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_US; 600181178)',
    Facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/466.0.0.47.103;FBBV/622345612;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
    'Facebook ': 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/466.0.0.48.103;]',
    Messenger: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/459.0.0.39.109;FBBV/617329611]',
    'Messenger ': 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/451.0.0.37.109;]',
    TikTok: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_34.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US',
    'TikTok ': 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 trill_340102 BytedanceWebview/d8a21c6',
    Snapchat: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.86.0.36 (like Safari/8617.2.4.10.8, panda)',
    LinkedIn: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.29.8963',
    Line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.5.0',
    X: 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 TwitterAndroid',
  };
  for (const [app, ua] of Object.entries(apps)) assert.ok(inApp(ua), `${app.trim()} in-app browser is recognised`);
  for (const ua of [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ]) assert.equal(inApp(ua), null, `a browser of its own is left alone: ${ua}`);
  /* honest, small, never a forced exit */
  assert.match(src, /To keep the music playing with your screen locked, open this page in Safari or Chrome\./);
  assert.doesNotMatch(stripComments(src), /location\.(?:href\s*=|assign|replace)|window\.open\(/, 'no forced redirect');
  assert.match(src, /sessionStorage/, 'dismissed for the session');
  /* where it shows: run the helper against a stand-in page and count the notes it adds */
  const notes = (classes, ua, framed = false) => {
    const added = [];
    const el = tag => ({ tag, className: '', textContent: '', parentNode: null, firstChild: null,
      setAttribute() {}, addEventListener() {}, appendChild(c) { c.parentNode = this; return c; },
      insertBefore(c) { added.push(c); c.parentNode = this; return c; } });
    const main = el('main');
    const document = { readyState: 'complete', head: el('head'), body: { classList: { contains: c => classes.includes(c) } },
      getElementById: () => null, createElement: el, addEventListener() {}, querySelector: sel => (sel === 'main' ? main : null) };
    const win = { navigator: { userAgent: ua }, document, sessionStorage: { getItem: () => null, setItem() {} } };
    win.window = win;
    win.top = framed ? {} : win;
    vm.runInContext(src, vm.createContext(win));
    return added.filter(n => /\bnp-hint\b/.test(n.className)).length;
  };
  const safari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
  assert.equal(notes(['songpage', 'music-room', 'music-room--album'], apps.Instagram), 1, 'the album, inside Instagram: one note');
  assert.equal(notes(['songpage', 'music-v2', 'artist-page'], apps.TikTok), 1, 'an artist page, inside TikTok: one note');
  assert.equal(notes(['songpage', 'music-room', 'music-room--album'], safari), 0, 'Safari: no note');
  assert.equal(notes(['songpage', 'music-room', 'music-room--album'], apps.Instagram, true), 0, 'never inside a frame');
  assert.equal(notes(['songpage'], apps.Instagram), 0, 'a page that is not a music page: no note');
  assert.equal(notes(['songpage', 'music-room', 'music-room--music-videos'], apps.Instagram), 0,
    'the lyric video feed plays video, which no browser keeps playing with the screen locked: the line would not be true there');
});
