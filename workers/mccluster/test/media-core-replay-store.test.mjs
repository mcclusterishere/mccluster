/* Audit finding C5 (2026-11-09): a Core-signed mutating request was accepted
   by two Worker isolates because the nonce cache lived in isolate memory.
   These tests pin the repair: mutating calls need an atomic claim in a shared
   replay store, fail closed without one, and a duplicate that does slip
   through to the media router resolves to the one existing job instead of a
   second reservation/submission. The last section drives a Core-signed
   media.generate through the real route (entry.fetch, POST /v1/media/mcp):
   without an id of its own the call is keyed core:<nonce>, with one it is
   keyed by Core's id. Synthetic stores and planes only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import { signCoreRequest } from '../../../core/src/broker-edge-auth.mjs';
import { scopedOperationId } from '../../../core/src/tools/mcp-http.mjs';
import {
  __resetCoreNonces,
  createSupabaseReplayStore,
  verifyCoreSignature
} from '../src/media/core-signature.js';
import { createGeneration } from '../src/media/router.js';
import { __resetCapabilityCache } from '../src/lib/capabilities.js';
import * as media from './helpers/media-plane.mjs';

/* entry.js imports cloudflare:workers and .html modules: resolve them the
   way the other entry-level suites do, before entry.js is loaded. */
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.html$/.test(url)) {
      const text = readFileSync(new URL(url), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    return next(url, context);
  }
});
const { default: entry } = await import('../src/entry.js');

const SECRET = 'shared-core-edge-key';
const PATH = '/v1/media/mcp';
const baseEnv = { CORE_EDGE_SIGNING_KEY: SECRET, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role' };

function signed(payload, { path = PATH, method = 'POST' } = {}) {
  const body = method === 'GET' ? '' : JSON.stringify(payload);
  const headers = signCoreRequest({ secret: SECRET, method, path, bodyBytes: Buffer.from(body) });
  return { request: new Request(`https://api.mccluster.org${path}`, { method, headers, ...(method === 'GET' ? {} : { body }) }), body };
}

/* A fake durable store: one Map shared by every "isolate" that uses it. */
function sharedStore() {
  const claimed = new Map();
  return {
    claimed,
    async claim(nonce, expiresAt) {
      if (claimed.has(nonce)) return false;
      claimed.set(nonce, expiresAt);
      return true;
    }
  };
}

async function verifyIn(isolate, request, body, env = baseEnv, extra = {}) {
  /* Each "isolate" is a fresh module instance so its memory cache is empty. */
  const mod = await import(`../src/media/core-signature.js?isolate=${isolate}`);
  return mod.verifyCoreSignature({ request, env, path: PATH, bodyBytes: new TextEncoder().encode(body), ...extra });
}

test('two isolates sharing a replay store accept one of two identical signed mutations', async () => {
  const store = sharedStore();
  const { request, body } = signed({ method: 'tools/call', params: { name: 'image.generate' } });
  assert.equal(await verifyIn('a', request, body, baseEnv, { replayStore: store }), true);
  await assert.rejects(verifyIn('b', request, body, baseEnv, { replayStore: store }), /already used/);
  assert.equal(store.claimed.size, 1);
});

test('without a shared store a mutating Core request fails closed', async () => {
  __resetCoreNonces();
  const { request, body } = signed({ method: 'tools/call' });
  await assert.rejects(
    verifyCoreSignature({ request, env: baseEnv, path: PATH, bodyBytes: new TextEncoder().encode(body) }),
    (error) => error.status === 503 && /replay store/.test(error.message)
  );
});

test('a store that cannot be consulted refuses the mutation rather than accepting it', async () => {
  __resetCoreNonces();
  const { request, body } = signed({ method: 'tools/call' });
  const broken = { async claim() { throw new Error('store offline'); } };
  await assert.rejects(
    verifyCoreSignature({ request, env: baseEnv, path: PATH, bodyBytes: new TextEncoder().encode(body), replayStore: broken }),
    (error) => error.status === 503 && /replay store/.test(error.message)
  );
});

test('the isolate-only cache must be accepted explicitly by configuration', async () => {
  __resetCoreNonces();
  const { request, body } = signed({ method: 'tools/call' });
  const env = { ...baseEnv, CORE_REPLAY_STORE: 'isolate' };
  assert.equal(await verifyCoreSignature({ request, env, path: PATH, bodyBytes: new TextEncoder().encode(body) }), true);
  await assert.rejects(verifyCoreSignature({ request, env, path: PATH, bodyBytes: new TextEncoder().encode(body) }), /already used/);
});

test('a read-only Core GET keeps the per-isolate policy without a shared store', async () => {
  __resetCoreNonces();
  const path = '/v1/world/layers/cctv';
  const { request } = signed(null, { path, method: 'GET' });
  assert.equal(await verifyCoreSignature({ request, env: baseEnv, path, bodyBytes: new Uint8Array(0) }), true);
  await assert.rejects(verifyCoreSignature({ request, env: baseEnv, path, bodyBytes: new Uint8Array(0) }), /already used/);
});

test('the Supabase replay store claims atomically through a unique insert', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1 ? new Response(null, { status: 201 }) : new Response('{"code":"23505"}', { status: 409 });
  };
  const store = createSupabaseReplayStore(baseEnv, { fetchImpl });
  assert.equal(await store.claim('nonce-1', Date.now() + 60_000), true);
  assert.equal(await store.claim('nonce-1', Date.now() + 60_000), false);
  assert.match(calls[0].url, /\/rest\/v1\/core_signed_nonces$/);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(JSON.parse(calls[0].options.body).nonce, 'nonce-1');
  await assert.rejects(createSupabaseReplayStore(baseEnv, { fetchImpl: async () => new Response('', { status: 500 }) }).claim('n', 1), /unavailable/);
});

test('CORE_REPLAY_STORE=supabase resolves the shared store from the environment', async () => {
  __resetCoreNonces();
  const { request, body } = signed({ method: 'tools/call' });
  const original = globalThis.fetch;
  let inserts = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/rest/v1/core_signed_nonces') && options.method === 'POST') {
      inserts += 1;
      return inserts === 1 ? new Response(null, { status: 201 }) : new Response('', { status: 409 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  try {
    const env = { ...baseEnv, CORE_REPLAY_STORE: 'supabase' };
    assert.equal(await verifyIn('c', request, body, env), true);
    await assert.rejects(verifyIn('d', request, body, env), /already used/);
    assert.equal(inserts, 2);
  } finally {
    globalThis.fetch = original;
  }
});

/* Idempotent reservation/submission in the media router. */
const ORG = '123e4567-e89b-42d3-a456-426614174000';
const USER = { id: '423e4567-e89b-42d3-a456-426614174333' };
const JOB = '523e4567-e89b-42d3-a456-426614174555';
const MODEL = { id: 't2i', provider: 'fal', provider_model_id: 'fal-ai/flux-2', capability: 'text-to-image', parameter_schema: {}, cost_hint: {}, enabled: true };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function plane({ existingJob = null } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    const method = options.method || 'GET';
    let body = null;
    try { body = options.body ? JSON.parse(String(options.body)) : null; } catch { body = String(options.body); }
    calls.push({ href, method, body });
    if (href.includes('/rest/v1/org_members?')) return json([{ org_id: ORG, role: 'owner' }]);
    if (href.includes('/rest/v1/control_role_capabilities?')) return json([{ role: 'owner', capability: 'media.generate', allowed: true }]);
    if (href.includes('/rest/v1/media_models?')) return json([MODEL]);
    /* The atomic claim (table: supabase/migrations/20261109194957_media_operation_claims_v1.sql;
       functions: supabase/pending/media_operation_claims_v2.sql): an existing
       job means the claim is already bound to it; otherwise this caller wins. */
    if (href.includes('/rest/v1/rpc/media_claim_operation_v2')) {
      return json(existingJob
        ? { outcome: 'existing', claim: { org_id: ORG, operation_id: body.p_operation_id, fingerprint: body.p_fingerprint, state: 'bound', job_id: existingJob.id } }
        : { outcome: 'won', claim: { org_id: ORG, operation_id: body.p_operation_id, state: 'claimed' } });
    }
    if (href.includes('/rest/v1/rpc/media_bind_operation_v2') || href.includes('/rest/v1/rpc/media_fail_operation_v2')) return json({ state: 'bound' });
    if (href.includes('/rest/v1/media_jobs?') && method === 'GET') return json(existingJob ? [existingJob] : []);
    if (href.includes('/rest/v1/rpc/media_create_budgeted_job_v2')) return json([{ id: JOB, org_id: ORG }]);
    if (href.includes('/rest/v1/rpc/media_release_cost_reservation')) return json(null);
    if (href.includes('/rest/v1/media_jobs?') && method === 'PATCH') return json([{ id: JOB, org_id: ORG, status: body?.status }]);
    if (href.includes('/rest/v1/control_observability_events')) return new Response(null, { status: 201 });
    throw new Error(`unexpected fetch ${method} ${href}`);
  };
  __resetCapabilityCache();
  return { calls, restore() { globalThis.fetch = original; __resetCapabilityCache(); } };
}

function generateRequest(body) {
  return new Request(`https://api.mccluster.org/v1/media/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
}

test('a repeated operation id returns the existing job and reserves nothing', async () => {
  const existing = { id: JOB, org_id: ORG, status: 'queued', routing: { operation_id: 'op-1' } };
  const be = plane({ existingJob: existing });
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role', FAL_KEY: 'k' };
  try {
    const job = await createGeneration(generateRequest({ org_id: ORG, model_id: 't2i', prompt: 'a lighthouse', operation_id: 'op-1' }), env, USER);
    assert.equal(job.id, JOB);
    const claim = be.calls.find((c) => c.href.includes('/rest/v1/rpc/media_claim_operation_v2'));
    assert.ok(claim, 'the router claimed the operation first');
    assert.equal(claim.body.p_operation_id, 'op-1');
    assert.equal(be.calls.some((c) => c.href.includes('media_create_budgeted_job_v2')), false, 'no second reservation');
  } finally {
    be.restore();
  }
});

test('a first operation records its id on the reservation routing', async () => {
  const be = plane();
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role', FAL_KEY: 'k' };
  try {
    /* This plane does not answer the provider host, so the one submission
       fails after the reservation; the reservation call itself is what this
       test reads. */
    await createGeneration(generateRequest({ org_id: ORG, model_id: 't2i', prompt: 'a lighthouse', operation_id: 'op-2' }), env, USER).catch(() => null);
    const reserve = be.calls.find((c) => c.href.includes('media_create_budgeted_job_v2'));
    assert.ok(reserve);
    assert.equal(reserve.body.p_routing.operation_id, 'op-2');
  } finally {
    be.restore();
  }
});

test('a malformed operation id is refused before any reservation', async () => {
  const be = plane();
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service-role', FAL_KEY: 'k' };
  try {
    await assert.rejects(
      createGeneration(generateRequest({ org_id: ORG, model_id: 't2i', prompt: 'x', operation_id: 'bad id/with spaces' }), env, USER),
      (error) => error.status === 400 && /operation_id/.test(error.message)
    );
    assert.equal(be.calls.some((c) => c.href.includes('media_create_budgeted_job_v2')), false);
  } finally {
    be.restore();
  }
});

/* ============ C5 through the real route: a Core-signed media.generate ============
   POST /v1/media/mcp verifies Core's signature (entry.js), and the MCP layer
   (src/media/mcp.js operationIdForCall) gives the router an operation id:
   Core's own when the call carries one, otherwise core:<signed nonce>. Driven
   through entry.fetch with envelopes signed the way core/src/broker-edge-auth.mjs
   signs them, against the synthetic plane of ./helpers/media-plane.mjs (the
   claim, the reservation, the shared nonce table and the provider's queue).
   Closeout 2026-11-10: before these tests, making operationIdForCall drop the
   derived id, or drop Core's explicit id as well, left the Worker suite green. */
const GENERATE = { org_id: media.ORG, model_id: 't2i', prompt: 'a lighthouse at dusk' };
const signedEnv = (store) => ({ ...media.env, CORE_EDGE_SIGNING_KEY: SECRET, CORE_REPLAY_STORE: store });

/* One signed envelope; deliver() builds a fresh Request from the SAME headers
   and body, i.e. a replay of what Core sent once. */
function mcpEnvelope(args, id = 1) {
  const body = JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'media.generate', arguments: args } });
  const headers = signCoreRequest({ secret: SECRET, method: 'POST', path: PATH, bodyBytes: Buffer.from(body) });
  return { nonce: headers['x-mccluster-nonce'], deliver: () => new Request(`https://api.mccluster.org${PATH}`, { method: 'POST', headers, body }) };
}

async function viaEntry(request, env) {
  const pending = [];
  const response = await entry.fetch(request, env, { waitUntil(promise) { pending.push(promise); } });
  await Promise.all(pending);
  return { status: response.status, body: await response.json() };
}

/* The provider's queue: every POST is a paid submission. */
function providerQueue() {
  const queue = { posts: 0 };
  queue.answer = async () => { queue.posts += 1; return media.json({ request_id: `fal-request-${queue.posts}` }); };
  return queue;
}

const toolJob = (answer) => JSON.parse(answer.body.result.content[0].text).job;
function assertToolResult(answer) {
  assert.equal(answer.status, 200);
  assert.equal(answer.body.result?.isError, undefined, JSON.stringify(answer.body).slice(0, 400));
}

test('C5 a Core-signed media.generate without an operation id is keyed core:<nonce>: one envelope reaching two isolates reserves and submits once', async () => {
  const queue = providerQueue();
  const st = media.plane({ falQueue: queue.answer });
  try {
    /* 'isolate' keeps no shared nonce: the second isolate's gate lets the replay through, so the claim is what stops it */
    const env = signedEnv('isolate');
    const envelope = mcpEnvelope(GENERATE);
    __resetCoreNonces();
    const first = await viaEntry(envelope.deliver(), env);
    __resetCoreNonces(); // a second isolate: its memory cache is empty
    const second = await viaEntry(envelope.deliver(), env);
    assertToolResult(first);
    assertToolResult(second);
    assert.deepEqual([...st.claims.keys()], [`${media.ORG}:core:${envelope.nonce}`], 'the claim is keyed by the signed nonce');
    assert.equal(st.reserves, 1, 'one reservation for both deliveries');
    assert.equal(queue.posts, 1, 'one provider submission');
    assert.equal(toolJob(second).id, toolJob(first).id, 'both deliveries answer with the one job');
    assert.equal(st.onlyJob().routing.operation_id, `core:${envelope.nonce}`);
  } finally { st.restore(); }
});

test('C5 Core\'s own operation_id passes the MCP layer untouched and wins over the nonce: two fresh envelopes of one logical call reserve and submit once', async () => {
  const queue = providerQueue();
  const st = media.plane({ falQueue: queue.answer });
  try {
    const env = signedEnv('supabase');
    /* the id Core sends for one step of one job, built the way Core builds it */
    const operationId = scopedOperationId('8d6f1f0e-5a51-4b39-9a0c-2f1b8c7d9e10', 'image');
    const sent = mcpEnvelope({ ...GENERATE, operation_id: operationId }, 1);
    const retried = mcpEnvelope({ ...GENERATE, operation_id: operationId }, 2);
    assert.notEqual(retried.nonce, sent.nonce, 'Core signs a retry afresh');
    __resetCoreNonces();
    const first = await viaEntry(sent.deliver(), env);
    const second = await viaEntry(retried.deliver(), env);
    assertToolResult(first);
    assertToolResult(second);
    assert.equal(st.nonces.size, 2, 'both envelopes passed the shared replay store');
    assert.deepEqual([...st.claims.keys()], [`${media.ORG}:${operationId}`], 'the claim is keyed by Core\'s id, never by either nonce');
    assert.equal(st.reserves, 1, 'one reservation across the retried logical call');
    assert.equal(queue.posts, 1, 'one provider submission');
    assert.equal(toolJob(second).id, toolJob(first).id);
    assert.equal(st.onlyJob().routing.operation_id, operationId);
  } finally { st.restore(); }
});

test('C5 with CORE_REPLAY_STORE=supabase (the deployed setting) a replayed envelope is refused 409 at the gate and never reaches the router', async () => {
  const queue = providerQueue();
  const st = media.plane({ falQueue: queue.answer });
  try {
    const env = signedEnv('supabase');
    const envelope = mcpEnvelope(GENERATE);
    __resetCoreNonces();
    assertToolResult(await viaEntry(envelope.deliver(), env));
    const before = st.calls.length;
    __resetCoreNonces(); // a second isolate: only the shared store remembers
    const replay = await viaEntry(envelope.deliver(), env);
    assert.equal(replay.status, 409);
    const reached = st.calls.slice(before)
      .filter((call) => !call.url.includes('/rest/v1/control_observability_events'))
      .map((call) => `${call.method} ${new URL(call.url).pathname}`);
    assert.deepEqual(reached, ['POST /rest/v1/core_signed_nonces'], 'refused at the shared nonce, before the house owner, the claim or the reservation');
    assert.equal(st.nonces.size, 1);
    assert.equal(st.reserves, 1);
    assert.equal(queue.posts, 1);
  } finally { st.restore(); }
});

test('C5 before media_operation_claims_v2.sql is applied every Core-signed generation is refused over MCP (HTTP 200, isError) and reserves nothing; a session call without an id is not', async () => {
  const queue = providerQueue();
  const st = media.plane({ falQueue: queue.answer, claimsAvailable: false, sessions: { 'owner-session': { id: media.USER.id } } });
  try {
    const env = signedEnv('supabase');
    __resetCoreNonces();
    const explicit = await viaEntry(mcpEnvelope({ ...GENERATE, operation_id: scopedOperationId('job-without-claims', 'image') }, 3).deliver(), env);
    const derived = await viaEntry(mcpEnvelope(GENERATE, 4).deliver(), env);
    for (const answer of [explicit, derived]) {
      assert.equal(answer.status, 200, 'MCP carries the router\'s 503 as a tool error');
      assert.equal(answer.body.result.isError, true);
      assert.equal(answer.body.result.content[0].text, 'Paid operation claims are unavailable; nothing was reserved');
    }
    assert.equal(st.claimCalls, 2, 'both signed calls carried an operation id to the claim');
    assert.equal(st.reserves, 0);
    assert.equal(queue.posts, 0);
    /* the owner's own session (not Core's signature) calling without an operation id never touches the claim */
    const body = JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'media.generate', arguments: GENERATE } });
    const member = await viaEntry(new Request(`https://api.mccluster.org${PATH}`, {
      method: 'POST', headers: { authorization: 'Bearer owner-session', 'content-type': 'application/json' }, body
    }), env);
    assertToolResult(member);
    assert.equal(st.claimCalls, 2);
    assert.equal(st.reserves, 1);
    assert.equal(queue.posts, 1);
  } finally { st.restore(); }
});
