import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStemsManifest, storeStems, stemPath, stemsKeyValid } from '../src/lyrics/stems.mjs';
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

test('storeStems uploads every stem privately (upsert) and records the manifest', async () => {
  const calls = [];
  const out = await storeStems({ trackKey: 'repo-guy-b-side', dir: '/tmp/x', manifest: MANIFEST }, {
    env: { url: 'https://sb.test', key: 'sb_secret_x' },
    readFile: async (p) => Buffer.from(p),
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; },
  });
  assert.equal(out.stems, 7);
  const uploads = calls.filter((c) => c.url.includes('/storage/v1/object/'));
  assert.equal(uploads.length, 7);
  assert.equal(uploads[0].url, 'https://sb.test/storage/v1/object/mcc-gated-audio/stems/repo-guy-b-side/drums.mp3');
  assert.equal(uploads[0].init.headers['x-upsert'], 'true');
  assert.equal(uploads[0].init.headers['content-type'], 'audio/mpeg');
  const row = JSON.parse(calls.find((c) => c.url.includes('/rest/v1/music_stem_sets')).init.body);
  assert.equal(row.track_key, 'repo-guy-b-side');
  assert.equal(row.model, 'htdemucs_6s');
  assert.equal(row.manifest.bucket, 'mcc-gated-audio');
  assert.ok(row.manifest.stems.every((s) => s.path.startsWith('stems/repo-guy-b-side/')));
  await assert.rejects(storeStems({ trackKey: '../x', dir: '/', manifest: MANIFEST }, { env: { url: 'u', key: 'k' } }), /bad stems key/);
  await assert.rejects(storeStems({ trackKey: 'x', dir: '/', manifest: { ...MANIFEST, stems: [] } }, { env: { url: 'u', key: 'k' } }), /manifest refused/);
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
