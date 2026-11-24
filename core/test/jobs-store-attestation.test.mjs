import test from 'node:test';
import assert from 'node:assert/strict';
import { attestationForLease, recordAttestation } from '../src/compute/jobs-store.mjs';

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
