/* A LISTENER WHO KEPT WHIP EQUIPPED OFFLINE STILL HAS ITS B-SIDE (music slice M3 follow-up; review RL-10).

   "Keep the masters" (js/label.js) saves each row's file in the vault, a cache keyed by address, and the service worker
   (sw.js) answers a media request from it before the network. Music slice M3 published Dealer Plates (B-Side) under
   its true name, assets/audio/dealer-plates-b.m4a, and left the old assets/audio/dealer-plates-b.mp3 for old links.
   A listener who kept the album before that holds the .mp3: the album now asks for the .m4a, the vault had no copy
   under that name, and offline the B-side failed until the album was kept again.

   The two names hold the same audio: the .m4a is the .mp3's own bytes with only its index moved in front of the audio
   (the M3 follow-up; scripts/test/music-track-lengths.test.mjs). So the worker answers either name from a copy kept
   under the other, labelled as the MP4 it is, and the album counts that copy as kept. Nothing is downloaded again. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url));
const ORIGIN = 'https://matthew.mccluster.org';
const OLD = ORIGIN + '/assets/audio/dealer-plates-b.mp3', NEW = ORIGIN + '/assets/audio/dealer-plates-b.m4a';

/* the real sw.js, with the browser's caches and network stood in */
function worker({ kept = {}, online = false } = {}) {
  const handlers = {}, network = [];
  const stores = new Map();
  const cacheOf = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      match: async (key) => { const k = typeof key === 'string' ? key : key.url; const hit = m.get(k); return hit ? hit.clone() : undefined; },
      put: async (key, res) => { m.set(typeof key === 'string' ? key : key.url, res); }
    };
  };
  for (const [url, { body, type }] of Object.entries(kept)) {
    stores.set('mcc-vault-v1', stores.get('mcc-vault-v1') || new Map());
    stores.get('mcc-vault-v1').set(url, new Response(body, { headers: { 'Content-Type': type } }));
  }
  const caches = {
    open: async (name) => cacheOf(name),
    match: async (req) => { for (const m of stores.values()) { const hit = m.get(typeof req === 'string' ? req : req.url); if (hit) return hit.clone(); } return undefined; },
    keys: async () => [...stores.keys()], delete: async (k) => stores.delete(k)
  };
  const context = {
    caches, Response, Request, Headers, URL, Promise, console,
    location: { origin: ORIGIN },
    fetch: async (r) => { network.push(typeof r === 'string' ? r : r.url); if (!online) throw new TypeError('Failed to fetch'); return new Response('network', { status: 200 }); },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting() {}, clients: { claim: async () => {} }, registration: {}
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(read('sw.js').toString('utf8'), context, { filename: 'sw.js' });
  return {
    network,
    async get(url, range) {
      let answer = null;
      handlers.fetch({ request: new Request(url, { headers: range ? { range } : {} }), respondWith: (p) => { answer = p; } });
      assert.ok(answer, 'the worker answers media requests itself');
      return answer;
    }
  };
}
const mp3 = read('assets/audio/dealer-plates-b.mp3'), m4a = read('assets/audio/dealer-plates-b.m4a');

test('offline, the B-side\'s new address is answered from the copy kept under its old one, as the MP4 it is', async () => {
  const w = worker({ kept: { [OLD]: { body: mp3, type: 'audio/mpeg' } } });
  const whole = await w.get(NEW);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'audio/mp4', 'labelled as what the bytes are');
  assert.deepEqual(Buffer.from(await whole.arrayBuffer()), mp3);
  const part = await w.get(NEW, 'bytes=1000-1999');   /* Safari asks in ranges */
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 1000-1999/${mp3.length}`);
  assert.deepEqual(Buffer.from(await part.arrayBuffer()), mp3.subarray(1000, 2000));
  assert.deepEqual(w.network, [], 'nothing asked of the network');
});

test('a copy kept under the new name is used as it is, either name finds the other, and a song not kept goes to the network as before', async () => {
  const both = worker({ kept: { [NEW]: { body: m4a, type: 'audio/mp4' } } });
  assert.deepEqual(Buffer.from(await (await both.get(NEW)).arrayBuffer()), m4a);
  const older = await both.get(OLD, 'bytes=0-99');      /* an old link, offline, with only the new copy kept */
  assert.equal(older.status, 206);
  assert.deepEqual(Buffer.from(await older.arrayBuffer()), m4a.subarray(0, 100));
  assert.deepEqual(both.network, []);
  const none = worker({ online: true });
  const res = await none.get(ORIGIN + '/assets/audio/pull-up.mp3', 'bytes=0-');
  assert.equal(await res.text(), 'network');
  assert.deepEqual(none.network, [ORIGIN + '/assets/audio/pull-up.mp3']);
  const other = worker({ kept: { [OLD]: { body: mp3, type: 'audio/mpeg' } } });
  await assert.rejects(other.get(ORIGIN + '/assets/audio/deep-end.m4a'), /Failed to fetch/, 'only the same audio stands in for itself');
});

/* the vault's two readers name the same pairs, and every pair is the same audio */
function pairs(src) {
  const m = /var SAME_AUDIO = (\[[^;]*\]);/.exec(src);
  assert.ok(m, 'a SAME_AUDIO table');
  return JSON.parse(m[1]).map((p) => p.map((x) => x.replace(/^\//, '')));
}
function boxes(buf) {
  const out = {};
  for (let p = 0; p + 8 <= buf.length;) {
    let size = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    if (size === 1) size = Number(buf.readBigUInt64BE(p + 8));   // a 64-bit size: the encoder wrote the audio box so
    else if (size === 0) size = buf.length - p;                  // (0: to the end of the file)
    assert.ok(size >= 8 && p + size <= buf.length, `a whole box at ${p}`);
    out[type] = buf.subarray(p, p + size);
    p += size;
  }
  return out;
}
test('the worker and the album name the same pairs, and each pair is the same audio (the index moved, nothing else)', () => {
  const sw = pairs(read('sw.js').toString('utf8')), label = pairs(read('js/label.js').toString('utf8'));
  assert.deepEqual(sw, label);
  assert.deepEqual(sw, [['assets/audio/dealer-plates-b.m4a', 'assets/audio/dealer-plates-b.mp3']]);
  for (const [a, b] of sw) {
    const x = boxes(read(a)), y = boxes(read(b));
    assert.deepEqual(Object.keys(x).sort(), Object.keys(y).sort(), `${a} and ${b}: the same boxes`);
    assert.ok(x.mdat.equals(y.mdat), 'the same audio, byte for byte');
    assert.ok(x.ftyp.equals(y.ftyp));
    assert.equal(x.moov.length, y.moov.length, 'the same index, moved');
  }
});
