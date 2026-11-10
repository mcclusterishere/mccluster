/* music-access: a master is signed or read only in the masters bucket, and
   only as a plain object path.

   creator_tracks.master_bucket / master_path and a pinned version's
   object_name are values on rows. The database already holds them to the
   creator's own uploads (20261030001000_music_release_payment_integrity_v1);
   this is the function's own second check, so it does not rest on that alone:

     operator-lyrics-get      signs the listen link only for master_bucket
                              "creator-masters" and a plain path; otherwise
                              there is no master to hear (audio_url, or none)
     signDownload             (stream, download, stems, review) refuses a path
                              that is not plain: the storage client places the
                              path in the request URL as it is
     operator-review-prepare  reads the bytes to hash only from a plain path

   The function's real index.ts runs here (./support/edge-function.mjs) with a
   stand-in client whose createSignedUrl builds its request exactly as the
   pinned client does (@supabase/storage-js 2.12.1 under supabase-js 2.57.4:
   `${url}/object/sign/${bucket}/${path without leading slashes}`), against a
   stand-in Storage that answers for whatever that request really reaches. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEdgeFunction, storageSigner } from './support/edge-function.mjs';

const FUNCTION = 'supabase/functions/music-access/index.ts';
const SB = 'https://db.test';
const MASTERS = 'creator-masters';
const OPERATOR = '80000000-0000-4000-8000-0000000000a1';
const LISTENER = '80000000-0000-4000-8000-0000000000b2';
const CREATOR = '80000000-0000-4000-8000-0000000000c3';
const TRACK = '81000000-0000-4000-8000-0000000000a1';
const OFFER = '82000000-0000-4000-8000-0000000000a1';
const MASTER = `${CREATOR}/83000000-0000-4000-8000-0000000000a1-song.wav`;
const ELSEWHERE = 'direct-sales/album/track.wav';
const OBJECTS = { [MASTERS]: [MASTER], 'mcc-gated-audio': [ELSEWHERE] };
const BYTES = new TextEncoder().encode('abc');
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

/* The same file in another bucket, reached five ways. */
const ELSEWHERE_POINTERS = [
  ['parent segment', `../mcc-gated-audio/${ELSEWHERE}`],
  ['parent segments after a folder', `${CREATOR}/../../mcc-gated-audio/${ELSEWHERE}`],
  ['percent-encoded dots', `%2e%2e/mcc-gated-audio/${ELSEWHERE}`],
  ['backslashes', `..\\mcc-gated-audio\\direct-sales\\album\\track.wav`],
  ['a newline inside the dots', `.\n./mcc-gated-audio/${ELSEWHERE}`],
];
const NOT_PLAIN = [...ELSEWHERE_POINTERS, ['a current-directory segment', `./${MASTER}`], ['a leading slash', `/${MASTER}`],
  ['an empty segment', MASTER.replace('/', '//')], ['a query', `${MASTER}?download=x`], ['a fragment', `${MASTER}#t=1`], ['a trailing newline', `${MASTER}\n`]];

/* an rpc that answers with a database error instead of data */
class DbFailure { constructor(error) { this.error = error; } }

async function musicAccess(body, { as = 'operator', track = null, rpc = {} } = {}) {
  const sign = storageSigner(OBJECTS, { base: SB });
  const reads = [];
  const writes = [];
  const rpcCalls = [];
  const users = { operator: { id: OPERATOR, email: 'operator@example.test' }, listener: { id: LISTENER, email: 'listener@example.test' } };
  const tables = {
    m_auth_user_links: () => [{ m_uid: '84000000-0000-4000-8000-0000000000a1' }],
    orgs: () => [{ id: '85000000-0000-4000-8000-0000000000a1' }],
    creator_tracks: () => (track ? [track] : []),
  };
  const from = (table) => {
    const rows = () => { if (!tables[table]) throw new Error('unexpected table: ' + table); return tables[table](); };
    const chain = {
      select: () => chain, eq: () => chain, is: () => chain, in: () => chain, order: () => chain, limit: () => chain,
      update: (values) => { writes.push({ table, values }); return { eq: async () => ({ data: null, error: null }) }; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
    };
    return chain;
  };
  /* createSignedUrl as the pinned storage client sends it */
  const createSignedUrl = async (bucket, path, expiresIn, options) => {
    const res = await sign.respond(`${SB}/storage/v1/object/sign/${bucket}/${path.replace(/^\/+/, '')}`, { method: 'POST', body: JSON.stringify({ expiresIn }) });
    const data = await res.json();
    if (!res.ok || !data.signedURL) return { data: null, error: { message: data.message || 'Object not found' } };
    return { data: { signedUrl: encodeURI(`${SB}/storage/v1${data.signedURL}${options?.download ? `&download=${options.download}` : ''}`) }, error: null };
  };
  const admin = {
    auth: { getUser: async (token) => (users[token] ? { data: { user: users[token] }, error: null } : { data: { user: null }, error: { message: 'invalid token' } }) },
    from,
    rpc: async (fn, args) => {
      rpcCalls.push([fn, args]);
      if (fn === 'control_authorize_service') return { data: [{ allowed: args.p_actor === OPERATOR }], error: null };
      if (!Object.hasOwn(rpc, fn)) throw new Error('unexpected rpc: ' + fn);
      if (rpc[fn] instanceof DbFailure) return { data: null, error: rpc[fn].error };
      return { data: typeof rpc[fn] === 'function' ? rpc[fn](args) : rpc[fn], error: null };
    },
    storage: { from: (bucket) => ({ createSignedUrl: (path, expiresIn, options) => createSignedUrl(bucket, path, expiresIn, options) }) },
  };
  /* the object read operator-review-prepare makes itself, with the service key */
  const fetchStub = async (input) => {
    const url = new URL(String(input));
    const m = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (url.origin !== SB || !m || m[1] === 'sign') throw new Error('unexpected egress: ' + String(input));
    const bucket = decodeURIComponent(m[1]);
    const name = decodeURIComponent(m[2]);
    reads.push({ bucket, name });
    if (!OBJECTS[bucket]?.includes(name)) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
    return new Response(BYTES, { status: 200, headers: { 'content-length': String(BYTES.byteLength) } });
  };
  const fn = await loadEdgeFunction(FUNCTION, {
    env: { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key' },
    stubs: { 'jsr:@supabase/functions-js/edge-runtime.d.ts': {}, 'npm:@supabase/supabase-js@2.57.4': { createClient: () => admin } },
    fetch: fetchStub,
  });
  const res = await fn.handler(new Request('https://api.test/functions/v1/music-access', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${as}` }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json(), sign, reads, writes, rpcCalls, logs: fn.logs };
}
const outside = (got) => [...got.sign.signed, ...got.reads].filter((o) => o.bucket !== MASTERS).map((o) => `${o.bucket}/${o.name}`);
const signedMaster = `${SB}/storage/v1/object/sign/${MASTERS}/${MASTER}?token=test-token`;

/* ---------------- operator-lyrics-get ---------------- */

const lyricsTrack = (extra) => ({ id: TRACK, title: 'Song', artist: 'Artist', lyrics: { timed: { line: [] } }, master_bucket: MASTERS, master_path: MASTER, audio_url: 'https://cdn.example.test/preview.mp3', ...extra });
const lyricsGet = (extra) => musicAccess({ action: 'operator-lyrics-get', track_id: TRACK }, { track: lyricsTrack(extra) });

test('lyrics: the operator hears the release\'s own master, signed for fifteen minutes', async () => {
  const got = await lyricsGet({});
  assert.equal(got.status, 200);
  assert.equal(got.body.listen_url, signedMaster);
  assert.equal(got.body.expires_in, 900);
  assert.deepEqual(got.sign.signed, [{ bucket: MASTERS, name: MASTER }]);
  assert.deepEqual(got.sign.requests[0].body, { expiresIn: 900 });
});

test('lyrics: a row naming another bucket is not a master to hear', async () => {
  for (const bucket of ['mcc-gated-audio', 'creator-previews', 'CREATOR-MASTERS', 'creator-masters ', '']) {
    const got = await lyricsGet({ master_bucket: bucket, master_path: ELSEWHERE });
    assert.deepEqual(got.sign.requests, [], `${JSON.stringify(bucket)}: nothing is asked of Storage`);
    assert.equal(got.status, 200);
    assert.equal(got.body.listen_url, 'https://cdn.example.test/preview.mp3', 'the lyrics still open, on the public preview');
    assert.deepEqual(got.body.lyrics, { timed: { line: [] } });
  }
});

for (const [what, path] of NOT_PLAIN) {
  test(`lyrics: a master path with ${what} is not signed: ${JSON.stringify(path)}`, async () => {
    const got = await lyricsGet({ master_path: path });
    assert.deepEqual(outside(got), []);
    assert.deepEqual(got.sign.requests, [], 'nothing is asked of Storage');
    assert.equal(got.status, 200);
    assert.equal(got.body.listen_url, 'https://cdn.example.test/preview.mp3');
    assert.ok(got.logs.some((l) => l[0] === 'error' && /lyrics listen refused/.test(String(l[1]))), 'the refusal is logged');
  });
}

test('lyrics: a release with no master, or with a refused one and no preview, has nothing to hear', async () => {
  const none = await lyricsGet({ master_path: null });
  assert.equal(none.body.listen_url, 'https://cdn.example.test/preview.mp3');
  assert.deepEqual(none.sign.requests, []);
  assert.deepEqual(none.logs.filter((l) => l[0] === 'error'), [], 'an absent master is ordinary, not logged');
  const refused = await lyricsGet({ master_path: `../mcc-gated-audio/${ELSEWHERE}`, audio_url: null });
  assert.equal(refused.status, 200);
  assert.equal(refused.body.listen_url, null);
});

test('lyrics: still operator only', async () => {
  const got = await musicAccess({ action: 'operator-lyrics-get', track_id: TRACK }, { as: 'listener', track: lyricsTrack({}) });
  assert.equal(got.status, 403);
  assert.deepEqual(got.sign.requests, []);
});

/* ---------------- signDownload, behind stream and download ---------------- */

const published = { id: TRACK, uid: CREATOR, m_uid: null, status: 'published', access_mode: 'public', master_bucket: MASTERS, master_path: MASTER, title: 'Song' };
const pinned = (objectName) => [{ track_status: 'published', asset_version_id: 'v1', bucket_id: MASTERS, object_name: objectName, intact: true }];
const stream = (objectName) => musicAccess({ action: 'stream', track_id: TRACK }, {
  as: 'listener', track: published, rpc: { music_track_delivery: pinned(objectName), music_track_assets_verified: true },
});

test('stream: the pinned master is signed', async () => {
  const got = await stream(MASTER);
  assert.equal(got.status, 200);
  assert.equal(got.body.url, signedMaster);
  assert.deepEqual(got.sign.signed, [{ bucket: MASTERS, name: MASTER }]);
});

for (const [what, path] of NOT_PLAIN) {
  test(`stream: a pinned name with ${what} is refused before the storage client sees it: ${JSON.stringify(path)}`, async () => {
    const got = await stream(path);
    assert.deepEqual(outside(got), []);
    assert.deepEqual(got.sign.requests, []);
    assert.deepEqual({ status: got.status, body: got.body }, { status: 500, body: { error: 'could_not_sign_asset' } });
  });
}

test('the function runs as it does when deployed: an error raised in a module it imports is answered as that error', async () => {
  /* delivery.ts throws a plain Error here; the handler answers `error instanceof Error ? error.message : String(error)`.
     In a harness that ran index.ts in another realm this would read "Error: could_not_resolve_release". */
  const got = await musicAccess({ action: 'stream', track_id: TRACK }, {
    as: 'listener', track: published, rpc: { music_track_delivery: new DbFailure({ code: 'XX000', message: 'boom' }) },
  });
  assert.deepEqual({ status: got.status, body: got.body }, { status: 500, body: { error: 'could_not_resolve_release' } });
  assert.deepEqual(got.sign.requests, []);
  /* and a missing dependency is still recognised by its class across the import */
  const missing = await musicAccess({ action: 'stream', track_id: TRACK }, {
    as: 'listener', track: published, rpc: { music_track_delivery: new DbFailure({ code: 'PGRST202', message: 'Could not find the function' }) },
  });
  assert.deepEqual({ status: missing.status, body: missing.body }, { status: 503, body: { error: 'music delivery is temporarily unavailable', dependency: 'music_track_delivery' } });
});

test('download: a purchase whose pinned name is not a plain path is not signed and not counted', async () => {
  const purchase = (objectName) => [{ entitlement_id: 'e1', download_count: 2, revoked: false, order_status: 'paid', asset_version_id: 'v1', bucket_id: MASTERS, object_name: objectName, intact: true, track_status: 'published' }];
  const buy = (objectName) => musicAccess({ action: 'download', track_id: TRACK, offer_id: OFFER }, { as: 'listener', track: { title: 'Song' }, rpc: { music_purchase_delivery: purchase(objectName) } });
  const ok = await buy(MASTER);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.url, `${signedMaster}&download=Song.wav`);
  assert.deepEqual(ok.writes, [{ table: 'music_entitlements', values: { download_count: 3, last_download_at: ok.writes[0]?.values.last_download_at } }]);
  for (const [what, path] of ELSEWHERE_POINTERS) {
    const got = await buy(path);
    assert.deepEqual(outside(got), [], what);
    assert.deepEqual({ status: got.status, body: got.body, requests: got.sign.requests, writes: got.writes }, { status: 500, body: { error: 'could_not_sign_asset' }, requests: [], writes: [] }, what);
  }
});

/* ---------------- operator-review-prepare: the bytes that are hashed ---------------- */

const prepared = (objectName) => [{
  track_id: TRACK, track_status: 'pending_review', track_updated_at: '2026-11-09T00:00:00Z', version_id: 'v1', bucket_id: MASTERS, object_name: objectName,
  size_bytes: 3, etag: 'e', content_sha256: null, invalidated: false, invalid_reason: null, identity_intact: true,
}];
const prepare = (objectName) => musicAccess({ action: 'operator-review-prepare', track_id: TRACK }, { rpc: { music_prepare_review: prepared(objectName), music_record_asset_sha256: 'recorded' } });

test('review: the pinned master is read, hashed once and signed', async () => {
  const got = await prepare(MASTER);
  assert.equal(got.status, 200);
  assert.deepEqual(got.reads, [{ bucket: MASTERS, name: MASTER }]);
  assert.equal(got.body.sha256, ABC_SHA256);
  assert.equal(got.body.listen_url, signedMaster);
  assert.deepEqual(got.rpcCalls.find((c) => c[0] === 'music_record_asset_sha256')[1], { p_version: 'v1', p_sha256: ABC_SHA256, p_size: 3 });
});

for (const [what, path] of NOT_PLAIN) {
  test(`review: a pinned name with ${what} is not read, hashed or signed: ${JSON.stringify(path)}`, async () => {
    const got = await prepare(path);
    assert.deepEqual(outside(got), []);
    assert.deepEqual({ reads: got.reads, requests: got.sign.requests }, { reads: [], requests: [] }, 'nothing is asked of Storage');
    assert.ok(!got.rpcCalls.some((c) => c[0] === 'music_record_asset_sha256'), 'no hash is recorded');
    assert.deepEqual({ status: got.status, body: got.body }, { status: 409, body: { error: 'the master could not be read' } });
  });
}

test('the three checks are where the source says they are', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../' + FUNCTION, import.meta.url), 'utf8');
  assert.match(src, /import \{ safeObjectPath \} from "\.\.\/_shared\/storage-object-path\.ts";/);
  const sign = src.slice(src.indexOf('async function signDownload('), src.indexOf('async function uploadGrant('));
  assert.ok(sign.indexOf('if (!safeObjectPath(path)) throw new Error("could_not_sign_asset");') > 0 && sign.indexOf('safeObjectPath(path)') < sign.indexOf('createSignedUrl('), 'signDownload checks before the client is called');
  const reader = src.slice(src.indexOf('const readObject: ObjectReader'), src.indexOf('async function hasMusicEntitlement('));
  assert.ok(reader.indexOf('safeObjectPath(path)') > 0 && reader.indexOf('safeObjectPath(path)') < reader.indexOf('fetch('), 'readObject checks before it fetches');
  const lyrics = src.slice(src.indexOf('if (action === "operator-lyrics-get")'), src.indexOf('if (action === "operator-lyrics-save")'));
  assert.match(lyrics, /t\.master_bucket === "creator-masters" && safeObjectPath\(t\.master_path\)/);
  assert.match(lyrics, /signDownload\("creator-masters", master, undefined, 900\)/, 'the bucket is named, not read from the row');
  assert.doesNotMatch(lyrics, /signDownload\(t\.master_bucket/);
});
