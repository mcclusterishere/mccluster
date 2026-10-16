/* Identity verification levels: the Worker routes (src/identity/router.js).
   docs/control-plane/IDENTITY-VERIFICATION-LEVELS.md. Every Persona and
   Supabase call is a local mock; no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { handleIdentity, verifyPersonaSignature, parsePersonaSignature, extractPersonaEvent } from '../src/identity/router.js';
import { preflightResponse } from '../src/preflight.js';

const SECRET = 'test-webhook-secret-not-real';
const USER = '00000000-0000-4000-8000-0000000000a1';
const SUB = '30000000-0000-4000-8000-000000000001';
const baseEnv = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', PERSONA_ENABLED: 'true', PERSONA_WEBHOOK_SECRET: SECRET, PERSONA_API_KEY: 'persona-test', PERSONA_TEMPLATE_ID: 'itmpl_Test123' };
const sign = (raw, t, secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
const now = () => Math.floor(Date.now() / 1000);
const event = (id = 'evt_Abc123456', status = 'approved', extra = {}) => JSON.stringify({ data: { type: 'event', id, attributes: { name: `inquiry.${status}`, 'created-at': new Date().toISOString(),
  payload: { data: { type: 'inquiry', id: 'inq_Abc123456', attributes: { status, 'name-first': 'EM', 'name-last': 'MEMBER', birthdate: '1990-04-02', 'identification-number': 'X1234567', ...extra } } } } } });

function mockFetch(handlers) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init, body: init.body ? JSON.parse(init.body) : null });
    for (const [match, fn] of handlers) if (u.includes(match)) return fn(u, init);
    throw new Error('unexpected fetch ' + u);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const post = (path, body, headers = {}) => new Request('https://api.mccluster.org' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

test('signature: a good HMAC over "t.body" verifies; a wrong secret, a tampered body or a missing header does not', async () => {
  const raw = event(), t = now();
  assert.deepEqual((await verifyPersonaSignature(raw, sign(raw, t), SECRET)).ok, true);
  assert.equal((await verifyPersonaSignature(raw, sign(raw, t, 'other'), SECRET)).reason, 'bad_signature');
  assert.equal((await verifyPersonaSignature(raw + ' ', sign(raw, t), SECRET)).reason, 'bad_signature');
  assert.equal((await verifyPersonaSignature(raw, '', SECRET)).reason, 'missing_signature');
  assert.equal((await verifyPersonaSignature(raw, sign(raw, t), '')).reason, 'not_configured');
});

test('signature: during a secret rotation either of two space-separated sets may match', async () => {
  const raw = event(), t = now();
  const header = `${sign(raw, t, 'old-secret')} ${sign(raw, t)}`;
  assert.equal(parsePersonaSignature(header).length, 2);
  assert.equal((await verifyPersonaSignature(raw, header, SECRET)).ok, true);
});

test('signature: a correctly signed but old delivery is a replay and is refused', async () => {
  const raw = event(), t = now() - 3600;
  const r = await verifyPersonaSignature(raw, sign(raw, t), SECRET);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'stale_timestamp');
});

test('only the inquiry id and status leave the event; name and birth YEAR only when the owner opts in; never the full birthdate or document number', () => {
  const off = extractPersonaEvent(JSON.parse(event()), { storeVerifiedName: false });
  assert.deepEqual([off.event_id, off.inquiry_id, off.status, off.verified_name, off.birth_year], ['evt_Abc123456', 'inq_Abc123456', 'approved', null, null]);
  const on = extractPersonaEvent(JSON.parse(event()), { storeVerifiedName: true });
  assert.equal(on.verified_name, 'EM MEMBER');
  assert.equal(on.birth_year, 1990);
  assert.ok(!JSON.stringify(on).includes('1990-04-02'));
  assert.ok(!JSON.stringify(on).includes('X1234567'));
  assert.equal(extractPersonaEvent({ data: { type: 'event', id: 'nope' } }), null);
});

test('webhook: good signature is applied once; the same event again is reported duplicate by the database; bad and stale signatures never reach it', async () => {
  const seen = new Set();
  const m = mockFetch([['/rest/v1/rpc/identity_apply_persona_event', (u, init) => {
    const b = JSON.parse(init.body); const dup = seen.has(b.p_event_id); seen.add(b.p_event_id);
    return json({ event_id: b.p_event_id, duplicate: dup, applied: !dup });
  }]]);
  try {
    const raw = event();
    let res = await handleIdentity(post('/v1/identity/persona/webhook', raw, { 'persona-signature': sign(raw, now()) }), baseEnv);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true, duplicate: false, applied: true });
    res = await handleIdentity(post('/v1/identity/persona/webhook', raw, { 'persona-signature': sign(raw, now()) }), baseEnv);
    assert.deepEqual(await res.json(), { received: true, duplicate: true, applied: false });
    const rpcBody = m.calls[0].body;
    assert.equal(rpcBody.p_verified_name, null, 'name not stored unless the owner opts in');
    assert.equal(rpcBody.p_birth_year, null);

    const before = m.calls.length;
    res = await handleIdentity(post('/v1/identity/persona/webhook', raw, { 'persona-signature': sign(raw, now(), 'wrong') }), baseEnv);
    assert.equal(res.status, 401);
    res = await handleIdentity(post('/v1/identity/persona/webhook', raw, { 'persona-signature': sign(raw, now() - 3600) }), baseEnv);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).detail.code, 'stale_timestamp');
    res = await handleIdentity(post('/v1/identity/persona/webhook', raw), baseEnv);
    assert.equal(res.status, 401);
    assert.equal(m.calls.length, before, 'refused deliveries never touch the database');
  } finally { m.restore(); }
});

test('webhook and inquiry are flagged off: PERSONA_ENABLED other than "true" answers 503 without any call', async () => {
  const m = mockFetch([]);
  try {
    const raw = event();
    for (const flag of [undefined, 'false', 'TRUE', '1']) {
      const env = { ...baseEnv, PERSONA_ENABLED: flag };
      let res = await handleIdentity(post('/v1/identity/persona/webhook', raw, { 'persona-signature': sign(raw, now()) }), env);
      assert.equal(res.status, 503);
      assert.equal((await res.json()).detail.code, 'PERSONA_DISABLED');
      res = await handleIdentity(post('/v1/identity/persona/inquiry', JSON.stringify({ submission_id: SUB }), { authorization: 'Bearer member' }), env);
      assert.equal(res.status, 503);
    }
    assert.equal(m.calls.length, 0);
  } finally { m.restore(); }
});

test('wrangler ships Persona OFF and names the secrets without values', async () => {
  const toml = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^PERSONA_ENABLED = "false"$/m);
  assert.match(toml, /^PERSONA_STORE_VERIFIED_NAME = "false"$/m);
  assert.doesNotMatch(toml, /^PERSONA_(API_KEY|TEMPLATE_ID|WEBHOOK_SECRET)\s*=/m);
});

test('inquiry: needs a signed-in member, their own submitted V2 video, then opens ONE Persona inquiry keyed to the submission', async () => {
  const m = mockFetch([
    ['/auth/v1/user', (u, init) => init.headers.authorization === 'Bearer member' ? json({ id: USER }) : json({}, 401)],
    ['/rest/v1/rpc/identity_submission_for_persona', () => json({ id: SUB, level: 'v2_halo_full', status: 'submitted', persona_inquiry_id: null })],
    ['api.withpersona.com/api/v1/inquiries', () => json({ data: { type: 'inquiry', id: 'inq_New1234567', attributes: { status: 'created' } }, meta: { 'one-time-link': 'https://withpersona.example/verify?code=x' } }, 201)],
    ['/rest/v1/rpc/identity_record_persona_inquiry', () => json({ submission_id: SUB, persona_inquiry_id: 'inq_New1234567' })]
  ]);
  try {
    let res = await handleIdentity(post('/v1/identity/persona/inquiry', JSON.stringify({ submission_id: SUB })), baseEnv);
    assert.equal(res.status, 401, 'no session');
    res = await handleIdentity(post('/v1/identity/persona/inquiry', JSON.stringify({ submission_id: SUB }), { authorization: 'Bearer member' }), baseEnv);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.inquiry_id, 'inq_New1234567');
    assert.match(body.one_time_link, /^https:\/\//);
    const persona = m.calls.find((c) => c.url.includes('withpersona'));
    assert.equal(persona.init.headers.authorization, 'Bearer persona-test');
    assert.equal(persona.init.headers['idempotency-key'], `mccluster-identity-${SUB}`);
    assert.equal(persona.body.data.attributes['inquiry-template-id'], 'itmpl_Test123');
    assert.equal(persona.body.meta['auto-create-account-reference-id'], USER);
    const lookup = m.calls.find((c) => c.url.includes('identity_submission_for_persona'));
    assert.deepEqual(lookup.body, { p_user: USER, p_submission_id: SUB }, 'the submission is looked up as the caller\'s own');
  } finally { m.restore(); }
});

test('inquiry: the video comes first, and only for a full-access request', async () => {
  for (const [sub, code] of [[{ id: SUB, level: 'v2_halo_full', status: 'awaiting_capture' }, 409], [{ id: SUB, level: 'v1_live_intro', status: 'submitted' }, 409], [null, 404]]) {
    const m = mockFetch([['/auth/v1/user', () => json({ id: USER })], ['/rest/v1/rpc/identity_submission_for_persona', () => json(sub)]]);
    try {
      const res = await handleIdentity(post('/v1/identity/persona/inquiry', JSON.stringify({ submission_id: SUB }), { authorization: 'Bearer member' }), baseEnv);
      assert.equal(res.status, code);
      assert.ok(!m.calls.some((c) => c.url.includes('withpersona')), 'Persona is not called');
    } finally { m.restore(); }
  }
});

test('entitlement: answered for the bearer only, by the database, never from a client claim', async () => {
  const m = mockFetch([
    ['/auth/v1/user', () => json({ id: USER })],
    ['/rest/v1/rpc/identity_entitlement_for', (u, init) => json({ key: 'halo_full', entitled: JSON.parse(init.body).p_user === USER })]
  ]);
  try {
    const res = await handleIdentity(new Request('https://api.mccluster.org/v1/identity/entitlement?key=halo_full&user=someone-else', { headers: { authorization: 'Bearer member' } }), baseEnv);
    assert.deepEqual(await res.json(), { key: 'halo_full', entitled: true });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(m.calls.at(-1).body.p_user, USER);
  } finally { m.restore(); }
});

test('routing: other paths fall through, wrong methods are 405, the browser preflight is answered', async () => {
  assert.equal(await handleIdentity(new Request('https://api.mccluster.org/v1/identityx'), baseEnv), null);
  assert.equal((await handleIdentity(new Request('https://api.mccluster.org/v1/identity/persona/webhook'), baseEnv)).status, 405);
  assert.equal((await handleIdentity(new Request('https://api.mccluster.org/v1/identity/nope'), baseEnv)).status, 404);
  const pre = preflightResponse(new Request('https://api.mccluster.org/v1/identity/persona/inquiry', { method: 'OPTIONS', headers: { origin: 'https://matthew.mccluster.org', 'access-control-request-method': 'POST' } }), {});
  assert.equal(pre.status, 204);
  const entry = await readFile(new URL('../src/entry-platform.js', import.meta.url), 'utf8');
  assert.match(entry, /handleIdentity\(request, env\)/);
});

test('the router never asks Persona for, or stores, ID images', async () => {
  const src = await readFile(new URL('../src/identity/router.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\/files|front-photo|back-photo|selfie-photo|government-id\/|\/documents\//i);
});
