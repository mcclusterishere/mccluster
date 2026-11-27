import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://isolated-targets.invalid';
process.env.SUPABASE_SECRET_KEY = 'isolated-fixture';
process.env.MCCLUSTER_CORE_ID = 'isolated-target-test';
const { refreshMosaicCapability, mosaicMachineSha256 } = await import('../src/equiquant-runtime.mjs');
const { MOSAIC_JOB, MOSAIC_MODEL_HASHES } = await import('../src/equiquant-mosaic-contract.mjs');
const { mosaicCapabilityPayload, mosaicExecutionPayload } = await import('../src/equiquant-signatures.mjs');
const { validMosaicSignature } = await import('../src/equiquant-verify.mjs');
const { equiquantMosaicReplay } = await import('../src/executors/equiquant-mosaic-replay.mjs');
const { claimNext } = await import('../src/supabase.mjs');
const { buildCompletionEvidence } = await import('../src/completion-evidence.mjs');

const org = '00000000-0000-4000-8000-000000000001';
const project = '00000000-0000-4000-8000-000000000002';
const id = '00000000-0000-4000-8000-000000000003';

test('capability requires operator-bound identity and all pinned fits, then signs only this target, precision and run', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(new URL(url));
    assert.equal(new URL(url).pathname, '/rest/v1/rpc/equiquant_attest_target');
    const { p_attestation: att } = JSON.parse(init.body);
    assert.equal(validMosaicSignature(att.signing_public_key, att.signature, mosaicCapabilityPayload(att)), true);
    assert.deepEqual(att.model_hashes, MOSAIC_MODEL_HASHES);
    return Response.json({ok:true});
  });
  delete process.env.MCCLUSTER_EQUIQUANT_TARGET;
  assert.equal(await refreshMosaicCapability(), null);
  process.env.MCCLUSTER_EQUIQUANT_TARGET = 'prime';
  process.env.MCCLUSTER_EQUIQUANT_MACHINE_SHA256 = 'unverified';
  await assert.rejects(refreshMosaicCapability(), /identity is unverified/);
  process.env.MCCLUSTER_EQUIQUANT_MACHINE_SHA256 = mosaicMachineSha256();
  process.env.MCCLUSTER_EQUIQUANT_TARGET = 'connected_inference';
  await assert.rejects(refreshMosaicCapability(), /Unsupported/);
  process.env.MCCLUSTER_EQUIQUANT_TARGET = 'ovh_core';
  await assert.rejects(refreshMosaicCapability(), /OVH Core deployment identity unavailable/);
  assert.equal(calls.length, 0);
  process.env.MCCLUSTER_EQUIQUANT_TARGET = 'prime';
  const cap = await refreshMosaicCapability();
  assert.equal(calls.length, 1);
  assert.equal(await refreshMosaicCapability(), cap);
  assert.equal(calls.length, 1);
  const job = { id, org_id: org, target_type: 'equiquant_project', target_id: project, job_type: MOSAIC_JOB,
    locked_by: 'isolated-target-test#fixture-lease', input: {target: 'prime', hardware_sha256: cap.hardware_sha256, node_version:cap.node_version, scenario: 'pooled'} };
  const output = await equiquantMosaicReplay(job);
  const { execution: e } = output;
  assert.equal(e.signing_public_key, cap.signing_public_key);
  assert.ok(Number.isSafeInteger(e.elapsed_ns) && e.elapsed_ns > 0);
  assert.equal(e.precision, 'binary64');
  assert.equal(e.backend, 'node_cpu');
  assert.equal(e.model_sha256, MOSAIC_MODEL_HASHES.pooled);
  assert.equal(validMosaicSignature(cap.signing_public_key, e.signature, mosaicExecutionPayload(e, job)), true);
  buildCompletionEvidence(job, output);
  for (const change of [{ precision:'float32' }, {elapsed_ns:e.elapsed_ns + 1}, {backend:'inference'}, {target:'ovh_core'},
    {signing_public_key:'x'.repeat(59)}, {model_sha256:'0'.repeat(64)}, {hardware_sha256:'0'.repeat(64)}]) {
    assert.throws(() => buildCompletionEvidence(job, {...output,execution:{...e,...change}}), /execution receipt/);
  }
  for (const forged of [{id:project}, {target_id:id}, {org_id:id}, {locked_by:'other-runner#lease'}]) {
    assert.throws(() => buildCompletionEvidence({...job,...forged},output), /execution receipt/);
  }
  assert.equal(validMosaicSignature(cap.signing_public_key, cap.signature, mosaicCapabilityPayload({...cap,target:'ovh_core'})), false);
  await assert.rejects(equiquantMosaicReplay({...job,input:{...job.input,target:'ovh_core'}}), /No current capability/);
  delete process.env.MCCLUSTER_EQUIQUANT_TARGET;
  delete process.env.MCCLUSTER_EQUIQUANT_MACHINE_SHA256;
});

test('target and hardware constrain queue queries before the limit and again on claim', async t => {
  const hardware = 'a'.repeat(64);
  let fetched;
  const patches = [];
  const queued = target => ({ id, org_id:org, job_type:MOSAIC_JOB, input:{scenario:'group_levels',target,hardware_sha256:hardware,node_version:process.versions.node} });
  t.mock.method(globalThis, 'fetch', async (raw, init) => {
    const url = new URL(raw);
    const q = url.searchParams;
    if (url.pathname.endsWith('/orgs')) return Response.json([{id:org,enabled:true}]);
    if (init.method === 'PATCH') {
      patches.push(q);
      return Response.json([queued('prime')]);
    }
    if (q.has('locked_at') || q.has('created_at')) return Response.json([]);
    fetched = q;
    // Include two out-of-scope rows to check the second, in-process gate.
    return Response.json([{...queued('prime'),job_type:'repo_health'}, queued('ovh_core'), queued('prime')]);
  });
  assert.equal(await claimNext([MOSAIC_JOB], {mosaicOnly:true}), null);
  const capability = {target:'prime',hardware_sha256:hardware,node_version:process.versions.node};
  const found = await claimNext([MOSAIC_JOB,'repo_health'], {capability,mosaicOnly:true});
  assert.equal(found.input.target, 'prime');
  assert.equal(patches.length, 1);
  for (const q of [fetched, patches[0]]) {
    assert.equal(q.get('job_type'), 'eq.' + MOSAIC_JOB);
    assert.equal(q.get('input->>target'), 'eq.prime');
    assert.equal(q.get('input->>hardware_sha256'), 'eq.' + hardware);
    assert.equal(q.get('input->>node_version'), 'eq.' + process.versions.node);
  }
  patches.length = 0;
  const ovh = await claimNext([MOSAIC_JOB], {capability:{target:'ovh_core',hardware_sha256:'b'.repeat(64),node_version:process.versions.node}});
  assert.equal(ovh, null, 'a different target or hardware never reaches the CAS');
  assert.equal(patches.length, 0);
  assert.match(fetched.get('or'), /input->>target.eq.ovh_core,input->>hardware_sha256.eq.b{64}/);
});
