import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceService, deviceSummary, constrainScopedHeartbeat, enrollmentDigest, consumeScopedEnrollment, computePublicUrl } from '../src/compute/devices.mjs';
import { generateNodeIdentity } from '../src/compute/signature.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const OWNER = { kind: 'owner', user_id: '00000000-0000-4000-8000-000000000003' };
const ID = `node_${'a'.repeat(32)}`;
const TIME = Date.parse('2026-11-22T12:00:00Z');
const CAP = { capability: 'ai.chat', implementation: 'qwen3.8b.local', model: 'qwen3:8b', max_concurrency: 1 };
function liveNode(overrides = {}) { return { id: ID, org_id: ORG, display_name: 'Test Mac', state: 'online', inventory: { platform: 'darwin', arch: 'arm64', memory_bytes: 17179869184 }, capabilities: [CAP], labels: {}, load: {}, max_leases: 1, last_seen_at: new Date(TIME).toISOString(), revoked_at: null, ...overrides }; }

function fixture({ membership = true, enabled = true, nodes = [liveNode()], enrollments = [], tests = [], schema = true } = {}) {
  const calls = [];
  const db = { nodes, enrollments, tests };
  const restImpl = async (path, options = {}) => {
    const url = new URL(path, 'http://fixture.invalid/');
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method, body });
    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    if (url.pathname === '/orgs') return { body: [{ id: ORG, enabled }] };
    if (url.pathname === '/org_members') return { body: membership ? [{ org_id: ORG }] : [] };
    if (url.pathname === '/ops_compute_nodes') {
      const selected = db.nodes.filter((node) => !id || node.id === id);
      if (method === 'PATCH') {
        const before = url.searchParams.get('state')?.replace(/^eq\./, '');
        const node = selected.find((row) => !row.revoked_at && row.state === before);
        if (!node) return { body: [] };
        Object.assign(node, body);
        return { body: [node] };
      }
      return { body: selected };
    }
    if (url.pathname === '/ops_compute_tasks') return { body: db.tests };
    if (url.pathname === '/ops_compute_enrollments') {
      if (!schema) throw Object.assign(new Error('table missing'), { status: 404, detail: { code: 'PGRST205' } });
      if (method === 'POST') { db.enrollments.push({ created_at: new Date(TIME).toISOString(), ...body }); return { body: [db.enrollments.at(-1)] }; }
      if (method === 'PATCH') {
        const row = db.enrollments.find((item) => item.id === id && item.consumed_at == null);
        if (!row) return { body: [] };
        Object.assign(row, body); return { body: [row] };
      }
      return { body: db.enrollments.filter((row) => row.consumed_at == null) };
    }
    if (url.pathname === '/rpc/compute_enqueue_task') return { body: { task: { id: '00000000-0000-4000-8000-000000000009', status: 'queued' } } };
    if (url.pathname === '/rpc/compute_owner_workspace_status') return { body: { version: 1, node_pinning: true } };
    if (url.pathname === '/rpc/compute_resume_owner_device') {
      const node = db.nodes.find(item => item.id === body.p_node_id && item.org_id === body.p_org_id);
      if (node.pair_cleanup_required) throw new Error('DEVICE_PAIR_CLEANUP_REQUIRED');
      node.state = 'online'; return { body: node };
    }
    throw new Error(`Unexpected fixture request ${method} ${url.pathname}`);
  };
  return { service: createDeviceService({ restImpl, now: () => TIME }), restImpl, calls, db };
}

test('every device owner operation rejects a guest/member before touching the data plane', async () => {
  for (const actor of [undefined, { ...OWNER, kind: 'member' }, { ...OWNER, user_id: 'forged' }]) {
    const { service, calls } = fixture();
    for (const method of ['list', 'createEnrollment', 'update', 'test']) {
      await assert.rejects(service[method]({ org_id: ORG }, { actor }), { code: 'DEVICE_OWNER_REQUIRED' });
    }
    assert.equal(calls.length, 0);
  }
});

test('a tenant owner and a removed house owner cannot manage house devices', async () => {
  const other = fixture();
  await assert.rejects(other.service.list({ org_id: OTHER }, { actor: OWNER }), { code: 'DEVICE_ORG_DENIED' });
  const removed = fixture({ membership: false });
  await assert.rejects(removed.service.createEnrollment({ org_id: ORG, display_name: 'Mac' }, { actor: OWNER }), { code: 'DEVICE_OWNER_REQUIRED' });
  assert.ok(removed.calls.every((call) => call.method === 'GET'));
});

test('device administration fails closed when the house workspace is disabled or its enablement is unknown', async () => {
  for (const enabled of [false, null]) {
    const { service, calls } = fixture({ enabled });
    await assert.rejects(service.createEnrollment({ org_id: ORG, display_name: 'Mac' }, { actor: OWNER }), { code: 'DEVICE_HOUSE_UNAVAILABLE' });
    assert.ok(calls.every((call) => call.method === 'GET'));
  }
});

test('staging enrollment uses its configured HTTPS origin and rejects secret-bearing or unsafe URLs', () => {
  assert.equal(computePublicUrl({}), 'https://compute.mccluster.org');
  assert.equal(computePublicUrl({ CORE_COMPUTE_PUBLIC_URL: 'https://localhost:8443/' }), 'https://localhost:8443');
  for (const value of ['http://localhost:8443','https://user:secret@example.invalid','https://example.invalid/?credential=secret','https://example.invalid/#secret','https://example.invalid/enroll','not a URL']) {
    assert.throws(() => computePublicUrl({ CORE_COMPUTE_PUBLIC_URL: value }), { code: 'DEVICE_COORDINATOR_UNAVAILABLE' });
  }
});

test('enrollment stores a digest only and list never returns usable credentials or hashes', async () => {
  const { service, calls } = fixture();
  const issued = await service.createEnrollment({ org_id: ORG, display_name: 'Studio Mac', platform: 'darwin' }, { actor: OWNER });
  assert.match(issued.credential, /^mcen1_[A-Za-z0-9_-]{43}$/);
  assert.equal(Date.parse(issued.expires_at) - TIME, 600_000);
  assert.equal(issued.setup.context, 4096); assert.equal(issued.setup.max_leases, 1);
  const written = calls.find((call) => call.path === 'ops_compute_enrollments' && call.method === 'POST').body;
  assert.equal(written.credential_hash, enrollmentDigest(issued.credential));
  assert.equal(JSON.stringify(calls).includes(issued.credential), false);
  const list = await service.list({ org_id: ORG }, { actor: OWNER });
  assert.equal(list.enrollments[0].display_name, 'Studio Mac');
  assert.equal(JSON.stringify(list).includes(issued.credential), false);
  assert.equal(JSON.stringify(list).includes(written.credential_hash), false);
  assert.equal(JSON.stringify(issued.setup).includes(issued.credential), false);
});

test('finishing on another device reissues the same pending enrollment and invalidates the old credential', async () => {
  const { service, db } = fixture();
  const first = await service.createEnrollment({ org_id: ORG, display_name: 'Studio Mac' }, { actor: OWNER });
  const second = await service.createEnrollment({ org_id: ORG, display_name: 'Studio Mac', enrollment_id: first.enrollment_id }, { actor: OWNER });
  assert.equal(second.enrollment_id, first.enrollment_id);
  assert.notEqual(first.credential, second.credential);
  assert.equal(db.enrollments.length, 1);
  assert.equal(db.enrollments[0].credential_hash, enrollmentDigest(second.credential));
  db.enrollments[0].consumed_at = new Date(TIME).toISOString();
  await assert.rejects(service.createEnrollment({ org_id: ORG, display_name: 'Studio Mac', enrollment_id: first.enrollment_id }, { actor: OWNER }), { code: 'ENROLLMENT_ALREADY_USED' });
});

test('states distinguish actual model readiness, real test receipts, disconnect, pause and permanent revoke', () => {
  assert.equal(deviceSummary(liveNode({ capabilities: [] }), [], TIME).state, 'connected');
  assert.equal(deviceSummary(liveNode(), [], TIME).state, 'model_ready');
  const done = { id: 'test', status: 'done', metadata: { device_id: ID, expected_model: 'qwen3:8b' }, output: { content: 'Ready.', model: 'qwen3:8b' }, ops_compute_leases: [{ node_id: ID, status: 'done', completed_at: new Date(TIME).toISOString() }] };
  assert.equal(deviceSummary(liveNode(), [done], TIME).state, 'test_passed');
  assert.equal(deviceSummary(liveNode(), [{ ...done, ops_compute_leases: [{ node_id: 'another-node', status: 'done' }] }], TIME).state, 'model_ready');
  assert.equal(deviceSummary(liveNode(), [{ ...done, output: { content: '' } }], TIME).state, 'model_ready');
  assert.equal(deviceSummary(liveNode(), [done], TIME + 180_000).state, 'offline');
  assert.equal(deviceSummary(liveNode({ state: 'draining' }), [done], TIME).state, 'paused');
  assert.equal(deviceSummary(liveNode({ state: 'revoked', revoked_at: new Date(TIME).toISOString() }), [done], TIME).state, 'revoked');
});

test('device test success requires the requested model receipt; fallback or unidentified models cannot pass', () => {
  const receipt = { id: 'test', status: 'done', metadata: { device_id: ID, expected_model: 'qwen3:8b' }, output: { content: 'Ready.', model: 'qwen3:8b' }, ops_compute_leases: [{ node_id: ID, status: 'done', completed_at: new Date(TIME).toISOString() }] };
  assert.equal(deviceSummary(liveNode(), [receipt], TIME).test.passed, true);
  for (const output of [{ content: 'Ready.', model: 'other-model', fallback_from: 'qwen3:8b' }, { content: 'Ready.', model: 'qwen3:14b' }, { content: 'Ready.' }]) {
    const summary = deviceSummary(liveNode(), [{ ...receipt, output }], TIME);
    assert.equal(summary.state, 'model_ready');
    assert.equal(summary.test.passed, false);
  }
  assert.equal(deviceSummary(liveNode(), [{ ...receipt, metadata: { device_id: ID } }], TIME).test.passed, false);
});

test('pause drains, resume restores eligibility, rename persists and revoked keys cannot resume', async () => {
  const { service } = fixture();
  const args = { org_id: ORG, node_id: ID };
  const paused = await service.update({ ...args, action: 'pause' }, { actor: OWNER });
  assert.equal(paused.device.state, 'paused'); assert.match(paused.in_flight_policy, /Existing jobs/);
  assert.equal((await service.update({ ...args, action: 'resume' }, { actor: OWNER })).device.eligible, true);
  assert.equal((await service.update({ ...args, action: 'rename', display_name: 'Second Mac' }, { actor: OWNER })).device.display_name, 'Second Mac');
  assert.equal((await service.list({ org_id: ORG }, { actor: OWNER })).devices[0].display_name, 'Second Mac');
  const revoked = await service.update({ ...args, action: 'revoke' }, { actor: OWNER });
  assert.equal(revoked.device.state, 'revoked'); assert.match(revoked.in_flight_policy, /late results are rejected/);
  await assert.rejects(service.update({ ...args, action: 'resume' }, { actor: OWNER }), { code: 'DEVICE_REVOKED' });
  await assert.rejects(service.test(args, { actor: OWNER }), { code: 'DEVICE_NOT_READY' });
});

test('unconfirmed pair cleanup cannot be cleared by Resume and remains visibly ineligible', async () => {
  const { service } = fixture({ nodes: [liveNode({ state: 'draining', pair_cleanup_required: true, pair_cleanup_details: { reservation_id: 'fixture-reservation' } })] });
  const device = (await service.list({ org_id: ORG }, { actor: OWNER })).devices[0];
  assert.equal(device.eligible, false); assert.equal(device.resume_available, false); assert.equal(device.cleanup_required, true);
  assert.match(device.recovery, /signed cleanup confirmation/);
  await assert.rejects(service.update({ org_id: ORG, node_id: ID, action: 'resume' }, { actor: OWNER }), { code: 'DEVICE_PAIR_CLEANUP_REQUIRED' });
});

test('a device cannot broaden its one-job enrollment scope in a signed heartbeat', () => {
  const scope = { implementations: ['qwen3.8b.local'], max_leases: 1 };
  const node = liveNode({ labels: { enrollment_scope: scope, enrollment_id: 'scoped-id', trust: 'owned' } });
  const result = constrainScopedHeartbeat(node, { maxLeases: 64, labels: { enrollment_scope: {}, enrollment_id: 'forged' }, capabilities: [CAP, { capability: 'browser.act', implementation: 'chromium.local' }, { ...CAP, implementation: 'other-model' }] });
  assert.equal(result.maxLeases, 1);
  assert.deepEqual(result.capabilities, [CAP]);
  assert.deepEqual(result.labels.enrollment_scope, scope);
  assert.equal(result.labels.enrollment_id, 'scoped-id');
});

test('test queues qwen3 on the selected node with the real adapter 4K fields', async () => {
  const { service, calls } = fixture();
  const result = await service.test({ org_id: ORG, node_id: ID }, { actor: OWNER });
  assert.equal(result.status, 'queued');
  const request = calls.find((call) => call.path === 'rpc/compute_enqueue_task').body;
  assert.deepEqual(request.p_requirements, { node_id: ID });
  assert.equal(request.p_input.num_ctx, 4096); assert.equal(request.p_input.num_predict, 64);
  assert.equal(request.p_input.strict_model, true);
  assert.equal(request.p_metadata.purpose, 'owner-device-test');
});

test('missing pending schema is explicit while existing device inventory remains usable', async () => {
  const { service } = fixture({ schema: false });
  const list = await service.list({ org_id: ORG }, { actor: OWNER });
  assert.equal(list.devices.length, 1); assert.equal(list.enrollment_available, false);
  await assert.rejects(service.createEnrollment({ org_id: ORG, display_name: 'Mac' }, { actor: OWNER }), { code: 'DEVICE_SCHEMA_UNAVAILABLE' });
});

test('invalid credentials and keys fail before any RPC; an unsuccessful consume is never enrollment', async () => {
  let calls = 0;
  const restImpl = async () => { calls++; return { body: null }; };
  await assert.rejects(consumeScopedEnrollment('mcen1_bad', {}, { restImpl }), { code: 'ENROLLMENT_INVALID_OR_EXPIRED' });
  await assert.rejects(consumeScopedEnrollment(`mcen1_${'a'.repeat(43)}`, {}, { restImpl }), { code: 'ENROLLMENT_REQUEST_INVALID' });
  assert.equal(calls, 0);
  const identity = generateNodeIdentity();
  await assert.rejects(consumeScopedEnrollment(`mcen1_${'a'.repeat(43)}`, { protocol: 'mccluster-compute/1', org_id: ORG, public_key: identity.publicKeyPem, inventory: { platform: 'darwin' }, capabilities: [CAP], max_leases: 1 }, { restImpl }), { code: 'ENROLLMENT_INVALID_OR_EXPIRED' });
  assert.equal(calls, 1);
});
