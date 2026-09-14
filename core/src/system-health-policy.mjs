export const SYSTEM_HEALTH_SCHEMA = 'mccluster-system-health/v1';

const GAME_JOB_TYPES = new Set([
  'game_build_plan',
  'game_playtest',
  'game_studio_cycle',
  'game_media_collect',
  'game_owner_decision',
  'game_implementation_collect',
  'game_branch_smoke',
  'game_release_decision',
  'preview_deploy',
]);

function text(value) {
  return String(value ?? '').trim();
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function addIssue(issues, severity, code, message, evidence = null) {
  issues.push({ severity, code, message, evidence });
}

function componentStatus(issues, prefix) {
  const relevant = issues.filter((item) => item.code.startsWith(prefix));
  if (relevant.some((item) => item.severity === 'error')) return 'fail';
  if (relevant.some((item) => item.severity === 'warning')) return 'degraded';
  return 'ok';
}

export function expectedMigrationFromPaths(paths = []) {
  const candidates = [];
  for (const value of paths) {
    const path = text(value);
    const match = path.match(/^supabase\/migrations\/(\d+)_([^/]+)\.sql$/);
    if (!match) continue;
    candidates.push({ version: match[1], filename: path, name: match[2] });
  }
  candidates.sort((a, b) => {
    const av = BigInt(a.version);
    const bv = BigInt(b.version);
    if (av === bv) return a.filename.localeCompare(b.filename);
    return av > bv ? -1 : 1;
  });
  return candidates[0] || null;
}

export function deriveOutstandingApprovals(jobs = [], communications = {}) {
  const ownerDecisions = new Set();
  const releaseDecisions = new Set();

  for (const job of jobs) {
    if (job?.job_type === 'game_owner_decision') {
      const source = text(job?.input?.approval_packet?.source_job_id);
      if (source) ownerDecisions.add(source);
    }
    if (job?.job_type === 'game_release_decision') {
      const branch = text(job?.input?.branch || job?.input?.validation_evidence?.branch);
      if (branch) releaseDecisions.add(branch);
    }
  }

  const studioReviews = [];
  const releaseReviews = [];
  for (const job of jobs) {
    if (job?.job_type === 'game_media_collect' && job?.status === 'done' && job?.output?.state === 'awaiting_owner_review') {
      const sourceJobId = text(job?.output?.approval_packet?.source_job_id || job?.id);
      if (sourceJobId && !ownerDecisions.has(sourceJobId)) {
        studioReviews.push({
          kind: 'game_studio_batch',
          source_job_id: sourceJobId,
          campaign: text(job?.output?.approval_packet?.campaign || job?.target_id),
          iteration: job?.output?.approval_packet?.iteration ?? null,
          updated_at: job?.updated_at || null,
        });
      }
    }

    if (job?.job_type === 'game_branch_smoke' && job?.status === 'done' && job?.output?.state === 'implementation_validated') {
      const branch = text(job?.output?.evidence?.branch || job?.input?.branch);
      if (branch && !releaseDecisions.has(branch)) {
        releaseReviews.push({
          kind: 'game_release',
          source_job_id: text(job.id),
          repository: text(job?.output?.evidence?.repository || job?.target_id),
          branch,
          commit_sha: text(job?.output?.evidence?.commit) || null,
          updated_at: job?.updated_at || null,
        });
      }
    }
  }

  const pausedThreads = Array.isArray(communications?.paused_threads) ? communications.paused_threads : [];
  return {
    count: studioReviews.length + releaseReviews.length + pausedThreads.length,
    game_studio_reviews: studioReviews.slice(0, 20),
    game_release_reviews: releaseReviews.slice(0, 20),
    communications_owner_attention: pausedThreads.slice(0, 20),
  };
}

export function summarizeGameJobs(jobs = []) {
  const recent = jobs.filter((job) => GAME_JOB_TYPES.has(job?.job_type));
  const failed = recent.filter((job) => job?.status === 'failed');
  const active = recent.filter((job) => ['queued', 'running'].includes(job?.status));
  return {
    total: recent.length,
    failed: failed.length,
    active: active.length,
    recent_failures: failed.slice(0, 10).map((job) => ({
      id: job.id,
      job_type: job.job_type,
      target_id: job.target_id,
      last_error: job.last_error || null,
      updated_at: job.updated_at || null,
    })),
  };
}

export function assessSystemHealth(observed = {}) {
  const issues = [];
  const source = observed.source || {};
  const core = observed.core || {};
  const cloudflare = observed.cloudflare || {};
  const database = observed.database || {};
  const jobs = observed.jobs || {};
  const compute = observed.compute || {};
  const communications = observed.communications || {};
  const prim3 = observed.prim3 || {};

  if (!source.github_main_sha) addIssue(issues, 'error', 'source.github_main_unavailable', 'Could not prove the canonical GitHub main SHA.');
  if (!source.deploy_ref_sha) addIssue(issues, 'error', 'source.deploy_ref_unavailable', 'Could not prove deploy/ovh-production.');
  if (source.github_main_sha && source.deploy_ref_sha && source.github_main_sha !== source.deploy_ref_sha) {
    addIssue(issues, 'warning', 'source.promotion_pending', 'Canonical main contains commits not yet promoted to deploy/ovh-production.', {
      github_main_sha: source.github_main_sha,
      deploy_ref_sha: source.deploy_ref_sha,
    });
  }

  const runnerState = text(core?.services?.['mccluster-core-runner.service']);
  const brokerState = text(core?.services?.['mccluster-core-tool-broker.service']);
  if (runnerState !== 'active') addIssue(issues, 'error', 'core.runner_inactive', 'McCluster Core runner is not active.', { state: runnerState || null });
  if (brokerState !== 'active') addIssue(issues, 'error', 'core.broker_inactive', 'McCluster Core tool broker is not active.', { state: brokerState || null });
  if (!core.deployed_sha) addIssue(issues, 'error', 'core.deployed_sha_unavailable', 'OVH deployment SHA is unavailable.');
  if (core.deployed_sha && source.deploy_ref_sha && core.deployed_sha !== source.deploy_ref_sha) {
    addIssue(issues, 'error', 'core.deploy_ref_mismatch', 'OVH is not running the promoted deploy/ovh-production revision.', {
      deployed_sha: core.deployed_sha,
      deploy_ref_sha: source.deploy_ref_sha,
    });
  }

  if (!cloudflare.reachable) {
    addIssue(issues, 'error', 'cloudflare.health_unreachable', 'Cloudflare Worker health endpoint is unreachable.', { error: cloudflare.error || null });
  } else if (cloudflare.source_current === false) {
    addIssue(issues, 'warning', 'cloudflare.source_stale', 'Cloudflare Worker is behind the latest Worker-affecting source revision.', {
      deployed_sha: cloudflare.deployed_sha || null,
      expected_sha: cloudflare.expected_sha || null,
    });
  } else if (cloudflare.source_current == null) {
    addIssue(issues, 'warning', 'cloudflare.source_unverifiable', 'Cloudflare Worker responded, but source revision parity could not be proved.');
  }

  if (!database.reachable) {
    addIssue(issues, 'error', 'database.unreachable', 'Canonical Supabase Data API is unreachable.', { error: database.error || null });
  } else if (database.migration_parity === false) {
    addIssue(issues, 'warning', 'database.migrations_behind', 'Canonical Supabase is behind the latest migration contract committed on main.', {
      expected: database.expected_latest_migration || null,
      verified_minimum: database.verified_minimum_applied_migration || null,
    });
  } else if (database.migration_parity == null) {
    addIssue(issues, 'warning', 'database.migrations_unverifiable', 'Database migration parity could not be proved from the current sentinel set.', {
      expected: database.expected_latest_migration || null,
      verified_minimum: database.verified_minimum_applied_migration || null,
    });
  }

  if (finite(jobs.failed) > 0) addIssue(issues, 'warning', 'jobs.failed_present', 'Recent agent jobs are failed.', { count: finite(jobs.failed) });
  if (finite(jobs.stale_running) > 0) addIssue(issues, 'warning', 'jobs.stale_running_present', 'Agent jobs appear stuck with stale running locks.', { count: finite(jobs.stale_running) });
  if (finite(jobs?.evidence?.post_contract_unverified) > 0) {
    addIssue(issues, 'error', 'jobs.completion_evidence_missing', 'Jobs completed after the proof-before-done contract without valid completion evidence.', {
      count: finite(jobs.evidence.post_contract_unverified),
    });
  }

  if (compute.available === false) {
    addIssue(issues, 'warning', 'compute.inventory_unavailable', 'Compute-node inventory could not be read.', { error: compute.error || null });
  } else if (finite(compute.configured) > 0 && finite(compute.live) === 0) {
    addIssue(issues, 'warning', 'compute.no_live_nodes', 'Compute nodes are configured but none are currently live.', { configured: finite(compute.configured) });
  }

  if (communications.schema_present === false) {
    addIssue(issues, 'warning', 'communications.schema_unavailable', 'Communications Beta schema is not available in canonical Supabase.');
  } else if (communications.configured === false) {
    addIssue(issues, 'warning', 'communications.relay_not_configured', 'No enabled Android/SIM communications relay is configured.');
  } else if (finite(communications.live_relays) === 0) {
    addIssue(issues, 'warning', 'communications.no_live_relay', 'Communications relay is configured but no relay has a fresh heartbeat.', {
      enabled_relays: finite(communications.enabled_relays),
    });
  }
  if (finite(communications.outbox_failed) > 0) {
    addIssue(issues, 'warning', 'communications.outbox_failures', 'Communications outbox contains failed messages.', { count: finite(communications.outbox_failed) });
  }

  if (prim3.ready === false) {
    addIssue(issues, 'warning', 'prim3.not_ready', 'PRIM3 autonomous studio runtime is not fully ready.', prim3.readiness || null);
  }

  const status = issues.some((item) => item.severity === 'error')
    ? 'fail'
    : issues.some((item) => item.severity === 'warning')
      ? 'degraded'
      : 'ok';

  return {
    status,
    issues,
    components: {
      source: componentStatus(issues, 'source.'),
      core: componentStatus(issues, 'core.'),
      cloudflare: componentStatus(issues, 'cloudflare.'),
      database: componentStatus(issues, 'database.'),
      jobs: componentStatus(issues, 'jobs.'),
      compute: componentStatus(issues, 'compute.'),
      communications: componentStatus(issues, 'communications.'),
      prim3: componentStatus(issues, 'prim3.'),
    },
  };
}
