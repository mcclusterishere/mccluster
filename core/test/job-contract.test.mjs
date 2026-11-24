import test from 'node:test';
import assert from 'node:assert/strict';
import { generateNodeIdentity, signRequest, SIGNATURE_HEADERS } from '../src/compute/signature.mjs';
import {
  ATTESTATION_SCHEMA, JOB_CONTRACT, RECEIPT_SCHEMA, buildReceipt, canonicalJson, completionAttestation, completingLease,
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
  const attestation = completionAttestation({ node: { id: identity.nodeId }, leaseId: '20000000-0000-4000-8000-000000000001', attempt: 1, path, headers, result });
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
  const node = { id: identity.nodeId, display_name: 'n', public_key_pem: identity.publicKeyPem, key_fingerprint: identity.fingerprint, inventory: { platform: 'win32', runtime: { hardware_mode: 'gpu-verified' } }, labels: {} };
  const receipt = buildReceipt({ task, leases: [{ ...lease, node_id: identity.nodeId }], node, attestation });
  assert.equal(receipt.node_attestation.verified, true);
  assert.equal(receipt.node_attestation.matches_output, true);
  assert.equal(receipt.execution.hardware_mode, 'gpu-verified');
  assert.equal(receipt.node_public_key_pem, identity.publicKeyPem);
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
