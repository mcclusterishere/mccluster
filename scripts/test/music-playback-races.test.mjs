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
    this.playCalls = 0; this.muted = false; this._src = ''; this.error = null; this.loads = [];
  }
  setAttribute() {}
  get src() { return this._src; }
  set src(value) { this._src = value; this.currentTime = 0; this.paused = true; this.error = null; this.loads.push(value); }
  load() {}
  play() { this.playCalls++; this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { const changed = !this.paused; this.paused = true; if (changed) this.dispatchEvent(new Event('pause')); }
  fire(type) { this.dispatchEvent(new Event(type)); }
  /* a delivery failure as the browser reports it: an error, with the element left as it was (Chromium leaves
     a detached Audio "playing" over silence, lane 02 T6b) */
  fail(code = 2) { this.error = { code }; this.dispatchEvent(new Event('error')); }
  /* the same failure on an element in the page: Chromium pauses it itself, error first and then pause */
  failInPage(code = 2) { this.error = { code }; const was = this.paused; this.paused = true; this.dispatchEvent(new Event('error')); if (!was) this.dispatchEvent(new Event('pause')); }
}

/* A clock the tests move by hand: backoff, expiry and stalls without waiting for them. */
function clockOf() {
  let now = Date.parse('2026-11-23T03:00:00Z'), id = 0;
  const due = new Map();
  class FakeDate extends Date {
    constructor(...a) { super(...(a.length ? a : [now])); }
    static now() { return now; }
  }
  return {
    Date: FakeDate,
    now: () => now,
    setTimeout: (fn, ms = 0) => { const k = ++id; due.set(k, { at: now + Math.max(0, Number(ms) || 0), fn }); return k; },
    clearTimeout: (k) => { due.delete(k); },
    pending: () => [...due.values()].map((t) => t.at - now).sort((a, b) => a - b),
    async tick(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [k, t] of due) if (t.at <= end && (!next || t.at < next[1].at)) next = [k, t];
        if (!next) break;
        due.delete(next[0]); now = next[1].at; next[1].fn();
        await settle();
      }
      now = end; await settle();
    }
  };
}
async function until(clock, cond, step = 100, max = 120000) {
  let waited = 0;
  while (!cond() && waited < max) { await clock.tick(step); waited += step; }
  return waited;
}

function engine(options = {}) {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      const attrs = {};
      nodes.set(id, {
        id, style: {}, hidden: false, textContent: '', innerHTML: '',
        classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
        setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
        addEventListener() {}, parentNode: { appendChild() {} }
      });
    }
    return nodes.get(id);
  }
  const document = new EventTarget();
  Object.assign(document, {
    readyState: 'loading', body: node('body'),
    getElementById: (id) => id === 'musicNow' ? null : node(id),
    querySelectorAll: () => [], createElement: () => node('created')
  });
  let gateReply = () => Promise.resolve({ state: 'preview' });
  let claims = 0, claimAnswer = options.claim || (() => ({ state: 'full', url: 'earned-master.mp3' }));
  const gate = {
    resolve: (...args) => gateReply(...args), onChange() {}, forget() {},
    claim: async () => { claims++; return claimAnswer(); }
  };
  let accessCalls = 0;
  const events = [];
  /* js/now-playing.js, stood in: what the engine binds is what the lock screen and the installed app's dock read */
  const np = { spec: null, updates: 0 };
  const tracks = [
    { title: 'First preview', src: 'first-preview.mp3', gated: { preview_seconds: 15 } },
    { title: 'Second preview', src: 'second-preview.mp3', gated: { preview_seconds: 20 } },
    { title: 'Full song', src: 'whole-song.mp3', seconds: 180 },
    { title: 'Next full song', src: 'next-whole-song.mp3', seconds: 180 }
  ];
  const window = new EventTarget();
  const clock = options.clock;
  Object.assign(window, {
    document, Audio: Media, Event, CustomEvent: class extends Event {
      constructor(type, options) { super(type); this.detail = options?.detail; }
    },
    fetch: async (url, init = {}) => {
      if (/\/functions\/v1\/music-access$/.test(String(url))) {
        accessCalls++;
        const a = await options.access(JSON.parse(init.body || '{}'));
        if (a instanceof Error) throw a;
        if (a.status) return { ok: false, status: a.status, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => ({ ok: true, state: 'full', ...a }) };
      }
      if (options.catalogue) await options.catalogue.promise;
      return { ok: true, json: async () => ({ albums: [{ slug: 'fixture', name: 'Fixture', tracks }] }) };
    },
    MCC_GATED: gate, console,
    MCC_TRACK: (name, props) => events.push({ name, ...props }),
    MCC_NOW_PLAYING: { claim() {}, airplay() {}, bind: (media, spec) => { np.spec = spec; return { update() { np.updates++; }, clear() {}, owns: () => true, media }; } },
    setTimeout: clock ? clock.setTimeout : setTimeout, clearTimeout: clock ? clock.clearTimeout : clearTimeout
  });
  if (clock) window.Date = clock.Date;
  if (options.member) window.MCC = { session: () => ({ access_token: 'fixture-token' }) };
  if (options.listens) window.MCC_LISTENS = options.listens;
  /* the page the engine runs on (the bar's middle button is its transport on the listen page only), and the pocket's
     record left on this device (js/pip.js), when a test needs them */
  if (options.path) window.location = { pathname: options.path, origin: 'https://fixture.invalid', href: 'https://fixture.invalid' + options.path };
  if (options.pocket) window.MCC_POCKET = options.pocket;
  window.window = window;
  vm.runInContext(read('js/music-engine.js'), vm.createContext(window), { filename: 'js/music-engine.js' });
  return {
    music: window.MCC_MUSIC,
    np: () => np,
    claims: () => claims,
    accessCalls: () => accessCalls,
    events,
    claimWith: (fn) => { claimAnswer = fn; },
    reply: (fn) => { gateReply = fn; },
    play: (title) => window.MCC_MUSIC.play('fixture', title),
    text: (id) => node(id).textContent,
    shown: (id) => !node(id).hidden,
    attr: (id, k) => node(id).getAttribute(k),
    win: window
  };
}

/* the listen ledger as the engine and the album call it (js/listen-ledger.js), recorded */
function ledgerOf() {
  const L = { starts: [], finishes: [], releases: [] };
  Object.assign(L, {
    keyOf: (t) => String(t && t.src || ''),
    start: (k) => { L.starts.push(k); return { k }; },
    adopt: () => null,
    finish: (h) => { L.finishes.push(h && h.k); return Promise.resolve({ counted: true }); },
    release: (h) => { L.releases.push(h && h.k); },
    onFinish() {}
  });
  return L;
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
  e.music.audio.currentTime = 180;                 // its media end (an "end" well short of it is a cut-off delivery, music slice M3)
  e.music.audio.fire('ended');
  await settle();
  assert.equal(e.music.current().title, 'Next full song');
  assert.equal(e.music.audio.src, 'next-whole-song.mp3');
  assert.equal(e.music.audio.paused, false);
});

/* A LOCKED PREVIEW NEVER STOPS THE QUEUE (music slice M3; lane 01 probe S2b, PB-4; decision D-11's default).
   The preview still ends at its declared boundary: it is never played past it. Then the queue moves on, with
   one short line that says what happened. (The engine used to pause there and wait.) */
test('a locked preview plays to its boundary and the queue moves on, with a short honest line', async () => {
  const e = engine();
  await e.play('First preview');
  const heard = [];
  e.music.audio.addEventListener('pause', () => heard.push(e.music.audio.currentTime));
  e.music.audio.currentTime = 16;
  e.music.audio.fire('timeupdate');
  await settle();
  assert.equal(heard[0], 16, 'it was stopped the moment it reached the boundary');
  assert.ok(e.events.some((x) => x.name === 'music_preview_complete' && x.preview_seconds === 15), 'the boundary is the declared 15 s');
  assert.equal(e.music.current().title, 'Second preview', 'the queue moved on');
  assert.equal(e.music.audio.src, 'second-preview.mp3');
  assert.equal(e.music.audio.paused, false);
  assert.match(e.text('musicMiniNote'), /^That was the preview of First preview\./);
  assert.equal(e.shown('musicMiniNote'), true);
});

/* ------------------------------------------------------------------------------------------------------
   DELIVERY (music slice M3). A song that stops on the way says so, never shows playing over silence, and
   picks up at the second it stopped, through the resolver that opened it, with bounded backoff. A newer
   song or Pause always wins over a pending retry, failed delivery is never counted as a finished song,
   and an earned play that lapsed or whose answer was lost is never claimed again by itself.
   ------------------------------------------------------------------------------------------------------ */
test('public path: a dropped connection pauses honestly, says so, and picks up at the same second', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  e.music.audio.currentTime = 60;
  const loads = e.music.audio.loads.length;
  e.music.audio.fail(2);
  assert.equal(e.music.audio.paused, true, 'the element itself is quiet');
  /* the listener asked for music and it is being picked up: the one button is Pause, which stops the tries
     (review PB-R3; it offered only Play, and Play tried again at once) */
  assert.equal(e.attr('musicMiniPlay', 'aria-label'), 'Pause');
  assert.equal(e.text('musicMiniAccess'), 'Reconnecting…');
  assert.match(e.text('musicMiniNote'), /connection dropped.*1:00/i);
  await c.tick(500);
  assert.equal(e.music.audio.loads.length, loads + 1, 'one retry, after a short wait');
  assert.equal(e.music.audio.src, 'whole-song.mp3', 'the same file');
  assert.equal(e.music.audio.currentTime, 60, 'resumed at the interrupted second (a ranged read from there)');
  assert.equal(e.music.audio.paused, false);
  e.music.audio.fire('playing');
  assert.equal(e.text('musicMiniAccess'), 'Full track');
  assert.equal(e.shown('musicMiniNote'), false);
});

/* THE TRIES FIT THE TEN SECONDS (review PB-R1). WebKit keeps a page awake for 10 s after its sound stops
   (WebPageProxy audibleActivityClearDelay) and lets a hidden page start its sound again without a tap only within
   10 s of it stopping (MediaElementSession's grace period); what an iPhone does is Inferred. The tries used to wait
   0.5, 1.5, 3.5 and 7.5 s one after another, so the fourth started 13 s after the sound stopped. They are timed from
   that moment now: 0.5, 1.5, 3, 5.5 and 8.5 s. */
test('every try starts inside the ten seconds after the sound stopped, then it stops, says so, and Play picks up where it stopped', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  e.music.audio.currentTime = 75;
  const t0 = c.now();
  e.music.audio.fail(2);                           // the sound stopped here
  const starts = [];
  for (let i = 0; i < 5; i++) {
    const before = e.music.audio.loads.length;
    await until(c, () => e.music.audio.loads.length > before, 50, 20000);
    starts.push(c.now() - t0);
    assert.equal(e.music.audio.currentTime, 75, 'each try reads from the second it stopped');
    e.music.audio.fail(2);                         // the network is still down
  }
  assert.deepEqual(starts, [500, 1500, 3000, 5500, 8500], 'timed from the moment the sound stopped');
  assert.ok(starts.every((ms) => ms < 9000), 'all inside the ten seconds');
  const loads = e.music.audio.loads.length;
  await c.tick(120000);
  assert.equal(e.music.audio.loads.length, loads, 'no sixth try by itself');
  assert.equal(e.music.audio.paused, true);
  assert.equal(e.text('musicMiniAccess'), 'Connection lost');
  assert.match(e.text('musicMiniNote'), /Tap play to pick up at 1:15/);
  assert.equal(e.attr('musicMiniPlay', 'aria-label'), 'Play', 'given up: the one button is Play again');
  await e.music.resume();
  await settle();
  assert.equal(e.music.audio.loads.length, loads + 1, 'Play tries again at once');
  assert.equal(e.music.audio.currentTime, 75);
  assert.equal(e.music.audio.paused, false);
});

test('a read that never answers is noticed within four seconds of the silence, and each try that hangs gives way to the next on time', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  e.music.audio.currentTime = 30; e.music.audio.fire('playing');
  e.music.audio.currentTime = 31; e.music.audio.fire('timeupdate');   // it was heard
  const t0 = c.now();
  e.music.audio.fire('waiting');                   // the sound stops: the read under it hangs, and so does every try's
  const starts = [], seen = {};
  while (c.now() - t0 < 12000) {
    const n = e.music.audio.loads.length;
    await c.tick(50);
    const dt = c.now() - t0;
    if (e.music.audio.loads.length > n) starts.push(dt);
    if (dt === 1700) seen.at1700 = e.text('musicMiniAccess');
    if (dt === 4100) seen.at4100 = { label: e.text('musicMiniAccess'), note: e.text('musicMiniNote'), button: e.attr('musicMiniPlay', 'aria-label') };
  }
  assert.equal(seen.at1700, 'Loading…', 'a short wait just says Loading');
  assert.deepEqual(seen.at4100, { label: 'Reconnecting…', note: 'The connection dropped at 0:31. Picking up there…', button: 'Pause' },
    'four seconds of silence: picked up again, and said');
  assert.deepEqual(starts, [4000, 5500, 8500], 'a try that hangs gives way to the next on time, all inside the ten seconds');
  assert.equal(e.text('musicMiniAccess'), 'Connection lost', 'after the last try, said (by 11.5 s)');
  assert.match(e.text('musicMiniNote'), /Tap play to pick up at 0:31/);
  assert.equal(e.music.audio.currentTime, 31);
});

test('after a failed read, a try whose read never answers is followed by the next one on time', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  e.music.audio.currentTime = 50;
  const t0 = c.now();
  e.music.audio.fail(2);
  const starts = [];
  while (c.now() - t0 < 12000) {
    const n = e.music.audio.loads.length;
    await c.tick(50);
    if (e.music.audio.loads.length > n) starts.push(c.now() - t0);   // no answer, no error: each read hangs
  }
  assert.deepEqual(starts, [500, 1500, 3000, 5500, 8500]);
  assert.equal(e.text('musicMiniAccess'), 'Connection lost');
  assert.match(e.text('musicMiniNote'), /Tap play to pick up at 0:50/);
});

test('Pause or a newer song during a pending retry wins', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  e.music.audio.currentTime = 30;
  e.music.audio.fail(2);
  e.music.pause();
  const loads = e.music.audio.loads.length, plays = e.music.audio.playCalls;
  await c.tick(20000);
  assert.equal(e.music.audio.loads.length, loads, 'a paused song is not reloaded behind the listener');
  assert.equal(e.music.audio.playCalls, plays);
  assert.equal(e.music.audio.paused, true);

  const fclock = clockOf();
  const f = engine({ clock: fclock });
  const fc = f.music;
  await f.play('Full song');
  fc.audio.currentTime = 30;
  fc.audio.fail(2);
  await f.play('Next full song');
  await settle();
  const after = fc.audio.loads.slice();
  await fclock.tick(20000);
  assert.equal(fc.current().title, 'Next full song');
  assert.equal(fc.audio.src, 'next-whole-song.mp3');
  assert.deepEqual(fc.audio.loads, after, 'the old song is never reloaded over the new one');
});

test('a failed delivery is never counted as a finished song; a song that ends short of its length is an interruption', async () => {
  const c = clockOf(), L = ledgerOf();
  const e = engine({ clock: c, listens: L });
  await e.play('Full song');
  assert.deepEqual(L.starts, ['whole-song.mp3']);
  e.music.audio.currentTime = 20;
  e.music.audio.fire('ended');                     // the stream stopped at 0:20 of a 3:00 song
  await settle();
  assert.deepEqual(L.finishes, [], 'not finished');
  assert.equal(e.music.current().title, 'Full song', 'not moved on as if it had ended');
  assert.ok(!e.events.some((x) => x.name === 'music_complete'));
  await c.tick(500);
  assert.equal(e.music.audio.currentTime, 20, 'picked up at 0:20');
  for (let i = 0; i < 5; i++) { e.music.audio.fail(2); await c.tick(8000); }
  assert.deepEqual(L.finishes, [], 'giving up is not finishing either');
  /* the same song heard to its end counts once */
  await e.music.resume(); await settle();
  e.music.audio.currentTime = 179.9;
  e.music.audio.fire('ended');
  await settle();
  assert.deepEqual(L.finishes, ['whole-song.mp3']);
});

test('slow reads: a stall says Loading after a moment, and a stall that never moves picks up again at the same second', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  e.music.audio.currentTime = 30;
  e.music.audio.fire('waiting');
  await c.tick(400);
  assert.equal(e.text('musicMiniAccess'), 'Full track', 'a short wait is not announced');
  await c.tick(1300);
  assert.equal(e.text('musicMiniAccess'), 'Loading…');
  e.music.audio.currentTime = 31; e.music.audio.fire('timeupdate'); e.music.audio.fire('playing');
  assert.equal(e.text('musicMiniAccess'), 'Full track', 'the music caught up');
  e.music.audio.fire('waiting');
  const loads = e.music.audio.loads.length;
  await c.tick(4100);                              // four seconds of silence once the song has been heard (review PB-R1; it was 12)
  assert.equal(e.text('musicMiniAccess'), 'Reconnecting…', 'a stall that never moves is said, not shown as playing');
  assert.equal(e.music.audio.loads.length, loads + 1, 'picked up again at once: the read under it is not coming');
  assert.equal(e.music.audio.currentTime, 31);
});

test('entitled creator path: the expiry is kept, the URL is signed again before it lapses, and an expired URL resumes at the same second', async () => {
  const c = clockOf();
  const answers = [{ url: 'creator-1.mp3', expires_in: 3600 }, { url: 'creator-2.mp3', expires_in: 3600 }, { url: 'creator-3.mp3', expires_in: 3600 }];
  const e = engine({ clock: c, member: true, access: () => answers.shift() });
  e.music.registerCreatorTrack({ id: 'c1', title: 'Creator song', access_mode: 'account', previewUrl: 'creator-preview.mp3' });
  await e.music.playCreator('c1');
  assert.equal(e.music.audio.src, 'creator-1.mp3');
  assert.equal(e.accessCalls(), 1);
  await c.tick(3500 * 1000);
  assert.equal(e.accessCalls(), 1, 'not before its time');
  await c.tick(60 * 1000);
  assert.equal(e.accessCalls(), 2, 'signed again about a minute before it lapses, through the same entitlement check');
  assert.equal(e.music.audio.src, 'creator-1.mp3', 'a playing song is not cut to swap it');
  e.music.audio.currentTime = 95;
  await c.tick(120 * 1000);                        // the first URL has lapsed and the browser's next read is refused
  e.music.audio.fail(4);
  await c.tick(600);
  assert.equal(e.music.audio.src, 'creator-2.mp3', 'the fresh URL was ready');
  assert.equal(e.music.audio.currentTime, 95);
  assert.equal(e.accessCalls(), 2, 'no wait on the network at the moment it mattered');
  /* paused past a lapse: the swap happens quietly, and Play plays the fresh URL at the same second */
  e.music.audio.fire('playing');
  e.music.pause();
  e.music.audio.currentTime = 140;
  await c.tick(3600 * 1000);
  assert.equal(e.music.audio.src, 'creator-3.mp3', 'a paused song takes the fresh URL at once');
  assert.equal(e.music.audio.currentTime, 140);
  assert.equal(e.music.audio.paused, true, 'and stays paused');
});

test('entitled creator path: an expired URL with nothing fresh is signed again through the resolver, or says so when access ended', async () => {
  const c = clockOf();
  const answers = [{ url: 'creator-1.mp3', expires_in: 120 }, new Error('offline'), { url: 'creator-2.mp3', expires_in: 120 }];
  const e = engine({ clock: c, member: true, access: () => answers.length ? answers.shift() : { status: 402 } });
  e.music.registerCreatorTrack({ id: 'c1', title: 'Creator song', access_mode: 'purchase', previewUrl: 'creator-preview.mp3', preview_seconds: 30 });
  await e.music.playCreator('c1');
  await c.tick(61 * 1000);                         // the refresh before the lapse fails (offline)
  assert.equal(e.accessCalls(), 2);
  e.music.audio.currentTime = 70;
  await c.tick(70 * 1000);
  e.music.audio.fail(4);
  await c.tick(600);
  assert.equal(e.accessCalls(), 3, 'asked again through the same resolver');
  assert.equal(e.music.audio.src, 'creator-2.mp3');
  assert.equal(e.music.audio.currentTime, 70);
  e.music.audio.fire('playing');
  await c.tick(130 * 1000);                        // lapsed again; the purchase is no longer good (402)
  e.music.audio.fail(4);
  await c.tick(10000);
  assert.equal(e.music.access(), 'preview', 'the entitlement check decides: the preview, labelled as one');
  assert.equal(e.music.audio.src, 'creator-preview.mp3');
});

/* ONLY THE ENTITLEMENT CHECK'S OWN NO ENDS A FULL SONG (the review of PR #825, js/music-engine.js sourceAgain). A creator's
   URL signed again on the way is asked of music-access; a request that never reached it comes back from
   creatorSourceFor() as the preview with reason "network", and it was taken for a refusal: an entitled member, offline
   for a moment, heard the full song swapped for its 30-second preview at 0:00, was told the song was no longer open to
   their account, and nothing asked again. A member 70 s into an account release whose 120 s URL has lapsed (the
   refresh a minute before the lapse failed too), and the next read fails: */
const CREATOR_SONG = { id: 'c1', title: 'Creator song', access_mode: 'account', previewUrl: 'creator-preview.mp3', preview_seconds: 30 };
async function lapsedMidSong(c, answer) {
  let n = 0;
  const e = engine({ clock: c, member: true, access: (body) => (++n === 1 ? { url: 'creator-1.mp3', expires_in: 120 } : answer(n, body)) });
  e.music.registerCreatorTrack(CREATOR_SONG);
  await e.music.playCreator('c1');
  await c.tick(61 * 1000);                         // the refresh a minute before the lapse: offline too, left to the next read
  e.music.audio.currentTime = 70;
  await c.tick(70 * 1000);                         // the 120 s URL has lapsed
  e.music.audio.fail(2);                           // and the next read fails, at 1:10
  return e;
}

test('entitled creator path: a renewal that never reached music-access, or came back with nothing to play, is a failed try: the full song picks up at its second', async (t) => {
  for (const [why, miss] of [
    ['the request never reached music-access (offline)', () => new Error('offline')],
    ['music-access failed (HTTP 503)', () => ({ status: 503 })],
    ['an answer with no address', () => ({ url: '' })]
  ]) await t.test(why, async () => {
    const c = clockOf();
    let online = false;
    const e = await lapsedMidSong(c, (n) => (n === 2 ? new Error('offline') : online ? { url: 'creator-2.mp3', expires_in: 3600 } : miss()));
    await c.tick(600);                             // the first try signs it again, and misses
    assert.equal(e.accessCalls(), 3, why);
    assert.equal(e.music.access(), 'full', `${why}: still the member's full song (it became its preview)`);
    assert.equal(e.music.audio.src, 'creator-1.mp3', `${why}: no preview loaded`);
    assert.equal(e.music.delivery().state, 'reconnecting', `${why}: still being picked up`);
    assert.equal(e.music.delivery().at, 70, `${why}: at the second it stopped`);
    assert.equal(e.music.delivery().path, 'creator', `${why}: through the release's own resolver`);
    assert.equal(e.text('musicMiniAccess'), 'Reconnecting…', why);
    assert.equal(e.text('musicMiniNote'), 'The connection dropped at 1:10. Picking up there…', `${why}: no word about the account`);
    assert.equal(e.attr('musicMiniPlay', 'aria-label'), 'Pause', `${why}: its Pause stops the tries`);
    online = true;                                 // the network is back before the tries run out
    await c.tick(1000);                            // the next try asks music-access again
    assert.equal(e.accessCalls(), 4, `${why}: asked again`);
    assert.equal(e.music.access(), 'full', why);
    assert.equal(e.music.audio.src, 'creator-2.mp3', `${why}: the full song, signed again`);
    assert.equal(e.music.audio.currentTime, 70, `${why}: at the same second`);
    assert.equal(e.music.audio.paused, false, why);
  });
  /* offline through every try: it says so at 1:10, and Play asks music-access again and picks the full song up there */
  const c = clockOf();
  let online = false;
  const e = await lapsedMidSong(c, () => (online ? { url: 'creator-2.mp3', expires_in: 3600 } : new Error('offline')));
  await c.tick(15000);
  assert.equal(e.music.delivery().state, 'lost');
  assert.equal(e.music.access(), 'full');
  assert.equal(e.text('musicMiniAccess'), 'Connection lost');
  assert.equal(e.text('musicMiniNote'), 'The connection dropped. Tap play to pick up at 1:10.');
  assert.equal(e.music.audio.src, 'creator-1.mp3', 'the preview was never loaded');
  online = true;
  const calls = e.accessCalls();
  await e.music.resume(); await settle(); await settle();
  assert.equal(e.accessCalls(), calls + 1, 'Play asks music-access again');
  assert.equal(e.music.audio.src, 'creator-2.mp3');
  assert.equal(e.music.audio.currentTime, 70);
  assert.equal(e.music.access(), 'full');
  assert.equal(e.music.audio.paused, false);
});

test('entitled creator path: the entitlement check\'s own no (402, 403, 401) still gives the preview, labelled, with its note', async (t) => {
  for (const status of [402, 403, 401]) await t.test(`HTTP ${status}`, async () => {
    const c = clockOf();
    const e = await lapsedMidSong(c, (n) => (n === 2 ? new Error('offline') : { status }));
    await c.tick(600);
    assert.equal(e.music.access(), 'preview', 'the server decides');
    assert.equal(e.music.audio.src, 'creator-preview.mp3');
    assert.equal(e.music.audio.currentTime, 0);
    assert.equal(e.music.audio.paused, false, 'the listener asked for music: the preview plays');
    assert.equal(e.music.delivery().state, '');
    assert.equal(e.text('musicMiniAccess'), 'Preview');
    assert.equal(e.text('musicMiniNote'), 'The full song is not open to this account any more. Playing its preview.');
  });
});

test('entitled creator path: a refusal that comes after the listener pressed Pause starts nothing (Pause wins); Play asks again', async () => {
  const c = clockOf(), late = deferred();
  const e = await lapsedMidSong(c, (n) => (n === 2 ? new Error('offline') : n === 3 ? late.promise : { status: 402 }));
  await c.tick(600);                               // the first try asks music-access; the answer is on its way
  assert.equal(e.accessCalls(), 3);
  e.music.pause();                                 // the listener pauses while the song is being picked up
  const plays = e.music.audio.playCalls, loads = e.music.audio.loads.length;
  late.resolve({ status: 402 });                   // then the entitlement check says no
  await settle(); await settle(); await settle();
  await c.tick(30000);
  assert.equal(e.music.audio.paused, true, 'nothing plays behind the listener\'s Pause (the preview started)');
  assert.equal(e.music.audio.playCalls, plays, 'no play()');
  assert.equal(e.music.audio.loads.length, loads, 'nothing loaded');
  assert.equal(e.attr('musicMiniPlay', 'aria-label'), 'Play');
  assert.equal(e.music.delivery().playing, false);
  assert.equal(e.text('musicMiniNote'), 'The connection dropped. Tap play to pick up at 1:10.', 'what the Pause left stands');
  /* Play asks music-access again, and the answer it gets decides: the preview, labelled as one */
  await e.music.resume(); await settle(); await settle(); await settle();
  assert.equal(e.accessCalls(), 4, 'asked again on Play');
  assert.equal(e.music.access(), 'preview');
  assert.equal(e.music.audio.src, 'creator-preview.mp3');
  assert.equal(e.music.audio.paused, false);
  assert.equal(e.text('musicMiniNote'), 'The full song is not open to this account any more. Playing its preview.');
});

test('gated path: inside its time an interrupted earned play picks up at the same second; once it lapses it is never claimed again by itself', async () => {
  const c = clockOf();
  const e = engine({ clock: c, claim: () => ({ state: 'full', url: 'earned-master.mp3', expires_in: 300 }) });
  e.reply(() => Promise.resolve({ state: 'earned' }));
  await e.play('First preview');
  assert.equal(e.claims(), 1);
  assert.equal(e.music.audio.src, 'earned-master.mp3');
  e.music.audio.currentTime = 100;
  e.music.audio.fail(2);
  await c.tick(600);
  assert.equal(e.music.audio.src, 'earned-master.mp3', 'the same play, within its time');
  assert.equal(e.music.audio.currentTime, 100);
  assert.equal(e.claims(), 1);
  e.music.audio.fire('playing');
  e.music.audio.currentTime = 150;
  await c.tick(300 * 1000);                        // its time has run out
  e.music.audio.fail(2);
  await c.tick(60 * 1000);
  assert.equal(e.claims(), 1, 'no automatic second claim');
  assert.equal(e.music.audio.paused, true);
  assert.equal(e.music.access(), 'spent');
  assert.match(e.text('musicMiniNote'), /time ran out.*Playing it again starts a new play/);
  assert.equal(e.music.audio.src, 'earned-master.mp3', 'nothing else was loaded');
});

test('gated path: a claim whose answer was lost is never retried by itself; the listener is told', async () => {
  const c = clockOf();
  const e = engine({ clock: c, claim: () => ({ state: 'unavailable', reason: 'network', uncertain: true }) });
  e.reply(() => Promise.resolve({ state: 'earned' }));
  await e.play('First preview');
  await c.tick(60 * 1000);
  assert.equal(e.claims(), 1, 'one claim');
  assert.match(e.text('musicMiniNote'), /could not confirm/i);
});

test('near the end of a song the next creator stream is signed ahead, so the next song starts without waiting on the network', async () => {
  const c = clockOf(), pending = deferred();
  const e = engine({ clock: c, member: true, access: () => pending.promise });
  e.music.registerCreatorTrack({ id: 'c2', title: 'Creator next', access_mode: 'account', previewUrl: 'creator-next-preview.mp3' });
  await e.play('Next full song');                  // the last catalogue song: the creator track is next
  e.music.audio.duration = 180;
  e.music.audio.currentTime = 170;
  e.music.audio.fire('timeupdate');
  assert.equal(e.accessCalls(), 1, 'asked ahead, near the end');
  pending.resolve({ url: 'creator-next.mp3', expires_in: 3600 });
  await settle();
  e.music.audio.currentTime = 179.95;
  e.music.audio.fire('ended');
  await settle();
  assert.equal(e.music.current().title, 'Creator next');
  assert.equal(e.music.audio.src, 'creator-next.mp3', 'it starts from what was fetched ahead');
  assert.equal(e.music.audio.paused, false);
  assert.equal(e.accessCalls(), 1, 'no second request at the change');
});

/* ------------------------------------------------------------------------------------------------------
   THE REVIEW OF M3 (music slice M3, review round). Each case below failed at 0e687e51.
   ------------------------------------------------------------------------------------------------------ */
test('while it reconnects the one button is Pause, the lock screen and the dock are told the listener asked for music, and Pause stops the tries', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  e.music.audio.currentTime = 60;
  e.music.audio.fail(2);
  const spec = e.np().spec;
  assert.equal(e.music.audio.paused, true, 'the element itself is quiet');
  assert.equal(e.attr('musicMiniPlay', 'aria-label'), 'Pause', 'every transport offered only Play, and Play tried again at once (PB-R3)');
  assert.equal(typeof spec.playing, 'function', 'the lock screen is told what the listener asked for, not only what the element does');
  assert.equal(spec.playing(), true);
  assert.equal(typeof spec.status, 'function', 'and why it is quiet (the installed app\'s dock shows it)');
  assert.equal(spec.status(), 'Reconnecting…');
  assert.equal(e.music.delivery().playing, true);
  e.music.toggle();                                // the mini player's and the Now sheet's one button
  const loads = e.music.audio.loads.length, plays = e.music.audio.playCalls;
  await c.tick(30000);
  assert.equal(e.music.audio.loads.length, loads, 'no try behind the listener');
  assert.equal(e.music.audio.playCalls, plays);
  assert.equal(e.attr('musicMiniPlay', 'aria-label'), 'Play');
  assert.equal(spec.playing(), false);
  assert.equal(spec.status(), 'Connection lost · tap play');
  assert.match(e.text('musicMiniNote'), /^The connection dropped\. Tap play to pick up at 1:00\.$/);
  /* the lock screen's own Pause does the same */
  const d = clockOf();
  const f = engine({ clock: d });
  await f.play('Full song');
  f.music.audio.currentTime = 20;
  f.music.audio.fail(2);
  f.np().spec.pause();
  const fl = f.music.audio.loads.length;
  await d.tick(30000);
  assert.equal(f.music.audio.loads.length, fl, 'the lock screen\'s Pause stops the tries too');
  assert.equal(f.np().spec.playing(), false);
});

test('a second the listener chooses during the trouble is where it picks up (the lock screen\'s seek, while it reconnects and after it gave up)', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  e.music.audio.currentTime = 60;
  e.music.audio.fail(2);
  e.np().spec.seek(90);                            // the lock screen's scrubber, while it reconnects
  const before = e.music.audio.loads.length;
  await until(c, () => e.music.audio.loads.length > before, 50, 20000);
  assert.equal(e.music.audio.currentTime, 90, 'the next try reads from the chosen second, not the one it stopped at');
  assert.match(e.text('musicMiniNote'), /1:30/);
  /* given up, then a second chosen: Play picks it up there */
  for (let i = 0; i < 6; i++) { e.music.audio.fail(2); await c.tick(3500); }
  assert.equal(e.text('musicMiniAccess'), 'Connection lost');
  e.np().spec.seek(30);
  assert.match(e.text('musicMiniNote'), /Tap play to pick up at 0:30/);
  await e.music.resume(); await settle();
  assert.equal(e.music.audio.currentTime, 30);
});

test('a try whose play() is refused (a hidden page may need a tap) stops trying and says how to pick it up', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  e.music.audio.currentTime = 60;
  e.music.audio.fail(2);
  e.music.audio.play = function () { this.playCalls++; return Promise.reject(Object.assign(new Error('refused'), { name: 'NotAllowedError' })); };
  await c.tick(600); await settle();
  assert.equal(e.music.delivery().state, 'lost', 'it said Reconnecting… forever and never tried again (PB-R6)');
  assert.equal(e.text('musicMiniAccess'), 'Connection lost');
  assert.match(e.text('musicMiniNote'), /^The connection dropped\. Tap play to pick up at 1:00\.$/);
  const loads = e.music.audio.loads.length;
  await c.tick(30000);
  assert.equal(e.music.audio.loads.length, loads, 'nothing more by itself: it needs the listener\'s tap');
});

test('a signing-ahead that failed is not kept: the next creator release is asked for again when it starts', async () => {
  const c = clockOf();
  const answers = [new Error('offline'), { url: 'creator-next.mp3', expires_in: 3600 }];
  const e = engine({ clock: c, member: true, access: () => answers.shift() });
  e.music.registerCreatorTrack({ id: 'c2', title: 'Creator next', access_mode: 'account', previewUrl: 'creator-next-preview.mp3' });
  await e.play('Next full song');                  // the last catalogue song: the creator release is next
  e.music.audio.duration = 180;
  e.music.audio.currentTime = 170;
  e.music.audio.fire('timeupdate');                // signed ahead, near the end: the network blips
  await settle();
  assert.equal(e.accessCalls(), 1);
  e.music.audio.currentTime = 179.95;
  e.music.audio.fire('ended');
  await settle(); await settle();
  assert.equal(e.accessCalls(), 2, 'asked again at the start (PB-R7: the failed answer was reused)');
  assert.equal(e.music.current().title, 'Creator next');
  assert.equal(e.music.access(), 'full', 'an entitled member hears the release, not its preview');
  assert.equal(e.music.audio.src, 'creator-next.mp3');
});

test('a song that never started (a missing or unreadable file) is not called a dropped connection', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  e.music.audio.readyState = 0;                    // nothing came: no metadata, no second heard
  e.music.audio.fail(4);
  const said = [];
  const look = () => said.push(e.text('musicMiniAccess') + ' | ' + e.text('musicMiniNote'));
  look();
  assert.equal(e.text('musicMiniAccess'), 'Loading…');
  assert.equal(e.text('musicMiniNote'), 'This song would not load. Trying again…');
  for (let i = 0; i < 6; i++) { await c.tick(3500); e.music.audio.readyState = 0; e.music.audio.fail(4); look(); }
  assert.equal(e.text('musicMiniAccess'), 'Could not load');
  assert.equal(e.text('musicMiniNote'), 'This song could not load. Tap play to try again.');
  assert.ok(said.every((x) => !/connection|reconnect/i.test(x)), said.join(' / '));
  assert.equal(e.np().spec.status(), 'Could not load · tap play');
});

test('an earned play whose time ran out while it was paused says so, without blaming the connection', async () => {
  const c = clockOf();
  const e = engine({ clock: c, claim: () => ({ state: 'full', url: 'earned-master.mp3', expires_in: 12 }) });
  e.reply(() => Promise.resolve({ state: 'earned' }));
  await e.play('First preview');
  assert.equal(e.claims(), 1);
  await c.tick(500);
  e.music.pause();
  await c.tick(3500);                              // within the play's last ten seconds now
  const loads = e.music.audio.loads.length;
  await e.music.resume(); await settle();
  assert.equal(e.text('musicMiniNote'), 'This play\'s time ran out while it was paused. Playing it again starts a new play.',
    'nothing dropped: it said "The connection dropped and this play\'s time ran out" (RL-2)');
  assert.equal(e.text('musicMiniAccess'), 'Play ended', 'the spent play has a label');
  assert.equal(e.claims(), 1, 'never claimed again by itself');
  assert.equal(e.music.audio.loads.length, loads, 'no read either');
});

/* The album is an inline player. Run its actual load/play/claim functions and
   ended handler, with presentation helpers and the API at explicit boundaries. */
function album(options = {}) {
  const source = read('album.html');
  const begin = source.indexOf('    function load(i, at) {');
  const end = source.indexOf('    /* The one play is over', begin);
  const ended = source.indexOf('    deck.addEventListener("ended", function () {');
  const bank = source.indexOf('    /* ============================================================\n       BANKING', ended);
  const seek = source.indexOf('    function seekFeedback(message) {');
  const seekEnd = source.indexOf('    ["seek", "nowSeek"].forEach', seek);
  const deckPaint = source.indexOf('    function paintDeck() {');
  const deckPaintEnd = source.indexOf('    /* THE LOCK SCREEN.', deckPaint);
  /* the deck's own play and pause listeners: the bar's transport and the album's Play all follow them */
  const own = source.indexOf('    deck.addEventListener("play", function () { if (priming) return;');
  const ownEnd = source.indexOf('    var tick = 0;', own);
  assert.ok(begin >= 0 && end > begin && ended > end && bank > ended && deckPaint >= 0 && deckPaintEnd > deckPaint && own > 0 && ownEnd > own);
  const attrs = (entries) => ({
    values: { ...entries },
    getAttribute(k) { return this.values[k] ?? null; },
    hasAttribute(k) { return k in this.values; },
    setAttribute(k, v) { this.values[k] = v; },
    removeAttribute(k) { delete this.values[k]; },
    querySelector() { return null; }
  });
  const rows = [
    attrs({ 'data-title': 'First song', 'data-src': 'first.mp3', 'data-key': 'first', 'data-seconds': '180' }),
    attrs({ 'data-title': 'Earned song', 'data-src': 'preview.mp3', 'data-preview-src': 'preview.mp3', 'data-key': 'earned',
      'data-gated-bucket': 'private', 'data-gate': options.gate || 'earned' }),
    attrs({ 'data-title': 'Chosen song', 'data-src': 'chosen.mp3', 'data-key': 'chosen', 'data-seconds': '180' })
  ];
  const deck = new Media();
  deck.src = 'first.mp3'; deck.paused = false;
  const claim = deferred(), finish = deferred();
  let claims = 0;
  const toasts = [], spends = [], finishes = [], announced = [], els = new Map();
  const elNode = (id) => {
    if (!els.has(id)) els.set(id, { id, textContent: '', innerHTML: '', hidden: true, style: {}, dataset: {},
      setAttribute() {}, getAttribute() { return null; }, addEventListener() {} });
    return els.get(id);
  };
  const clock = options.clock;
  const context = {
    rows, deck, Promise, console, ALBUM: 'fixture', ARTIST: 'Fixture artist', LIC_SLUG: {},
    document: {
      documentElement: { style: { setProperty() {} } },
      querySelector: () => attrs({}), getElementById: () => attrs({})
    },
    window: {
      MCC_GATED: { signedIn: () => true, claim: () => { claims++; return claim.promise; }, forget() {},
        explain: (out) => out && out.gate && out.gate.later ? { text: 'The full song opens later.', links: [] } : null },
      MCC_LISTENS: { finish: (h) => { finishes.push(h); return finish.promise; }, release() {} },
      MCC_TOAST: (m) => toasts.push(m), MCC_TRACK() {}
    },
    audioSession() {}, spend: (row) => spends.push(row.getAttribute('data-key')), media() {}, paintRows() {},
    announce: (on) => announced.push(!!on), paintSheet() {}, ICO_PLAY: '[play]', ICO_PAUSE: '[pause]',
    loadReel() {}, setRoom() {}, loadLyrics() {}, priming: false, countStart() {}, save() {}, roomPlay() {},
    el: elNode, bar: elNode('deckbar'), granted: () => false,
    fmt: (x) => { x = Math.max(0, Math.round(x || 0)); return Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0'); },
    gateSpec: (row) => row.getAttribute('data-key'),
    paintGate: (row, out) => row.setAttribute('data-gate', out.state),
    setTimeout: clock ? clock.setTimeout : setTimeout, clearTimeout: clock ? clock.clearTimeout : clearTimeout,
    Date: clock ? clock.Date : Date
  };
  if (options.later) rows[1]._gateOut = { state: 'locked', gate: { later: true } };
  const script = 'var cur = 0, listen = null, grantMax = 0, songTest = null;\n' +
    source.slice(deckPaint, deckPaintEnd) + '\n' +
    source.slice(begin, end) + '\n' + source.slice(ended, bank) + '\n' + source.slice(own, ownEnd) + '\n' +
    source.match(/window\.MCC_NP_PAUSE = function \(\) \{[^\n]+/)[0] + '\n' +
    source.match(/function next\(\) \{[^\n]+/)[0] + '\n' +
    source.match(/function prev\(\) \{[^\n]+/)[0] + '\n' + source.slice(seek, seekEnd) + '\n' +
    'this.player = { play: play, pause: window.MCC_NP_PAUSE, previous: prev, seek: function (t) { seekDeck(null, t / deck.duration); }, current: function () { return cur; }, ' +
    'count: function () { listen = { row: rows[cur], handle: "listen-fixture" }; }, ' +
    /* the deck bar's and the sheet's one button, and a second chosen on the lock screen or a lyric line (music slice M3, review) */
    'toggle: typeof deckToggle === "function" ? deckToggle : null, seekTo: typeof userSeek === "function" ? userSeek : null };';
  vm.runInContext(script, vm.createContext(context), { filename: 'album.html playback' });
  return { ...context.player, deck, claim, finish, claims: () => claims, toasts, spends, finishes, rows, announced,
    text: (id) => elNode(id).textContent, html: (id) => elNode(id).innerHTML, shown: (id) => !elNode(id).hidden };
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

/* ------------------------------------------------------------------------------------------------------
   THE ALBUM DECK, the same delivery rules (music slice M3)
   ------------------------------------------------------------------------------------------------------ */
test('album, public path: a dropped connection says so, never shows playing over silence, and picks up at the same second', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 42;
  a.deck.fail(2);
  assert.equal(a.deck.paused, true);
  assert.match(a.text('npTime'), /^Reconnecting/);
  assert.match(a.text('seekStatus'), /connection dropped.*0:42/i);
  await c.tick(500);
  assert.equal(a.deck.src, 'first.mp3');
  assert.equal(a.deck.currentTime, 42);
  assert.equal(a.deck.paused, false);
  a.deck.fire('playing');
  assert.equal(a.text('seekStatus'), '');
  assert.doesNotMatch(a.text('npTime'), /Reconnecting/);
});

test('album: retries are bounded, Pause and a newer song win over a pending retry, and Play picks up where it stopped', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 50;
  a.deck.fail(2);
  a.pause();
  const loads = a.deck.loads.length;
  await c.tick(30000);
  assert.equal(a.deck.loads.length, loads, 'paused: nothing reloads behind the listener');
  a.play();                                        // Play on the interrupted song: at once, at the same second
  await settle();
  assert.equal(a.deck.loads.length, loads + 1);
  assert.equal(a.deck.currentTime, 50);
  assert.equal(a.deck.paused, false);
  for (let i = 0; i < 4; i++) { a.deck.fail(2); await c.tick(8000); }
  a.deck.fail(2);
  const stopped = a.deck.loads.length;
  await c.tick(60000);
  assert.equal(a.deck.loads.length, stopped, 'bounded');
  assert.match(a.text('npTime'), /Connection lost/);
  assert.match(a.text('seekStatus'), /Tap play to pick up at 0:50/);

  const bclock = clockOf();
  const b = album({ clock: bclock });
  b.deck.currentTime = 20;
  b.deck.fail(2);
  b.play(2);
  await settle();
  const after = b.deck.loads.slice();
  await bclock.tick(20000);
  assert.equal(b.current(), 2);
  assert.equal(b.deck.src, 'chosen.mp3');
  assert.deepEqual(b.deck.loads, after, 'the newer song wins');
});

test('album: the browser pausing the deck on a failed read (error, then pause) is not the listener: the retry runs', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 33;
  a.deck.failInPage(2);
  assert.match(a.text('npTime'), /^Reconnecting/);
  await c.tick(500);
  assert.equal(a.deck.src, 'first.mp3');
  assert.equal(a.deck.currentTime, 33);
  assert.equal(a.deck.paused, false, 'picked up at the same second');
});

test('album: a pause from outside the page (the World\'s transport, the lock screen) wins over a retry', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 64;
  a.deck.pause();                                  // the World's transport pauses the deck element itself
  a.deck.fail(2);                                  // the read still in flight fails while it is paused
  const loads = a.deck.loads.length;
  await c.tick(30000);
  assert.equal(a.deck.loads.length, loads, 'nothing reloads or plays behind the listener');
  assert.equal(a.deck.paused, true);
  a.play();                                        // Play picks it up at the second it stopped
  await settle();
  assert.equal(a.deck.loads.length, loads + 1);
  assert.equal(a.deck.currentTime, 64);
  assert.equal(a.deck.paused, false);
});

test('album: a song that ends short of its length is an interruption, not a finished listen', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.count();
  a.deck.currentTime = 20;
  a.deck.fire('ended');
  await settle();
  assert.deepEqual(a.finishes, [], 'the listen is not finished');
  assert.equal(a.current(), 0, 'the album does not move on');
  await c.tick(500);
  assert.equal(a.deck.currentTime, 20, 'picked up at 0:20');
  a.deck.currentTime = 179.8;
  a.deck.fire('ended');
  await settle();
  assert.deepEqual(a.finishes, ['listen-fixture'], 'heard to its end, it counts once');
});

test('album, gated path: inside its time the earned play picks up at the same second; once it lapses it is never claimed again by itself', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.play(1);
  a.claim.resolve({ state: 'full', url: 'earned-master.mp3', expires_in: 300 });
  await settle();
  assert.equal(a.deck.src, 'earned-master.mp3');
  a.deck.currentTime = 100;
  a.deck.fail(2);
  await c.tick(600);
  assert.equal(a.deck.src, 'earned-master.mp3');
  assert.equal(a.deck.currentTime, 100);
  assert.equal(a.claims(), 1);
  a.deck.fire('playing');
  await c.tick(300 * 1000);
  a.deck.fail(2);
  await c.tick(60 * 1000);
  assert.equal(a.claims(), 1, 'no automatic second claim');
  assert.equal(a.deck.paused, true);
  assert.ok(a.toasts.some((m) => /time ran out.*Playing it again starts a new play/.test(m)), a.toasts.join(' | '));
  assert.equal(a.spends[a.spends.length - 1], 'earned', 'the play is over: the row goes back to its preview');
});

test('album: a locked preview plays to its boundary and the album moves on, with a short honest line', async () => {
  const a = album({ gate: 'locked', later: true });
  a.play(1);
  assert.equal(a.deck.src, 'preview.mp3');
  a.deck.fire('ended');
  await settle();
  assert.equal(a.current(), 2, 'the album moved on');
  assert.equal(a.deck.src, 'chosen.mp3');
  assert.equal(a.deck.paused, false);
  assert.ok(a.toasts.includes('That was the preview. The full song opens later.'), a.toasts.join(' | '));
});

test('album: slow reads say Loading after a moment; a stall that never moves picks up again at the same second', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 30;
  a.deck.fire('waiting');
  await c.tick(1700);
  assert.match(a.text('npTime'), /^Loading/);
  a.deck.currentTime = 31; a.deck.fire('timeupdate'); a.deck.fire('playing');
  assert.doesNotMatch(a.text('npTime'), /Loading/);
  a.deck.fire('waiting');
  const loads = a.deck.loads.length;
  await c.tick(4100);                              // four seconds of silence once the song has been heard (review PB-R1; it was 12)
  assert.match(a.text('npTime'), /^Reconnecting/);
  assert.equal(a.deck.loads.length, loads + 1);
  assert.equal(a.deck.currentTime, 31);
});

/* ------------------------------------------------------------------------------------------------------
   THE ALBUM DECK, THE REVIEW OF M3 (music slice M3, review round). Each case below failed at 0e687e51.
   ------------------------------------------------------------------------------------------------------ */
test('album: every try starts inside the ten seconds after the sound stopped, then it stops and says so', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 50;
  const t0 = c.now();
  a.deck.fail(2);
  const starts = [];
  for (let i = 0; i < 5; i++) {
    const before = a.deck.loads.length;
    await until(c, () => a.deck.loads.length > before, 50, 20000);
    starts.push(c.now() - t0);
    assert.equal(a.deck.currentTime, 50, 'each try reads from the second it stopped');
    a.deck.fail(2);
  }
  assert.deepEqual(starts, [500, 1500, 3000, 5500, 8500], 'timed from the moment the sound stopped, all inside the ten seconds');
  const loads = a.deck.loads.length;
  await c.tick(60000);
  assert.equal(a.deck.loads.length, loads, 'no sixth try by itself');
  assert.match(a.text('npTime'), /^Connection lost/);
  assert.equal(a.text('seekStatus'), 'The connection dropped. Tap play to pick up at 0:50.');
});

test('album: a read that never answers is noticed within four seconds, and each try that hangs gives way to the next on time', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 30; a.deck.fire('playing');
  a.deck.currentTime = 31; a.deck.fire('timeupdate');
  const t0 = c.now();
  a.deck.fire('waiting');
  const starts = [], seen = {};
  while (c.now() - t0 < 12000) {
    const n = a.deck.loads.length;
    await c.tick(50);
    const dt = c.now() - t0;
    if (a.deck.loads.length > n) starts.push(dt);
    if (dt === 1700) seen.at1700 = a.text('npTime');
    if (dt === 4100) seen.at4100 = a.text('seekStatus');
  }
  assert.match(seen.at1700, /^Loading…/);
  assert.equal(seen.at4100, 'The connection dropped at 0:31. Picking up there…');
  assert.deepEqual(starts, [4000, 5500, 8500]);
  assert.match(a.text('npTime'), /^Connection lost/);
});

test('album: while it reconnects the deck bar offers Pause, the bar is told music is wanted, and Pause stops the tries', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 42;
  a.deck.fail(2);
  assert.equal(a.deck.paused, true, 'the element itself is quiet');
  assert.match(a.html('tpPlayIc'), /M7 5h3\.4v14H7z/, 'the pause glyph: the listener asked for music (it showed only Play, and Play tried again at once)');
  assert.equal(a.announced[a.announced.length - 1], true, 'the bar\'s own transport is told music is wanted');
  a.toggle();                                      // the deck bar's and the sheet's one button
  const loads = a.deck.loads.length;
  await c.tick(30000);
  assert.equal(a.deck.loads.length, loads, 'no try behind the listener');
  assert.equal(a.deck.paused, true);
  assert.match(a.html('tpPlayIc'), /M8 5l11 7-11 7z/);
  assert.equal(a.announced[a.announced.length - 1], false);
  assert.match(a.text('npTime'), /^Connection lost/);
  assert.equal(a.text('seekStatus'), 'The connection dropped. Tap play to pick up at 0:42.');
});

test('album: a pause from outside the page during a pending try is the listener\'s (the World\'s transport, its pause message, the sleep timer)', async () => {
  const world = read('js/world-audio-continuity.js'), label = read('js/label.js');
  const deckPlayer = world.slice(world.indexOf('var deck = doc.getElementById("deck");\n    if (deck && (deck.currentSrc'), world.indexOf('function player()'));
  assert.ok(deckPlayer.length > 0);
  /* the deck was paused there with deck.pause(): during a try's wait the deck is already quiet, so that pause changed
     nothing, fired no event, and the try played the music again behind the listener (PB-R2) */
  assert.match(deckPlayer, /pause\s*:\s*function\s*\(\)\s*\{\s*if\s*\(root\.MCC_NP_PAUSE\)\s*root\.MCC_NP_PAUSE\(\)/,
    'the World\'s transport and its pause message pause the deck through the page\'s own Pause');
  const nap = label.slice(label.indexOf('if (left <= 0) {'), label.indexOf('toast("The record tucked you in'));
  assert.ok(nap.length > 0);
  assert.match(nap, /if\s*\(window\.MCC_NP_PAUSE\)\s*window\.MCC_NP_PAUSE\(\)/, 'the sleep timer pauses through the page\'s own Pause');
  /* and the page's own Pause wins over a try that is waiting */
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 64;
  a.deck.fail(2);                                  // Reconnecting…, a try pending
  a.pause();
  const loads = a.deck.loads.length;
  await c.tick(30000);
  assert.equal(a.deck.loads.length, loads, 'nothing reloads or plays behind the listener');
  assert.equal(a.deck.paused, true);
  assert.equal(a.text('seekStatus'), 'The connection dropped. Tap play to pick up at 1:04.');
});

test('album: Previous or a second chosen during the trouble is where it picks up', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 42;
  a.deck.fail(2);                                  // Reconnecting…
  a.previous();                                    // back to the top of the song
  const before = a.deck.loads.length;
  await until(c, () => a.deck.loads.length > before, 50, 20000);
  assert.ok(a.deck.loads.length > before, 'it keeps picking the song up, now from where the listener chose');
  assert.equal(a.deck.currentTime, 0, 'from 0:00, not from the drop at 0:42 (PB-R4)');
  for (let i = 0; i < 6; i++) { a.deck.fail(2); await c.tick(3500); }
  assert.match(a.text('npTime'), /^Connection lost/);
  a.seekTo(30);                                    // the lock screen's scrubber, or a lyric line
  assert.equal(a.text('seekStatus'), 'The connection dropped. Tap play to pick up at 0:30.');
  a.play();
  await settle();
  assert.equal(a.deck.currentTime, 30, 'Play picks it up at the chosen second');
  assert.equal(a.deck.paused, false);
});

test('album: Pause and Play just after it picked up again resume in place, with no reload', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 42;
  a.deck.fail(2);
  await c.tick(500);                               // picked up at 0:42
  a.deck.fire('playing');
  a.deck.currentTime = 44; a.deck.fire('timeupdate');
  a.pause();
  const loads = a.deck.loads.length;
  a.play();
  await settle();
  assert.equal(a.deck.loads.length, loads, 'no reload (it read the song again and went back to 0:42, PB-R5)');
  assert.equal(a.deck.currentTime, 44);
  assert.equal(a.deck.paused, false);
  /* the same after a slow first read that said Loading… */
  const d = clockOf();
  const b = album({ clock: d });
  b.deck.currentTime = 0; b.deck.fire('waiting');
  await d.tick(1700);
  assert.match(b.text('npTime'), /^Loading/);
  b.deck.fire('playing'); b.deck.currentTime = 2; b.deck.fire('timeupdate');
  b.pause();
  const bl = b.deck.loads.length;
  b.play();
  await settle();
  assert.equal(b.deck.loads.length, bl, 'no reload from 0:00 either');
  assert.equal(b.deck.currentTime, 2);
});

test('album: a try whose play() is refused stops trying and says how to pick it up', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 42;
  a.deck.fail(2);
  a.deck.play = function () { this.playCalls++; return Promise.reject(Object.assign(new Error('refused'), { name: 'NotAllowedError' })); };
  await c.tick(600); await settle();
  assert.match(a.text('npTime'), /^Connection lost/, 'it said Reconnecting… forever (PB-R6)');
  assert.equal(a.text('seekStatus'), 'The connection dropped. Tap play to pick up at 0:42.');
  const loads = a.deck.loads.length;
  await c.tick(30000);
  assert.equal(a.deck.loads.length, loads, 'nothing more by itself');
});

test('album: a song that never started is not called a dropped connection', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 0; a.deck.readyState = 0;  // nothing came: no metadata, no second heard
  a.deck.fail(4);
  assert.match(a.text('npTime'), /^Loading…/);
  assert.equal(a.text('seekStatus'), 'This song would not load. Trying again…');
  for (let i = 0; i < 6; i++) { await c.tick(3500); a.deck.readyState = 0; a.deck.fail(4); }
  assert.match(a.text('npTime'), /^Could not load/);
  assert.equal(a.text('seekStatus'), 'This song could not load. Tap play to try again.');
  assert.doesNotMatch(a.text('npTime') + a.text('seekStatus'), /connection|reconnect/i);
});

/* A slow first read that said Loading…, then the sound (the browser fires playing before any time passes), then a
   drop mid-song: the drop is a dropped connection, said so, and picked up. (A first version of the review round kept
   the slow read's note as if it were a trouble of its own, and the drop that followed was neither named nor tried
   again: caught by the background browser suite, kept here.) */
test('a slow first read that said Loading…, then a drop mid-song: called a dropped connection and picked up (listen and album)', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  e.music.audio.fire('waiting');                   // the first bytes are slow
  await c.tick(1700);
  assert.equal(e.text('musicMiniAccess'), 'Loading…');
  e.music.audio.fire('playing');                   // they came: playing, before any time has passed
  e.music.audio.currentTime = 5; e.music.audio.fire('timeupdate');
  const loads = e.music.audio.loads.length;
  e.music.audio.fail(2);                           // and then the read for the rest fails
  assert.equal(e.text('musicMiniAccess'), 'Reconnecting…');
  assert.equal(e.text('musicMiniNote'), 'The connection dropped at 0:05. Picking up there…');
  await c.tick(500);
  assert.equal(e.music.audio.loads.length, loads + 1, 'picked up again');
  assert.equal(e.music.audio.currentTime, 5);

  const d = clockOf();
  const a = album({ clock: d });
  a.deck.currentTime = 0; a.deck.fire('waiting');
  await d.tick(1700);
  assert.match(a.text('npTime'), /^Loading…/);
  a.deck.fire('playing');
  a.deck.currentTime = 5; a.deck.fire('timeupdate');
  const al = a.deck.loads.length;
  a.deck.fail(2);
  assert.equal(a.text('seekStatus'), 'The connection dropped at 0:05. Picking up there…');
  await d.tick(500);
  assert.equal(a.deck.loads.length, al + 1, 'the album picks it up again too');
  assert.equal(a.deck.currentTime, 5);
});

/* The game hub's music capsule is one more transport over the same engine (js/game-hub/shared-music.mjs). It read
   the element alone, so while a song was being picked up again it offered Play, and Play tried again at once; and its
   line kept the album's name. (Music slice M3, review PB-R3: every transport; found while fixing it.) */
test('the game hub\'s music capsule: while a song is picked up again its button is Pause and its line says why; Pause stops the tries', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  const part = () => {
    const attrs = {}, on = {};
    return { dataset: {}, style: {}, textContent: '', title: '', disabled: false,
      setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
      addEventListener(type, fn) { on[type] = fn; }, click() { if (on.click) on.click(); } };
  };
  const parts = {};
  for (const s of ['[data-hub-music-play]', '[data-music-next]', '[data-music-title]', '[data-music-role]', '[data-music-progress]',
    '[data-music-status]', '[data-course-soundtrack]']) parts[s] = part();
  const capsule = { querySelector: (s) => parts[s] };
  const root = { querySelector: (s) => parts[s], closest: () => capsule };
  globalThis.window = e.win;                       // the module reads the engine and listens on the page's window
  let hub;
  try { hub = await (await import('../../js/game-hub/shared-music.mjs')).createSharedMusic({ root }); }
  finally { delete globalThis.window; }
  hub.setModule({ music: { label: 'Course soundtrack' } }, { slug: 'fixture', tracks: [{ title: 'Full song' }] });
  const play = parts['[data-hub-music-play]'], line = parts['[data-music-status]'];
  await e.play('Full song');
  e.music.audio.currentTime = 60;
  e.music.audio.fail(2);
  assert.equal(e.music.audio.paused, true, 'the element itself is quiet');
  assert.equal(play.dataset.state, 'playing', 'the capsule offered Play while the song was being picked up again');
  assert.equal(play.getAttribute('aria-label'), 'Pause Full song');
  assert.equal(line.textContent, 'Reconnecting…', 'and its line kept the album\'s name');
  const loads = e.music.audio.loads.length, plays = e.music.audio.playCalls;
  play.click();
  await settle();
  await c.tick(30000);
  assert.equal(e.music.audio.loads.length, loads, 'Pause stops the tries: nothing reads behind the listener');
  assert.equal(e.music.audio.playCalls, plays);
  assert.equal(play.dataset.state, 'paused');
  assert.equal(line.textContent, 'Connection lost · tap play');
  play.click();                                    // Play picks it up at its second, at once
  await settle();
  assert.equal(e.music.audio.loads.length, loads + 1);
  assert.equal(e.music.audio.currentTime, 60);
});

/* In the page the browser pauses the deck itself on a failed read, error first and then pause (lane 02 T6b; the
   reviewers' Chromium probe H). The deck's own pause listener then told the bar's transport and the album's Play all
   that nothing was wanted, after the trouble had said Pause: both offered Play during Reconnecting…, and the bar's
   Play tried again at once. (Music slice M3, review PB-R3: every transport; found in the renders of this round.) */
test('album: when the browser pauses the deck after a failed read, the bar\'s transport and Play all still offer Pause while it is picked up again', async () => {
  const c = clockOf();
  const a = album({ clock: c });
  a.deck.currentTime = 42;
  a.deck.failInPage(2);                            // the order Chromium uses for an element in the page
  assert.match(a.text('npTime'), /^Reconnecting…/);
  assert.equal(a.announced[a.announced.length - 1], true, 'the bar\'s own transport is told music is wanted (the browser\'s pause said Play)');
  assert.match(a.html('playAll'), /Pause$/, 'Play all offers Pause too');
  a.toggle();                                      // the listener's Pause: the tries stop
  const loads = a.deck.loads.length;
  await c.tick(30000);
  assert.equal(a.deck.loads.length, loads, 'no try behind the listener');
  assert.equal(a.announced[a.announced.length - 1], false);
  assert.match(a.html('playAll'), /Play$/);
  /* a pause that is the listener's, while the song plays normally, still says Play everywhere */
  const b = album({ clock: clockOf() });
  b.deck.pause();
  assert.equal(b.announced[b.announced.length - 1], false);
  assert.match(b.html('playAll'), /Play$/);
  /* and one from outside the page while a try is playing (started again, not heard yet) ends the tries and says so */
  const d = clockOf();
  const e = album({ clock: d });
  e.deck.currentTime = 20;
  e.deck.failInPage(2);
  await d.tick(500);                               // the first try starts the deck again
  assert.equal(e.deck.paused, false);
  e.deck.pause();
  assert.equal(e.announced[e.announced.length - 1], false, 'every surface offers Play');
  assert.match(e.text('npTime'), /^Connection lost/);
  assert.equal(e.text('seekStatus'), 'The connection dropped. Tap play to pick up at 0:20.');
  const l2 = e.deck.loads.length;
  await d.tick(30000);
  assert.equal(e.deck.loads.length, l2, 'nothing reads or plays behind the listener');
  assert.equal(e.deck.paused, true);
});

/* js/intuition.js counts the deck's play events to tell a listener "two records deep" to keep the masters. Since
   the deck picks a dropped song up again by playing it again (music slice M3), one record and one try were "two
   records deep": the tip came up over the deck bar 2.5 s after the first try (seen in this round's renders). */
test('the album\'s "two records deep" tip counts records, not the tries that pick one song up again', async () => {
  const c = clockOf();
  const appended = [];
  const deck = new Media();
  const node = () => ({ classList: { add() {}, remove() {} }, setAttribute() {}, remove() {}, addEventListener() {},
    querySelector: () => ({ addEventListener() {} }), set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; } });
  const store = {};
  const context = {
    location: { pathname: '/album.html', origin: 'https://fixture.invalid', href: 'https://fixture.invalid/album.html' },
    document: { addEventListener() {}, getElementById: (id) => id === 'deck' ? deck : null, createElement: node, head: { appendChild() {} },
      body: { appendChild: (el) => appended.push(el.html) }, hidden: false },
    sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    localStorage: { getItem: () => null }, requestAnimationFrame: (fn) => fn(), window: {},
    setTimeout: c.setTimeout, clearTimeout: c.clearTimeout
  };
  vm.runInContext(read('js/intuition.js'), vm.createContext(context), { filename: 'js/intuition.js' });
  deck.src = 'first.mp3'; deck.play();
  deck.error = { code: 2 }; deck.pause();          // the read failed; the deck is quiet
  await c.tick(500);
  deck.src = 'first.mp3'; deck.play();             // the first try: the same record, picked up again
  await c.tick(3000);
  assert.equal(appended.length, 0, 'one record and one try are not "two records deep"');
  deck.src = 'second.mp3'; deck.play();            // a second record
  await c.tick(3000);
  assert.equal(appended.length, 1);
  assert.match(appended[0], /Two records deep/);
});

/* ------------------------------------------------------------------------------------------------------
   THE M3 FOLLOW-UP (docs/music/MUSIC-RELEASE-20261119.md, "M3 follow-up (2026-11-23)")
   ------------------------------------------------------------------------------------------------------ */

/* ONE DROP, ONE ERROR (review RL-9). music_error went out once per failed read: a drop and its five tries sent six,
   and a file that would not load sent six too. It is sent once per failed song or drop episode now, with the first
   failed read's code; a song that plays on after picking up and then drops again is a new episode. (The new
   music_interrupted waits for Matthew's approval in js/analytics.js: scripts/test/music-measurement.test.mjs.) */
test('a dropped connection is one music_error with its code, however many reads fail; a song that never started is one too', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  const errors = () => e.events.filter((x) => x.name === 'music_error');
  await e.play('Full song');
  e.music.audio.currentTime = 60;
  e.music.audio.fail(2);
  for (let i = 0; i < 5; i++) {                    // every try fails too
    const n = e.music.audio.loads.length;
    await until(c, () => e.music.audio.loads.length > n, 50, 20000);
    e.music.audio.fail(2);
  }
  await c.tick(20000);
  assert.equal(e.text('musicMiniAccess'), 'Connection lost');
  assert.equal(errors().length, 1, 'one drop, one music_error (it was one per failed read: six)');
  assert.equal(errors()[0].code, 2, 'with its code');
  await e.music.resume();                          // Play picks it up: the same drop, the same episode
  e.music.audio.fail(2);
  await c.tick(20000);
  assert.equal(errors().length, 1, 'the same drop picked up again by the listener is not a second error');
  await e.music.resume();
  e.music.audio.fire('playing');
  e.music.audio.currentTime = 66; e.music.audio.fire('timeupdate');   // it plays on: the drop is over
  e.music.audio.fail(2);                           // a new drop later in the song
  assert.equal(errors().length, 2, 'a later drop is a new episode');
  const f = engine({ clock: c });
  await f.play('Full song');
  for (let i = 0; i < 7; i++) { f.music.audio.readyState = 0; f.music.audio.fail(4); await c.tick(3500); }
  assert.equal(f.text('musicMiniAccess'), 'Could not load');
  assert.deepEqual(f.events.filter((x) => x.name === 'music_error').map((x) => x.code), [4], 'a song that would not load: one music_error, code 4');
  await f.play('Next full song');                  // another song fails: its own error
  f.music.audio.readyState = 0; f.music.audio.fail(4);
  assert.equal(f.events.filter((x) => x.name === 'music_error').length, 2);
});

/* AN EARNED PLAY WHOSE TIME RAN OUT ENDS THE MOMENT A READ FAILS (verification V-4). Taking out the engine's immediate
   end in deliveryFailed left the same end half a second later, at the first try (sourceAgain checks the time too), so no
   test held it: for half a second the listener saw "Reconnecting…" and Pause for a play that was already over. */
test('gated path: a read that fails after an earned play\'s time ran out ends it at once: no read, no claim, the right line', async () => {
  const c = clockOf();
  const e = engine({ clock: c, claim: () => ({ state: 'full', url: 'earned-master.mp3', expires_in: 300 }) });
  e.reply(() => Promise.resolve({ state: 'earned' }));
  await e.play('First preview');
  assert.equal(e.claims(), 1);
  e.music.audio.currentTime = 150;
  e.music.audio.fire('playing');
  await c.tick(295 * 1000);                        // inside the play's last ten seconds
  const loads = e.music.audio.loads.length;
  e.music.audio.fail(2);                           // the clock does not move: what the listener sees at once
  assert.equal(e.music.access(), 'spent', 'the play is over at once');
  assert.equal(e.text('musicMiniAccess'), 'Play ended');
  assert.equal(e.text('musicMiniNote'), 'The connection dropped and this play\'s time ran out. Playing it again starts a new play.');
  assert.equal(e.attr('musicMiniPlay', 'aria-label'), 'Play', 'never Pause for a play that is over');
  assert.equal(e.np().spec.playing(), false, 'the lock screen is not told music is wanted');
  assert.equal(e.music.delivery().state, '', 'no try is waiting');
  await c.tick(60 * 1000);
  assert.equal(e.music.audio.loads.length, loads, 'no read');
  assert.equal(e.claims(), 1, 'no second claim');
});

/* THE BAR'S MIDDLE BUTTON ON THE LISTEN PAGE (verification V-3). js/tabbar.js paints it from mcc:nowplaying, which
   album.html and js/main.js send and the engine never did: on listen.html it kept its play triangle while a song
   played, and a tap scrolled to the top. The engine sends the same event, with the album's detail, on play, pause, the
   end and a new song, and gives the bar the album's two calls; elsewhere the button opens the shelf, as before. */
test('on the listen page the engine tells the bar what plays (mcc:nowplaying, as the album does): play, pause, the end, a new song', async () => {
  const c = clockOf();
  const e = engine({ clock: c, path: '/listen.html' });
  const told = [];
  e.win.addEventListener('mcc:nowplaying', (ev) => told.push(JSON.parse(JSON.stringify(ev.detail))));
  await e.play('Full song');
  assert.deepEqual(told.at(-1), { title: 'Full song', href: '#np', playing: true }, 'play');
  e.music.pause();
  assert.deepEqual(told.at(-1), { title: 'Full song', href: '#np', playing: false }, 'pause');
  await e.music.resume();
  assert.equal(told.at(-1).playing, true);
  e.music.audio.currentTime = 180;
  e.music.audio.fire('ended');                     // the end: the next song starts
  await settle();
  assert.deepEqual(told.at(-1), { title: 'Next full song', href: '#np', playing: true }, 'the end and the next song');
  await e.play('Full song');                       // a song chosen
  assert.deepEqual(told.at(-1), { title: 'Full song', href: '#np', playing: true }, 'a new song');
  e.music.audio.currentTime = 30;
  e.music.audio.fail(2);                           // picked up again: the listener still asked for music (Pause stops it)
  assert.equal(told.at(-1).playing, true, 'while it is picked up again the button is Pause, as on the album');
  e.music.pause();
  assert.equal(told.at(-1).playing, false);
  const n = told.length;
  e.music.audio.fire('timeupdate'); e.music.audio.fire('timeupdate');
  assert.equal(told.length, n, 'said when it changes, not on every tick');
});

test('on the listen page the bar\'s middle button drives the engine once a song is chosen or held, as it drives the album deck', async () => {
  const c = clockOf();
  const e = engine({ clock: c, path: '/listen.html' });
  assert.equal(typeof e.win.MCC_NP_PLAY, 'undefined', 'nothing chosen or held: the button opens the shelf, as before');
  await e.play('Full song');
  assert.equal(typeof e.win.MCC_NP_PLAY, 'function');
  assert.equal(typeof e.win.MCC_NP_PAUSE, 'function');
  e.win.MCC_NP_PAUSE();
  assert.equal(e.music.audio.paused, true);
  assert.equal(e.attr('musicMiniPlay', 'aria-label'), 'Play');
  await e.win.MCC_NP_PLAY();
  assert.equal(e.music.audio.paused, false);
  e.music.audio.currentTime = 40;
  e.music.audio.fail(2);                           // during the tries its Pause stops them
  e.win.MCC_NP_PAUSE();
  const loads = e.music.audio.loads.length;
  await c.tick(30000);
  assert.equal(e.music.audio.loads.length, loads, 'no try behind the listener');
  assert.equal(e.text('musicMiniAccess'), 'Connection lost');
  await e.win.MCC_NP_PLAY();                       // and its Play picks the song up where it stopped
  await settle();
  assert.equal(e.music.audio.currentTime, 40);
  assert.equal(e.music.audio.paused, false);
  /* a record held from another visit is what the button plays, as the mini player's Play does */
  const h = engine({ path: '/listen.html', pocket: { read: () => ({ title: 'Full song', album: 'fixture', src: 'whole-song.mp3', t: 42 }) } });
  h.win.document.dispatchEvent(new Event('DOMContentLoaded'));
  await settle(); await settle(); await settle();
  assert.equal(typeof h.win.MCC_NP_PLAY, 'function', 'a held record');
  await h.win.MCC_NP_PLAY();
  await settle();
  assert.equal(h.music.current().title, 'Full song');
  assert.equal(h.music.audio.currentTime, 42, 'at its second');
  assert.equal(h.music.audio.paused, false);
});

test('away from the listen page the engine tells the bar nothing: there its middle button opens the shelf', async () => {
  for (const path of ['/music-creator.html', '/game-hub.html']) {
    const e = engine({ path });
    const told = [];
    e.win.addEventListener('mcc:nowplaying', (ev) => told.push(ev.detail));
    await e.play('Full song');
    assert.equal(told.length, 0, path);
    assert.equal(typeof e.win.MCC_NP_PLAY, 'undefined', path);
  }
});

/* THE MUSIC TAB FOLLOWS THE PLAYER ON THE LISTEN PAGE (Release 1, PR #825's CI: music-background "browser", "listen,
   Enter again"). After Enter paused the song and Enter played it again, the song played and the mini player said
   Pause, but the bar's Music tab said "Play music" for as long as the song played. js/tabbar.js's transport() looks
   once more, one 0 ms timer after a tap, for the page's answer, and said "nothing is playing" when SOUND_ON was the
   value it had before the tap. A Pause is answered at once (playing:false); a Play right after it, or the first tap's
   own queued timeupdate seen after it, is answered playing:true; the value is back where it was, and the late look
   took it for no answer and said playing:false. The engine says only what changes, so it never said true again. Here
   the bar's transport block runs beside the real engine on one hand-moved clock: the engine answers the second tap
   before either timer can run, the order a busy CI runner produced by chance, every time. */
function barOn(e) {
  const src = read('js/tabbar.js');
  const from = src.indexOf('  var SOUND_ON = false'), to = src.indexOf('  /* the veil the departure rides behind */');
  assert.ok(from !== -1 && to > from, 'js/tabbar.js still has its transport block');
  const classes = (set) => ({
    toggle(c, on) { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); },
    add(c) { set.add(c); }, remove(...c) { c.forEach((x) => set.delete(x)); }, contains: (c) => set.has(c)
  });
  const tab = { cls: new Set(), attrs: { 'aria-label': 'Music' } };
  Object.assign(tab, {
    classList: classes(tab.cls),
    hasAttribute: (k) => k in tab.attrs, getAttribute: (k) => (k in tab.attrs ? tab.attrs[k] : null),
    setAttribute: (k, v) => { tab.attrs[k] = String(v); }, removeAttribute: (k) => { delete tab.attrs[k]; }
  });
  /* the page's own <html> classes, and no Now Playing helper tag to wait for (the harness binds its stand-in) */
  Object.assign(e.win.document, { querySelector: () => null, documentElement: { classList: classes(new Set()) } });
  const heard = [];
  e.win.addEventListener('mcc:nowplaying', (ev) => heard.push(JSON.parse(JSON.stringify(ev.detail))));
  e.win.__tab = tab;
  vm.runInContext('(function () { "use strict";\n' +
    /* a one-tab dock, and the names the block reads from the rest of js/tabbar.js */
    'var dock = { querySelector: function (s) { return s === \'[data-appnav="music"]\' ? window.__tab : null; } };\n' +
    'var HOUSE = "https://matthew.mccluster.org/", WINGS = { music: { home: "listen.html" } }, worldAudioPending = null, worldCancelTap = null;\n' +
    'function onPage(dest) { return dest === "listen.html"; }\n' +
    'function emit(n, d, cancelable) { var ev = null; try { ev = new CustomEvent(n, { detail: d || {}, cancelable: !!cancelable }); window.dispatchEvent(ev); } catch (e) {} return !!(ev && ev.defaultPrevented); }\n' +
    src.slice(from, to) + '\nwindow.__bar = { transport: transport };\n})();', e.win, { filename: 'js/tabbar.js' });
  return {
    transport: () => e.win.__bar.transport(),
    told: () => tab.attrs['aria-label'],
    sound: () => tab.cls.has('is-sound'),
    heard
  };
}

test('on the listen page a Play straight after the bar\'s Pause, before its look for an answer, leaves the Music tab the player\'s Pause (PR #825 CI)', async (t) => {
  /* the second tap is the CI case; any resume while the first tap's look is pending reached the same state */
  for (const [how, resume] of [
    ['a second tap on the Music tab', (e, bar) => bar.transport()],
    ['the mini player\'s Play', (e) => e.music.toggle()],
    ['the lock screen\'s play', (e) => e.np().spec.play()]
  ]) await t.test(how, async () => {
    const c = clockOf();
    const e = engine({ clock: c, path: '/listen.html' });
    const bar = barOn(e);
    await e.play('Full song');
    assert.equal(bar.told(), 'Pause music', how);
    assert.equal(bar.sound(), true, how);
    bar.transport();                                 // Pause: the engine answers at once (playing:false)
    assert.equal(e.music.audio.paused, true, how);
    assert.equal(bar.told(), 'Play music', how);
    resume(e, bar);                                  // Play, before the first tap's 0 ms look has run
    assert.equal(e.music.audio.paused, false, how);
    await c.tick(1);                                 // the looks run now, after the engine said the song plays again
    assert.equal(bar.sound(), e.music.playing(), `${how}: the tab follows the engine, as the mini player does`);
    assert.equal(bar.told(), 'Pause music', `${how}: told as what a tap does (it said "Play music" over a playing song)`);
    assert.equal(e.attr('musicMiniPlay', 'aria-label'), 'Pause', how);
    assert.deepEqual(bar.heard.filter((d) => d.href !== '#np'), [], `${how}: nothing but the player spoke for the music`);
    for (let i = 0; i < 8; i++) { e.music.audio.currentTime += .25; e.music.audio.fire('timeupdate'); }
    assert.equal(bar.told(), 'Pause music', `${how}: and it stays so while the song plays`);
    bar.transport();                                 // one more tap is the player's Pause (stuck, it was a Play that did nothing)
    assert.equal(e.music.audio.paused, true, `${how}: one more tap pauses the song`);
    await c.tick(1);
    assert.equal(bar.told(), 'Play music', how);
  });
});

test('the bar still says nothing plays when a page never answers its Pause (the look\'s own job, kept)', async () => {
  const c = clockOf();
  const e = engine({ clock: c, path: '/listen.html' });
  const bar = barOn(e);
  /* a deck that said it plays and then never answers the bar: a refusing deck, or a later player that forgets */
  e.win.MCC_NP_PLAY = () => {};
  e.win.MCC_NP_PAUSE = () => {};
  e.win.dispatchEvent(new e.win.CustomEvent('mcc:nowplaying', { detail: { title: 'Deck song', href: '#np', playing: true } }));
  assert.equal(bar.told(), 'Pause music');
  bar.transport();
  bar.transport();                                 // two taps, neither answered
  assert.equal(bar.told(), 'Pause music', 'nothing answered yet');
  await c.tick(1);
  assert.equal(bar.sound(), false, 'the one thing the bar can see for certain: nothing is playing');
  assert.equal(bar.told(), 'Play music');
  assert.deepEqual(bar.heard.slice(1), [{ title: 'I AM HERE', href: 'https://matthew.mccluster.org/album.html', playing: false }],
    'said once, on the wire, for the pages that listen there');
  bar.transport();                                 // a Play the page never answers: already silent, nothing more to say
  await c.tick(1);
  assert.equal(bar.heard.length, 2);
});

/* ------------------------------------------------------------------------------------------------------
   MUTED LASTS (the Release 1 dock fix, 2026-11-23). The installed app's dock gives the player's trouble words a row of
   their own above its controls: they do not fit the song line, and they pass in seconds. Muted came the same way, in
   status(), and grew the dock to two rows for as long as the song stayed muted. Each player now says it apart, as a
   lasting note the dock puts in the song line's second line (js/now-playing.js snapshot().note); status() keeps the
   passing trouble only. Each case below failed at the release head 22bfd37d.
   ------------------------------------------------------------------------------------------------------ */
test('the engine says Muted as a lasting note, never as a status: the dock stays one row', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  const spec = e.np().spec;
  assert.equal(typeof spec.note, 'function', 'a lasting word for the song line');
  assert.deepEqual([spec.status(), spec.note()], ['', '']);
  e.music.audio.muted = true;
  assert.equal(spec.status(), '', 'Muted is no trouble: the dock adds no status row for it');
  assert.equal(spec.note(), 'Muted', 'the engine\'s own word, for the song line');
  e.music.audio.currentTime = 60;
  e.music.audio.fail(2);
  assert.equal(spec.status(), 'Reconnecting…', 'the trouble keeps its words and its row');
  assert.equal(spec.note(), 'Muted', 'and the song is still muted');
  e.music.audio.muted = false;
  assert.equal(spec.note(), '');
});

test('the album says Muted as a lasting note, never as a status: the dock stays one row', () => {
  const source = read('album.html');
  const begin = source.indexOf('    function nowPlaying() {');
  const end = source.indexOf('    function media() {', begin);
  assert.ok(begin > 0 && end > begin, 'the deck\'s Now Playing binding');
  let spec = null, line = '';
  const deck = { muted: false };
  const context = { deck, cur: -1, rows: [], ARTIST: 'Fixture artist', document: { getElementById: () => ({ textContent: '', getAttribute: () => '' }) },
    window: { MCC_NOW_PLAYING: { bind: (media, s) => { spec = s; return {}; } } },
    play() {}, pauseDeck() {}, prev() {}, next() {}, userSeek() {}, deckIntends: () => true, deckStatusLine: () => line };
  vm.runInContext('var np = null;\n' + source.slice(begin, end) + '\nnowPlaying();', vm.createContext(context), { filename: 'album.html now playing' });
  assert.equal(typeof spec.note, 'function', 'a lasting word for the song line');
  assert.deepEqual([spec.status(), spec.note()], ['', '']);
  deck.muted = true;
  assert.equal(spec.status(), '', 'Muted is no trouble: the dock adds no status row for it');
  assert.equal(spec.note(), 'Muted');
  line = 'Reconnecting…';
  assert.equal(spec.status(), 'Reconnecting…', 'the trouble keeps its words and its row');
  assert.equal(spec.note(), 'Muted');
  deck.muted = false; line = '';
  assert.deepEqual([spec.status(), spec.note()], ['', '']);
});
