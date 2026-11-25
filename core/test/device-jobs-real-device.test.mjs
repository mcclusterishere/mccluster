// The real-device staging mode (scripts/staging/device-jobs/serve.mjs,
// enroll-device.mjs, submit-job.mjs): argument validation, the device manifest
// and the offline evidence check. Everything here is a FIXTURE: synthetic
// keys, synthetic receipts and, in the end-to-end case, the fixture executor.
// Nothing in this file is evidence of inference on real hardware, and the
// evidence check itself is asserted to say so (fixture: true, hardware_proof: false).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateCapabilityManifest } from '../src/compute/protocol.mjs';
import { generateNodeIdentity, signRequest } from '../src/compute/signature.mjs';
import { buildReceipt, completionAttestation, generateReceiptKey, hashJson, jobResult, receiptKeyInfo, signReceipt } from '../src/compute/jobs.mjs';
import {
  DEFAULT_ORG, ENGINE_READING_BOUND_MS, RUN_FILES, STAGING_SCHEMA, buildDeviceManifest, connectStaging, parseFlags, readStagingFile, requestJson,
  validateEnrollOptions, validateServeOptions, validateSubmitOptions, verifyJobEvidence
} from '../../scripts/staging/device-jobs/real-device-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPTS = path.join(ROOT, 'scripts/staging/device-jobs');
const usage = (pattern) => (error) => error.code === 'USAGE' && pattern.test(error.message);

test('flags: values, booleans, unknown flags and missing values', () => {
  const spec = { a: { type: 'string' }, n: { type: 'int', default: 5 }, on: { type: 'boolean' }, two_words: { type: 'string' } };
  assert.deepEqual(parseFlags(['--a', 'x', '--n=7', '--on', '--two-words', 'y'], spec), { n: 7, a: 'x', on: true, two_words: 'y' });
  assert.deepEqual(parseFlags([], spec), { n: 5 });
  assert.throws(() => parseFlags(['--nope'], spec), usage(/unknown flag --nope/));
  assert.throws(() => parseFlags(['--a'], spec), usage(/needs a value/));
  assert.throws(() => parseFlags(['--a', '--on'], spec), usage(/needs a value/));
  assert.throws(() => parseFlags(['--n', '1.5'], spec), usage(/whole number/));
  assert.throws(() => parseFlags(['--on=1'], spec), usage(/takes no value/));
  assert.throws(() => parseFlags(['stray'], spec), usage(/unexpected argument/));
});

test('serve: run directory required, ports derived from the base, loopback SAN always present', () => {
  assert.throws(() => validateServeOptions([]), usage(/--run-dir is required/));
  const dir = path.join(os.tmpdir(), 'serve-args');
  const ok = validateServeOptions(['--run-dir', dir, '--port-base', '48000']);
  assert.deepEqual(ok.ports, { gateway: 48000, tls: 48001, shim: 48002 });
  assert.equal(ok.org, DEFAULT_ORG);
  assert.equal(ok.runDir, path.resolve(dir));
  assert.deepEqual(ok.tlsSans, ['IP:127.0.0.1']);
  assert.equal(ok.watchStdin, true);
  assert.equal(validateServeOptions(['--run-dir', dir, '--no-stdin']).watchStdin, false);
  assert.deepEqual(validateServeOptions(['--run-dir', dir, '--tls-san', 'DNS:staging.internal,IP:127.0.0.1']).tlsSans, ['IP:127.0.0.1', 'DNS:staging.internal']);
  assert.throws(() => validateServeOptions(['--run-dir', dir, '--port-base', '80']), usage(/port-base/));
  assert.throws(() => validateServeOptions(['--run-dir', dir, '--org', 'house']), usage(/--org must be a UUID/));
  assert.throws(() => validateServeOptions(['--run-dir', dir, '--tls-san', 'staging.internal']), usage(/tls-san/));
  assert.throws(() => validateServeOptions(['--run-dir', dir, '--lease-seconds', '5']), usage(/lease-seconds/));
});

test('enroll: one implementation and one model, a state directory, and either a run directory or explicit staging flags', () => {
  const base = ['--implementation', 'qwen3-vl.4b.local', '--model', 'qwen3-vl:4b', '--state-dir', path.join(os.tmpdir(), 'state')];
  const local = validateEnrollOptions([...base, '--run-dir', path.join(os.tmpdir(), 'run')]);
  assert.equal(local.implementation, 'qwen3-vl.4b.local');
  assert.equal(local.model, 'qwen3-vl:4b');
  assert.equal(local.ollamaUrl, 'http://127.0.0.1:11434');
  assert.equal(local.adapterPort, 0);
  assert.equal(local.executorUrl, null);
  assert.equal(path.basename(local.staging.tokenFile), RUN_FILES.enroll_token);
  assert.equal(path.basename(local.staging.ca), RUN_FILES.ca_cert);
  const remote = validateEnrollOptions([...base, '--compute-url', 'https://127.0.0.1:47801/', '--org', DEFAULT_ORG, '--ca', 'ca.pem']);
  assert.equal(remote.staging.computeUrl, 'https://127.0.0.1:47801');
  assert.equal(remote.staging.tokenFile, null);
  assert.throws(() => validateEnrollOptions(base), usage(/--compute-url \(or --run-dir\) is required/));
  assert.throws(() => validateEnrollOptions([...base, '--compute-url', 'http://127.0.0.1:1', '--org', DEFAULT_ORG, '--ca', 'ca.pem']), usage(/https:\/\//));
  assert.throws(() => validateEnrollOptions([...base, '--compute-url', 'https://127.0.0.1:1', '--ca', 'ca.pem']), usage(/--org must be a UUID/));
  assert.throws(() => validateEnrollOptions([...base, '--compute-url', 'https://127.0.0.1:1', '--org', DEFAULT_ORG]), usage(/--ca/));
  assert.throws(() => validateEnrollOptions(['--model', 'm', '--state-dir', 's', '--run-dir', 'r']), usage(/--implementation is required/));
  assert.throws(() => validateEnrollOptions(['--implementation', 'Bad Id', '--model', 'm', '--state-dir', 's', '--run-dir', 'r']), usage(/implementation id/));
  assert.throws(() => validateEnrollOptions(['--implementation', 'a.b', '--model', 'bad model', '--state-dir', 's', '--run-dir', 'r']), usage(/model name/));
  assert.throws(() => validateEnrollOptions(['--implementation', 'a.b', '--model', 'm', '--run-dir', 'r']), usage(/--state-dir is required/));
  // The engine and any stand-in executor are loopback only.
  assert.throws(() => validateEnrollOptions([...base, '--run-dir', 'r', '--ollama-url', 'http://192.0.2.10:11434']), usage(/loopback/));
  assert.throws(() => validateEnrollOptions([...base, '--run-dir', 'r', '--executor-url', 'https://127.0.0.1:1']), usage(/loopback/));
  assert.throws(() => validateEnrollOptions([...base, '--run-dir', 'r', '--context', '100']), usage(/--context/));
});

test('submit: an implementation pin and an output directory are required; bounds are enforced', () => {
  const base = ['--implementation', 'qwen3-vl.4b.local', '--out', path.join(os.tmpdir(), 'out'), '--run-dir', path.join(os.tmpdir(), 'run')];
  const ok = validateSubmitOptions(base);
  assert.equal(ok.numPredict, 512);
  assert.equal(ok.clientName, 'submit-job-cli', 'the default client name is the real submitter, not a device');
  assert.equal(validateSubmitOptions([...base, '--client-name', 'prime-windows']).clientName, 'prime-windows');
  assert.equal(ok.expectRefusal, false);
  assert.equal(ok.idempotencyKey, null);
  assert.equal(path.basename(ok.staging.tokenFile), RUN_FILES.admin_token);
  assert.equal(validateSubmitOptions([...base, '--expect-refusal', '--bound-ms', '5000']).expectRefusal, true);
  assert.throws(() => validateSubmitOptions(base.slice(2)), usage(/--implementation is required/));
  assert.throws(() => validateSubmitOptions(['--implementation', 'a.b', '--run-dir', 'r']), usage(/--out is required/));
  assert.throws(() => validateSubmitOptions([...base, '--num-predict', '1']), usage(/num-predict/));
  assert.throws(() => validateSubmitOptions([...base, '--idempotency-key', 'has space']), usage(/idempotency-key/));
  assert.throws(() => validateSubmitOptions([...base, '--bound-ms', '10']), usage(/bound-ms/));
  assert.throws(() => validateSubmitOptions([...base, '--expect-hardware-mode', 'fast']), usage(/hardware mode/));
  assert.throws(() => validateSubmitOptions([...base, '--prompt', ' ']), usage(/prompt/));
});

test('the device manifest advertises exactly one ai.chat implementation at concurrency 1 behind a loopback executor', () => {
  const manifest = buildDeviceManifest({ implementation: 'qwen3-vl.4b.local', model: 'qwen3-vl:4b', executorBase: 'http://127.0.0.1:4790' });
  const [entry, ...rest] = validateCapabilityManifest(manifest.capabilities);
  assert.equal(rest.length, 0);
  assert.deepEqual([entry.capability, entry.implementation, entry.model, entry.max_concurrency, entry.backend], ['ai.chat', 'qwen3-vl.4b.local', 'qwen3-vl:4b', 1, 'ollama']);
  assert.equal(manifest.max_leases, 1);
  assert.equal(manifest.labels.role, 'staging-real-device');
  assert.equal(manifest.capabilities[0].executor.url, 'http://127.0.0.1:4790/execute');
  assert.equal(manifest.capabilities[0].executor.health_url, 'http://127.0.0.1:4790/ready?implementation=qwen3-vl.4b.local');
  // A real device publishes the digest and engine version it enrolled with; they survive the protocol's validation.
  const withDigest = validateCapabilityManifest(buildDeviceManifest({ implementation: 'qwen3-vl.4b.local', model: 'qwen3-vl:4b', executorBase: 'http://127.0.0.1:4790', modelDigest: 'a'.repeat(64), runtimeVersion: '0.0.0-test' }).capabilities)[0];
  assert.deepEqual([withDigest.features.model_digest, withDigest.features.runtime_version], ['a'.repeat(64), '0.0.0-test']);
  assert.equal('model_digest' in entry.features, false);
  const fixture = buildDeviceManifest({ implementation: 'fixture.echo.local', model: 'fixture-echo', executorBase: 'http://127.0.0.1:1', fixture: true, modelDigest: 'a'.repeat(64), runtimeVersion: '0.0.0-test' });
  assert.equal(fixture.labels.role, 'staging-fixture');
  assert.equal(fixture.capabilities[0].features.fixture, true);
  assert.equal('model_digest' in fixture.capabilities[0].features || 'runtime_version' in fixture.capabilities[0].features, false, 'a fixture never publishes a digest');
});

test('staging connection: a token comes from the environment or the token file, and a missing file is a named error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-jobs-conn-'));
  assert.throws(() => readStagingFile(dir), (error) => error.code === 'STAGING_NOT_FOUND');
  fs.writeFileSync(path.join(dir, RUN_FILES.staging), JSON.stringify({ schema: STAGING_SCHEMA, org_id: DEFAULT_ORG, urls: { compute: 'https://127.0.0.1:47801' } }));
  const staging = { runDir: dir, computeUrl: null, org: null, ca: path.join(dir, RUN_FILES.ca_cert), tokenFile: path.join(dir, RUN_FILES.admin_token) };
  assert.throws(() => connectStaging(staging, { tokenEnv: 'T', env: {} }), (error) => error.code === 'TOKEN_UNAVAILABLE');
  const fileToken = `file-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(staging.tokenFile, `${fileToken}\n`);
  assert.throws(() => connectStaging(staging, { tokenEnv: 'T', env: {} }), (error) => error.code === 'CA_UNAVAILABLE');
  fs.writeFileSync(staging.ca, 'not a real certificate; only read as bytes here');
  const fromFile = connectStaging(staging, { tokenEnv: 'T', env: {} });
  assert.deepEqual([fromFile.computeUrl, fromFile.org, fromFile.token], ['https://127.0.0.1:47801', DEFAULT_ORG, fileToken]);
  assert.equal(connectStaging(staging, { tokenEnv: 'T', env: { T: 'from-env' } }).token, 'from-env');
});

// A complete, internally consistent set of evidence from synthetic keys. FIXTURE.
// `shape` edits the node row as it stood at completion (what the Core binds);
// `listing` edits the fabric's node listing the verifier reads independently.
const DIGEST = 'd'.repeat(64);
const REAL_OUTPUT = { model: 'qwen3-vl:4b', implementation: 'qwen3-vl.4b.local', content: 'A signed receipt proves who ran it.', done_reason: 'stop', queue_wait_ms: 1, usage: { eval_count: 9, prompt_eval_count: 20, generation_tokens_per_second: 7.5, model_digest: DIGEST, ollama_version: '0.0.0-test' } };
function evidence({ output = REAL_OUTPUT, role = 'staging-real-device', shape = (node) => node, listing = (node) => node, bindFacts = true } = {}) {
  const identity = generateNodeIdentity();
  const key = generateReceiptKey();
  const submitted = { capability: 'ai.chat', implementation: 'qwen3-vl.4b.local', input: { prompt: 'p', num_predict: 512 }, client: { name: 'test', version: '1' } };
  const leaseId = '20000000-0000-4000-8000-000000000009';
  const task = {
    id: '10000000-0000-4000-8000-000000000009', org_id: DEFAULT_ORG, capability: 'ai.chat', implementation: submitted.implementation, input: submitted.input,
    status: 'done', attempts: 1, max_attempts: 3, output, metadata: { source: 'device-jobs/1', client: { name: 'test', version: '1', contract: 'mccluster-job/1' } },
    created_at: '2026-11-24T00:00:00.000Z', updated_at: '2026-11-24T00:00:09.000Z'
  };
  const lease = { id: leaseId, task_id: task.id, node_id: identity.nodeId, implementation: submitted.implementation, attempt: 1, status: 'done', started_at: '2026-11-24T00:00:01.000Z', completed_at: '2026-11-24T00:00:08.000Z', result: output, created_at: '2026-11-24T00:00:00.500Z' };
  const node = shape({
    id: identity.nodeId, display_name: 'fixture-device', public_key_pem: identity.publicKeyPem, key_fingerprint: identity.fingerprint, state: 'online', labels: { role, enrolled_trust: 'owned' },
    capabilities: validateCapabilityManifest(buildDeviceManifest({ implementation: submitted.implementation, model: 'qwen3-vl:4b', executorBase: 'http://127.0.0.1:4790', modelDigest: DIGEST, runtimeVersion: '0.0.0-test' }).capabilities),
    inventory: { platform: 'win32', arch: 'x64', gpus: [{ vendor: 'amd', model: 'integrated', form: 'integrated', memory: 'shared', compute: 'vulkan' }], runtime: { hardware_mode: 'gpu-verified', gpu_verified_at: '2026-11-24T00:00:05.000Z', gpu_evidence: { source: 'ollama:/api/ps', model: 'qwen3-vl:4b', digest: DIGEST, size_vram_bytes: 5, size_bytes: 5, processor_gpu_percent: 100, checked_at: '2026-11-24T00:00:05.000Z' } } }
  });
  const completePath = `/v1/compute/leases/${leaseId}/complete`;
  const headers = signRequest({ privateKeyPem: identity.privateKeyPem, method: 'POST', path: completePath, nodeId: identity.nodeId, bodyBytes: Buffer.from(JSON.stringify({ lease_token: 't', result: output })) });
  // As the gateway records it: the signature and the device facts read from the node row at that moment.
  const recorded = completionAttestation({ node, leaseId, attempt: 1, path: completePath, headers, result: output, implementation: lease.implementation, capturedAt: '2026-11-24T00:00:08.100Z' });
  const attestation = bindFacts ? recorded : (({ device_facts: _facts, ...rest }) => rest)(recorded);
  const receipt = signReceipt(buildReceipt({ task, leases: [lease], node, attestation, nodePublicKeyPem: identity.publicKeyPem }), key);
  const result = jobResult({ task, leases: [lease], node });
  const { public_key_pem: _pem, ...enrolledNode } = listing(node);
  return { submitted, result, receipt, receiptKey: receiptKeyInfo(key), pinnedReceiptKeyPem: key.publicKeyPem, enrolledNode, replay: { status: 200, replayed: true, job_id: task.id }, key, identity };
}
const failedHardware = (verify) => Object.entries(verify.hardware_checks).filter(([, value]) => value !== true).map(([name]) => name);
const runtime = (edit) => (node) => ({ ...node, inventory: { ...node.inventory, runtime: edit(node.inventory.runtime) } });
const engine = (edit) => runtime((value) => ({ ...value, gpu_evidence: edit(value.gpu_evidence) }));
const capability = (edit) => (node) => ({ ...node, capabilities: node.capabilities.map(edit) });

test('FIXTURE evidence: a consistent job verifies offline, every check true, and names device, compute mode, model and digest', () => {
  const verify = verifyJobEvidence({ ...evidence(), expectHardwareMode: 'gpu-verified' });
  assert.deepEqual(Object.entries(verify.checks).filter(([, value]) => value !== true), []);
  assert.equal(verify.ok, true);
  assert.equal(verify.fixture, false);
  assert.deepEqual(failedHardware(verify), []);
  assert.equal(verify.hardware_proof, true, 'synthetic keys, but the shape of a real device: the flag follows the evidence it is given');
  assert.deepEqual(verify.compute_mode, { reported_hardware_mode: 'gpu-verified', proven: 'gpu', gpu_proof: true });
  assert.equal(verify.engine_reading_bound_ms, ENGINE_READING_BOUND_MS);
  assert.deepEqual([verify.device.platform, verify.device.arch, verify.device.hardware_mode, verify.device.node_display_name], ['win32', 'x64', 'gpu-verified', 'fixture-device']);
  assert.equal(verify.device.hardware_evidence.engine.size_vram_bytes, 5);
  assert.deepEqual(verify.device.advertised, { backend: 'ollama', model: 'qwen3-vl:4b', model_digest: DIGEST, runtime_version: '0.0.0-test' });
  assert.deepEqual(verify.device.facts, { bound: true, source: 'node-reported-at-completion', captured_at: '2026-11-24T00:00:08.100Z' });
  assert.deepEqual(verify.model, { implementation: 'qwen3-vl.4b.local', name: 'qwen3-vl:4b', digest: DIGEST, runtime_version: '0.0.0-test' });
  assert.deepEqual([verify.execution.attempts, verify.execution.lease_duration_ms], [1, 7000]);
  assert.equal(verify.counters.eval_count, 9);
  for (const name of ['core_signature_verifies_against_published_key', 'node_signature_verifies_against_enrolled_key', 'node_key_is_the_enrolled_key', 'node_attestation_names_this_output', 'input_hash_matches_submission', 'output_hash_matches_result', 'idempotent_replay_returns_same_job', 'published_key_is_the_pinned_key', 'hardware_mode_is_the_expected_one']) {
    assert.equal(verify.checks[name], true, name);
  }
  // verify.json says what kind of evidence this is, in so many words.
  assert.match(verify.limits, /node-reported evidence under the node's signature, not third-party attestation/);
});

test('FIXTURE evidence: hardware_proof needs an engine reading that exists, names the model that ran and was taken in the lease window', () => {
  const none = verifyJobEvidence(evidence({ shape: engine(() => null) }));
  assert.deepEqual([none.ok, none.hardware_proof, none.compute_mode.proven, none.compute_mode.gpu_proof], [true, false, null, false]);
  for (const name of ['engine_reading_present', 'engine_reading_names_the_result_model', 'engine_reading_digest_matches_the_result', 'engine_reading_within_the_lease_window', 'engine_reading_agrees_with_the_hardware_mode']) assert.ok(failedHardware(none).includes(name), name);

  // gpu-verified can rest on a reading up to a day old for some other model: that is not evidence for this job.
  const otherModel = verifyJobEvidence(evidence({ shape: engine((seen) => ({ ...seen, model: 'qwen3:8b' })) }));
  assert.deepEqual(failedHardware(otherModel), ['engine_reading_names_the_result_model']);
  assert.equal(otherModel.hardware_proof, false);
  assert.deepEqual(failedHardware(verifyJobEvidence(evidence({ shape: engine((seen) => ({ ...seen, digest: 'e'.repeat(64) })) }))), ['engine_reading_digest_matches_the_result']);
  assert.deepEqual(failedHardware(verifyJobEvidence(evidence({ shape: engine(({ digest: _digest, ...seen }) => seen) }))), ['engine_reading_digest_matches_the_result']);

  // The lease ran 00:00:01..00:00:08. Inside the stated bound on either side counts; outside it does not.
  const at = (checked_at) => verifyJobEvidence(evidence({ shape: engine((seen) => ({ ...seen, checked_at })) }));
  assert.equal(at('2026-11-23T23:59:01.000Z').hardware_proof, true, 'exactly the bound before the lease started');
  assert.equal(at('2026-11-24T00:01:08.000Z').hardware_proof, true, 'exactly the bound after it completed');
  for (const stale of ['2026-11-23T23:59:00.999Z', '2026-11-24T00:01:08.001Z', '2026-11-23T00:00:05.000Z', 'not a time']) {
    const verify = at(stale);
    assert.equal(verify.hardware_proof, false, stale);
    assert.ok(failedHardware(verify).includes('engine_reading_within_the_lease_window'), stale);
  }
  // The bound is the caller's to tighten, and it is reported.
  const tight = verifyJobEvidence({ ...evidence({ shape: engine((seen) => ({ ...seen, checked_at: '2026-11-24T00:00:00.000Z' })) }), engineReadingBoundMs: 500 });
  assert.deepEqual([tight.hardware_proof, tight.engine_reading_bound_ms], [false, 500]);
});

test('FIXTURE evidence: only gpu-verified with the model in VRAM is GPU proof; a CPU device is reported as CPU', () => {
  for (const mode of ['gpu-present-unverified', 'unknown', null]) {
    const verify = verifyJobEvidence(evidence({ shape: runtime((value) => ({ ...value, hardware_mode: mode })) }));
    assert.equal(verify.ok, true, String(mode));
    assert.deepEqual([verify.hardware_proof, verify.compute_mode.proven, verify.compute_mode.gpu_proof, verify.compute_mode.reported_hardware_mode], [false, null, false, mode], String(mode));
    assert.ok(failedHardware(verify).includes('hardware_mode_is_a_proven_mode'), String(mode));
  }
  // A gpu-verified label over a reading with nothing in VRAM (the engine fell back to the CPU) is not GPU proof.
  const fellBack = verifyJobEvidence(evidence({ shape: engine((seen) => ({ ...seen, size_vram_bytes: 0, processor_gpu_percent: 0 })) }));
  assert.deepEqual(failedHardware(fellBack), ['engine_reading_agrees_with_the_hardware_mode']);
  assert.deepEqual([fellBack.hardware_proof, fellBack.compute_mode.gpu_proof], [false, false]);

  // A CPU device: the engine held the model with no VRAM. Real execution, honestly CPU, never a GPU claim.
  const cpuShape = (node) => engine((seen) => ({ ...seen, size_vram_bytes: 0, processor_gpu_percent: 0 }))(runtime((value) => ({ ...value, hardware_mode: 'cpu-only', gpu_verified_at: null }))({ ...node, inventory: { ...node.inventory, gpus: [] } }));
  const cpu = verifyJobEvidence({ ...evidence({ shape: cpuShape }), expectHardwareMode: 'cpu-only' });
  assert.deepEqual(failedHardware(cpu), []);
  assert.deepEqual([cpu.ok, cpu.hardware_proof], [true, true]);
  assert.deepEqual(cpu.compute_mode, { reported_hardware_mode: 'cpu-only', proven: 'cpu', gpu_proof: false });
  // cpu-only over a reading that shows VRAM in use contradicts itself.
  assert.equal(verifyJobEvidence(evidence({ shape: runtime((value) => ({ ...value, hardware_mode: 'cpu-only' })) })).hardware_proof, false);
});

test('FIXTURE evidence: a stand-in executor that leaves the fixture label off is still not hardware proof', () => {
  // The stand-in answers like a model and labels nothing: no digest, no engine version.
  const unlabelled = { model: 'qwen3-vl:4b', implementation: 'qwen3-vl.4b.local', content: 'I am not a model.', usage: {} };
  const silent = verifyJobEvidence(evidence({ output: unlabelled }));
  assert.deepEqual([silent.ok, silent.fixture, silent.hardware_proof], [true, false, false]);
  assert.ok(failedHardware(silent).includes('result_carries_model_digest_and_runtime_version'));

  // It invents a digest and a version: they are not the ones this node enrolled with, nor the engine's.
  const invented = verifyJobEvidence(evidence({ output: { ...unlabelled, usage: { model_digest: 'f'.repeat(64), ollama_version: '9.9.9' } } }));
  assert.deepEqual([invented.ok, invented.fixture, invented.hardware_proof], [true, false, false]);
  assert.deepEqual(failedHardware(invented), ['result_digest_matches_the_enrolled_digest', 'result_runtime_version_matches_the_enrolled_version', 'engine_reading_digest_matches_the_result']);

  // The node was not enrolled as the Ollama adapter, or enrolled without a digest (enroll-device with --executor-url publishes none).
  const notOllama = verifyJobEvidence(evidence({ shape: capability((entry) => ({ ...entry, backend: 'native' })) }));
  assert.deepEqual(failedHardware(notOllama), ['executor_advertised_as_the_ollama_adapter']);
  const noDigestEnrolled = verifyJobEvidence(evidence({ shape: capability((entry) => ({ ...entry, features: { chat: true } })) }));
  assert.deepEqual(failedHardware(noDigestEnrolled), ['result_digest_matches_the_enrolled_digest', 'result_runtime_version_matches_the_enrolled_version']);
  const otherModel = verifyJobEvidence(evidence({ shape: capability((entry) => ({ ...entry, model: 'qwen3:8b' })) }));
  assert.deepEqual(failedHardware(otherModel), ['result_model_is_the_advertised_model']);
  // The fabric's own listing must agree with what the receipt says the node advertised.
  const listingDisagrees = verifyJobEvidence(evidence({ listing: capability((entry) => ({ ...entry, features: { ...entry.features, model_digest: 'e'.repeat(64) } })) }));
  assert.deepEqual(failedHardware(listingDisagrees), ['result_digest_matches_the_enrolled_digest']);
  assert.equal(verifyJobEvidence({ ...evidence(), enrolledNode: null }).hardware_proof, false);

  // Facts that were not bound at completion are not evidence, whatever the node reports today.
  const unbound = verifyJobEvidence(evidence({ bindFacts: false }));
  assert.deepEqual([unbound.ok, unbound.hardware_proof, unbound.device.hardware_mode, unbound.device.facts.bound], [true, false, null, false]);
  assert.ok(failedHardware(unbound).includes('device_facts_bound_at_completion'));
  // A node labelled as a fixture is never proof even with every positive check true.
  const labelled = verifyJobEvidence(evidence({ role: 'staging-fixture' }));
  assert.deepEqual([failedHardware(labelled), labelled.fixture, labelled.hardware_proof, labelled.compute_mode.proven], [[], true, false, null]);
});

test('FIXTURE evidence: fixture output is never hardware proof, whatever else verifies', () => {
  const output = { model: 'fixture-echo', implementation: 'qwen3-vl.4b.local', content: 'ECHO: p', fixture: true, usage: {} };
  const verify = verifyJobEvidence(evidence({ output, role: 'staging-fixture' }));
  assert.equal(verify.ok, true);
  assert.equal(verify.fixture, true);
  assert.equal(verify.hardware_proof, false);
  assert.equal(verify.model.digest, null);
  // A real-looking result with no digest is not hardware proof either.
  const noDigest = verifyJobEvidence(evidence({ output: { model: 'qwen3-vl:4b', implementation: 'qwen3-vl.4b.local', content: 'x', usage: {} } }));
  assert.deepEqual([noDigest.ok, noDigest.fixture, noDigest.hardware_proof], [true, false, false]);
});

test('FIXTURE evidence: each kind of tampering fails the check that owns it', () => {
  const failed = (verify) => Object.entries(verify.checks).filter(([, value]) => value !== true).map(([name]) => name);
  const good = evidence();

  const forgedOutput = verifyJobEvidence({ ...good, result: { ...good.result, output: { ...good.result.output, content: 'forged' } } });
  assert.equal(forgedOutput.ok, false);
  assert.ok(failed(forgedOutput).includes('output_hash_matches_result') && failed(forgedOutput).includes('node_attestation_names_this_output'));

  const editedReceipt = verifyJobEvidence({ ...good, receipt: { ...good.receipt, execution: { ...good.receipt.execution, hardware_mode: 'cpu-only' } } });
  assert.deepEqual(failed(editedReceipt), ['core_signature_verifies_against_published_key', 'published_key_is_the_pinned_key']);

  const otherCore = generateReceiptKey();
  const wrongCore = verifyJobEvidence({ ...good, receiptKey: receiptKeyInfo(otherCore) });
  assert.ok(failed(wrongCore).includes('core_signature_verifies_against_published_key') && failed(wrongCore).includes('core_key_id_matches_published_key'));
  assert.match(wrongCore.notes.core_signature, /different Core key/);

  // A gateway that publishes a key other than the one the run directory pinned.
  const resigned = signReceipt({ ...good.receipt, signature: null, signed: undefined }, otherCore);
  assert.deepEqual(failed(verifyJobEvidence({ ...good, receipt: resigned, receiptKey: receiptKeyInfo(otherCore) })), ['published_key_is_the_pinned_key']);

  // The Core re-signs a receipt whose node key was swapped: the Core signature holds, the node checks do not.
  const stranger = generateNodeIdentity();
  const swapped = signReceipt({ ...good.receipt, node_public_key_pem: stranger.publicKeyPem, signature: null, signed: undefined }, good.key);
  const swappedFailed = failed(verifyJobEvidence({ ...good, receipt: swapped }));
  for (const name of ['node_signature_verifies_against_enrolled_key', 'node_id_derives_from_its_public_key', 'node_key_fingerprint_matches_receipt', 'node_key_is_the_enrolled_key']) assert.ok(swappedFailed.includes(name), name);
  assert.ok(!swappedFailed.includes('core_signature_verifies_against_published_key'));

  assert.deepEqual(failed(verifyJobEvidence({ ...good, enrolledNode: { ...good.enrolledNode, key_fingerprint: 'f'.repeat(64) } })), ['node_key_is_the_enrolled_key']);
  assert.deepEqual(failed(verifyJobEvidence({ ...good, enrolledNode: null })), ['node_key_is_the_enrolled_key']);
  assert.deepEqual(failed(verifyJobEvidence({ ...good, submitted: { ...good.submitted, input: { prompt: 'other' } } })), ['input_hash_matches_submission']);
  assert.deepEqual(failed(verifyJobEvidence({ ...good, submitted: { ...good.submitted, implementation: 'qwen3.8b.local' } })), ['implementation_is_the_pinned_one']);
  assert.deepEqual(failed(verifyJobEvidence({ ...good, replay: { status: 202, replayed: false, job_id: 'other' } })), ['idempotent_replay_returns_same_job']);
  assert.deepEqual(failed(verifyJobEvidence({ ...good, expectHardwareMode: 'cpu-only' })), ['hardware_mode_is_the_expected_one']);

  const noAttestation = signReceipt({ ...good.receipt, node_attestation: null, signature: null, signed: undefined }, good.key);
  const missing = failed(verifyJobEvidence({ ...good, receipt: noAttestation }));
  for (const name of ['node_attestation_present', 'node_signature_verifies_against_enrolled_key', 'node_attestation_names_this_output', 'node_attestation_binds_this_lease']) assert.ok(missing.includes(name), name);

  const unsigned = verifyJobEvidence({ ...good, receipt: signReceipt({ ...good.receipt, signature: null, signed: undefined }, null) });
  assert.equal(unsigned.ok, false);
  assert.match(unsigned.notes.core_signature, /unsigned/);
  assert.equal(hashJson(good.result.output), good.receipt.output_sha256);
});

// End to end with the FIXTURE executor: serve.mjs, enroll-device.mjs and
// submit-job.mjs as processes. Needs the pinned PGlite and openssl, exactly as
// run.mjs does; skipped with the reason otherwise. Not hardware proof.
function prerequisites() {
  if (!process.env.PGLITE_MODULE_PATH || !fs.existsSync(process.env.PGLITE_MODULE_PATH)) return 'PGLITE_MODULE_PATH is not set to an installed PGlite';
  try { execFileSync(process.env.OPENSSL_BIN || 'openssl', ['version'], { stdio: 'ignore', windowsHide: true }); } catch { return 'openssl is not available (PATH or OPENSSL_BIN)'; }
  return null;
}

function runToExit(script, args, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(SCRIPTS, script), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

function firstJsonLine(child, label, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    let buffer = ''; let errors = '';
    const timer = setTimeout(() => reject(new Error(`${label}: no ready line within ${timeoutMs} ms; stderr: ${errors.slice(0, 500)}`)), timeoutMs);
    child.stderr.on('data', (chunk) => { errors += chunk; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`${label} exited with ${code}; stderr: ${errors.slice(0, 500)}`)); });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      clearTimeout(timer);
      resolve({ record: JSON.parse(buffer.slice(0, end)), raw: () => buffer });
    });
  });
}

async function stopByFile(child, dir) {
  if (child.exitCode !== null) return child.exitCode;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  fs.writeFileSync(path.join(dir, 'stop'), '');
  const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 45_000);
  const code = await exited;
  clearTimeout(timer);
  return code;
}

test('FIXTURE end to end: serve, enroll with a stand-in executor, submit, verify offline, refusal, clean stop', { skip: prerequisites() || false, timeout: 240_000 }, async (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'device-jobs-real-mode-'));
  const runDir = path.join(work, 'run');
  const stateDir = path.join(work, 'device');
  const portBase = 44000 + Math.floor(Math.random() * 500) * 3;
  const executorPort = portBase + 1600;
  const controlFile = path.join(work, 'fixture-control.json');
  const children = [];
  t.after(() => { for (const child of children) { try { child.kill('SIGKILL'); } catch {} } });
  const background = (script, args, env = process.env) => { const child = spawn(process.execPath, [script, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); children.push(child); return child; };

  const serve = background(path.join(SCRIPTS, 'serve.mjs'), ['--run-dir', runDir, '--port-base', String(portBase), '--no-stdin']);
  const ready = await firstJsonLine(serve, 'serve');
  assert.equal(ready.record.event, 'staging_ready');
  assert.deepEqual(ready.record.urls, { compute: `https://127.0.0.1:${portBase + 1}`, gateway_loopback: `http://127.0.0.1:${portBase}` });
  const staging = readStagingFile(runDir);
  assert.equal(staging.org_id, DEFAULT_ORG);
  assert.equal(staging.bind, '127.0.0.1');
  // Neither stdout nor staging.json carries a secret value.
  for (const name of [RUN_FILES.admin_token, RUN_FILES.enroll_token]) {
    const secret = fs.readFileSync(path.join(runDir, name), 'utf8').trim();
    assert.match(secret, /^[0-9a-f]{48}$/);
    assert.ok(!ready.raw().includes(secret) && !JSON.stringify(staging).includes(secret), `${name} leaked`);
  }
  const signingKeyBody = fs.readFileSync(path.join(runDir, RUN_FILES.receipt_signing_key), 'utf8').split('\n')[1];
  assert.ok(signingKeyBody.length > 20 && !ready.raw().includes(signingKeyBody) && !JSON.stringify(staging).includes(signingKeyBody));
  // A second serve on the same run directory refuses instead of overwriting the live one's files.
  assert.equal((await runToExit('serve.mjs', ['--run-dir', runDir, '--port-base', String(portBase + 30), '--no-stdin'])).code, 3);

  const executor = background(path.join(SCRIPTS, 'fixture-executor.mjs'), [], { ...process.env, FIXTURE_EXECUTOR_PORT: String(executorPort), FIXTURE_IMPLEMENTATION: 'fixture.echo.local', FIXTURE_CONTROL_FILE: controlFile });
  await firstJsonLine(executor, 'fixture executor', 20_000);

  // A wrong enrolment token is refused and the enrol command says so by exiting non-zero.
  const refusedEnrol = await runToExit('enroll-device.mjs', ['--run-dir', runDir, '--state-dir', path.join(work, 'rejected'), '--implementation', 'fixture.echo.local', '--model', 'fixture-echo', '--executor-url', `http://127.0.0.1:${executorPort}`, '--no-stdin'], { ...process.env, MCCLUSTER_NODE_ENROLL_TOKEN: 'not-the-token' });
  assert.equal(refusedEnrol.code, 1);
  assert.match(refusedEnrol.stderr, /node_agent_exited/);

  const device = background(path.join(SCRIPTS, 'enroll-device.mjs'), ['--run-dir', runDir, '--state-dir', stateDir, '--name', 'fixture-device', '--implementation', 'fixture.echo.local', '--model', 'fixture-echo', '--executor-url', `http://127.0.0.1:${executorPort}`, '--no-stdin']);
  const enrolled = (await firstJsonLine(device, 'enroll-device')).record;
  assert.equal(enrolled.event, 'device_enrolled');
  assert.equal(enrolled.fixture, true);
  assert.match(enrolled.node_id, /^node_[0-9a-f]{32}$/);
  assert.ok(fs.existsSync(path.join(stateDir, 'identity.json')));

  const out = path.join(work, 'out');
  const submitted = await runToExit('submit-job.mjs', ['--run-dir', runDir, '--implementation', 'fixture.echo.local', '--out', out, '--prompt', 'fixture prompt', '--timeout-ms', '90000']);
  assert.equal(submitted.code, 0, submitted.stdout + submitted.stderr);
  const verify = JSON.parse(fs.readFileSync(path.join(out, 'verify.json'), 'utf8'));
  assert.deepEqual(Object.entries(verify.checks).filter(([, value]) => value !== true), []);
  assert.equal(verify.ok, true);
  assert.equal(verify.fixture, true);
  assert.equal(verify.hardware_proof, false, 'the fixture executor is never hardware proof');
  assert.equal(verify.device.node_id, enrolled.node_id);
  assert.equal(verify.device.node_display_name, 'fixture-device');
  assert.equal(verify.device.platform, process.platform);
  assert.equal(verify.device.arch, os.arch());
  assert.equal(verify.model.name, 'fixture-echo');
  assert.equal(verify.execution.attempts, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8')).output.content, 'ECHO: fixture prompt');
  for (const name of ['job.json', 'receipt.json']) assert.ok(fs.existsSync(path.join(out, name)), name);
  // The stand-in executor is refused on positive grounds, not only by its label: it is not the Ollama adapter and carries no digest.
  for (const name of ['executor_advertised_as_the_ollama_adapter', 'result_carries_model_digest_and_runtime_version', 'engine_reading_present']) assert.equal(verify.hardware_checks[name], false, name);
  assert.deepEqual(verify.compute_mode.proven, null);
  assert.match(verify.limits, /node-reported evidence under the node's signature, not third-party attestation/);
  // The device facts were bound by the real gateway when it accepted the completion (the pending column, through PostgREST).
  assert.equal(verify.device.facts.bound, true);
  assert.equal(verify.device.facts.source, 'node-reported-at-completion');
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'job.json'), 'utf8')).submitted.client.name, 'submit-job-cli');
  // Two later reads of the receipt over HTTP are byte-identical to each other and to the one already written.
  const live = connectStaging({ runDir, computeUrl: null, org: null, ca: path.join(runDir, RUN_FILES.ca_cert), tokenFile: path.join(runDir, RUN_FILES.admin_token) }, { tokenEnv: 'UNSET_TOKEN_ENV', env: {} });
  const admin = (pathname, init = {}) => requestJson(`${live.computeUrl}${pathname}`, { ...init, ca: live.ca, headers: { authorization: `Bearer ${live.token}` } });
  const receiptPath = `/v1/compute/jobs/${verify.job_id}/receipt?org_id=${DEFAULT_ORG}`;
  const readOne = await admin(receiptPath);
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const readTwo = await admin(receiptPath);
  assert.equal(readOne.status, 200);
  assert.equal(JSON.stringify(readTwo.body), JSON.stringify(readOne.body));
  assert.equal(JSON.stringify(readOne.body), JSON.stringify(JSON.parse(fs.readFileSync(path.join(out, 'receipt.json'), 'utf8'))));

  const refusalOut = path.join(work, 'refusal');
  const refusal = await runToExit('submit-job.mjs', ['--run-dir', runDir, '--implementation', 'qwen3.8b.local', '--out', refusalOut, '--expect-refusal', '--bound-ms', '4000']);
  assert.equal(refusal.code, 0, refusal.stdout + refusal.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(refusalOut, 'refusal.json'), 'utf8'));
  assert.deepEqual(Object.entries(report.checks).filter(([, value]) => value !== true), []);
  assert.deepEqual([report.refusal.http_status, report.refusal.code, report.unclaimed_probe.final_status, report.unclaimed_probe.attempts], [503, 'COMPUTE_NO_LIVE_NODE', 'queued', 0]);
  // The refused submit is looked up by its own Idempotency-Key, and the probe job is canceled, not left queued.
  assert.deepEqual(report.refused_submit_lookup, { by: 'idempotency_key', jobs_found: 0 });
  assert.deepEqual([report.unclaimed_probe.cancel.http_status, report.unclaimed_probe.status_after_cancel], [200, 'canceled']);
  assert.equal((await admin(`/v1/compute/jobs/${report.unclaimed_probe.job_id}?org_id=${DEFAULT_ORG}`)).body.status, 'canceled');
  // The same check against an implementation a live device DOES advertise must fail: it is not a refusal.
  const notRefused = await runToExit('submit-job.mjs', ['--run-dir', runDir, '--implementation', 'fixture.echo.local', '--out', path.join(work, 'not-refused'), '--expect-refusal', '--bound-ms', '4000']);
  assert.equal(notRefused.code, 1);

  // Stop the device while it is running a lease. The stop goes to the node
  // agent through its stop file (a SIGTERM on Windows would terminate it with
  // the lease still held): it drains, the running lease commits, then it exits.
  fs.writeFileSync(controlFile, JSON.stringify({ mode: 'ok', delay_ms: 6_000, match: 'slow drain' }));
  const slowOut = path.join(work, 'slow');
  const slow = runToExit('submit-job.mjs', ['--run-dir', runDir, '--implementation', 'fixture.echo.local', '--out', slowOut, '--prompt', 'slow drain', '--idempotency-key', 'drain-1', '--timeout-ms', '90000']);
  let running = null;
  for (let i = 0; i < 60 && !running; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    running = ((await admin(`/v1/compute/jobs?org_id=${DEFAULT_ORG}&idempotency_key=drain-1`)).body?.jobs || []).find((item) => item.status === 'running') || null;
  }
  assert.ok(running, 'the slow job reached running');
  assert.equal(await stopByFile(device, stateDir), 0);
  const slowDone = await slow;
  assert.equal(slowDone.code, 0, slowDone.stdout + slowDone.stderr);
  const drained = (await admin(`/v1/compute/jobs/${running.job_id}?org_id=${DEFAULT_ORG}`)).body;
  assert.deepEqual([drained.status, drained.attempts, drained.execution.status], ['done', 1, 'done'], 'the lease that was running when the stop arrived was committed, not abandoned');
  const agentLog = fs.readFileSync(path.join(stateDir, 'node-agent.log'), 'utf8').trim().split('\n').map((line) => { try { return JSON.parse(line); } catch { return {}; } });
  const draining = agentLog.find((record) => record.event === 'compute_node_draining');
  assert.deepEqual([draining?.signal, draining?.active_leases], ['stop-file', 1]);
  assert.equal(agentLog.find((record) => record.event === 'compute_node_shutdown')?.remaining_leases, 0);
  assert.equal(fs.existsSync(path.join(stateDir, 'node-agent.stop')), false);
  await t.test('a recently disconnected device cannot prove the refusal fence', async () => {
    const listed = await admin(`/v1/compute/nodes?org_id=${DEFAULT_ORG}`);
    assert.ok(listed.body.nodes.some((node) => node.id === enrolled.node_id && node.state === 'online'));
    const inactiveOut = path.join(work, 'disconnected-refusal');
    const attempt = await runToExit('submit-job.mjs', ['--run-dir', runDir, '--implementation', 'qwen3.8b.local', '--out', inactiveOut, '--expect-refusal', '--bound-ms', '2500']);
    assert.equal(attempt.code, 1, 'a stale listing cannot prove the device polled');
    const inactive = JSON.parse(fs.readFileSync(path.join(inactiveOut, 'refusal.json')));
    assert.deepEqual(Object.keys(inactive.checks).filter((name) => !inactive.checks[name]), ['live_devices_were_polling_during_the_probe']);
    assert.deepEqual(inactive.live_devices_during_probe, []);
    assert.equal(inactive.polling_control.cancel.status, 'canceled');
    assert.equal(report.polling_control.observed_claim.node_id, enrolled.node_id);
    assert.ok(report.polling_control.observed_claim.lease_id);
  });

  await t.test('stop after assignment but before the agent receives the lease response', async () => {
    const delayedState = path.join(work, 'delayed-device');
    const held = path.join(work, 'response-held');
    const preload = pathToFileURL(path.join(ROOT, 'core/test/fixtures/hold-lease-response.mjs')).href;
    const delayed = background(path.join(SCRIPTS, 'enroll-device.mjs'), ['--run-dir', runDir, '--state-dir', delayedState, '--name', 'delayed-fixture', '--implementation', 'fixture.echo.local', '--model', 'fixture-echo', '--executor-url', `http://127.0.0.1:${executorPort}`, '--no-stdin'], { ...process.env, FIXTURE_HELD_RESPONSE: held, NODE_OPTIONS: `--import=${preload}` });
    await firstJsonLine(delayed, 'delayed device');
    const submission = await admin('/v1/compute/jobs', { method: 'POST', headers: { 'idempotency-key': 'pending-claim-drain' }, body: { capability: 'ai.chat', implementation: 'fixture.echo.local', input: { prompt: 'delayed claim', num_predict: 16 } } });
    assert.equal(submission.status, 202);
    const wait = async (check, label) => {
      const deadline = Date.now() + 12_000;
      while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
      assert.ok(check(), label);
    };
    await wait(() => fs.existsSync(held), 'the gateway assigned a real lease');
    const stopping = stopByFile(delayed, delayedState);
    const agentLogPath = path.join(delayedState, 'node-agent.log');
    await wait(() => fs.readFileSync(agentLogPath, 'utf8').includes('compute_node_draining'), 'the stop reached the agent before delivery');
    fs.unlinkSync(held);
    assert.equal(await stopping, 0);
    const actual = (await admin(`/v1/compute/jobs/${submission.body.job.job_id}?org_id=${DEFAULT_ORG}`)).body;
    assert.deepEqual([actual.status, actual.attempts, actual.execution?.status], ['done', 1, 'done']);
    const events = fs.readFileSync(agentLogPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events.find((record) => record.event === 'compute_node_draining').pending_claim, true);
    assert.equal(events.find((record) => record.event === 'compute_node_shutdown').remaining_leases, 0);
  });
  assert.equal(await stopByFile(serve, runDir), 0);
  assert.equal(typeof readStagingFile(runDir).stopped_at, 'string');
});
