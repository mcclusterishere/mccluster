// The mnet-media upload flow against the REAL Supabase Storage API, with the
// production Storage policies and then with the three the pointer guard drops.
// Run by scripts/test-network-media-storage-flow.sh (which starts the Storage
// API container on a scratch database and applies the guard between phases);
// not part of `npm test`, because it needs Docker.
//
//   node scripts/test/network-media-storage-flow.integration.mjs production|guarded
//
// production: the policies of 20260920071811 are in place. The flow works, and
//   so does everything the guard is for: with their own token a member
//   overwrites, moves and deletes the object a row names, and after a delete
//   replays the upload token to put other bytes at the same path.
// guarded: supabase/pending/network_media_assets_pointer_guard_v1.sql is
//   applied. The flow still works end to end, the way the media function
//   (service role) and the browser (signed upload URL) run it, and every one of
//   those member writes is refused; the bytes are what was first uploaded.
//
// Environment: STORAGE_URL, STORAGE_JWT_SECRET, PGDATABASE and the PG* of the
// scratch server. Nothing here reaches a real project.
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const phase = process.argv[2];
assert.ok(['production', 'guarded'].includes(phase), 'usage: network-media-storage-flow.integration.mjs production|guarded');
const BASE = process.env.STORAGE_URL, SECRET = process.env.STORAGE_JWT_SECRET;
assert.ok(BASE && SECRET && process.env.PGDATABASE, 'STORAGE_URL, STORAGE_JWT_SECRET and PGDATABASE are required');

// the seed's people (supabase/tests/network_media_assets_pointer_guard.seed.sql)
const A = { user: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', m: 'a0000000-0000-4000-8000-00000000000a' };
const B = { user: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', m: 'b0000000-0000-4000-8000-00000000000b' };

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'scratch', iat: now, exp: now + 3600, ...claims })}`;
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
}
const SERVICE = jwt({ role: 'service_role' });
const member = (p) => jwt({ role: 'authenticated', aud: 'authenticated', sub: p.user });

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
async function call(method, path, { token, headers = {}, body } = {}) {
  const res = await fetch(BASE + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* bytes */ }
  // the Storage API answers 400 with the real status in the body
  return { status: json && json.statusCode ? Number(json.statusCode) : res.status, json, buf };
}
const J = { 'content-type': 'application/json' };
// As the service role would through PostgREST: the role and its claim, one statement.
function asService(statement) {
  return execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-c',
    `begin; set local role service_role; set local request.jwt.claims = '{"role":"service_role"}'; ${statement}; commit;`], { encoding: 'utf8' }).trim();
}

// ---- the flow, step for step as supabase/functions/mnet-media/index.ts and the browser run it
async function uploadUrl(person, name) {
  const path = `${person.user}/${randomUUID()}-${name}`;
  const grant = await call('POST', `/object/upload/sign/mnet-media/${enc(path)}`, { token: SERVICE });
  assert.equal(grant.status, 200, `createSignedUploadUrl: ${JSON.stringify(grant.json)}`);
  assert.ok(grant.json.token, 'the grant carries an upload token');
  const id = asService(`insert into public.network_media_assets (owner_m_uid, bucket_id, object_path, media_type, mime_type, byte_size, alt_text, status)
    values ('${person.m}', 'mnet-media', '${path}', 'image', 'image/png', 81, '', 'staged') returning id`);
  return { id, path, token: grant.json.token };
}
// js/mnet.js, js/create.js, js/fbi.js, native/src/proofMedia.ts: PUT to the signed URL with the member's token
const put = (slot, token, bytes) => call('PUT', `/object/upload/sign/mnet-media/${enc(slot.path)}?token=${encodeURIComponent(slot.token)}`,
  { token, headers: { 'content-type': 'image/png', 'x-upsert': 'false' }, body: bytes });
async function finalize(slot) {
  const [folder, name] = slot.path.split('/');
  const list = await call('POST', '/object/list/mnet-media', { token: SERVICE, headers: J, body: JSON.stringify({ prefix: folder, search: name, limit: 10 }) });
  assert.equal(list.status, 200);
  assert.ok((list.json || []).some((x) => x.name === name), 'finalize finds the upload');
  assert.equal(asService(`update public.network_media_assets set status = 'ready', updated_at = now(), width = 9, height = 9 where id = '${slot.id}' returning status`), 'ready');
}
async function view(slot) {
  const signed = await call('POST', `/object/sign/mnet-media/${enc(slot.path)}`, { token: SERVICE, headers: J, body: JSON.stringify({ expiresIn: 900 }) });
  if (signed.status !== 200) return null;
  const got = await call('GET', signed.json.signedURL);
  return got.status === 200 ? sha(got.buf) : null;
}
async function discard(slot) {
  const removed = await call('DELETE', '/object/mnet-media', { token: SERVICE, headers: J, body: JSON.stringify({ prefixes: [slot.path] }) });
  assert.equal(removed.status, 200, `discard's remove: ${JSON.stringify(removed.json)}`);
  assert.equal(asService(`delete from public.network_media_assets where id = '${slot.id}' and owner_m_uid = '${A.m}' and post_id is null returning 1`), '1');
  assert.equal(await view(slot), null, 'the object is gone');
}
// A resumable (TUS) upload, the Storage API's other write path: create, then send the bytes.
async function resumable(slot, token, bytes) {
  const meta = Object.entries({ bucketName: 'mnet-media', objectName: slot.path, contentType: 'image/png' })
    .map(([k, v]) => `${k} ${Buffer.from(v).toString('base64')}`).join(',');
  const made = await fetch(`${BASE}/upload/resumable`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'tus-resumable': '1.0.0',
    'upload-length': String(bytes.length), 'upload-metadata': meta, 'x-upsert': 'true' } });
  if (made.status !== 201) return { status: made.status === 400 ? 403 : made.status, json: await made.json().catch(() => null) };
  // the API answers with its public address; keep the path, send it to the scratch server
  const location = new URL(made.headers.get('location'), BASE);
  const sent = await fetch(BASE + location.pathname + location.search, { method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'tus-resumable': '1.0.0',
    'upload-offset': '0', 'content-type': 'application/offset+octet-stream', 'x-upsert': 'true' }, body: bytes });
  return { status: sent.status === 204 ? 200 : sent.status, json: await sent.json().catch(() => null) };
}
// ---- what a member can try on the object with their own token
const memberWrites = (slot, token, other) => ({
  'resumable (TUS) upload over the object with x-upsert': () => resumable(slot, token, other),
  'POST a new object under their prefix': () => call('POST', `/object/mnet-media/${enc(`${A.user}/${randomUUID()}-direct.png`)}`, { token, headers: { 'content-type': 'image/png' }, body: other }),
  'POST over the object with x-upsert': () => call('POST', `/object/mnet-media/${enc(slot.path)}`, { token, headers: { 'content-type': 'image/png', 'x-upsert': 'true' }, body: other }),
  'PUT over the object': () => call('PUT', `/object/mnet-media/${enc(slot.path)}`, { token, headers: { 'content-type': 'image/png' }, body: other }),
  'copy another object over it': () => call('POST', '/object/copy', { token, headers: { ...J, 'x-upsert': 'true' }, body: JSON.stringify({ bucketId: 'mnet-media', sourceKey: slot.spare, destinationKey: slot.path }) }),
  'move it away': () => call('POST', '/object/move', { token, headers: J, body: JSON.stringify({ bucketId: 'mnet-media', sourceKey: slot.path, destinationKey: `${slot.path}.moved` }) }),
  'DELETE it': () => call('DELETE', `/object/mnet-media/${enc(slot.path)}`, { token }),
});

const ORIGINAL = Buffer.from(`the reviewed bytes ${randomUUID()}`.padEnd(81, '.'));
const OTHER = Buffer.from(`different bytes ${randomUUID()}`.padEnd(81, '!'));
const policies = execFileSync('psql', ['-X', '-q', '-At', '-c',
  `select string_agg(policyname, ', ' order by policyname) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'mnet media %'`], { encoding: 'utf8' }).trim();
console.log(`   Storage policies on the bucket: ${policies}`);

// 1. The upload flow, both ways a browser can send it.
const slot = await uploadUrl(A, 'photo.png');
assert.equal((await put(slot, member(A), ORIGINAL)).status, 200, 'PUT to the signed upload URL with the member\'s token');
const noHeader = await uploadUrl(A, 'no-header.png');
assert.equal((await put(noHeader, undefined, ORIGINAL)).status, 200, 'PUT to the signed upload URL with no Authorization header');
await finalize(slot);
assert.equal(await view(slot), sha(ORIGINAL), 'view-url serves what was uploaded');
await finalize(noHeader);
// a second, ordinary upload to copy from
const spare = await uploadUrl(A, 'spare.png');
assert.equal((await put(spare, member(A), OTHER)).status, 200);
slot.spare = spare.path;
console.log('   upload-url -> PUT (token + member JWT, and token alone) -> finalize -> view-url: works');
// the same token is not an upsert: a second PUT over the object is refused
assert.equal((await put(slot, member(A), OTHER)).status, 409, 'the upload token cannot overwrite');
// a member reads their own object with their own token; another member cannot
assert.equal((await call('POST', `/object/sign/mnet-media/${enc(slot.path)}`, { token: member(A), headers: J, body: JSON.stringify({ expiresIn: 60 }) })).status, 200, 'own read stays');
assert.notEqual((await call('POST', `/object/sign/mnet-media/${enc(slot.path)}`, { token: member(B), headers: J, body: JSON.stringify({ expiresIn: 60 }) })).status, 200, 'another member cannot read it');
for (const [what, attempt] of Object.entries(memberWrites(slot, member(B), OTHER))) {
  if (what.startsWith('POST a new object')) continue; // B's own prefix is B's business
  assert.notEqual((await attempt()).status, 200, `another member: ${what}`);
}
assert.equal(await view(slot), sha(ORIGINAL), 'another member changed nothing');

if (phase === 'production') {
  // 2. THE FINDING (c): with their own token the member changes the bytes under an unchanged row.
  const writes = memberWrites(slot, member(A), OTHER);
  for (const what of ['POST a new object under their prefix', 'POST over the object with x-upsert']) assert.equal((await writes[what]()).status, 200, what);
  assert.equal(await view(slot), sha(OTHER), 'the object now holds other bytes; the row did not change');
  assert.equal((await call('PUT', `/object/mnet-media/${enc(slot.path)}`, { token: member(A), headers: { 'content-type': 'image/png' }, body: ORIGINAL })).status, 200, 'PUT over the object');
  assert.equal(await view(slot), sha(ORIGINAL));
  const tus = await writes['resumable (TUS) upload over the object with x-upsert']();
  assert.equal(tus.status, 200, `resumable upload over the object: ${JSON.stringify(tus.json)}`);
  assert.equal(await view(slot), sha(OTHER), 'other bytes again, through the resumable endpoint');
  // delete, then replay the upload token: no insert or update policy is involved
  assert.equal((await writes['DELETE it']()).status, 200, 'DELETE it');
  assert.equal((await put(slot, member(A), OTHER)).status, 200, 'the upload token works again once the object is gone');
  assert.equal(await view(slot), sha(OTHER), 'other bytes at the same path, through the token');
  assert.equal((await writes['move it away']()).status, 200, 'move it away');
  assert.equal(await view(slot), null, 'the row now names nothing');
  console.log('   with their own token the member overwrote the object (POST upsert, PUT, resumable upload), deleted it and replayed the upload token, and moved it away');
} else {
  // 2. THE GUARD: every one of those is refused, and the bytes are the first upload.
  for (const [what, attempt] of Object.entries(memberWrites(slot, member(A), OTHER))) {
    const r = await attempt();
    assert.ok([400, 403, 404].includes(r.status), `${what} must be refused, got ${r.status} ${JSON.stringify(r.json)}`);
  }
  assert.equal((await put(slot, member(A), OTHER)).status, 409, 'the upload token cannot be replayed: the object is still there');
  assert.equal(await view(slot), sha(ORIGINAL), 'the bytes are the first upload');
  console.log('   the member\'s own POST, upsert, PUT, resumable upload, copy, move and DELETE are refused; the token cannot be replayed; the bytes are the first upload');
  // 3. ...and the function still cleans up with the service role.
  await discard(slot);
  await discard(noHeader);
  await discard(spare);
  console.log('   discard (service role): the object and the row are removed');
}
