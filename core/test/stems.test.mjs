import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStemsManifest, storeStems, stemPath, stemsKeyValid, newRunId } from '../src/lyrics/stems.mjs';
import { stemsSeparate, shelfAudioUrl } from '../src/executors/stems-separate.mjs';
import { lyricsAlign } from '../src/executors/lyrics-align.mjs';

const SHA = 'a'.repeat(64);
const stem = (name, extra = {}) => ({ stem: name, file: `${name}.mp3`, format: 'mp3', bytes: 1000, sha256: SHA, seconds: 120.2, peak_dbfs: -1.2, rms_dbfs: -17.4, ...extra });
const MANIFEST = { version: 1, separator: 'demucs', model: 'htdemucs_6s', format: 'mp3', seconds: 120.205, sources: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'],
  stems: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano', 'instrumental'].map((n) => stem(n)), timing: { separate_seconds: 45.4 } };

test('a six-stem manifest is valid; the schema names what is wrong', () => {
  assert.deepEqual(validateStemsManifest(MANIFEST), []);
  const four = { ...MANIFEST, model: 'htdemucs', stems: ['drums', 'bass', 'other', 'vocals', 'instrumental'].map((n) => stem(n)) };
  assert.deepEqual(validateStemsManifest(four), []);
  const bad = { ...MANIFEST, stems: [stem('vocals', { file: '../x.mp3', sha256: 'nope', seconds: 3, peak_dbfs: 4 }), stem('drums'), stem('drums')] };
  const errs = validateStemsManifest(bad).join('\n');
  for (const want of [/missing instrumental/, /htdemucs_6s must give bass/, /file must be vocals\.mp3/, /sha256 required/, /length differs/, /peak_dbfs must be dBFS/, /stems repeat/]) assert.match(errs, want);
  assert.ok(validateStemsManifest({ ...MANIFEST, separator: 'audioshake' }).length);
});

test('stems keys are a shelf slug or ct-<creator track uuid>, and paths stay under stems/', () => {
  assert.ok(stemsKeyValid('hundun-b-side'));
  assert.ok(stemsKeyValid('ct-123e4567-e89b-42d3-a456-426614174000'));
  for (const bad of ['../etc', 'Hundun', 'a/b', '']) assert.equal(stemsKeyValid(bad), false, bad);
  assert.equal(stemPath('test-drive', 'drums.mp3'), 'stems/test-drive/drums.mp3');
});

function fakeStore({ previous = [], failUploadAt = -1, failManifest = false } = {}) {
  const calls = [];
  let uploads = 0;
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, init });
    if (method === 'GET') return { ok: true, status: 200, json: async () => (previous.length ? [{ manifest: { stems: previous.map((p) => ({ path: p })) } }] : []) };
    if (method === 'POST' && url.includes('/storage/v1/object/')) { uploads += 1; return uploads - 1 === failUploadAt ? { ok: false, status: 503 } : { ok: true, status: 200 }; }
    if (method === 'POST' && url.includes('/rest/v1/music_stem_sets')) return failManifest ? { ok: false, status: 500 } : { ok: true, status: 201 };
    if (method === 'DELETE') return { ok: true, status: 200 };
    return { ok: false, status: 404 };
  };
  return { calls, deps: { env: { url: 'https://sb.test', key: 'sb_secret_x' }, readFile: async (p) => Buffer.from(p), fetch } };
}
const RUN = 'r20261031184512-3fa9c1';
const OLD = ['stems/repo-guy-b-side/r20261030120000-000001/drums.mp3', 'stems/repo-guy-b-side/r20261030120000-000001/vocals.mp3'];

test('storeStems publishes a new run under its own prefix, flips the manifest, then retires the old run', async () => {
  const { calls, deps } = fakeStore({ previous: OLD });
  const out = await storeStems({ trackKey: 'repo-guy-b-side', dir: '/tmp/x', manifest: MANIFEST, runId: RUN }, deps);
  assert.equal(out.stems, 7);
  assert.equal(out.runId, RUN);
  const uploads = calls.filter((c) => c.method === 'POST' && c.url.includes('/storage/v1/object/'));
  assert.equal(uploads.length, 7);
  assert.equal(uploads[0].url, `https://sb.test/storage/v1/object/mcc-gated-audio/stems/repo-guy-b-side/${RUN}/drums.mp3`);
  assert.equal(uploads[0].init.headers['x-upsert'], 'false', 'a new run never overwrites a live object');
  assert.equal(uploads[0].init.headers['content-type'], 'audio/mpeg');
  const order = calls.map((c) => (c.url.includes('music_stem_sets') && c.method === 'POST' ? 'flip' : c.method === 'DELETE' ? 'retire' : c.method === 'POST' ? 'upload' : 'read'));
  assert.ok(order.lastIndexOf('upload') < order.indexOf('flip') && order.indexOf('flip') < order.indexOf('retire'), order.join(','));
  const row = JSON.parse(calls.find((c) => c.url.includes('/rest/v1/music_stem_sets') && c.method === 'POST').init.body);
  assert.equal(row.track_key, 'repo-guy-b-side');
  assert.equal(row.manifest.run_id, RUN);
  assert.ok(row.manifest.stems.every((s) => s.path.startsWith(`stems/repo-guy-b-side/${RUN}/`)));
  assert.deepEqual(JSON.parse(calls.find((c) => c.method === 'DELETE').init.body).prefixes, OLD);
  await assert.rejects(storeStems({ trackKey: '../x', dir: '/', manifest: MANIFEST }, deps), /bad stems key/);
  await assert.rejects(storeStems({ trackKey: 'x', dir: '/', manifest: { ...MANIFEST, stems: [] } }, deps), /manifest refused/);
  await assert.rejects(storeStems({ trackKey: 'x', dir: '/', manifest: MANIFEST, runId: '../r' }, deps), /bad run id/);
});

test('a failure mid-upload leaves the live set exactly as it was', async () => {
  const { calls, deps } = fakeStore({ previous: OLD, failUploadAt: 3 });
  await assert.rejects(storeStems({ trackKey: 'repo-guy-b-side', dir: '/tmp/x', manifest: MANIFEST, runId: RUN }, deps), /stem upload refused/);
  assert.ok(!calls.some((c) => c.url.includes('/rest/v1/music_stem_sets') && c.method === 'POST'), 'the manifest never flipped');
  const dels = calls.filter((c) => c.method === 'DELETE').flatMap((c) => JSON.parse(c.init.body).prefixes);
  assert.ok(dels.every((p) => p.includes(`/${RUN}/`)), 'only the failed run\'s partial uploads are removed');
  assert.ok(!dels.some((p) => OLD.includes(p)), 'the live objects are untouched');
  assert.equal(dels.length, 3);
});

test('a refused manifest write also leaves the live set, and cleans up the new run', async () => {
  const { calls, deps } = fakeStore({ previous: OLD, failManifest: true });
  await assert.rejects(storeStems({ trackKey: 'repo-guy-b-side', dir: '/tmp/x', manifest: MANIFEST, runId: RUN }, deps), /manifest write refused/);
  const dels = calls.filter((c) => c.method === 'DELETE').flatMap((c) => JSON.parse(c.init.body).prefixes);
  assert.equal(dels.length, 7);
  assert.ok(dels.every((p) => p.includes(`/${RUN}/`)) && !dels.some((p) => OLD.includes(p)));
});

test('run ids sort by time and stay inside the path rule', () => {
  const id = newRunId(new Date('2026-10-31T18:45:12.345Z'), () => 0.5);
  assert.equal(id, 'r20261031184512-7fffff');
});

test('stems_separate: shelf audio only from the site\'s assets/audio, uploads by key', async () => {
  assert.equal(shelfAudioUrl('assets/audio/test-drive.mp3'), 'https://matthew.mccluster.org/assets/audio/test-drive.mp3');
  for (const bad of ['https://evil.example/x.mp3', 'assets/audio/../../etc/passwd', 'assets/video/a.mp4']) assert.throws(() => shelfAudioUrl(bad));
  let fetched = null, stored = null;
  const r = await stemsSeparate({ input: { source: 'shelf', track_key: 'test-drive', src: 'assets/audio/test-drive.mp3' } }, {
    fetchTo: async (url) => { fetched = url; },
    separator: { run: async () => ({ manifest: MANIFEST }) },
    storeStems: async (a) => { stored = a; return { stems: 7, bytes: 7000 }; },
  });
  assert.equal(fetched, 'https://matthew.mccluster.org/assets/audio/test-drive.mp3');
  assert.equal(stored.trackKey, 'test-drive');
  assert.equal(stored.source, 'shelf');
  assert.equal(r.stems, 7);
  await assert.rejects(stemsSeparate({ input: { source: 'shelf', track_key: 'ct-123e4567-e89b-42d3-a456-426614174000' } }), /shelf/);
});

test('stems_separate: an upload separates its master and keys stems by ct-<id>', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  process.env.SUPABASE_URL = 'https://sb.test'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_x';
  let url = null, stored = null;
  await stemsSeparate({ input: { source: 'creator', track_id: id } }, {
    rest: async () => ({ body: [{ id, title: 'Up', master_bucket: 'creator-masters', master_path: 'u/1-song.wav' }] }),
    fetchTo: async (u, to, headers) => { url = u; assert.ok(headers.apikey); },
    separator: { run: async () => ({ manifest: MANIFEST }) },
    storeStems: async (a) => { stored = a; return { stems: 7, bytes: 1 }; },
  });
  assert.equal(url, 'https://sb.test/storage/v1/object/creator-masters/u/1-song.wav');
  assert.equal(stored.trackKey, `ct-${id}`);
  assert.equal(stored.creatorTrackId, id);
});

test('lyrics_align keeps the stems its separation made, and a stems failure never sinks the lyrics', async () => {
  const id = '123e4567-e89b-42d3-a456-426614174000';
  const rest = async (path, init = {}) => (init.method ? { body: [{ id }] } : { body: [{ id, title: 'Up', master_bucket: 'b', master_path: 'p.mp3', lyrics: null, lyrics_sheet: '' }] });
  const doc = { source: 'auto', reviewed: false, timed: { line: [] }, machine: {} };
  let stored = null;
  const ok = await lyricsAlign({ input: { track_id: id } }, { rest, download: async () => {}, transcribe: async () => ({ doc: { ...doc }, stems: MANIFEST, stemsDir: '/tmp/s' }), storeStems: async (a) => { stored = a; return { stems: 7 }; } });
  assert.equal(stored.trackKey, `ct-${id}`);
  assert.deepEqual(ok.stems, { stems: 7 });
  const failed = await lyricsAlign({ input: { track_id: id } }, { rest, download: async () => {}, transcribe: async () => ({ doc: { ...doc }, stems: MANIFEST, stemsDir: '/tmp/s' }), storeStems: async () => { throw new Error('bucket down'); } });
  assert.equal(failed.written, true);
  assert.match(failed.stems.error, /bucket down/);
});
