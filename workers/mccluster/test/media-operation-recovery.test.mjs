/* Recovery for paid media operations (audit 2026-11-09, finding C5, recovery
   lane). media-operation-claims.test.mjs pins the atomic claim and the
   uncertain submit; this suite pins what happens to everything those paths
   can leave behind, and that none of it can spend twice or release a
   reservation the provider may still bill:

   - a claim whose winner stopped: takeover after the window, repair to the
     job it reserved, and the never-sent job submitted exactly once;
   - what a failed reservation call means for the claim (caller refused,
     duplicate, definite, unknown);
   - the compare-and-set submit: one marker, one provider request, and every
     later write conditional on the state it expects;
   - the provider webhook: the authenticated hint, replays, late answers;
   - the member's refresh and the cron sweep;
   - the operator surface (REST and MCP), its authorization and its audit.

   The filter strings are written out here on purpose: a mistyped constant in
   the router fails these tests instead of silently matching every row.
   PostgREST behaviour the router relies on is modelled by
   ./helpers/media-plane.mjs (a PATCH that matches nothing answers []; JSON
   path filters apply to PATCH); it was not re-verified against the live plane
   for this change. The database functions themselves are proven on PostgreSQL
   16 by scripts/test-media-recovery-db.sh. Synthetic plane and provider only;
   no network. */
import './support/offline-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

import {
  classifyReservationError, createGeneration, getGeneration, handleFalWebhook, operationFingerprint,
  applyProviderStatus, pollProviderStatus, reconcileFalJobCost, webhookUrlFor
} from '../src/media/router.js';
import { reconcileJob, sweepMediaRecovery, verifyWebhookHint } from '../src/media/recovery.js';
import { handleMediaMcp } from '../src/media/mcp.js';
import { verifyFalWebhook } from '../src/media/fal.js';
import { __resetCoreNonces } from '../src/media/core-signature.js';
import { signCoreRequest } from '../../../core/src/broker-edge-auth.mjs';
import {
  ORG, OTHER_ORG, USER, MEMBER, MODEL, WINDOW_MS, V2_FUNCTIONS, env, json, matchesFilter, plane, provider, traced
} from './helpers/media-plane.mjs';

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

/* The router's compare-and-set filters, as literals. */
const CAS_SUBMIT = 'status=eq.queued&routing->>reservation_state=eq.reserved&provider_request_id=is.null&provider_status->>outcome=is.null';
const CAS_RECORD = 'provider_request_id=is.null&status=in.(queued,reconciling)';
const CAS_UNCERTAIN = 'status=eq.queued&provider_request_id=is.null&provider_status->>outcome=eq.submitting';
const CAS_REFRESH = 'status=not.in.(completed,failed,cancelled)';
const CAS_FAIL_PRESUBMIT = 'status=eq.queued&provider_request_id=is.null';
const CAS_HINT_ATTACH = 'provider=eq.fal&provider_request_id=is.null&status=in.(queued,reconciling,failed)&routing->>submit_protocol=eq.cas-v1&routing->>reservation_state=neq.settled';

const OPERATION = 'same-stable-operation';
const KEY = `${ORG}:${OPERATION}`;
const PAYLOAD = { org_id: ORG, model_id: 't2i', prompt: 'synthetic lighthouse' };
const ORIGIN = 'https://api.fixture.invalid';
const hintEnv = { ...env, MEDIA_WEBHOOK_HINT_SECRET: 'synthetic-webhook-hint-secret-0123456789' };
const billingEnv = { ...hintEnv, FAL_ADMIN_KEY: 'synthetic-admin' };

const req = (body) => new Request(`${ORIGIN}/v1/media/generate`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});
const generate = (extra = {}) => req({ ...PAYLOAD, operation_id: OPERATION, ...extra });
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const MINUTE = 60 * 1000;
const fingerprint = () => operationFingerprint(PAYLOAD, MODEL);

async function seedClaim(st, fields = {}) {
  const row = { org_id: ORG, operation_id: OPERATION, fingerprint: await fingerprint(), actor_id: USER.id, state: 'claimed', job_id: null, attempt: 1, history: [], claimed_at: ago(MINUTE), ...fields };
  st.claims.set(KEY, row);
  return row;
}

/* A job as the router reserves one: cas-v1, queued, reserved, never marked. */
function seedJob(st, fields = {}) {
  const { routing = {}, ...rest } = fields;
  const job = st.createJob({
    p_org_id: ORG, p_created_by: USER.id, p_provider: 'fal', p_provider_model_id: MODEL.provider_model_id, p_capability: MODEL.capability,
    p_prompt: PAYLOAD.prompt, p_input: { prompt: PAYLOAD.prompt },
    p_routing: { operation_id: OPERATION, submit_protocol: 'cas-v1', requested_model_id: MODEL.id, ...routing }
  });
  for (const [key, value] of Object.entries(job.routing)) if (value === undefined) delete job.routing[key];
  return Object.assign(job, rest);
}

const webhookRequest = (path = '/v1/media/webhooks/fal') => new Request(`${ORIGIN}${path}`, { method: 'POST', body: '{}' });
const verified = (payload) => ({ verify: async () => payload });
async function hintFor(jobId, hintingEnv = hintEnv) {
  const url = await webhookUrlFor(hintingEnv, ORIGIN, jobId);
  const [id, token] = url.split('/').slice(-2);
  assert.equal(id, jobId);
  return { jobId: id, token };
}
const patchFilters = (st) => st.patchLog.map((entry) => entry.filter);

/* ============================ the claim: takeover ============================ */

test('S1 a claim whose winner stopped before reserving: pending with expires_at inside the window, refused for another payload, taken over after it', async () => {
  const st = plane();
  const fal = provider();
  try {
    const claimedAt = Date.now() - 5 * MINUTE;
    const row = await seedClaim(st, { claimed_at: new Date(claimedAt).toISOString() });
    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 409 && e.reason === 'operation_pending'
      && e.detail.operation_id === OPERATION && e.detail.attempt === 1 && e.detail.claimed_at === row.claimed_at
      && e.detail.expires_at === new Date(claimedAt + WINDOW_MS).toISOString());
    assert.equal(st.reserves, 0);

    row.claimed_at = ago(16 * MINUTE);
    /* a different payload never takes over, however old the claim is */
    await assert.rejects(createGeneration(generate({ prompt: 'a different prompt' }), env, USER, { submit: fal.submit }), (e) => e.status === 409 && e.reason === 'operation_payload_mismatch');
    assert.equal(row.attempt, 1);
    assert.equal(st.reserves, 0);

    const job = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(row.attempt, 2, 'the same fingerprint took the claim over');
    assert.equal(row.history.length, 1);
    assert.equal(row.history[0].reason, 'expired_without_job');
    assert.equal(row.state, 'bound');
    assert.equal(row.job_id, job.id);
    assert.equal(st.reserves, 1, 'reserved once');
    assert.equal(fal.submits, 1, 'submitted once');
    assert.equal(job.provider_request_id, 'accepted-1');
    assert.equal(job.routing.submit_protocol, 'cas-v1');
  } finally { st.restore(); }
});

test('S1 a claim bound to a job row that is gone is pending, then taken over like a claim that never bound', async () => {
  const st = plane();
  const fal = provider();
  try {
    const boundAt = Date.now() - 5 * MINUTE;
    const row = await seedClaim(st, { state: 'bound', job_id: null, claimed_at: ago(40 * MINUTE), bound_at: new Date(boundAt).toISOString() });
    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }),
      (e) => e.status === 409 && e.reason === 'operation_pending' && e.detail.expires_at === new Date(boundAt + WINDOW_MS).toISOString());
    row.bound_at = ago(16 * MINUTE);
    const job = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(row.attempt, 2);
    assert.equal(row.history[0].reason, 'bound_job_missing');
    assert.equal(row.job_id, job.id);
    assert.equal(st.reserves, 1);
    assert.equal(fal.submits, 1);
  } finally { st.restore(); }
});

test('S1 the takeover winner fails the claim with its own attempt; a refused fail is an event, never an error of its own', async () => {
  const st = plane({ reserveFails: true });
  try {
    const row = await seedClaim(st, { claimed_at: ago(16 * MINUTE) });
    await assert.rejects(createGeneration(generate(), env, USER), /exceeds budget/);
    assert.equal(st.rpcCalls('media_fail_operation_v2')[0].body.p_attempt, 2, 'the attempt the takeover returned');
    assert.equal(row.state, 'failed');
  } finally { st.restore(); }
  /* the fail is refused (superseded attempt): the caller still gets its own refusal */
  const again = plane({
    reserveFails: true,
    intercept: ({ url }) => (url.endsWith('/rpc/media_fail_operation_v2') ? json({ code: 'P0001', message: 'operation_attempt_superseded' }, 400) : undefined)
  });
  try {
    await traced(() => assert.rejects(createGeneration(generate(), env, USER), (e) => e.status === 422 && /exceeds budget/.test(e.message)));
    const event = again.event('media.operation.fail_refused');
    assert.ok(event);
    assert.equal(event.level, 'warn');
    assert.equal(event.detail.reason, 'operation_attempt_superseded');
    assert.equal(again.claims.get(KEY).state, 'claimed');
  } finally { again.restore(); }
});

/* ==================== what a failed reservation call means ==================== */

test('B2 reservation errors are classified: caller refused, duplicate operation, definite, unknown', () => {
  const pg = (code, message = 'x', status = 400, details = null) => ({ status, detail: { code, message, details } });
  for (const code of ['22023', '23514', 'P0001', '23502', '42883']) assert.equal(classifyReservationError(pg(code)), 'definite', code);
  assert.equal(classifyReservationError(pg('42501', 'Organization owner access is required', 403)), 'caller_refused');
  assert.equal(classifyReservationError({ status: 403, detail: { message: 'forbidden' } }), 'caller_refused', 'HTTP 403 without a code');
  assert.equal(classifyReservationError(pg('23505', 'duplicate key value violates unique constraint "media_jobs_org_operation_uidx"', 409)), 'duplicate_operation');
  assert.equal(classifyReservationError(pg('23505', 'duplicate key value violates unique constraint "some_other_key"', 409)), 'definite');
  assert.equal(classifyReservationError(new TypeError('fetch failed')), 'unknown');
  assert.equal(classifyReservationError({ status: 502, detail: 'bad gateway' }), 'unknown');
  assert.equal(classifyReservationError({ status: 504, detail: null }), 'unknown');
  assert.equal(classifyReservationError(pg('PGRST503', 'no connection to the database', 503)), 'unknown', 'PG prefixes are not SQLSTATE classes');
  assert.equal(classifyReservationError(pg('PGRST202', 'function missing', 404)), 'unknown');
});

for (const code of ['22023', '23514', 'P0001']) {
  test(`B2 a definite reservation refusal (${code}) fails the claim with the attempt that holds it`, async () => {
    const st = plane({ reserve: () => json({ code, message: 'refused by the database' }, 400) });
    try {
      await assert.rejects(createGeneration(generate(), env, USER), (e) => e.status === 422 && /refused by the database/.test(e.message));
      const fail = st.rpcCalls('media_fail_operation_v2');
      assert.equal(fail.length, 1);
      assert.equal(fail[0].body.p_attempt, 1);
      assert.equal(fail[0].body.p_failure.stage, 'preflight');
      assert.equal(st.claims.get(KEY).state, 'failed');
      assert.equal(st.jobs.size, 0);
    } finally { st.restore(); }
  });
}

test('B2 a caller the spend guard refuses (42501) never fails the claim: the owner is pending inside the window and takes it over after it', async () => {
  const st = plane({ spendGuard: true, roles: { [MEMBER.id]: 'staff' } });
  const fal = provider();
  try {
    await traced(() => assert.rejects(createGeneration(generate(), env, MEMBER, { submit: fal.submit }), (e) => e.status === 403 && /owner access is required/.test(e.message)));
    assert.equal(st.rpcCalls('media_fail_operation_v2').length, 0, 'no failure is recorded for a caller refusal');
    const row = st.claims.get(KEY);
    assert.equal(row.state, 'claimed');
    assert.equal(row.actor_id, MEMBER.id);
    const event = st.event('media.operation.caller_refused');
    assert.ok(event);
    assert.equal(event.actor_user_id, MEMBER.id);
    assert.equal(event.level, 'warn');

    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 409 && e.reason === 'operation_pending' && Boolean(e.detail.expires_at));
    row.claimed_at = ago(16 * MINUTE);
    const job = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(row.attempt, 2);
    assert.equal(row.actor_id, USER.id);
    assert.equal(job.provider_request_id, 'accepted-1');
    assert.equal(fal.submits, 1);
  } finally { st.restore(); }
});

test('B2 an HTTP 403 without a SQLSTATE is the same caller refusal', async () => {
  const st = plane({ reserve: () => json({ message: 'forbidden' }, 403) });
  try {
    await assert.rejects(createGeneration(generate(), env, USER), (e) => e.status === 403);
    assert.equal(st.rpcCalls('media_fail_operation_v2').length, 0);
    assert.equal(st.claims.get(KEY).state, 'claimed');
  } finally { st.restore(); }
});

test('B2 the unique index refusing a second reservation is a readback: bind, then the one compare-and-set submit', async () => {
  /* another attempt reserved the operation between this caller's claim and
     its own reservation call */
  const st = plane({
    reserve: (body, state, create) => {
      if (state.jobs.size) return undefined;
      create();
      return json({ code: '23505', message: 'duplicate key value violates unique constraint "media_jobs_org_operation_uidx"', details: 'Key (org_id, (routing ->> \'operation_id\'::text)) already exists.' }, 409);
    }
  });
  const fal = provider();
  try {
    const job = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(st.jobs.size, 1);
    assert.equal(st.rpcCalls('media_fail_operation_v2').length, 0);
    assert.equal(st.rpcCalls('media_bind_operation_v2').length, 1);
    assert.equal(st.claims.get(KEY).state, 'bound');
    assert.equal(st.claims.get(KEY).job_id, job.id);
    assert.equal(fal.submits, 1);
    assert.equal(job.provider_request_id, 'accepted-1');
    assert.equal(patchFilters(st)[0], CAS_SUBMIT);
  } finally { st.restore(); }
});

for (const [name, answer] of [
  ['a transport error', () => { throw new TypeError('fetch failed'); }],
  ['HTTP 502', () => json({ message: 'bad gateway' }, 502)],
  ['HTTP 504', () => json({ message: 'gateway timeout' }, 504)],
  ['PGRST503', () => json({ code: 'PGRST503', message: 'no connection to the database' }, 503)]
]) {
  test(`B2 an unknown reservation outcome (${name}) with no job is 503 reservation_outcome_unknown and never fails the claim`, async () => {
    const st = plane({ reserve: answer });
    const fal = provider();
    try {
      await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 503 && e.reason === 'reservation_outcome_unknown' && e.detail.operation_id === OPERATION);
      assert.equal(st.rpcCalls('media_fail_operation_v2').length, 0);
      assert.equal(st.claims.get(KEY).state, 'claimed');
      assert.equal(fal.submits, 0);
    } finally { st.restore(); }
  });
}

test('S1b/S6 the reservation committed but its answer was lost: no failure is recorded, the job is found, bound and submitted exactly once', async () => {
  const st = plane({ reserve: (body, state, create) => { create(); return json({ message: 'bad gateway' }, 502); } });
  const fal = provider();
  try {
    const job = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(st.rpcCalls('media_fail_operation_v2').length, 0, 'a reservation can never hide behind a failed claim');
    assert.equal(st.jobs.size, 1);
    assert.equal(st.claims.get(KEY).job_id, job.id);
    assert.equal(fal.submits, 1);
    assert.equal(job.provider_request_id, 'accepted-1');
    const again = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(again.id, job.id);
    assert.equal(fal.submits, 1);
    assert.equal(st.reserves, 1);
  } finally { st.restore(); }
});

test('S6 a definite-looking refusal over a reservation that exists: the fail is refused (operation_has_job), logged, and the retry repairs and submits', async () => {
  let first = true;
  const st = plane({
    reserve: (body, state, create) => {
      if (!first) return undefined;
      first = false;
      create();
      return json({ code: '23514', message: 'a check failed after the row was written' }, 400);
    }
  });
  const fal = provider();
  try {
    await traced(() => assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 422));
    assert.equal(st.claims.get(KEY).state, 'claimed', 'the claim is not failed over an existing job');
    assert.equal(st.event('media.operation.fail_refused').detail.reason, 'operation_has_job');
    assert.equal(fal.submits, 0);
    const job = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(st.claims.get(KEY).state, 'bound');
    assert.equal(st.jobs.size, 1);
    assert.equal(st.reserves, 1, 'the retry reserved nothing');
    assert.equal(fal.submits, 1);
    assert.equal(job.provider_request_id, 'accepted-1');
  } finally { st.restore(); }
});

/* =================== readback submits the never-sent job (B6) =================== */

test('S2 a winner that stopped between reserving and submitting: the retry repairs the claim and submits the job row, once', async () => {
  const st = plane();
  const fal = provider();
  try {
    const row = await seedClaim(st);
    const seeded = seedJob(st, { input: { prompt: PAYLOAD.prompt, seed: 7 }, provider_model_id: 'fal-ai/flux-2/from-the-row' });
    const job = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(job.id, seeded.id);
    assert.equal(st.reserves, 0, 'the retry reserved nothing');
    assert.equal(row.state, 'bound');
    assert.equal(row.resolution.kind, 'late_bind');
    assert.equal(fal.submits, 1);
    assert.equal(fal.calls[0].modelId, 'fal-ai/flux-2/from-the-row', 'the job row\'s model, not the request\'s');
    assert.deepEqual(fal.calls[0].input, { prompt: PAYLOAD.prompt, seed: 7 }, 'the job row\'s input, not the request body');
    assert.equal(job.provider_request_id, 'accepted-1');
    assert.equal(patchFilters(st)[0], CAS_SUBMIT);
    /* and the next retry only reads */
    const again = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(again.id, job.id);
    assert.equal(fal.submits, 1);
  } finally { st.restore(); }
});

test('S2 two concurrent retries of a never-sent job submit it once', async () => {
  /* both retries read the unmarked job before either writes its marker */
  let bothRead;
  const barrier = new Promise((resolve) => { bothRead = resolve; });
  const st = plane({ lookupGate: async (count) => { if (count >= 2) bothRead(); await barrier; } });
  const fal = provider();
  try {
    await seedClaim(st, { state: 'bound' });
    const seeded = seedJob(st);
    st.claims.get(KEY).job_id = seeded.id;
    const [a, b] = await Promise.all([
      createGeneration(generate(), env, USER, { submit: fal.submit }),
      createGeneration(generate(), env, USER, { submit: fal.submit })
    ]);
    assert.equal(fal.submits, 1, 'exactly one provider request');
    assert.equal(a.id, seeded.id);
    assert.equal(b.id, seeded.id);
    assert.equal(st.patchLog.filter((entry) => entry.filter === CAS_SUBMIT).length, 2, 'both tried the marker');
    assert.equal(st.patchLog.filter((entry) => entry.filter === CAS_SUBMIT && entry.matched === 1).length, 1, 'one held it');
    assert.equal(st.job(seeded.id).provider_request_id, 'accepted-1');
  } finally { st.restore(); }
});

test('S2 the original winner waking up late: its bind is already_bound, its marker loses, nothing is sent twice', async () => {
  let wake;
  const asleep = new Promise((resolve) => { wake = resolve; });
  const st = plane({
    /* the winner's reservation commits, then the winner stalls before its answer arrives */
    reserve: async (body, state, create) => { const job = create(); await asleep; return json(job); }
  });
  const fal = provider();
  try {
    const winner = createGeneration(generate(), env, USER, { submit: fal.submit });
    while (!st.jobs.size) await new Promise((resolve) => setImmediate(resolve));
    const retry = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(fal.submits, 1, 'the retry submitted the reserved job');
    assert.equal(retry.provider_request_id, 'accepted-1');
    wake();
    const late = await winner;
    assert.equal(late.id, retry.id);
    assert.equal(late.provider_request_id, 'accepted-1', 'the winner reads what the retry recorded');
    assert.equal(fal.submits, 1, 'no second provider request');
    assert.equal(st.reserves, 1);
    assert.equal(st.patches.some((body) => body.status === 'failed'), false, 'the late bind failed nothing');
    assert.equal(st.releaseCalls, 0);
  } finally { st.restore(); }
});

test('S2 a job from before cas-v1 is returned untouched: a missing marker proves nothing for it', async () => {
  const st = plane();
  const fal = provider();
  try {
    await seedClaim(st, { state: 'bound' });
    const legacy = seedJob(st, { routing: { submit_protocol: undefined } });
    st.claims.get(KEY).job_id = legacy.id;
    assert.equal(legacy.routing.submit_protocol, undefined);
    const job = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(job.id, legacy.id);
    assert.equal(fal.submits, 0);
    assert.equal(st.patchLog.length, 0);
  } finally { st.restore(); }
});

test('S2 a member who may not spend never submits on readback', async () => {
  const st = plane({ roles: { [MEMBER.id]: 'staff' } });
  const fal = provider();
  try {
    await seedClaim(st, { state: 'bound' });
    const seeded = seedJob(st);
    st.claims.get(KEY).job_id = seeded.id;
    const job = await createGeneration(generate(), env, MEMBER, { submit: fal.submit });
    assert.equal(job.id, seeded.id);
    assert.equal(fal.submits, 0);
    assert.equal(st.patchLog.length, 0);
    /* the owner's readback does */
    await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(fal.submits, 1);
  } finally { st.restore(); }
});

/* ======================= the compare-and-set submit (B1) ======================= */

test('B1 the marker is written before the provider is called, with the exact filter; the record is conditional too', async () => {
  const order = [];
  const st = plane({ beforePatch: (entry) => { order.push(`patch ${entry.filter}`); } });
  const fal = provider({ mode: (p) => { order.push('provider'); return { request_id: `accepted-${p.submits}` }; } });
  try {
    const job = await createGeneration(generate(), hintEnv, USER, { submit: fal.submit });
    assert.deepEqual(order, [`patch ${CAS_SUBMIT}`, 'provider', `patch ${CAS_RECORD}`]);
    const marker = st.patchLog[0].body.provider_status;
    assert.equal(marker.outcome, 'submitting');
    assert.equal(marker.delivery, 'webhook');
    assert.match(marker.attempt_id, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(Date.parse(marker.attempted_at)));
    assert.deepEqual(Object.keys(st.patchLog[0].body).sort(), ['provider_status', 'updated_at'], 'the marker changes nothing else');
    const record = st.patchLog[1].body;
    assert.equal(record.provider_request_id, 'accepted-1');
    assert.equal(record.status, 'queued');
    assert.equal(record.provider_status.outcome, 'submitted');
    assert.equal(record.provider_status.attempt_id, marker.attempt_id, 'the attempt stays on the row as evidence');
    assert.equal(job.provider_status.outcome, 'submitted');
    /* the provider is given the hinted webhook URL for this job */
    const hint = await hintFor(job.id);
    assert.equal(fal.calls[0].options.webhookUrl, `${ORIGIN}/v1/media/webhooks/fal/${job.id}/${hint.token}`);
    assert.match(hint.token, /^[A-Za-z0-9_-]{43}$/);
  } finally { st.restore(); }
});

test('B1 without the hint secret (or with a short one) the provider gets the plain webhook URL', async () => {
  for (const secretEnv of [env, { ...env, MEDIA_WEBHOOK_HINT_SECRET: 'too-short' }]) {
    const st = plane();
    const fal = provider();
    try {
      await createGeneration(generate(), secretEnv, USER, { submit: fal.submit });
      assert.equal(fal.calls[0].options.webhookUrl, `${ORIGIN}/v1/media/webhooks/fal`);
    } finally { st.restore(); }
  }
});

test('B1 a marker that matches nothing means someone else holds the job: no provider request, the job is returned', async () => {
  let taken = false;
  const st = plane({
    beforePatch: (entry, state) => {
      if (entry.filter !== CAS_SUBMIT || taken) return;
      taken = true;
      state.job(entry.id).provider_status = { outcome: 'submitting', attempt_id: 'another-caller' };
    }
  });
  const fal = provider();
  try {
    const job = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(fal.submits, 0);
    assert.equal(job.provider_status.attempt_id, 'another-caller');
    assert.equal(job.status, 'queued');
    assert.deepEqual(patchFilters(st), [CAS_SUBMIT], 'no other write');
    assert.equal(st.releaseCalls, 0);
  } finally { st.restore(); }
});

test('B1 a retry that read the job before an operator released it loses the marker: a released job is never submitted', async () => {
  const st = plane({
    beforePatch: (entry, state) => {
      if (entry.filter !== CAS_SUBMIT) return;
      /* the operator decision lands between the readback and the marker */
      Object.assign(state.job(entry.id), { status: 'failed', provider_status: { outcome: 'released_by_operator' } });
      state.job(entry.id).routing.reservation_state = 'released';
    }
  });
  const fal = provider();
  try {
    await seedClaim(st, { state: 'bound' });
    const seeded = seedJob(st);
    st.claims.get(KEY).job_id = seeded.id;
    const job = await createGeneration(generate(), env, USER, { submit: fal.submit });
    assert.equal(fal.submits, 0);
    assert.equal(job.status, 'failed');
    /* the filter itself, on the released row */
    assert.equal(matchesFilter(st.job(seeded.id), CAS_SUBMIT), false);
    assert.equal(matchesFilter({ ...seeded, status: 'queued', provider_status: {}, routing: { ...seeded.routing, reservation_state: 'reserved' } }, CAS_SUBMIT), true);
  } finally { st.restore(); }
});

test('B1 a marker write that fails sends nothing: the job is failed only where nobody is submitting it, released expecting failed, 503', async () => {
  const st = plane({ patchFails: (entry) => entry.filter === CAS_SUBMIT });
  const fal = provider();
  try {
    await traced(() => assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }),
      (e) => e.status === 503 && e.reason === 'submit_marker_unavailable' && e.detail.operation_id === OPERATION));
    assert.equal(fal.submits, 0, 'nothing was sent');
    const job = st.onlyJob();
    const filters = patchFilters(st);
    assert.equal(filters.length, 3);
    assert.equal(filters[0], CAS_SUBMIT);
    assert.match(filters[1], new RegExp(`^${CAS_FAIL_PRESUBMIT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}&provider_status->>attempt_id=eq\\.[0-9a-f-]{36}$`), 'first: only a job carrying this call\'s marker');
    assert.equal(filters[2], `${CAS_FAIL_PRESUBMIT}&provider_status->>outcome=is.null`, 'then: only a job nobody marked');
    assert.equal(st.patchLog[1].matched, 0);
    assert.equal(st.patchLog[2].matched, 1);
    assert.equal(job.status, 'failed');
    assert.equal(job.error.stage, 'preflight');
    const release = st.rpcCalls('media_release_cost_reservation_v2');
    assert.equal(release.length, 1);
    assert.deepEqual(release[0].body.p_expect_status, ['failed']);
    assert.equal(job.routing.reservation_state, 'released');
  } finally { st.restore(); }
});

test('B1 a marker that was applied although its write errored is this call\'s own: failed as not submitted, released', async () => {
  const st = plane({
    patchFails: (entry, state) => {
      if (entry.filter !== CAS_SUBMIT) return false;
      Object.assign(state.job(entry.id), entry.body); // committed; the answer was lost
      return true;
    }
  });
  const fal = provider();
  try {
    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 503 && e.reason === 'submit_marker_unavailable');
    assert.equal(fal.submits, 0);
    const job = st.onlyJob();
    assert.equal(st.patchLog[1].matched, 1, 'matched by this call\'s attempt id');
    assert.equal(st.patchLog.length, 2);
    assert.equal(job.status, 'failed');
    assert.equal(job.provider_status.outcome, 'not_submitted');
    assert.equal(job.routing.reservation_state, 'released');
  } finally { st.restore(); }
});

test('B1 a marker write that fails while another caller starts submitting: that job is left alone, nothing is released', async () => {
  let handedOver = false;
  const st = plane({
    patchFails: (entry) => entry.filter === CAS_SUBMIT,
    beforePatch: (entry, state) => {
      if (handedOver) return;
      handedOver = true;
      state.job(entry.id).provider_status = { outcome: 'submitting', attempt_id: 'another-caller' };
    }
  });
  const fal = provider();
  try {
    await traced(() => assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 503 && e.reason === 'submit_marker_unavailable'));
    const job = st.onlyJob();
    assert.equal(job.status, 'queued', 'the other caller\'s job is not failed');
    assert.equal(job.provider_status.attempt_id, 'another-caller');
    assert.equal(st.releaseCalls, 0, 'and its reservation is not released');
    assert.equal(job.routing.reservation_state, 'reserved');
    assert.ok(st.event('media.generation.release_skipped'));
  } finally { st.restore(); }
});

test('a bind that cannot be recorded fails the job only while nobody is submitting it, then releases', async () => {
  const bindDown = ({ url }) => (url.endsWith('/rpc/media_bind_operation_v2') ? json({ message: 'synthetic outage' }, 500) : undefined);
  const st = plane({ intercept: bindDown });
  const fal = provider();
  try {
    await assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 503 && e.reason === 'operation_claims_unavailable' && /reservation was released/.test(e.message));
    assert.equal(fal.submits, 0);
    assert.deepEqual(patchFilters(st), [`${CAS_FAIL_PRESUBMIT}&provider_status->>outcome=is.null`]);
    assert.equal(st.onlyJob().status, 'failed');
    assert.deepEqual(st.rpcCalls('media_release_cost_reservation_v2')[0].body.p_expect_status, ['failed']);
    assert.equal(st.onlyJob().routing.reservation_state, 'released');
  } finally { st.restore(); }
  /* a concurrent retry already marked it: the winner's failed bind must not fail or release that job */
  const racing = plane({
    intercept: bindDown,
    beforePatch: (entry, state) => { state.job(entry.id).provider_status = { outcome: 'submitting', attempt_id: 'the-retry' }; }
  });
  try {
    await traced(() => assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), (e) => e.status === 503 && /submitted nothing/.test(e.message)));
    assert.equal(racing.onlyJob().status, 'queued');
    assert.equal(racing.releaseCalls, 0);
    assert.ok(racing.event('media.generation.release_skipped'));
  } finally { racing.restore(); }
});

/* ============================== a definite refusal ============================== */

test('a definite provider refusal: one write marks the job failed and refused, and only then is the reservation released expecting failed', async () => {
  const st = plane();
  const fal = provider({ mode: 'rejected' });
  try {
    await traced(() => assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), /Unprocessable/));
    const job = st.onlyJob();
    assert.deepEqual(patchFilters(st), [CAS_SUBMIT, CAS_FAIL_PRESUBMIT]);
    const failed = st.patchLog[1].body;
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.error, { message: 'Unprocessable input', stage: 'submit' });
    assert.equal(failed.provider_status.outcome, 'submit_refused');
    assert.equal(failed.provider_status.provider_status_code, 422);
    const release = st.rpcCalls('media_release_cost_reservation_v2');
    assert.equal(release.length, 1);
    assert.deepEqual(release[0].body, { p_job_id: job.id, p_reason: 'provider submission failed: Unprocessable input', p_source: 'mccluster-release', p_metadata: {}, p_expect_status: ['failed'] });
    assert.equal(job.routing.reservation_state, 'released');
    /* the release comes after the failed write */
    assert.ok(st.callIndex((call) => call.method === 'PATCH' && call.body?.status === 'failed') < st.callIndex((call) => call.url.endsWith('/rpc/media_release_cost_reservation_v2')));
    assert.match(st.event('media.generation.submit_failed').message, /reservation released/);
    assert.equal(st.event('media.generation.release_skipped'), null);
  } finally { st.restore(); }
});

for (const [name, options] of [
  ['matches nothing (the job moved on)', { beforePatch: (entry, state) => { if (entry.body.status === 'failed') state.job(entry.id).status = 'reconciling'; } }],
  ['errors', { patchFails: (entry) => entry.body.status === 'failed' }]
]) {
  test(`a definite provider refusal whose failed write ${name}: the reservation is kept and the skip is recorded, never a blind release`, async () => {
    const st = plane(options);
    const fal = provider({ mode: 'rejected' });
    try {
      await traced(() => assert.rejects(createGeneration(generate(), env, USER, { submit: fal.submit }), /Unprocessable/));
      assert.equal(st.releaseCalls, 0);
      assert.equal(st.onlyJob().routing.reservation_state, 'reserved');
      assert.ok(st.event('media.generation.release_skipped'));
      assert.match(st.event('media.generation.submit_failed').message, /reservation not released/);
    } finally { st.restore(); }
  });
}

/* =================== the webhook is first: record and uncertain =================== */

test('a hinted webhook that completes the job before the request id is recorded: the record matches nothing and the completed job stands', async () => {
  const payload = { request_id: 'accepted-1', status: 'OK', payload: { images: [{ url: 'https://assets.fixture.invalid/a.png', content_type: 'image/png' }] } };
  let delivered = false;
  let fal;
  const st = plane({
    beforePatch: async (entry) => {
      if (entry.filter !== CAS_RECORD || delivered) return;
      delivered = true;
      const hinted = fal.calls[0].options.webhookUrl.split('/').slice(-2);
      const answer = await handleFalWebhook(webhookRequest(), hintEnv, verified(payload), { jobId: hinted[0], token: hinted[1] });
      assert.equal(answer.status, 'completed');
    }
  });
  fal = provider();
  try {
    const job = await createGeneration(generate(), hintEnv, USER, { submit: fal.submit });
    assert.equal(job.status, 'completed', 'never downgraded to queued');
    assert.deepEqual(job.result, payload.payload);
    assert.equal(job.provider_request_id, 'accepted-1');
    const record = st.patchLog.find((entry) => entry.filter === CAS_RECORD);
    assert.equal(record.matched, 0);
    assert.ok(patchFilters(st).includes(CAS_HINT_ATTACH));
    assert.equal(st.assets.length, 1);
    assert.equal(fal.submits, 1);
  } finally { st.restore(); }
});

test('a hinted webhook that lands while the submit outcome is still unknown: the uncertain write matches nothing and the completed job is the answer, not a 502', async () => {
  const payload = { request_id: 'late-1', status: 'OK', payload: { images: [{ url: 'https://assets.fixture.invalid/b.png' }] } };
  let delivered = false;
  const st = plane({
    beforePatch: async (entry) => {
      if (entry.filter !== CAS_UNCERTAIN || delivered) return;
      delivered = true;
      await handleFalWebhook(webhookRequest(), hintEnv, verified(payload), await hintFor(entry.id));
    }
  });
  const fal = provider({ mode: 'uncertain' });
  try {
    const job = await createGeneration(generate(), hintEnv, USER, { submit: fal.submit });
    assert.equal(job.status, 'completed');
    assert.equal(job.provider_request_id, 'late-1');
    assert.equal(st.patchLog.find((entry) => entry.filter === CAS_UNCERTAIN).matched, 0);
    assert.equal(st.releaseCalls, 0);
  } finally { st.restore(); }
});

test('the provider accepted a request the job row no longer takes (decided mid-flight): the handle is kept as an event', async () => {
  const st = plane({
    beforePatch: (entry, state) => {
      if (entry.filter !== CAS_RECORD) return;
      Object.assign(state.job(entry.id), { status: 'failed', provider_status: { outcome: 'released_by_operator' } });
    }
  });
  const fal = provider();
  try {
    const job = await traced(() => createGeneration(generate(), env, USER, { submit: fal.submit }));
    assert.equal(job.status, 'failed');
    assert.equal(job.provider_request_id, null);
    const event = st.event('media.generation.request_unrecorded');
    assert.ok(event, 'the request id is not lost');
    assert.equal(event.detail.provider_request_id, 'accepted-1');
    assert.equal(event.level, 'error');
  } finally { st.restore(); }
});

/* ============================ the webhook and its hint ============================ */

const billed = (ids) => ids.map((id) => ({ request_id: id, cost_estimate_nano_usd: 9_000_000, output_units: 1, unit_price: 0.009, timestamp: '2026-11-09T20:00:00Z' }));
const IMAGE = { images: [{ url: 'https://assets.fixture.invalid/out.png', content_type: 'image/png', width: 1024, height: 768 }] };

test('S3 an authenticated hint attaches the provider request to a job whose submit outcome was unknown, then completes and settles it', async () => {
  const st = plane({ billing: billed });
  try {
    const job = seedJob(st, { status: 'reconciling', error: { message: 'timeout', uncertain: true, stage: 'submit' }, provider_status: { outcome: 'uncertain', attempted_at: ago(MINUTE) } });
    const attemptedAt = job.provider_status.attempted_at;
    const hint = await hintFor(job.id);
    const delivered = await traced(() => handleFalWebhook(webhookRequest(), billingEnv, verified({ request_id: 'req-9', status: 'OK', payload: IMAGE }), hint), billingEnv);
    assert.deepEqual({ accepted: delivered.accepted, matched: delivered.matched, status: delivered.status }, { accepted: true, matched: true, status: 'completed' });
    assert.equal(st.patchLog[0].filter, CAS_HINT_ATTACH, 'the attach is a compare-and-set');
    assert.equal(st.patchLog[0].body.provider_request_id, 'req-9');
    assert.equal(st.patchLog[0].body.provider_status.outcome, 'attached_by_webhook');
    assert.equal(st.patchLog[0].body.provider_status.attempted_at, attemptedAt, 'the prior marker is kept as evidence');
    assert.equal(st.patchLog[0].body.provider_status.request_id, 'req-9');
    assert.ok(st.patchLog[0].body.submitted_at);
    assert.equal(st.patchLog[1].filter, CAS_REFRESH);
    assert.equal(job.status, 'completed');
    assert.deepEqual(job.error, {}, 'the uncertain error is cleared with {} (the column is NOT NULL)');
    assert.deepEqual(job.result, IMAGE);
    assert.equal(st.assets.length, 1);
    assert.equal(delivered.cost_reconciliation.settled, 1);
    assert.equal(job.routing.reservation_state, 'settled');
    assert.equal(job.actual_cost_cents, 1);
    assert.equal(st.releaseCalls, 0);
    assert.ok(st.event('media.generation.webhook_attached'));
    assert.ok(st.event('media.cost.settled'));
  } finally { st.restore(); }
});

test('S3 a hinted ERROR for a job that never recorded a request id fails it and releases the reservation', async () => {
  const st = plane();
  try {
    const job = seedJob(st, { provider_status: { outcome: 'submitting', attempted_at: ago(MINUTE), attempt_id: 'gone' } });
    const answer = await handleFalWebhook(webhookRequest(), hintEnv, verified({ request_id: 'req-err', status: 'ERROR', error: 'model exploded', payload: { detail: 'x' } }), await hintFor(job.id));
    assert.equal(answer.status, 'failed');
    assert.deepEqual(patchFilters(st), [CAS_HINT_ATTACH, CAS_REFRESH]);
    assert.equal(job.status, 'failed');
    assert.equal(job.provider_request_id, 'req-err');
    assert.deepEqual(job.error, { message: 'model exploded', detail: { detail: 'x' } });
    assert.deepEqual(st.rpcCalls('media_release_cost_reservation_v2')[0].body.p_expect_status, ['failed']);
    assert.equal(job.routing.reservation_state, 'released');
  } finally { st.restore(); }
});

test('S3 a hint is used only when its token verifies: a wrong, truncated, foreign or unsigned hint matches nothing and writes nothing', async () => {
  const st = plane();
  try {
    const job = seedJob(st, { status: 'reconciling', provider_status: { outcome: 'uncertain' } });
    const other = seedJob(st, { status: 'reconciling', provider_status: { outcome: 'uncertain' }, routing: { operation_id: 'another-operation' } });
    const good = await hintFor(job.id);
    const flipped = good.token.slice(0, -1) + (good.token.endsWith('A') ? 'B' : 'A');
    const payload = { request_id: 'forged-1', status: 'OK', payload: IMAGE };
    const unmatched = { accepted: true, matched: false, request_id: 'forged-1' };
    for (const [name, hintingEnv, hint] of [
      ['a wrong token', hintEnv, { jobId: job.id, token: flipped }],
      ['a truncated token', hintEnv, { jobId: job.id, token: good.token.slice(0, 20) }],
      ['a token for another job', hintEnv, { jobId: other.id, token: good.token }],
      ['no token', hintEnv, { jobId: job.id, token: undefined }],
      ['no secret configured', env, good],
      ['a short secret', { ...env, MEDIA_WEBHOOK_HINT_SECRET: 'short' }, good],
      ['another secret', { ...env, MEDIA_WEBHOOK_HINT_SECRET: 'a-different-synthetic-secret-0123456789abcdef' }, good]
    ]) {
      assert.deepEqual(await handleFalWebhook(webhookRequest(), hintingEnv, verified(payload), hint), unmatched, name);
    }
    assert.deepEqual(await handleFalWebhook(webhookRequest(), hintEnv, verified(payload), null), unmatched, 'no hint: request-id matching only');
    assert.equal(st.patchLog.length, 0, 'nothing was written');
    assert.equal(job.provider_request_id, null);
    assert.equal(await verifyWebhookHint(hintEnv, job.id, good.token), true);
    assert.equal(await verifyWebhookHint(hintEnv, job.id, flipped), false);
    assert.equal(await verifyWebhookHint(env, job.id, good.token), false);
  } finally { st.restore(); }
});

test('S3 a hinted job from before cas-v1, or one already settled, is not attached', async () => {
  const st = plane();
  try {
    const legacy = seedJob(st, { status: 'reconciling', routing: { submit_protocol: undefined } });
    const settledJob = seedJob(st, { status: 'failed', routing: { operation_id: 'settled-operation' } });
    settledJob.routing.reservation_state = 'settled';
    for (const job of [legacy, settledJob]) {
      const answer = await handleFalWebhook(webhookRequest(), hintEnv, verified({ request_id: `late-${job.id}`, status: 'OK', payload: IMAGE }), await hintFor(job.id));
      assert.equal(answer.matched, false);
      assert.equal(job.provider_request_id, null);
    }
    assert.deepEqual(patchFilters(st), [CAS_HINT_ATTACH, CAS_HINT_ATTACH]);
    assert.equal(st.patchLog.every((entry) => entry.matched === 0), true);
  } finally { st.restore(); }
});

test('S3 a second provider request under one job\'s hint is a conflict: ignored, recorded, nothing written', async () => {
  const st = plane();
  try {
    const job = seedJob(st, { status: 'running', provider_request_id: 'req-A', provider_status: { outcome: 'submitted' } });
    const answer = await traced(() => hintFor(job.id).then((hint) => handleFalWebhook(webhookRequest(), hintEnv, verified({ request_id: 'req-B', status: 'OK', payload: IMAGE }), hint)));
    assert.deepEqual(answer, { accepted: true, matched: false, request_id: 'req-B', ignored: 'conflict', job_id: job.id });
    assert.equal(st.patchLog.length, 0);
    assert.equal(job.provider_request_id, 'req-A');
    assert.equal(job.status, 'running');
    const event = st.event('media.generation.webhook_conflict');
    assert.equal(event.level, 'error');
    assert.equal(event.detail.job_provider_request_id, 'req-A');
  } finally { st.restore(); }
});

test('S5 a webhook for a completed job is a replay: no write, no release, whatever it says', async () => {
  const st = plane();
  try {
    const job = seedJob(st, { status: 'completed', provider_request_id: 'req-done', result: IMAGE, completed_at: ago(MINUTE) });
    for (const payload of [{ request_id: 'req-done', status: 'ERROR', error: 'late failure' }, { request_id: 'req-done', status: 'OK', payload: { images: [] } }]) {
      const answer = await traced(() => handleFalWebhook(webhookRequest(), env, verified(payload)));
      assert.deepEqual(answer, { accepted: true, matched: true, job_id: job.id, status: 'completed', ignored: 'terminal' });
    }
    assert.equal(st.patchLog.length, 0);
    assert.equal(st.releaseCalls, 0);
    assert.deepEqual(job.result, IMAGE);
    assert.ok(st.event('media.generation.webhook_ignored'));
  } finally { st.restore(); }
});

test('S5 an ERROR for a job that already failed releases a reservation it still holds, once, and never writes the row', async () => {
  const st = plane();
  try {
    const job = seedJob(st, { status: 'failed', provider_request_id: 'req-f', error: { message: 'provider reported failure', stage: 'provider' } });
    const payload = { request_id: 'req-f', status: 'ERROR', error: 'failed' };
    const first = await handleFalWebhook(webhookRequest(), env, verified(payload));
    assert.deepEqual(first, { accepted: true, matched: true, job_id: job.id, status: 'failed', reservation: 'released' });
    const second = await handleFalWebhook(webhookRequest(), env, verified(payload));
    assert.equal(second.reservation, 'already_released');
    assert.equal(st.releases, 1, 'released once');
    assert.equal(st.patchLog.length, 0);
    assert.deepEqual(job.error, { message: 'provider reported failure', stage: 'provider' });
  } finally { st.restore(); }
});

test('S5 an ERROR replay after settlement is refused by the release and only logged', async () => {
  const st = plane();
  try {
    const job = seedJob(st, { status: 'failed', provider_request_id: 'req-billed', actual_cost_cents: 1 });
    job.routing.reservation_state = 'settled';
    st.costs.get(job.id).actual = 9000;
    const answer = await traced(() => handleFalWebhook(webhookRequest(), env, verified({ request_id: 'req-billed', status: 'ERROR' })));
    assert.equal(answer.reservation, 'reservation_already_settled');
    assert.equal(st.releases, 0);
    assert.equal(job.routing.reservation_state, 'settled');
    const event = st.event('media.generation.release_refused');
    assert.equal(event.level, 'warn');
    assert.equal(event.detail.refusal, 'reservation_already_settled');
  } finally { st.restore(); }
});

test('S5 an ERROR for an open job whose cost is already settled records the report and never fails the job', async () => {
  const st = plane();
  try {
    const job = seedJob(st, { status: 'running', provider_request_id: 'req-open', actual_cost_cents: 1 });
    job.routing.reservation_state = 'settled';
    const payload = { request_id: 'req-open', status: 'ERROR', error: 'late failure' };
    const answer = await traced(() => handleFalWebhook(webhookRequest(), env, verified(payload)));
    assert.deepEqual(answer, { accepted: true, matched: true, job_id: job.id, status: 'running', ignored: 'settled' });
    assert.deepEqual(patchFilters(st), [CAS_REFRESH]);
    assert.deepEqual(Object.keys(st.patchLog[0].body).sort(), ['provider_status', 'updated_at'], 'provider_status only');
    assert.equal(job.status, 'running');
    assert.equal(st.releaseCalls, 0);
    assert.equal(st.event('media.generation.failed_after_settlement').level, 'warn');
  } finally { st.restore(); }
});

test('a provider success for a job that already failed with that request id changes nothing and is recorded', async () => {
  const st = plane();
  try {
    const job = seedJob(st, { status: 'failed', provider_request_id: 'req-x' });
    const answer = await traced(() => handleFalWebhook(webhookRequest(), env, verified({ request_id: 'req-x', status: 'OK', payload: IMAGE })));
    assert.deepEqual(answer, { accepted: true, matched: true, job_id: job.id, status: 'failed', ignored: 'state_changed' });
    assert.equal(st.patchLog[0].matched, 0);
    assert.equal(st.assets.length, 0, 'no assets for a job that did not complete');
    assert.equal(st.event('media.generation.webhook_ignored').level, 'warn');
  } finally { st.restore(); }
});

test('the configured fal account is pinned: a signed webhook from another account is refused before any key is fetched', async () => {
  const headers = (userId) => ({
    'x-fal-webhook-request-id': 'r-1', 'x-fal-webhook-user-id': userId,
    'x-fal-webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'x-fal-webhook-signature': 'ab'
  });
  const webhook = (userId) => new Request(`${ORIGIN}/v1/media/webhooks/fal`, { method: 'POST', headers: headers(userId), body: '{}' });
  const pinned = { ...env, FAL_WEBHOOK_USER_ID: 'house-fal-account' };
  /* the offline guard would throw on a key fetch: a 401 proves the pin answered first */
  await assert.rejects(verifyFalWebhook(webhook('someone-else'), pinned), (e) => e.status === 401 && /configured fal account/.test(e.message));
  await assert.rejects(handleFalWebhook(webhook('someone-else'), pinned), (e) => e.status === 401);
  /* the house's own account, and an unpinned Worker, go on to signature verification */
  const original = globalThis.fetch;
  let keyFetches = 0;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://rest.fal.ai/.well-known/jwks.json');
    keyFetches += 1;
    return json({ keys: [] });
  };
  try {
    await assert.rejects(verifyFalWebhook(webhook('house-fal-account'), pinned), (e) => e.status === 503);
    await assert.rejects(verifyFalWebhook(webhook('someone-else'), env), (e) => e.status === 503);
    await assert.rejects(verifyFalWebhook(webhook('someone-else')), (e) => e.status === 503, 'env is optional');
    assert.equal(keyFetches, 3);
  } finally { globalThis.fetch = original; }
});

/* ========================= the member's refresh (S4) ========================= */

const jobRequest = (jobId) => new Request(`${ORIGIN}/v1/media/jobs/${jobId}?org_id=${ORG}`);
const notFound = () => { throw Object.assign(new Error('Not Found'), { status: 404 }); };

test('S4 a refresh that finds the provider failed: failed with compare-and-set, then released expecting failed', async () => {
  const st = plane();
  try {
    const job = seedJob(st, { status: 'running', provider_request_id: 'req-r', provider_status: { outcome: 'submitted' } });
    const raw = { status: 'ERROR', request_id: 'req-r', error: 'boom' };
    const { job: after } = await getGeneration(jobRequest(job.id), env, USER, job.id, true, { status: async () => raw });
    assert.deepEqual(patchFilters(st), [CAS_REFRESH]);
    assert.equal(after.status, 'failed');
    assert.deepEqual(after.error, { message: 'provider reported failure', stage: 'provider', detail: raw });
    assert.deepEqual(st.rpcCalls('media_release_cost_reservation_v2')[0].body.p_expect_status, ['failed']);
    assert.equal(after.routing.reservation_state, 'released', 'the answer shows the release');
    assert.equal(st.releases, 1);
  } finally { st.restore(); }
});

test('S4 a refresh that finds the provider completed: completed with error {}, the result fetched, assets saved, the cost settled; never a release', async () => {
  const st = plane({ billing: billed });
  try {
    const job = seedJob(st, { status: 'reconciling', provider_request_id: 'req-c', error: { message: 'record failed', uncertain: true, stage: 'persist' }, provider_status: { outcome: 'accepted_unrecorded' } });
    const deps = { status: async () => ({ status: 'COMPLETED', request_id: 'req-c' }), result: async () => ({ data: IMAGE, request_id: 'req-c' }) };
    const { job: after, assets } = await getGeneration(jobRequest(job.id), billingEnv, USER, job.id, true, deps);
    assert.equal(st.patchLog[0].filter, CAS_REFRESH);
    assert.equal(st.patchLog[0].body.status, 'completed');
    assert.deepEqual(st.patchLog[0].body.error, {}, 'never null: the column is NOT NULL');
    assert.equal(after.status, 'completed');
    assert.deepEqual(after.result, IMAGE);
    assert.ok(after.completed_at);
    assert.equal(assets.length, 1);
    assert.equal(after.routing.reservation_state, 'settled');
    assert.equal(st.releaseCalls, 0);
  } finally { st.restore(); }
});

test('S4 a reconciling job with a request id is polled like any open job; a write that matches nothing re-reads instead of regressing', async () => {
  const st = plane();
  try {
    const job = seedJob(st, { status: 'reconciling', provider_request_id: 'req-p', provider_status: { outcome: 'accepted_unrecorded' } });
    const first = await getGeneration(jobRequest(job.id), env, USER, job.id, true, { status: async () => ({ status: 'IN_PROGRESS' }) });
    assert.equal(first.job.status, 'running');
    /* the webhook completes it while the provider status call is in flight */
    const second = await getGeneration(jobRequest(job.id), env, USER, job.id, true, {
      status: async () => { Object.assign(st.job(job.id), { status: 'completed', result: IMAGE }); return { status: 'IN_QUEUE' }; }
    });
    assert.equal(second.job.status, 'completed', 'never moved back to queued');
    assert.equal(st.patchLog.at(-1).matched, 0);
  } finally { st.restore(); }
});

test('S4 a provider failure that arrives after the job completed changes nothing and releases nothing', async () => {
  const st = plane();
  try {
    const job = seedJob(st, { status: 'running', provider_request_id: 'req-late-fail' });
    /* the webhook completes it while the provider status call is in flight */
    const { job: after } = await getGeneration(jobRequest(job.id), env, USER, job.id, true, {
      status: async () => { Object.assign(st.job(job.id), { status: 'completed', result: IMAGE }); return { status: 'ERROR' }; }
    });
    assert.equal(after.status, 'completed');
    assert.equal(st.patchLog[0].filter, CAS_REFRESH);
    assert.equal(st.patchLog[0].matched, 0);
    assert.equal(st.releaseCalls, 0, 'a completed job keeps its reservation for settlement');
    assert.equal(st.job(job.id).routing.reservation_state, 'reserved');
  } finally { st.restore(); }
});

test('S4 the provider\'s answer is applied the same way for the sweep and the read; a cost is recorded only against a completed job', async () => {
  const st = plane({ billing: billed });
  try {
    const open = seedJob(st, { status: 'queued', provider_request_id: 'req-open' });
    const running = await applyProviderStatus(billingEnv, open, { status: 'IN_PROGRESS' });
    assert.equal(running.status, 'running');
    assert.deepEqual(patchFilters(st), [CAS_REFRESH]);
    /* never for a job that is not completed, whatever the billing API says */
    for (const status of ['running', 'failed', 'reconciling', 'queued']) {
      Object.assign(open, { status });
      const answer = await reconcileFalJobCost(billingEnv, { ...open });
      assert.equal(answer.checked, 0, status);
    }
    assert.equal(st.rpcCalls('media_record_actual_cost_v2').length, 0);
    Object.assign(open, { status: 'completed' });
    assert.equal((await reconcileFalJobCost(billingEnv, { ...open })).settled, 1);
    assert.equal(st.rpcCalls('media_record_actual_cost_v2').length, 1);
  } finally { st.restore(); }
});

test('S4 a null in a NOT NULL column is refused by the plane the way production refuses it', async () => {
  const st = plane();
  try {
    const { patchJob } = await import('../src/media/router.js');
    const job = seedJob(st);
    await assert.rejects(patchJob(env, job.id, { error: null }), (e) => e.status === 400 && e.detail.code === '23502');
    assert.deepEqual(job.error, {});
  } finally { st.restore(); }
});

test('S4 three consecutive provider 404s park the job as unknown_request; a real answer resets the count', async () => {
  const st = plane();
  try {
    const job = seedJob(st, { status: 'queued', provider_request_id: 'req-typo', provider_status: { outcome: 'attached_by_operator', request_id: 'req-typo' } });
    for (const expected of [1, 2]) {
      const { job: after } = await getGeneration(jobRequest(job.id), env, USER, job.id, true, { status: notFound });
      assert.equal(after.provider_status.unknown_request_count, expected);
      assert.equal(after.provider_status.outcome, 'attached_by_operator');
      assert.equal(after.status, 'queued', 'a 404 is counted, not thrown, and changes no status yet');
    }
    const parked = await traced(() => pollProviderStatus(env, st.job(job.id), { status: notFound }));
    assert.equal(parked.action, 'unknown_request');
    assert.equal(parked.job.provider_status.unknown_request_count, 3);
    assert.equal(parked.job.provider_status.outcome, 'unknown_request');
    assert.equal(parked.job.status, 'reconciling');
    assert.equal(st.patchLog.every((entry) => entry.filter === CAS_REFRESH), true);
    assert.equal(st.releaseCalls, 0, 'no money moves on a 404');
    assert.equal(st.event('media.generation.unknown_request').level, 'warn');
    /* any other provider error still propagates */
    await assert.rejects(getGeneration(jobRequest(job.id), env, USER, job.id, true, { status: async () => { throw Object.assign(new Error('upstream'), { status: 503 }); } }), (e) => e.status === 503);
    const { job: answered } = await getGeneration(jobRequest(job.id), env, USER, job.id, true, { status: async () => ({ status: 'IN_QUEUE', queue_position: 2 }) });
    assert.equal(answered.status, 'queued');
    assert.equal(answered.provider_status.unknown_request_count, undefined);
    assert.equal(answered.provider_status.outcome, undefined);
  } finally { st.restore(); }
});

/* ===================== released too early, completed after all ===================== */

const reconcileRequest = (jobId, body) => new Request(`${ORIGIN}/v1/media/jobs/${jobId}/reconcile`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});

test('a job an operator released that the provider ran after all: the hinted success completes it, saves assets, settles the cost and is audited', async () => {
  const st = plane({ billing: billed });
  try {
    const job = seedJob(st, { status: 'reconciling', provider_status: { outcome: 'uncertain', attempted_at: ago(20 * MINUTE) }, error: { message: 'timeout', uncertain: true, stage: 'submit' } });
    const released = await reconcileJob(reconcileRequest(job.id, { org_id: ORG, decision: 'release', reason: 'provider console showed nothing', evidence: { console_checked: true } }), billingEnv, USER, job.id);
    assert.equal(released.outcome, 'released');
    assert.equal(job.status, 'failed');
    assert.equal(job.routing.reservation_state, 'released');

    const hint = await hintFor(job.id);
    const answer = await traced(() => handleFalWebhook(webhookRequest(), billingEnv, verified({ request_id: 'req-late', status: 'OK', payload: IMAGE }), hint), billingEnv);
    assert.equal(answer.status, 'completed');
    const filters = patchFilters(st);
    assert.equal(filters[0], CAS_HINT_ATTACH, 'attached although failed: the reservation is not settled');
    assert.equal(filters[1], 'status=eq.failed&provider_request_id=eq.req-late', 'completed only from the state the attach left');
    assert.equal(job.status, 'completed');
    assert.deepEqual(job.result, IMAGE);
    assert.deepEqual(job.error, {});
    assert.equal(st.assets.length, 1);
    assert.equal(answer.cost_reconciliation.settled, 1, 'record_actual runs for the completed job');
    assert.equal(job.routing.reservation_state, 'settled');
    assert.equal(job.routing.operator_resolution.decision, 'release', 'the decision that released it stays on the row');
    const audit = st.audit.find((row) => row.event === 'media_operation.completed_after_release');
    assert.ok(audit, 'audited');
    assert.equal(audit.org_id, ORG);
    assert.equal(audit.actor_kind, 'system');
    assert.equal(audit.resource_id, job.id);
    assert.equal(audit.detail.provider_request_id, 'req-late');
    assert.equal(audit.detail.operator_resolution.decision, 'release');
    assert.ok(st.event('media_operation.completed_after_release'), 'and an event under the webhook\'s trace');
    /* record_actual was called after the job was completed, never for a failed one */
    assert.ok(st.callIndex((call) => call.method === 'PATCH' && call.body?.status === 'completed') < st.callIndex((call) => call.url.endsWith('/rpc/media_record_actual_cost_v2')));
  } finally { st.restore(); }
});

test('a job an operator released that the provider then reports failed: the hinted ERROR releases nothing twice', async () => {
  const st = plane();
  try {
    const job = seedJob(st);
    await reconcileJob(reconcileRequest(job.id, { org_id: ORG, decision: 'release', reason: 'never submitted' }), env, USER, job.id);
    assert.equal(st.releases, 1);
    const answer = await handleFalWebhook(webhookRequest(), hintEnv, verified({ request_id: 'req-late-err', status: 'ERROR', error: 'failed' }), await hintFor(job.id));
    assert.deepEqual(answer, { accepted: true, matched: true, job_id: job.id, status: 'failed', reservation: 'already_released' });
    assert.equal(st.releases, 1, 'released once');
    assert.equal(job.status, 'failed');
    assert.equal(job.provider_request_id, 'req-late-err', 'the request id is on the row as evidence');
  } finally { st.restore(); }
});

/* ================================ the cron sweep ================================ */

test('the sweep polls only open jobs with a request id that have been quiet for five minutes, and settles what the provider finished', async () => {
  const st = plane({ billing: billed });
  try {
    const stale = seedJob(st, { status: 'running', provider_request_id: 'req-stale', updated_at: ago(6 * MINUTE) });
    const fresh = seedJob(st, { status: 'running', provider_request_id: 'req-fresh', updated_at: ago(MINUTE), routing: { operation_id: 'fresh' } });
    const noRequest = seedJob(st, { status: 'reconciling', provider_status: { outcome: 'uncertain' }, updated_at: ago(60 * MINUTE), routing: { operation_id: 'no-request' } });
    const done = seedJob(st, { status: 'completed', provider_request_id: 'req-done', updated_at: ago(60 * MINUTE), routing: { operation_id: 'done' } });
    const asked = [];
    const deps = {
      status: async (_env, _model, requestId) => { asked.push(requestId); return { status: 'COMPLETED', request_id: requestId }; },
      result: async (_env, _model, requestId) => ({ data: IMAGE, request_id: requestId })
    };
    const report = await traced(() => sweepMediaRecovery(billingEnv, { limit: 25 }, deps), billingEnv);
    assert.deepEqual(asked, ['req-stale'], 'only the quiet open job with a request id');
    assert.deepEqual({ polled: report.polled, completed: report.completed, settled: report.settled, released: report.released, errors: report.errors },
      { polled: 1, completed: 1, settled: 1, released: 0, errors: [] });
    assert.equal(stale.status, 'completed');
    assert.equal(stale.routing.reservation_state, 'settled');
    assert.equal(fresh.status, 'running');
    assert.equal(noRequest.status, 'reconciling', 'a job without a request id is never polled');
    assert.equal(noRequest.routing.reservation_state, 'reserved', 'and never released');
    assert.equal(done.routing.reservation_state, 'reserved', 'a completed job is the cost cron\'s, not the sweep\'s');
    assert.equal(st.releaseCalls, 0);
    const listing = st.calls.find((call) => call.method === 'GET' && call.url.includes('provider_request_id=not.is.null'));
    assert.match(listing.url, /media_jobs\?provider=eq\.fal&provider_request_id=not\.is\.null&status=in\.\(queued,running,reconciling\)&updated_at=lt\.[^&]+&order=updated_at\.asc&limit=25&select=\*$/);
  } finally { st.restore(); }
});

test('the sweep releases only where the provider itself answered failed; a poll that errors is counted and stops nothing', async () => {
  const st = plane();
  try {
    const failedJob = seedJob(st, { status: 'queued', provider_request_id: 'req-bad', updated_at: ago(10 * MINUTE) });
    const flaky = seedJob(st, { status: 'queued', provider_request_id: 'req-flaky', updated_at: ago(9 * MINUTE), routing: { operation_id: 'flaky' } });
    const report = await sweepMediaRecovery(env, {}, {
      status: async (_env, _model, requestId) => {
        if (requestId === 'req-flaky') throw Object.assign(new Error('provider unavailable'), { status: 503 });
        return { status: 'FAILED' };
      }
    });
    assert.equal(report.polled, 2);
    assert.equal(report.released, 1);
    assert.equal(failedJob.status, 'failed');
    assert.equal(failedJob.routing.reservation_state, 'released');
    assert.equal(flaky.status, 'queued');
    assert.equal(flaky.routing.reservation_state, 'reserved');
    assert.deepEqual(report.errors, [{ phase: 'poll', job_id: flaky.id, message: 'provider unavailable' }]);
  } finally { st.restore(); }
});

test('the sweep parks a submit marker nobody completed for ten minutes as reconciling/uncertain, with the compare-and-set filter; no money moves', async () => {
  const st = plane();
  try {
    const stuck = seedJob(st, { provider_status: { outcome: 'submitting', attempted_at: ago(11 * MINUTE), attempt_id: 'gone' }, updated_at: ago(11 * MINUTE) });
    const inFlight = seedJob(st, { provider_status: { outcome: 'submitting', attempted_at: ago(9 * MINUTE), attempt_id: 'alive' }, updated_at: ago(9 * MINUTE), routing: { operation_id: 'in-flight' } });
    const legacy = seedJob(st, { provider_status: { outcome: 'submitting' }, updated_at: ago(60 * MINUTE), routing: { operation_id: 'legacy', submit_protocol: undefined } });
    const neverMarked = seedJob(st, { updated_at: ago(60 * MINUTE), routing: { operation_id: 'never-marked' } });
    let statusCalls = 0;
    const report = await traced(() => sweepMediaRecovery(env, {}, { status: async () => { statusCalls += 1; return { status: 'IN_QUEUE' }; } }));
    assert.equal(report.marked_uncertain, 1);
    assert.equal(statusCalls, 0, 'nothing without a request id is polled');
    assert.deepEqual(patchFilters(st), [CAS_UNCERTAIN]);
    assert.equal(stuck.status, 'reconciling');
    assert.equal(stuck.provider_status.outcome, 'uncertain');
    assert.equal(stuck.provider_status.attempt_id, 'gone', 'the attempt stays as evidence');
    assert.ok(stuck.provider_status.marked_uncertain_at);
    assert.deepEqual(stuck.error, { message: 'submit outcome unknown: the submitting isolate recorded no result', uncertain: true, stage: 'submit' });
    assert.equal(inFlight.status, 'queued', 'a nine-minute marker may still be in flight');
    assert.equal(legacy.status, 'queued');
    assert.equal(neverMarked.status, 'queued', 'a job nobody marked is a release candidate, not an unknown outcome');
    assert.equal(st.releaseCalls, 0);
    for (const job of [stuck, inFlight, legacy, neverMarked]) assert.equal(job.routing.reservation_state, 'reserved');
    assert.equal(st.event('media.generation.submit_outcome_unknown').resource_id, stuck.id);
    const listing = st.calls.find((call) => call.method === 'GET' && call.url.includes('provider_status->>outcome=eq.submitting'));
    assert.match(listing.url, /media_jobs\?provider=eq\.fal&status=eq\.queued&provider_request_id=is\.null&provider_status->>outcome=eq\.submitting&routing->>submit_protocol=eq\.cas-v1&updated_at=lt\./);
  } finally { st.restore(); }
});

test('the sweep records the candidate counts once per organization, as evidence in the observability ledger', async () => {
  const candidates = {
    generated_at: new Date().toISOString(), older_than: '00:15:00',
    counts: { submit_outcome_unknown: 1, pollable_stale: 2, claim_expired_without_job: 1 },
    by_org: [
      { org_id: ORG, counts: { submit_outcome_unknown: 1, claim_expired_without_job: 1 } },
      { org_id: OTHER_ORG, counts: { pollable_stale: 2 } }
    ],
    candidates: []
  };
  const st = plane({ candidates });
  try {
    const report = await traced(() => sweepMediaRecovery(env, {}, {}));
    assert.deepEqual(report.candidate_counts, candidates.counts);
    assert.deepEqual(st.rpcCalls('media_operation_recovery_candidates_v1')[0].body, { p_org_id: null, p_older_than: '15 minutes', p_limit: 50 });
    const events = st.events.filter((event) => event.event_name === 'media.recovery.candidates');
    assert.equal(events.length, 2, 'one per organization');
    const mine = events.find((event) => event.org_id === ORG);
    assert.deepEqual(mine.detail, { submit_outcome_unknown: 1, claim_expired_without_job: 1 });
    assert.equal(mine.level, 'warn', 'a class only a person can decide');
    assert.equal(mine.event_kind, 'scheduled');
    assert.equal(mine.route, 'cron:test.media');
    const theirs = events.find((event) => event.org_id === OTHER_ORG);
    assert.deepEqual(theirs.detail, { pollable_stale: 2 });
    assert.equal(theirs.level, 'info', 'polling resolves it');
  } finally { st.restore(); }
});

test('the sweep before media_operation_claims_v2.sql is applied: it still polls and parks, and says recovery is unavailable instead of failing', async () => {
  const st = plane({ missing: V2_FUNCTIONS });
  try {
    const failedJob = seedJob(st, { status: 'running', provider_request_id: 'req-bad', updated_at: ago(10 * MINUTE) });
    const report = await sweepMediaRecovery(env, {}, { status: async () => ({ status: 'ERROR' }) });
    assert.equal(report.recovery_unavailable, true);
    assert.equal(report.candidate_counts, null);
    assert.deepEqual(report.errors, []);
    assert.equal(failedJob.status, 'failed');
    assert.equal(st.releasesV1, 1, 'the failed job is released through the 0054 function');
    assert.equal(report.released, 1);
  } finally { st.restore(); }
});

test('the sweep without a provider key polls nothing; without a data plane it does nothing', async () => {
  const st = plane();
  try {
    seedJob(st, { status: 'running', provider_request_id: 'req-stale', updated_at: ago(10 * MINUTE) });
    const report = await sweepMediaRecovery({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY }, {}, {});
    assert.equal(report.poll_skipped, 'fal_not_configured');
    assert.equal(report.polled, 0);
    assert.equal((await sweepMediaRecovery({}, {}, {})).skipped, 'supabase_not_configured');
  } finally { st.restore(); }
});

/* ============================ the operator surface ============================ */

const OWNER_TOKEN = 'owner-session';
const MEMBER_TOKEN = 'member-session';
const sessions = { [OWNER_TOKEN]: { id: USER.id, email: 'owner@fixture.invalid' }, [MEMBER_TOKEN]: { id: MEMBER.id, email: 'member@fixture.invalid' } };

async function api(path, { method = 'GET', token = null, body = undefined, headers = {}, apiEnv = env } = {}) {
  const pending = [];
  const response = await entry.fetch(new Request(`https://api.mccluster.org${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  }), apiEnv, { waitUntil(promise) { pending.push(promise); } });
  await Promise.all(pending);
  return { status: response.status, headers: response.headers, body: await response.json() };
}
const rpcIndex = (st, name) => st.callIndex((call) => call.url.endsWith(`/rpc/${name}`));
const auditIndex = (st, event) => st.callIndex((call) => call.url.endsWith('/rest/v1/control_audit') && call.body?.event === event);

test('operator routes: nobody signed in is 401; an organization owner who is not the house owner is 403; neither touches the job, the ledger or the decision', async () => {
  const st = plane({ sessions });
  try {
    const job = seedJob(st);
    const decision = { org_id: ORG, decision: 'release', reason: 'never submitted' };
    for (const [method, path, body] of [['POST', `/v1/media/jobs/${job.id}/reconcile`, decision], ['GET', '/v1/media/recovery', undefined]]) {
      const anonymous = await api(path, { method, body });
      assert.equal(anonymous.status, 401, path);
      const stranger = await api(path, { method, body, token: 'not-a-session' });
      assert.equal(stranger.status, 401, path);
      const member = await api(path, { method, body, token: MEMBER_TOKEN });
      assert.equal(member.status, 403, path);
      assert.equal(member.body.error, 'House owner access is required');
    }
    assert.equal(st.rpcs.length, 0, 'no database function was called');
    assert.equal(st.audit.length, 0);
    assert.equal(job.status, 'queued');
    assert.equal(job.routing.reservation_state, 'reserved');
  } finally { st.restore(); }
});

test('operator release by the house owner: audited before it runs, bound to the organization in the request, answered with what happened', async () => {
  const st = plane({ sessions });
  try {
    const job = seedJob(st);
    const answer = await api(`/v1/media/jobs/${job.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body: { org_id: ORG, decision: 'release', reason: '  never submitted: no marker  ' } });
    assert.equal(answer.status, 200);
    assert.equal(answer.headers.get('cache-control'), 'private, no-store');
    assert.equal(answer.body.outcome, 'released');
    assert.equal(answer.body.decision, 'release');
    assert.equal(answer.body.status, 'failed');
    assert.equal(answer.body.job_id, job.id);
    assert.equal(answer.body.release.released, true);
    assert.equal(answer.body.resolution.actor_id, USER.id);
    assert.equal(answer.body.audit.requested.recorded, true);
    assert.equal(answer.body.audit.resolved.recorded, true);
    assert.deepEqual(st.rpcCalls('media_resolve_operation_job_v1')[0].body, {
      p_org_id: ORG, p_job_id: job.id, p_decision: 'release', p_actor_id: USER.id, p_reason: 'never submitted: no marker', p_evidence: {}, p_provider_request_id: null
    });
    /* the ledger row is written first */
    assert.ok(auditIndex(st, 'media_operation.resolve_requested') >= 0);
    assert.ok(auditIndex(st, 'media_operation.resolve_requested') < rpcIndex(st, 'media_resolve_operation_job_v1'));
    assert.ok(rpcIndex(st, 'media_resolve_operation_job_v1') < auditIndex(st, 'media_operation.resolved'));
    const requested = st.audit.find((row) => row.event === 'media_operation.resolve_requested');
    assert.deepEqual({ org: requested.org_id, actor: requested.actor_user_id, kind: requested.actor_kind, capability: requested.capability, type: requested.resource_type, id: requested.resource_id },
      { org: ORG, actor: USER.id, kind: 'user', capability: 'media.recover', type: 'media_job', id: job.id });
    assert.equal(requested.detail.operation_id, OPERATION);
    assert.deepEqual(requested.detail.before, { status: 'queued', outcome: null, reservation_state: 'reserved', provider_request_id: null });
    const resolved = st.audit.find((row) => row.event === 'media_operation.resolved');
    assert.deepEqual(resolved.detail.after, { status: 'failed', released_usd_micros: 12000, provider_request_id: null });
    assert.equal(job.status, 'failed');
    assert.equal(job.routing.reservation_state, 'released');
    /* the same decision again is the decision on record */
    const again = await api(`/v1/media/jobs/${job.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body: { org_id: ORG, decision: 'release', reason: 'again' } });
    assert.equal(again.status, 200);
    assert.equal(again.body.outcome, 'already_resolved');
    assert.equal(st.releases, 1);
  } finally { st.restore(); }
});

test('operator decision with the audit ledger down: 503, and the decision is not applied', async () => {
  const st = plane({ sessions, auditFails: true });
  try {
    const job = seedJob(st);
    const answer = await api(`/v1/media/jobs/${job.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body: { org_id: ORG, decision: 'release', reason: 'never submitted' } });
    assert.equal(answer.status, 503);
    assert.match(answer.body.error, /audit ledger is unavailable/);
    assert.equal(st.rpcCalls('media_resolve_operation_job_v1').length, 0, 'the decision function was never called');
    assert.equal(job.status, 'queued');
    assert.equal(job.routing.reservation_state, 'reserved');
  } finally { st.restore(); }
});

test('operator decisions the database refuses: a live provider request is 409, a job outside the organization is 404, an invalid decision is 400, each recorded as refused', async () => {
  const st = plane({ sessions });
  try {
    const live = seedJob(st, { status: 'running', provider_request_id: 'req-live', provider_status: { outcome: 'submitted' } });
    const conflict = await api(`/v1/media/jobs/${live.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body: { org_id: ORG, decision: 'release', reason: 'looks stuck', evidence: { looked: true } } });
    assert.equal(conflict.status, 409);
    assert.match(conflict.body.error, /job_has_provider_request/);
    assert.equal(conflict.body.detail.refusal, 'job_has_provider_request');
    assert.equal(live.status, 'running');
    assert.equal(st.audit.at(-1).event, 'media_operation.resolve_refused');
    assert.equal(st.audit.at(-1).detail.refusal, 'job_has_provider_request');

    /* another organization's id in the request: the job is not found there */
    const elsewhere = await api(`/v1/media/jobs/${live.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body: { org_id: OTHER_ORG, decision: 'release', reason: 'wrong org' } });
    assert.equal(elsewhere.status, 404);
    assert.equal(st.rpcCalls('media_resolve_operation_job_v1').length, 1, 'refused before the decision function');

    const oneOff = seedJob(st, { routing: { operation_id: undefined } });
    const invalid = await api(`/v1/media/jobs/${oneOff.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body: { org_id: ORG, decision: 'bind', reason: 'bind a one-off' } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, 'job carries no operation_id');

    const uncertain = seedJob(st, { status: 'reconciling', provider_status: { outcome: 'uncertain' }, routing: { operation_id: 'uncertain-operation' } });
    const needsEvidence = await api(`/v1/media/jobs/${uncertain.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body: { org_id: ORG, decision: 'release', reason: 'no evidence given' } });
    assert.equal(needsEvidence.status, 409);
    assert.match(needsEvidence.body.error, /release_requires_evidence/);
    assert.equal(uncertain.routing.reservation_state, 'reserved');
  } finally { st.restore(); }
});

test('the organization binding is the database\'s, not only the handler\'s pre-read: a job that leaves the organization before the decision is 404', async () => {
  let moved = false;
  const st = plane({
    sessions,
    intercept: ({ url, body }, state) => {
      if (!moved && url.endsWith('/rest/v1/control_audit') && body?.event === 'media_operation.resolve_requested') {
        moved = true;
        state.onlyJob().org_id = OTHER_ORG;
      }
      return undefined;
    }
  });
  try {
    const job = seedJob(st);
    const answer = await api(`/v1/media/jobs/${job.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body: { org_id: ORG, decision: 'release', reason: 'never submitted' } });
    assert.equal(answer.status, 404);
    assert.equal(st.rpcCalls('media_resolve_operation_job_v1').length, 1);
    assert.equal(job.status, 'queued');
    assert.equal(st.audit.at(-1).detail.refusal, 'job_not_in_org');
  } finally { st.restore(); }
});

test('operator settle and bind: the request id is validated and attached, the refresh path takes over; bind returns the repaired claim', async () => {
  const st = plane({ sessions });
  try {
    const uncertain = seedJob(st, { status: 'reconciling', provider_status: { outcome: 'uncertain' }, error: { message: 'timeout', uncertain: true, stage: 'submit' } });
    for (const bad of [undefined, '', 'has spaces', 'x'.repeat(201)]) {
      const refused = await api(`/v1/media/jobs/${uncertain.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body: { org_id: ORG, decision: 'settle', reason: 'found in the console', provider_request_id: bad } });
      assert.equal(refused.status, 400, String(bad));
    }
    assert.equal(st.audit.length, 0, 'an invalid request writes nothing');
    const settled = await api(`/v1/media/jobs/${uncertain.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body: { org_id: ORG, decision: 'settle', reason: 'found in the console', provider_request_id: ' req-console-1 ' } });
    assert.equal(settled.status, 200);
    assert.equal(settled.body.outcome, 'settled');
    assert.equal(settled.body.status, 'queued');
    assert.equal(uncertain.provider_request_id, 'req-console-1');
    assert.deepEqual(uncertain.error, {});
    assert.equal(uncertain.routing.reservation_state, 'reserved', 'settle never moves money');
    assert.equal(st.releaseCalls, 0);
    assert.equal(st.rpcCalls('media_resolve_operation_job_v1').at(-1).body.p_provider_request_id, 'req-console-1');
    /* a member's read (or the sweep) now finishes it by that request id */
    const { job: after } = await getGeneration(jobRequest(uncertain.id), env, USER, uncertain.id, true, {
      status: async (_env, _model, requestId) => { assert.equal(requestId, 'req-console-1'); return { status: 'COMPLETED' }; },
      result: async () => ({ data: IMAGE, request_id: 'req-console-1' })
    });
    assert.equal(after.status, 'completed');
    assert.equal(st.assets.length, 1);

    await seedClaim(st, { operation_id: 'claimed-operation' });
    st.claims.set(`${ORG}:claimed-operation`, st.claims.get(KEY));
    st.claims.delete(KEY);
    const unbound = seedJob(st, { routing: { operation_id: 'claimed-operation' } });
    const bound = await api(`/v1/media/jobs/${unbound.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body: { org_id: ORG, decision: 'bind', reason: 'the winner stopped before the bind' } });
    assert.equal(bound.status, 200);
    assert.equal(bound.body.outcome, 'repaired');
    assert.equal(bound.body.claim.state, 'bound');
    assert.equal(bound.body.claim.job_id, unbound.id);
    assert.equal(bound.body.claim.resolution.by, 'operator');
    assert.equal(unbound.status, 'queued', 'a bind moves neither the job nor its money');
  } finally { st.restore(); }
});

test('operator request validation: every malformed decision is 400 before anything is read or written', async () => {
  const st = plane({ sessions });
  try {
    const job = seedJob(st);
    const post = (body) => api(`/v1/media/jobs/${job.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body });
    for (const [name, body] of [
      ['no organization', { decision: 'release', reason: 'never submitted' }],
      ['an organization that is not a uuid', { org_id: 'mine', decision: 'release', reason: 'never submitted' }],
      ['an unknown decision', { org_id: ORG, decision: 'abandon', reason: 'never submitted' }],
      ['no reason', { org_id: ORG, decision: 'release' }],
      ['a two-character reason', { org_id: ORG, decision: 'release', reason: 'no' }],
      ['a 501-character reason', { org_id: ORG, decision: 'release', reason: 'x'.repeat(501) }],
      ['evidence that is an array', { org_id: ORG, decision: 'release', reason: 'never submitted', evidence: ['looked'] }],
      ['evidence that is a string', { org_id: ORG, decision: 'release', reason: 'never submitted', evidence: 'looked' }],
      ['oversized evidence', { org_id: ORG, decision: 'release', reason: 'never submitted', evidence: { note: 'x'.repeat(9000) } }],
      ['a body that is not JSON', 'not json']
    ]) {
      assert.equal((await post(body)).status, 400, name);
    }
    assert.equal(st.rpcs.length, 0);
    assert.equal(st.audit.length, 0);
    assert.equal(st.lookups, 0, 'the job was never read');
  } finally { st.restore(); }
});

test('GET /v1/media/recovery: the house owner reads the candidates, scoped and bounded by the query; the answer is never cached', async () => {
  const body = { generated_at: 'now', older_than: '00:30:00', counts: { pollable_stale: 1 }, by_org: [{ org_id: ORG, counts: { pollable_stale: 1 } }], candidates: [{ class: 'pollable_stale', org_id: ORG }] };
  const st = plane({ sessions, candidates: body });
  try {
    const all = await api('/v1/media/recovery', { token: OWNER_TOKEN });
    assert.equal(all.status, 200);
    assert.deepEqual(all.body, body);
    assert.equal(all.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(st.rpcCalls('media_operation_recovery_candidates_v1')[0].body, { p_org_id: null, p_older_than: '15 minutes', p_limit: 50 });
    const scoped = await api(`/v1/media/recovery?org_id=${ORG}&older_than_minutes=30&limit=10`, { token: OWNER_TOKEN });
    assert.equal(scoped.status, 200);
    assert.deepEqual(st.rpcCalls('media_operation_recovery_candidates_v1')[1].body, { p_org_id: ORG, p_older_than: '30 minutes', p_limit: 10 });
    for (const query of ['org_id=mine', 'older_than_minutes=0', 'older_than_minutes=1441', 'older_than_minutes=abc', 'limit=0', 'limit=201', 'limit=1.5']) {
      assert.equal((await api(`/v1/media/recovery?${query}`, { token: OWNER_TOKEN })).status, 400, query);
    }
    assert.equal(st.rpcCalls('media_operation_recovery_candidates_v1').length, 2);
    /* the job read stays what it was: membership, not the operator gate */
    assert.equal((await api('/v1/media/recovery', { method: 'POST', token: OWNER_TOKEN, body: {} })).status, 404);
  } finally { st.restore(); }
});

test('operator routes before media_operation_claims_v2.sql is applied answer 503 recovery_unavailable', async () => {
  const st = plane({ sessions, missing: V2_FUNCTIONS });
  try {
    const job = seedJob(st);
    const list = await api('/v1/media/recovery', { token: OWNER_TOKEN });
    assert.equal(list.status, 503);
    assert.match(list.body.error, /media_operation_claims_v2\.sql is not applied/);
    const decide = await api(`/v1/media/jobs/${job.id}/reconcile`, { method: 'POST', token: OWNER_TOKEN, body: { org_id: ORG, decision: 'release', reason: 'never submitted' } });
    assert.equal(decide.status, 503);
    assert.equal(job.status, 'queued');
    assert.equal(st.audit.at(-1).event, 'media_operation.resolve_refused');
  } finally { st.restore(); }
});

test('there must be exactly one house owner: with none or two the operator routes are 503, never open', async () => {
  for (const houseOwners of [[], [USER.id, MEMBER.id]]) {
    const st = plane({ sessions, houseOwners });
    try {
      const answer = await api('/v1/media/recovery', { token: OWNER_TOKEN });
      assert.equal(answer.status, 503);
      assert.equal(st.rpcs.length, 0);
    } finally { st.restore(); }
  }
});

test('the hinted webhook path reaches the webhook handler; anything else under it does not', async () => {
  const st = plane();
  try {
    const job = seedJob(st);
    const hint = await hintFor(job.id);
    for (const path of ['/v1/media/webhooks/fal', `/v1/media/webhooks/fal/${job.id}/${hint.token}`, `/v1/media/webhooks/fal/${job.id}/${hint.token}/`]) {
      const answer = await api(path, { method: 'POST', body: {} });
      assert.equal(answer.status, 401, path);
      assert.equal(answer.body.error, 'Missing fal webhook signature headers');
    }
    for (const path of [`/v1/media/webhooks/fal/${job.id}`, `/v1/media/webhooks/fal/${job.id}/${hint.token.slice(0, 42)}`, `/v1/media/webhooks/fal/${job.id.toUpperCase()}/${hint.token}`, `/v1/media/webhooks/fal/not-a-job/${hint.token}`, `/v1/media/webhooks/fal/${job.id}/${hint.token}/extra`]) {
      assert.equal((await api(path, { method: 'POST', body: {} })).status, 404, path);
    }
    assert.equal(st.patchLog.length, 0);
  } finally { st.restore(); }
});

/* ================================== MCP tools ================================== */

const mcp = (name, args, user, mcpEnv = env) => handleMediaMcp(new Request('https://api.mccluster.org/v1/media/mcp', {
  method: 'POST', headers: { 'content-type': 'application/json', 'mcp-method': 'tools/call' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
}), mcpEnv, user);

test('the recovery MCP tools are listed, refused for an ordinary signed-in user and work for the house owner', async () => {
  const listed = await handleMediaMcp(new Request('https://api.mccluster.org/v1/media/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', 'mcp-method': 'tools/list' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  }), env, null);
  const tools = new Map(listed.body.result.tools.map((tool) => [tool.name, tool]));
  assert.deepEqual(tools.get('media.job.reconcile').inputSchema.required, ['org_id', 'job_id', 'decision', 'reason']);
  assert.deepEqual(tools.get('media.job.reconcile').inputSchema.properties.decision.enum, ['release', 'settle', 'bind']);
  assert.ok(tools.has('media.recovery.list'));

  const candidates = { generated_at: 'now', older_than: '00:15:00', counts: { failed_still_reserved: 1 }, by_org: [], candidates: [] };
  const st = plane({ candidates });
  try {
    const job = seedJob(st);
    const args = { org_id: ORG, job_id: job.id, decision: 'release', reason: 'never submitted' };
    for (const [name, toolArgs] of [['media.recovery.list', {}], ['media.job.reconcile', args]]) {
      const refused = await mcp(name, toolArgs, { id: MEMBER.id });
      assert.equal(refused.status, 200);
      assert.equal(refused.body.result.isError, true, name);
      assert.equal(refused.body.result.content[0].text, 'House owner access is required');
      assert.equal((await mcp(name, toolArgs, null)).status, 401, 'no user at all');
    }
    assert.equal(st.rpcs.length, 0);
    assert.equal(st.audit.length, 0);
    assert.equal(job.status, 'queued');

    const list = await mcp('media.recovery.list', { org_id: ORG, older_than_minutes: 20, limit: 5 }, USER);
    assert.equal(list.body.result.isError, undefined);
    assert.deepEqual(JSON.parse(list.body.result.content[0].text), candidates);
    assert.deepEqual(st.rpcCalls('media_operation_recovery_candidates_v1')[0].body, { p_org_id: ORG, p_older_than: '20 minutes', p_limit: 5 });

    const decided = await mcp('media.job.reconcile', args, USER);
    assert.equal(decided.body.result.isError, undefined);
    const outcome = JSON.parse(decided.body.result.content[0].text);
    assert.equal(outcome.outcome, 'released');
    assert.equal(outcome.job_id, job.id);
    assert.equal(job.status, 'failed');
    assert.equal(st.audit.find((row) => row.event === 'media_operation.resolve_requested').actor_user_id, USER.id);
    /* a refusal is a tool-result error that names the reason */
    const again = await mcp('media.job.reconcile', { ...args, decision: 'bind' }, USER);
    assert.equal(again.body.result.isError, true);
    assert.match(again.body.result.content[0].text, /job_already_resolved/);
  } finally { st.restore(); }
});

/* ================= McCluster Core's signature on the operator routes ================= */

const CORE_SECRET = 'shared-core-edge-key';
const coreEnv = { ...env, CORE_EDGE_SIGNING_KEY: CORE_SECRET, CORE_REPLAY_STORE: 'supabase' };

/* A request signed the way core/src/broker-edge-auth.mjs signs one. */
function coreSigned(path, { method = 'GET', body = undefined, secret = CORE_SECRET, signedPath = path.split('?')[0], signedBody = body } = {}) {
  const headers = signCoreRequest({ secret, method, path: signedPath, bodyBytes: signedBody === undefined ? Buffer.alloc(0) : Buffer.from(signedBody) });
  return new Request(`https://api.mccluster.org${path}`, { method, headers, ...(body === undefined ? {} : { body }) });
}
async function send(request, apiEnv = coreEnv) {
  const pending = [];
  const response = await entry.fetch(request, apiEnv, { waitUntil(promise) { pending.push(promise); } });
  await Promise.all(pending);
  return { status: response.status, body: await response.json() };
}

test('a Core-signed decision acts as the house owner: verified, its nonce claimed once, audited as core, bound to the request\'s organization', async () => {
  __resetCoreNonces();
  const st = plane();
  try {
    const job = seedJob(st);
    const body = JSON.stringify({ org_id: ORG, decision: 'release', reason: 'never submitted' });
    const request = coreSigned(`/v1/media/jobs/${job.id}/reconcile`, { method: 'POST', body });
    const replay = request.clone();
    const answer = await send(request);
    assert.equal(answer.status, 200);
    assert.equal(answer.body.outcome, 'released');
    assert.equal(st.rpcCalls('media_resolve_operation_job_v1')[0].body.p_actor_id, USER.id, 'the house owner\'s id');
    assert.equal(st.rpcCalls('media_resolve_operation_job_v1')[0].body.p_org_id, ORG);
    const requested = st.audit.find((row) => row.event === 'media_operation.resolve_requested');
    assert.equal(requested.actor_kind, 'core');
    assert.equal(requested.actor_user_id, USER.id);
    assert.equal(st.nonces.size, 1, 'the mutating call claimed its nonce in the shared store');
    assert.equal(st.calls.some((call) => call.url.includes('/auth/v1/user')), false, 'no user session is consulted');
    assert.equal(job.status, 'failed');
    /* the same envelope again is refused before anything runs */
    __resetCoreNonces(); // another isolate: only the shared store remembers
    const second = await send(replay);
    assert.equal(second.status, 409);
    assert.equal(st.rpcCalls('media_resolve_operation_job_v1').length, 1);
  } finally { st.restore(); }
});

test('a Core-signed read of the candidates acts as the house owner; a signed call carries no query string', async () => {
  __resetCoreNonces();
  const candidates = { generated_at: 'now', older_than: '00:15:00', counts: {}, by_org: [], candidates: [] };
  const st = plane({ candidates });
  try {
    const read = coreSigned('/v1/media/recovery');
    const readAgain = read.clone();
    const answer = await send(read);
    assert.equal(answer.status, 200);
    assert.deepEqual(answer.body, candidates);
    /* the list crosses organizations: its envelope is claimed in the shared store and answers once */
    assert.equal(st.nonces.size, 1, 'the signed read claimed its nonce');
    __resetCoreNonces(); // another isolate: only the shared store remembers
    assert.equal((await send(readAgain)).status, 409, 'a captured signed read does not answer again');
    __resetCoreNonces();
    assert.deepEqual(st.rpcCalls('media_operation_recovery_candidates_v1')[0].body, { p_org_id: null, p_older_than: '15 minutes', p_limit: 50 });
    assert.equal(st.calls.some((call) => call.url.includes('/auth/v1/user')), false);
    /* the signature does not cover a query string, so none is accepted */
    const withQuery = await send(coreSigned(`/v1/media/recovery?org_id=${ORG}`));
    assert.equal(withQuery.status, 400);
    const job = seedJob(st);
    const body = JSON.stringify({ org_id: ORG, decision: 'release', reason: 'never submitted' });
    const postWithQuery = await send(coreSigned(`/v1/media/jobs/${job.id}/reconcile?org_id=${OTHER_ORG}`, { method: 'POST', body }));
    assert.equal(postWithQuery.status, 400);
    assert.equal(st.rpcCalls('media_operation_recovery_candidates_v1').length, 1);
    assert.equal(st.rpcCalls('media_resolve_operation_job_v1').length, 0);
    assert.equal(job.status, 'queued');
  } finally { st.restore(); }
});

test('a Core signature that does not verify is refused on the operator routes, never downgraded to a session', async () => {
  const st = plane({ sessions });
  try {
    const job = seedJob(st);
    const path = `/v1/media/jobs/${job.id}/reconcile`;
    const body = JSON.stringify({ org_id: ORG, decision: 'release', reason: 'never submitted' });
    const cases = [
      ['another key', coreSigned(path, { method: 'POST', body, secret: 'another-key' }), 401],
      ['a signature for another job', coreSigned(path, { method: 'POST', body, signedPath: '/v1/media/jobs/00000000-0000-4000-8000-000000000000/reconcile' }), 401],
      ['a body changed after signing', coreSigned(path, { method: 'POST', body: JSON.stringify({ org_id: ORG, decision: 'release', reason: 'never submitted', evidence: { forged: true } }), signedBody: body }), 401],
      ['a signature for the read used on the decision', coreSigned(path, { method: 'POST', body, signedPath: '/v1/media/recovery' }), 401]
    ];
    for (const [name, request, status] of cases) {
      __resetCoreNonces();
      /* a valid owner session beside a bad signature changes nothing */
      request.headers.set('authorization', `Bearer ${OWNER_TOKEN}`);
      assert.equal((await send(request)).status, status, name);
    }
    __resetCoreNonces();
    assert.equal((await send(coreSigned('/v1/media/recovery', { secret: 'another-key' }))).status, 401);
    /* no signing key configured: fail closed */
    __resetCoreNonces();
    assert.equal((await send(coreSigned(path, { method: 'POST', body }), env)).status, 503);
    /* no shared replay store configured: a mutating call fails closed */
    __resetCoreNonces();
    assert.equal((await send(coreSigned(path, { method: 'POST', body }), { ...env, CORE_EDGE_SIGNING_KEY: CORE_SECRET })).status, 503);
    assert.equal(st.rpcs.length, 0);
    assert.equal(st.audit.length, 0);
    assert.equal(job.status, 'queued');
  } finally { st.restore(); }
});

test('Core\'s signature reaches the two recovery routes and the media MCP only: every neighbouring media route still refuses it before any lookup', async () => {
  const st = plane({ sessions });
  try {
    const job = seedJob(st);
    const body = '{}';
    for (const [method, path] of [
      ['POST', '/v1/media/generate'], ['POST', '/v1/media/bakeoff'], ['GET', `/v1/media/jobs/${job.id}`], ['GET', '/v1/media/budget'],
      ['GET', '/v1/media/usage'], ['GET', '/v1/media/models'], ['POST', '/v1/media/webhooks/fal'],
      ['POST', '/v1/media/recovery'], ['PATCH', '/v1/media/recovery'], ['DELETE', '/v1/media/recovery'],
      ['GET', `/v1/media/jobs/${job.id}/reconcile`], ['PATCH', `/v1/media/jobs/${job.id}/reconcile`],
      ['POST', `/v1/media/jobs/${job.id.toUpperCase()}/reconcile`], ['POST', `/v1/media/jobs/${job.id}/reconcile/extra`],
      ['POST', `/v1/media/jobs/${job.id}/release`], ['GET', '/v1/media/recovery/candidates'], ['GET', '/v1/media/Recovery']
    ]) {
      __resetCoreNonces();
      const before = st.calls.length;
      const answer = await send(coreSigned(path, { method, ...(method === 'GET' ? {} : { body }) }));
      assert.equal(answer.status, 403, `${method} ${path}`);
      assert.equal(answer.body.code, 'core_route_not_allowed', `${method} ${path}`);
      assert.equal(st.calls.length, before, `${method} ${path}: refused before any lookup`);
    }
    assert.equal(job.status, 'queued');
  } finally { st.restore(); }
});

test('with no single house owner a Core-signed operator call is 503', async () => {
  __resetCoreNonces();
  const st = plane({ houseOwners: [] });
  try {
    assert.equal((await send(coreSigned('/v1/media/recovery'))).status, 503);
    assert.equal(st.rpcs.length, 0);
  } finally { st.restore(); }
});

test('a deploy alone does not start the recovery sweep: the cron runs it only when the flag is "true"', async () => {
  const { mediaRecoverySweepEnabled } = await import('../src/entry.js');
  for (const value of [undefined, null, '', 'false', '0', 'yes', 'TRUE ']) {
    assert.equal(mediaRecoverySweepEnabled({ MEDIA_RECOVERY_SWEEP_ENABLED: value }), value === 'TRUE ', JSON.stringify(value));
  }
  assert.equal(mediaRecoverySweepEnabled({ MEDIA_RECOVERY_SWEEP_ENABLED: 'true' }), true);
  assert.equal(mediaRecoverySweepEnabled(undefined), false);
  /* the scheduled handler: with the flag absent no recovery read or RPC is made */
  const st = plane();
  try {
    seedJob(st);
    const pending = [];
    await entry.scheduled({ scheduledTime: Date.UTC(2026, 10, 10, 0, 7) }, coreEnv, { waitUntil(promise) { pending.push(promise); } });
    await Promise.all(pending);
    assert.equal(st.rpcCalls('media_operation_recovery_candidates_v1').length, 0, 'no candidates read without the flag');
    /* and with it, the same tick runs the sweep (so the assertion above is not vacuous) */
    const running = [];
    await entry.scheduled({ scheduledTime: Date.UTC(2026, 10, 10, 0, 7) }, { ...coreEnv, MEDIA_RECOVERY_SWEEP_ENABLED: 'true' }, { waitUntil(promise) { running.push(promise); } });
    await Promise.all(running);
    assert.ok(st.rpcCalls('media_operation_recovery_candidates_v1').length >= 1, 'the flag starts the sweep');
  } finally { st.restore(); }
});

/* ============== reservation review, 2026-11-10: settlement after a release or a provider failure ============== */
/* Reproduced by the independent reservation review on this plane and on real PostgreSQL. Each test fails on
   the series as first pushed (the job stayed reserved for good, or a released job's late success was dropped). */
const late = { request_id: 'R-late', status: 'OK', payload: { images: [{ url: 'https://cdn.invalid/late.png' }] } };
const hintParts = async (jobId) => { const [id, token] = (await webhookUrlFor(hintEnv, ORIGIN, jobId)).split('/').slice(-2); return { jobId: id, token }; };
const hintedSuccess = async (jobId) => handleFalWebhook(new Request(`${ORIGIN}/v1/media/webhooks/fal`, { method: 'POST', body: '{}' }), hintEnv, { verify: async () => late }, await hintParts(jobId));
const operatorRelease = (jobId) => reconcileJob(new Request(`${ORIGIN}/v1/media/jobs/${jobId}/reconcile`, {
  method: 'POST', body: JSON.stringify({ org_id: ORG, decision: 'release', reason: 'console showed nothing', evidence: { checked: true } })
}), hintEnv, USER, jobId);

test('R1 a released job whose completion write fails once is finished by the provider\'s retry, not ignored', async () => {
  let failOnce = true;
  const st = plane({ patchFails: (entry) => { if (entry.body?.status === 'completed' && failOnce) { failOnce = false; return true; } return false; } });
  try {
    const fal = provider({ mode: 'uncertain' });
    await createGeneration(req({ ...PAYLOAD, operation_id: 'op-r1' }), hintEnv, USER, { submit: fal.submit }).catch(() => null);
    const job = st.onlyJob();
    await operatorRelease(job.id);
    await assert.rejects(hintedSuccess(job.id), 'the first delivery fails on the completion write');
    await hintedSuccess(job.id);
    assert.equal(job.status, 'completed', 'the retry completes the job from the durable row');
    assert.equal(job.provider_request_id, 'R-late');
  } finally { st.restore(); }
});

test('R2 an operator release that lands between the webhook\'s read and its attach does not drop the late success', async () => {
  let releaseNow = null;
  const st = plane({ beforePatch: async (entry) => {
    if (entry.body?.provider_status?.outcome === 'attached_by_webhook' && releaseNow) { const go = releaseNow; releaseNow = null; await go(); }
  } });
  try {
    const fal = provider({ mode: 'uncertain' });
    await createGeneration(req({ ...PAYLOAD, operation_id: 'op-r2' }), hintEnv, USER, { submit: fal.submit }).catch(() => null);
    const job = st.onlyJob();
    releaseNow = () => operatorRelease(job.id);
    await hintedSuccess(job.id);
    assert.equal(job.status, 'completed', 'attachedFrom comes from the row the attach wrote');
  } finally { st.restore(); }
});

test('R3 a request the provider failed is not written completed by a poll before its ERROR webhook; the webhook fails and releases it', async () => {
  const st = plane();
  try {
    const fal = provider();
    const job = await createGeneration(req({ ...PAYLOAD, operation_id: 'op-r3' }), hintEnv, USER, { submit: fal.submit });
    /* the provider's status vocabulary has no failure value: a failed request reads COMPLETED and its result is the error */
    await getGeneration(new Request(`${ORIGIN}/v1/media/jobs/${job.id}?org_id=${ORG}`), hintEnv, USER, job.id, true, {
      status: async () => ({ status: 'COMPLETED' }),
      result: async () => { throw Object.assign(new Error('the generation failed'), { status: 422 }); }
    }).catch(() => null);
    const row = st.onlyJob();
    assert.notEqual(row.status, 'completed', 'an unreadable result leaves the job open');
    await handleFalWebhook(new Request(`${ORIGIN}/v1/media/webhooks/fal`, { method: 'POST', body: '{}' }), hintEnv,
      { verify: async () => ({ request_id: job.provider_request_id, status: 'ERROR', error: 'the generation failed', payload: {} }) }, null);
    assert.equal(row.status, 'failed');
    assert.equal(st.releases, 1, 'the reservation is released once');
  } finally { st.restore(); }
});

