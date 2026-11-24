import test from 'node:test';
import assert from 'node:assert/strict';
import { generateNodeIdentity, signRequest, SIGNATURE_HEADERS } from '../src/compute/signature.mjs';
import {
  ATTESTATION_SCHEMA, DEVICE_FACTS_SCHEMA, JOB_CONTRACT, RECEIPT_SCHEMA, buildReceipt, canonicalJson, completionAttestation, completingLease, deviceFactsAtCompletion,
  featureRequirements, generateReceiptKey, hashJson, jobResult, jobView, receiptKeyFromEnv, receiptKeyInfo, signReceipt,
  validateJobSubmission, verifyAttestation, verifyReceipt
} from '../src/compute/jobs.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const NODE = 'node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function fixture({ status = 'done', output = { model: 'fixture', content: 'hello', usage: { tokens: 2 } } } = {}) {
  const task = {
    id: '10000000-0000-4000-8000-000000000001', org_id: ORG, capability: 'ai.chat', implementation: null,
    input: { prompt: 'say hello', num_predict: 32 }, requirements: {}, priority: 0, status,
    run_after: '2026-11-23T00:00:00.000Z', attempts: 1, max_attempts: 3, locked_by_node_id: null, locked_at: null,
    output: status === 'done' ? output : null, last_error: status === 'failed' ? 'executor exploded' : null,
    metadata: { source: 'device-jobs/1', client: { name: 'test', version: '1', contract: JOB_CONTRACT } },
    created_at: '2026-11-23T00:00:00.000Z', updated_at: '2026-11-23T00:00:05.000Z'
  };
  const lease = {
    id: '20000000-0000-4000-8000-000000000001', task_id: task.id, node_id: NODE, implementation: 'fixture.echo.local', attempt: 1,
    status: status === 'done' ? 'done' : 'failed', expires_at: '2026-11-23T00:02:00.000Z', started_at: '2026-11-23T00:00:01.000Z',
    completed_at: '2026-11-23T00:00:04.000Z', progress: { state: 'running' }, result: status === 'done' ? output : null,
    last_error: null, created_at: '2026-11-23T00:00:00.500Z', updated_at: '2026-11-23T00:00:04.000Z'
  };
  const node = {
    id: NODE, org_id: ORG, display_name: 'fixture node', public_key_pem: null, key_fingerprint: 'f'.repeat(64), state: 'online',
    agent_version: '0.4.0', inventory: { platform: 'linux', arch: 'x64', gpus: [], runtime: { hardware_mode: 'cpu-only', measured_inference: null } },
    labels: { enrolled_trust: 'owned', site: 'staging' }, last_seen_at: '2026-11-23T00:00:04.000Z'
  };
  return { task, lease, node };
}

test('canonical JSON is key-order independent and hashes agree', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
  assert.equal(hashJson({ b: 1, a: 2 }), hashJson({ a: 2, b: 1 }));
  assert.equal(hashJson(null), null);
  assert.equal(hashJson(undefined), null);
});

test('submission validation fences org, ids, sizes and routing keys', () => {
  const ok = validateJobSubmission({ capability: 'ai.chat', input: { prompt: 'hi' }, requirements: { vision: true, provider: 'x', features: { gpu: true } }, client: { name: 'prime-windows', version: '0.1' }, priority: 5 }, { canonicalOrg: ORG });
  assert.equal(ok.org_id, ORG);
  assert.deepEqual(ok.requirements, { features: { vision: true, gpu: true } });
  assert.equal(ok.client.name, 'prime-windows');
  assert.equal(ok.client.contract, JOB_CONTRACT);
  assert.equal(ok.max_attempts, 3);
  assert.throws(() => validateJobSubmission({ capability: 'ai.chat', org_id: '00000000-0000-4000-8000-000000000002' }, { canonicalOrg: ORG }), (e) => e.code === 'CROSS_ORG_DENIED' && e.status === 403);
  assert.throws(() => validateJobSubmission({ capability: 'Bad Cap' }, { canonicalOrg: ORG }), (e) => e.code === 'JOB_INVALID');
  assert.throws(() => validateJobSubmission({ capability: 'ai.chat', input: [] }, { canonicalOrg: ORG }), (e) => e.code === 'JOB_INVALID');
  assert.throws(() => validateJobSubmission({ capability: 'ai.chat', input: { blob: 'x'.repeat(1_100_000) } }, { canonicalOrg: ORG }), (e) => e.code === 'JOB_INPUT_TOO_LARGE');
  assert.throws(() => validateJobSubmission({ capability: 'ai.chat', priority: 1000 }, { canonicalOrg: ORG }), (e) => e.code === 'JOB_INVALID');
  assert.throws(() => validateJobSubmission({ capability: 'ai.chat' }, {}), (e) => e.code === 'ORG_REQUIRED');
  assert.deepEqual(featureRequirements({ hosting: 'owned', billing: 'free' }), {});
});

test('job view, result and receipt availability follow the durable rows', () => {
  const { task, lease, node } = fixture();
  const view = jobView({ task, leases: [lease], node });
  assert.equal(view.schema, JOB_CONTRACT);
  assert.equal(view.status, 'done');
  assert.equal(view.terminal, true);
  assert.equal(view.result_available, true);
  assert.equal(view.receipt_available, true);
  assert.equal(view.execution.lease_id, lease.id);
  assert.equal(view.node.node_id, NODE);
  assert.equal(view.node.hardware_mode, 'cpu-only');
  assert.equal(view.input_sha256, hashJson(task.input));
  const result = jobResult({ task, leases: [lease], node });
  assert.equal(result.output_sha256, hashJson(task.output));
  assert.equal(result.implementation, 'fixture.echo.local');
  const running = fixture({ status: 'running' });
  assert.throws(() => jobResult({ task: running.task, leases: [running.lease] }), (e) => e.code === 'JOB_NOT_DONE' && e.status === 409);
  assert.throws(() => buildReceipt({ task: running.task, leases: [running.lease] }), (e) => e.code === 'JOB_NOT_TERMINAL');
  assert.throws(() => jobView({ task: null }), (e) => e.code === 'JOB_NOT_FOUND');
});

test('the completing lease is the done one, not merely the latest', () => {
  const { task, lease } = fixture();
  const later = { ...lease, id: '20000000-0000-4000-8000-000000000002', attempt: 2, status: 'failed', created_at: '2026-11-23T00:01:00.000Z' };
  assert.equal(completingLease(task, [later, lease]).id, lease.id);
});

test('receipts are versioned, hash input and output, report single-device honestly and verify with the Core key', () => {
  const { task, lease, node } = fixture();
  const key = generateReceiptKey();
  const receipt = signReceipt(buildReceipt({ task, leases: [lease], node, issuedAt: '2026-11-23T00:00:06.000Z', issuer: { instance: 'core-test', deployment_sha: 'abc' } }), key);
  assert.equal(receipt.schema, RECEIPT_SCHEMA);
  assert.equal(receipt.signed, true);
  assert.equal(receipt.input_sha256, hashJson(task.input));
  assert.equal(receipt.output_sha256, hashJson(task.output));
  assert.equal(receipt.execution.node_id, NODE);
  assert.equal(receipt.execution.duration_ms, 3000);
  assert.equal(receipt.execution.result_consistent, true);
  assert.deepEqual(receipt.inference, { mode: 'single-device', devices: [NODE], group: null });
  assert.equal(receipt.node_attestation, null);
  assert.equal(receipt.signature.key_id, key.keyId);
  assert.deepEqual(verifyReceipt(receipt, key.publicKeyPem), { ok: true, reason: null });
  const tampered = { ...receipt, output_sha256: hashJson({ model: 'fixture', content: 'forged' }) };
  assert.equal(verifyReceipt(tampered, key.publicKeyPem).ok, false);
  const other = generateReceiptKey();
  assert.match(verifyReceipt(receipt, other.publicKeyPem).reason, /different Core key/);
  const unsigned = signReceipt(buildReceipt({ task, leases: [lease], node }), null);
  assert.equal(unsigned.signed, false);
  assert.equal(unsigned.signature, null);
  assert.match(verifyReceipt(unsigned, key.publicKeyPem).reason, /unsigned/);
});

// A completion as the gateway records it: the node's signature plus the device
// facts read from the node row at that moment.
function completed({ output, node, identity = generateNodeIdentity(), capturedAt = '2026-11-23T00:00:04.500Z' }) {
  const { task, lease } = fixture({ output });
  const bound = { ...lease, node_id: identity.nodeId, implementation: 'qwen3-vl.4b.local', result: output };
  const path = `/v1/compute/leases/${bound.id}/complete`;
  const headers = signRequest({ privateKeyPem: identity.privateKeyPem, method: 'POST', path, nodeId: identity.nodeId, bodyBytes: Buffer.from(JSON.stringify({ lease_token: 't', result: output })) });
  const enrolled = { ...node, id: identity.nodeId, public_key_pem: identity.publicKeyPem, key_fingerprint: identity.fingerprint };
  const attestation = completionAttestation({ node: enrolled, leaseId: bound.id, attempt: 1, path, headers, result: output, implementation: bound.implementation, capturedAt });
  return { task, lease: bound, node: enrolled, attestation, identity };
}

const DEVICE_A = {
  display_name: 'device-a', labels: {},
  capabilities: [{ capability: 'ai.chat', implementation: 'qwen3-vl.4b.local', backend: 'ollama', model: 'qwen3-vl:4b', features: { chat: true, model_digest: 'abc123', runtime_version: '0.0.0-test' } }],
  inventory: {
    platform: 'darwin', arch: 'arm64',
    gpus: [{ vendor: 'apple', model: 'M-series', form: 'integrated', memory: 'shared', compute: 'metal', uuid: 'must-not-appear', vram_bytes: 1 }],
    runtime: { hardware_mode: 'gpu-verified', gpu_verified_at: '2026-11-23T00:00:01.000Z', gpu_evidence: { source: 'ollama:/api/ps', model: 'qwen3-vl:4b', digest: 'abc123', size_vram_bytes: 10, size_bytes: 10, processor_gpu_percent: 100, running_models: 1, checked_at: '2026-11-23T00:00:01.000Z', extra: 'dropped' } }
  }
};

test('the receipt names the device, the compute mode with its engine evidence and the model that ran, under the Core signature', () => {
  const output = { model: 'qwen3-vl:4b', content: 'ok', usage: { eval_count: 3, model_digest: 'abc123', ollama_version: '0.0.0-test' } };
  const { task, lease, node, attestation } = completed({ output, node: DEVICE_A });
  const key = generateReceiptKey();
  const receipt = signReceipt(buildReceipt({ task, leases: [lease], node, attestation }), key);
  assert.equal(receipt.execution.arch, 'arm64');
  assert.equal(receipt.execution.platform, 'darwin');
  assert.equal(receipt.execution.hardware_mode, 'gpu-verified');
  assert.equal(receipt.execution.node_display_name, 'device-a');
  assert.deepEqual(receipt.execution.device_facts, { bound: true, source: 'node-reported-at-completion', captured_at: '2026-11-23T00:00:04.500Z' });
  assert.deepEqual(receipt.execution.hardware_evidence, {
    gpu_verified_at: '2026-11-23T00:00:01.000Z',
    engine: { source: 'ollama:/api/ps', model: 'qwen3-vl:4b', digest: 'abc123', size_vram_bytes: 10, size_bytes: 10, processor_gpu_percent: 100, checked_at: '2026-11-23T00:00:01.000Z' },
    gpus: [{ vendor: 'apple', model: 'M-series', form: 'integrated', memory: 'shared', compute: 'metal' }]
  });
  assert.deepEqual(receipt.execution.advertised, { backend: 'ollama', model: 'qwen3-vl:4b', model_digest: 'abc123', runtime_version: '0.0.0-test' });
  assert.deepEqual(receipt.execution.model, { name: 'qwen3-vl:4b', digest: 'abc123', runtime_version: '0.0.0-test', reported_by: 'node-result' });
  assert.deepEqual(verifyReceipt(receipt, key.publicKeyPem), { ok: true, reason: null });
  // The new fields are inside the signature: changing the digest or the mode breaks it.
  assert.equal(verifyReceipt({ ...receipt, execution: { ...receipt.execution, model: { ...receipt.execution.model, digest: 'other' } } }, key.publicKeyPem).ok, false);
  assert.equal(verifyReceipt({ ...receipt, execution: { ...receipt.execution, hardware_mode: 'cpu-only' } }, key.publicKeyPem).ok, false);
  const failed = buildReceipt({ task: { ...task, status: 'failed', output: null }, leases: [{ ...lease, status: 'failed' }], node });
  assert.equal(failed.execution.model, null);
});

test('device facts are bound at completion: a receipt read after the node inventory changed is byte-identical', () => {
  const output = { model: 'qwen3-vl:4b', content: 'ok', usage: { model_digest: 'abc123', ollama_version: '0.0.0-test' } };
  const { task, lease, node, attestation } = completed({ output, node: DEVICE_A });
  assert.equal(attestation.device_facts.schema, DEVICE_FACTS_SCHEMA);
  assert.deepEqual(attestation.device_facts.model, { name: 'qwen3-vl:4b', digest: 'abc123', runtime_version: '0.0.0-test', reported_by: 'node-result' });
  const key = generateReceiptKey();
  const first = signReceipt(buildReceipt({ task, leases: [lease], node, attestation, issuedAt: '2026-11-23T00:00:06.000Z' }), key);
  // Later: the same node now reports another mode, platform, name, evidence and manifest, and the read happens at another time.
  const later = {
    ...node, display_name: 'renamed', capabilities: [{ capability: 'ai.chat', implementation: 'qwen3-vl.4b.local', backend: 'other', model: 'other:1b', features: {} }],
    inventory: { platform: 'linux', arch: 'x64', gpus: [], runtime: { hardware_mode: 'cpu-only', gpu_verified_at: null, gpu_evidence: { source: 'ollama:/api/ps', model: 'other:1b', size_vram_bytes: 0, size_bytes: 9, checked_at: '2026-11-30T00:00:00.000Z' } } }
  };
  const second = signReceipt(buildReceipt({ task, leases: [lease], node: later, attestation, issuedAt: '2026-11-30T00:00:00.000Z' }), key);
  assert.equal(JSON.stringify(second), JSON.stringify(first), 'the signed receipt does not follow the node row');
  assert.equal(first.issued_at, '2026-11-23T00:00:04.500Z', 'a bound receipt is dated by the binding, not by the read');
  assert.equal(second.execution.hardware_mode, 'gpu-verified');
  assert.deepEqual(verifyReceipt(second, key.publicKeyPem), { ok: true, reason: null });

  // No snapshot (an attestation recorded without one, or none at all): the
  // device facts are null and declared unbound; the node row as it reads at
  // that moment is never signed in their place.
  const { device_facts: _dropped, ...bare } = attestation;
  for (const unbound of [buildReceipt({ task, leases: [lease], node: later, attestation: bare, issuedAt: '2026-11-30T00:00:00.000Z' }), buildReceipt({ task, leases: [lease], node: later, issuedAt: '2026-11-30T00:00:00.000Z' })]) {
    assert.deepEqual(unbound.execution.device_facts, { bound: false, source: null, captured_at: null });
    assert.deepEqual([unbound.execution.hardware_mode, unbound.execution.platform, unbound.execution.arch, unbound.execution.hardware_evidence, unbound.execution.advertised], [null, null, null, null, null]);
    assert.equal(unbound.issued_at, '2026-11-30T00:00:00.000Z');
    assert.equal(unbound.execution.model.digest, 'abc123', 'the model still comes from the committed output');
  }
  // A snapshot bound to another lease is not this lease's evidence.
  assert.equal(buildReceipt({ task, leases: [lease], node, attestation: { ...attestation, lease_id: '20000000-0000-4000-8000-0000000000ff' } }).execution.device_facts.bound, false);
  // The facts are what the node row said, field for field, and nothing unnamed.
  const facts = deviceFactsAtCompletion({ node: later, implementation: 'none.local', result: {}, capturedAt: 't' });
  assert.deepEqual([facts.hardware_mode, facts.platform, facts.advertised, facts.model, facts.source], ['cpu-only', 'linux', null, null, 'node-reported-at-completion']);
  assert.equal(facts.hardware_evidence.engine.digest, null);
});

test('a failed job still gets a receipt that says why, without an output hash', () => {
  const { task, lease, node } = fixture({ status: 'failed' });
  const receipt = buildReceipt({ task, leases: [lease], node });
  assert.equal(receipt.job.status, 'failed');
  assert.equal(receipt.output_sha256, null);
  assert.equal(receipt.failure.last_error, 'executor exploded');
  assert.equal(receipt.execution.result_consistent, null);
});

test('completion attestation keeps only public signature fields and verifies against the node key', () => {
  const identity = generateNodeIdentity();
  const path = '/v1/compute/leases/20000000-0000-4000-8000-000000000001/complete';
  const result = { model: 'fixture', content: 'hello', usage: { tokens: 2 } };
  const body = Buffer.from(JSON.stringify({ lease_token: 'secret-lease-token', result }));
  const headers = signRequest({ privateKeyPem: identity.privateKeyPem, method: 'POST', path, nodeId: identity.nodeId, bodyBytes: body });
  // The node row as the gateway holds it when the completion arrives: the device facts are bound from it.
  const node = { id: identity.nodeId, display_name: 'n', public_key_pem: identity.publicKeyPem, key_fingerprint: identity.fingerprint, inventory: { platform: 'win32', runtime: { hardware_mode: 'gpu-verified' } }, labels: {} };
  const attestation = completionAttestation({ node, leaseId: '20000000-0000-4000-8000-000000000001', attempt: 1, path, headers, result });
  assert.equal(attestation.schema, ATTESTATION_SCHEMA);
  assert.equal(attestation.result_sha256, hashJson(result));
  assert.equal(attestation.body_digest, headers[SIGNATURE_HEADERS.digest]);
  assert.ok(!JSON.stringify(attestation).includes('secret-lease-token'));
  assert.deepEqual(verifyAttestation(attestation, identity.publicKeyPem), { ok: true, reason: null });
  assert.equal(verifyAttestation({ ...attestation, path: path.replace('complete', 'fail') }, identity.publicKeyPem).ok, false);
  assert.equal(verifyAttestation(attestation, generateNodeIdentity().publicKeyPem).ok, false);
  assert.equal(verifyAttestation(attestation, null).ok, false);
  assert.throws(() => completionAttestation({ node: { id: identity.nodeId }, leaseId: 'x', path, headers: {}, result }), (e) => e.code === 'ATTESTATION_INCOMPLETE');

  const { task, lease } = fixture({ output: result });
  const receipt = buildReceipt({ task, leases: [{ ...lease, node_id: identity.nodeId }], node, attestation });
  assert.equal(receipt.node_attestation.verified, true);
  assert.equal(receipt.node_attestation.matches_output, true);
  assert.equal(receipt.execution.hardware_mode, 'gpu-verified');
  assert.equal(receipt.node_public_key_pem, identity.publicKeyPem);
  // Additive execution fields: a node that reports no arch, evidence or digest gets nulls, never guesses.
  assert.equal(receipt.execution.arch, null);
  assert.deepEqual(receipt.execution.hardware_evidence, { gpu_verified_at: null, engine: null, gpus: [] });
  assert.deepEqual(receipt.execution.model, { name: 'fixture', digest: null, runtime_version: null, reported_by: 'node-result' });
  const forgedOutput = buildReceipt({ task: { ...task, output: { ...result, content: 'forged' } }, leases: [{ ...lease, node_id: identity.nodeId, result: { ...result, content: 'forged' } }], node, attestation });
  assert.equal(forgedOutput.node_attestation.matches_output, false);
});

test('the receipt key comes from the environment as PEM, single-line PEM, or not at all', () => {
  assert.equal(receiptKeyFromEnv({}), null);
  assert.equal(receiptKeyInfo(null).configured, false);
  const key = generateReceiptKey();
  const loaded = receiptKeyFromEnv({ CORE_RECEIPT_SIGNING_KEY: key.privateKeyPem });
  assert.equal(loaded.keyId, key.keyId);
  const singleLine = receiptKeyFromEnv({ CORE_RECEIPT_SIGNING_KEY: key.privateKeyPem.replace(/\n/g, '\\n') });
  assert.equal(singleLine.publicKeyPem, key.publicKeyPem);
  assert.throws(() => receiptKeyFromEnv({ CORE_RECEIPT_SIGNING_KEY: 'not a key' }), (e) => e.code === 'RECEIPT_KEY_INVALID');
  const info = receiptKeyInfo(loaded);
  assert.equal(info.configured, true);
  assert.equal(info.public_key_pem, key.publicKeyPem);
  assert.ok(!JSON.stringify(info).includes('PRIVATE'));
});

test('canonical JSON keeps a "__proto__" key, matches the documented vector, and the verifier rejects altered signature metadata', () => {
  assert.equal(canonicalJson(JSON.parse('{"__proto__":{"hidden":"payload"},"a":1}')), '{"__proto__":{"hidden":"payload"},"a":1}');
  assert.notEqual(hashJson(JSON.parse('{"__proto__":{"content":"forged"}}')), hashJson({}));
  // The vector a non-JavaScript verifier must reproduce (DEVICE-JOBS-CONTRACT.md, "Canonical JSON").
  const vector = { z: 1.0, a: [true, null, 'é\n"', { b: 1e21, c: -0, d: 0.1 }], m: { y: 'x', x: 'y' } };
  assert.equal(canonicalJson(vector), '{"a":[true,null,"é\\n\\"",{"b":1e+21,"c":0,"d":0.1}],"m":{"x":"y","y":"x"},"z":1}');
  assert.equal(hashJson(vector), 'd9a258d84feed22118930490e012edba6c031ee62716e40701d03480177206f8');
  const { task, lease, node } = fixture();
  const key = generateReceiptKey();
  const receipt = signReceipt(buildReceipt({ task, leases: [lease], node }), key);
  assert.equal(verifyReceipt({ ...receipt, signed: false }, key.publicKeyPem).ok, false);
  assert.equal(verifyReceipt({ ...receipt, signature: { ...receipt.signature, alg: 'rsa' } }, key.publicKeyPem).ok, false);
  assert.equal(verifyReceipt({ ...receipt, signature: { ...receipt.signature, key_id: null } }, key.publicKeyPem).ok, false);
  assert.equal(verifyReceipt(receipt, key.publicKeyPem).ok, true);
});

test('a canceled job is terminal and gets a receipt that says so', () => {
  const { task } = fixture({ status: 'failed' });
  const canceled = { ...task, status: 'canceled', last_error: 'canceled by the fabric-first client', output: null };
  const view = jobView({ task: canceled, leases: [] });
  assert.equal(view.terminal, true);
  assert.equal(view.receipt_available, true);
  const receipt = buildReceipt({ task: canceled, leases: [] });
  assert.equal(receipt.job.status, 'canceled');
  assert.equal(receipt.output_sha256, null);
  assert.equal(receipt.execution, null);
  assert.deepEqual(receipt.inference.devices, []);
});
