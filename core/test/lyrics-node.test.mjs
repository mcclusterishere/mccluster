import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptedAudioUrl, executeLyricsTask, lyricsFabricConfig, offloadLyrics, signMaster, LYRICS_CAPABILITY } from '../src/compute/lyrics-node.mjs';
import { lyricsAlign } from '../src/executors/lyrics-align.mjs';
import { validateLyrics } from '../src/lyrics/align.mjs';

const SIGNED = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/sign/creator-masters/u/1-song.mp3?token=abc';
const DOC = { source: 'aligned', reviewed: false, plain: 'one two', duration_seconds: 10,
  timed: { line: [{ begin: 1, end: 3, content: 'one two', words: [{ begin: 1, end: 2, content: 'one' }, { begin: 2, end: 3, content: 'two' }] }] } };

test('a node takes a master only from a signed URL on an allowed storage host', () => {
  assert.equal(acceptedAudioUrl(SIGNED).hostname, 'zmnhbrjyhxzhkxmhkexs.supabase.co');
  for (const bad of ['http://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/sign/a/b?token=x', 'https://evil.example/storage/v1/object/sign/a/b?token=x',
    'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/a/b', 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/sign/a/b',
    'https://u:p@zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/sign/a/b?token=x', 'not a url']) {
    assert.throws(() => acceptedAudioUrl(bad), /audio_url/, bad);
  }
  assert.equal(acceptedAudioUrl('https://storage.test/storage/v1/object/sign/a/b?token=x', ['storage.test']).hostname, 'storage.test');
});

test('node side: fetch the master, run the same pipeline, return a validated document', async () => {
  let fetched = null, ran = null;
  const fetchImpl = async (url) => { fetched = url; return new Response(Buffer.alloc(16), { status: 200, headers: { 'content-length': '16' } }); };
  const out = await executeLyricsTask({ audio_url: SIGNED, audio_ext: '.mp3', sheet_text: 'one two', title: 'Song' }, {
    fetchImpl, transcribe: async (args) => { ran = args; return { doc: DOC }; }
  });
  assert.equal(fetched, SIGNED);
  assert.equal(ran.sheetText, 'one two');
  assert.match(ran.audio, /master\.mp3$/);
  assert.deepEqual(out.doc, DOC);
  await assert.rejects(executeLyricsTask({ audio_url: SIGNED }, { fetchImpl, transcribe: async () => ({ doc: { plain: 1 } }) }), (e) => e.code === 'LYRICS_INVALID' && e.retryable === true);
  await assert.rejects(executeLyricsTask({ audio_url: SIGNED }, { fetchImpl: async () => new Response('', { status: 403 }), transcribe: async () => ({ doc: DOC }) }), (e) => e.code === 'LYRICS_AUDIO_FETCH');
  await assert.rejects(executeLyricsTask({ audio_url: SIGNED }, { maxBytes: 8, fetchImpl, transcribe: async () => ({ doc: DOC }) }), (e) => e.code === 'LYRICS_AUDIO_TOO_LARGE');
});

function core({ live = [], wait, enqueued = [] } = {}) {
  return {
    config: lyricsFabricConfig({}),
    live: async () => live,
    sign: async ({ bucket, path }) => `https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t`,
    enqueue: async (args) => { enqueued.push(args); return { task: { id: 'task-1' }, replayed: false }; },
    wait: wait || (async () => ({ task: { status: 'done', output: { doc: DOC }, locked_by_node_id: 'node_laptop' } })),
    log: () => {}
  };
}
const JOB = { id: 'job-1', org_id: '00000000-0000-4000-8000-000000000001', attempts: 1 };
const TRACK = { id: '123e4567-e89b-42d3-a456-426614174000', title: 'Song', master_bucket: 'creator-masters', master_path: 'u/1-song.mp3' };
const LAPTOP = { capability: LYRICS_CAPABILITY, implementation: 'lyrics.machine.local', node_id: 'node_laptop', node_name: 'prime-hp' };
const OVH = { ...LAPTOP, node_id: 'node_ovh', node_name: 'ovh-primary' };

test('Core side: owned nodes first, the paid box last, and never a second run', async () => {
  assert.equal(await offloadLyrics({ job: JOB, track: TRACK }, core()), null, 'no live node: run here');
  assert.equal(await offloadLyrics({ job: JOB, track: TRACK }, core({ live: [OVH] })), null, 'the OVH box runs its own copy locally, not through the queue');
  assert.equal(await offloadLyrics({ job: { ...JOB, org_id: null }, track: TRACK }, core({ live: [LAPTOP] })), null);
  const enqueued = [];
  const done = await offloadLyrics({ job: JOB, track: TRACK, sheetText: 'one two' }, core({ live: [LAPTOP, OVH], enqueued }));
  assert.deepEqual(done.doc, DOC);
  assert.equal(done.node_id, 'node_laptop');
  assert.equal(enqueued[0].capability, LYRICS_CAPABILITY);
  assert.match(enqueued[0].input.audio_url, /\/storage\/v1\/object\/sign\/creator-masters\/u\/1-song\.mp3\?token=/);
  assert.equal(enqueued[0].input.sheet_text, 'one two');
  assert.ok(!JSON.stringify(enqueued[0]).match(/service|secret|apikey/i), 'the task carries no key, only the signed URL');
  assert.equal(enqueued[0].idempotencyKey, 'lyrics-align:job-1:1');

  const takenBack = Object.assign(new Error('t'), { code: 'COMPUTE_TASK_TIMEOUT', canceled: true, task_status: 'queued' });
  assert.equal(await offloadLyrics({ job: JOB, track: TRACK }, core({ live: [LAPTOP], wait: async () => { throw takenBack; } })), null, 'still queued and taken back: run here');
  const held = Object.assign(new Error('t'), { code: 'COMPUTE_TASK_TIMEOUT', canceled: false, task_status: 'running' });
  await assert.rejects(offloadLyrics({ job: JOB, track: TRACK }, core({ live: [LAPTOP], wait: async () => { throw held; } })), (e) => e.code === 'LYRICS_NODE_STILL_RUNNING' && e.retryable === true);
  const failed = Object.assign(new Error('f'), { code: 'COMPUTE_TASK_FAILED' });
  assert.equal(await offloadLyrics({ job: JOB, track: TRACK }, core({ live: [LAPTOP], wait: async () => { throw failed; } })), null, 'a node failure: run here');
  assert.equal(await offloadLyrics({ job: JOB, track: TRACK }, core({ live: [LAPTOP], wait: async () => ({ task: { output: { doc: { plain: 3 } } } }) })), null, 'an invalid document is never written');
  assert.equal(lyricsFabricConfig({ MCCLUSTER_LYRICS_FABRIC: 'off' }).mode, 'off');
});

test('the lyric job writes a node\'s lyrics without downloading the master here, and says where it ran', async () => {
  const calls = [];
  const rest = async (path, init = {}) => {
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (!init.method) return { body: [{ ...TRACK, lyrics: null, lyrics_sheet: 'one two' }] };
    return { body: [{ id: TRACK.id }] };
  };
  const out = await lyricsAlign({ ...JOB, input: { track_id: TRACK.id } }, {
    rest,
    offload: async ({ sheetText }) => { assert.equal(sheetText, 'one two'); return { doc: structuredClone(DOC), node_id: 'node_laptop', task_id: 'task-1' }; },
    download: async () => { throw new Error('must not download on this box'); },
    transcribe: async () => { throw new Error('must not run the pipeline on this box'); }
  });
  assert.equal(out.written, true);
  assert.deepEqual(out.ran_on, { route: 'fabric', node_id: 'node_laptop', task_id: 'task-1' });
  const patch = calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.body.lyrics.machine.ran_on.route, 'fabric');
  assert.equal(validateLyrics(patch.body.lyrics).length, 0);
});

test('the master is signed for an hour with the Core\'s own headers', async () => {
  let req = null;
  const url = await signMaster({ bucket: 'creator-masters', path: 'u/1 song.mp3', seconds: 3600 }, {
    env: { SUPABASE_URL: 'https://zmnhbrjyhxzhkxmhkexs.supabase.co' }, headers: { apikey: 'k' },
    fetchImpl: async (u, init) => { req = { u, init }; return new Response(JSON.stringify({ signedURL: '/object/sign/creator-masters/u/1%20song.mp3?token=t' }), { status: 200 }); }
  });
  assert.equal(req.u, 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/sign/creator-masters/u/1%20song.mp3');
  assert.equal(JSON.parse(req.init.body).expiresIn, 3600);
  assert.equal(url, 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/sign/creator-masters/u/1%20song.mp3?token=t');
  assert.doesNotThrow(() => acceptedAudioUrl(url));
});
