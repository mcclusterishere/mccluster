import test from 'node:test';
import assert from 'node:assert/strict';
import { beginDrain, checkDrain, endDrain } from '../../scripts/ovh-core-compute-drain.mjs';
const nodeId = `node_${'a'.repeat(32)}`;
const orgId = '11111111-1111-4111-8111-111111111111';
const receipt = { schema_version: 1, node_id: nodeId, org_id: orgId, previous_state: 'online' };

function api({ state = 'online', leases = [], revoked = false, failPatch = false } = {}) {
  const calls = [];
  return { calls, rest: async (path, init = {}) => {
    calls.push({ path, ...init });
    assert.ok(init.signal instanceof AbortSignal, 'all deploy requests have a timeout');
    if (path.startsWith('ops_compute_leases?')) return { body: leases };
    const node = { id: nodeId, org_id: orgId, state, revoked_at: revoked ? 'now' : null };
    if (init.method === 'PATCH') {
      state = JSON.parse(init.body).state;
      if (failPatch) throw new Error('lost response after commit');
      return { body: [{ ...node, state }] };
    }
    return { body: [node] };
  } };
}

test('drain persists recovery receipt before its scoped canonical PATCH', async () => {
  const box = api(); let saved;
  await beginDrain({ ...box, nodeId, orgId, save: (value) => { saved = value; assert.equal(box.calls.length, 1); } });
  assert.deepEqual(saved, receipt);
  const update = box.calls[1];
  const q = new URLSearchParams(update.path.split('?')[1]);
  assert.equal(q.get('id'), `eq.${nodeId}`);
  assert.equal(q.get('org_id'), `eq.${orgId}`);
  assert.equal(q.get('state'), 'eq.online');
  assert.equal(q.get('revoked_at'), 'is.null');
  assert.deepEqual(JSON.parse(update.body), { state: 'draining' });
});

test('ambiguous drain write retains a receipt so cleanup can reread and restore', async () => {
  const box = api({ failPatch: true }); let saved;
  await assert.rejects(beginDrain({ ...box, nodeId, orgId, save: (value) => { saved = value; } }));
  assert.deepEqual(saved, receipt);
});

for (const state of ['quarantined', 'revoked', 'offline']) test(`refuses to drain ${state} nodes`, async () => {
  const box = api({ state });
  await assert.rejects(beginDrain({ ...box, nodeId, orgId, save: () => assert.fail('must not save') }));
  assert.equal(box.calls.length, 1);
});

test('a preexisting operator drain is not resumed', async () => {
  const box = api({ state: 'draining' }); let saved;
  await beginDrain({ ...box, nodeId, orgId, save: (value) => { saved = value; } });
  await endDrain({ ...box, receipt: saved });
  assert.equal(saved.previous_state, 'draining');
  assert.ok(box.calls.every((call) => call.method !== 'PATCH'));
});

test('active leases defer deployment, including expired but unfinished leases', async () => {
  const box = api({ state: 'draining', leases: [{ id: 'lease' }] });
  assert.equal(await checkDrain({ ...box, receipt }), false);
  const q = new URLSearchParams(box.calls[1].path.split('?')[1]);
  assert.equal(q.get('status'), 'in.(leased,running)');
  assert.equal(q.get('node_id'), `eq.${nodeId}`);
  assert.equal(q.has('expires_at'), false);
});

test('zero leases permits stopping only while the canonical fence is held', async () => {
  assert.equal(await checkDrain({ ...api({ state: 'draining' }), receipt }), true);
  await assert.rejects(checkDrain({ ...api({ state: 'online' }), receipt }), /fence was lost/);
});

test('recovery restores online using scoped compare-and-set', async () => {
  const box = api({ state: 'draining' });
  await endDrain({ ...box, receipt });
  assert.equal(new URLSearchParams(box.calls[1].path.split('?')[1]).get('state'), 'eq.draining');
  assert.deepEqual(JSON.parse(box.calls[1].body), { state: 'online' });
});

for (const state of ['revoked', 'quarantined', 'online']) test(`recovery never overwrites ${state}`, async () => {
  const box = api({ state });
  await endDrain({ ...box, receipt });
  assert.equal(box.calls.length, 1);
});

test('unverifiable lease responses and invalid receipts fail closed', async () => {
  await assert.rejects(checkDrain({ ...api({ state: 'draining', leases: null }), receipt }));
  await assert.rejects(endDrain({ ...api(), receipt: { ...receipt, node_id: '' } }));
});

test('a lost recovery response is reconciled by rereading, without another state write', async () => {
  const box = api({ state: 'draining', failPatch: true });
  await assert.rejects(endDrain({ ...box, receipt }));
  await endDrain({ ...box, receipt });
  assert.equal(box.calls.filter((call) => call.method === 'PATCH').length, 1);
});
