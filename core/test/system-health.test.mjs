import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompletionEvidence } from '../src/completion-evidence.mjs';
import {
  SYSTEM_CONTRACT_MIGRATION,
  SYSTEM_HEALTH_SCHEMA,
  aggregateSystemHealth,
  classifyComputeNodes,
  deriveApprovals,
  verifyRecentCompletionEvidence,
} from '../src/system-health.mjs';

const MAIN = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const NOW = Date.parse('2026-09-14T20:00:00.000Z');

function healthySnapshot() {
  return {
    source: { repository: 'mcclusterishere/mccluster', github_main_sha: MAIN, github_promoted_sha: MAIN, promoted_ref: 'deploy/ovh-production', observed_at: '2026-09-14T19:59:58.000Z' },
    host: { hostname: 'mccluster-ovh', uptime: 'up 1 day', disk_root: 'ok', memory: 'ok' },
    services: {
      core_runner: 'active',
      core_tool_broker: 'active',
      vps_reconcile_timer: 'active',
      hitmans_halo: 'active',
      hitmans_halo_health_timer: 'active',
    },
    runtime: { godot: '4.5', blender: '4.4', halo: { status: 'healthy', stale: false } },
    deployment: { deployed_sha: MAIN, last_success: { sha: MAIN }, halo_sha: MAIN },
    supabase: {
      reachable: true,
      contract: { parity: true, schema_version: SYSTEM_HEALTH_SCHEMA, migration_version: SYSTEM_CONTRACT_MIGRATION },
      migration_attestation: { parity: true, expected: { latest_version: 'expected' }, live: { latest_version: 'expected' } },
    },
    jobs: {
      counts: { total: 10, queued: 0, running: 0, failed: 0, done: 10 },
      stale_running_count: 0,
      evidence: { eligible_done: 3, verified: 3, missing: 0, invalid: 0, recent_verified: [] },
      recent_failures: [],
    },
    compute: { node_count: 0, online: 0, stale_or_offline: 0, status: 'idle', nodes: [] },
    communications: { schema_ready: true, relay_count: 1, enabled_relays: 1, stale_relays: 0, pending_outbox: 0, failed_outbox: 0, paused_threads: 0 },
    prim3: { status: 'ready', godot_available: true, blender_available: true, halo_service_active: true, halo_snapshot_fresh: true, recent_game_failures: 0 },
    edge: { reachable: true, http_status: 200, latency_ms: 33, service: 'mccluster', deployment_sha: MAIN, deployment_ref: 'main' },
    approvals: { pending_count: 0, pending: [] },
  };
}

test('fully current canonical system is reported ok', () => {
  const health = aggregateSystemHealth(healthySnapshot(), { nowMs: NOW });
  assert.equal(health.schema_version, SYSTEM_HEALTH_SCHEMA);
  assert.equal(health.overall, 'ok');
  assert.equal(health.deployment.sha_match, true);
  assert.deepEqual(health.degradation, []);
});

test('source/runtime SHA drift is explicit degradation', () => {
  const snapshot = healthySnapshot();
  snapshot.deployment.deployed_sha = OTHER;
  const health = aggregateSystemHealth(snapshot, { nowMs: NOW });
  assert.equal(health.overall, 'degraded');
  assert.equal(health.deployment.sha_match, false);
  assert.ok(health.degradation.some((item) => item.code === 'source_runtime_drift'));
});

test('promotion lag does not masquerade as runtime drift', () => {
  const snapshot = healthySnapshot();
  snapshot.source.github_main_sha = OTHER;
  snapshot.source.github_promoted_sha = MAIN;
  snapshot.deployment.deployed_sha = MAIN;
  const health = aggregateSystemHealth(snapshot, { nowMs: NOW });
  assert.equal(health.overall, 'ok');
  assert.equal(health.deployment.sha_match, true);
  assert.equal(health.deployment.promotion_lag, true);
  assert.equal(health.source.github_promoted_sha, MAIN);
  assert.ok(!health.degradation.some((item) => item.code === 'source_runtime_drift'));
});

test('unreachable Supabase or inactive Core runner is a hard failure', () => {
  const snapshot = healthySnapshot();
  snapshot.services.core_runner = 'inactive';
  snapshot.supabase = { reachable: false, error: 'timeout', contract: { parity: false } };
  const health = aggregateSystemHealth(snapshot, { nowMs: NOW });
  assert.equal(health.overall, 'fail');
  assert.ok(health.degradation.some((item) => item.code === 'runner_inactive' && item.severity === 'critical'));
  assert.ok(health.degradation.some((item) => item.code === 'unreachable' && item.severity === 'critical'));
});

test('missing live migration contract and communications schema are never called healthy', () => {
  const snapshot = healthySnapshot();
  snapshot.supabase.contract = { parity: false, migration_version: null, error: 'relation does not exist' };
  snapshot.communications = { schema_ready: false, error: 'relation comms_relay_devices does not exist' };
  const health = aggregateSystemHealth(snapshot, { nowMs: NOW });
  assert.equal(health.overall, 'degraded');
  assert.ok(health.degradation.some((item) => item.code === 'migration_contract_drift'));
  assert.ok(health.degradation.some((item) => item.code === 'schema_not_ready'));
});

test('migration ledger attestation drift is a hard failure', () => {
  const snapshot = healthySnapshot();
  snapshot.supabase.migration_attestation = {
    parity: false,
    expected: { latest_version: '20260919021348', ledger_sha256: 'expected' },
    live: { latest_version: '20260919021013', ledger_sha256: 'different' },
  };
  const health = aggregateSystemHealth(snapshot, { nowMs: NOW });
  assert.equal(health.overall, 'fail');
  assert.ok(health.degradation.some((item) => item.code === 'supabase_migration_ledger_drift' && item.severity === 'critical'));
});

test('invalid #10 evidence is a hard health failure', () => {
  const snapshot = healthySnapshot();
  snapshot.jobs.evidence = { eligible_done: 1, verified: 0, missing: 0, invalid: 1, recent_verified: [] };
  const health = aggregateSystemHealth(snapshot, { nowMs: NOW });
  assert.equal(health.overall, 'fail');
  assert.ok(health.degradation.some((item) => item.code === 'invalid_completion_proof'));
});

test('recent post-contract jobs are cryptographically re-verified', () => {
  const job = {
    id: 'job-local-analysis',
    job_type: 'local_analysis',
    status: 'done',
    target_type: 'portfolio',
    target_id: 'McCluster',
    updated_at: '2026-09-14T19:30:00.000Z',
  };
  job.output = buildCompletionEvidence(job, {
    executor: 'local_analysis:v1',
    model: 'qwen3:8b',
    evidence_scope: 'job_input_only',
    analysis: { summary: 'verified' },
  }, { startedAt: '2026-09-14T19:29:00.000Z', completedAt: '2026-09-14T19:30:00.000Z' });

  const verified = verifyRecentCompletionEvidence([job]);
  assert.equal(verified.eligible_done, 1);
  assert.equal(verified.verified, 1);
  assert.equal(verified.invalid, 0);
  assert.equal(verified.recent_verified[0].result_sha256, job.output.completion_evidence.result_sha256);

  job.output.analysis.summary = 'tampered';
  const tampered = verifyRecentCompletionEvidence([job]);
  assert.equal(tampered.invalid, 1);
});

test('compute freshness uses the canonical node state field', () => {
  const nodes = classifyComputeNodes([
    { id: 'n1', display_name: 'gpu-1', state: 'online', last_seen_at: '2026-09-14T19:59:00.000Z' },
    { id: 'n2', display_name: 'gpu-2', state: 'online', last_seen_at: '2026-09-14T19:40:00.000Z' },
    { id: 'n3', display_name: 'gpu-3', state: 'quarantined', last_seen_at: '2026-09-14T19:59:30.000Z' },
  ], { nowMs: NOW });
  assert.equal(nodes.online, 1);
  assert.equal(nodes.stale_or_offline, 2);
  assert.equal(nodes.nodes[0].state, 'online');
  assert.equal(nodes.nodes[2].online, false);
});

test('owner approvals are pending only until a later decision exists', () => {
  const collect = {
    id: 'media-collect-1',
    job_type: 'game_media_collect',
    status: 'done',
    target_id: 'PRIM3',
    updated_at: '2026-09-14T19:50:00.000Z',
    output: { state: 'awaiting_owner_review', approval_packet: { campaign: 'PRIM3', candidates: [{}, {}] } },
  };
  const smoke = {
    id: 'smoke-1',
    job_type: 'game_branch_smoke',
    status: 'done',
    target_id: 'mcclusterishere/hitmans-halo',
    updated_at: '2026-09-14T19:52:00.000Z',
    output: { state: 'implementation_validated', evidence: { repository: 'mcclusterishere/hitmans-halo', branch: 'core/job-1', commit: MAIN } },
  };

  const pending = deriveApprovals([collect, smoke]);
  assert.equal(pending.pending_count, 2);
  assert.ok(pending.pending.some((item) => item.type === 'game_studio_batch'));
  assert.ok(pending.pending.some((item) => item.type === 'game_release'));

  const decided = deriveApprovals([
    collect,
    smoke,
    {
      id: 'owner-decision-1',
      job_type: 'game_owner_decision',
      status: 'done',
      target_id: 'PRIM3',
      updated_at: '2026-09-14T19:55:00.000Z',
      output: { decision: 'approve' },
    },
    {
      id: 'release-decision-1',
      job_type: 'game_release_decision',
      status: 'done',
      updated_at: '2026-09-14T19:56:00.000Z',
      output: { decision: 'approve', branch: 'core/job-1' },
    },
  ]);
  assert.equal(decided.pending_count, 0);
});
