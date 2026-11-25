/* Audit C5 follow-up (review packet 2026-11-09): media.compare derives one
   child operation id per model from the caller's operation id. The first
   cut built `${parent}:${model}` and then sliced the JOIN to 128 characters,
   so a 128-character parent (which the router accepts) gave every model the
   parent itself as its child id; under the applied claim RPC the first model
   won and every other model was refused as operation_payload_mismatch, with
   the survivor chosen by RPC arrival order. These tests pin the replacement:
   short ids are byte-identical to before, long ones shorten the PARENT and
   hash the full join so two models can never share a child id.
   Synthetic plane only; no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { childOperationId, createBakeoff, fnv1a32Hex } from '../src/media/orchestrator.js';
import { __resetCapabilityCache } from '../src/lib/capabilities.js';

/* router.js OPERATION_ID, copied so a drift in either place fails here */
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const P128 = 'p'.repeat(128);
const valid = (id) => { assert.equal(typeof id, 'string'); assert.ok(id.length <= 128, `${id.length} > 128`); assert.match(id, OPERATION_ID); };

test('128-character parent: two models get two distinct, rule-valid child ids that still end in the model', () => {
  const a = childOperationId(P128, 'fal-ai/flux-2');
  const b = childOperationId(P128, 'fal-ai/kling');
  valid(a); valid(b);
  assert.notEqual(a, b);
  assert.equal(a.length, 128); assert.equal(b.length, 128);
  assert.ok(a.endsWith(':fal-ai_flux-2')); assert.ok(b.endsWith(':fal-ai_kling'));
  assert.equal(a, `${'p'.repeat(105)}:e741d1da:fal-ai_flux-2`);
  assert.equal(b, `${'p'.repeat(106)}:580441f7:fal-ai_kling`);
});

test('models sharing a prefix under a long parent no longer collapse to one id', () => {
  const parent = 'q'.repeat(120);
  const a = childOperationId(parent, 'fal-ai/flux-2');
  const b = childOperationId(parent, 'fal-ai/flux-2-pro');
  valid(a); valid(b);
  assert.notEqual(a, b);
  /* the old scheme cut both to `${parent}:fal-ai_` */
  assert.notEqual(a, `${parent}:fal-ai_`); assert.notEqual(b, `${parent}:fal-ai_`);
});

test('short parent: exactly parent + ":" + sanitised model, unchanged from today', () => {
  assert.equal(childOperationId('compare-7', 't2i'), 'compare-7:t2i');
  assert.equal(childOperationId('compare-7', 'alt/model'), 'compare-7:alt_model');
  assert.equal(childOperationId('core:3f2b6c2e-1c1e-4d6a-9a7b-2b1c9e0d1f22', 'fal-ai/flux-2'), 'core:3f2b6c2e-1c1e-4d6a-9a7b-2b1c9e0d1f22:fal-ai_flux-2');
});

test('boundary: a join of exactly 128 characters is kept verbatim; one more character switches to the hashed form', () => {
  const parent = 'r'.repeat(124);
  const fits = childOperationId(parent, 't2i');
  assert.equal(fits, `${parent}:t2i`); assert.equal(fits.length, 128);
  const over = childOperationId(parent, 't2i2');
  valid(over);
  assert.equal(over.length, 128);
  assert.ok(over.endsWith(':t2i2'));
  assert.notEqual(over, `${parent}:t2i2`.slice(0, 128));
  /* tail = ':' + 8 hex + ':' + 't2i2' = 14 characters, so the parent keeps 114 */
  assert.equal(over, `${'r'.repeat(114)}:${fnv1a32Hex(`${parent}:t2i2`)}:t2i2`);
});

test('disallowed characters in the model id are sanitised to "_" in both forms', () => {
  assert.equal(childOperationId('op', 'fal-ai/flux 2@x:y'), 'op:fal-ai_flux_2_x_y');
  const long = childOperationId(P128, 'fal-ai/flux 2@x:y');
  valid(long);
  assert.ok(long.endsWith(':fal-ai_flux_2_x_y'));
});

test('deterministic: the same (parent, model) always yields the same id; FNV-1a matches the published vectors', () => {
  assert.equal(childOperationId(P128, 'fal-ai/flux-2'), childOperationId(P128, 'fal-ai/flux-2'));
  assert.equal(childOperationId('compare-7', 'alt/model'), childOperationId('compare-7', 'alt/model'));
  assert.equal(fnv1a32Hex(''), '811c9dc5');
  assert.equal(fnv1a32Hex('a'), 'e40c292c');
});

test('five models (the bakeoff maximum) under a 128-character parent produce five distinct ids', () => {
  const ids = ['a/1', 'a/2', 'a/3', 'a/4', 'a/5'].map((m) => childOperationId(P128, m));
  ids.forEach(valid);
  assert.equal(new Set(ids).size, 5);
});

test('two long parents that share a 128-character prefix do not share child ids', () => {
  /* the router refuses >128-character parents, so this is defensive only */
  const a = childOperationId(`${P128}A`, 't2i');
  const b = childOperationId(`${P128}B`, 't2i');
  valid(a); valid(b);
  assert.notEqual(a, b);
});

test('a pathological model id is capped so the id stays valid and the parent keeps a prefix', () => {
  const id = childOperationId(P128, 'm'.repeat(150));
  valid(id);
  assert.equal(id.length, 128);
  assert.ok(id.startsWith(`${'p'.repeat(18)}:`));
});

test('no parent: no child id, so a one-off bakeoff still sends no operation_id', () => {
  assert.equal(childOperationId(null, 't2i'), undefined);
  assert.equal(childOperationId(undefined, 't2i'), undefined);
  assert.equal(childOperationId('', 't2i'), undefined);
});

/* ---- plane-level: createBakeoff against a stubbed Supabase REST/RPC plane ---- */

const ORG = '123e4567-e89b-42d3-a456-426614174000';
const USER = { id: '423e4567-e89b-42d3-a456-426614174333' };
const MODEL = { id: 't2i', provider: 'fal', provider_model_id: 'fal-ai/flux-2', capability: 'text-to-image', parameter_schema: {}, cost_hint: {}, enabled: true };
const env = { SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', FAL_KEY: 'synthetic' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/* A synthetic plane with the claim semantics this suite needs (first insert
   wins, fingerprint mismatch refused as P0001 operation_payload_mismatch; the
   router calls the v2 functions of supabase/pending/media_operation_claims_v2.sql,
   whose full semantics are in ./helpers/media-plane.mjs), plus a catalog that
   answers any model id so a two-model compare resolves. */
function plane() {
  const state = { claims: new Map(), jobs: new Map(), reserves: 0, releases: 0, claimCalls: 0, patches: [] };
  let seq = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url), method = options.method || 'GET';
    const body = options.body ? JSON.parse(String(options.body)) : null;
    if (u.includes('/org_members?')) return json([{ org_id: ORG, role: 'owner' }]);
    if (u.includes('/control_role_capabilities?')) return json([{ role: 'owner', capability: 'media.generate', allowed: true }]);
    if (u.includes('/media_models?')) {
      const id = decodeURIComponent((u.match(/id=eq\.([^&]+)/) || [])[1] || '');
      return json([{ ...MODEL, id, provider_model_id: `fal-ai/${id}` }]);
    }
    if (u.includes('/rpc/media_claim_operation_v2')) {
      state.claimCalls += 1;
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
    if (u.includes('/rpc/media_bind_operation_v2')) {
      const row = state.claims.get(`${body.p_org_id}:${body.p_operation_id}`);
      if (!row || row.state !== 'claimed') return new Response('{"code":"P0001","message":"operation_not_claimed"}', { status: 400 });
      Object.assign(row, { state: 'bound', job_id: body.p_job_id });
      return json(row);
    }
    if (u.includes('/rpc/media_fail_operation_v2')) {
      const row = state.claims.get(`${body.p_org_id}:${body.p_operation_id}`);
      if (!row || row.state !== 'claimed') return new Response('{"code":"P0001","message":"operation_not_claimed"}', { status: 400 });
      Object.assign(row, { state: 'failed', failure: body.p_failure });
      return json(row);
    }
    if (u.includes('/media_jobs?') && method === 'GET') {
      const id = decodeURIComponent((u.match(/id=eq\.([^&]+)/) || [])[1] || '');
      const byOp = decodeURIComponent((u.match(/operation_id=eq\.([^&]+)/) || [])[1] || '');
      return json([...state.jobs.values()].filter((j) => (id ? j.id === id : true) && (byOp ? j.routing?.operation_id === byOp : true)));
    }
    if (u.includes('/rpc/media_create_budgeted_job_v2')) {
      state.reserves += 1;
      seq += 1;
      const job = { id: `523e4567-e89b-42d3-a456-42661417400${seq}`, org_id: ORG, status: 'queued', routing: body.p_routing };
      state.jobs.set(job.id, job);
      return json([job]);
    }
    if (u.includes('/rpc/media_release_cost_reservation')) { state.releases += 1; return json(null); }
    if (u.includes('/media_jobs?') && method === 'PATCH') {
      state.patches.push(body);
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

const compare = (body) => createBakeoff(new Request('https://api.fixture.invalid/v1/media/compare', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
}), env, USER);

test('createBakeoff: two models under a 128-character parent claim two rows and reserve two jobs, never a payload-mismatch collision', async () => {
  const st = plane();
  try {
    const body = { org_id: ORG, model_ids: ['t2i', 'alt/model'], prompt: 'p', operation_id: P128 };
    /* createBakeoff calls createGeneration without deps; this plane does not
       answer the provider host, so each lane's one request fails with no
       answer and the claim and reservation evidence is what we read. */
    const first = await compare(body).catch((e) => e);
    const failures = first instanceof Error ? (first.detail || []) : first.failures;
    for (const f of failures) assert.doesNotMatch(String(f.error), /already used with a different request|operation_payload_mismatch|operation_pending/, `model ${f.model_id} collided`);

    assert.equal(st.claims.size, 2, 'one claim row per model');
    assert.equal(st.reserves, 2, 'one reservation per model');
    const ids = [...st.claims.values()].map((row) => row.operation_id).sort();
    assert.equal(new Set(ids).size, 2);
    for (const id of ids) {
      valid(id);
      assert.match(id, new RegExp(`^p{1,128}(:[0-9a-f]{8})?:(t2i|alt_model)$`));
    }
    assert.deepEqual(ids, [childOperationId(P128, 'alt/model'), childOperationId(P128, 't2i')].sort());
    assert.deepEqual([...st.jobs.values()].map((j) => j.routing?.operation_id).sort(), ids, 'each job is bound to its own child id');

    /* a retried compare resolves each lane to the job it already made */
    const reservesAfterFirst = st.reserves, claimsAfterFirst = st.claimCalls;
    await compare(body).catch(() => null);
    assert.equal(st.reserves, reservesAfterFirst, 'the retry reserved nothing new');
    assert.equal(st.claimCalls, claimsAfterFirst + 2, 'the retry consulted the claim for both lanes');
    assert.equal(st.claims.size, 2);
  } finally { st.restore(); }
});

test('createBakeoff: a parent that breaks the router rule is a 400 on the compare before any claim or reservation', async () => {
  const st = plane();
  try {
    for (const operation_id of ['bad/parent', 'x'.repeat(129), ':leading-colon']) {
      await assert.rejects(compare({ org_id: ORG, model_ids: ['t2i', 'alt/model'], prompt: 'p', operation_id }), (e) => e.status === 400 && /operation_id/.test(e.message));
    }
    assert.equal(st.claimCalls, 0);
    assert.equal(st.reserves, 0);
  } finally { st.restore(); }
});

test('createBakeoff: without a parent the children carry no operation id and the claim table is never consulted', async () => {
  const st = plane();
  try {
    await compare({ org_id: ORG, model_ids: ['t2i', 'alt/model'], prompt: 'p' }).catch(() => null);
    assert.equal(st.claimCalls, 0);
    assert.equal(st.reserves, 2);
    for (const job of st.jobs.values()) assert.equal(job.routing?.operation_id ?? null, null, 'router records an absent id as null');
  } finally { st.restore(); }
});
