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
