import { assertCompletionEvidence } from './completion-evidence.mjs';

export const SYSTEM_HEALTH_SCHEMA = 'mccluster-system-health/v1';
export const SYSTEM_CONTRACT_MIGRATION = '20260914191500';
export const PROOF_CONTRACT_SINCE = '2026-09-14T19:12:27.000Z';

const SHA40 = /^[0-9a-f]{40}$/i;

function text(value) {
  return String(value ?? '').trim();
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isActive(value) {
  return text(value).toLowerCase() === 'active';
}

function compactError(error) {
  return text(error?.message || error || 'unknown error').slice(0, 500);
}

function ageMs(value, nowMs = Date.now()) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? Math.max(0, nowMs - parsed) : null;
}

function newestTimestamp(items, key = 'updated_at') {
  let best = null;
  for (const item of Array.isArray(items) ? items : []) {
    const value = item?.[key];
    if (!value || !Number.isFinite(Date.parse(value))) continue;
    if (!best || Date.parse(value) > Date.parse(best)) best = value;
  }
  return best;
}

export function verifyRecentCompletionEvidence(jobs, { proofContractSince = PROOF_CONTRACT_SINCE } = {}) {
  const cutoff = Date.parse(proofContractSince);
  const result = {
    eligible_done: 0,
    verified: 0,
    missing: 0,
    invalid: 0,
    recent_verified: [],
    problems: [],
  };

  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (job?.status !== 'done') continue;
    const updated = Date.parse(String(job.updated_at || ''));
    if (!Number.isFinite(updated) || (Number.isFinite(cutoff) && updated < cutoff)) continue;
    result.eligible_done += 1;
    if (!job.output?.completion_evidence) {
      result.missing += 1;
      result.problems.push({ job_id: job.id, job_type: job.job_type, code: 'missing_completion_evidence' });
      continue;
    }
    try {
      assertCompletionEvidence(job, job.output);
      result.verified += 1;
      result.recent_verified.push({
        job_id: job.id,
        job_type: job.job_type,
        updated_at: job.updated_at,
        result_sha256: job.output.completion_evidence.result_sha256,
        evidence_kinds: (job.output.completion_evidence.records || []).map((record) => record.kind),
      });
    } catch (error) {
      result.invalid += 1;
      result.problems.push({ job_id: job.id, job_type: job.job_type, code: 'invalid_completion_evidence', error: compactError(error) });
    }
  }

  result.recent_verified = result.recent_verified.slice(0, 12);
  result.coverage = result.eligible_done ? Number((result.verified / result.eligible_done).toFixed(4)) : 1;
  return result;
}

export function classifyComputeNodes(nodes, { nowMs = Date.now(), onlineWindowMs = 5 * 60_000 } = {}) {
  const normalized = (Array.isArray(nodes) ? nodes : []).map((node) => {
    const seenAge = ageMs(node?.last_seen_at, nowMs);
    const state = text(node?.state || node?.status || 'unknown').toLowerCase();
    const unavailable = ['disabled', 'revoked', 'quarantined'].includes(state);
    const online = seenAge !== null && seenAge <= onlineWindowMs && !unavailable && state === 'online';
    return {
      id: node?.id || null,
      name: node?.display_name || node?.name || null,
      state,
      status: state,
      last_seen_at: node?.last_seen_at || null,
      age_ms: seenAge,
      online,
      capabilities: Array.isArray(node?.capabilities) ? node.capabilities : node?.capabilities || null,
    };
  });
  return {
    node_count: normalized.length,
    online: normalized.filter((node) => node.online).length,
    stale_or_offline: normalized.filter((node) => !node.online).length,
    status: normalized.length === 0 ? 'idle' : normalized.some((node) => node.online) ? 'ready' : 'degraded',
    nodes: normalized.slice(0, 25),
  };
}

function degradation(list, component, code, severity, message, detail = null) {
  list.push({ component, code, severity, message, ...(detail ? { detail } : {}) });
}

export function aggregateSystemHealth(snapshot, { nowMs = Date.now() } = {}) {
  const checkedAt = new Date(nowMs).toISOString();
  const degradationList = [];
  const host = snapshot?.host || {};
  const services = snapshot?.services || {};
  const runtime = snapshot?.runtime || {};
  const deployment = snapshot?.deployment || {};
  const source = snapshot?.source || {};
  const supabase = snapshot?.supabase || {};
  const jobs = snapshot?.jobs || {};
  const compute = snapshot?.compute || { node_count: 0, online: 0, stale_or_offline: 0, status: 'unknown', nodes: [] };
  const communications = snapshot?.communications || {};
  const edge = snapshot?.edge || {};
  const approvals = snapshot?.approvals || { pending_count: 0, pending: [] };
  const prim3 = snapshot?.prim3 || {};

  if (!isActive(services.core_runner)) {
    degradation(degradationList, 'core', 'runner_inactive', 'critical', `Core runner is ${text(services.core_runner) || 'unknown'}.`);
  }
  if (!isActive(services.core_tool_broker)) {
    degradation(degradationList, 'core', 'tool_broker_inactive', 'critical', `Core tool broker is ${text(services.core_tool_broker) || 'unknown'}.`);
  }
  if (!isActive(services.vps_reconcile_timer)) {
    degradation(degradationList, 'deployment', 'reconcile_timer_inactive', 'warning', `VPS reconcile timer is ${text(services.vps_reconcile_timer) || 'unknown'}.`);
  }

  const githubSha = text(source.github_main_sha);
  const deployedSha = text(deployment.deployed_sha);
  const shaValid = SHA40.test(githubSha) && SHA40.test(deployedSha);
  const shaMatch = shaValid && githubSha.toLowerCase() === deployedSha.toLowerCase();
  if (!SHA40.test(githubSha)) degradation(degradationList, 'source', 'github_main_unknown', 'warning', 'Exact GitHub main SHA is unavailable.');
  if (!SHA40.test(deployedSha)) degradation(degradationList, 'deployment', 'deployed_sha_unknown', 'warning', 'Exact OVH deployed SHA is unavailable.');
  if (SHA40.test(githubSha) && SHA40.test(deployedSha) && !shaMatch) {
    degradation(degradationList, 'deployment', 'source_runtime_drift', 'warning', 'OVH is not running the current GitHub main revision.', { github_main_sha: githubSha, deployed_sha: deployedSha });
  }

  if (supabase.reachable !== true) {
    degradation(degradationList, 'supabase', 'unreachable', 'critical', 'Canonical Supabase could not be queried.', supabase.error ? { error: supabase.error } : null);
  } else if (supabase.contract?.parity !== true) {
    degradation(degradationList, 'supabase', 'migration_contract_drift', 'warning', 'Live Supabase system contract does not match the repository contract.', {
      expected_migration: SYSTEM_CONTRACT_MIGRATION,
      live_migration: supabase.contract?.migration_version || null,
      error: supabase.contract?.error || null,
    });
  }

  if (finite(jobs.counts?.failed) > 0) {
    degradation(degradationList, 'jobs', 'failed_jobs_present', 'warning', `${finite(jobs.counts.failed)} failed Core job(s) are present.`);
  }
  if (finite(jobs.stale_running_count) > 0) {
    degradation(degradationList, 'jobs', 'stale_running_jobs', 'warning', `${finite(jobs.stale_running_count)} running job(s) have stale locks.`);
  }
  if (finite(jobs.evidence?.invalid) > 0) {
    degradation(degradationList, 'evidence', 'invalid_completion_proof', 'critical', `${finite(jobs.evidence.invalid)} completed job(s) failed #10 evidence verification.`);
  }
  if (finite(jobs.evidence?.missing) > 0) {
    degradation(degradationList, 'evidence', 'missing_completion_proof', 'warning', `${finite(jobs.evidence.missing)} post-contract completed job(s) have no #10 evidence envelope.`);
  }

  if (communications.schema_ready !== true) {
    degradation(degradationList, 'communications', 'schema_not_ready', 'warning', 'Communications persistence contract is not available in canonical Supabase.', communications.error ? { error: communications.error } : null);
  } else {
    if (finite(communications.enabled_relays) === 0) degradation(degradationList, 'communications', 'no_enabled_relay', 'warning', 'No enabled Android/SIM communications relay is registered.');
    if (finite(communications.stale_relays) > 0) degradation(degradationList, 'communications', 'stale_relays', 'warning', `${finite(communications.stale_relays)} communications relay(s) are stale.`);
    if (finite(communications.failed_outbox) > 0) degradation(degradationList, 'communications', 'failed_outbox', 'warning', `${finite(communications.failed_outbox)} outbound communication(s) failed.`);
  }

  if (edge.reachable !== true) {
    degradation(degradationList, 'edge', 'cloudflare_unreachable', 'warning', 'Canonical Cloudflare edge health probe failed.', edge.error ? { error: edge.error } : null);
  }

  if (compute.node_count > 0 && compute.online === 0) {
    degradation(degradationList, 'compute', 'all_nodes_offline', 'warning', 'Registered specialized compute nodes are all stale or offline.');
  }

  if (prim3.status === 'degraded') {
    degradation(degradationList, 'prim3', 'studio_runtime_degraded', 'warning', 'PRIM3 autonomous studio runtime is not fully ready.', prim3.detail || null);
  }

  const criticalCount = degradationList.filter((item) => item.severity === 'critical').length;
  const overall = criticalCount ? 'fail' : degradationList.length ? 'degraded' : 'ok';
  const queueDepth = finite(jobs.counts?.queued) + finite(jobs.counts?.running);

  return {
    executor: 'host_health:v3',
    schema_version: SYSTEM_HEALTH_SCHEMA,
    overall,
    summary: `system=${overall} source_runtime=${shaMatch ? 'matched' : 'drift_or_unknown'} queue=${queueDepth} failures=${finite(jobs.counts?.failed)} evidence=${finite(jobs.evidence?.verified)}/${finite(jobs.evidence?.eligible_done)}`,
    source: {
      repository: source.repository || 'mcclusterishere/mccluster',
      github_main_sha: githubSha || null,
      observed_at: source.observed_at || null,
      error: source.error || null,
    },
    host,
    services,
    runtime,
    deployment: { ...deployment, sha_match: shaMatch },
    supabase,
    jobs,
    compute,
    communications,
    prim3,
    edge,
    approvals,
    recent_autonomy: Array.isArray(jobs.evidence?.recent_verified) ? jobs.evidence.recent_verified : [],
    degradation: degradationList,
    checked_at: checkedAt,
  };
}

export function deriveApprovals(jobs) {
  const source = Array.isArray(jobs) ? jobs : [];
  const ownerDecisions = source.filter((job) => job?.job_type === 'game_owner_decision' && job?.status === 'done');
  const releaseDecisions = new Set(source
    .filter((job) => job?.job_type === 'game_release_decision' && job?.status === 'done')
    .map((job) => text(job?.output?.branch))
    .filter(Boolean));
  const pending = [];

  for (const job of source) {
    if (job?.status !== 'done') continue;
    if (job.job_type === 'game_media_collect' && job.output?.state === 'awaiting_owner_review') {
      const campaign = text(job.output?.approval_packet?.campaign || job.target_id || 'PRIM3');
      const jobTime = Date.parse(String(job.updated_at || ''));
      const alreadyDecided = ownerDecisions.some((decision) => {
        const decisionCampaign = text(decision.target_id || decision.output?.campaign || '');
        const decisionTime = Date.parse(String(decision.updated_at || ''));
        return decisionCampaign === campaign && Number.isFinite(jobTime) && Number.isFinite(decisionTime) && decisionTime >= jobTime;
      });
      if (!alreadyDecided) {
        pending.push({
          type: 'game_studio_batch',
          job_id: job.id,
          campaign,
          candidate_count: Array.isArray(job.output?.approval_packet?.candidates) ? job.output.approval_packet.candidates.length : 0,
          updated_at: job.updated_at,
        });
      }
    }

    if (job.job_type === 'game_branch_smoke' && job.output?.state === 'implementation_validated') {
      const branch = text(job.output?.evidence?.branch || job.input?.branch);
      if (branch && !releaseDecisions.has(branch)) {
        pending.push({
          type: 'game_release',
          job_id: job.id,
          repository: job.output?.evidence?.repository || job.target_id || null,
          branch,
          commit_sha: job.output?.evidence?.commit || null,
          updated_at: job.updated_at,
        });
      }
    }
  }

  return { pending_count: pending.length, pending: pending.slice(0, 20), newest_at: newestTimestamp(pending) };
}
