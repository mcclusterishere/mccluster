import test from 'node:test';
import assert from 'node:assert/strict';
import { generateNodeIdentity, signRequest } from '../src/compute/signature.mjs';
import { generateReceiptKey, hashJson, verifyReceipt } from '../src/compute/jobs.mjs';
import { cancelJob, getJob, getJobReceipt, getJobResult, listJobs, receiptKey, recordCompletionAttestation, submitJob } from '../src/compute/jobs-service.mjs';
import { handleJobRoute, matchesJobRoute } from '../src/compute/jobs-routes.mjs';
import { CONTROL_TOOLS, callControlTool } from '../src/tools/control.mjs';
import { JOB_TOOLS } from '../src/tools/jobs.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const OTHER_ORG = '00000000-0000-4000-8000-000000000002';
const TASK = '10000000-0000-4000-8000-000000000001';
const LEASE = '20000000-0000-4000-8000-000000000001';

function memoryDeps({ live = [{ node_id: 'node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', capability: 'ai.chat', implementation: 'fixture.echo.local' }], receiptKey: key = generateReceiptKey() } = {}) {
  const tasks = new Map();
  const leases = new Map();
  const attestations = new Map();
  const nodes = new Map();
  const logs = [];
  const enqueued = [];
  const deps = {
    env: {},
    live: async () => live,
    enqueue: async (args) => {
      enqueued.push(args);
      if (args.idempotencyKey && [...tasks.values()].some((t) => t.idempotency_key === args.idempotencyKey)) {
        const existing = [...tasks.values()].find((t) => t.idempotency_key === args.idempotencyKey);
        return { task: existing, replayed: true };
      }
      const task = { id: TASK, org_id: args.orgId, capability: args.capability, implementation: args.implementation, input: args.input, requirements: args.requirements, priority: args.priority, status: 'queued', run_after: '2026-11-23T00:00:00.000Z', attempts: 0, max_attempts: args.maxAttempts, output: null, last_error: null, metadata: args.metadata, idempotency_key: args.idempotencyKey, created_at: '2026-11-23T00:00:00.000Z', updated_at: '2026-11-23T00:00:00.000Z' };
      tasks.set(task.id, task);
      return { task, replayed: false };
    },
    taskById: async ({ orgId, taskId }) => { const t = tasks.get(taskId); return t && t.org_id === orgId ? t : null; },
    nodeById: async (id) => nodes.get(id) || null,
    leasesForTask: async ({ taskId }) => [...leases.values()].filter((l) => l.task_id === taskId),
    leaseById: async ({ leaseId }) => leases.get(leaseId) || null,
    listTasks: async ({ orgId, status, idempotencyKey = null }) => [...tasks.values()].filter((t) => t.org_id === orgId && (!status || status.split(',').includes(t.status)) && (!idempotencyKey || t.idempotency_key === idempotencyKey)),
    // As the store does it: only a queued task is canceled, anything else answers null.
    cancelQueued: async ({ orgId, taskId, reason }) => { const t = tasks.get(taskId); if (!t || t.org_id !== orgId || t.status !== 'queued') return null; Object.assign(t, { status: 'canceled', last_error: reason }); return t; },
    nodesById: async ({ ids }) => ids.map((id) => nodes.get(id)).filter(Boolean),
    recordAttestation: async (row) => { if (attestations.has(row.lease_id)) return { recorded: false, replayed: true, available: true }; attestations.set(row.lease_id, row); return { recorded: true, replayed: false, available: true }; },
    attestationForLease: async ({ leaseId }) => attestations.get(leaseId) || null,
    receiptKey: () => key,
    now: () => '2026-11-23T00:00:09.000Z',
    log: (record) => logs.push(record)
  };
  return { deps, tasks, leases, attestations, nodes, logs, enqueued, key };
}

test('submit refuses without a live node unless allow_offline, records provenance, and replays by idempotency key', async () => {
  const offline = memoryDeps({ live: [] });
  await assert.rejects(() => submitJob({ capability: 'ai.chat', input: { prompt: 'hi' } }, { canonicalOrg: ORG }, offline.deps), (e) => e.code === 'COMPUTE_NO_LIVE_NODE' && e.status === 503);
  const queued = await submitJob({ capability: 'ai.chat', input: { prompt: 'hi' }, allow_offline: true }, { canonicalOrg: ORG }, offline.deps);
  assert.equal(queued.live_nodes, 0);
  assert.equal(queued.job.status, 'queued');

  const m = memoryDeps();
  const first = await submitJob({ capability: 'ai.chat', input: { prompt: 'hi' }, client: { name: 'prime-windows', version: '0.1' } }, { canonicalOrg: ORG, idempotencyKey: 'k-1', actor: { kind: 'owner', user_id: '11111111-1111-4111-8111-111111111111', source: 'test' }, via: 'core-tool' }, m.deps);
  assert.equal(first.replayed, false);
  assert.equal(first.job.schema, 'mccluster-job/1');
  assert.equal(first.job.metadata.source, 'device-jobs/1');
  assert.equal(first.job.metadata.client.name, 'prime-windows');
  assert.equal(first.job.metadata.submitted_by.kind, 'owner');
  assert.deepEqual(first.live_node_ids, ['node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
  assert.equal(first.job.metadata.submitted_at, undefined, 'metadata is part of the idempotency hash and must not vary between retries');
  assert.deepEqual(m.enqueued[0].metadata, m.enqueued[0].metadata && JSON.parse(JSON.stringify(m.enqueued[0].metadata)));
  const again = await submitJob({ capability: 'ai.chat', input: { prompt: 'hi' } }, { canonicalOrg: ORG, idempotencyKey: 'k-1' }, m.deps);
  assert.equal(again.replayed, true);
  await assert.rejects(() => submitJob({ capability: 'ai.chat', org_id: OTHER_ORG }, { canonicalOrg: ORG }, m.deps), (e) => e.code === 'CROSS_ORG_DENIED');
});

test('status, result and receipt read the durable rows; another org never sees the job', async () => {
  const m = memoryDeps();
  const identity = generateNodeIdentity();
  const { job } = await submitJob({ capability: 'ai.chat', input: { prompt: 'hi' } }, { canonicalOrg: ORG }, m.deps);
  const task = m.tasks.get(job.job_id);
  const output = { model: 'fixture', content: 'ECHO: hi' };
  m.nodes.set(identity.nodeId, { id: identity.nodeId, org_id: ORG, display_name: 'fixture', public_key_pem: identity.publicKeyPem, key_fingerprint: identity.fingerprint, state: 'online', inventory: { platform: 'linux', runtime: { hardware_mode: 'cpu-only' } }, labels: { enrolled_trust: 'owned' } });
  m.leases.set(LEASE, { id: LEASE, task_id: task.id, node_id: identity.nodeId, implementation: 'fixture.echo.local', attempt: 1, status: 'running', created_at: '2026-11-23T00:00:01.000Z', started_at: '2026-11-23T00:00:01.000Z' });
  Object.assign(task, { status: 'running', attempts: 1, locked_by_node_id: identity.nodeId });
  const running = await getJob({ orgId: ORG, jobId: task.id }, m.deps);
  assert.equal(running.status, 'running');
  assert.equal(running.execution.lease_id, LEASE);
  assert.equal(running.node.node_id, identity.nodeId);
  await assert.rejects(() => getJobResult({ orgId: ORG, jobId: task.id }, m.deps), (e) => e.code === 'JOB_NOT_DONE');
  await assert.rejects(() => getJob({ orgId: OTHER_ORG, jobId: task.id }, m.deps), (e) => e.code === 'JOB_NOT_FOUND');
  await assert.rejects(() => getJob({ orgId: ORG, jobId: 'nope' }, m.deps), (e) => e.code === 'JOB_ID_INVALID');

  // The node completes: the gateway records its signature after the SQL fence accepted the result.
  const path = `/v1/compute/leases/${LEASE}/complete`;
  const headers = signRequest({ privateKeyPem: identity.privateKeyPem, method: 'POST', path, nodeId: identity.nodeId, bodyBytes: Buffer.from(JSON.stringify({ lease_token: 't', result: output })) });
  Object.assign(m.leases.get(LEASE), { status: 'done', result: output, completed_at: '2026-11-23T00:00:04.000Z' });
  Object.assign(task, { status: 'done', output, locked_by_node_id: null });
  const recorded = await recordCompletionAttestation({ node: m.nodes.get(identity.nodeId), leaseId: LEASE, path, headers, result: output }, m.deps);
  assert.equal(recorded.recorded, true);
  const replay = await recordCompletionAttestation({ node: m.nodes.get(identity.nodeId), leaseId: LEASE, path, headers, result: output }, m.deps);
  assert.equal(replay.replayed, true);

  const result = await getJobResult({ orgId: ORG, jobId: task.id }, m.deps);
  assert.deepEqual(result.output, output);
  assert.equal(result.output_sha256, hashJson(output));
  const receipt = await getJobReceipt({ orgId: ORG, jobId: task.id, issuer: { instance: 'core-test' } }, m.deps);
  assert.equal(receipt.signed, true);
  assert.equal(receipt.node_attestation.verified, true);
  assert.equal(receipt.node_attestation.matches_output, true);
  assert.equal(receipt.execution.node_key_fingerprint, identity.fingerprint);
  assert.deepEqual(verifyReceipt(receipt, m.key.publicKeyPem), { ok: true, reason: null });
  const list = await listJobs({ orgId: ORG, status: 'done' }, m.deps);
  assert.equal(list.count, 1);
  assert.equal(receiptKey(m.deps).key_id, m.key.keyId);
});

test('a failed attestation write is logged and never fails the completion', async () => {
  const m = memoryDeps();
  m.deps.leaseById = async () => { throw new Error('database away'); };
  const out = await recordCompletionAttestation({ node: { id: 'node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, leaseId: LEASE, path: `/v1/compute/leases/${LEASE}/complete`, headers: {}, result: {} }, m.deps);
  assert.equal(out.recorded, false);
  assert.equal(m.logs[0].event, 'compute_attestation_record_failed');
});

test('gateway job routes sit behind the admin secret and the canonical-org fence', async () => {
  const m = memoryDeps();
  const calls = [];
  const requireAdmin = () => { calls.push('admin'); };
  const adminOrg = (requested) => { if (requested && requested !== ORG) throw Object.assign(new Error('cross org'), { status: 403, code: 'CROSS_ORG_DENIED' }); return requested || ORG; };
  const canonicalOrg = ORG;
  assert.equal(matchesJobRoute('/v1/compute/lease'), false);
  assert.equal(await handleJobRoute({ req: { method: 'POST', headers: {} }, url: new URL('http://127.0.0.1/v1/compute/lease'), body: {}, requireAdmin, adminOrg, canonicalOrg }, m.deps), null);
  assert.equal(calls.length, 0);

  const denied = () => { throw Object.assign(new Error('Unauthorized'), { status: 401, code: 'UNAUTHORIZED' }); };
  await assert.rejects(() => handleJobRoute({ req: { method: 'POST', headers: {} }, url: new URL('http://127.0.0.1/v1/compute/jobs'), body: { capability: 'ai.chat' }, requireAdmin: denied, adminOrg, canonicalOrg }, m.deps), (e) => e.status === 401);
  assert.equal(m.enqueued.length, 0);

  const submitted = await handleJobRoute({ req: { method: 'POST', headers: { 'idempotency-key': 'route-1' } }, url: new URL('http://127.0.0.1/v1/compute/jobs'), body: { capability: 'ai.chat', input: { prompt: 'x' } }, requireAdmin, adminOrg, canonicalOrg }, m.deps);
  assert.equal(submitted.status, 202);
  assert.equal(submitted.headers['idempotency-replayed'], 'false');
  const replayed = await handleJobRoute({ req: { method: 'POST', headers: { 'idempotency-key': 'route-1' } }, url: new URL('http://127.0.0.1/v1/compute/jobs'), body: { capability: 'ai.chat', input: { prompt: 'x' } }, requireAdmin, adminOrg, canonicalOrg }, m.deps);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.headers['idempotency-replayed'], 'true');
  await assert.rejects(() => handleJobRoute({ req: { method: 'POST', headers: {} }, url: new URL('http://127.0.0.1/v1/compute/jobs'), body: { capability: 'ai.chat', org_id: OTHER_ORG }, requireAdmin, adminOrg, canonicalOrg }, m.deps), (e) => e.code === 'CROSS_ORG_DENIED');
  const id = submitted.body.job.job_id;
  const status = await handleJobRoute({ req: { method: 'GET', headers: {} }, url: new URL(`http://127.0.0.1/v1/compute/jobs/${id}`), body: {}, requireAdmin, adminOrg, canonicalOrg }, m.deps);
  assert.equal(status.body.status, 'queued');
  await assert.rejects(() => handleJobRoute({ req: { method: 'GET', headers: {} }, url: new URL(`http://127.0.0.1/v1/compute/jobs/${id}/result`), body: {}, requireAdmin, adminOrg, canonicalOrg }, m.deps), (e) => e.code === 'JOB_NOT_DONE');
  const key = await handleJobRoute({ req: { method: 'GET', headers: {} }, url: new URL('http://127.0.0.1/v1/compute/receipt-key'), body: {}, requireAdmin, adminOrg, canonicalOrg }, m.deps);
  assert.equal(key.body.configured, true);
  const list = await handleJobRoute({ req: { method: 'GET', headers: {} }, url: new URL('http://127.0.0.1/v1/compute/jobs?status=queued'), body: {}, requireAdmin, adminOrg, canonicalOrg }, m.deps);
  assert.equal(list.body.count, 1);
  const wrongMethod = await handleJobRoute({ req: { method: 'DELETE', headers: {} }, url: new URL(`http://127.0.0.1/v1/compute/jobs/${id}`), body: {}, requireAdmin, adminOrg, canonicalOrg }, m.deps);
  assert.equal(wrongMethod.status, 405);
});

test('the job tools are registered as Core control tools with org_id required and no extra properties', async () => {
  const names = new Set(CONTROL_TOOLS.map((tool) => tool.name));
  for (const tool of JOB_TOOLS) {
    assert.ok(names.has(tool.name), `missing ${tool.name}`);
    assert.equal(tool.inputSchema.additionalProperties, false);
    if (tool.name !== 'core.compute.receipt.key') assert.ok(tool.inputSchema.required.includes('org_id'), `${tool.name} must require org_id`);
  }
  await assert.rejects(() => callControlTool('core.compute.job.get', { org_id: 'not-a-uuid', job_id: TASK }), /org_id must be a UUID/);
});

test('the Worker edge allowlists exactly the job tools Core registers and pins their org_id to the house org', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../workers/mccluster-mcp/src/mcp.js', import.meta.url), 'utf8');
  for (const tool of JOB_TOOLS) assert.ok(source.includes(`'${tool.name}'`), `${tool.name} is not allowlisted at the edge`);
  assert.match(source, /toolName\.startsWith\('core\.compute\.job\.'\)/);
});

test('a standby scheduler refuses submission and handover but still answers reads and status', async () => {
  const m = memoryDeps();
  const requireAdmin = () => {};
  const adminOrg = () => ORG;
  const standby = { orgId: ORG, holderId: 'prime-standby', isActive: () => false, holder: 'ovh-primary', snapshot: () => ({ role: 'standby', active: false, live_holder: 'ovh-primary' }), store: { status: async () => ({ holder_id: 'ovh-primary', term: 1 }) }, requestHandover: async () => { throw new Error('should not be reached'); } };
  await assert.rejects(() => handleJobRoute({ req: { method: 'POST', headers: {} }, url: new URL('http://127.0.0.1/v1/compute/jobs'), body: { capability: 'ai.chat', input: {} }, requireAdmin, adminOrg, canonicalOrg: ORG, election: standby }, m.deps), (e) => e.code === 'SCHEDULER_STANDBY' && e.status === 503 && e.active_holder === 'ovh-primary');
  assert.equal(m.enqueued.length, 0);
  const status = await handleJobRoute({ req: { method: 'GET', headers: {} }, url: new URL('http://127.0.0.1/v1/compute/scheduler'), body: {}, requireAdmin, adminOrg, canonicalOrg: ORG, election: standby }, m.deps);
  assert.equal(status.body.configured, true);
  assert.equal(status.body.store.holder_id, 'ovh-primary');
  const list = await handleJobRoute({ req: { method: 'GET', headers: {} }, url: new URL('http://127.0.0.1/v1/compute/jobs'), body: {}, requireAdmin, adminOrg, canonicalOrg: ORG, election: standby }, m.deps);
  assert.equal(list.status, 200);
  const none = await handleJobRoute({ req: { method: 'GET', headers: {} }, url: new URL('http://127.0.0.1/v1/compute/scheduler'), body: {}, requireAdmin, adminOrg, canonicalOrg: ORG, election: null }, m.deps);
  assert.equal(none.body.configured, false);
  await assert.rejects(() => handleJobRoute({ req: { method: 'POST', headers: {} }, url: new URL('http://127.0.0.1/v1/compute/scheduler/handover'), body: { to_holder_id: 'x' }, requireAdmin, adminOrg, canonicalOrg: ORG, election: null }, m.deps), (e) => e.code === 'SCHEDULER_NOT_CONFIGURED');
  const active = { ...standby, isActive: () => true, requestHandover: async (to, grace) => ({ ok: true, handover_to: to, grace }) };
  const accepted = await handleJobRoute({ req: { method: 'POST', headers: {} }, url: new URL('http://127.0.0.1/v1/compute/jobs'), body: { capability: 'ai.chat', input: {} }, requireAdmin, adminOrg, canonicalOrg: ORG, election: active }, m.deps);
  assert.equal(accepted.status, 202);
  const handover = await handleJobRoute({ req: { method: 'POST', headers: {} }, url: new URL('http://127.0.0.1/v1/compute/scheduler/handover'), body: { to_holder_id: 'ovh-primary', grace_seconds: 60 }, requireAdmin, adminOrg, canonicalOrg: ORG, election: active }, m.deps);
  assert.equal(handover.status, 200);
  assert.equal(handover.body.handover_to, 'ovh-primary');
});

test('the preflight applies the claim\'s tests: feature requirements and owned-only admission', async () => {
  const live = [
    { node_id: 'node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', capability: 'ai.chat', implementation: 'text.local', features: { chat: true }, labels: { enrolled_trust: 'owned' } },
    { node_id: 'node_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', capability: 'browser.act', implementation: 'chromium.local', features: { browser: true }, labels: {} }
  ];
  const m = memoryDeps({ live });
  await assert.rejects(() => submitJob({ capability: 'ai.chat', input: {}, requirements: { vision: true } }, { canonicalOrg: ORG }, m.deps), (e) => e.code === 'COMPUTE_NO_LIVE_NODE');
  await assert.rejects(() => submitJob({ capability: 'browser.act', input: { actions: [] } }, { canonicalOrg: ORG }, m.deps), (e) => e.code === 'COMPUTE_NO_LIVE_NODE');
  const ok = await submitJob({ capability: 'ai.chat', input: {}, requirements: { chat: true } }, { canonicalOrg: ORG }, m.deps);
  assert.equal(ok.live_nodes, 1);
});

test('job routes fail closed when the gateway has no canonical org, and the job tools fence against MCCLUSTER_ORG_ID', async () => {
  const m = memoryDeps();
  const requireAdmin = () => {};
  const adminOrg = (requested) => requested || null;
  for (const [method, pathname] of [['POST', '/v1/compute/jobs'], ['GET', `/v1/compute/jobs?org_id=${ORG}`], ['GET', `/v1/compute/jobs/${TASK}?org_id=${ORG}`]]) {
    await assert.rejects(() => handleJobRoute({ req: { method, headers: {} }, url: new URL(`http://127.0.0.1${pathname}`), body: { capability: 'ai.chat', org_id: ORG }, requireAdmin, adminOrg, canonicalOrg: null }, m.deps), (e) => e.code === 'ORG_NOT_CONFIGURED' && e.status === 503, `${method} ${pathname}`);
  }
  assert.equal(m.enqueued.length, 0);
  const previous = process.env.MCCLUSTER_ORG_ID;
  process.env.MCCLUSTER_ORG_ID = ORG;
  try {
    await assert.rejects(() => callControlTool('core.compute.job.get', { org_id: OTHER_ORG, job_id: TASK }), (e) => e.code === 'CROSS_ORG_DENIED' && e.status === 403);
  } finally {
    if (previous === undefined) delete process.env.MCCLUSTER_ORG_ID; else process.env.MCCLUSTER_ORG_ID = previous;
  }
});

test('the receipt is built from the device facts bound at completion: a later inventory change, rename or re-read leaves it byte-identical', async () => {
  const m = memoryDeps();
  const identity = generateNodeIdentity();
  const { job } = await submitJob({ capability: 'ai.chat', implementation: 'fixture.echo.local', input: { prompt: 'hi' } }, { canonicalOrg: ORG }, m.deps);
  const task = m.tasks.get(job.job_id);
  const output = { model: 'qwen3-vl:4b', content: 'ok', usage: { model_digest: 'a'.repeat(64), ollama_version: '0.0.0-test' } };
  const atCompletion = {
    id: identity.nodeId, org_id: ORG, display_name: 'device-a', public_key_pem: identity.publicKeyPem, key_fingerprint: identity.fingerprint, state: 'online', labels: { enrolled_trust: 'owned' },
    capabilities: [{ capability: 'ai.chat', implementation: 'fixture.echo.local', backend: 'ollama', model: 'qwen3-vl:4b', features: { model_digest: 'a'.repeat(64), runtime_version: '0.0.0-test' } }],
    inventory: { platform: 'win32', arch: 'x64', gpus: [{ vendor: 'amd', model: 'integrated' }], runtime: { hardware_mode: 'gpu-verified', gpu_verified_at: '2026-11-23T00:00:03.000Z', gpu_evidence: { source: 'ollama:/api/ps', model: 'qwen3-vl:4b', digest: 'a'.repeat(64), size_vram_bytes: 7, size_bytes: 7, processor_gpu_percent: 100, checked_at: '2026-11-23T00:00:03.000Z' } } }
  };
  m.nodes.set(identity.nodeId, atCompletion);
  m.leases.set(LEASE, { id: LEASE, task_id: task.id, node_id: identity.nodeId, implementation: 'fixture.echo.local', attempt: 1, status: 'done', result: output, created_at: '2026-11-23T00:00:01.000Z', started_at: '2026-11-23T00:00:01.000Z', completed_at: '2026-11-23T00:00:04.000Z' });
  Object.assign(task, { status: 'done', attempts: 1, output });
  const path = `/v1/compute/leases/${LEASE}/complete`;
  const headers = signRequest({ privateKeyPem: identity.privateKeyPem, method: 'POST', path, nodeId: identity.nodeId, bodyBytes: Buffer.from(JSON.stringify({ lease_token: 't', result: output })) });
  // The gateway hands over the node row it authenticated the completion against.
  assert.equal((await recordCompletionAttestation({ node: atCompletion, leaseId: LEASE, path, headers, result: output }, m.deps)).recorded, true);
  const stored = m.attestations.get(LEASE);
  assert.equal(stored.device_facts.captured_at, '2026-11-23T00:00:09.000Z');
  assert.equal(stored.device_facts.hardware_mode, 'gpu-verified');
  assert.equal(stored.device_facts.advertised.model_digest, 'a'.repeat(64), 'the manifest entry is the one for the lease\'s implementation');

  const first = await getJobReceipt({ orgId: ORG, jobId: task.id, issuer: { instance: 'core-test' } }, m.deps);
  assert.deepEqual([first.execution.hardware_mode, first.execution.platform, first.execution.arch, first.execution.node_display_name], ['gpu-verified', 'win32', 'x64', 'device-a']);
  assert.equal(first.execution.hardware_evidence.engine.checked_at, '2026-11-23T00:00:03.000Z');
  assert.deepEqual(first.execution.model, { name: 'qwen3-vl:4b', digest: 'a'.repeat(64), runtime_version: '0.0.0-test', reported_by: 'node-result' });

  // Afterwards the node heartbeats a different machine state, is renamed, and
  // a replayed completion arrives; the receipt is read again at a later time.
  const later = { ...atCompletion, display_name: 'renamed', capabilities: [], inventory: { platform: 'linux', arch: 'arm64', gpus: [], runtime: { hardware_mode: 'cpu-only', gpu_verified_at: null, gpu_evidence: { source: 'ollama:/api/ps', model: null, size_vram_bytes: 0, size_bytes: 0, checked_at: '2026-11-25T00:00:00.000Z' } } } };
  m.nodes.set(identity.nodeId, later);
  m.deps.now = () => '2026-11-25T00:00:00.000Z';
  assert.equal((await recordCompletionAttestation({ node: later, leaseId: LEASE, path, headers, result: output }, m.deps)).replayed, true);
  assert.equal(m.attestations.get(LEASE).device_facts.hardware_mode, 'gpu-verified', 'a replayed completion does not rebind the facts');
  const second = await getJobReceipt({ orgId: ORG, jobId: task.id, issuer: { instance: 'core-test' } }, m.deps);
  assert.equal(JSON.stringify(second), JSON.stringify(first), 'two reads of a bound receipt are byte-identical, signature included');
  assert.equal(second.signature.value, first.signature.value);
  assert.deepEqual(verifyReceipt(second, m.key.publicKeyPem), { ok: true, reason: null });
  // The live view is allowed to follow the node; only the signed receipt is bound.
  assert.equal((await getJob({ orgId: ORG, jobId: task.id }, m.deps)).node.hardware_mode, 'cpu-only');
});

test('a job is found by its Idempotency-Key exactly, and only a queued job can be canceled', async () => {
  const m = memoryDeps();
  const requireAdmin = () => {};
  const adminOrg = (requested) => { if (requested && requested !== ORG) throw Object.assign(new Error('cross org'), { status: 403, code: 'CROSS_ORG_DENIED' }); return requested || ORG; };
  const route = (method, pathname, body = {}, headers = {}) => handleJobRoute({ req: { method, headers }, url: new URL(`http://127.0.0.1${pathname}`), body, requireAdmin, adminOrg, canonicalOrg: ORG }, m.deps);
  const submitted = await route('POST', '/v1/compute/jobs', { capability: 'ai.chat', input: { prompt: 'x' } }, { 'idempotency-key': 'probe-1' });
  const id = submitted.body.job.job_id;
  assert.deepEqual((await route('GET', '/v1/compute/jobs?idempotency_key=probe-1')).body.jobs.map((job) => job.job_id), [id]);
  assert.equal((await route('GET', '/v1/compute/jobs?idempotency_key=never-used')).body.count, 0);
  await assert.rejects(() => route('GET', '/v1/compute/jobs?idempotency_key=has%20space'), (e) => e.code === 'BAD_IDEMPOTENCY_KEY' && e.status === 400);

  assert.equal((await route('GET', `/v1/compute/jobs/${id}/cancel`)).status, 405);
  await assert.rejects(() => route('POST', `/v1/compute/jobs/${id}/cancel`, { org_id: OTHER_ORG }), (e) => e.code === 'CROSS_ORG_DENIED');
  await assert.rejects(() => cancelJob({ orgId: OTHER_ORG, jobId: id }, m.deps), (e) => e.code === 'JOB_NOT_FOUND');
  const canceled = await route('POST', `/v1/compute/jobs/${id}/cancel`, { reason: 'probe finished' });
  assert.deepEqual([canceled.status, canceled.body.status, canceled.body.terminal, canceled.body.last_error], [200, 'canceled', true, 'probe finished']);
  // Already terminal, or held by a node: refused by name with the state it is in.
  await assert.rejects(() => route('POST', `/v1/compute/jobs/${id}/cancel`), (e) => e.code === 'JOB_NOT_CANCELABLE' && e.status === 409 && e.job_status === 'canceled');
  m.tasks.get(id).status = 'running';
  await assert.rejects(() => cancelJob({ orgId: ORG, jobId: id }, m.deps), (e) => e.code === 'JOB_NOT_CANCELABLE' && e.job_status === 'running');
  const denied = () => { throw Object.assign(new Error('Unauthorized'), { status: 401, code: 'UNAUTHORIZED' }); };
  await assert.rejects(() => handleJobRoute({ req: { method: 'POST', headers: {} }, url: new URL(`http://127.0.0.1/v1/compute/jobs/${id}/cancel`), body: {}, requireAdmin: denied, adminOrg, canonicalOrg: ORG }, m.deps), (e) => e.status === 401);
});