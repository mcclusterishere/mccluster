// E=Up League member routes (/v1/eup/member/league), through the real router, against a stubbed plane
// (./support/eup-league-rpc-double.mjs: the League RPCs answered per test, storage by the media lane's double).
//
// PROVEN HERE (the Worker's half): the one member branch checks the bearer with the session check and never asks for a
// house owner; the actor is the session user whatever the request says; account-naming fields are refused before any
// call; what the contract requires before any RPC; one member command per route (and the seal only for complete);
// the member error table (not_available for no-row, not-yours, not-released and no-schema alike); module refusals
// through MODULE_POLICY_ERRORS; answers private, no-store, varying on Origin and Authorization; nothing cached;
// answers cut to their contract shapes with no account-naming field; the upload routes in MEDIA.order.
// NOT PROVEN HERE: the SQL decisions themselves (scripts/test/eup-league.integration.mjs), the routes against the real
// SQL (the journey lane), real storage, the Worker runtime (Node runs this; asWorkerFetch applies its fetch rules).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { handleEup } from '../src/eup/router.js';
import * as C from '../src/eup/league-contract.js';
import { MODULE_POLICY_ERRORS } from '../src/eup/modules.js';
import { memberSafe } from '../src/eup/league-member.js';
import { leaguePlane, identities, sqlError, sampleShape, uploadRow, pathOf, sealedRow, U, OWNER, MEMBER, OTHER, TENANT, SHA, T0, AT, env, ORIGIN, MEMBER_TOKEN, OTHER_TOKEN, NAMES } from './support/eup-league-rpc-double.mjs';

/* Everything written to the console while this file runs; the last test checks it stayed empty. */
const logged = [];
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) console[level] = (...args) => { logged.push([level, ...args]); };

const KEY = 'fixture-key-0001';
const WEBM = C.bytesFromHex(C.MAGIC_VECTORS.find((v) => v.name === 'webm').hex); // 16 bytes
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const NOT_AVAILABLE = { ok: false, error: 'Not available', reason: 'not_available' };
const keysOf = (shape) => Object.keys(C.shapeFields(shape)).sort();

async function member(plane, rest = '', { method = 'GET', body, raw, headers = {}, token = MEMBER_TOKEN, ids = identities(), rpcTimeoutMs, authUser } = {}) {
  const path = `${C.PREFIX.member}${rest ? `/${rest}` : ''}`;
  const init = { method, headers: { origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } };
  if (body !== undefined || raw !== undefined) {
    init.body = raw ?? JSON.stringify(body);
    if (!Object.keys(init.headers).some((h) => h.toLowerCase() === 'content-type')) init.headers['content-type'] = 'application/json';
  }
  const response = await handleEup(new Request(`https://api.mccluster.org${path}`, init), env,
    { requireHouseOwner: ids.requireHouseOwner, authUser: authUser === undefined ? ids.authUser : authUser, fetchImpl: plane.fetchImpl, now: () => T0, rpcTimeoutMs });
  return { response, status: response.status, body: await response.json(), ids };
}
const CONSENT = { purpose: 'publish_proof', audience: 'released_audience', asset_revision: SHA, notice_revision: 'fixture-publication-1', expires_at: '2027-01-01T00:00:00Z' };
const consentBody = (patch = {}) => ({ idempotency_key: KEY, expected_revision: 2, consent: { ...CONSENT, ...patch } });
const sealedFrom = (call) => ({ ...uploadRow({ id: call.body.p_upload }), state: 'sealed', bytes: call.body.p_result.bytes, sha256: call.body.p_result.sha256,
  family: call.body.p_result.family, storage: call.body.p_result.storage, sealed_at: AT });

/* ------------------------------------------------------------------ the branch and the actor */

test('signed out: no bearer is 401 before any session check, RPC or storage call; an unknown session is 401; a failing check is 503', async () => {
  const plane = leaguePlane();
  for (const headers of [{}, { authorization: 'Basic Zml4dHVyZTpmaXh0dXJl' }, { authorization: 'Bearer ' }, { authorization: 'bearer' }]) {
    const ids = identities();
    const r = await member(plane, '', { token: null, headers, ids });
    assert.equal(r.status, 401, JSON.stringify(headers)); assert.equal(r.body.reason, 'authentication_required');
    assert.equal(ids.seen.session, 0, 'no session check without a bearer'); assert.equal(ids.seen.owner, 0);
  }
  const unknown = await member(plane, `missions/${U(7)}/application`, { method: 'POST', token: 'not-a-session', body: { idempotency_key: KEY, expected_revision: 0, application: { submit: false, requirements_revision: 1 } } });
  assert.equal(unknown.status, 401); assert.equal(unknown.ids.seen.session, 1);
  const thrown = await member(plane, '', { authUser: async () => { throw new Error('auth service down'); } });
  assert.deepEqual([thrown.status, thrown.body.reason], [503, 'authorization_unavailable']);
  assert.doesNotMatch(JSON.stringify(thrown.body), /auth service down/);
  const malformed = await member(plane, '', { authUser: async () => ({ id: 'not-a-uuid' }) });
  assert.equal(malformed.status, 401);
  const unwired = await member(plane, '', { authUser: null });
  assert.deepEqual([unwired.status, unwired.body.reason], [503, 'authorization_unavailable']);
  assert.equal(plane.all().length, 0, 'no RPC and no storage call for any of them');
});

test('the member branch never asks for a house owner: an account that is not one reaches the member command as itself', async () => {
  const plane = leaguePlane();
  const ids = identities({ owner: null }); // requireHouseOwner would refuse
  const r = await member(plane, '', { ids });
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(ids.seen.owner, 0); assert.equal(ids.seen.session, 1);
  assert.deepEqual(plane.rpc().map((c) => [c.name, c.body]), [[NAMES.member, { p_action: 'me.get', p_actor: MEMBER, p_id: '', p_document: null, p_revision: null, p_key: null }]]);
  assert.ok(r.body.league);
});

test('actor binding: p_actor is always the verified session user; headers, query and other sessions change nothing', async () => {
  const plane = leaguePlane();
  await member(plane, '', { headers: { 'x-we-user-id': OTHER, 'x-we-role': 'owner', 'x-mccluster-org-id': U(3), 'x-mcc-admin': 'true' } });
  const query = await handleEup(new Request(`https://api.mccluster.org${C.PREFIX.member}?actor=${OTHER}&p_actor=${OTHER}&admin=true`, { headers: { authorization: `Bearer ${MEMBER_TOKEN}` } }), env, { ...identities(), fetchImpl: plane.fetchImpl });
  assert.equal(query.status, 200);
  await member(plane, '', { token: OTHER_TOKEN });
  const MIXED = 'abcdef12-3456-4789-8abc-def012345678';
  const upper = identities({ tokens: { 'fixture-upper-session': MIXED.toUpperCase() } });
  await member(plane, `assignments/${U(7)}/withdraw`, { method: 'POST', token: 'fixture-upper-session', ids: upper, body: { idempotency_key: KEY } });
  assert.deepEqual(plane.rpc().map((c) => c.body.p_actor), [MEMBER, MEMBER, OTHER, MIXED], 'the session user, lower case, and nobody else');
});

test('a body naming an account is refused at any depth with 422 before any call', async () => {
  const plane = leaguePlane();
  const proof = { title: 'Test fixture', lyrics: 'Line one', credits: [{ name: 'Fixture Writer', role: 'lyrics' }], rights: { version: 'music-rights-v1', owns_master: true, controls_composition: true, samples_cleared: true, collaborators_cleared: true, parody_or_derivative: false, derivative_permissions: '' }, accommodation: { statement: 'Test fixture.' }, review_notice_revision: 'fixture-review-1' };
  for (const field of C.REFUSED_MEMBER_FIELDS) {
    for (const [rest, body] of [
      [`missions/${U(7)}/application`, { idempotency_key: KEY, expected_revision: 0, [field]: U(9), application: { submit: false, requirements_revision: 1 } }],
      [`missions/${U(7)}/application`, { idempotency_key: KEY, expected_revision: 0, application: { submit: false, requirements_revision: 1, [field]: U(9) } }],
      [`assignments/${U(7)}/proof`, { idempotency_key: KEY, expected_revision: 0, proof: { ...proof, credits: [{ name: 'x', role: 'y', [field]: U(9) }] } }],
      [`assignments/${U(7)}/draft`, { idempotency_key: KEY, expected_revision: 0, draft: { nested: { deep: { [field]: null } } } }],
      [`uploads/${U(8)}/complete`, { [field]: U(9) }],
      [`consents/${U(7)}/revoke`, { idempotency_key: KEY, [field]: MEMBER }]
    ]) {
      const r = await member(plane, rest, { method: 'POST', body });
      assert.deepEqual([r.status, r.body.reason], [422, 'field_refused'], `${field} in ${rest}`);
      assert.match(r.body.error, /signed-in/);
    }
  }
  assert.equal(plane.all().length, 0);
});

/* ------------------------------------------------------------------ the member error table */

test('not_available: no such row, not your row, not released to you and no schema are one answer with nothing else in it', async () => {
  const routes = [['GET', '', undefined], ['POST', `missions/${U(7)}/application`, { idempotency_key: KEY, expected_revision: 0, application: { submit: false, requirements_revision: 1 } }],
    ['GET', `uploads/${U(8)}/url`, undefined], ['POST', `consents/${U(7)}/revoke`, { idempotency_key: KEY }], ['POST', `uploads/${U(8)}/complete`, {}], ['GET', `receipts/proofs.submit/${KEY}`, undefined]];
  for (const code of ['EU011', '42501', 'P0002', 'PGRST202']) {
    for (const [method, rest, body] of routes) {
      const plane = leaguePlane({ answer: () => sqlError(code, { status: code === 'PGRST202' ? 404 : 400 }) });
      const r = await member(plane, rest, { method, body });
      assert.equal(r.status, 404, `${code} ${method} ${rest}`);
      assert.deepEqual(r.body, NOT_AVAILABLE, `${code} ${method} ${rest}: the same body, no detail`);
      assert.equal(plane.storageCalls().length, 0, `${code} ${rest}: no storage call`);
    }
  }
  /* Paths the member surface does not have, and malformed ids, answer the same before any call. */
  const plane = leaguePlane();
  for (const [method, rest] of [['GET', 'campaigns'], ['POST', 'campaigns'], ['GET', 'policy'], ['POST', `proofs/${U(7)}/review`], ['POST', `applications/${U(7)}/decision`], ['GET', 'nope'],
    ['POST', 'assignments/not-a-uuid/accept'], ['GET', `uploads/${U(8)}x/url`], ['PATCH', `missions/${U(7)}`], ['PUT', `assignments/${U(7)}/draft`], ['GET', `receipts/proofs.submit/short`],
    ['GET', 'publish'], ['POST', 'points'], ['GET', `uploads/${U(8)}%2Furl`]]) {
    const r = await member(plane, rest, { method, body: method === 'GET' ? undefined : { idempotency_key: KEY } });
    assert.equal(r.status, 404, `${method} ${rest}`); assert.deepEqual(r.body, NOT_AVAILABLE, `${method} ${rest}`);
  }
  assert.equal(plane.all().length, 0);
});

test('member SQLSTATE table: readiness, entitlement, requirements, media, consent, hold, limits, conflicts; module state through MODULE_POLICY_ERRORS', async () => {
  const cases = [['EU010', 503, 'policy_unavailable'], ['EU012', 403, 'entitlement_required'], ['EU013', 409, 'requirements_changed'], ['EU014', 409, 'media_binding'],
    ['EU015', 409, 'consent_scope'], ['EU016', 409, 'moderation_hold'], ['EU017', 429, 'rate_limited'], ['40001', 409, 'revision_conflict'], ['40P01', 409, 'retry_conflict'],
    ['23505', 409, 'exists'], ['EU003', 409, 'idempotency_conflict'], ['EU001', 409, 'capacity_exhausted'], ['EU002', 403, 'self_review_denied'], ['22023', 422, 'invalid'],
    ['23514', 422, 'invalid'], ['XX000', 503, 'storage_unavailable'], ['0A000', 503, 'storage_unavailable']];
  for (const code of ['EUM00', 'EUM01', 'EUM02', 'EUM03', 'EUM04', '55P03', '57014']) {
    assert.equal(C.errorFor(code, 'member'), null);
    cases.push([code, ...MODULE_POLICY_ERRORS.guard[code]]);
  }
  for (const [code, status, reason] of cases) {
    const plane = leaguePlane({ answer: () => sqlError(code) });
    const r = await member(plane, `proofs/${U(7)}/consent`, { method: 'POST', body: consentBody() });
    assert.deepEqual([r.status, r.body.reason, r.body.ok], [status, reason, false], code);
    assert.doesNotMatch(JSON.stringify(r.body), /database text/, code);
    assert.equal(plane.rpc().length, 1, `${code}: one call`);
  }
  /* A participant can tell draining and disabled from a refusal of their own: the text says what still works. */
  for (const code of ['EUM02', 'EUM03']) {
    const r = await member(leaguePlane({ answer: () => sqlError(code) }), `assignments/${U(7)}/draft`, { method: 'POST', body: { idempotency_key: KEY, expected_revision: 0, draft: {} } });
    assert.match(r.body.error, /new work is stopped; records, withdrawals and revocations stay open/, code);
  }
  /* EU012 never says that paying, subscribing or holding a pass would admit anyone. */
  const entitlement = await member(leaguePlane({ answer: () => sqlError('EU012') }), `proofs/${U(7)}/consent`, { method: 'POST', body: consentBody() });
  assert.doesNotMatch(entitlement.body.error, /pay|purchase|subscri|upgrade|price|pass\b/i);
});

test('the document check runs before any RPC: a consent wider than the released audience is 422, as is any unknown field', async () => {
  const plane = leaguePlane();
  for (const patch of [{ audience: 'public' }, { audience: 'members' }, { purpose: 'private_review' }, { expires_at: '2027-01-01T00:00:00+01:00' }, { location: 'x' }]) {
    const r = await member(plane, `proofs/${U(7)}/consent`, { method: 'POST', body: consentBody(patch) });
    assert.deepEqual([r.status, r.body.reason], [422, 'invalid'], JSON.stringify(patch));
  }
  for (const [rest, body] of [[`missions/${U(7)}/application`, { idempotency_key: KEY, expected_revision: 0, application: { submit: true, requirements_revision: 1 } }],
    [`assignments/${U(7)}/draft`, { idempotency_key: KEY, expected_revision: 0, draft: { lyrics: 'a\rb' } }],
    [`applications/${U(7)}/appeal`, { idempotency_key: KEY, appeal: { statement: '' } }],
    [`assignments/${U(7)}/accept`, { idempotency_key: KEY, expected_revision: 1, requirements_revision: 1 }]]) {
    const r = await member(plane, rest, { method: 'POST', body });
    assert.deepEqual([r.status, r.body.reason], [422, 'invalid'], rest);
  }
  assert.equal(plane.all().length, 0);
});

/* ------------------------------------------------------------------ answers */

test('every member answer is private, no-store and varies on Origin and Authorization, success and refusal alike', async () => {
  const outcomes = [
    [leaguePlane(), '', {}, 200], [leaguePlane(), '', { token: null }, 401], [leaguePlane({ answer: () => sqlError('EU011') }), '', {}, 404],
    [leaguePlane(), `consents/${U(7)}/revoke`, { method: 'POST', body: { idempotency_key: KEY, actor: OTHER } }, 422],
    [leaguePlane({ answer: () => sqlError('EU010') }), `consents/${U(7)}/revoke`, { method: 'POST', body: { idempotency_key: KEY } }, 503]
  ];
  for (const [plane, rest, options, status] of outcomes) {
    const r = await member(plane, rest, options);
    assert.equal(r.status, status, rest);
    assert.equal(r.response.headers.get('cache-control'), 'private, no-store');
    assert.equal(r.response.headers.get('vary'), 'Origin, Authorization');
    assert.equal(r.response.headers.get('access-control-allow-origin'), ORIGIN);
    assert.match(r.response.headers.get('content-type'), /^application\/json/);
  }
});

test('the audience is never cached: every request asks again, and a revoked grant is seen by the very next one', async () => {
  let open = true;
  const plane = leaguePlane({ answer: () => (open ? undefined : sqlError('EU011')) });
  assert.equal((await member(plane)).status, 200);
  assert.equal((await member(plane)).status, 200);
  open = false;
  const after = await member(plane);
  assert.deepEqual([after.status, after.body], [404, NOT_AVAILABLE]);
  assert.equal(plane.rpc().length, 3, 'three requests, three RPC calls');
});

test('a timeout, a redirect, a malformed answer or one of the wrong kind is 503 with no data', async () => {
  const hang = await member(leaguePlane({ answer: () => new Promise(() => {}) }), '', { rpcTimeoutMs: 40 });
  assert.deepEqual([hang.status, hang.body.reason, hang.body.league], [503, 'storage_unavailable', undefined]);
  for (const [label, answer] of [['redirect', () => new Response(null, { status: 307, headers: { location: 'https://elsewhere.invalid/' } })],
    ['a redirect carrying an error body', () => Response.json({ code: 'EU011', message: 'x' }, { status: 302, headers: { location: 'https://elsewhere.invalid/' } })],
    ['html', () => new Response('<html>', { status: 200 })],
    ['a list for me.get', () => []], ['null', () => Response.json(null)], ['a string', () => Response.json('ok')]]) {
    const r = await member(leaguePlane({ answer }), '');
    assert.deepEqual([r.status, r.body.reason, r.body.league], [503, 'storage_unavailable', undefined], label);
  }
});

test('answers are member-shaped: their contract shape only, and no field naming another account at any depth', async () => {
  const leaky = { ...sampleShape('me'), actor: MEMBER, unlisted_top: 'dropped',
    applications: [{ ...sampleShape('own_application'), applicant: MEMBER, recorded_by: OWNER, decisions: [{ ...sampleShape('member_decision'), decided_by: OWNER }] }],
    assignments: [{ ...sampleShape('own_assignment'), proof: { ...sampleShape('own_proof'), reviews: [{ ...sampleShape('member_review'), reviewer: OWNER }], appeals: [{ resolved_by: OWNER }] } }],
    published: [{ ...sampleShape('published_proof'), published_by: OWNER, credits: [{ name: 'Fixture Singer', role: 'voice', account: OTHER }] }] };
  const me = await member(leaguePlane({ answer: () => leaky }));
  assert.equal(me.status, 200);
  assert.deepEqual(Object.keys(me.body.league).sort(), keysOf('me'));
  const text = JSON.stringify(me.body);
  for (const field of C.FOREIGN_ID_FIELDS) assert.ok(!text.includes(`"${field}":`), field);
  assert.ok(!text.includes(OWNER) && !text.includes(OTHER), 'no other account id survives');
  assert.equal(me.body.league.assignments[0].proof.reviews[0].decision, 'submitted', 'what is not foreign is kept');

  const saved = await member(leaguePlane({ answer: () => ({ ...sampleShape('member_application'), statement: 'Test fixture: words the member wrote', applicant: MEMBER, document: { statement: 'x' } }) }),
    `missions/${U(7)}/application`, { method: 'POST', body: { idempotency_key: KEY, expected_revision: 0, application: { submit: false, requirements_revision: 1 } } });
  assert.deepEqual(Object.keys(saved.body.application).sort(), keysOf('member_application'), 'a mutation answer is its lean shape');
  assert.deepEqual(memberSafe([{ reviewer: 1, a: [{ account: 2, b: 3 }] }]), [{ a: [{ b: 3 }] }]);
});

test('a nested row is cut to its contract shape too: an upload inside me.get carries no tenant, participant, family or storage identity', async () => {
  const rawUpload = { ...uploadRow({ id: U(8), state: 'sealed', family: 'ebml', sha256: SHA, bytes: 16 }), storage: { object_id: U(70), etag: '"x"', size: 16 }, path: 'league/v1/t/x' };
  const assignment = { ...sampleShape('own_assignment'), participant: MEMBER, uploads: [rawUpload],
    proof: { ...sampleShape('own_proof'), media: [{ upload_id: U(8), kind: 'audio', mime: 'audio/webm', bytes: 16, sha256: SHA, storage: { object_id: U(70) } }], internal_note: 'dropped' },
    draft: { ...sampleShape('draft'), document: { lyrics: 'Test fixture lyrics', credits: [] } } };
  const application = { ...sampleShape('own_application'), document: { statement: 'Test fixture: kept, it is the member\'s own json document' }, accommodation: null };
  const r = await member(leaguePlane({ answer: () => ({ ...sampleShape('me'), actor: MEMBER, applications: [application], assignments: [assignment] }) }));
  assert.equal(r.status, 200);
  const [a] = r.body.league.assignments;
  assert.deepEqual(Object.keys(a).sort(), keysOf('own_assignment'));
  assert.deepEqual(Object.keys(a.uploads[0]).sort(), keysOf('member_upload'));
  assert.deepEqual(Object.keys(a.proof).sort(), keysOf('own_proof'));
  assert.deepEqual(a.proof.media, [{ upload_id: U(8), kind: 'audio', mime: 'audio/webm', bytes: 16, sha256: SHA }]);
  assert.deepEqual(a.draft.document, { lyrics: 'Test fixture lyrics', credits: [] }, 'a document value is kept as stored');
  assert.equal(r.body.league.applications[0].document.statement, application.document.statement);
  const text = JSON.stringify(r.body);
  for (const leak of [U(70), TENANT, '"family"', '"storage"', 'league/v1/', 'internal_note']) assert.ok(!text.includes(leak), leak);
});

/* ------------------------------------------------------------------ uploads, in MEDIA.order */

test('upload begin: the staged row first, then one grant for the row\'s own path; the answer narrows the row; a replay signs again', async () => {
  const row = uploadRow({ id: U(8), assignment_id: U(7) });
  const plane = leaguePlane({ answer: () => row });
  const body = { idempotency_key: KEY, upload: { kind: 'audio', mime: 'audio/webm', bytes: 16 } };
  const r = await member(plane, `assignments/${U(7)}/uploads`, { method: 'POST', body });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(plane.rpc().map((c) => c.body), [{ p_action: 'uploads.begin', p_actor: MEMBER, p_id: U(7), p_document: { kind: 'audio', mime: 'audio/webm', bytes: 16 }, p_revision: null, p_key: KEY }]);
  assert.deepEqual(Object.keys(r.body.upload).sort(), keysOf('member_upload'));
  for (const hidden of ['tenant', 'participant', 'family', 'storage']) assert.ok(!(hidden in r.body.upload), hidden);
  assert.deepEqual([r.body.grant.method, r.body.grant.headers, r.body.grant.expires_in], ['PUT', { 'content-type': 'audio/webm', 'x-upsert': 'false' }, C.MEDIA.upload_grant_seconds]);
  assert.ok(r.body.grant.url.startsWith(`${env.SUPABASE_URL}/storage/v1/object/upload/sign/equity-uprise-private/${pathOf(row)}?token=`));
  assert.ok(!JSON.stringify(plane.rpc()).includes('/storage/'), 'no URL is sent to or stored by the RPC');
  assert.equal((await plane.storage.put(r.body.grant, WEBM, { headers: { 'content-type': 'audio/webm' } })).status, 200, 'the grant stores the file');
  plane.storage.remove(pathOf(row));
  const again = await member(plane, `assignments/${U(7)}/uploads`, { method: 'POST', body });
  assert.equal(again.body.upload.id, r.body.upload.id); assert.notEqual(again.body.grant.url, r.body.grant.url, 'a fresh grant for the same row');
});

test('upload begin refusals: an unknown or mismatched type is 415 and too many bytes 413 before any call; the SQL\'s hints map the same; a row that would outlive its grant is 409', async () => {
  const plane = leaguePlane();
  for (const [upload, status, reason] of [[{ kind: 'audio', mime: 'audio/flac', bytes: 16 }, 415, 'media_type_not_allowed'], [{ kind: 'video', mime: 'audio/webm', bytes: 16 }, 415, 'media_type_not_allowed'],
    [{ kind: 'audio', mime: 'audio/webm;codecs=opus', bytes: 16 }, 415, 'media_type_not_allowed'], [{ kind: 'audio', mime: 'audio/webm', bytes: C.MEDIA.hard_max_bytes + 1 }, 413, 'media_too_large'],
    [{ kind: 'audio', mime: 'audio/webm', bytes: 0 }, 422, 'invalid'], [{ kind: 'audio', mime: 'audio/webm' }, 422, 'invalid']]) {
    const r = await member(plane, `assignments/${U(7)}/uploads`, { method: 'POST', body: { idempotency_key: KEY, upload } });
    assert.deepEqual([r.status, r.body.reason], [status, reason], JSON.stringify(upload));
  }
  assert.equal(plane.all().length, 0);
  for (const [hint, status, reason] of [['media_type_not_allowed', 415, 'media_type_not_allowed'], ['media_too_large', 413, 'media_too_large'], ['something_else', 422, 'invalid']]) {
    const hinted = leaguePlane({ answer: () => sqlError('22023', { hint }) });
    const r = await member(hinted, `assignments/${U(7)}/uploads`, { method: 'POST', body: { idempotency_key: KEY, upload: { kind: 'audio', mime: 'audio/webm', bytes: 16 } } });
    assert.deepEqual([r.status, r.body.reason], [status, reason], hint); assert.equal(hinted.storageCalls().length, 0);
  }
  const late = leaguePlane({ answer: () => uploadRow({ expires_at: new Date(T0 + 3600 * 1000).toISOString() }) });
  const r = await member(late, `assignments/${U(7)}/uploads`, { method: 'POST', body: { idempotency_key: KEY, upload: { kind: 'audio', mime: 'audio/webm', bytes: 16 } } });
  assert.deepEqual([r.status, r.body.reason], [409, 'upload_expired']); assert.equal(late.storageCalls().length, 0, 'no grant is signed');
});

test('upload complete: the own row first, then the seal with what was measured, as this member; a second complete reads nothing', async () => {
  let row = uploadRow({ id: U(8) });
  const plane = leaguePlane({ answer: (call) => (call.surface === 'media' ? sealedFrom(call) : row) });
  plane.storage.store(pathOf(row), WEBM, { contentType: 'audio/webm' });
  const object = plane.storage.object(pathOf(row));
  const r = await member(plane, `uploads/${U(8).toUpperCase()}/complete`, { method: 'POST', body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [get, seal] = plane.rpc();
  assert.deepEqual([get.name, get.body], [NAMES.member, { p_action: 'uploads.get', p_actor: MEMBER, p_id: U(8), p_document: {}, p_revision: null, p_key: null }]);
  assert.equal(seal.name, NAMES.seal);
  assert.deepEqual(seal.body, { p_upload: U(8), p_actor: MEMBER, p_result: { outcome: 'sealed', bytes: 16, sha256: sha256(WEBM), family: 'ebml', storage: { object_id: object.id, etag: object.eTag, size: 16 } } });
  assert.deepEqual([r.body.upload.state, r.body.upload.sha256, r.body.upload.bytes], ['sealed', sha256(WEBM), 16]);
  assert.deepEqual(Object.keys(r.body.upload).sort(), keysOf('member_upload'));
  /* The row is sealed now: a second complete answers it and reads nothing. */
  row = sealedFrom(seal);
  const calls = plane.all().length;
  const again = await member(plane, `uploads/${U(8)}/complete`, { method: 'POST', body: {} });
  assert.equal(again.body.upload.state, 'sealed');
  assert.deepEqual(plane.all().slice(calls).map((c) => c.kind === 'rpc' ? c.body.p_action : c.kind), ['uploads.get'], 'one read of the row, no storage, no seal');
});

test('upload complete refusals: no object is 409 without a seal; a seal refusal passes through and keeps the object; another account\'s row reaches no storage', async () => {
  const empty = leaguePlane({ answer: () => uploadRow({ id: U(8) }) });
  const missing = await member(empty, `uploads/${U(8)}/complete`, { method: 'POST', body: {} });
  assert.deepEqual([missing.status, missing.body.reason], [409, 'upload_missing']);
  assert.deepEqual(empty.rpc().map((c) => c.body.p_action), ['uploads.get']);

  const draining = leaguePlane({ answer: (call) => (call.surface === 'media' ? sqlError('EUM02') : uploadRow({ id: U(8) })) });
  draining.storage.store(pathOf(uploadRow({ id: U(8) })), WEBM, { contentType: 'audio/webm' });
  const refused = await member(draining, `uploads/${U(8)}/complete`, { method: 'POST', body: {} });
  assert.deepEqual([refused.status, refused.body.reason], MODULE_POLICY_ERRORS.guard.EUM02);
  assert.ok(draining.storage.object(pathOf(uploadRow({ id: U(8) }))), 'the object is kept: the row is still staged');

  for (const answer of [() => sqlError('42501'), () => uploadRow({ id: U(8), participant: OTHER })]) {
    const foreign = leaguePlane({ answer });
    foreign.storage.store(pathOf(uploadRow({ id: U(8) })), WEBM, { contentType: 'audio/webm' });
    const r = await member(foreign, `uploads/${U(8)}/complete`, { method: 'POST', body: {} });
    assert.deepEqual([r.status, r.body], [404, NOT_AVAILABLE]);
    assert.equal(foreign.storageCalls().length, 0); assert.ok(!foreign.rpc().some((c) => c.name === NAMES.seal));
  }
});

test('upload discard: the command, then the object is deleted; a failed deletion still answers the discarded row', async () => {
  const row = uploadRow({ id: U(8), state: 'discarded', discarded_at: AT });
  for (const failing of [false, true]) {
    const plane = leaguePlane({ answer: () => row });
    plane.storage.store(pathOf(row), WEBM, { contentType: 'audio/webm' });
    if (failing) plane.storage.intercept((call) => (call.method === 'DELETE' ? new Response('no', { status: 500 }) : undefined));
    const r = await member(plane, `uploads/${U(8)}/discard`, { method: 'POST', body: { idempotency_key: KEY } });
    assert.equal(r.status, 200);
    assert.deepEqual(plane.rpc().map((c) => [c.body.p_action, c.body.p_id, c.body.p_document, c.body.p_key]), [['uploads.discard', U(8), {}, KEY]]);
    assert.equal(r.body.upload.state, 'discarded'); assert.deepEqual(Object.keys(r.body.upload).sort(), keysOf('member_upload'));
    assert.equal(Boolean(plane.storage.object(pathOf(row))), failing, failing ? 'left to the purge' : 'deleted');
  }
});

test('own signed read: uploads.get with sign, the stored identity re-checked, one short read; a moved object is 409; SQL refusals reach no storage', async () => {
  const plane = leaguePlane({ answer: (call) => sealedRow(plane.storage, uploadRow({ id: U(8) }), SHA) });
  plane.storage.store(pathOf(uploadRow({ id: U(8) })), WEBM, { contentType: 'audio/webm' });
  const r = await member(plane, `uploads/${U(8)}/url`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(plane.rpc().map((c) => c.body), [{ p_action: 'uploads.get', p_actor: MEMBER, p_id: U(8), p_document: { sign: true }, p_revision: null, p_key: null }]);
  assert.deepEqual(r.body.media, { upload_id: U(8), kind: 'audio', mime: 'audio/webm', bytes: 16, sha256: SHA });
  assert.equal(r.body.expires_in, C.MEDIA.signed_read_seconds);
  assert.ok(r.body.url.startsWith(`${env.SUPABASE_URL}/storage/v1/object/sign/equity-uprise-private/${pathOf(uploadRow({ id: U(8) }))}?token=`));
  assert.deepEqual(Object.keys(r.body).sort(), ['expires_in', 'media', 'ok', 'url']);
  /* The object at the row's path is replaced (a new object id and eTag): refused, nothing signed. */
  const identity = sealedRow(plane.storage, uploadRow({ id: U(8) }), SHA);
  const moved = leaguePlane({ answer: () => identity });
  moved.storage.store(pathOf(uploadRow({ id: U(8) })), WEBM, { contentType: 'audio/webm' });
  const out = await member(moved, `uploads/${U(8)}/url`);
  assert.deepEqual([out.status, out.body.reason], [409, 'media_changed']);
  assert.ok(!moved.storageCalls().some((c) => c.call.route.startsWith('object/sign/')), 'nothing was signed');
  for (const [code, status, reason] of [['EU014', 409, 'media_binding'], ['EU016', 409, 'moderation_hold']]) {
    const refused = leaguePlane({ answer: () => sqlError(code) });
    const r2 = await member(refused, `uploads/${U(8)}/url`);
    assert.deepEqual([r2.status, r2.body.reason], [status, reason]); assert.equal(refused.storageCalls().length, 0);
  }
});

/* ------------------------------------------------------------------ receipts */

test('receipts: only the session actor\'s receipt is asked for, and an upload receipt carries a member_upload, not the raw row', async () => {
  const stored = { surface: 'member', operation: 'uploads.begin', idempotency_key: 'fixture:key:0001', created_at: AT, internal: 'dropped',
    result: { ...uploadRow({ id: U(8), state: 'sealed', family: 'ebml' }), storage: { object_id: U(70), etag: '"x"', size: 16 } } };
  const plane = leaguePlane({ answer: () => stored });
  const r = await member(plane, 'receipts/uploads.begin/fixture%3Akey%3A0001');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(plane.rpc().map((c) => c.body), [{ p_action: 'receipts.get', p_actor: MEMBER, p_id: '', p_document: { operation: 'uploads.begin', key: 'fixture:key:0001' }, p_revision: null, p_key: null }]);
  assert.deepEqual(Object.keys(r.body.receipt).sort(), keysOf('receipt'));
  assert.deepEqual(Object.keys(r.body.receipt.result).sort(), keysOf('member_upload'));
  assert.ok(!JSON.stringify(r.body).includes(U(70)) && !JSON.stringify(r.body).includes(TENANT), 'no storage identity, no tenant');
  const other = leaguePlane({ answer: () => sqlError('P0002') });
  const none = await member(other, `receipts/uploads.begin/${KEY}`, { token: OTHER_TOKEN });
  assert.deepEqual([none.status, none.body], [404, NOT_AVAILABLE]); assert.equal(other.rpc()[0].body.p_actor, OTHER);
});

/* ------------------------------------------------------------------ preflight, through the real Worker entry */

test('a browser preflight for the member routes is answered before any sign-in gate', async () => {
  registerHooks({
    resolve(specifier, context, next) { return specifier === 'cloudflare:workers' ? { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true } : next(specifier, context); },
    load(url, context, next) { return /\.html$/.test(url) ? { format: 'module', source: `export default ${JSON.stringify(readFileSync(new URL(url), 'utf8'))};`, shortCircuit: true } : next(url, context); }
  });
  const { default: entry } = await import('../src/entry.js');
  for (const path of [C.PREFIX.member, `${C.PREFIX.member}/missions/${U(7)}/application`, `${C.PREFIX.member}/uploads/${U(8)}/url`]) {
    const response = await entry.fetch(new Request(`https://api.mccluster.org${path}`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } }), {}, {});
    assert.equal(response.status, 204, path);
    assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
    assert.match(response.headers.get('access-control-allow-headers') || '', /authorization/);
    assert.match(response.headers.get('access-control-allow-headers') || '', /content-type/);
    for (const method of ['GET', 'POST', 'PATCH']) assert.match(response.headers.get('access-control-allow-methods') || '', new RegExp(method), method);
  }
  /* The preflight opens nothing: the real request without a bearer is still refused. */
  const real = await entry.fetch(new Request(`https://api.mccluster.org${C.PREFIX.member}`, { headers: { origin: ORIGIN } }), { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY }, {});
  assert.equal(real.status, 401);
  /* A signed-in request through the real entry: the Worker's own session check (GoTrue /auth/v1/user) names the actor,
     and the member command is the only other call. No house-owner lookup is made. */
  const offline = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    seen.push(url.replace(env.SUPABASE_URL, ''));
    if (url === `${env.SUPABASE_URL}/auth/v1/user`) {
      const bearer = new Headers(init.headers).get('authorization');
      return bearer === `Bearer ${MEMBER_TOKEN}` ? Response.json({ id: MEMBER }) : Response.json({ message: 'invalid' }, { status: 401 });
    }
    if (url === `${env.SUPABASE_URL}/rest/v1/rpc/${NAMES.member}`) return Response.json({ ...sampleShape('me'), actor: JSON.parse(init.body).p_actor });
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const signedIn = await entry.fetch(new Request(`https://api.mccluster.org${C.PREFIX.member}`, { headers: { origin: ORIGIN, authorization: `Bearer ${MEMBER_TOKEN}` } }), { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY }, {});
    assert.equal(signedIn.status, 200);
    assert.equal((await signedIn.json()).league.actor, MEMBER);
    assert.deepEqual(seen, ['/auth/v1/user', `/rest/v1/rpc/${NAMES.member}`]);
    const stranger = await entry.fetch(new Request(`https://api.mccluster.org${C.PREFIX.member}`, { headers: { origin: ORIGIN, authorization: 'Bearer not-a-session' } }), { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY }, {});
    assert.equal(stranger.status, 401);
    assert.deepEqual(seen.slice(2), ['/auth/v1/user'], 'an unknown session reaches no RPC');
  } finally {
    globalThis.fetch = offline;
  }
});

test('nothing in the member routes logged anything', () => {
  assert.deepEqual(logged, []);
});
