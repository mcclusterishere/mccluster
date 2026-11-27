import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { handleEquiquant } from '../src/equiquant.js';
import {
  MOSAIC_CODE_SHA256, MOSAIC_MODEL_HASHES, MOSAIC_SOURCE, MOSAIC_SPEC_SHA256, mosaicReference
} from '../../../core/src/equiquant-mosaic-contract.mjs';
import { mosaicCapabilityPayload, mosaicExecutionPayload } from '../../../core/src/equiquant-signatures.mjs';

const actor = '00000000-0000-4000-8000-000000000011';
const org = '00000000-0000-4000-8000-000000000022';
const project = '00000000-0000-4000-8000-000000000033';
const jobId = '00000000-0000-4000-8000-000000000044';
const otherId = '00000000-0000-4000-8000-000000000055';
const env = {
  SUPABASE_URL: 'https://database.invalid', SUPABASE_SERVICE_ROLE_KEY: 'unit-test-rpc-credential', EQUIQUANT_ENABLED: 'true'
};

function action(body, authenticate = async () => ({ id: actor })) {
  const request = new Request('https://api.invalid/v1/equiquant', {
    method: 'POST', body: JSON.stringify({ org_id: org, project_id: project, ...body })
  });
  return handleEquiquant(request, env, authenticate);
}

// Only the project RPC and workspace membership read exist in this offline test.
function mockProject(t, respond) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.startsWith(env.SUPABASE_URL + '/rest/v1/org_members?')) {
      return Response.json([{ role: 'viewer', orgs: { id: org, enabled: true } }]);
    }
    assert.equal(url, env.SUPABASE_URL + '/rest/v1/rpc/equiquant_action');
    assert.equal(options.method, 'POST');
    const args = JSON.parse(options.body);
    calls.push(args);
    return respond(args);
  });
  return calls;
}

// A test key represents a runner whose key the database bound at claim time.
// Each fixture uses a new ephemeral Ed25519 identity and signs both records.
function fixture({ scenario = 'pooled', ageMs = 0, target = 'prime', capability = {}, signedJob = {} } = {}) {
  const keys = generateKeyPairSync('ed25519');
  const signing_public_key = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const fingerprint = '9'.repeat(64);
  const attestation = {
    target, backend: 'node_cpu', precision: 'binary64', hardware_sha256: fingerprint,
    code_sha256: MOSAIC_CODE_SHA256, spec_sha256: MOSAIC_SPEC_SHA256,
    observations_sha256: MOSAIC_SOURCE.observations_sha256, model_hashes: MOSAIC_MODEL_HASHES,
    node_version: process.versions.node, worker_id: 'worker-unit-private', signing_public_key,
    observed_at: new Date(Date.now() - ageMs).toISOString(), ...capability
  };
  const signature = message => sign(null, Buffer.from(message), keys.privateKey).toString('base64url');
  attestation.signature = signature(mosaicCapabilityPayload(attestation));
  const execution = {
    target, backend: attestation.backend, precision: attestation.precision,
    hardware_sha256: fingerprint, code_sha256: MOSAIC_CODE_SHA256, spec_sha256: MOSAIC_SPEC_SHA256,
    model_sha256: MOSAIC_MODEL_HASHES[scenario], node_version: attestation.node_version,
    worker_id: attestation.worker_id, signing_public_key, elapsed_ns: 12345678
  };
  const job = { id: jobId, org_id: org, target_id: project, input: { scenario }, ...signedJob };
  execution.signature = signature(mosaicExecutionPayload(execution, job));
  const expected = mosaicReference(scenario);
  const run = {
    ...MOSAIC_SOURCE, job_id: jobId, scenario, status: 'done', result_sha256: expected.resultSha256,
    held_out_mse: expected.heldOutMse, folds: 13, target, hardware_sha256: fingerprint, attestation, execution
  };
  const entry = { id: target, label: target, available: true, attestation };
  const state = { project: { id: project, membership: 'owner' }, targets: [entry], runs: [run], release: null };
  return { state, run, entry };
}

const replay = { action: 'replay', data: { scenario: 'pooled', target: 'prime' } };
const review = { action: 'review', data: { evidence_ids: [actor], confirmed: true, job_id: jobId } };

function assertRedacted(payload, run) {
  const text = JSON.stringify(payload);
  for (const privateValue of [env.SUPABASE_SERVICE_ROLE_KEY, run.attestation.worker_id,
    run.attestation.signing_public_key, run.attestation.signature, run.execution.signature]) {
    assert.ok(!text.includes(privateValue), 'a private registration or signing field reached the client');
  }
}

test('refuses unverified sessions, untrusted execution fields and non-allowlisted runs before persistence', async t => {
  const store = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected store call'); });
  assert.equal((await action({ action: 'state' }, async () => null)).status, 401);
  for (const invalid of [
    { ...replay, p_actor: actor }, { ...replay, data: { ...replay.data, scenario: 'custom' } },
    { ...replay, data: { ...replay.data, target: 'external' } },
    ...['hardware_sha256', 'capability_signature', 'attestation', 'signing_public_key', 'precision',
      'elapsed_ns', 'execution_verified', 'source', 'url', 'command'].map(field =>
        ({ ...replay, data: { ...replay.data, [field]: 'caller-controlled' } })),
    { action: 'evidence', data: { consent: false } }, { action: 'review', data: { confirmed: true } }
  ]) assert.equal((await action(invalid)).status, 400);
  assert.equal((await action({ action: 'state', payload: 'x'.repeat(16500) })).status, 413);
  assert.equal(store.mock.callCount(), 0);
});

test('fresh compatible signed capability is used as the RPC replay guard; a rotation race surfaces a conflict', async t => {
  const { state, run, entry } = fixture();
  let rotated = false;
  const calls = mockProject(t, args => {
    if (args.p_action === 'state') return Response.json(state);
    assert.deepEqual(args, { p_actor: actor, p_org: org, p_project: project, p_action: 'replay',
      p_data: { ...replay.data, capability_signature: entry.attestation.signature } });
    return rotated
      ? Response.json({ code: 'PT409', message: 'Target capability changed' }, { status: 409 })
      : Response.json(state);
  });
  const response = await action(replay);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.targets[0].available, true);
  assert.equal(payload.targets[0].precision, 'binary64');
  assert.equal(payload.runs[0].execution_verified, true);
  assert.equal(payload.runs[0].execution.elapsed_ns, run.execution.elapsed_ns);
  assertRedacted(payload, run);
  rotated = true;
  const conflict = await action(replay);
  assert.equal(conflict.status, 409);
  assertRedacted(await conflict.json(), run);
  assert.deepEqual(calls.map(call => call.p_action), ['state', 'replay', 'state', 'replay']);
});

test('signed unsupported, mismatched, stale, future and modified capabilities never enqueue', async t => {
  let state;
  const calls = mockProject(t, () => Response.json(state));
  const modified = fixture();
  modified.entry.attestation.observed_at = new Date(Date.parse(modified.entry.attestation.observed_at) - 5000).toISOString();
  const malformed = fixture();
  malformed.entry.attestation.signature = 'incomplete';
  const noAuthority = fixture();
  noAuthority.entry.available = false;
  const cases = [
    fixture({ target: 'connected_inference' }), fixture({ capability: { precision: 'int4' } }),
    fixture({ capability: { backend: 'gguf' } }), fixture({ capability: { spec_sha256: '8'.repeat(64) } }),
    fixture({ capability: { model_hashes: { ...MOSAIC_MODEL_HASHES, group_levels: '7'.repeat(64) } } }),
    fixture({ ageMs: 180_000 }), fixture({ ageMs: -60_000 }), modified, malformed, noAuthority
  ];
  for (const f of cases) {
    state = f.state;
    const admitted = await action({ action: 'replay', data: { scenario: 'pooled', target: f.entry.id } });
    assert.equal(admitted.status, 409);
    const read = await (await action({ action: 'state' })).json();
    assert.equal(read.targets[0].available, false);
    assertRedacted(read, f.run);
  }
  assert.ok(calls.every(call => call.p_action === 'state'));
});

test('recomputes signature and model pins for display and review, including job and tenant binding', async t => {
  let state;
  const calls = mockProject(t, () => Response.json(state));
  const cases = [
    fixture({ signedJob: { id: otherId } }), fixture({ signedJob: { org_id: otherId } }),
    fixture({ signedJob: { target_id: otherId } }), fixture({ signedJob: { input: { scenario: 'group_levels' } } })
  ];
  const mutations = [
    run => { run.result_sha256 = 'e'.repeat(64); },
    run => { run.held_out_mse += 0.02; },
    run => { run.observations_sha256 = '6'.repeat(64); },
    run => { run.execution.elapsed_ns += 1; },
    run => { run.execution.elapsed_ns = 0; },
    run => { run.execution.model_sha256 = MOSAIC_MODEL_HASHES.group_slopes; },
    run => { run.target = 'ovh_core'; },
    run => { run.hardware_sha256 = '4'.repeat(64); },
    run => { run.execution.signing_public_key = fixture().run.execution.signing_public_key; },
    run => { run.execution.signature = 'malformed'; },
    run => { run.attestation.signature = 'malformed'; },
    run => { run.execution = null; }
  ];
  for (const mutate of mutations) {
    const f = fixture();
    mutate(f.run);
    cases.push(f);
  }
  for (const f of cases) {
    state = f.state;
    f.run.execution_verified = true; // A stored flag cannot substitute for a new verification.
    const read = await (await action({ action: 'state' })).json();
    assert.equal(read.runs[0].status, 'unverified');
    assert.equal(read.runs[0].execution_verified, false);
    assert.equal(read.runs[0].execution, undefined);
    assert.equal(read.runs[0].attestation, undefined);
    assert.equal((await action(review)).status, 409);
  }
  assert.ok(calls.every(call => call.p_action === 'state'));
});

test('an authentic historical receipt is reviewable after capability expiry but cannot admit a new run', async t => {
  const { state, run } = fixture({ ageMs: 86_400_000 });
  const calls = mockProject(t, () => Response.json(state));
  const response = await action(review);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.targets[0].available, false);
  assert.equal(payload.runs[0].execution_verified, true);
  assertRedacted(payload, run);
  assert.deepEqual(calls[1].p_data, review.data);
  assert.equal((await action(replay)).status, 409);
  assert.deepEqual(calls.map(call => call.p_action), ['state', 'review', 'state']);
});

test('exports only a signed reviewed release and cites the dataset DOI and exact experiment', async t => {
  const { state, run } = fixture({ ageMs: 86_400_000 });
  state.evidence = [{ credit_name: 'Pending name' }];
  const calls = mockProject(t, () => Response.json(state));
  assert.equal((await action({ action: 'citation' })).status, 409);
  const release = {
    id: otherId, title: 'Reviewed pilot', reviewed_at: '2026-11-27T19:00:00Z',
    credits: ['Formal analysis', 'Software'].map(role => ({ profile_id: actor, role, credit_name: 'Researcher A' })),
    run: structuredClone(run)
  };
  state.release = release;
  delete release.run.execution;
  assert.equal((await action({ action: 'citation' })).status, 409);
  release.run = { ...run, job_id: otherId };
  assert.equal((await action({ action: 'citation' })).status, 409);
  release.run = run;
  const response = await action({ action: 'citation' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const body = await response.json();
  const { citation, filename } = body;
  assert.deepEqual(citation.author, [{ literal: 'Researcher A' }]);
  assert.deepEqual(citation.issued, { 'date-parts': [[2026, 11, 27]] });
  assert.equal(citation.DOI, undefined);
  for (const value of [run.dataset_doi, run.source_commit, run.observations_sha256, run.result_sha256,
    run.execution.model_sha256, run.execution.code_sha256, run.execution.spec_sha256, run.execution.target,
    run.execution.hardware_sha256, run.execution.elapsed_ns + ' ns', 'CC BY 4.0', 'binary64', 'Formal analysis', 'Software']) {
    assert.ok(citation.note.includes(value));
  }
  assert.ok(!JSON.stringify(body).includes('Pending name'));
  assertRedacted(body, run);
  assert.ok(filename.endsWith('.csl.json'));
  assert.ok(calls.every(call => call.p_action === 'state'));
});

test('unconfigured research route stays closed without workspace or RPC access', async t => {
  const store = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected store call'); });
  const request = new Request('https://api.invalid/v1/equiquant', { method: 'POST', body: '{}' });
  const response = await handleEquiquant(request, {}, async () => ({ id: actor }));
  assert.equal(response.status, 503);
  assert.equal(store.mock.callCount(), 0);
});
