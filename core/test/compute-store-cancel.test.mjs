// store.mjs against a fake PostgREST: the atomic cancel of a still-queued task
// (the fabric-first client's escape hatch) and the optional yield parameter on
// the claim, which must survive a gateway that still runs the 4-argument SQL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { cancelQueuedComputeTask, claimLease } from '../src/compute/store.mjs';

const ORG = '00000000-0000-0000-0000-000000000001';
const TASK = '10000000-0000-0000-0000-000000000009';
const NODE = 'node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function fakeRest(responses) {
  const calls = [];
  const restImpl = async (path, init = {}) => {
    calls.push({ path, init, payload: init.body ? JSON.parse(init.body) : null });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return { restImpl, calls };
}

function pgrst202() {
  return Object.assign(new Error('Could not find the function public.compute_claim_task(p_capabilities, p_implementations, p_lease_seconds, p_node_id, p_yield_seconds) in the schema cache'), {
    status: 404,
    detail: { code: 'PGRST202', hint: 'Perhaps you meant to call the function public.compute_claim_task(p_capabilities, p_implementations, p_lease_seconds, p_node_id)' }
  });
}

test('cancelQueuedComputeTask PATCHes only a still-queued row of the org and returns it, or null when nothing was queued', async () => {
  const row = { id: TASK, org_id: ORG, status: 'canceled' };
  const { restImpl, calls } = fakeRest([{ body: [row] }]);
  const before = Date.now();
  const canceled = await cancelQueuedComputeTask({ orgId: ORG, taskId: TASK, reason: 'canceled: local-ai-fabric wait exceeded' }, { restImpl });
  assert.deepEqual(canceled, row);
  assert.equal(calls.length, 1);
  const [resource, query] = calls[0].path.split('?');
  assert.equal(resource, 'ops_compute_tasks');
  const params = new URLSearchParams(query);
  assert.equal(params.get('id'), `eq.${TASK}`);
  assert.equal(params.get('org_id'), `eq.${ORG}`);
  assert.equal(params.get('status'), 'eq.queued', 'a leased or running task is never touched');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].init.headers.Prefer, 'return=representation');
  assert.equal(calls[0].payload.status, 'canceled');
  assert.equal(calls[0].payload.last_error, 'canceled: local-ai-fabric wait exceeded');
  assert.ok(Date.parse(calls[0].payload.updated_at) >= before - 1000);

  const gone = fakeRest([{ body: [] }]);
  assert.equal(await cancelQueuedComputeTask({ orgId: ORG, taskId: TASK }, { restImpl: gone.restImpl }), null, 'zero rows means a node already holds it');
  assert.equal(gone.calls[0].payload.last_error, 'canceled');

  const long = fakeRest([{ body: [] }]);
  await cancelQueuedComputeTask({ orgId: ORG, taskId: TASK, reason: 'x'.repeat(5000) }, { restImpl: long.restImpl });
  assert.equal(long.calls[0].payload.last_error.length, 4000);

  assert.equal(await cancelQueuedComputeTask({ orgId: ORG, taskId: '' }, { restImpl }), null, 'no id, no request');
  assert.equal(calls.length, 1);
});

test('claimLease omits p_yield_seconds at zero and sends it when the node asks to yield', async () => {
  const lease = { lease_id: 'L', task_id: TASK };
  const zero = fakeRest([{ body: lease }]);
  assert.deepEqual(await claimLease(NODE, { capabilities: ['ai.chat'], implementations: ['qwen3.8b.local'] }, { restImpl: zero.restImpl }), lease);
  assert.equal(zero.calls[0].path, 'rpc/compute_claim_task');
  assert.equal(zero.calls[0].init.method, 'POST');
  assert.deepEqual(zero.calls[0].payload, { p_node_id: NODE, p_capabilities: ['ai.chat'], p_implementations: ['qwen3.8b.local'], p_lease_seconds: 120 });

  const thirty = fakeRest([{ body: lease }]);
  await claimLease(NODE, { capabilities: ['ai.chat'], implementations: ['qwen3.8b.local'], leaseSeconds: 90, yieldSeconds: 30 }, { restImpl: thirty.restImpl });
  assert.deepEqual(thirty.calls[0].payload, { p_node_id: NODE, p_capabilities: ['ai.chat'], p_implementations: ['qwen3.8b.local'], p_lease_seconds: 90, p_yield_seconds: 30 });
});

test('an unrelated claim failure is rethrown unchanged', async () => {
  const failure = Object.assign(new Error('boom'), { status: 500 });
  const { restImpl, calls } = fakeRest([failure]);
  await assert.rejects(claimLease(NODE, { capabilities: ['ai.chat'], implementations: [], yieldSeconds: 30 }, { restImpl }), (error) => error === failure);
  assert.equal(calls.length, 1);
});

test('a PGRST202 for the yield parameter retries once without it and remembers that the SQL is not promoted', async () => {
  const lease = { lease_id: 'L2', task_id: TASK };
  const { restImpl, calls } = fakeRest([pgrst202(), { body: lease }, { body: null }]);
  assert.deepEqual(await claimLease(NODE, { capabilities: ['ai.chat'], implementations: ['qwen3.8b.local'], yieldSeconds: 30 }, { restImpl }), lease);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].payload.p_yield_seconds, 30);
  assert.equal('p_yield_seconds' in calls[1].payload, false, 'the retry is the plain 4-argument call');

  assert.equal(await claimLease(NODE, { capabilities: ['ai.chat'], implementations: ['qwen3.8b.local'], yieldSeconds: 30 }, { restImpl }), null);
  assert.equal(calls.length, 3);
  assert.equal('p_yield_seconds' in calls[2].payload, false, 'later claims never send the parameter again');
});

test('the gateway reports other live GPU nodes on heartbeat and passes a clamped yield into the claim', () => {
  const gateway = readFileSync(new URL('../src/compute/gateway.mjs', import.meta.url), 'utf8');
  assert.match(gateway, /live_gpu_nodes/);
  assert.match(gateway, /countLiveGpuNodes\(/);
  assert.match(gateway, /compute_gateway_live_gpu_unavailable/);
  assert.match(gateway, /clampYieldSeconds\(body\.yield_seconds\)/);
  assert.match(gateway, /yieldSeconds/);
  assert.match(gateway, /Compute gateway must bind to loopback/, 'the compute-node-ci boundary survives');
});
