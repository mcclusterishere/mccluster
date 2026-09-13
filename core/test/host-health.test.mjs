import test from 'node:test';
import assert from 'node:assert/strict';
import { haloSnapshotFreshness } from '../src/executors/host-health.mjs';

test('Halo health snapshot is fresh within three minutes', () => {
  const now = Date.parse('2026-09-13T22:10:00Z');
  const snapshot = haloSnapshotFreshness({ checked_at: '2026-09-13T22:08:00Z', status: 'healthy' }, now);
  assert.equal(snapshot.stale, false);
  assert.equal(snapshot.age_ms, 120000);
});

test('Halo health snapshot is stale after three minutes', () => {
  const now = Date.parse('2026-09-13T22:10:01Z');
  const snapshot = haloSnapshotFreshness({ checked_at: '2026-09-13T22:07:00Z', status: 'healthy' }, now);
  assert.equal(snapshot.stale, true);
  assert.equal(snapshot.age_ms, 181000);
});

test('Malformed health timestamps fail closed as stale', () => {
  const snapshot = haloSnapshotFreshness({ checked_at: 'not-a-date', status: 'healthy' }, 0);
  assert.equal(snapshot.stale, true);
  assert.equal(snapshot.age_ms, null);
});
