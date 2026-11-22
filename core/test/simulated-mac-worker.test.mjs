import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startOwnerWorkspaceRuntime, fixtureUntil } from './helpers/owner-workspace-runtime.mjs';

const modulePath = process.env.PGLITE_MODULE_PATH;
const enabled = modulePath && fs.existsSync(modulePath);
const required = process.env.MCCLUSTER_DEVICE_SQL_TESTS_REQUIRED === '1';
function value(reply) {
  assert.equal(reply.status, 200);
  assert.ok(!reply.body.error && !reply.body.result?.isError);
  let result = reply.body.result.structuredContent || JSON.parse(reply.body.result.content.find(item => item.type === 'text').text);
  while (result?.result && typeof result.result === 'object') result = result.result;
  return result;
}

test('explicit simulated Mac enrollment uses protected keys and real signed streamed leases without hardware claims', { timeout: 60000, skip: !enabled && !required ? 'Requires pinned PGlite/pgcrypto and the disposable TLS fixture.' : false }, async () => {
  assert.ok(enabled, 'Set PGLITE_MODULE_PATH for the required simulated worker proof.');
  const runtime = await startOwnerWorkspaceRuntime({ modulePath, workers: 0 });
  try {
    const issued = value(await runtime.mcp('core.compute.enrollment.create', { org_id: runtime.ORG, display_name: 'Explicit simulated Mac', platform: 'darwin' }));
    assert.match(issued.credential, /^mcen1_[A-Za-z0-9_-]{43}$/);
    const worker = await runtime.addWorker('Explicit simulated Mac', issued, true);
    await runtime.ready(worker.agent, 'simulated_mac_worker_ready');
    const node = (await runtime.db.query('select * from ops_compute_nodes where id=$1', [worker.nodeId])).rows[0];
    assert.equal(node.inventory.platform, 'darwin');
    assert.equal(node.inventory.arch, 'arm64');
    assert.equal(node.inventory.memory_bytes, 16 * 1024 ** 3);
    assert.deepEqual(node.inventory.gpus, []);
    assert.deepEqual(node.inventory.runtime, { fixture: true, hardware_mode: 'simulated' });
    assert.equal(node.labels.fixture, 'simulated-mac');
    assert.equal(node.max_leases, 1);
    assert.equal(fs.statSync(worker.identityPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(worker.identityPath)).mode & 0o777, 0o700);
    const queued = value(await runtime.mcp('core.compute.device.test', { org_id: runtime.ORG, node_id: worker.nodeId }));
    const streamed = await fixtureUntil(async () => {
      const row = (await runtime.db.query('select l.node_id,l.progress,t.status from ops_compute_leases l join ops_compute_tasks t on t.id=l.task_id where t.id=$1 order by l.created_at desc limit 1', [queued.task_id])).rows[0];
      return row?.status === 'running' && row.progress?.content ? row : null;
    });
    assert.equal(streamed.node_id, worker.nodeId);
    assert.ok(streamed.progress.content.length > 0);
    await fixtureUntil(async () => (await runtime.db.query('select status from ops_compute_tasks where id=$1', [queued.task_id])).rows[0]?.status === 'done');
    const listed = value(await runtime.mcp('core.compute.devices.list', { org_id: runtime.ORG }));
    assert.equal(listed.devices[0].state, 'test_passed');
    assert.equal(worker.requests[0].stream, true);
    assert.equal(worker.requests[0].options.num_ctx, 4096);
    assert.equal(worker.generation.peak, 1);
    const identity = JSON.parse(fs.readFileSync(worker.identityPath, 'utf8'));
    await worker.stop(); worker.start(); await runtime.ready(worker.agent, 'simulated_mac_worker_ready');
    assert.equal((await runtime.db.query('select count(*)::integer as n from ops_compute_nodes')).rows[0].n, 1, 'restart reconnects using the same key without another enrollment');
    assert.equal(runtime.logs.join('').includes(issued.credential), false);
    assert.equal(runtime.logs.join('').includes(identity.privateKeyPem), false);
  } finally { await runtime.close(); }
});
