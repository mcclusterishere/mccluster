/* core.resume is the rehydration contract.
 *
 * The first cut of this module passed its unit tests and was broken in
 * production in four separate ways, because every one of its failures is
 * SILENT: a wrong column name, a misread response envelope and a wrong
 * manifest field all produce an empty list or a null, which reads exactly
 * like a quiet, healthy system. A resuming model would have believed it.
 *
 * So these tests drive coreResume() end to end against the real shapes:
 * the {body, headers, status} envelope supabase.mjs actually resolves, and
 * the manifest scripts/deploy-ovh-core.sh actually writes. Each regression
 * named below maps to a defect that shipped.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ORG = '00000000-0000-4000-8000-000000000001';
const NOW = Date.parse('2026-09-16T12:00:00Z');

/* supabase.mjs reads its configuration at import time and refuses to run
   unconfigured, so the environment is set before the module graph loads. */
process.env.SUPABASE_URL ||= 'https://db.test';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret-key';

const manifestDir = await mkdtemp(path.join(tmpdir(), 'mccluster-manifest-'));
const manifestPath = path.join(manifestDir, '.mccluster-deploy.json');
process.env.MCCLUSTER_DEPLOY_MANIFEST = manifestPath;

const { coreResume, partitionJobs, partitionQueue } = await import('../src/tools/resume.mjs');
const { CONTROL_TOOLS } = await import('../src/tools/control.mjs');

/* The exact envelope PostgREST + parse() produce. Returning bare rows here
   would let the destructuring bug pass, which is how it shipped. */
function envelope(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

/* Route matching is deliberately ordered and most-specific-first: the
   running-lease URL contains BOTH `ops_agent_jobs?org_id` and
   `status=eq.running`, so a generic-first match silently answers the
   lease query with the recent-jobs fixture and hides every orphan. */
function withDatabase(routes) {
  const seen = [];
  const original = globalThis.fetch;
  const ordered = [
    ['status=eq.running', routes.running],
    ['status=eq.queued', routes.queued],
    ['ops_agent_jobs', routes.recent],
    ['ops_objectives', routes.objectives],
    ['control_approvals', routes.approvals],
    ['ops_system_contract', routes.contract],
    ['ops_signals', routes.signals]
  ];
  globalThis.fetch = async (input) => {
    const url = String(typeof input === 'string' ? input : input.url);
    seen.push(url);
    for (const [fragment, body] of ordered) {
      if (url.includes(fragment)) return envelope(body ?? []);
    }
    return envelope([]);
  };
  return { seen, restore() { globalThis.fetch = original; } };
}

const RUNNING_JOBS = [
  { id: 'fresh', status: 'running', job_type: 'repo_health', target_id: 'mcclusterishere/mccluster', updated_at: '2026-09-16T11:55:00Z', attempts: 1 },
  { id: 'orphan', status: 'running', job_type: 'objective_reflection', target_id: 'McCluster', updated_at: '2026-09-13T06:31:00Z', attempts: 1 }
];

/* The real 6 September batch: one instant, attempts 0, job types no Core
   executor claims. Deliberately absent from RECENT_JOBS, because they are
   ten days outside any 24-hour window — which is the bug. */
const QUEUED_JOBS = [
  'stakeholder_map', 'lead_rescore', 'campaign_optimizer',
  'exposure_scan', 'crm_reconcile', 'objective_discovery'
].map((job_type, i) => ({
  id: `sept6-${i}`, status: 'queued', job_type, target_id: 'McCluster',
  attempts: 0, run_after: '2026-09-06T01:08:33.439Z', created_at: '2026-09-06T01:08:33.439Z'
}));

const RECENT_JOBS = [
  { id: 'q1', status: 'queued', job_type: 'local_analysis', target_id: 'McCluster' },
  { id: 'f1', status: 'failed', job_type: 'repo_health', target_id: 'x', last_error: 'repository not cloned' }
];

async function resumeWith(overrides = {}) {
  const db = withDatabase({
    recent: overrides.recentJobs ?? RECENT_JOBS,
    running: overrides.runningJobs ?? RUNNING_JOBS,
    queued: overrides.queuedJobs ?? QUEUED_JOBS,
    objectives: overrides.objectives ?? [],
    approvals: overrides.approvals ?? [],
    contract: overrides.contract ?? [],
    signals: overrides.signals ?? []
  });
  try {
    return { result: await coreResume({ orgId: ORG, nowMs: NOW }), seen: db.seen };
  } finally {
    db.restore();
  }
}

/* ---------- the tool contract ---------- */

test('core.resume is published as a read-only control tool', () => {
  const tool = CONTROL_TOOLS.find((item) => item.name === 'core.resume');
  assert.ok(tool, 'core.resume is not in the control tool list');
  assert.deepEqual(tool.inputSchema.required, ['org_id']);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.match(tool.description, /queues and changes nothing/i);
});

/* ---------- REGRESSION: manifest field name ---------- */

test('commit_sha from the deploy manifest becomes runtime.core_commit', async () => {
  /* scripts/deploy-ovh-core.sh writes exactly this shape. The first cut
     read deploy_sha and therefore always reported a null commit. */
  await writeFile(manifestPath, JSON.stringify({
    schema_version: 1,
    commit_sha: 'e10d97d51e734d15896d6d55209914c937b3d722',
    deployed_at: '2026-09-16T08:30:00Z'
  }));
  const { result } = await resumeWith();
  assert.equal(result.runtime.core_commit, 'e10d97d51e734d15896d6d55209914c937b3d722',
    'commit_sha must be read; a null commit makes every parity claim untrustworthy');
  assert.equal(result.runtime.manifest_present, true);
  assert.equal(result.runtime.deployed_at, '2026-09-16T08:30:00Z');
});

test('a legacy manifest naming deploy_sha still resolves', async () => {
  await writeFile(manifestPath, JSON.stringify({ deploy_sha: 'a'.repeat(40) }));
  const { result } = await resumeWith();
  assert.equal(result.runtime.core_commit, 'a'.repeat(40));
});

test('a missing manifest reports absent rather than crashing the whole call', async () => {
  /* The manifest path is resolved once at module load, as it is in a
     long-running Core process, so this removes the file rather than
     repointing the variable. */
  await rm(manifestPath, { force: true });
  const { result } = await resumeWith();
  assert.equal(result.runtime.core_commit, null);
  assert.equal(result.runtime.manifest_present, false);
  assert.ok(result.work, 'the rest of the payload must still be produced');
  await writeFile(manifestPath, JSON.stringify({ commit_sha: 'b'.repeat(40) }));
});

/* ---------- REGRESSION: the rest() envelope ---------- */

test('pending approvals are actually returned', async () => {
  /* The first cut read rest() as if it resolved rows, so this list was
     always empty — the one category a resuming session cannot clear by
     itself silently read as "nothing owed". */
  const { result } = await resumeWith({
    approvals: [{
      id: 'appr-1', capability: 'infra.mutate', resource_type: 'host', resource_id: 'ovh-core',
      reason: 'reboot after kernel update', created_at: '2026-09-16T10:00:00Z', expires_at: '2026-09-16T10:30:00Z'
    }]
  });
  assert.equal(result.pending_approvals.length, 1);
  assert.equal(result.pending_approvals[0].capability, 'infra.mutate');
  assert.equal(result.pending_approvals[0].resource, 'host:ovh-core');
  assert.match(result.next_step_hint, /approval\(s\) are waiting/,
    'approvals must lead the hint — they are what a human owes the system');
});

test('recent signals use the production column signal_type', async () => {
  const { result, seen } = await resumeWith({
    signals: [{ signal_type: 'repo_health_failed', severity: 3, source: 'mccluster-core', observed_at: '2026-09-16T06:22:00Z' }],
    contract: [{ schema_version: 'mccluster-system-health/v1', migration_version: '20260914191500' }]
  });
  assert.equal(result.health.recent_signals.length, 1, 'signals were not read back');
  assert.equal(result.health.recent_signals[0].signal_type, 'repo_health_failed');
  assert.equal(result.health.recent_signals[0].severity, 3, 'severity is an integer in production');
  assert.equal(result.health.contract.migration_version, '20260914191500');

  const signalQuery = seen.find((url) => url.includes('ops_signals'));
  assert.ok(signalQuery, 'ops_signals was never queried');
  assert.match(signalQuery, /select=signal_type/, 'the query must select signal_type');
  assert.doesNotMatch(signalQuery, /[?&]select=[^&]*\bkind\b/,
    'there is no `kind` column in production; selecting it 400s the query');
});

/* ---------- REGRESSION: objective column ---------- */

test('objective name is returned, using the production column', async () => {
  const { result } = await resumeWith({
    objectives: [{ id: 'obj-1', name: 'Restore remote MCP continuity', status: 'active', priority: 90 }]
  });
  assert.equal(result.work.objectives.length, 1);
  assert.equal(result.work.objectives[0].name, 'Restore remote MCP continuity');
  assert.equal(result.work.objectives[0].status, 'active');
  assert.equal(result.work.objectives[0].priority, 90);
});

/* ---------- REGRESSION: stale leases must not depend on the time window ---------- */

test('a 3-day-old running job appears in stale_running_jobs even with since_hours=24', async () => {
  /* The orphan is deliberately absent from the recent-jobs response: a
     job stuck since 13 September is outside any 24-hour window, which is
     precisely why the window cannot be the only source. */
  const db = withDatabase({ running: RUNNING_JOBS, recent: RECENT_JOBS });
  try {
    const result = await coreResume({ orgId: ORG, sinceHours: 24, nowMs: NOW });
    assert.deepEqual(result.work.stale_running_jobs.map((j) => j.id), ['orphan'],
      'a multi-day orphaned lease must always surface, whatever the window');
    assert.ok(result.work.stale_running_jobs[0].age_ms > 3 * 24 * 60 * 60 * 1000);
    assert.deepEqual(result.work.active_jobs.map((j) => j.id), ['fresh']);
    assert.match(result.work.stale_running_jobs[0].job_type, /objective_reflection/);
  } finally {
    db.restore();
  }
});

test('the running-job query is not time-windowed', async () => {
  const { seen } = await resumeWith();
  const runningQuery = seen.find((url) => url.includes('status=eq.running'));
  assert.ok(runningQuery, 'no dedicated running-job query was issued');
  assert.doesNotMatch(runningQuery, /updated_at=gte/,
    'the lease query must not inherit a time window, or old orphans stay hidden');
});

test('the hint calls out stale leases when nothing is waiting on a human', async () => {
  const { result } = await resumeWith({ approvals: [] });
  assert.match(result.next_step_hint, /orphaned leases/);
});

/* ---------- degradation ---------- */

test('one failing source does not take the whole payload down', async () => {
  const db = withFailingSource('control_approvals');
  try {
    const result = await coreResume({ orgId: ORG, nowMs: NOW });
    assert.ok(result.schema, 'the payload must still be produced');
    assert.ok(result.runtime, 'other sections must survive');
    /* Degrading, not throwing — but degraded is null and named, never []. */
    assert.equal(result.pending_approvals, null);
    assert.equal(result.sources.approvals, 'unavailable');
  } finally {
    db.restore();
  }
});

test('org_id is required', async () => {
  await assert.rejects(() => coreResume({}), /org_id is required/);
});

/* ---------- lease partitioning ---------- */

test('a job running past the stale threshold is reported as stale, not active', () => {
  const { active, stale } = partitionJobs(RUNNING_JOBS, NOW);
  assert.deepEqual(active.map((j) => j.id), ['fresh']);
  assert.deepEqual(stale.map((j) => j.id), ['orphan']);
});

test('only running jobs are partitioned; other statuses are not smuggled in', () => {
  const { active, stale } = partitionJobs([
    { id: 'q', status: 'queued', updated_at: '2026-09-16T11:00:00Z' },
    { id: 'f', status: 'failed', updated_at: '2026-09-16T11:00:00Z' }
  ], NOW);
  assert.deepEqual(active, []);
  assert.deepEqual(stale, []);
});

test('a job with an unparseable timestamp is still reported somewhere', () => {
  const { active, stale } = partitionJobs([{ id: 'x', status: 'running', updated_at: 'not-a-date' }], NOW);
  assert.equal(active.length + stale.length, 1);
});

test('partitioning tolerates a missing or malformed job list', () => {
  for (const input of [null, undefined, 'nonsense', {}]) {
    const { active, stale } = partitionJobs(input);
    assert.deepEqual(active, []);
    assert.deepEqual(stale, []);
  }
});


/* ---------- REGRESSION: unavailable must never render as empty ---------- */

function withFailingSource(fragment) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(typeof input === 'string' ? input : input.url);
    if (url.includes(fragment)) throw new Error(`${fragment} unreachable`);
    return envelope([]);
  };
  return { restore() { globalThis.fetch = original; } };
}

test('failed approval retrieval is NOT reported as zero approvals', async () => {
  /* The defect: attempt(fn, []) spread an array into an object, yielding
     {error}, which the caller then coerced back to []. A session told
     "no approvals pending" when the table could not be read would proceed
     as though a human owed it nothing. */
  const db = withFailingSource('control_approvals');
  try {
    const result = await coreResume({ orgId: ORG, nowMs: NOW });
    assert.equal(result.pending_approvals, null,
      'unavailable approvals must be null, never an empty list');
    assert.notDeepEqual(result.pending_approvals, [],
      'an empty list would be indistinguishable from "nothing is pending"');
    assert.equal(result.sources.approvals, 'unavailable');
    assert.ok(result.degraded_sources.includes('approvals'));
    assert.match(result.source_errors.approvals, /unreachable/);
    assert.match(result.next_step_hint, /Approval state unavailable/);
    assert.match(result.next_step_hint, /do not assume nothing is pending/i);
  } finally { db.restore(); }
});

test('failed running-job retrieval is NOT reported as zero active or stale jobs', async () => {
  const db = withFailingSource('status=eq.running');
  try {
    const result = await coreResume({ orgId: ORG, nowMs: NOW });
    assert.equal(result.work.active_jobs, null);
    assert.equal(result.work.stale_running_jobs, null,
      'an unreadable lease table must not look like "no orphans"');
    assert.equal(result.sources.running_jobs, 'unavailable');
    assert.ok(result.degraded_sources.includes('running_jobs'));
  } finally { db.restore(); }
});

test('failed queue retrieval is NOT reported as an empty queue', async () => {
  const db = withFailingSource('status=eq.queued');
  try {
    const result = await coreResume({ orgId: ORG, nowMs: NOW });
    assert.equal(result.work.queued_jobs, null);
    assert.equal(result.work.stale_queued_jobs, null);
    assert.equal(result.sources.queued_jobs, 'unavailable');
  } finally { db.restore(); }
});

test('degraded sources are named explicitly and healthy ones are marked ok', async () => {
  const db = withFailingSource('ops_objectives');
  try {
    const result = await coreResume({ orgId: ORG, nowMs: NOW });
    assert.equal(result.sources.objectives, 'unavailable');
    assert.equal(result.work.objectives, null);
    assert.deepEqual(result.degraded_sources, ['objectives']);
    assert.equal(result.sources.approvals, 'ok', 'healthy sources must still report ok');
    assert.match(result.next_step_hint, /Partial state only/);
    assert.match(result.next_step_hint, /unknown, not empty/);
  } finally { db.restore(); }
});

test('a fully healthy read reports no degraded sources', async () => {
  const { result } = await resumeWith({ approvals: [] });
  assert.deepEqual(result.degraded_sources, []);
  assert.deepEqual(result.source_errors, {});
  assert.deepEqual(result.pending_approvals, [], 'genuinely zero is [] — distinct from null');
  for (const status of Object.values(result.sources)) assert.equal(status, 'ok');
});

/* ---------- REGRESSION: old queued jobs must be visible ---------- */

test('the six Sept-6 queued jobs are surfaced despite being outside the 24h window', async () => {
  /* No running jobs here: stale leases legitimately outrank a stale queue
     in the hint, and this test is about the queue. */
  const { result } = await resumeWith({ runningJobs: [] });
  const stale = result.work.stale_queued_jobs;
  assert.equal(stale.length, 6, 'all six long-queued jobs must surface');
  assert.deepEqual(stale.map((j) => j.job_type).sort(), [
    'campaign_optimizer', 'crm_reconcile', 'exposure_scan',
    'lead_rescore', 'objective_discovery', 'stakeholder_map'
  ]);
  assert.ok(stale[0].waiting_ms > 9 * 24 * 60 * 60 * 1000, 'these have waited more than nine days');
  assert.match(result.next_step_hint, /sat queued beyond the stale threshold/);
});

test('the queued-job query is not time-windowed', async () => {
  const { seen } = await resumeWith();
  const queueQuery = seen.find((url) => url.includes('status=eq.queued'));
  assert.ok(queueQuery, 'no dedicated queued-job query was issued');
  assert.doesNotMatch(queueQuery, /updated_at=gte/,
    'the queue query must not inherit a window, or old backlog stays hidden');
  assert.match(queueQuery, /run_after/, 'run_after is needed to tell scheduled work from stale work');
});

test('a job deliberately scheduled for the future is waiting, not stale', () => {
  const { waiting, stale, scheduled } = partitionQueue([
    { id: 'later', status: 'queued', job_type: 'digest', run_after: '2026-09-17T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
    { id: 'old', status: 'queued', job_type: 'crm_reconcile', run_after: '2026-09-06T01:08:33Z', created_at: '2026-09-06T01:08:33Z' },
    { id: 'fresh', status: 'queued', job_type: 'repo_health', created_at: '2026-09-16T11:50:00Z' }
  ], NOW);
  assert.deepEqual(scheduled.map((j) => j.id), ['later'],
    'a future run_after is scheduled work, not a stuck job');
  assert.deepEqual(stale.map((j) => j.id), ['old']);
  assert.deepEqual(waiting.map((j) => j.id), ['fresh']);
});

test('queue partitioning tolerates malformed input', () => {
  for (const input of [null, undefined, 'nonsense', {}]) {
    const { waiting, stale, scheduled } = partitionQueue(input);
    assert.deepEqual([waiting, stale, scheduled], [[], [], []]);
  }
});
