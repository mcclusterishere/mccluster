/* Audit C5, remaining paid-operation work (review packet 2026-11-09): the
   router's operation dedupe was check-then-create, so two concurrent calls
   with one stable operation_id each reserved budget and submitted to the
   provider; and any thrown submit error, including a timeout AFTER the
   provider may have accepted, was treated as "not submitted" and released the
   reservation. These tests pin the atomic claim (table applied in production
   as supabase/migrations/20261109194957_media_operation_claims_v1.sql; the
   functions the router calls are supabase/pending/media_operation_claims_v2.sql)
   and the uncertain-outcome handling, on the compare-and-set submit protocol
   (cas-v1). Recovery of what these paths leave behind:
   media-operation-recovery.test.mjs. Synthetic plane and provider only
   (./helpers/media-plane.mjs); no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGeneration, operationFingerprint } from '../src/media/router.js';
import { classifySubmitError } from '../src/media/fal.js';
import { ORG, USER, MODEL, env, json, plane, provider, traced, V2_FUNCTIONS } from './helpers/media-plane.mjs';

const req = (body) => new Request('https://api.fixture.invalid/v1/media/generate', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});
const generate = (extra = {}) => req({ org_id: ORG, model_id: 't2i', prompt: 'synthetic lighthouse', operation_id: 'same-stable-operation', ...extra });

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
  /* The fixture used to fail every PATCH. Under cas-v1 a PATCH (the submit
     marker) precedes the provider call, and a marker that cannot be written
     means nothing is sent (media-operation-recovery.test.mjs). The scenario
     this test names is the write AFTER acceptance failing: the record of the
     request id and its fallback. The expectations are unchanged. */
  const st = plane({ patchFails: (entry) => entry.body.provider_request_id !== undefined });
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
    /* createBakeoff calls createGeneration without deps, so the real adapter
       runs; the plane does not answer the provider host, so each lane's one
       request fails with no answer (an uncertain outcome: reservation kept,
       job reconciling). The claim and reservation evidence is what we read. */
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

/* ---- rollout order: the Worker deployed before media_operation_claims_v2.sql ---- */

test('with every v2 function missing, a generation that carries an operation id fails closed: 503, nothing reserved, nothing sent', async () => {
  const st = plane({ missing: V2_FUNCTIONS });
  const fal = provider();
  try {
    await assert.rejects(traced(() => createGeneration(generate(), env, USER, { submit: fal.submit })),
      (e) => e.status === 503 && e.reason === 'operation_claims_unavailable' && e.detail?.operation_id === 'same-stable-operation');
    assert.equal(st.reserves, 0, 'no reservation');
    assert.equal(fal.submits, 0, 'no provider request');
    assert.equal(st.jobs.size, 0);
    assert.deepEqual(st.rpcs.map((call) => call.name), ['media_claim_operation_v2'], 'the v1 claim is never the fallback');
    const event = st.event('media.operation.claims_v2_missing');
    assert.ok(event, 'the missing migration is an event');
    assert.equal(event.level, 'error');
    assert.equal(event.org_id, ORG);
  } finally { st.restore(); }
});

test('with every v2 function missing, a one-off whose submit is refused still releases, through the 0054 function, and says so', async () => {
  const st = plane({ missing: V2_FUNCTIONS });
  const fal = provider({ mode: 'rejected' });
  try {
    await assert.rejects(traced(() => createGeneration(req({ org_id: ORG, model_id: 't2i', prompt: 'one-off' }), env, USER, { submit: fal.submit })), /Unprocessable/);
    assert.equal(fal.submits, 1);
    const job = st.onlyJob();
    assert.equal(job.status, 'failed');
    assert.equal(job.routing.reservation_state, 'released', 'a failed job does not keep its reservation because of the rollout order');
    assert.equal(st.releasesV1, 1);
    assert.deepEqual(st.rpcs.filter((call) => /release/.test(call.name)).map((call) => call.name),
      ['media_release_cost_reservation_v2', 'media_release_cost_reservation'], 'v2 is asked first');
    assert.deepEqual(st.rpcCalls('media_release_cost_reservation')[0].body, { p_job_id: job.id, p_reason: 'provider submission failed: Unprocessable input' });
    const event = st.event('media.operation.release_v1_fallback');
    assert.ok(event, 'the fallback is an event');
    assert.equal(event.level, 'warn');
    assert.equal(event.resource_id, job.id);
    assert.equal(st.claimCalls, 0, 'a one-off never consults the claim');
  } finally { st.restore(); }
});

test('the 0054 fallback is never used for a job this Worker already sees as settled', async () => {
  const { releaseReservation } = await import('../src/media/router.js');
  const st = plane({ missing: ['media_release_cost_reservation_v2'] });
  try {
    const job = st.createJob({ p_org_id: ORG, p_created_by: USER.id, p_routing: {} });
    Object.assign(job, { status: 'failed', actual_cost_cents: 1, routing: { ...job.routing, reservation_state: 'settled' } });
    const answer = await releaseReservation(env, job, 'webhook ERROR replay after settlement');
    assert.deepEqual({ released: answer.released, reason: answer.reason }, { released: false, reason: 'reservation_already_settled' });
    assert.equal(st.releasesV1, 0, '0054 has no settlement guard, so it is not called');
  } finally { st.restore(); }
});
