import test from 'node:test';
import assert from 'node:assert/strict';
import { attestationForLease, listComputeTasks, recordAttestation } from '../src/compute/jobs-store.mjs';

const LEASE = '20000000-0000-4000-8000-000000000001';
const row = { lease_id: LEASE, task_id: '10000000-0000-4000-8000-000000000001', node_id: 'node_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', attempt: 1, protocol: 'mccluster-compute/1', method: 'POST', path: `/v1/compute/leases/${LEASE}/complete`, signed_at: '2026-11-23T00:00:00.000Z', nonce: 'a'.repeat(32), body_digest: 'b'.repeat(43), signature: 'c'.repeat(86), result_sha256: 'd'.repeat(64) };
const missingTable = () => { throw Object.assign(new Error("Could not find the table 'public.ops_compute_attestations' in the schema cache"), { status: 404, detail: { code: 'PGRST205' } }); };

test('before the pending table is promoted, attestation writes degrade to "not recorded", log once, and reads answer null', async () => {
  const logs = [];
  const first = await recordAttestation(row, { restImpl: async () => missingTable(), log: (line) => logs.push(line) });
  const second = await recordAttestation(row, { restImpl: async () => missingTable(), log: (line) => logs.push(line) });
  assert.deepEqual(first, { recorded: false, replayed: false, available: false });
  assert.deepEqual(second, first);
  assert.equal(logs.length, 1, 'the unavailable store is logged once per process');
  assert.match(logs[0], /compute_attestation_store_unavailable/);
  assert.equal(await attestationForLease({ leaseId: LEASE }, { restImpl: async () => missingTable() }), null);
});

test('with the table present, the first write is recorded, a replay is ignored, and other errors propagate', async () => {
  let calls = 0;
  const restImpl = async (path, init) => {
    calls += 1;
    assert.match(path, /^ops_compute_attestations\?on_conflict=lease_id$/);
    assert.match(init.headers.Prefer, /ignore-duplicates/);
    return { body: calls === 1 ? [JSON.parse(init.body)] : [] };
  };
  assert.deepEqual(await recordAttestation(row, { restImpl }), { recorded: true, replayed: false, available: true });
  assert.deepEqual(await recordAttestation(row, { restImpl }), { recorded: false, replayed: true, available: true });
  await assert.rejects(() => recordAttestation(row, { restImpl: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } }), /boom/);
  const read = await attestationForLease({ leaseId: LEASE }, { restImpl: async () => ({ body: [row] }) });
  assert.equal(read.schema, 'mccluster-completion-attestation/1');
  assert.equal(read.signed_at, row.signed_at, 'signed_at is stored and read verbatim');
  assert.equal(await attestationForLease({ leaseId: 'nope' }), null);
});

test('the device facts bound at completion travel in the same insert; a table without the column still keeps the signature', async () => {
  const facts = { schema: 'mccluster-device-facts/1', source: 'node-reported-at-completion', captured_at: '2026-11-23T00:00:09.000Z', hardware_mode: 'gpu-verified' };
  const sent = [];
  const stored = await recordAttestation({ ...row, device_facts: facts }, { restImpl: async (path, init) => { sent.push(JSON.parse(init.body)); return { body: [JSON.parse(init.body)] }; } });
  assert.deepEqual(stored, { recorded: true, replayed: false, available: true });
  assert.deepEqual(sent[0].device_facts, facts);
  assert.match(String(sent.length), /^1$/, 'one insert: the facts are not a second write that could be lost or raced');
  // A row without facts never sends the column at all.
  const bare = [];
  await recordAttestation(row, { restImpl: async (path, init) => { bare.push(JSON.parse(init.body)); return { body: [] }; } });
  assert.equal('device_facts' in bare[0], false);

  // PostgREST's answer for a column the table does not have (PGRST204), and PostgreSQL's (42703).
  for (const code of ['PGRST204', '42703']) {
    const attempts = [];
    const logs = [];
    const restImpl = async (path, init) => {
      const body = JSON.parse(init.body);
      attempts.push(body);
      if ('device_facts' in body) throw Object.assign(new Error("Could not find the 'device_facts' column of 'ops_compute_attestations' in the schema cache"), { status: 400, detail: { code } });
      return { body: [body] };
    };
    assert.deepEqual(await recordAttestation({ ...row, device_facts: facts }, { restImpl, log: (line) => logs.push(line) }), { recorded: true, replayed: false, available: true });
    assert.equal(attempts.length, 2);
    assert.equal('device_facts' in attempts[1], false);
    assert.equal(attempts[1].signature, row.signature);
    assert.ok(logs.length <= 1 && logs.every((line) => /compute_attestation_device_facts_unavailable/.test(line)));
  }
  // Any other refusal of the insert still propagates.
  await assert.rejects(() => recordAttestation({ ...row, device_facts: facts }, { restImpl: async () => { throw Object.assign(new Error('violates check constraint'), { status: 400, detail: { code: '23514' } }); } }), /check constraint/);
});

test('a task is looked up by its Idempotency-Key with an exact filter, not by counting a page', async () => {
  const paths = [];
  const restImpl = async (path) => { paths.push(path); return { body: [] }; };
  await listComputeTasks({ orgId: '00000000-0000-4000-8000-000000000001', idempotencyKey: 'refusal-1+2' }, { restImpl });
  const params = new URLSearchParams(paths[0].split('?')[1]);
  assert.equal(params.get('idempotency_key'), 'eq.refusal-1+2');
  assert.equal(params.get('org_id'), 'eq.00000000-0000-4000-8000-000000000001');
  await listComputeTasks({ orgId: '00000000-0000-4000-8000-000000000001' }, { restImpl });
  assert.equal(new URLSearchParams(paths[1].split('?')[1]).has('idempotency_key'), false);
});