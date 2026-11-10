// E=Up League media module (src/eup/league-media.js) against the in-memory storage double.
//
// PROVEN HERE, the module's own rules: the path comes only from row ids; one signed, no-overwrite upload per begin;
// complete lists, reads the object once with a hard cap, checks magic bytes, digests the stream and hands the seal
// exactly what it measured; a second complete reads nothing; signed reads re-check the stored identity; a redirect,
// a deadline and an answer of the wrong shape are 503; nothing is logged and no URL, token or key leaves except in
// the returned grant or read; the purge deletes exactly the due paths and reports each.
//
// MODELLED HERE, proven in other lanes: the SQL. `leagueModel` is a small model of the upload rows and of the seal,
// written from MEDIA_SEAL.effects in the contract. The three `...Route` helpers follow MEDIA.order with the SQL read
// modelled; they show the order a route has to keep, and prove neither the SQL nor the routes.
//
// NOT PROVEN IN THIS FILE: real storage (the double is a model of it) and the Worker runtime (Node runs this file;
// `asWorkerFetch` only applies the runtime's fetch rules to the double).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import * as media from '../src/eup/league-media.js';
import * as C from '../src/eup/league-contract.js';
import { createLeagueStorageDouble, asWorkerFetch } from './support/eup-league-storage-double.mjs';

const { beginUpload, completeUpload, discardUpload, signOwnRead, signReviewRead, purgeDue, measureMediaStream, STORAGE_LIMITS } = media;

/* Everything written to the console while this file runs. The module never logs; the last test checks this stayed empty. */
const logged = [];
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) console[level] = (...args) => { logged.push([level, ...args]); };

const U = (n) => `0a000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TENANT = U(1);
const ASSIGNMENT = U(2);
const PARTICIPANT = U(11);
const OTHER = U(12);
const SERVICE_KEY = 'fixture-service-key-not-a-secret';
const BUCKET = 'equity-uprise-private';
const env = Object.freeze({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
const T0 = Date.parse('2026-11-10T12:00:00Z');
const fail = (status, message, reason) => Object.assign(new Error(message), { status, reason });
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ascii = (text) => new TextEncoder().encode(text);
const vector = (name) => C.bytesFromHex(C.MAGIC_VECTORS.find((v) => v.name === name).hex);
const WEBM = vector('webm'); // 16 bytes
const WAV = vector('wav'); // 16 bytes
const OGG = vector('ogg'); // 14 bytes
const HTML = ascii('<!doctype html><html><body><script>document.title = "test fixture"</script></body></html>');
const filled = (head, size, fill = 0x61) => { const out = new Uint8Array(size).fill(fill); out.set(head.subarray(0, Math.min(head.length, size))); return out; };
/* The expected path, written out here independently of the contract helper the module uses. */
const pathOf = (row) => `league/v1/t/${row.tenant}/a/${row.assignment_id}/u/${row.id}.${row.ext}`;
const routeOf = (call) => `${call.method} ${call.route}`;
const SENTENCES = { storage_unavailable: 'League media storage unavailable', upload_expired: 'This upload can no longer receive a file', upload_missing: 'No stored file was found for this upload',
  media_changed: 'The stored file is not the file that was sealed', not_available: 'Not available', moderation_hold: 'The proof is held' };
const refused = (status, reason) => (error) => {
  assert.equal(error.reason, reason, `${error.status} ${error.reason}: ${error.message}`);
  assert.equal(error.status, status);
  assert.equal(error.message, SENTENCES[reason], 'a fixed sentence, never upstream text');
  assert.equal(error.cause, undefined);
  return true;
};
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));

/* A model of what the SQL does with upload rows, written from MEDIA_SEAL.effects. It stands in for the seal function;
   its refusals are thrown the way the member route throws them after mapping the SQLSTATE. */
function leagueModel(now) {
  const rows = new Map();
  const sealCalls = [];
  let refusing = null;
  let serial = 100;
  const iso = () => new Date(now()).toISOString();
  function staged({ mime = 'audio/webm', bytes = 16, max_bytes = 1000, participant = PARTICIPANT, tenant = TENANT, assignment_id = ASSIGNMENT, id = U(serial += 1) } = {}) {
    const type = C.mediaType(mime);
    const row = { id, tenant, created_at: iso(), updated_at: iso(), assignment_id, participant, kind: type.kind, mime, ext: type.ext, declared_bytes: bytes, max_bytes, duration_seconds: null,
      state: 'staged', scan_state: 'not_scanned', expires_at: new Date(now() + C.MEDIA.staged_ttl_seconds * 1000).toISOString(), bytes: null, sha256: null, family: null, rejected_reason: null,
      sealed_at: null, discarded_at: null, purged_at: null, storage: null };
    rows.set(id, row);
    return structuredClone(row);
  }
  async function seal(args) {
    sealCalls.push(structuredClone(args));
    assert.deepEqual(Object.keys(args), [...C.RPC_ARGUMENTS.seal]);
    if (refusing) throw refusing;
    const row = rows.get(args.p_upload);
    if (!row || row.participant !== args.p_actor) throw fail(404, 'Not available', 'not_available');
    const r = args.p_result;
    if (C.checkDocument(C.DOCUMENTS.seal_result, r) !== null) throw fail(422, 'Invalid', 'invalid');
    const said = r.outcome === 'rejected' ? row.state === 'rejected' && row.rejected_reason === r.reason
      : row.state === 'sealed' && row.sha256 === r.sha256 && row.bytes === r.bytes && JSON.stringify(row.storage) === JSON.stringify(r.storage);
    if (row.state === 'sealed' || row.state === 'rejected') {
      if (said) return structuredClone(row);
      throw row.state === 'sealed' && r.outcome === 'sealed' ? fail(409, 'Media binding', 'media_binding') : fail(409, 'Revision conflict', 'revision_conflict');
    }
    if (row.state !== 'staged') throw fail(409, 'Revision conflict', 'revision_conflict');
    if (now() > Date.parse(row.expires_at)) row.state = 'expired';
    else if (r.outcome === 'rejected') Object.assign(row, { state: 'rejected', rejected_reason: r.reason });
    else {
      if (r.bytes !== row.declared_bytes || r.bytes !== r.storage.size || r.bytes > row.max_bytes || r.bytes > C.MEDIA.hard_max_bytes || !C.mediaType(row.mime).families.includes(r.family)) throw fail(409, 'Media binding', 'media_binding');
      Object.assign(row, { state: 'sealed', bytes: r.bytes, sha256: r.sha256, family: r.family, storage: structuredClone(r.storage), sealed_at: iso() });
    }
    row.updated_at = iso();
    return structuredClone(row);
  }
  return { staged, seal, sealCalls, get: (id) => (rows.has(id) ? structuredClone(rows.get(id)) : null), set: (id, patch) => Object.assign(rows.get(id), patch), refuse: (error) => { refusing = error; } };
}

function world() {
  const clock = { ms: T0 };
  const now = () => clock.ms;
  const storage = createLeagueStorageDouble({ origin: env.SUPABASE_URL, serviceKey: SERVICE_KEY, now });
  const league = leagueModel(now);
  return { clock, now, storage, league, ctx: { env, fetchImpl: asWorkerFetch(storage.fetch), fail, now, seal: league.seal } };
}
/* Begin, then store the file the way a browser does with the grant. */
async function uploaded(w, bytes, { mime = 'audio/webm', contentType = mime, declared = Math.max(bytes.byteLength, 1), max_bytes = 1000, ...rest } = {}) {
  const row = w.league.staged({ mime, bytes: declared, max_bytes, ...rest });
  const grant = await beginUpload(w.ctx, row);
  const put = await w.storage.put(grant, bytes, { headers: { 'content-type': contentType } });
  assert.equal(put.status, 200, 'the grant stores the file');
  return { row, grant, path: pathOf(row) };
}
async function sealedRow(w, bytes = WEBM, options = {}) {
  const { row } = await uploaded(w, bytes, options);
  const out = await completeUpload(w.ctx, row, PARTICIPANT);
  assert.equal(out.state, 'sealed');
  return out;
}
function proofOf(w, uploads, patch = {}) {
  const at = new Date(w.now()).toISOString();
  return { id: U(50), tenant: TENANT, created_at: at, updated_at: at, assignment_id: ASSIGNMENT, participant: PARTICIPANT, revision: 2, state: 'submitted', reviewed_revision: null,
    asset_revision: 'ab'.repeat(32), moderation_state: 'clear', publication_state: 'private', document: { title: 'Test fixture: river song' },
    media: uploads.map((u) => ({ upload_id: u.id, kind: u.kind, mime: u.mime, bytes: u.bytes, sha256: u.sha256 })), reviews: [], uploads, ...patch };
}
const dueRow = (row, patch = {}) => ({ id: row.id, tenant: row.tenant, assignment_id: row.assignment_id, ext: row.ext, kind: row.kind, state: row.state, due: true, reason: 'discarded', due_at: '2026-11-10T00:00:00Z', ...patch });

/* Rows no storage call may ever be made for. */
const MALFORMED = [
  ['null', () => null], ['a string', () => 'row'], ['a list', (r) => [r]],
  ['a tenant that is not a uuid', (r) => ({ ...r, tenant: 'house' })], ['no tenant', ({ tenant: _tenant, ...r }) => r],
  ['an assignment with a path in it', (r) => ({ ...r, assignment_id: `${r.assignment_id}/../x` })],
  ['an upload id that is a path', (r) => ({ ...r, id: '../../other' })],
  ['an extension with a path in it', (r) => ({ ...r, ext: 'webm/../../x' })], ['an extension that is not allowed', (r) => ({ ...r, ext: 'html' })],
  ['a type that is not allowed', (r) => ({ ...r, mime: 'text/html' })], ['a type with parameters', (r) => ({ ...r, mime: 'audio/webm;codecs=opus' })],
  ['a kind that is not the kind of its type', (r) => ({ ...r, kind: 'video' })],
  ['a state nobody defined', (r) => ({ ...r, state: 'ready' })], ['no state', ({ state: _state, ...r }) => r]
];

/* The ones that cannot name an object at all: a deletion needs only the ids and the extension, so only these stop it. */
const UNADDRESSABLE = MALFORMED.filter(([label]) => !/type|kind/.test(label));

/* ------------------------------------------------------------------ the interface */

test('the module is the interface the contract names; it imports the contract and node:crypto and nothing else', () => {
  for (const [name, spec] of Object.entries(C.MEDIA_MODULE.functions)) {
    assert.equal(typeof media[name], 'function', name);
    assert.equal(media[name].length, spec.args.length, `${name}(${spec.args.join(', ')})`);
  }
  assert.deepEqual(Object.keys(media).sort(), [...Object.keys(C.MEDIA_MODULE.functions), 'STORAGE_LIMITS', 'measureMediaStream'].sort());
  assert.equal(C.MEDIA_MODULE.file, './league-media.js');
  assert.deepEqual(Object.keys(C.MEDIA_MODULE.context), ['env', 'fetchImpl', 'fail', 'now', 'seal']);
  assert.deepEqual(Object.keys(world().ctx), Object.keys(C.MEDIA_MODULE.context));
  const source = readFileSync(new URL('../src/eup/league-media.js', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/^import\s[^;]*?\sfrom\s+'([^']+)';/gm)].map((m) => m[1]).sort(), ['./league-contract.js', 'node:crypto']);
  assert.doesNotMatch(source, /\bimport\s*\(|\brequire\s*\(/, 'no other way in');
  assert.doesNotMatch(source, /console\s*\./, 'nothing is logged');
  assert.doesNotMatch(source, /eup_league|rest\/v1|equity-uprise-private|mnet-media/, 'no RPC, no table and no bucket is named here');
  assert.doesNotMatch(source, /ctx\??\.fetchImpl\s*\(/, 'fetch is never called as a method');
  assert.deepEqual([...source.matchAll(/redirect:\s*'([a-z]+)'/g)].map((m) => m[1]), ['manual']);
  assert.ok(STORAGE_LIMITS.control_timeout_ms > 0 && STORAGE_LIMITS.read_timeout_ms >= STORAGE_LIMITS.control_timeout_ms);
  assert.ok(Object.isFrozen(STORAGE_LIMITS));
});

test('fixtures: the model rows are the contract shapes', () => {
  const w = world();
  const row = w.league.staged();
  assert.deepEqual(Object.keys(row).sort(), Object.keys(C.shapeFields('upload')).sort());
  assert.deepEqual(Object.keys(proofOf(w, [])).sort(), Object.keys(C.shapeFields('proof_with_media')).sort());
  assert.deepEqual(Object.keys(dueRow(row)).sort(), Object.keys(C.shapeFields('due_upload')).sort());
  assert.equal(pathOf(row), C.mediaObjectPath({ tenant: row.tenant, assignment: row.assignment_id, upload: row.id, ext: row.ext }));
});

/* ------------------------------------------------------------------ begin */

test('begin: one signed upload for the path made from the row ids; the grant is the only place the URL exists', async () => {
  const w = world();
  const row = w.league.staged({ mime: 'audio/webm', bytes: 16 });
  const path = `league/v1/t/${TENANT}/a/${ASSIGNMENT}/u/${row.id}.webm`;
  /* A row that also carries what a client might send: none of it is read. */
  const grant = await beginUpload(w.ctx, { ...row, path: 'mine/file.webm', object_path: '../x', storage_path: 'a/b', bucket: 'mnet-media', name: 'x.webm', url: 'https://elsewhere.invalid/x', key: 'k' });
  assert.deepEqual(Object.keys(grant), ['method', 'url', 'headers', 'expires_in']);
  assert.equal(grant.method, 'PUT');
  assert.deepEqual(grant.headers, { 'content-type': 'audio/webm', 'x-upsert': 'false' });
  assert.equal(grant.expires_in, C.MEDIA.upload_grant_seconds);
  assert.ok(grant.url.startsWith(`https://fixture.invalid/storage/v1/object/upload/sign/${BUCKET}/${path}?token=`), grant.url);
  assert.equal(w.storage.calls.length, 1, 'exactly one storage call');
  const [call] = w.storage.calls;
  assert.equal(routeOf(call), `POST object/upload/sign/${BUCKET}/${path}`);
  assert.deepEqual([call.service, call.redirect, call.signal, call.headers['x-upsert'], call.json], [true, 'manual', true, undefined, undefined]);
  /* The grant stores one file, of that type, at that path, once. */
  assert.equal((await w.storage.put(grant, WEBM)).status, 200);
  assert.deepEqual(w.storage.paths(), [path]);
  assert.equal(w.storage.object(path).mimetype, 'audio/webm');
  const second = await w.storage.put(grant, WAV);
  assert.equal(second.ok, false, 'no overwrite');
  assert.deepEqual([...w.storage.object(path).bytes], [...WEBM]);
});

test('begin: every allowed type gets the extension of the media table, and a row with any other extension gets nothing', async () => {
  for (const [mime, type] of Object.entries(C.MEDIA.types)) {
    const w = world();
    const row = w.league.staged({ mime });
    const grant = await beginUpload(w.ctx, row);
    assert.ok(grant.url.includes(`/u/${row.id}.${type.ext}?token=`), mime);
    assert.equal(grant.headers['content-type'], mime);
    const wrong = C.MEDIA.extensions.find((ext) => ext !== type.ext);
    await assert.rejects(beginUpload(w.ctx, { ...row, ext: wrong }), refused(503, 'storage_unavailable'), `${mime} as .${wrong}`);
    assert.equal(w.storage.calls.length, 1, mime);
  }
});

test('begin: a replay signs a fresh grant for the same path and the module keeps nothing between calls', async () => {
  const w = world();
  const row = w.league.staged();
  const first = await beginUpload(w.ctx, row);
  const second = await beginUpload(w.ctx, row);
  assert.notEqual(first.url, second.url, 'a fresh token');
  assert.equal(first.url.split('?')[0], second.url.split('?')[0], 'the same object');
  assert.equal(w.storage.calls.length, 2);
  assert.equal((await w.storage.put(second, WEBM)).status, 200);
  /* Once the object is there the model refuses to sign over it (as the service is documented to); the caller is told
     storage_unavailable and completes the upload instead, which is the order MEDIA.order gives. */
  await assert.rejects(beginUpload(w.ctx, row), refused(503, 'storage_unavailable'));
  assert.equal((await completeUpload(w.ctx, row, PARTICIPANT)).state, 'sealed');
});

test('begin: no grant that could outlive the row, and none for a row that is not staged', async () => {
  const w = world();
  const row = w.league.staged();
  const edge = Date.parse(row.expires_at) - C.MEDIA.upload_grant_seconds * 1000;
  w.clock.ms = edge;
  assert.ok((await beginUpload(w.ctx, row)).url, 'now + upload_grant_seconds = expires_at is still signed');
  w.clock.ms = edge + 1;
  await assert.rejects(beginUpload(w.ctx, row), refused(409, 'upload_expired'));
  w.clock.ms = Date.parse(row.expires_at) + 1;
  await assert.rejects(beginUpload(w.ctx, row), refused(409, 'upload_expired'));
  w.clock.ms = T0;
  for (const state of C.ENUMS.UPLOAD_STATES.filter((s) => s !== 'staged')) await assert.rejects(beginUpload(w.ctx, { ...row, state }), refused(409, 'upload_expired'), state);
  assert.equal(w.storage.calls.length, 1, 'no refused call reached storage');
  /* The module answers in the same shape without the router's fail, and with a clock of its own. */
  const { fail: _fail, now: _now, ...bare } = w.ctx;
  await assert.rejects(beginUpload(bare, { ...row, state: 'sealed' }), refused(409, 'upload_expired'));
});

test('begin: a row that cannot name its own object never reaches storage', async () => {
  const w = world();
  const row = w.league.staged();
  const cases = [...MALFORMED, ['an expiry that is not a time', (r) => ({ ...r, expires_at: 'soon' })], ['an expiry that is a number', (r) => ({ ...r, expires_at: 2027 })], ['no expiry', ({ expires_at: _expires, ...r }) => r]];
  for (const [label, change] of cases) await assert.rejects(beginUpload(w.ctx, change(row)), refused(503, 'storage_unavailable'), label);
  await assert.rejects(beginUpload({ ...w.ctx, now: () => NaN }, row), refused(503, 'storage_unavailable'));
  for (const noEnv of [{}, { SUPABASE_URL: env.SUPABASE_URL }, { SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY }]) await assert.rejects(beginUpload({ ...w.ctx, env: noEnv }, row), refused(503, 'storage_unavailable'));
  assert.equal(w.storage.calls.length, 0);
});

test('begin: an answer that is not a signed upload for exactly this path is refused, and none of it reaches the caller', async () => {
  const answers = (path) => [
    ['no url', () => Response.json({})], ['a url that is not text', () => Response.json({ url: 5 })], ['a list', () => Response.json([])], ['null', () => Response.json(null)],
    ['another object', () => Response.json({ url: `/object/upload/sign/${BUCKET}/league/v1/t/${TENANT}/a/${ASSIGNMENT}/u/${U(999)}.webm?token=tok_upstream` })],
    ['another bucket', () => Response.json({ url: `/object/upload/sign/mnet-media/${path}?token=tok_upstream` })],
    ['a longer name', () => Response.json({ url: `/object/upload/sign/${BUCKET}/${path}.html?token=tok_upstream` })],
    ['no token', () => Response.json({ url: `/object/upload/sign/${BUCKET}/${path}` })], ['an empty token', () => Response.json({ url: `/object/upload/sign/${BUCKET}/${path}?token=` })],
    ['a location on another host', () => Response.json({ url: `https://elsewhere.invalid/object/upload/sign/${BUCKET}/${path}?token=tok_upstream` })],
    ['a location with a line break', () => Response.json({ url: `/object/upload/sign/${BUCKET}/${path}?token=tok\nupstream` })],
    ['text that is not JSON', () => new Response('<html>tok_upstream</html>')],
    ['a refusal', () => Response.json({ statusCode: '409', error: 'Duplicate', message: 'tok_upstream' }, { status: 400 })], ['a failure', () => new Response('upstream tok_upstream', { status: 500 })],
    ['an answer that never ends', () => new Response(new Uint8Array(STORAGE_LIMITS.control_answer_max_bytes + 1).fill(0x20))],
    ['a well-formed answer under a refusal status', () => Response.json({ url: `/object/upload/sign/${BUCKET}/${path}?token=tok_upstream` }, { status: 403 })],
    ['a well-formed answer under a failure status', () => Response.json({ url: `/object/upload/sign/${BUCKET}/${path}?token=tok_upstream` }, { status: 500 })],
    ['a well-formed answer under not found', () => Response.json({ url: `/object/upload/sign/${BUCKET}/${path}?token=tok_upstream` }, { status: 404 })],
    ['a well-formed answer in front of more than an answer may hold', () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(ascii(JSON.stringify({ url: `/object/upload/sign/${BUCKET}/${path}?token=tok_upstream` })));
      controller.enqueue(new Uint8Array(STORAGE_LIMITS.control_answer_max_bytes).fill(0x20));
      controller.close();
    } }))]
  ];
  const probe = world();
  for (const [label] of answers(pathOf(probe.league.staged()))) {
    const w = world();
    const row = w.league.staged();
    const answer = answers(pathOf(row)).find(([name]) => name === label)[1];
    w.storage.intercept(() => answer());
    await assert.rejects(beginUpload(w.ctx, row), (error) => refused(503, 'storage_unavailable')(error) && !/upstream|elsewhere|token/.test(inspect(error, { depth: 9 })), label);
    assert.equal(w.storage.calls.length, 1, label);
  }
});

/* ------------------------------------------------------------------ complete */

test('complete: no stored object answers 409 upload_missing; nothing is read or sealed and the row stays staged', async () => {
  const w = world();
  const row = w.league.staged();
  await assert.rejects(completeUpload(w.ctx, row, PARTICIPANT), refused(409, 'upload_missing'));
  assert.deepEqual(w.storage.calls.map(routeOf), [`POST object/list/${BUCKET}`]);
  assert.deepEqual(w.storage.calls[0].json, { prefix: `league/v1/t/${TENANT}/a/${ASSIGNMENT}/u`, search: `${row.id}.webm`, limit: STORAGE_LIMITS.list_limit });
  assert.deepEqual([w.storage.calls[0].service, w.storage.calls[0].redirect, w.storage.calls[0].signal], [true, 'manual', true]);
  /* A neighbour whose name only starts the same way, and a folder named like the file, are not this object. */
  w.storage.store(`${pathOf(row)}.bak`, WEBM, { contentType: 'audio/webm' });
  w.storage.store(`${pathOf(row)}/inner.webm`, WEBM, { contentType: 'audio/webm' });
  await assert.rejects(completeUpload(w.ctx, row, PARTICIPANT), refused(409, 'upload_missing'));
  assert.equal(w.storage.calls.filter((c) => c.method === 'GET').length, 0);
  assert.equal(w.league.sealCalls.length, 0);
  assert.equal(w.league.get(row.id).state, 'staged');
  assert.equal(w.storage.paths().length, 2, 'nothing was deleted');
});

test('complete: the object is listed, read once, and the seal is called with exactly what was measured', async () => {
  const w = world();
  const bytes = filled(WEBM, 300);
  w.storage.chunking = 64;
  const { row, path } = await uploaded(w, bytes);
  const before = w.storage.calls.length;
  const out = await completeUpload(w.ctx, row, PARTICIPANT);
  const made = w.storage.calls.slice(before);
  assert.deepEqual(made.map(routeOf), [`POST object/list/${BUCKET}`, `GET object/authenticated/${BUCKET}/${path}`]);
  for (const call of made) assert.deepEqual([call.service, call.redirect, call.signal], [true, 'manual', true], routeOf(call));
  assert.equal(made[1].headers.range, undefined, 'the whole object, not a range');
  assert.deepEqual(made[1].stream, { chunks: 5, bytes: 300, ended: true, cancelled: false }, 'one pass to the end');
  const record = w.storage.object(path);
  const expected = { outcome: 'sealed', bytes: 300, sha256: sha256(bytes), family: 'ebml', storage: { object_id: record.id, etag: record.eTag, size: 300 } };
  assert.deepEqual(w.league.sealCalls, [{ p_upload: row.id, p_actor: PARTICIPANT, p_result: expected }]);
  assert.equal(C.checkDocument(C.DOCUMENTS.seal_result, w.league.sealCalls[0].p_result), null);
  assert.deepEqual(out, w.league.get(row.id), 'the row the seal answered, as it is');
  assert.deepEqual([out.state, out.bytes, out.sha256, out.family, out.scan_state], ['sealed', 300, sha256(bytes), 'ebml', 'not_scanned']);
  assert.ok(w.storage.object(path), 'a sealed object stays');
  /* What a member route answers from it carries no storage identity, tenant or participant. */
  const answer = C.projectShape('member_upload', out);
  for (const hidden of ['storage', 'tenant', 'participant', 'family']) assert.ok(!(hidden in answer), hidden);
});

test('complete: a second complete answers the row and downloads nothing; so does every row that is no longer staged', async () => {
  const w = world();
  const { row, path } = await uploaded(w, WEBM);
  const first = await completeUpload(w.ctx, row, PARTICIPANT);
  const calls = w.storage.calls.length;
  const again = await completeUpload(w.ctx, w.league.get(row.id), PARTICIPANT);
  assert.deepEqual(again, first);
  for (const state of C.ENUMS.UPLOAD_STATES.filter((s) => s !== 'staged')) {
    const given = { ...row, state };
    assert.equal(await completeUpload(w.ctx, given, PARTICIPANT), given, `${state}: answered as it stands`);
  }
  assert.equal(w.storage.calls.length, calls, 'no storage call at all');
  assert.equal(w.league.sealCalls.length, 1, 'one seal');
  assert.ok(w.storage.object(path));
});

test('SHA-256 over a chunked stream equals the published vectors, whatever the chunk boundaries', async () => {
  const chunked = (bytes, sizes) => {
    let offset = 0;
    let turn = 0;
    const seen = { chunks: 0, cancelled: false };
    const stream = new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) { controller.close(); return; }
        const end = Math.min(bytes.length, offset + sizes[turn % sizes.length]);
        controller.enqueue(bytes.slice(offset, end));
        offset = end; turn += 1; seen.chunks += 1;
      },
      cancel() { seen.cancelled = true; }
    }, { highWaterMark: 0 });
    return { stream, seen };
  };
  /* FIPS 180 examples: the empty message, "abc", the 448-bit message and one million "a". */
  const published = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', [[1], [64]]],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', [[1], [2], [3], [64]]],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1', [[1], [7, 1, 13], [55], [56], [64]]],
    ['a'.repeat(1000000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0', [[65536], [64, 63, 65, 4096, 100003], [1000000]]]
  ];
  for (const [text, digest, splits] of published) {
    for (const sizes of splits) {
      const out = await measureMediaStream(chunked(ascii(text), sizes).stream, text.length);
      assert.deepEqual({ sha256: out.sha256, bytes: out.bytes, over: out.over }, { sha256: digest, bytes: text.length, over: false }, `${text.length} bytes in chunks of ${sizes}`);
      assert.deepEqual([...out.head], [...ascii(text.slice(0, C.MEDIA.sniff_bytes))], 'the first bytes, across chunk boundaries');
    }
  }
  /* The cap: the read stops at the first chunk that passes it, the rest is never pulled and no digest is claimed. */
  const { stream, seen } = chunked(ascii('a'.repeat(1000)), [100]);
  const cut = await measureMediaStream(stream, 250);
  assert.deepEqual({ bytes: cut.bytes, over: cut.over, sha256: cut.sha256 }, { bytes: 300, over: true, sha256: null });
  assert.deepEqual(seen, { chunks: 3, cancelled: true });
  assert.deepEqual(await measureMediaStream(null, 10), { bytes: 0, over: false, head: new Uint8Array(0), sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
});

test('complete: a 1000014-byte file delivered in uneven chunks seals with the digest sha256sum and openssl give for it', async () => {
  /* The OggS vector (14 bytes) followed by one million "a". Computed outside this code with sha256sum, openssl dgst and hashlib. */
  const bytes = filled(OGG, 1000014);
  const w = world();
  w.storage.chunking = [1, 2, 3, 5, 8, 13, 4096, 65536, 9973];
  const { row } = await uploaded(w, bytes, { mime: 'audio/ogg', max_bytes: 2000000 });
  const out = await completeUpload(w.ctx, row, PARTICIPANT);
  assert.deepEqual([out.state, out.sha256, out.bytes, out.family], ['sealed', '9d3e5b17a7a9af8f8c098d26e8d829c8575002021848eb3f7e417c982f2e4651', 1000014, 'ogg']);
  const reads = w.storage.calls.filter((c) => c.method === 'GET');
  assert.equal(reads.length, 1, 'read once');
  assert.deepEqual([reads[0].stream.bytes, reads[0].stream.ended, reads[0].stream.cancelled], [1000014, true, false]);
  assert.ok(reads[0].stream.chunks > 40, `${reads[0].stream.chunks} chunks`);
});

test('complete: the magic-byte table decides, for every vector under every declared type', async () => {
  let accepted = 0;
  let rejectedCount = 0;
  for (const v of C.MAGIC_VECTORS) {
    const bytes = C.bytesFromHex(v.hex);
    for (const mime of Object.keys(C.MEDIA.types)) {
      const at = `${v.name} as ${mime}`;
      const w = world();
      const { row, path } = await uploaded(w, bytes, { mime });
      const out = await completeUpload(w.ctx, row, PARTICIPANT);
      if (v.accepts.includes(mime)) {
        accepted += 1;
        assert.deepEqual([out.state, out.family, out.sha256, out.bytes, out.rejected_reason], ['sealed', v.family, sha256(bytes), bytes.length, null], at);
        assert.ok(w.storage.object(path), `${at}: kept`);
      } else {
        rejectedCount += 1;
        const reason = bytes.length === 0 ? 'empty' : v.family === null ? 'unrecognised' : 'family_mismatch';
        assert.deepEqual([out.state, out.rejected_reason, out.sha256, out.family], ['rejected', reason, null, null], at);
        assert.deepEqual(w.league.sealCalls, [{ p_upload: row.id, p_actor: PARTICIPANT, p_result: { outcome: 'rejected', reason } }], at);
        assert.equal(w.storage.object(path), null, `${at}: deleted`);
      }
    }
  }
  assert.equal(accepted, C.MAGIC_VECTORS.reduce((n, v) => n + v.accepts.length, 0));
  assert.deepEqual([accepted, rejectedCount], [14, 121], 'seven media vectors under the types that allow them; every other pair refused');
});

test('complete: a web page, an executable, an empty file and real media under the wrong type are rejected and deleted', async () => {
  const cases = [
    ['a web page as audio', HTML, { mime: 'audio/mpeg' }, 'unrecognised'],
    ['a web page as video', HTML, { mime: 'video/mp4' }, 'unrecognised'],
    ['an MZ executable as video', filled(vector('MZ executable'), 512, 0), { mime: 'video/mp4' }, 'unrecognised'],
    ['an empty file', new Uint8Array(0), { mime: 'audio/webm' }, 'empty'],
    ['three bytes', ascii('abc'), { mime: 'audio/ogg' }, 'unrecognised'],
    ['a WAV declared as MP3', filled(WAV, 44, 0), { mime: 'audio/mpeg' }, 'family_mismatch'],
    ['a WebM declared as MP4', filled(WEBM, 64), { mime: 'video/mp4' }, 'family_mismatch'],
    /* The content type sent with the upload is what a signed read is served as: it has to be media of the same family. */
    ['an MP3 header stored as a web page', filled(vector('mp3 with ID3v2 tag'), 64, 0x3c), { mime: 'audio/mpeg', contentType: 'text/html' }, 'family_mismatch'],
    ['a WAV stored with no type of its own', filled(WAV, 44, 0), { mime: 'audio/wav', contentType: 'application/octet-stream' }, 'family_mismatch'],
    ['a WAV stored as an MP3', filled(WAV, 44, 0), { mime: 'audio/wav', contentType: 'audio/mpeg' }, 'family_mismatch'],
    ['a WAV stored as a WAV for a row that says MP3', filled(WAV, 44, 0), { mime: 'audio/mpeg', contentType: 'audio/wav' }, 'family_mismatch']
  ];
  for (const [label, bytes, options, reason] of cases) {
    const w = world();
    const { row, path } = await uploaded(w, bytes, options);
    const out = await completeUpload(w.ctx, row, PARTICIPANT);
    assert.deepEqual([out.state, out.rejected_reason, out.sha256], ['rejected', reason, null], label);
    assert.deepEqual(w.storage.paths(), [], `${label}: deleted`);
    assert.deepEqual(routeOf(w.storage.calls.at(-1)), `DELETE object/${BUCKET}`, label);
    assert.deepEqual(w.storage.calls.at(-1).json, { prefixes: [path] }, label);
    if (reason === 'empty') assert.equal(w.storage.calls.filter((c) => c.method === 'GET').length, 0, 'an empty object is not read');
  }
  /* The same media with the parameters a recorder adds, or under the other type of its family, is the declared file. */
  for (const contentType of ['audio/webm;codecs=opus', 'AUDIO/WEBM; codecs="opus"', 'video/webm']) {
    const w = world();
    const { row } = await uploaded(w, filled(WEBM, 64), { mime: 'audio/webm', contentType });
    assert.equal((await completeUpload(w.ctx, row, PARTICIPANT)).state, 'sealed', contentType);
  }
});

test('complete: sizes are checked on the listing before anything is read, and the read stops at the first byte too many', async () => {
  const reads = (w) => w.storage.calls.filter((c) => c.method === 'GET');
  const expectRejected = async (w, row, path, reason, label) => {
    const out = await completeUpload(w.ctx, row, PARTICIPANT);
    assert.deepEqual([out.state, out.rejected_reason], ['rejected', reason], label);
    assert.equal(w.storage.object(path), null, `${label}: deleted`);
  };
  { /* more than the row may hold */
    const w = world();
    const { row, path } = await uploaded(w, filled(WEBM, 64), { declared: 64, max_bytes: 32 });
    await expectRejected(w, row, path, 'too_large', 'over max_bytes');
    assert.equal(reads(w).length, 0, 'not read');
  }
  { /* more than the hard ceiling, even if a row said otherwise */
    const w = world();
    const { row, path } = await uploaded(w, filled(WEBM, 64), { declared: C.MEDIA.hard_max_bytes + 1, max_bytes: C.MEDIA.hard_max_bytes + 1000 });
    w.storage.object(path).size = C.MEDIA.hard_max_bytes + 1;
    await expectRejected(w, row, path, 'too_large', 'over the hard ceiling');
    assert.equal(reads(w).length, 0, 'not read');
  }
  { /* not the size that was declared */
    const w = world();
    const { row, path } = await uploaded(w, filled(WEBM, 64), { declared: 60 });
    await expectRejected(w, row, path, 'size_mismatch', 'stored 64, declared 60');
    assert.equal(reads(w).length, 0, 'not read');
  }
  { /* the listing names fewer bytes than the object has: the read stops as soon as that shows */
    const w = world();
    w.storage.chunking = 8;
    const { row, path } = await uploaded(w, filled(WEBM, 40), { declared: 16 });
    w.storage.object(path).size = 16;
    await expectRejected(w, row, path, 'size_mismatch', 'listed 16, holds 40');
    assert.deepEqual(reads(w)[0].stream, { chunks: 3, bytes: 24, ended: false, cancelled: true });
  }
  { /* the listing names more bytes than the object has */
    const w = world();
    const { row, path } = await uploaded(w, filled(WEBM, 16), { declared: 20 });
    w.storage.object(path).size = 20;
    await expectRejected(w, row, path, 'size_mismatch', 'listed 20, holds 16');
    assert.deepEqual(reads(w)[0].stream, { chunks: 1, bytes: 16, ended: true, cancelled: false });
  }
  { /* the read returns nothing where the listing named sixteen bytes */
    const w = world();
    const { row, path } = await uploaded(w, WEBM);
    w.storage.intercept((call) => (call.method === 'GET' ? new Response(null, { status: 200 }) : undefined));
    await expectRejected(w, row, path, 'size_mismatch', 'listed 16, read 0');
  }
  { /* the hard cap of the read itself: a megabyte behind a listing of 1000 is cut at the first chunk */
    const w = world();
    const { row, path } = await uploaded(w, filled(WEBM, 1048576), { declared: 1000, max_bytes: 1000 });
    w.storage.object(path).size = 1000;
    await expectRejected(w, row, path, 'too_large', 'a megabyte behind a listing of 1000');
    assert.deepEqual(reads(w)[0].stream, { chunks: 1, bytes: 65536, ended: false, cancelled: true });
  }
  { /* a listed size and a read that agree with the declaration seal, including when the size arrives as digits */
    const w = world();
    const { row, path } = await uploaded(w, filled(WEBM, 64));
    w.storage.intercept((call) => {
      if (!call.route.startsWith('object/list/')) return undefined;
      const o = w.storage.object(path);
      return Response.json([{ name: `${row.id}.webm`, id: o.id.toUpperCase(), metadata: { eTag: o.eTag, size: '64', mimetype: 'audio/webm' } }]);
    });
    const out = await completeUpload(w.ctx, row, PARTICIPANT);
    assert.equal(out.state, 'sealed');
    assert.deepEqual(w.league.sealCalls[0].p_result.storage, { object_id: w.storage.object(path).id, etag: w.storage.object(path).eTag, size: 64 }, 'lower-case id, numeric size');
  }
});

test('complete: when the seal refuses, its error passes through unchanged and the object is kept, whatever was measured', async () => {
  for (const [label, bytes] of [['a file that would seal', WEBM], ['a file that would be rejected', HTML]]) {
    const w = world();
    const { row, path } = await uploaded(w, bytes);
    const draining = fail(503, 'The module is draining', 'module_draining');
    w.league.refuse(draining);
    await assert.rejects(completeUpload(w.ctx, row, PARTICIPANT), (error) => error === draining, label);
    assert.ok(w.storage.object(path), `${label}: the object is kept`);
    assert.equal(w.league.get(row.id).state, 'staged', label);
    assert.equal(w.storage.calls.filter((c) => c.method === 'DELETE').length, 0, label);
    w.league.refuse(null);
    assert.notEqual((await completeUpload(w.ctx, w.league.get(row.id), PARTICIPANT)).state, 'staged', `${label}: completes once the seal answers`);
  }
});

test('complete: a staged row past its time is answered expired by the seal, and its object is deleted', async () => {
  const w = world();
  const { row, path } = await uploaded(w, WEBM);
  w.clock.ms = Date.parse(row.expires_at) + 1;
  const out = await completeUpload(w.ctx, row, PARTICIPANT);
  assert.deepEqual([out.state, out.sha256, out.rejected_reason], ['expired', null, null]);
  assert.equal(w.league.sealCalls[0].p_result.outcome, 'sealed', 'the measurement was sent; the seal decided');
  assert.equal(w.storage.object(path), null);
  const calls = w.storage.calls.length;
  assert.equal((await completeUpload(w.ctx, w.league.get(row.id), PARTICIPANT)).state, 'expired');
  assert.equal(w.storage.calls.length, calls);
});

test('complete: only for the participant of the row; another account reaches neither storage nor the seal', async () => {
  const w = world();
  const { row, path } = await uploaded(w, WEBM);
  const calls = w.storage.calls.length;
  for (const actor of [OTHER, undefined, null, '', 'owner', { id: PARTICIPANT }]) await assert.rejects(completeUpload(w.ctx, row, actor), refused(404, 'not_available'), String(actor));
  /* A sealed row is not answered to another account either. */
  await assert.rejects(completeUpload(w.ctx, { ...row, state: 'sealed' }, OTHER), refused(404, 'not_available'));
  assert.equal(w.storage.calls.length, calls);
  assert.equal(w.league.sealCalls.length, 0);
  assert.ok(w.storage.object(path));
  assert.equal((await completeUpload(w.ctx, row, PARTICIPANT.toUpperCase())).state, 'sealed', 'the same account in another letter case');
  assert.equal(w.league.sealCalls[0].p_actor, PARTICIPANT);
});

test('complete: a row that cannot name its object, or a caller that supplied no seal, never reaches storage', async () => {
  const w = world();
  const { row } = await uploaded(w, WEBM);
  const calls = w.storage.calls.length;
  const cases = [...MALFORMED, ['no participant', ({ participant: _participant, ...r }) => r], ['a declared size of zero', (r) => ({ ...r, declared_bytes: 0 })],
    ['a cap that is not a number', (r) => ({ ...r, max_bytes: '1000' })], ['no cap', ({ max_bytes: _max, ...r }) => r]];
  for (const [label, change] of cases) await assert.rejects(completeUpload(w.ctx, change(row), PARTICIPANT), refused(503, 'storage_unavailable'), label);
  const { seal: _seal, ...withoutSeal } = w.ctx;
  await assert.rejects(completeUpload(withoutSeal, row, PARTICIPANT), refused(503, 'storage_unavailable'));
  await assert.rejects(completeUpload({ ...w.ctx, env: {} }, row, PARTICIPANT), refused(503, 'storage_unavailable'));
  assert.equal(w.storage.calls.length, calls);
  assert.equal(w.league.sealCalls.length, 0);
});

test('complete: a listing or a read storage did not answer properly is 503; nothing is sealed and nothing is deleted', async () => {
  const listing = (row, change) => () => Response.json([change({ name: `${row.id}.${row.ext}`, id: U(700), metadata: { eTag: '"abc"', size: 16, mimetype: 'audio/webm' } })]);
  const lists = (row) => [
    ['an id that is not a uuid', listing(row, (r) => ({ ...r, id: '7' }))], ['no metadata', listing(row, (r) => ({ ...r, metadata: null }))],
    ['no eTag', listing(row, (r) => ({ ...r, metadata: { ...r.metadata, eTag: undefined } }))], ['an empty eTag', listing(row, (r) => ({ ...r, metadata: { ...r.metadata, eTag: '' } }))],
    ['an eTag longer than the seal stores', listing(row, (r) => ({ ...r, metadata: { ...r.metadata, eTag: 'e'.repeat(C.LIMITS.text.etag + 1) } }))],
    ['an eTag with a control character', listing(row, (r) => ({ ...r, metadata: { ...r.metadata, eTag: '"a\u0000b"' } }))],
    ['a negative size', listing(row, (r) => ({ ...r, metadata: { ...r.metadata, size: -1 } }))], ['a fractional size', listing(row, (r) => ({ ...r, metadata: { ...r.metadata, size: 1.5 } }))],
    ['a size that is not a number', listing(row, (r) => ({ ...r, metadata: { ...r.metadata, size: '16 bytes' } }))], ['no size', listing(row, (r) => ({ ...r, metadata: { ...r.metadata, size: null } }))],
    ['no content type', listing(row, (r) => ({ ...r, metadata: { ...r.metadata, mimetype: undefined } }))],
    ['an object, not a list', () => Response.json({ name: `${row.id}.${row.ext}` })], ['text that is not JSON', () => new Response('not json')],
    ['a refusal', () => Response.json({ statusCode: '403', error: 'Unauthorized', message: 'tok_upstream' }, { status: 403 })], ['a failure', () => new Response('tok_upstream', { status: 500 })],
    ['an empty list under a failure status', () => Response.json([], { status: 500 })],
    ['a complete listing under a refusal status', () => Response.json([{ name: `${row.id}.${row.ext}`, id: U(700), metadata: { eTag: '"abc"', size: 16, mimetype: 'audio/webm' } }], { status: 403 })]
  ];
  const reads = [
    ['gone', () => Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 404 })], ['a failure', () => new Response('tok_upstream', { status: 500 })],
    ['a partial answer', () => new Response(WEBM.subarray(0, 8), { status: 206, headers: { 'content-range': 'bytes 0-7/16' } })],
    ['a body that breaks half way', () => new Response(new ReadableStream({ start(controller) { controller.enqueue(WEBM.subarray(0, 8)); }, pull(controller) { controller.error(new Error('connection lost at token=tok_upstream')); } }))],
    ['a failure whose body is the file', () => new Response(WEBM, { status: 500 })], ['a refusal whose body is the file', () => new Response(WEBM, { status: 403 })],
    ['an answer with no content', () => new Response(null, { status: 204 })],
    ['chunks that are text', () => ({ status: 200, ok: true, type: 'basic', headers: new Headers(), body: { getReader: () => ({ read: async () => ({ done: false, value: 'text' }), cancel: async () => {} }) } })],
    ['chunks that are another kind of array', () => { let sent = false; return { status: 200, ok: true, type: 'basic', headers: new Headers(),
      body: { getReader: () => ({ read: async () => { if (sent) return { done: true, value: undefined }; sent = true; return { done: false, value: new Uint16Array(WEBM.slice().buffer) }; }, cancel: async () => {} }) } }; }]
  ];
  const probe = world();
  const probeRow = probe.league.staged();
  for (const [stage, table] of [['object/list/', lists(probeRow)], ['object/authenticated/', reads]]) {
    for (let i = 0; i < table.length; i += 1) {
      const w = world();
      const { row, path } = await uploaded(w, WEBM);
      const [label, answer] = stage === 'object/list/' ? lists(row)[i] : table[i];
      const inner = w.ctx.fetchImpl;
      /* An answer that is not a Response object goes straight in, past the double. */
      w.ctx.fetchImpl = function scripted(input, init) { return String(input).includes(`/storage/v1/${stage}`) ? Promise.resolve(answer()) : inner(input, init); };
      await assert.rejects(completeUpload(w.ctx, row, PARTICIPANT), (error) => refused(503, 'storage_unavailable')(error) && !/upstream|token/.test(inspect(error, { depth: 9 })), `${stage} ${label}`);
      assert.equal(w.league.sealCalls.length, 0, label);
      assert.ok(w.storage.object(path), `${label}: kept`);
      assert.equal(w.storage.calls.filter((c) => c.method === 'DELETE').length, 0, label);
      if (stage === 'object/list/') assert.equal(w.storage.calls.filter((c) => c.method === 'GET').length, 0, `${label}: not read`);
    }
  }
});

test('complete: a deletion that fails after a rejection is left to the purge, and an answer of the seal that is not this row is 503', async () => {
  { const w = world();
    const { row, path } = await uploaded(w, HTML);
    w.storage.intercept((call) => (call.method === 'DELETE' ? new Response('tok_upstream', { status: 500 }) : undefined));
    const out = await completeUpload(w.ctx, row, PARTICIPANT);
    assert.deepEqual([out.state, out.rejected_reason], ['rejected', 'unrecognised']);
    assert.ok(w.storage.object(path), 'still there; the purge removes rejected rows');
  }
  for (const [label, answer] of [['nothing', () => null], ['a list', (row) => [row]], ['another row', (row) => ({ ...row, id: U(999), state: 'sealed' })], ['a row still staged', (row) => ({ ...row })], ['a row in a state nobody defined', (row) => ({ ...row, state: 'done' })]]) {
    const w = world();
    const { row, path } = await uploaded(w, WEBM);
    await assert.rejects(completeUpload({ ...w.ctx, seal: async () => answer(row) }, row, PARTICIPANT), refused(503, 'storage_unavailable'), label);
    assert.ok(w.storage.object(path), `${label}: kept`);
  }
});

/* ------------------------------------------------------------------ discard */

test('discard: the object of a discarded row is deleted; no other row is ever touched and nothing is thrown', async () => {
  const w = world();
  const { row, path } = await uploaded(w, WEBM);
  const neighbour = await uploaded(w, WAV, { mime: 'audio/wav' });
  for (const state of C.ENUMS.UPLOAD_STATES.filter((s) => s !== 'discarded')) assert.deepEqual(await discardUpload(w.ctx, { ...row, state }), { deleted: false }, state);
  for (const [label, change] of UNADDRESSABLE) assert.deepEqual(await discardUpload(w.ctx, change({ ...row, state: 'discarded' })), { deleted: false }, label);
  assert.equal(w.storage.calls.filter((c) => c.method === 'DELETE').length, 0, 'nothing was asked of storage so far');
  assert.deepEqual(await discardUpload(w.ctx, { ...row, state: 'discarded' }), { deleted: true });
  const call = w.storage.calls.at(-1);
  assert.equal(routeOf(call), `DELETE object/${BUCKET}`);
  assert.deepEqual(call.json, { prefixes: [path] });
  assert.deepEqual([call.service, call.redirect, call.signal], [true, 'manual', true]);
  assert.deepEqual(w.storage.paths(), [neighbour.path], 'only that object');
  assert.deepEqual(await discardUpload(w.ctx, { ...row, state: 'discarded' }), { deleted: true }, 'an object that is already gone is gone');
  /* A storage failure is reported, never thrown: the purge removes what is left. */
  const failures = [() => new Response('tok_upstream', { status: 500 }), () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.invalid/' } }), () => Response.json({ deleted: true }), () => new Response('not json'), () => { throw new TypeError('fetch failed'); },
    () => Response.json([], { status: 500 }), () => Response.json([], { status: 403 })];
  for (const answer of failures) {
    const off = w.storage.intercept((c) => (c.method === 'DELETE' ? answer() : undefined));
    assert.deepEqual(await discardUpload(w.ctx, { ...neighbour.row, state: 'discarded' }), { deleted: false });
    off();
  }
  assert.deepEqual(await discardUpload({ ...w.ctx, env: {} }, { ...neighbour.row, state: 'discarded' }), { deleted: false });
  assert.deepEqual(w.storage.paths(), [neighbour.path]);
});

/* ------------------------------------------------------------------ signed reads */

test('own read: the stored identity is re-checked, then one read is signed for signed_read_seconds', async () => {
  const w = world();
  const bytes = filled(WEBM, 300);
  const row = await sealedRow(w, bytes);
  const path = pathOf(row);
  const before = w.storage.calls.length;
  const out = await signOwnRead(w.ctx, { ...row, path: 'mine/other.webm', bucket: 'mnet-media' });
  assert.deepEqual(Object.keys(out), ['url', 'expires_in']);
  assert.equal(out.expires_in, 300);
  assert.equal(out.expires_in, C.MEDIA.signed_read_seconds);
  assert.ok(out.url.startsWith(`https://fixture.invalid/storage/v1/object/sign/${BUCKET}/${path}?token=`), out.url);
  const made = w.storage.calls.slice(before);
  assert.deepEqual(made.map(routeOf), [`POST object/list/${BUCKET}`, `POST object/sign/${BUCKET}/${path}`]);
  assert.deepEqual(made[1].json, { expiresIn: 300 });
  for (const call of made) assert.deepEqual([call.service, call.redirect, call.signal], [true, 'manual', true]);
  /* The link plays the sealed bytes, as the stored type, until it expires. */
  const play = await w.storage.read(out.url);
  assert.deepEqual([play.status, play.headers.get('content-type')], [200, 'audio/webm']);
  assert.equal(sha256(new Uint8Array(await play.arrayBuffer())), row.sha256);
  const part = await w.storage.read(out.url, { range: 'bytes=0-11' });
  assert.deepEqual([part.status, part.headers.get('content-range'), (await part.arrayBuffer()).byteLength], [206, 'bytes 0-11/300', 12]);
  w.clock.ms += 300 * 1000;
  assert.equal((await w.storage.read(out.url)).ok, false, 'expired after 300 seconds');
  /* The stored id compares without regard to letter case. */
  w.clock.ms = T0;
  assert.ok((await signOwnRead(w.ctx, { ...row, storage: { ...row.storage, object_id: row.storage.object_id.toUpperCase() } })).url);
});

test('own read: 409 media_changed when the object id, the eTag or the size moved, or the object is gone; nothing is signed', async () => {
  const moves = [
    ['replaced by another file', (w, path) => w.storage.store(path, filled(WEBM, 300, 0x62), { contentType: 'audio/webm' })],
    ['replaced by the same bytes', (w, path) => w.storage.store(path, w.storage.object(path).bytes, { contentType: 'audio/webm' })],
    ['another object id', (w, path) => { w.storage.object(path).id = U(900); }],
    ['another eTag', (w, path) => { w.storage.object(path).eTag = '"0000"'; }],
    ['another size', (w, path) => { w.storage.object(path).size += 1; }],
    ['gone', (w, path) => w.storage.remove(path)]
  ];
  for (const [label, move] of moves) {
    const w = world();
    const row = await sealedRow(w, filled(WEBM, 300));
    move(w, pathOf(row));
    await assert.rejects(signOwnRead(w.ctx, row), refused(409, 'media_changed'), label);
    assert.equal(w.storage.calls.filter((c) => c.route.startsWith('object/sign/')).length, 0, `${label}: nothing signed`);
  }
  /* A stored identity that differs from the listing in one field. */
  const w = world();
  const row = await sealedRow(w, filled(WEBM, 300));
  for (const storage of [{ ...row.storage, object_id: U(901) }, { ...row.storage, etag: `${row.storage.etag} ` }]) await assert.rejects(signOwnRead(w.ctx, { ...row, storage }), refused(409, 'media_changed'));
  assert.equal(w.storage.calls.filter((c) => c.route.startsWith('object/sign/')).length, 0);
});

test('own read: only a sealed row with its stored identity; anything else never reaches storage', async () => {
  const w = world();
  const row = await sealedRow(w, filled(WEBM, 300));
  const calls = w.storage.calls.length;
  for (const state of C.ENUMS.UPLOAD_STATES.filter((s) => s !== 'sealed')) await assert.rejects(signOwnRead(w.ctx, { ...row, state }), refused(409, 'media_changed'), state);
  const broken = [...MALFORMED, ['no stored identity (a read that did not ask to sign)', (r) => ({ ...r, storage: null })], ['an identity without an eTag', (r) => ({ ...r, storage: { object_id: r.storage.object_id, size: r.storage.size } })],
    ['an identity with a path in it', (r) => ({ ...r, storage: { ...r.storage, path: 'x' } })], ['an identity whose size is not the sealed size', (r) => ({ ...r, storage: { ...r.storage, size: r.bytes + 1 } })],
    ['an identity whose id is not a uuid', (r) => ({ ...r, storage: { ...r.storage, object_id: 'object' } })]];
  for (const [label, change] of broken) await assert.rejects(signOwnRead(w.ctx, change(row)), refused(503, 'storage_unavailable'), label);
  await assert.rejects(signOwnRead({ ...w.ctx, env: {} }, row), refused(503, 'storage_unavailable'));
  assert.equal(w.storage.calls.length, calls);
});

test('own read: a signed location that is not for this object is refused', async () => {
  const w = world();
  const row = await sealedRow(w, filled(WEBM, 300));
  const path = pathOf(row);
  const answers = [() => Response.json({}), () => Response.json({ signedURL: `/object/sign/${BUCKET}/league/v1/t/${TENANT}/a/${ASSIGNMENT}/u/${U(999)}.webm?token=tok_upstream` }), () => Response.json({ signedURL: `/object/sign/mnet-media/${path}?token=tok_upstream` }),
    () => Response.json({ signedURL: `/object/upload/sign/${BUCKET}/${path}?token=tok_upstream` }), () => Response.json({ signedURL: `/object/sign/${BUCKET}/${path}` }), () => Response.json({ signedURL: `https://elsewhere.invalid/object/sign/${BUCKET}/${path}?token=tok_upstream` }),
    () => Response.json({ statusCode: '404', error: 'not_found', message: 'Object not found' }, { status: 400 }), () => new Response('tok_upstream', { status: 500 }),
    () => Response.json({ signedURL: `/object/sign/${BUCKET}/${path}?token=tok_upstream` }, { status: 403 }), () => Response.json({ signedURL: `/object/sign/${BUCKET}/${path}?token=tok_upstream` }, { status: 500 })];
  for (const answer of answers) {
    const off = w.storage.intercept((call) => (call.route.startsWith('object/sign/') ? answer() : undefined));
    await assert.rejects(signOwnRead(w.ctx, row), (error) => refused(503, 'storage_unavailable')(error) && !/upstream|elsewhere|token/.test(inspect(error, { depth: 9 })));
    off();
  }
  /* The two spellings the service has used for the key, with or without the leading slash, are the same answer. */
  for (const body of [{ signedUrl: `/object/sign/${BUCKET}/${path}?token=tok_spelling` }, { signedURL: `object/sign/${BUCKET}/${path}?token=tok_spelling` }]) {
    const off = w.storage.intercept((call) => (call.route.startsWith('object/sign/') ? Response.json(body) : undefined));
    assert.equal((await signOwnRead(w.ctx, row)).url, `https://fixture.invalid/storage/v1/object/sign/${BUCKET}/${path}?token=tok_spelling`);
    off();
  }
});

/* The order of GET uploads/:id/url (MEDIA.order.own_read), with the SQL read modelled: the participant reads their own
   sealed row, anyone else is refused the way a member route answers 42501. */
async function ownReadRoute(w, uploadId, actor) {
  const sql = (sqlstate) => { const answer = C.errorFor(sqlstate, 'member'); return fail(answer.status, 'Not available', answer.code); };
  const row = w.league.get(uploadId);
  if (!row) throw sql('P0002');
  if (row.participant !== actor) throw sql('42501');
  if (row.state !== 'sealed') throw sql('EU014');
  const signed = await signOwnRead(w.ctx, row);
  return { ok: true, media: C.projectShape('proof_media', { ...row, upload_id: row.id }), ...signed };
}

test('own read of another participant\'s upload: the read is refused before the module, and a borrowed identity signs nothing', async () => {
  const w = world();
  const mine = await sealedRow(w, filled(WEBM, 300));
  const before = w.storage.calls.length;
  /* The route order: the SQL read answers first (modelled here), so the module is never reached for a foreign row. */
  await assert.rejects(ownReadRoute(w, mine.id, OTHER), (error) => error.status === 404 && error.reason === 'not_available');
  await assert.rejects(ownReadRoute(w, U(404), OTHER), (error) => error.status === 404 && error.reason === 'not_available');
  assert.equal(w.storage.calls.length, before, 'no storage call for another account');
  const answer = await ownReadRoute(w, mine.id, PARTICIPANT);
  assert.deepEqual(Object.keys(answer), ['ok', 'media', 'url', 'expires_in']);
  assert.deepEqual(answer.media, { upload_id: mine.id, kind: 'audio', mime: 'audio/webm', bytes: 300, sha256: mine.sha256 });
  /* The module's own part: the URL is for the path of the row's own ids, and only while that path holds the identity
     the row stores. A row of the other account that carries this upload's identity gets nothing. */
  const theirs = w.league.staged({ participant: OTHER, assignment_id: U(3), bytes: 300 });
  const forged = { ...theirs, state: 'sealed', bytes: mine.bytes, sha256: mine.sha256, family: mine.family, storage: mine.storage };
  await assert.rejects(signOwnRead(w.ctx, forged), refused(409, 'media_changed'), 'nothing is stored at their own path');
  w.storage.store(pathOf(theirs), filled(WEBM, 300), { contentType: 'audio/webm' });
  await assert.rejects(signOwnRead(w.ctx, forged), refused(409, 'media_changed'), 'their own object is not the identity they presented');
  assert.equal(w.storage.calls.filter((c) => c.route.startsWith('object/sign/') && c.route.includes(theirs.id)).length, 0);
  assert.ok(w.storage.calls.filter((c) => c.route.startsWith('object/list/')).every((c) => c.json.prefix !== `league/v1/t/${TENANT}/a/${ASSIGNMENT}/u` || c.json.search === `${mine.id}.webm`));
});

test('review read: every upload of the revision is checked, then signed, in the order the proof lists them', async () => {
  const w = world();
  const audio = await sealedRow(w, filled(WEBM, 300));
  const video = await sealedRow(w, filled(vector('mov'), 500, 0), { mime: 'video/quicktime' });
  const unused = await sealedRow(w, filled(WAV, 44, 0), { mime: 'audio/wav' });
  const proof = proofOf(w, [unused, video, audio]);
  proof.media = [audio, video].map((u) => ({ upload_id: u.id, kind: u.kind, mime: u.mime, bytes: u.bytes, sha256: u.sha256 }));
  const before = w.storage.calls.length;
  const out = await signReviewRead(w.ctx, proof);
  assert.deepEqual(out.map((m) => Object.keys(m)), [['upload_id', 'kind', 'mime', 'bytes', 'sha256', 'url', 'expires_in'], ['upload_id', 'kind', 'mime', 'bytes', 'sha256', 'url', 'expires_in']]);
  assert.deepEqual(out.map(({ url: _url, ...rest }) => rest), [
    { upload_id: audio.id, kind: 'audio', mime: 'audio/webm', bytes: 300, sha256: audio.sha256, expires_in: 300 },
    { upload_id: video.id, kind: 'video', mime: 'video/quicktime', bytes: 500, sha256: video.sha256, expires_in: 300 }]);
  assert.deepEqual(w.storage.calls.slice(before).map(routeOf), [`POST object/list/${BUCKET}`, `POST object/list/${BUCKET}`, `POST object/sign/${BUCKET}/${pathOf(audio)}`, `POST object/sign/${BUCKET}/${pathOf(video)}`],
    'both identities first, then both signatures; an upload the revision does not list is not signed');
  for (const [entry, row] of [[out[0], audio], [out[1], video]]) {
    const play = await w.storage.read(entry.url);
    assert.equal(sha256(new Uint8Array(await play.arrayBuffer())), row.sha256);
  }
  /* The accommodation path has no media: nothing to check and nothing to sign. */
  const calls = w.storage.calls.length;
  assert.deepEqual(await signReviewRead(w.ctx, proofOf(w, [])), []);
  assert.equal(w.storage.calls.length, calls);
});

test('review read: refused when the proof is held, and when an upload is not bound to this proof; nothing is signed', async () => {
  const w = world();
  const audio = await sealedRow(w, filled(WEBM, 300));
  const video = await sealedRow(w, filled(vector('mov'), 500, 0), { mime: 'video/quicktime' });
  const third = await sealedRow(w, filled(OGG, 64), { mime: 'audio/ogg' });
  const fourth = await sealedRow(w, filled(WAV, 44, 0), { mime: 'audio/wav' });
  const calls = w.storage.calls.length;
  const hold = C.errorFor('EU016', 'owner');
  await assert.rejects(signReviewRead(w.ctx, proofOf(w, [audio, video], { moderation_state: 'held' })), refused(hold.status, hold.code));
  assert.deepEqual([hold.status, hold.code], [409, 'moderation_hold']);
  const unbound = [
    ['an upload of another tenant', (p) => { p.uploads[0].tenant = U(77); }],
    ['an upload of another assignment', (p) => { p.uploads[1].assignment_id = U(78); }],
    ['an upload of another participant', (p) => { p.uploads[0].participant = OTHER; }],
    ['a proof of another tenant', (p) => { p.tenant = U(77); }],
    ['a proof of another assignment', (p) => { p.assignment_id = U(78); }],
    ['an upload that is not in the answer', (p) => { p.uploads.pop(); }],
    ['a digest that is not the one the revision lists', (p) => { p.media[0].sha256 = 'cd'.repeat(32); }],
    ['a size that is not the one the revision lists', (p) => { p.media[1].bytes += 1; }],
    ['a type that is not the one the revision lists', (p) => { p.media[0].mime = 'audio/ogg'; }],
    ['an upload that was purged', (p) => { p.uploads[0].state = 'purged'; }],
    ['an upload that was discarded', (p) => { p.uploads[1].state = 'discarded'; }]
  ];
  for (const [label, change] of unbound) {
    const proof = structuredClone(proofOf(w, [audio, video]));
    change(proof);
    await assert.rejects(signReviewRead(w.ctx, proof), refused(409, 'media_changed'), label);
  }
  const malformed = [
    ['no moderation state', (p) => { delete p.moderation_state; }], ['a moderation state nobody defined', (p) => { p.moderation_state = 'fine'; }], ['no tenant', (p) => { delete p.tenant; }],
    ['media that is not a list', (p) => { p.media = { 0: p.media[0] }; }], ['more media than a proof may list', (p) => { const more = proofOf(w, [audio, video, third, fourth]); p.media = more.media; p.uploads = more.uploads; }],
    ['the same upload twice', (p) => { p.media[1] = { ...p.media[0] }; }], ['an entry without a digest', (p) => { delete p.media[0].sha256; }], ['an entry whose kind is not the kind of its type', (p) => { p.media[0].kind = 'video'; }],
    ['an upload without its stored identity', (p) => { p.uploads[0].storage = null; }], ['an upload whose extension is not the extension of its type', (p) => { p.uploads[0].ext = 'mp3'; }]
  ];
  for (const [label, change] of malformed) {
    const proof = structuredClone(proofOf(w, [audio, video]));
    change(proof);
    await assert.rejects(signReviewRead(w.ctx, proof), refused(503, 'storage_unavailable'), label);
  }
  for (const notProof of [null, 'proof', []]) await assert.rejects(signReviewRead(w.ctx, notProof), refused(503, 'storage_unavailable'));
  assert.equal(w.storage.calls.length, calls, 'none of these reached storage');
  assert.equal((await signReviewRead(w.ctx, proofOf(w, [audio, video, third]))).length, C.LIMITS.count.proof_media, 'three is the most a proof lists');
  const signedSoFar = w.storage.calls.filter((c) => c.route.startsWith('object/sign/')).length;
  /* The second upload moved in storage: the first is not signed either. */
  w.storage.object(pathOf(video)).eTag = '"0000"';
  await assert.rejects(signReviewRead(w.ctx, proofOf(w, [audio, video])), refused(409, 'media_changed'));
  assert.equal(w.storage.calls.filter((c) => c.route.startsWith('object/sign/')).length, signedSoFar, 'nothing more was signed');
});

/* The order of GET proofs/:id/media (MEDIA.order.review_read), with the SQL read modelled: the revision asked for has
   to be the proof's current one (40001) and a held proof is refused (EU016) before anything else happens. */
async function reviewReadRoute(w, proof, revision) {
  const sql = (sqlstate) => { const answer = C.errorFor(sqlstate, 'owner'); return fail(answer.status, 'Refused', answer.code); };
  if (revision !== proof.revision) throw sql('40001');
  if (proof.moderation_state === 'held') throw sql('EU016');
  return { ok: true, proof, media: await signReviewRead(w.ctx, proof) };
}

test('review read order: a revision that is not the proof\'s, or a held proof, is refused by the read before any storage call', async () => {
  const w = world();
  const audio = await sealedRow(w, filled(WEBM, 300));
  const proof = proofOf(w, [audio]);
  const calls = w.storage.calls.length;
  await assert.rejects(reviewReadRoute(w, proof, 1), (error) => error.status === 409 && error.reason === 'revision_conflict');
  await assert.rejects(reviewReadRoute(w, { ...proof, moderation_state: 'held' }, 2), (error) => error.status === 409 && error.reason === 'moderation_hold');
  assert.equal(w.storage.calls.length, calls);
  const answer = await reviewReadRoute(w, proof, 2);
  assert.deepEqual([answer.media.length, answer.media[0].upload_id, answer.media[0].expires_in], [1, audio.id, 300]);
});

/* ------------------------------------------------------------------ purge */

test('purge: exactly the due paths are deleted, each is reported, and a purged row is left alone', async () => {
  const w = world();
  const discarded = await uploaded(w, WEBM);
  const rejectedRow = await uploaded(w, HTML);
  const retained = await sealedRow(w, filled(WAV, 44, 0), { mime: 'audio/wav' });
  const purged = await uploaded(w, WEBM, { mime: 'video/webm' });
  const kept = await sealedRow(w, filled(WEBM, 300));
  const elsewhere = await uploaded(w, WEBM, { assignment_id: U(3) });
  const due = { retention_evaluated: true, uploads: [
    dueRow({ ...discarded.row, state: 'discarded' }), dueRow({ ...rejectedRow.row, state: 'rejected' }, { reason: 'rejected' }), dueRow(retained, { reason: 'retention_completed' }),
    dueRow({ ...purged.row, state: 'purged' }, { due: false, reason: null, due_at: null }) ] };
  const before = w.storage.calls.length;
  const out = await purgeDue(w.ctx, due);
  assert.deepEqual(out, { deleted: [discarded.row.id, rejectedRow.row.id, retained.id], failed: [] });
  const made = w.storage.calls.slice(before);
  assert.deepEqual(made.map(routeOf), [`DELETE object/${BUCKET}`], 'one call');
  assert.deepEqual(made[0].json, { prefixes: [discarded.path, rejectedRow.path, pathOf(retained)] });
  assert.deepEqual([made[0].service, made[0].redirect, made[0].signal], [true, 'manual', true]);
  assert.deepEqual(w.storage.paths(), [purged.path, pathOf(kept), elsewhere.path].sort(), 'the purged row, the row that is not due and the other assignment are untouched');
  /* The bare list is the same request; a row named twice is one path; nothing due is no call. */
  assert.deepEqual(await purgeDue(w.ctx, [dueRow({ ...elsewhere.row, state: 'discarded' }), dueRow({ ...elsewhere.row, state: 'discarded' })]), { deleted: [elsewhere.row.id], failed: [] });
  assert.deepEqual(w.storage.calls.at(-1).json, { prefixes: [elsewhere.path] });
  const calls = w.storage.calls.length;
  assert.deepEqual(await purgeDue(w.ctx, { retention_evaluated: false, uploads: [] }), { deleted: [], failed: [] });
  assert.deepEqual(await purgeDue(w.ctx, [dueRow({ ...purged.row, state: 'purged' }, { due: false })]), { deleted: [], failed: [] });
  assert.equal(w.storage.calls.length, calls);
});

test('purge: one row that is neither due nor purged stops the whole batch, and a deletion storage did not answer is reported failed', async () => {
  const w = world();
  const a = await uploaded(w, WEBM);
  const b = await uploaded(w, HTML);
  const live = await sealedRow(w, filled(WEBM, 300));
  const batch = [dueRow({ ...a.row, state: 'discarded' }), dueRow(live, { due: false, reason: null, due_at: null }), dueRow({ ...b.row, state: 'rejected' }, { reason: 'rejected' })];
  const calls = w.storage.calls.length;
  assert.deepEqual(await purgeDue(w.ctx, batch), { deleted: [], failed: [a.row.id, b.row.id] }, 'nothing deleted; the caller cannot record a purge');
  assert.equal(w.storage.calls.length, calls);
  assert.equal(w.storage.paths().length, 3);
  const dueOnly = [batch[0], batch[2]];
  const failures = [() => new Response('tok_upstream', { status: 500 }), () => new Response(null, { status: 307, headers: { location: 'https://elsewhere.invalid/' } }), () => Response.json({ ok: true }), () => new Response('not json'), () => { throw new TypeError('fetch failed'); },
    () => Response.json([], { status: 500 }), () => Response.json([], { status: 403 })];
  for (const answer of failures) {
    const off = w.storage.intercept((c) => (c.method === 'DELETE' ? answer() : undefined));
    assert.deepEqual(await purgeDue(w.ctx, dueOnly), { deleted: [], failed: [a.row.id, b.row.id] });
    off();
  }
  assert.deepEqual(await purgeDue({ ...w.ctx, env: {} }, dueOnly), { deleted: [], failed: [a.row.id, b.row.id] });
  assert.equal(w.storage.paths().length, 3, 'still there');
  assert.deepEqual(await purgeDue(w.ctx, dueOnly), { deleted: [a.row.id, b.row.id], failed: [] });
  assert.deepEqual(w.storage.paths(), [pathOf(live)]);
  /* Something that is not a due list is not guessed at. */
  for (const [label, value] of [['nothing', null], ['text', 'all'], ['an object without uploads', { retention_evaluated: true }], ['a row that is not an object', [null]],
    ['a row with an id that is a path', [dueRow({ ...a.row, id: '../x' })]], ['a row with an extension that is not allowed', [dueRow({ ...a.row, ext: 'exe' })]],
    ['a row without a due flag', [dueRow(a.row, { due: 'yes' })]], ['a row in a state nobody defined', [dueRow({ ...a.row, state: 'gone' })]]]) {
    await assert.rejects(purgeDue(w.ctx, value), refused(503, 'storage_unavailable'), label);
  }
  assert.deepEqual(w.storage.paths(), [pathOf(live)]);
});

test('purge: more rows than one batch are deleted in batches of purge_batch, and a failed batch does not hide the others', async () => {
  const w = world();
  const rows = [];
  for (let i = 0; i < C.LIMITS.list.purge_batch * 2 + 5; i += 1) {
    const row = w.league.staged();
    w.storage.store(pathOf(row), WEBM, { contentType: 'audio/webm' });
    rows.push(dueRow({ ...row, state: 'discarded' }));
  }
  let n = 0;
  w.storage.intercept((call) => { if (call.method !== 'DELETE') return undefined; n += 1; return n === 2 ? new Response('no', { status: 500 }) : undefined; });
  const out = await purgeDue(w.ctx, rows);
  const size = C.LIMITS.list.purge_batch;
  assert.deepEqual(w.storage.calls.filter((c) => c.method === 'DELETE').map((c) => c.json.prefixes.length), [size, size, 5]);
  assert.deepEqual(out.deleted, [...rows.slice(0, size), ...rows.slice(size * 2)].map((r) => r.id));
  assert.deepEqual(out.failed, rows.slice(size, size * 2).map((r) => r.id));
  assert.deepEqual(w.storage.paths(), rows.slice(size, size * 2).map(pathOf).sort());
});

/* The order of POST media/purge (MEDIA.order.purge), with the two SQL calls modelled. */
async function purgeRoute(w, due, purgedCalls) {
  if (due.uploads.some((u) => !u.due && u.state !== 'purged')) throw fail(409, 'Not due', 'revision_conflict');
  const { failed } = await purgeDue(w.ctx, due);
  if (failed.length) throw fail(503, SENTENCES.storage_unavailable, 'storage_unavailable');
  purgedCalls.push(due.uploads.map((u) => u.id));
  return { ok: true };
}

test('purge order: purged is recorded only after storage deleted every due object, and with exactly the uploads asked for', async () => {
  const w = world();
  const a = await uploaded(w, WEBM);
  const b = await uploaded(w, HTML);
  const due = { retention_evaluated: true, uploads: [dueRow({ ...a.row, state: 'discarded' }), dueRow({ ...b.row, state: 'purged' }, { due: false, reason: null, due_at: null })] };
  const recorded = [];
  const off = w.storage.intercept((c) => (c.method === 'DELETE' ? new Response('no', { status: 500 }) : undefined));
  await assert.rejects(purgeRoute(w, due, recorded), refused(503, 'storage_unavailable'));
  assert.deepEqual(recorded, [], 'storage failed: nothing recorded');
  assert.ok(w.storage.object(a.path));
  off();
  const live = await sealedRow(w, filled(WEBM, 300));
  await assert.rejects(purgeRoute(w, { ...due, uploads: [...due.uploads, dueRow(live, { due: false, reason: null, due_at: null })] }, recorded), (error) => error.status === 409);
  assert.ok(w.storage.object(a.path), 'refused before deleting anything');
  await purgeRoute(w, due, recorded);
  assert.deepEqual(recorded, [[a.row.id, b.row.id]]);
  assert.equal(w.storage.object(a.path), null);
});

/* ------------------------------------------------------------------ transport */

const isList = (call) => call.route.startsWith('object/list/');
const isSign = (call) => call.method === 'POST' && call.route.startsWith('object/sign/');
/* Every place a refusal from storage is an error for the caller: how to get there, and which call it is. */
const SITES = [
  { name: 'begin: sign the upload', deadline: 'control_timeout_ms', arrange: async (w) => { const row = w.league.staged(); return () => beginUpload(w.ctx, row); }, is: (call) => call.method === 'POST' && call.route.startsWith('object/upload/sign/') },
  { name: 'complete: list', deadline: 'control_timeout_ms', arrange: async (w) => { const { row } = await uploaded(w, WEBM); return () => completeUpload(w.ctx, row, PARTICIPANT); }, is: isList },
  { name: 'complete: read', deadline: 'read_timeout_ms', arrange: async (w) => { const { row } = await uploaded(w, WEBM); return () => completeUpload(w.ctx, row, PARTICIPANT); }, is: (call) => call.method === 'GET' },
  { name: 'own read: list', deadline: 'control_timeout_ms', arrange: async (w) => { const row = await sealedRow(w); return () => signOwnRead(w.ctx, row); }, is: isList },
  { name: 'own read: sign', deadline: 'control_timeout_ms', arrange: async (w) => { const row = await sealedRow(w); return () => signOwnRead(w.ctx, row); }, is: isSign },
  { name: 'review read: list', deadline: 'control_timeout_ms', arrange: async (w) => { const row = await sealedRow(w); return () => signReviewRead(w.ctx, proofOf(w, [row])); }, is: isList },
  { name: 'review read: sign', deadline: 'control_timeout_ms', arrange: async (w) => { const row = await sealedRow(w); return () => signReviewRead(w.ctx, proofOf(w, [row])); }, is: isSign }
];

test('a redirect from storage is never followed: 503, and the redirected call is the last one made', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    for (const site of SITES) {
      const w = world();
      const run = await site.arrange(w);
      let hits = 0;
      w.storage.intercept((call) => { if (!site.is(call)) return undefined; hits += 1; return new Response('moved, token=tok_upstream', { status, headers: { location: 'https://elsewhere.invalid/x?token=tok_upstream' } }); });
      await assert.rejects(run(), (error) => refused(503, 'storage_unavailable')(error) && !/elsewhere|upstream|token/.test(inspect(error, { depth: 9 })), `${site.name} ${status}`);
      assert.equal(hits, 1, `${site.name} ${status}: not retried`);
      assert.ok(site.is(w.storage.calls.at(-1)), `${site.name} ${status}: nothing after the redirect`);
    }
  }
  /* The form a browser-like fetch gives a manual redirect. */
  const w = world();
  const row = w.league.staged();
  await assert.rejects(beginUpload({ ...w.ctx, fetchImpl: async () => ({ type: 'opaqueredirect', status: 0, ok: false, headers: new Headers(), body: null }) }, row), refused(503, 'storage_unavailable'));
  await assert.rejects(beginUpload({ ...w.ctx, fetchImpl: async () => undefined }, row), refused(503, 'storage_unavailable'));
});

test('a storage call that fails to connect is 503 with nothing of the failure in it', async () => {
  for (const site of SITES) {
    const w = world();
    const run = await site.arrange(w);
    w.storage.intercept((call) => { if (site.is(call)) throw new TypeError(`fetch failed: ${call.url}?token=tok_upstream Bearer ${SERVICE_KEY}`); return undefined; });
    await assert.rejects(run(), (error) => refused(503, 'storage_unavailable')(error) && !inspect(error, { depth: 9 }).includes(SERVICE_KEY) && !/upstream|token|fixture\.invalid/.test(inspect(error, { depth: 9 })), site.name);
  }
  /* Without an injected fetch the module uses the global one, which this test run blocks: still 503, still silent. */
  const w = world();
  const { fetchImpl: _fetchImpl, ...noFetch } = w.ctx;
  await assert.rejects(beginUpload(noFetch, w.league.staged()), refused(503, 'storage_unavailable'));
});

test('a storage call that never answers ends at its deadline: 503, and the call was told to stop', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const site of SITES) {
    const w = world();
    const run = await site.arrange(w);
    const reached = deferred();
    let signal = null;
    w.storage.intercept((call, init) => { if (!site.is(call)) return undefined; signal = init.signal; reached.resolve(); return 'hang'; });
    let settled = false;
    const pending = run();
    pending.then(() => { settled = true; }, () => { settled = true; });
    await reached.promise;
    t.mock.timers.tick(STORAGE_LIMITS[site.deadline] - 1);
    await flush();
    assert.deepEqual([settled, signal.aborted], [false, false], `${site.name}: still waiting one millisecond before the deadline`);
    t.mock.timers.tick(1);
    await assert.rejects(pending, refused(503, 'storage_unavailable'), site.name);
    assert.equal(signal.aborted, true, `${site.name}: told to stop`);
  }
  assert.deepEqual([STORAGE_LIMITS.control_timeout_ms, STORAGE_LIMITS.read_timeout_ms], [12000, 60000]);
});

test('the deadline also ends a body that stalls and a fetch that ignores the signal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  { /* headers arrive, eight bytes arrive, then nothing */
    const w = world();
    const { row, path } = await uploaded(w, WEBM);
    const reached = deferred();
    const seen = { cancelled: false };
    let sent = false;
    w.storage.intercept((call) => (call.method !== 'GET' ? undefined : new Response(new ReadableStream({
      pull(controller) { if (!sent) { sent = true; controller.enqueue(WEBM.subarray(0, 8)); return undefined; } reached.resolve(); return new Promise(() => {}); },
      cancel() { seen.cancelled = true; }
    }, { highWaterMark: 0 }))));
    const pending = completeUpload(w.ctx, row, PARTICIPANT);
    await reached.promise;
    t.mock.timers.tick(STORAGE_LIMITS.read_timeout_ms);
    await assert.rejects(pending, refused(503, 'storage_unavailable'));
    assert.equal(seen.cancelled, true, 'the stalled body was released');
    assert.equal(w.league.sealCalls.length, 0);
    assert.ok(w.storage.object(path), 'nothing was deleted');
  }
  { /* a fetch that neither answers nor listens */
    const w = world();
    const row = w.league.staged();
    const reached = deferred();
    const pending = beginUpload({ ...w.ctx, fetchImpl() { reached.resolve(); return new Promise(() => {}); } }, row);
    await reached.promise;
    t.mock.timers.tick(STORAGE_LIMITS.control_timeout_ms);
    await assert.rejects(pending, refused(503, 'storage_unavailable'));
  }
  { /* an answer that arrives after the deadline is released, not left open */
    const w = world();
    const row = w.league.staged();
    const reached = deferred();
    const late = deferred();
    const seen = { cancelled: false };
    const pending = beginUpload({ ...w.ctx, fetchImpl() { reached.resolve(); return late.promise; } }, row);
    await reached.promise;
    t.mock.timers.tick(STORAGE_LIMITS.control_timeout_ms);
    await assert.rejects(pending, refused(503, 'storage_unavailable'));
    late.resolve(new Response(new ReadableStream({ cancel() { seen.cancelled = true; } })));
    await flush();
    assert.equal(seen.cancelled, true);
  }
  { /* a control answer whose body stalls */
    const w = world();
    const row = await sealedRow(w);
    const reached = deferred();
    w.storage.intercept((call) => (isList(call) ? new Response(new ReadableStream({ pull() { reached.resolve(); return new Promise(() => {}); } }, { highWaterMark: 0 })) : undefined));
    const pending = signOwnRead(w.ctx, row);
    await reached.promise;
    t.mock.timers.tick(STORAGE_LIMITS.control_timeout_ms);
    await assert.rejects(pending, refused(503, 'storage_unavailable'));
  }
});

test('every deadline is cancelled when its call ends, and every call is made the way the Worker runtime requires', async (t) => {
  const started = [];
  const cancelled = [];
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', (fn, ms, ...rest) => { const id = realSet(fn, ms, ...rest); started.push([id, ms]); return id; });
  t.mock.method(globalThis, 'clearTimeout', (id) => { cancelled.push(id); return realClear(id); });
  const w = world();
  const { row } = await uploaded(w, WEBM);
  const sealed = await completeUpload(w.ctx, row, PARTICIPANT);
  await signOwnRead(w.ctx, sealed);
  await signReviewRead(w.ctx, proofOf(w, [sealed]));
  const other = await uploaded(w, HTML);
  await completeUpload(w.ctx, other.row, PARTICIPANT);
  await assert.rejects(completeUpload(w.ctx, w.league.staged(), PARTICIPANT), refused(409, 'upload_missing'));
  await discardUpload(w.ctx, { ...w.league.staged(), state: 'discarded' });
  await purgeDue(w.ctx, [dueRow({ ...sealed, state: 'sealed' }, { reason: 'retention_completed' })]);
  t.mock.restoreAll();
  const service = w.storage.calls.filter((call) => call.service);
  assert.equal(service.length, 14, 'begin 2, list 5, read 2, sign 2, delete 3');
  assert.equal(started.length, service.length, 'one deadline per storage call');
  assert.deepEqual(cancelled, started.map(([id]) => id), 'each cancelled, in order, when its call ended');
  assert.deepEqual([...new Set(started.map(([, ms]) => ms))].sort((a, b) => a - b), [STORAGE_LIMITS.control_timeout_ms, STORAGE_LIMITS.read_timeout_ms]);
  assert.equal(started.filter(([, ms]) => ms === STORAGE_LIMITS.read_timeout_ms).length, service.filter((call) => call.method === 'GET').length, 'the long deadline belongs to the object read only');
  for (const call of service) {
    assert.deepEqual([call.redirect, call.signal, call.headers.apikey, call.headers.authorization], ['manual', true, SERVICE_KEY, `Bearer ${SERVICE_KEY}`], routeOf(call));
    assert.ok(!call.url.includes('?'), `${routeOf(call)}: the Worker never calls a signed URL itself`);
  }
  /* asWorkerFetch refuses what the runtime refuses, so the calls above were made bare and with an init it accepts. */
  const strict = asWorkerFetch(async () => new Response('{}'));
  assert.throws(() => ({ fetch: strict }).fetch('https://fixture.invalid/'), /Illegal invocation/);
  assert.throws(() => strict('https://fixture.invalid/', { redirect: 'error' }), /Invalid redirect value/);
});

/* ------------------------------------------------------------------ nothing leaks */

test('no URL, token, bearer or key leaves the module except in the grant and the signed reads it returns', async () => {
  const w = world();
  const errors = [];
  const quiet = [];
  const handed = [];
  const attempt = async (promise) => { try { return await promise; } catch (error) { errors.push(error); return undefined; } };
  const upstream = (status = 500) => new Response(`upstream said: token=tok_upstream /object/sign/secret /object/upload/sign/secret Authorization: Bearer ${SERVICE_KEY}`, { status, headers: { location: 'https://elsewhere.invalid/object/sign/x?token=tok_upstream' } });
  const failing = async (is, run) => { for (const status of [302, 400, 500]) { const off = w.storage.intercept((call) => (is(call) ? upstream(status) : undefined)); await attempt(run()); off(); } };

  const { row, grant } = await uploaded(w, filled(WEBM, 300));
  handed.push(grant.url);
  await failing((call) => call.route.startsWith('object/upload/sign/'), () => beginUpload(w.ctx, w.league.staged()));
  await attempt(beginUpload(w.ctx, { ...row, state: 'sealed' }));
  await attempt(completeUpload(w.ctx, w.league.staged(), PARTICIPANT));
  await attempt(completeUpload(w.ctx, row, OTHER));
  await failing(isList, () => completeUpload(w.ctx, row, PARTICIPANT));
  await failing((call) => call.method === 'GET', () => completeUpload(w.ctx, row, PARTICIPANT));
  const sealed = await completeUpload(w.ctx, row, PARTICIPANT);
  quiet.push(sealed, await completeUpload(w.ctx, sealed, PARTICIPANT));
  const bad = await uploaded(w, HTML);
  handed.push(bad.grant.url);
  quiet.push(await completeUpload(w.ctx, bad.row, PARTICIPANT));
  const own = await signOwnRead(w.ctx, sealed);
  handed.push(own.url);
  await failing(isSign, () => signOwnRead(w.ctx, sealed));
  await failing(isList, () => signOwnRead(w.ctx, sealed));
  const review = await signReviewRead(w.ctx, proofOf(w, [sealed]));
  handed.push(review[0].url);
  await failing(isSign, () => signReviewRead(w.ctx, proofOf(w, [sealed])));
  await attempt(signReviewRead(w.ctx, proofOf(w, [sealed], { moderation_state: 'held' })));
  await attempt(signReviewRead(w.ctx, proofOf(w, [{ ...sealed, tenant: U(77) }])));
  const gone = await uploaded(w, WEBM);
  handed.push(gone.grant.url);
  for (const status of [302, 500]) { const off = w.storage.intercept((call) => (call.method === 'DELETE' ? upstream(status) : undefined)); quiet.push(await discardUpload(w.ctx, { ...gone.row, state: 'discarded' }), await purgeDue(w.ctx, [dueRow({ ...gone.row, state: 'discarded' })])); off(); }
  quiet.push(await discardUpload(w.ctx, { ...gone.row, state: 'discarded' }), await purgeDue(w.ctx, [dueRow(sealed, { reason: 'retention_completed' })]));
  w.storage.store(pathOf(sealed), filled(WEBM, 300, 0x62), { contentType: 'audio/webm' });
  await attempt(signOwnRead(w.ctx, sealed));

  assert.deepEqual([...new Set(errors.map((error) => error.reason))].sort(), ['media_changed', 'moderation_hold', 'not_available', 'storage_unavailable', 'upload_expired', 'upload_missing']);
  assert.ok(errors.length >= 20, `${errors.length} refusals`);
  const needles = ['token=', '/object/sign/', '/upload/sign/', SERVICE_KEY, 'tok_', 'elsewhere', 'fixture.invalid', ...w.storage.tokens()];
  const show = (value) => `${inspect(value, { depth: 12, showHidden: true })}\n${JSON.stringify(value)}\n${value instanceof Error ? `${value.message}\n${value.stack}\n${inspect(value.cause)}` : ''}`;
  const clean = (value, label) => { const text = show(value); for (const needle of needles) assert.ok(!text.includes(needle), `${label} carries ${needle.slice(0, 16)}`); assert.doesNotMatch(text, /bearer/i, label); };
  for (const error of errors) {
    assert.equal(error.message, SENTENCES[error.reason]);
    assert.deepEqual(Object.keys(error).sort(), ['reason', 'status'], 'an error is a status and a reason');
    clean(error, `the ${error.reason} error`);
  }
  for (const value of quiet) clean(value, 'a quiet answer');
  /* What reaches the SQL: ids, the measurement and the storage identity. Nothing else. */
  assert.ok(w.league.sealCalls.length >= 2);
  for (const args of w.league.sealCalls) clean(args, 'the seal arguments');
  /* What was handed out is a signed location on the storage host, and the Worker never called one itself. */
  assert.equal(handed.length, 5);
  for (const url of handed) assert.match(url, /^https:\/\/fixture\.invalid\/storage\/v1\/object\/(upload\/)?sign\/equity-uprise-private\/league\/v1\/t\/[0-9a-f-]{36}\/a\/[0-9a-f-]{36}\/u\/[0-9a-f-]{36}\.[a-z0-9]{3,4}\?token=[A-Za-z0-9_-]+$/);
  assert.ok(w.storage.calls.filter((call) => call.service).every((call) => !call.url.includes('token=')));
});

test('nothing was written to the console by any path above', () => {
  /* The one line that is not the module's: the test runner's own notice about the timers two tests above replace. */
  const runnerNotice = ([level, first]) => level === 'error' && typeof first === 'string' && /^\(node:\d+\) ExperimentalWarning: The MockTimers API /.test(first);
  assert.deepEqual(logged.filter((entry) => !runnerNotice(entry)), []);
});
