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
    setTimeout: clock ? clock.setTimeout : setTimeout, clearTimeout: clock ? clock.clearTimeout : clearTimeout
  });
  if (clock) window.Date = clock.Date;
  if (options.member) window.MCC = { session: () => ({ access_token: 'fixture-token' }) };
  if (options.listens) window.MCC_LISTENS = options.listens;
  window.window = window;
  vm.runInContext(read('js/music-engine.js'), vm.createContext(window), { filename: 'js/music-engine.js' });
  return {
    music: window.MCC_MUSIC,
    claims: () => claims,
    accessCalls: () => accessCalls,
    events,
    claimWith: (fn) => { claimAnswer = fn; },
    reply: (fn) => { gateReply = fn; },
    play: (title) => window.MCC_MUSIC.play('fixture', title),
    text: (id) => node(id).textContent,
    shown: (id) => !node(id).hidden,
    attr: (id, k) => node(id).getAttribute(k)
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
  assert.equal(e.music.audio.paused, true, 'never playing over silence');
  assert.equal(e.attr('musicMiniPlay', 'aria-label'), 'Play');
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

test('retries back off, stop after a bounded number, say so, and Play picks up where it stopped', async () => {
  const c = clockOf();
  const e = engine({ clock: c });
  await e.play('Full song');
  e.music.audio.currentTime = 75;
  e.music.audio.fail(2);
  const waits = [];
  for (let i = 0; i < 4; i++) {
    const before = e.music.audio.loads.length;
    waits.push(await until(c, () => e.music.audio.loads.length > before, 50));
    assert.equal(e.music.audio.currentTime, 75);
    e.music.audio.fail(2);
  }
  assert.deepEqual(waits, [500, 1500, 3500, 7500], 'backoff, all inside the ten seconds iOS keeps a page awake after its sound stops');
  const loads = e.music.audio.loads.length;
  await c.tick(120000);
  assert.equal(e.music.audio.loads.length, loads, 'no fifth try by itself');
  assert.equal(e.music.audio.paused, true);
  assert.equal(e.text('musicMiniAccess'), 'Connection lost');
  assert.match(e.text('musicMiniNote'), /Tap play to pick up at 1:15/);
  await e.music.resume();
  await settle();
  assert.equal(e.music.audio.loads.length, loads + 1, 'Play tries again at once');
  assert.equal(e.music.audio.currentTime, 75);
  assert.equal(e.music.audio.paused, false);
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
  await c.tick(12100);
  assert.equal(e.music.audio.paused, true, 'a stall that never moves is not shown as playing');
  assert.equal(e.text('musicMiniAccess'), 'Reconnecting…');
  await c.tick(600);
  assert.equal(e.music.audio.loads.length, loads + 1);
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
  assert.ok(begin >= 0 && end > begin && ended > end && bank > ended && deckPaint >= 0 && deckPaintEnd > deckPaint);
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
  const toasts = [], spends = [], finishes = [], els = new Map();
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
    loadReel() {}, setRoom() {}, loadLyrics() {},
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
    source.slice(begin, end) + '\n' + source.slice(ended, bank) + '\n' +
    source.match(/window\.MCC_NP_PAUSE = function \(\) \{[^\n]+/)[0] + '\n' +
    source.match(/function next\(\) \{[^\n]+/)[0] + '\n' +
    source.match(/function prev\(\) \{[^\n]+/)[0] + '\n' + source.slice(seek, seekEnd) + '\n' +
    'this.player = { play: play, pause: window.MCC_NP_PAUSE, previous: prev, seek: function (t) { seekDeck(null, t / deck.duration); }, current: function () { return cur; }, ' +
    'count: function () { listen = { row: rows[cur], handle: "listen-fixture" }; } };';
  vm.runInContext(script, vm.createContext(context), { filename: 'album.html playback' });
  return { ...context.player, deck, claim, finish, claims: () => claims, toasts, spends, finishes, rows,
    text: (id) => elNode(id).textContent };
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
  await c.tick(12100);
  assert.equal(a.deck.paused, true);
  await c.tick(600);
  assert.equal(a.deck.loads.length, loads + 1);
  assert.equal(a.deck.currentTime, 31);
});
