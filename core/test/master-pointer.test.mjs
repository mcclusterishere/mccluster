/* Core reads a release's master with its service key, so it follows the row's
   pointer only into creator-masters and only as a plain object path
   (src/storage-object-path.mjs). The database already holds master_bucket and
   master_path to the creator's own uploads; this is Core's own second check.

   lyrics_align is run with its real downloader and a recording fetch, so what
   is asserted is the request Core would actually have sent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { lyricsAlign } from '../src/executors/lyrics-align.mjs';
import { stemsSeparate } from '../src/executors/stems-separate.mjs';
import { safeObjectPath } from '../src/storage-object-path.mjs';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const MASTER = 'u/1-song.wav';
const ELSEWHERE = 'direct-sales/album/track.wav';
const DOC = () => ({ source: 'auto', reviewed: false, timed: { line: [] }, machine: {} });
const MANIFEST = { model: 'htdemucs_6s', timing: null };

/* [what, master_bucket, master_path] */
const REFUSED = [
  ['another bucket', 'mcc-gated-audio', ELSEWHERE],
  ['another bucket that only looks alike', 'creator-masters ', MASTER],
  ['a parent segment', 'creator-masters', `../mcc-gated-audio/${ELSEWHERE}`],
  ['parent segments after a folder', 'creator-masters', `u/../../mcc-gated-audio/${ELSEWHERE}`],
  ['a parent segment to another master', 'creator-masters', 'u/../someone-else/2-song.wav'],
  ['a current-directory segment', 'creator-masters', `./${MASTER}`],
  ['a leading slash', 'creator-masters', `/${MASTER}`],
  ['an empty segment', 'creator-masters', 'u//1-song.wav'],
  ['percent-encoded dots', 'creator-masters', `%2e%2e/mcc-gated-audio/${ELSEWHERE}`],
  ['a backslash', 'creator-masters', `..\\mcc-gated-audio\\${ELSEWHERE}`],
  ['a query', 'creator-masters', `${MASTER}?x=1`],
  ['a trailing newline', 'creator-masters', `${MASTER}\n`],
];

function recordingFetch() {
  const requests = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    requests.push({ sent: String(input), reached: url.pathname, apikey: init.headers?.apikey || null });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-length': '3' } });
  };
  return { requests, restore: () => { globalThis.fetch = real; } };
}
function env() {
  const before = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  process.env.SUPABASE_URL = 'https://sb.test'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_x';
  return () => {
    if (before.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = before.url;
    if (before.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = before.key;
  };
}

async function align(track) {
  const net = recordingFetch();
  const restoreEnv = env();
  const calls = { patches: 0, transcribed: 0 };
  try {
    const out = await lyricsAlign({ input: { track_id: ID } }, {
      rest: async (path, init = {}) => {
        if (init.method) { calls.patches += 1; return { body: [{ id: ID }] }; }
        return { body: [{ id: ID, title: 'Up', lyrics: null, lyrics_sheet: '', ...track }] };
      },
      transcribe: async () => { calls.transcribed += 1; return { doc: DOC() }; },
    }).then((value) => ({ value }), (error) => ({ error }));
    return { ...out, requests: net.requests, calls };
  } finally { net.restore(); restoreEnv(); }
}

test('lyrics_align downloads the release\'s own master from creator-masters with the service key', async () => {
  const got = await align({ master_bucket: 'creator-masters', master_path: MASTER });
  assert.equal(got.error, undefined);
  assert.equal(got.value.written, true);
  assert.deepEqual(got.requests, [{ sent: `https://sb.test/storage/v1/object/creator-masters/${MASTER}`, reached: `/storage/v1/object/creator-masters/${MASTER}`, apikey: 'sb_secret_x' }]);
  assert.deepEqual(got.calls, { patches: 1, transcribed: 1 });
});

test('lyrics_align still reads an ordinary name with a space in it', async () => {
  const got = await align({ master_bucket: 'creator-masters', master_path: 'u/1 song.mp3' });
  assert.equal(got.error, undefined);
  assert.equal(got.requests[0].reached, '/storage/v1/object/creator-masters/u/1%20song.mp3');
});

for (const [what, bucket, path] of REFUSED) {
  test(`lyrics_align refuses ${what} before it downloads: ${JSON.stringify([bucket, path])}`, async () => {
    const got = await align({ master_bucket: bucket, master_path: path });
    assert.deepEqual(got.requests.filter((r) => !r.reached.startsWith('/storage/v1/object/creator-masters/')), [], 'nothing outside creator-masters is requested');
    assert.deepEqual(got.requests, [], 'nothing is downloaded');
    assert.match(String(got.error?.message), /release master is not a plain object in creator-masters/);
    assert.deepEqual(got.calls, { patches: 0, transcribed: 0 }, 'nothing is transcribed or written');
  });
}

test('lyrics_align leaves owner-reviewed lyrics alone without touching Storage, whatever the row points at', async () => {
  const got = await align({ master_bucket: 'mcc-gated-audio', master_path: `../${ELSEWHERE}`, lyrics: { source: 'aligned', reviewed: true, timed: { line: [] } } });
  assert.equal(got.error, undefined);
  assert.equal(got.value.written, false);
  assert.deepEqual(got.requests, []);
});

async function separate(track) {
  const restoreEnv = env();
  const calls = { fetched: [], separated: 0, stored: 0 };
  try {
    const out = await stemsSeparate({ input: { source: 'creator', track_id: ID } }, {
      rest: async () => ({ body: [{ id: ID, title: 'Up', ...track }] }),
      fetchTo: async (url, to, headers) => { calls.fetched.push({ sent: url, reached: new URL(url).pathname, apikey: headers.apikey || null }); },
      separator: { run: async () => { calls.separated += 1; return { manifest: MANIFEST }; } },
      storeStems: async () => { calls.stored += 1; return { stems: 7, bytes: 7 }; },
    }).then((value) => ({ value }), (error) => ({ error }));
    return { ...out, calls };
  } finally { restoreEnv(); }
}

test('stems_separate downloads the release\'s own master from creator-masters with the service key', async () => {
  const got = await separate({ master_bucket: 'creator-masters', master_path: MASTER });
  assert.equal(got.error, undefined);
  assert.deepEqual(got.calls.fetched, [{ sent: `https://sb.test/storage/v1/object/creator-masters/${MASTER}`, reached: `/storage/v1/object/creator-masters/${MASTER}`, apikey: 'sb_secret_x' }]);
  assert.equal(got.calls.stored, 1);
});

for (const [what, bucket, path] of REFUSED) {
  test(`stems_separate refuses ${what} before it downloads: ${JSON.stringify([bucket, path])}`, async () => {
    const got = await separate({ master_bucket: bucket, master_path: path });
    assert.deepEqual(got.calls.fetched.filter((r) => !r.reached.startsWith('/storage/v1/object/creator-masters/')), [], 'nothing outside creator-masters is requested');
    assert.deepEqual(got.calls, { fetched: [], separated: 0, stored: 0 }, 'nothing is downloaded, separated or stored');
    assert.match(String(got.error?.message), /release master is not a plain object in creator-masters/);
  });
}

test('both executors use Core\'s copy of the path rule and name the bucket themselves', async () => {
  const { readFile } = await import('node:fs/promises');
  assert.equal(safeObjectPath(MASTER), true);
  assert.equal(safeObjectPath(`../${MASTER}`), false);
  for (const file of ['lyrics-align.mjs', 'stems-separate.mjs']) {
    const src = await readFile(new URL(`../src/executors/${file}`, import.meta.url), 'utf8');
    assert.match(src, /import \{ safeObjectPath \} from '\.\.\/storage-object-path\.mjs';/, file);
    assert.match(src, /master_bucket !== MASTERS_BUCKET \|\| !safeObjectPath\(t(?:rack)?\.master_path\)/, file);
    assert.doesNotMatch(src, /encodeURIComponent\(t(?:rack)?\.master_bucket\)|_download\(track\.master_bucket/, `${file}: the row's bucket is never what is requested`);
  }
});
