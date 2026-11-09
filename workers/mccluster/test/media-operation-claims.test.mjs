/* Audit C5, remaining paid-operation work (review packet 2026-11-09): the
   router's operation dedupe was check-then-create, so two concurrent calls
   with one stable operation_id each reserved budget and submitted to the
   provider; and any thrown submit error, including a timeout AFTER the
   provider may have accepted, was treated as "not submitted" and released the
   reservation. These tests pin the atomic claim (pending
   supabase/pending/media_operation_claims_v1.sql) and the uncertain-outcome
   handling. Synthetic plane and provider only; no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeneration, operationFingerprint } from '../src/media/router.js';
import { classifySubmitError } from '../src/media/fal.js';
import { __resetCapabilityCache } from '../src/lib/capabilities.js';

const ORG = '123e4567-e89b-42d3-a456-426614174000';
const USER = { id: '423e4567-e89b-42d3-a456-426614174333' };
const MODEL = { id: 't2i', provider: 'fal', provider_model_id: 'fal-ai/flux-2', capability: 'text-to-image', parameter_schema: {}, cost_hint: {}, enabled: true };
const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', FAL_KEY: 'synthetic' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/* A synthetic data plane with the REAL claim semantics of the pending SQL:
   one row per (org, operation_id), first insert wins, fingerprint mismatch
   refused, bind/fail only from 'claimed'. */
function plane({ claimsAvailable = true, lookupGate = null, patchFails = false, reserveFails = false } = {}) {
  const state = { claims: new Map(), jobs: new Map(), lookups: 0, reserves: 0, releases: 0, patches: [], claimCalls: 0 };
  let seq = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url), method = options.method || 'GET';
    const body = options.body ? JSON.parse(String(options.body)) : null;
    if (u.includes('/org_members?')) return json([{ org_id: ORG, role: 'owner' }]);
    if (u.includes('/control_role_capabilities?')) return json([{ role: 'owner', capability: 'media.generate', allowed: true }]);
    if (u.includes('/media_models?')) return json([MODEL]);
    if (u.includes('/rpc/media_claim_operation_v1')) {
      state.claimCalls += 1;
      if (!claimsAvailable) return new Response('{"code":"PGRST202","message":"Could not find the function"}', { status: 404 });
      const key = `${body.p_org_id}:${body.p_operation_id}`;
      const existing = state.claims.get(key);
      if (!existing) {
        const row = { org_id: body.p_org_id, operation_id: body.p_operation_id, fingerprint: body.p_fingerprint, state: 'claimed', job_id: null, failure: null };
        state.claims.set(key, row);
        return json({ outcome: 'won', claim: row });
      }
      if (existing.fingerprint !== body.p_fingerprint) return new Response('{"code":"P0001","message":"operation_payload_mismatch"}', { status: 400 });
      return json({ outcome: 'existing', claim: existing });
    }
    if (u.includes('/rpc/media_bind_operation_v1')) {
      const row = state.claims.get(`${body.p_org_id}:${body.p_operation_id}`);
      if (!row || row.state !== 'claimed') return new Response('{"code":"P0001","message":"operation_not_claimed"}', { status: 400 });
      Object.assign(row, { state: 'bound', job_id: body.p_job_id });
      return json(row);
    }
    if (u.includes('/rpc/media_fail_operation_v1')) {
      const row = state.claims.get(`${body.p_org_id}:${body.p_operation_id}`);
      if (!row || row.state !== 'claimed') return new Response('{"code":"P0001","message":"operation_not_claimed"}', { status: 400 });
      Object.assign(row, { state: 'failed', failure: body.p_failure });
      return json(row);
    }
    if (u.includes('/media_jobs?') && method === 'GET') {
      state.lookups += 1;
      if (lookupGate) await lookupGate(state.lookups);
      const id = decodeURIComponent((u.match(/id=eq\.([^&]+)/) || [])[1] || '');
      const byOp = decodeURIComponent((u.match(/operation_id=eq\.([^&]+)/) || [])[1] || '');
      const rows = [...state.jobs.values()].filter((j) => (id ? j.id === id : true) && (byOp ? j.routing?.operation_id === byOp : true));
      return json(rows);
    }
    if (u.includes('/rpc/media_create_budgeted_job_v2')) {
      state.reserves += 1;
      if (reserveFails) return new Response('{"code":"22023","message":"Estimated media cost exceeds budget"}', { status: 400 });
      seq += 1;
      const job = { id: `523e4567-e89b-42d3-a456-42661417400${seq}`, org_id: ORG, status: 'queued', routing: body.p_routing };
      state.jobs.set(job.id, job);
      return json([job]);
    }
    if (u.includes('/rpc/media_release_cost_reservation')) { state.releases += 1; return json(null); }
    if (u.includes('/media_jobs?') && method === 'PATCH') {
      state.patches.push(body);
      if (patchFails) return new Response('{"message":"synthetic persistence failure"}', { status: 500 });
      const id = decodeURIComponent(u.match(/id=eq\.([^&]+)/)[1]);
      const job = Object.assign(state.jobs.get(id) || { id, org_id: ORG }, body);
      state.jobs.set(id, job);
      return json([job]);
    }
    if (u.includes('/control_observability_events')) return new Response(null, { status: 201 });
    throw new Error(`Unexpected offline fixture fetch: ${method} ${u}`);
  };
  __resetCapabilityCache();
  state.restore = () => { globalThis.fetch = original; __resetCapabilityCache(); };
  return state;
}

const req = (body) => new Request('https://api.fixture.invalid/v1/media/generate', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});
const generate = (extra = {}) => req({ org_id: ORG, model_id: 't2i', prompt: 'synthetic lighthouse', operation_id: 'same-stable-operation', ...extra });

function provider({ mode = 'accept' } = {}) {
  const p = { submits: 0 };
  p.submit = async () => {
    p.submits += 1;
    if (mode === 'uncertain') throw Object.assign(new Error('Synthetic timeout after provider acceptance'), { name: 'TimeoutError' });
    if (mode === 'definite') throw Object.assign(new Error('fal gateway is not configured'), { status: 503, preflight: true });
    if (mode === 'rejected') throw Object.assign(new Error('Unprocessable input'), { status: 422 });
    return { request_id: `accepted-${p.submits}` };
  };
  return p;
}

test('concurrent calls with one operation id: one claim winner, one reservation, one submission, same job for both', async () => {
  let release; const barrier = new Promise((r) => { release = r; });
  /* Both callers reach the claim; the loser must wait for the winner's bind
     before reading back, so gate the loser's lookup until the winner's job exists. */
  const st = plane({ lookupGate: async () => { await barrier; } });
  const fal = provider();
  try {
    const a = createGeneration(generate(), env, USER, { submit: fal.submit });
    const b = createGeneration(generate(), env, USER, { submit: fal.submit });
    /* let the winner finish before the loser's readback resolves */
    const first = await Promise.race([a, b]);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(st.reserves, 1, 'exactly one budget reservation');
    assert.equal(fal.submits, 1, 'exactly one provider submission');
    assert.equal(ra.id, rb.id);
    assert.equal(ra.id, first.id);
    assert.equal(ra.provider_request_id, 'accepted-1');
    assert.equal(st.claims.size, 1);
    assert.equal([...st.claims.values()][0].state, 'bound');
  } finally { st.restore(); }
});

test('a loser that arrives before the winner has bound its job is told the operation is pending, not given a second reservation', async () => {
  const st = plane();
  const fal = provider();
  try {
    /* pre-claim as if a winner is mid-flight */
    st.claims.set(`${ORG}:same-stable-operation`, { org_id: ORG, operation_id: 'same-stable-operation', fingerprint: await operationFingerprint({ org_id: ORG, model_id: 't2i', prompt: 'synthetic lighthouse' }, MODEL), state: 'claimed', job_id: null });
    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 409 && e.reason === 'operation_pending' && e.detail?.operation_id === 'same-stable-operation');
    assert.equal(st.reserves, 0); assert.equal(fal.submits, 0);
  } finally { st.restore(); }
});

test('the same operation id with a different payload is refused before any reservation', async () => {
  const st = plane();
  const fal = provider();
  try {
    await createGeneration(generate(), env, USER, { submit: fal.submit });
    await assert.rejects(createGeneration(generate({ prompt: 'a different prompt' }), env, USER, { submit: fal.submit }), (e) => e.status === 409 && e.reason === 'operation_payload_mismatch');
    assert.equal(st.reserves, 1); assert.equal(fal.submits, 1);
  } finally { st.restore(); }
});

test('a new signed envelope (new nonce) for the same operation id resolves to the one job', async () => {
  const st = plane();
  const fal = provider();
  try {
    const first = await createGeneration(generate(), env, USER, { submit: fal.submit });
    const again = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(again.id, first.id);
    assert.equal(st.reserves, 1); assert.equal(fal.submits, 1);
  } finally { st.restore(); }
});

test('a definite failure before reservation is recorded on the claim and a retry reads the same refusal without reserving', async () => {
  const st = plane({ reserveFails: true });
  const fal = provider();
  try {
    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), /exceeds budget/);
    assert.equal([...st.claims.values()][0].state, 'failed');
    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 409 && e.reason === 'operation_failed' && /exceeds budget/.test(e.message));
    assert.equal(st.reserves, 1, 'the loser did not reserve again');
    assert.equal(fal.submits, 0);
  } finally { st.restore(); }
});

test('provider acceptance followed by a lost response keeps the reservation and marks the job reconciling', async () => {
  const st = plane();
  const fal = provider({ mode: 'uncertain' });
  try {
    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 502 && e.reason === 'provider_outcome_uncertain');
    assert.equal(st.releases, 0, 'reservation intact');
    const last = st.patches.at(-1);
    assert.equal(last.status, 'reconciling');
    assert.equal(last.provider_status?.outcome, 'uncertain');
    assert.match(last.error?.message, /timeout/);
    assert.equal([...st.claims.values()][0].state, 'bound', 'claim stays bound to the job');
    /* a retry with the same operation id must NOT resubmit a possibly accepted paid request */
    const again = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(again.status, 'reconciling');
    assert.equal(fal.submits, 1);
  } finally { st.restore(); }
});

test('a definite pre-send failure still releases the reservation and fails the job', async () => {
  const st = plane();
  const fal = provider({ mode: 'definite' });
  try {
    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), /not configured/);
    assert.equal(st.releases, 1);
    assert.equal(st.patches.at(-1).status, 'failed');
  } finally { st.restore(); }
});

test('a provider 4xx rejection is definite: released and failed', async () => {
  const st = plane();
  const fal = provider({ mode: 'rejected' });
  try {
    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), /Unprocessable/);
    assert.equal(st.releases, 1);
  } finally { st.restore(); }
});

test('persistence failure after the provider accepted never releases the reservation', async () => {
  const st = plane({ patchFails: true });
  const fal = provider();
  try {
    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 502 && e.reason === 'provider_accepted_persistence_failed' && e.detail?.provider_request_id === 'accepted-1');
    assert.equal(st.releases, 0);
    assert.equal(fal.submits, 1);
  } finally { st.restore(); }
});

test('without the claim RPC the operation fails closed before any reservation', async () => {
  const st = plane({ claimsAvailable: false });
  const fal = provider();
  try {
    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 503 && e.reason === 'operation_claims_unavailable');
    assert.equal(st.reserves, 0); assert.equal(fal.submits, 0);
  } finally { st.restore(); }
});

test('a request without an operation id keeps the old single-shot path and never touches the claim table', async () => {
  const st = plane();
  const fal = provider();
  try {
    const job = await createGeneration(req({ org_id: ORG, model_id: 't2i', prompt: 'one-off' }), env, USER, { submit: fal.submit });
    assert.ok(job.id); assert.equal(st.claimCalls, 0); assert.equal(st.reserves, 1);
  } finally { st.restore(); }
});

test('submit error classification: preflight and provider answers (4xx, 500, 503) are definite; timeouts, network failures and 502/504 are uncertain', () => {
  assert.equal(classifySubmitError(Object.assign(new Error('x'), { preflight: true, status: 503 })), 'definite');
  assert.equal(classifySubmitError(Object.assign(new Error('x'), { status: 422 })), 'definite');
  assert.equal(classifySubmitError(Object.assign(new Error('x'), { status: 429 })), 'definite');
  assert.equal(classifySubmitError(Object.assign(new Error('x'), { name: 'TimeoutError' })), 'uncertain');
  assert.equal(classifySubmitError(Object.assign(new Error('x'), { name: 'AbortError' })), 'uncertain');
  assert.equal(classifySubmitError(new TypeError('fetch failed')), 'uncertain');
  assert.equal(classifySubmitError(Object.assign(new Error('x'), { status: 503 })), 'definite', 'the provider answered and did not queue');
  assert.equal(classifySubmitError(Object.assign(new Error('x'), { status: 500 })), 'definite');
  assert.equal(classifySubmitError(Object.assign(new Error('x'), { status: 502 })), 'uncertain', 'gateway answers can hide an accepted request');
  assert.equal(classifySubmitError(Object.assign(new Error('x'), { status: 504 })), 'uncertain');
  assert.equal(classifySubmitError(Object.assign(new Error('x'), { timeoutType: 'start' })), 'uncertain');
  assert.equal(classifySubmitError(new Error('anything else')), 'uncertain');
});

test('the operation fingerprint is canonical: key order does not matter, content does', async () => {
  const a = await operationFingerprint({ org_id: ORG, model_id: 't2i', input: { b: 1, a: 2 }, prompt: 'p' }, MODEL);
  const b = await operationFingerprint({ prompt: 'p', input: { a: 2, b: 1 }, model_id: 't2i', org_id: ORG }, MODEL);
  const c = await operationFingerprint({ org_id: ORG, model_id: 't2i', input: { b: 1, a: 3 }, prompt: 'p' }, MODEL);
  assert.equal(a, b); assert.notEqual(a, c); assert.match(a, /^[0-9a-f]{64}$/);
});

test('after an isolate restart a new signed envelope for the same operation reaches the claim and gets the one job', async () => {
  const { signCoreRequest } = await import('../../../core/src/broker-edge-auth.mjs');
  const SECRET = 'shared-core-edge-key';
  const sharedNonces = new Map();
  const store = { async claim(nonce, exp) { if (sharedNonces.has(nonce)) return false; sharedNonces.set(nonce, exp); return true; } };
  const sign = (body) => signCoreRequest({ secret: SECRET, method: 'POST', path: '/v1/media/mcp', bodyBytes: Buffer.from(body) });
  const senv = { CORE_EDGE_SIGNING_KEY: SECRET, ...env };
  const st = plane();
  const fal = provider();
  try {
    for (const isolate of ['restart-1', 'restart-2']) {
      /* a fresh module instance = a restarted isolate with an empty memory cache */
      const mod = await import(`../src/media/core-signature.js?claims-isolate=${isolate}`);
      const body = JSON.stringify({ jsonrpc: '2.0', id: isolate, method: 'tools/call', params: { name: 'media.generate', arguments: { operation_id: 'same-stable-operation' } } });
      const request = new Request('https://api.mccluster.org/v1/media/mcp', { method: 'POST', headers: sign(body), body });
      assert.equal(await mod.verifyCoreSignature({ request, env: senv, path: '/v1/media/mcp', bodyBytes: new TextEncoder().encode(body), replayStore: store }), true);
      const job = await createGeneration(generate(), env, USER, { submit: fal.submit });
      assert.equal(job.id, '523e4567-e89b-42d3-a456-426614174001');
    }
    assert.equal(sharedNonces.size, 2, 'two distinct envelopes were accepted once each');
    assert.equal(st.reserves, 1); assert.equal(fal.submits, 1);
  } finally { st.restore(); }
});

test('media.compare derives one stable child operation id per model, so a retried compare does not fan out twice', async () => {
  const { createBakeoff } = await import('../src/media/orchestrator.js');
  const st = plane();
  const fal = provider();
  const original = globalThis.fetch;
  /* two models in the catalog for this test */
  globalThis.fetch = (function (inner) { return async (url, options) => {
    if (String(url).includes('/media_models?')) {
      const id = decodeURIComponent((String(url).match(/id=eq\.([^&]+)/) || [])[1] || '');
      return json([{ ...MODEL, id, provider_model_id: `fal-ai/${id}` }]);
    }
    return inner(url, options);
  }; })(globalThis.fetch);
  try {
    const body = { org_id: ORG, model_ids: ['t2i', 'alt/model'], prompt: 'p', operation_id: 'compare-7' };
    const compare = () => createBakeoff(new Request('https://api.fixture.invalid/v1/media/compare', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, USER);
    /* createBakeoff calls createGeneration without deps; the provider client
       is not installed offline, so the submit stage fails definitively and
       the reservation evidence is what we read. */
    const first = await compare().catch((e) => e);
    const claimed = [...st.claims.keys()].sort();
    assert.deepEqual(claimed, [`${ORG}:compare-7:alt_model`, `${ORG}:compare-7:t2i`]);
    const reservesAfterFirst = st.reserves;
    assert.equal(reservesAfterFirst, 2);
    await compare().catch(() => null);
    assert.equal(st.reserves, reservesAfterFirst, 'the retry reserved nothing new');
    void first;
  } finally { globalThis.fetch = original; st.restore(); }
});
