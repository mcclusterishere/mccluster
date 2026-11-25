import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateSystemHealth } from '../src/system-health.mjs';
import { enrichHostHealth } from '../src/health-details.mjs';
import { finalizeRuntimeHealth } from '../src/health-verification.mjs';

// Audit finding C1: unreadable job/compute evidence became healthy zeros.
const sha = 'a'.repeat(40);
const ORG = '123e4567-e89b-42d3-a456-426614174000';
function snapshot(overrides = {}) {
  return {
    source: { github_main_sha: sha, github_promoted_sha: sha }, deployment: { deployed_sha: sha },
    services: { core_runner: 'active', core_tool_broker: 'active', vps_reconcile_timer: 'active' },
    supabase: { reachable: true, contract: { parity: true }, migration_attestation: { parity: true } },
    jobs: { counts: { total: 3, queued: 1, running: 0, failed: 0, done: 2 }, stale_running_count: 0,
      evidence: { eligible_done: 2, verified: 2, missing: 0, invalid: 0, coverage: 1, recent_verified: [] }, error: null },
    compute: { node_count: 0, online: 0, status: 'idle', error: null },
    communications: { schema_ready: true, enabled_relays: 1, stale_relays: 0, failed_outbox: 0 },
    edge: { reachable: true }, prim3: { status: 'ready' }, ...overrides,
  };
}

test('unreadable job counts are reported as unknown and cannot be healthy', () => {
  const report = aggregateSystemHealth(snapshot({ jobs: { counts: { total: null, queued: null, running: null, failed: null, done: null }, stale_running_count: null,
    evidence: { eligible_done: 0, verified: 0, missing: 0, invalid: 0, coverage: 1, recent_verified: [] }, error: 'synthetic job read denied' } }));
  assert.notEqual(report.overall, 'ok');
  assert.match(report.summary, /queue=unknown failures=unknown evidence=unknown/);
  assert.ok(report.degradation.some(item => item.component === 'jobs' && item.code === 'job_evidence_unavailable'));
});

test('an unreadable compute inventory is a degradation, not an idle fleet', () => {
  const report = aggregateSystemHealth(snapshot({ compute: { node_count: 0, online: 0, status: 'unknown', error: 'synthetic compute read unavailable' } }));
  assert.notEqual(report.overall, 'ok');
  assert.ok(report.degradation.some(item => item.component === 'compute' && item.code === 'compute_inventory_unavailable'));
});

test('a readable snapshot with no eligible jobs remains healthy and says zero', () => {
  const report = aggregateSystemHealth(snapshot({ jobs: { counts: { total: 0, queued: 0, running: 0, failed: 0, done: 0 }, stale_running_count: 0,
    evidence: { eligible_done: 0, verified: 0, missing: 0, invalid: 0, coverage: 1, recent_verified: [] }, error: null } }));
  assert.equal(report.overall, 'ok');
  assert.match(report.summary, /queue=0 failures=0 evidence=0\/0/);
});

test('the full aggregate, enrichment and finalization chain stays non-ok when evidence is missing', async () => {
  const report = aggregateSystemHealth(snapshot({
    jobs: { counts: { total: null, queued: null, running: null, failed: null, done: null }, stale_running_count: null,
      evidence: { eligible_done: 0, verified: 0, missing: 0, invalid: 0, coverage: 1, recent_verified: [] }, error: 'synthetic job read denied' },
    compute: { node_count: 0, online: 0, status: 'unknown', error: 'synthetic compute read unavailable' },
  }));
  const final = finalizeRuntimeHealth(await enrichHostHealth(report, {
    orgId: ORG, rest: async () => { throw new Error('synthetic unreadable failures'); },
    diagnostics: async () => ({ local_core: { http_status: 200, ok: true, deployment_sha: sha }, public_core: { http_status: 200, ok: true, deployment_sha: sha } }),
  }));
  assert.notEqual(final.overall, 'ok');
  assert.equal(final.health_sections.workloads.status, 'unverified');
  assert.match(final.summary, /queue=unknown/);
  assert.doesNotMatch(final.summary, /queue=0/);
});
