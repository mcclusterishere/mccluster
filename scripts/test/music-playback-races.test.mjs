/* Exercise the real discovery transport with delayed access replies and media
   events. A previous song's work must never replace, seek or restart a newer
   choice; an intentional preview must still end at its published boundary. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

class Media extends EventTarget {
  constructor() {
    super();
    this.paused = true; this.currentTime = 0; this.duration = 180; this.readyState = 1;
    this.playCalls = 0; this.muted = false; this._src = '';
  }
  setAttribute() {}
  get src() { return this._src; }
  set src(value) { this._src = value; this.currentTime = 0; this.paused = true; }
  play() { this.playCalls++; this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { const changed = !this.paused; this.paused = true; if (changed) this.dispatchEvent(new Event('pause')); }
  fire(type) { this.dispatchEvent(new Event(type)); }
}

function engine(options = {}) {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      style: {}, classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
      setAttribute() {}, addEventListener() {}, parentNode: { appendChild() {} }
    });
    return nodes.get(id);
  }
  const document = new EventTarget();
  Object.assign(document, {
    readyState: 'loading', body: node('body'),
    getElementById: (id) => id === 'musicNow' ? null : node(id),
    querySelectorAll: () => [], createElement: () => node('created')
  });
  let gateReply = () => Promise.resolve({ state: 'preview' });
  let claims = 0;
  const gate = {
    resolve: (...args) => gateReply(...args), onChange() {}, forget() {},
    claim: async () => { claims++; return { state: 'full', url: 'earned-master.mp3' }; }
  };
  const tracks = [
    { title: 'First preview', src: 'first-preview.mp3', gated: { preview_seconds: 15 } },
    { title: 'Second preview', src: 'second-preview.mp3', gated: { preview_seconds: 20 } },
    { title: 'Full song', src: 'whole-song.mp3', seconds: 180 },
    { title: 'Next full song', src: 'next-whole-song.mp3', seconds: 180 }
  ];
  const window = new EventTarget();
  Object.assign(window, {
    document, Audio: Media, Event, CustomEvent: class extends Event {
      constructor(type, options) { super(type); this.detail = options?.detail; }
    },
    fetch: async () => {
      if (options.catalogue) await options.catalogue.promise;
      return { ok: true, json: async () => ({ albums: [{ slug: 'fixture', name: 'Fixture', tracks }] }) };
    },
    MCC_GATED: gate, setTimeout, clearTimeout, console
  });
  window.window = window;
  vm.runInContext(read('js/music-engine.js'), vm.createContext(window), { filename: 'js/music-engine.js' });
  return {
    music: window.MCC_MUSIC,
    claims: () => claims,
    reply: (fn) => { gateReply = fn; },
    play: (title) => window.MCC_MUSIC.play('fixture', title)
  };
}

test('a late access refresh cannot replace a newer song', async () => {
  const e = engine();
  await e.play('First preview');
  const pending = deferred();
  e.reply(() => pending.promise);
  e.music.refreshAccess();
  await settle();
  e.reply(() => Promise.resolve({ state: 'preview' }));
  await e.play('Second preview');
  pending.resolve({ state: 'full', url: 'old-master.mp3' });
  await settle();
  assert.equal(e.music.current().title, 'Second preview');
  assert.equal(e.music.audio.src, 'second-preview.mp3');
  assert.equal(e.music.access(), 'preview');
});

test('a superseded eligibility reply cannot spend a newly earned play', async () => {
  const e = engine();
  const pending = deferred();
  e.reply(() => pending.promise);
  const opening = e.play('First preview');
  await settle();
  await e.play('Full song');
  pending.resolve({ state: 'earned' });
  await opening;
  assert.equal(e.claims(), 0);
  assert.equal(e.music.current().title, 'Full song');
  assert.equal(e.music.audio.src, 'whole-song.mp3');
});

test('Pause cancels a pending engine open without spending it, and Resume can reopen', async () => {
  const e = engine();
  const pending = deferred();
  e.reply(() => pending.promise);
  const opening = e.play('First preview');
  await settle();
  e.music.pause();
  pending.resolve({ state: 'earned' });
  await opening;
  assert.equal(e.claims(), 0);
  assert.equal(e.music.audio.paused, true);
  assert.notEqual(e.music.access(), 'loading');
  e.reply(() => Promise.resolve({ state: 'earned' }));
  await e.music.resume();
  assert.equal(e.claims(), 1);
  assert.equal(e.music.audio.src, 'earned-master.mp3');
  assert.equal(e.music.audio.paused, false);
});

test('the first catalogue read cannot overtake a creator selection or Pause', async () => {
  for (const newer of ['creator', 'pause']) {
    const catalogue = deferred();
    const e = engine({ catalogue });
    const opening = e.play('Full song');
    if (newer === 'creator') {
      e.music.registerCreatorTrack({ id: 'creator-fixture', title: 'Creator choice', access_mode: 'public', previewUrl: 'creator-choice.mp3' });
      await e.music.playCreator('creator-fixture');
    } else e.music.pause();
    catalogue.resolve();
    await opening;
    assert.equal(e.music.current()?.title ?? null, newer === 'creator' ? 'Creator choice' : null);
    assert.equal(e.music.audio.src, newer === 'creator' ? 'creator-choice.mp3' : '');
    assert.equal(e.music.audio.paused, newer !== 'creator');
  }
});

test('a second tap on the same pending engine song keeps its original request', async () => {
  const e = engine();
  const pending = deferred();
  e.reply(() => pending.promise);
  const opening = e.play('First preview');
  await settle();
  await e.play('First preview');
  pending.resolve({ state: 'earned' });
  await opening;
  assert.equal(e.claims(), 1);
  assert.equal(e.music.access(), 'full');
  assert.equal(e.music.audio.src, 'earned-master.mp3');
  assert.equal(e.music.audio.paused, false);
});

test('a duplicate tap cannot leave Loading stuck when its active source request fails', async () => {
  const e = engine();
  const pending = deferred();
  e.reply(() => pending.promise);
  const opening = e.play('First preview');
  await settle();
  await e.play('First preview');
  const rejected = assert.rejects(opening, /source disconnected/);
  pending.reject(new Error('source disconnected'));
  await rejected;
  assert.equal(e.music.access(), 'unavailable');
  assert.equal(e.music.audio.paused, true);
});

test('metadata from a refreshed song cannot seek or restart the next selection', async () => {
  const e = engine();
  await e.play('First preview');
  e.music.audio.currentTime = 12;
  e.reply(() => Promise.resolve({ state: 'full', url: 'first-master.mp3' }));
  e.music.refreshAccess();
  await settle();
  await e.play('Full song');
  e.music.audio.currentTime = 60;
  e.music.pause();
  const plays = e.music.audio.playCalls;
  e.music.audio.fire('loadedmetadata');
  assert.equal(e.music.audio.currentTime, 60);
  assert.equal(e.music.audio.paused, true);
  assert.equal(e.music.audio.playCalls, plays);
});

test('pausing while access or metadata is pending remains paused', async () => {
  for (const pauseAt of ['access', 'metadata']) {
    const e = engine();
    await e.play('First preview');
    const pending = deferred();
    e.reply(() => pending.promise);
    e.music.refreshAccess();
    await settle();
    if (pauseAt === 'access') e.music.pause();
    pending.resolve({ state: 'full', url: 'first-master.mp3' });
    await settle();
    if (pauseAt === 'metadata') e.music.pause();
    const plays = e.music.audio.playCalls;
    e.music.audio.fire('loadedmetadata');
    assert.equal(e.music.audio.paused, true, pauseAt);
    assert.equal(e.music.audio.playCalls, plays, pauseAt);
  }
});

test('a full song has no preview cutoff and advances only at its media end', async () => {
  const e = engine();
  await e.play('Full song');
  e.music.audio.currentTime = 120;
  e.music.audio.fire('timeupdate');
  assert.equal(e.music.audio.paused, false);
  assert.equal(e.music.current().title, 'Full song');
  e.music.audio.fire('ended');
  await settle();
  assert.equal(e.music.current().title, 'Next full song');
  assert.equal(e.music.audio.src, 'next-whole-song.mp3');
  assert.equal(e.music.audio.paused, false);
});

test('a gated preview stops at its boundary and does not advance the queue', async () => {
  const e = engine();
  await e.play('First preview');
  e.music.audio.currentTime = 16;
  e.music.audio.fire('timeupdate');
  assert.equal(e.music.audio.paused, true);
  assert.equal(e.music.audio.currentTime, 14.95);
  e.music.audio.fire('ended');
  await settle();
  assert.equal(e.music.current().title, 'First preview');
  assert.equal(e.music.audio.src, 'first-preview.mp3');
});

/* The album is an inline player. Run its actual load/play/claim functions and
   ended handler, with presentation helpers and the API at explicit boundaries. */
function album() {
  const source = read('album.html');
  const begin = source.indexOf('    function load(i, at) {');
  const end = source.indexOf('    /* The one play is over', begin);
  const ended = source.indexOf('    deck.addEventListener("ended", function () {');
  const bank = source.indexOf('    /* ============================================================\n       BANKING', ended);
  const seek = source.indexOf('    function seekFeedback(message) {');
  const seekEnd = source.indexOf('    ["seek", "nowSeek"].forEach', seek);
  assert.ok(begin >= 0 && end > begin && ended > end && bank > ended);
  const attrs = (entries) => ({
    values: { ...entries },
    getAttribute(k) { return this.values[k] ?? null; },
    hasAttribute(k) { return k in this.values; },
    setAttribute(k, v) { this.values[k] = v; },
    removeAttribute(k) { delete this.values[k]; },
    querySelector() { return null; }
  });
  const rows = [
    attrs({ 'data-title': 'First song', 'data-src': 'first.mp3', 'data-key': 'first' }),
    attrs({ 'data-title': 'Earned song', 'data-src': 'preview.mp3', 'data-key': 'earned', 'data-gated-bucket': 'private', 'data-gate': 'earned' }),
    attrs({ 'data-title': 'Chosen song', 'data-src': 'chosen.mp3', 'data-key': 'chosen' })
  ];
  const deck = new Media();
  deck.src = 'first.mp3'; deck.paused = false;
  const claim = deferred(), finish = deferred();
  let claims = 0;
  const context = {
    rows, deck, Promise, console, ALBUM: 'fixture', ARTIST: 'Fixture artist', LIC_SLUG: {},
    document: {
      documentElement: { style: { setProperty() {} } },
      querySelector: () => attrs({}), getElementById: () => attrs({})
    },
    window: {
      MCC_GATED: { signedIn: () => true, claim: () => { claims++; return claim.promise; } },
      MCC_LISTENS: { finish: () => finish.promise, release() {} }
    },
    audioSession() {}, spend() {}, media() {}, paintRows() {}, paintDeck() {},
    loadReel() {}, setRoom() {}, loadLyrics() {},
    el: () => attrs({}), granted: () => false,
    gateSpec: (row) => row.getAttribute('data-key'),
    paintGate: (row, out) => row.setAttribute('data-gate', out.state)
  };
  const script = 'var cur = 0, listen = null, grantMax = 0, songTest = null;\n' +
    source.slice(begin, end) + '\n' + source.slice(ended, bank) + '\n' +
    source.match(/window\.MCC_NP_PAUSE = function \(\) \{[^\n]+/)[0] + '\n' +
    source.match(/function next\(\) \{[^\n]+/)[0] + '\n' +
    source.match(/function prev\(\) \{[^\n]+/)[0] + '\n' + source.slice(seek, seekEnd) + '\n' +
    'this.player = { play: play, pause: window.MCC_NP_PAUSE, previous: prev, seek: function (t) { seekDeck(null, t / deck.duration); }, current: function () { return cur; }, ' +
    'count: function () { listen = { row: rows[cur], handle: "listen-fixture" }; } };';
  vm.runInContext(script, vm.createContext(context), { filename: 'album.html playback' });
  return { ...context.player, deck, claim, finish, claims: () => claims };
}

test('a slow earned-play reply does not interrupt a newer album selection', async () => {
  const a = album();
  a.play(1);
  a.play(2);
  a.claim.resolve({ state: 'full', url: 'earned-master.mp3' });
  await settle();
  assert.equal(a.current(), 2);
  assert.equal(a.deck.src, 'chosen.mp3');
  assert.equal(a.deck.paused, false);
});

test('repeated taps while an earned play opens spend only one claim', async () => {
  const a = album();
  a.play(1);
  a.play(1);
  assert.equal(a.claims(), 1);
  a.claim.resolve({ state: 'full', url: 'earned-master.mp3' });
  await settle();
  assert.equal(a.current(), 1);
  assert.equal(a.deck.src, 'earned-master.mp3');
});

test('pausing an album while its claim is pending does not restart it later', async () => {
  const a = album();
  a.play(1);
  a.pause();
  a.claim.resolve({ state: 'full', url: 'earned-master.mp3' });
  await settle();
  assert.equal(a.deck.paused, true);
  assert.equal(a.deck.src, 'first.mp3');
});

test('an album automatic-next wait cannot overtake a manual song selection', async () => {
  const a = album();
  a.count();
  a.deck.fire('ended');
  a.play(2);
  a.finish.resolve({ counted: true });
  a.claim.resolve({ state: 'full', url: 'earned-master.mp3' });
  await settle();
  assert.equal(a.claims(), 0);
  assert.equal(a.current(), 2);
  assert.equal(a.deck.src, 'chosen.mp3');
});

test('Previous during an album automatic-next wait keeps the rewound song selected', async () => {
  const a = album();
  a.deck.currentTime = 180;
  a.count();
  a.deck.fire('ended');
  a.previous();
  a.finish.resolve({ counted: true });
  a.claim.resolve({ state: 'full', url: 'earned-master.mp3' });
  await settle();
  assert.equal(a.claims(), 0);
  assert.equal(a.current(), 0);
  assert.equal(a.deck.src, 'first.mp3');
  assert.equal(a.deck.currentTime, 0);
});

test('a deliberate album seek cancels an old pending next-track claim', async () => {
  const a = album();
  a.play(1);
  a.seek(45);
  a.claim.resolve({ state: 'full', url: 'earned-master.mp3' });
  await settle();
  assert.equal(a.current(), 0);
  assert.equal(a.deck.src, 'first.mp3');
  assert.equal(a.deck.currentTime, 45);
});
