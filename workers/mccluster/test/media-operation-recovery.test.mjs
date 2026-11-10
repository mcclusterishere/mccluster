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
   - the member's refresh.

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

import {
  classifyReservationError, createGeneration, getGeneration, handleFalWebhook, operationFingerprint,
  applyProviderStatus, pollProviderStatus, reconcileFalJobCost, verifyWebhookHint, webhookUrlFor
} from '../src/media/router.js';
import { verifyFalWebhook } from '../src/media/fal.js';
import {
  ORG, USER, MEMBER, MODEL, WINDOW_MS, env, json, matchesFilter, plane, provider, traced
} from './helpers/media-plane.mjs';

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
