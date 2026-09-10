import assert from 'node:assert/strict';
import test from 'node:test';

import { putRaw, getRaw, listRaw, archiveKey, sha256Hex, ArchiveError } from '../src/seek-first/archive.js';

/** Minimal in-memory stand-in for the R2 binding. */
function fakeBucket() {
  const store = new Map();
  return {
    store,
    async put(key, bytes, opts = {}) {
      store.set(key, {
        bytes,
        size: bytes.byteLength,
        httpMetadata: opts.httpMetadata ?? {},
        customMetadata: opts.customMetadata ?? {},
        uploaded: new Date('2026-09-10T22:00:00Z')
      });
    },
    async head(key) { return store.has(key) ? { key } : null; },
    async get(key) {
      const hit = store.get(key);
      if (!hit) return null;
      return { ...hit, async text() { return new TextDecoder().decode(hit.bytes); } };
    },
    async list({ prefix, limit = 1000 }) {
      const objects = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .slice(0, limit)
        .map(([key, v]) => ({ key, size: v.size, uploaded: v.uploaded, customMetadata: v.customMetadata }));
      return { objects, truncated: false };
    }
  };
}

const envWith = (bucket) => ({ SEEK_FIRST_ARCHIVE: bucket });

test('keys are date-partitioned by FETCH time and content-addressed', async () => {
  const hash = await sha256Hex('hello');
  const key = archiveKey({ source: 'celestrak', fetchedAt: '2026-09-10T22:09:00Z', hash });
  assert.equal(key, `raw/celestrak/2026/09/10/${hash}.json`);
});

test('an invalid digest or time is refused rather than written to a wrong key', () => {
  assert.throws(() => archiveKey({ source: 's', fetchedAt: Date.now(), hash: 'nope' }), ArchiveError);
  assert.throws(() => archiveKey({ source: 's', fetchedAt: 'not-a-date', hash: 'a'.repeat(64) }), ArchiveError);
});

test('identical bytes are stored once — an unchanged upstream costs nothing', async () => {
  const bucket = fakeBucket();
  const env = envWith(bucket);
  const body = JSON.stringify({ satellites: 4212 });
  const at = '2026-09-10T22:00:00Z';

  const first = await putRaw(env, { source: 'celestrak', body, fetchedAt: at });
  const second = await putRaw(env, { source: 'celestrak', body, fetchedAt: at });

  assert.equal(first.stored, true);
  assert.equal(second.stored, false);
  assert.equal(second.deduplicated, true);
  assert.equal(first.key, second.key);
  assert.equal(bucket.store.size, 1, 'the same payload must not occupy two objects');
});

test('changed bytes archive as a distinct object, so both states remain replayable', async () => {
  const bucket = fakeBucket();
  const env = envWith(bucket);
  const at = '2026-09-10T22:00:00Z';
  const a = await putRaw(env, { source: 'celestrak', body: '{"n":1}', fetchedAt: at });
  const b = await putRaw(env, { source: 'celestrak', body: '{"n":2}', fetchedAt: at });
  assert.notEqual(a.key, b.key);
  assert.equal(bucket.store.size, 2);
});

test('a credential in the source URL is never written into provenance', async () => {
  const bucket = fakeBucket();
  await putRaw(envWith(bucket), {
    source: 'firms',
    body: '{"fires":[]}',
    sourceUrl: 'https://firms.example.gov/api/area?MAP_KEY=SUPER_SECRET_VALUE&day=1'
  });
  const [record] = [...bucket.store.values()];
  const stored = JSON.stringify(record.customMetadata);
  assert.ok(!stored.includes('SUPER_SECRET_VALUE'), 'the API key leaked into archive metadata');
  assert.ok(!stored.includes('MAP_KEY'), 'the query string was retained');
  assert.equal(record.customMetadata.source_url, 'https://firms.example.gov/api/area');
});

test('an archived payload reads back byte-identical with its provenance', async () => {
  const bucket = fakeBucket();
  const env = envWith(bucket);
  const body = JSON.stringify({ vessels: ['VTS2863'] });
  const put = await putRaw(env, { source: 'ais', body, fetchedAt: '2026-09-10T22:00:00Z' });

  const got = await getRaw(env, put.key);
  assert.equal(got.body, body);
  assert.equal(got.provenance.sha256, put.hash);
  assert.equal(got.provenance.source, 'ais');
  assert.equal(got.provenance.fetched_at, '2026-09-10T22:00:00.000Z');
});

test('a source can be listed, and narrowed to a single UTC day', async () => {
  const bucket = fakeBucket();
  const env = envWith(bucket);
  await putRaw(env, { source: 'opensky', body: '{"a":1}', fetchedAt: '2026-09-09T10:00:00Z' });
  await putRaw(env, { source: 'opensky', body: '{"a":2}', fetchedAt: '2026-09-10T10:00:00Z' });
  await putRaw(env, { source: 'opensky', body: '{"a":3}', fetchedAt: '2026-09-10T18:00:00Z' });

  assert.equal((await listRaw(env, { source: 'opensky' })).objects.length, 3);
  const day = await listRaw(env, { source: 'opensky', day: '2026-09-10T00:00:00Z' });
  assert.equal(day.objects.length, 2);
  assert.equal(day.prefix, 'raw/opensky/2026/09/10/');
});

test('empty bodies are refused, and a missing binding fails loudly', async () => {
  await assert.rejects(() => putRaw(envWith(fakeBucket()), { source: 's', body: '' }), ArchiveError);
  await assert.rejects(() => putRaw({}, { source: 's', body: '{}' }), /not configured/);
});

test('getRaw returns null for a key that was never archived', async () => {
  assert.equal(await getRaw(envWith(fakeBucket()), 'raw/nope/2026/01/01/' + 'a'.repeat(64) + '.json'), null);
});
