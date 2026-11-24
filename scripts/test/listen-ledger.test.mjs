/* The browser half of the listen ledger. The server decides what counts;
   this file must only ever report time the audio was actually playing,
   and hand an open listen to the next page for the same song only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function load() {
  const src = await readFile('js/listen-ledger.js', 'utf8');
  const store = new Map();
  const posts = [];
  const timers = [];
  const window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    clearInterval: (id) => { timers[id - 1] = null; },
    dispatchEvent() {}
  };
  store.set('mccdb_session', JSON.stringify({ access_token: 't' }));
  const fetch = async (url, init) => {
    posts.push({ url, body: init.body });
    const id = '11111111-1111-4111-8111-111111111111';
    return { ok: true, json: async () => (url.endsWith('/v1/music/listens') ? { listen_id: id } : { counted: true }) };
  };
  vm.runInNewContext(src, { window, fetch, JSON, Date, Promise, CustomEvent: class {} });
  return { L: window.MCC_LISTENS, posts, timers, store };
}
const tick = (timers) => timers.forEach((fn) => fn && fn());
const flush = () => new Promise((r) => setTimeout(r, 0));

test('beats are sent only while the audio is playing', async () => {
  const { L, posts, timers } = await load();
  let playing = false;
  const h = L.start('here', () => playing);
  await flush();
  tick(timers);
  assert.equal(posts.filter((p) => p.url.endsWith('/beat')).length, 0, 'a paused song must not beat');
  playing = true;
  tick(timers);
  assert.equal(posts.filter((p) => p.url.endsWith('/beat')).length, 1);
  await L.finish(h);
  tick(timers);
  assert.equal(posts.filter((p) => p.url.endsWith('/beat')).length, 1, 'a finished listen stops beating');
});

test('another page adopts the open listen for the same song only, until it finishes', async () => {
  const { L, store } = await load();
  const h = L.start('here', () => true);
  await flush();
  assert.equal(L.adopt('upset', () => true), null, 'a different song is not adopted');
  const a = L.adopt('here', () => true);
  assert.ok(a, 'the same song is adopted');
  assert.equal(await a.id, '11111111-1111-4111-8111-111111111111');
  await L.finish(a);
  assert.equal(store.has('mcc_listen_open'), false, 'a finished listen is not handed on');
  assert.equal(L.adopt('here', () => true), null);
  L.release(h);
});

test('the browser never tells the server how long a song is', async () => {
  const src = await readFile('js/listen-ledger.js', 'utf8');
  assert.doesNotMatch(src, /seconds\s*:|duration/);
});

/* A FULLY HEARD SONG IS COUNTED EVEN WHEN THE NEXT ONE STARTS AT ONCE (music slice M3; music map 02,
   DEL-4). The album's and the engine's ended handlers finish song A and start song B in the same
   moment. The two requests went out independently, and when B's start reached the database first,
   music_listen_start closed A as not completed (scripts: listen_race.sh on PostgreSQL 16 with the
   real migrations; production held 55 such rows). The start now waits for the finish to come back
   (for at most a few seconds, so a finish that never answers cannot stop the next song counting). */
async function ordered() {
  const src = await readFile('js/listen-ledger.js', 'utf8');
  const store = new Map([['mccdb_session', JSON.stringify({ access_token: 't' })]]);
  const sent = [], finishes = [], timers = new Map();
  let id = 0, timerId = 0;
  const window = {
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    setInterval: () => 0, clearInterval() {},
    setTimeout: (fn, ms) => { const k = ++timerId; timers.set(k, { fn, ms }); return k; },
    clearTimeout: (k) => timers.delete(k),
    dispatchEvent() {}
  };
  const fetch = (url, init) => {
    const body = JSON.parse(init.body || '{}');
    if (url.endsWith('/v1/music/listens')) {
      sent.push('start:' + body.track);
      const listen = `0000000${++id}-1111-4111-8111-111111111111`;
      return Promise.resolve({ ok: true, json: async () => ({ listen_id: listen }) });
    }
    if (url.endsWith('/finish')) {
      sent.push('finish');
      let answer; const p = new Promise((r) => { answer = r; });
      finishes.push(() => answer({ ok: true, json: async () => ({ counted: true }) }));
      return p;
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  vm.runInNewContext(src, { window, fetch, JSON, Date, Promise, CustomEvent: class {} });
  return { L: window.MCC_LISTENS, sent, finishes, timers };
}

test('a finished song reaches the ledger before the next song\'s start does', async () => {
  const { L, sent, finishes } = await ordered();
  const a = L.start('dealer-plates', () => true);
  await a.id;
  const done = L.finish(a);
  const b = L.start('pull-up', () => true);       // the next song starts in the same moment
  await flush(); await flush();
  assert.deepEqual(sent, ['start:dealer-plates', 'finish'], 'the next start waits for the finish');
  finishes.shift()();
  await done; await b.id;
  assert.deepEqual(sent, ['start:dealer-plates', 'finish', 'start:pull-up']);
});

test('a finish that never answers does not stop the next song counting', async () => {
  const { L, sent, timers } = await ordered();
  const a = L.start('dealer-plates', () => true);
  await a.id;
  L.finish(a);
  const b = L.start('pull-up', () => true);
  await flush(); await flush();
  assert.deepEqual(sent, ['start:dealer-plates', 'finish']);
  const cap = [...timers.values()].find((t) => t.ms > 0 && t.ms <= 8000);
  assert.ok(cap, 'a bounded wait, not an endless one');
  cap.fn();
  await b.id;
  assert.deepEqual(sent, ['start:dealer-plates', 'finish', 'start:pull-up']);
});

/* THE WAIT FITS THE SHORTEST SONG (music slice M3 follow-up; review PB-R10). A song's listen is credited from the moment
   its start reaches the database (music_listen_start sets last_beat_at to now(); each beat and the finish add the time
   since), and the Worker counts it once floor(seconds x 0.95) seconds are heard (workers/mccluster/src/music/router.js).
   So the time the next start waits for the previous finish comes out of the next song's margin. The shortest catalogue
   song, Towyard Killer, lasts 65.7 s and counts after 62 s: 3.7 s. A wait of up to 5 s could leave it uncounted. The
   wait is half the smallest margin in the catalogue now (scripts/music-track-lengths.mjs writes it), so the start's own
   trip and a hidden page's late timers keep the other half. */
test('the wait for the previous finish leaves the shortest song its margin (Towyard Killer: 65.7 s, counted after 62 s)', async () => {
  const { TRACKS } = await import('../../workers/mccluster/src/music/tracks.js');
  const { COUNT_SHARE } = await import('../../workers/mccluster/src/music/router.js');
  const songs = Object.entries(TRACKS).filter(([, t]) => !t.gated).map(([key, t]) => {
    const need = Math.max(1, Math.floor(t.seconds * COUNT_SHARE));
    return { key, seconds: t.seconds, need, margin: Math.round((t.seconds - need) * 10) / 10 };
  }).sort((a, b) => a.margin - b.margin);
  const shortest = songs[0];
  assert.deepEqual(shortest, { key: 'towyard-killer', seconds: 65.7, need: 62, margin: 3.7 }, 'the smallest margin in the catalogue');
  /* song A has ended and its finish has not answered; song B, the shortest, starts at once */
  const { L, sent, timers } = await ordered();
  const a = L.start('lightroom', () => true);
  await a.id;
  L.finish(a);
  const b = L.start(shortest.key, () => true);
  await flush(); await flush();
  assert.deepEqual(sent, ['start:lightroom', 'finish'], 'the start still waits for the finish (DEL-4)');
  const wait = [...timers.values()].find((t) => t.ms > 0 && t.ms <= 8000);
  assert.ok(wait, 'a bounded wait');
  assert.equal(wait.ms, Math.floor(shortest.margin * 1000 / 2), 'half the smallest margin, from the catalogue: 1850 ms');
  /* the database credits B from its start's arrival to its finish's: the song's length less the wait */
  const credited = Math.round((shortest.seconds - wait.ms / 1000) * 100) / 100;
  assert.ok(credited >= shortest.need, `Towyard Killer is credited ${credited} s of the ${shortest.need} s it needs (a 5 s wait left 60.7 s)`);
  wait.fn();
  await b.id;
  assert.deepEqual(sent, ['start:lightroom', 'finish', 'start:towyard-killer']);
});

/* EACH SONG'S START WAITS ONLY AS LONG AS ITS OWN MARGIN ALLOWS (music slice M3 follow-up; review RF-1). One wait for the
   whole catalogue, half the smallest margin (1.85 s), kept the shortest song's count but cost the song just heard whenever
   its finish took longer than 1.85 s, before every song: on PostgreSQL 16 with the real migrations a 5 s wait kept both
   songs to about 4 s, and 1.85 s lost the first from 1.9 s whatever came next. A completed listen is what answers the song
   test and earns the gated closer's play (supabase/migrations/20261002015418_song_test.sql,
   20261002163249_music_gate_any_album_track.sql). start(key) knows the next song, so each song waits half its own margin,
   5 s at most: Towyard Killer 1.85 s as before, Pull Up 4.2 s, the long songs the full 5 s. */
const waitBeforeStart = async (key) => {
  const { L, timers } = await ordered();
  const a = L.start('lightroom', () => true);
  await a.id;
  L.finish(a);                                     // its finish has not answered
  L.start(key, () => true);
  await flush(); await flush();
  const wait = [...timers.values()].find((t) => t.ms > 0);
  return wait ? wait.ms : null;
};
test('each song\'s start waits for the last finish at most half its own margin, and 5 s at most (review RF-1)', async () => {
  const { TRACKS } = await import('../../workers/mccluster/src/music/tracks.js');
  const { COUNT_SHARE } = await import('../../workers/mccluster/src/music/router.js');
  const songs = Object.entries(TRACKS).filter(([, t]) => !t.gated);
  assert.ok(songs.length >= 40, 'every song the catalogue counts');
  const got = {};
  for (const [key, t] of songs) {
    const need = Math.max(1, Math.floor(t.seconds * COUNT_SHARE)), tenths = Math.round((t.seconds - need) * 10);
    got[key] = await waitBeforeStart(key);
    assert.equal(got[key], Math.min(5000, tenths * 50), `${key} (${t.seconds} s, counted after ${need} s): half its margin of ${tenths / 10} s, 5 s at most`);
    assert.ok(t.seconds - got[key] / 1000 >= need + tenths / 20 - 0.001, `${key} keeps at least half its margin for its own start's trip`);
  }
  assert.deepEqual({ towyard: got['towyard-killer'], pullUp: got['pull-up'], dataBreach: got['data-breach'] },
    { towyard: 1850, pullUp: 4200, dataBreach: 5000 }, 'the shortest margin, a middle one and a long song');
});

test('a finish 2.5 s slow still reaches the ledger before Pull Up starts, so the song just heard counts (review RF-1)', async () => {
  const { L, sent, finishes, timers } = await ordered();
  const a = L.start('dealer-plates', () => true);
  await a.id;
  const done = L.finish(a);
  const b = L.start('pull-up', () => true);
  await flush(); await flush();
  /* 2.5 s go by with the finish still on its way: every wait due by then runs out */
  for (const [k, t] of [...timers]) if (t.ms > 0 && t.ms <= 2500) { timers.delete(k); t.fn(); }
  await flush(); await flush();
  assert.deepEqual(sent, ['start:dealer-plates', 'finish'],
    'at 2.5 s Pull Up\'s start still waits (one 1.85 s wait sent it, and the database closed the song just heard as unfinished)');
  finishes.shift()();
  await done; await b.id;
  assert.deepEqual(sent, ['start:dealer-plates', 'finish', 'start:pull-up']);
});

test('a song the catalogue does not count waits the full 5 s for the last finish (nothing of its own to lose)', async () => {
  /* the Worker answers a start for a track it does not know with 404 and a gated one with no listen
     (workers/mccluster/src/music/router.js startListen), so only the song just heard is at stake */
  assert.equal(await waitBeforeStart('niggy-nigg'), 5000, 'the gated closer');
  assert.equal(await waitBeforeStart('not-in-the-catalogue'), 5000);
});

/* A shorter next song can exhaust its wait before an abandoned longer one. The old deferred
   start then closed the actual playing listen as incomplete and replaced its saved handle. */
test('releasing a deferred start prevents it from superseding a newer, shorter-wait song', async () => {
  const { L, sent, finishes, timers } = await ordered();
  const first = L.start('lightroom', () => true);
  await first.id;
  const done = L.finish(first);
  const abandoned = L.start('data-breach', () => true);
  L.release(abandoned);
  const playing = L.start('towyard-killer', () => true);
  await flush();
  for (const t of [...timers.values()].sort((a, b) => a.ms - b.ms)) { t.fn(); await flush(); }
  await playing.id;
  assert.equal(await abandoned.id, null, 'the released song never opens a listen');
  assert.deepEqual(sent, ['start:lightroom', 'finish', 'start:towyard-killer']);
  finishes.shift()();
  await done;
});

test('a newer selection cancels a deferred start even if its old handle was not released', async () => {
  const { L, sent, finishes } = await ordered();
  const first = L.start('lightroom', () => true);
  await first.id;
  const done = L.finish(first);
  const abandoned = L.start('data-breach', () => true);
  const playing = L.start('towyard-killer', () => true);
  await flush();
  finishes.shift()();
  await done; await playing.id;
  assert.equal(await abandoned.id, null);
  assert.deepEqual(sent, ['start:lightroom', 'finish', 'start:towyard-killer']);
});

/* A FINISHED SONG'S WAITING START IS NEVER SENT (Release 1 review CX-1, its last leg; a follow-up to 3f12e039, which
   holds back a start that was released or that a newer start came after). The pocket player rolls on from a song by
   finishing it (js/pip.js roll() at the end of its queue), and when that song's start is still waiting for the last
   finish there may be no newer start to supersede it: the start then left anyway, and its finish after it, a listen
   opened and closed for a song that was left at once. A start that is still waiting is not sent for a song this page
   has finished, and a song that left no start has no finish to send. */
/* time goes by with the last finish still out: every wait still pending runs out, the shortest first */
async function waitsRunOut(timers) {
  for (;;) {
    await flush(); await flush();
    const next = [...timers].filter(([, t]) => t.ms > 0).sort((x, y) => x[1].ms - y[1].ms)[0];
    if (!next) break;
    timers.delete(next[0]);
    next[1].fn();
  }
  await flush(); await flush();
}
test('the pocket player moving on from a song whose start still waits sends neither that start nor its finish (review CX-1)', async () => {
  const { L, sent, timers } = await ordered();
  const a = L.start('dealer-plates', () => true);
  await a.id;
  L.finish(a);
  const b = L.start('pull-up', () => true);                 // the pocket player plays the next song
  const rolled = L.finish(b);                               // and rolls on from it at once (js/pip.js roll() finishes it)
  await waitsRunOut(timers);
  assert.deepEqual(sent, ['start:dealer-plates', 'finish'], 'no start and no finish for the song left');
  assert.equal(await rolled, null, 'nothing to count');
});
