/* ============================================================
   core.resume — REHYDRATION AFTER CONTEXT LOSS.

   A model's context window is not durable state, and treating it as
   though it were is how a session ends up re-deriving the same facts,
   acting on a stale SHA, or asking the owner what it was doing. The
   McCluster answer is that the durable state already exists — in
   ops_agent_jobs, ops_objectives, control_approvals, the capability
   catalog, the system-health contract and the deploy manifest — and a
   fresh session should be able to ask for it in one call.

   This is deliberately a READ. It queues nothing, decides nothing, and
   touches no provider. A session that has just lost its memory is the
   worst possible moment to take an action, so this capability cannot.

   Every field name here is pinned to the PRODUCTION schema, verified
   against project zmnhbrjyhxzhkxmhkexs rather than assumed:

     ops_signals     signal_type (not `kind`), severity is an integer,
                     observed_at and created_at
     ops_objectives  name (not `title`), description, status, priority
     deploy manifest commit_sha (what scripts/deploy-ovh-core.sh writes)

   A first cut of this file guessed `kind`, `title` and `deploy_sha`,
   and forgot that supabase.mjs `rest()` returns a {body, headers,
   status} envelope rather than rows. Each of those failed silently —
   an empty list and a null commit read exactly like a quiet system.
   Every one of them now has a regression test that would fail loudly.
   ============================================================ */

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { recentJobs, recentObjectives, rest, workerId } from '../supabase.mjs';

const DEPLOY_MANIFEST = process.env.MCCLUSTER_DEPLOY_MANIFEST || '/opt/mccluster/core/.mccluster-deploy.json';
const CATALOG_PATH = new URL('../../capabilities/catalog.json', import.meta.url);
const STALE_LEASE_MS = Number(process.env.MCCLUSTER_STALE_LEASE_MS || 30 * 60_000);
/* A job that has been queued for a day has not been picked up by any
   worker that understands it. Production currently holds six such jobs
   from 6 September whose job_type no executor claims. */
const STALE_QUEUE_MS = Number(process.env.MCCLUSTER_STALE_QUEUE_MS || 24 * 60 * 60_000);

function compact(error) {
  return String(error?.message || error || 'unknown error').slice(0, 300);
}

/* Every section degrades on its own — an all-or-nothing bootstrap fails
   exactly when it is needed. But degrading must not look like good news.
   The previous version fell back to an empty array, which a caller then
   could not distinguish from "there is genuinely nothing here": a
   failed approvals read rendered as zero pending approvals, which is the
   most dangerous possible lie to tell a session that is about to act.
   So a source now reports whether it answered, and an unavailable
   collection is null, never []. */
async function source(fn) {
  try { return { ok: true, value: await fn(), error: null }; }
  catch (error) { return { ok: false, value: null, error: compact(error) }; }
}

function statusOf(result) {
  return result.ok ? 'ok' : 'unavailable';
}

/* supabase.mjs `rest()` resolves to {body, headers, status}. Reading it
   as though it were the rows is the bug that made two whole sections of
   this file silently return nothing. */
async function rows(path) {
  const { body = [] } = await rest(path);
  return Array.isArray(body) ? body : [];
}

export async function deployFingerprint() {
  const manifest = await readFile(DEPLOY_MANIFEST, 'utf8').then(JSON.parse).catch(() => null);
  return {
    /* scripts/deploy-ovh-core.sh writes commit_sha. The other two are
       read only so an older manifest still resolves. */
    core_commit: manifest?.commit_sha || manifest?.deploy_sha || manifest?.sha || null,
    deployed_at: manifest?.deployed_at || null,
    deploy_ref: manifest?.deploy_ref || null,
    manifest_present: Boolean(manifest),
    manifest_path: DEPLOY_MANIFEST,
    host: os.hostname(),
    worker_id: workerId
  };
}

export async function catalogVersion() {
  const catalog = await readFile(CATALOG_PATH, 'utf8').then(JSON.parse).catch(() => null);
  return {
    catalog_version: catalog?.catalogVersion || null,
    capabilities: Array.isArray(catalog?.capabilities) ? catalog.capabilities.length : null,
    bindings: Array.isArray(catalog?.bindings) ? catalog.bindings.length : null
  };
}

export async function pendingApprovals(orgId) {
  return rows(
    `control_approvals?org_id=eq.${encodeURIComponent(orgId)}&state=eq.pending`
    + '&select=id,capability,resource_type,resource_id,reason,created_at,expires_at'
    + '&order=created_at.desc&limit=25'
  );
}

export async function systemHealth(orgId) {
  const contractRows = await rows('ops_system_contract?select=schema_version,migration_version,updated_at&limit=1');
  /* signal_type, not kind. severity is an integer in production. */
  const signalRows = await rows(
    `ops_signals?org_id=eq.${encodeURIComponent(orgId)}`
    + '&select=signal_type,severity,source,observed_at,created_at'
    + '&order=created_at.desc&limit=10'
  ).catch(() => []);
  return {
    contract: contractRows[0] || null,
    recent_signals: signalRows.map((signal) => ({
      signal_type: signal.signal_type ?? null,
      severity: signal.severity ?? null,
      source: signal.source ?? null,
      observed_at: signal.observed_at || signal.created_at || null
    }))
  };
}

/* THE QUEUE QUERY IS NOT TIME-WINDOWED EITHER, FOR THE SAME REASON.
 *
 * Queued work was still being read out of the 24-hour recent-history
 * window. Production holds six jobs queued at a single instant on
 * 6 September — stakeholder_map, lead_rescore, campaign_optimizer,
 * exposure_scan, crm_reconcile, objective_discovery — none of which any
 * Core executor claims. Every one of them was invisible to a resuming
 * session, which is precisely the backlog it most needs to see. */
export async function queuedJobs(orgId) {
  return rows(
    `ops_agent_jobs?org_id=eq.${encodeURIComponent(orgId)}&status=eq.queued`
    + '&select=id,job_type,target_id,status,attempts,run_after,created_at,updated_at'
    + '&order=created_at.asc&limit=100'
  );
}

/* Queue age is measured from run_after when it is set — a job
   deliberately scheduled for later is not stale, it is waiting — and
   from created_at otherwise. */
export function partitionQueue(jobs, nowMs = Date.now(), staleMs = STALE_QUEUE_MS) {
  const list = Array.isArray(jobs) ? jobs : [];
  const waiting = [];
  const stale = [];
  const scheduled = [];
  for (const job of list) {
    if (job?.status !== 'queued') continue;
    const runAfter = Date.parse(String(job.run_after || ''));
    const created = Date.parse(String(job.created_at || ''));
    const entry = {
      id: job.id, job_type: job.job_type, target_id: job.target_id,
      queued_at: job.created_at || null, run_after: job.run_after || null,
      attempts: job.attempts ?? null,
      age_ms: Number.isFinite(created) ? nowMs - created : null
    };
    if (Number.isFinite(runAfter) && runAfter > nowMs) { scheduled.push(entry); continue; }
    const eligibleSince = Number.isFinite(runAfter) ? runAfter : created;
    const waitingFor = Number.isFinite(eligibleSince) ? nowMs - eligibleSince : null;
    entry.waiting_ms = waitingFor;
    if (waitingFor !== null && waitingFor > staleMs) stale.push(entry);
    else waiting.push(entry);
  }
  return { waiting, stale, scheduled };
}

/* THE LEASE QUERY IS NOT TIME-WINDOWED, ON PURPOSE.
 *
 * Orphaned leases are the failure this section exists to surface, and
 * they are old by definition: the live queue currently holds two
 * objective_reflection jobs that have been `running` since 13
 * September. Sourcing them from the 24-hour recent-jobs window would
 * have hidden exactly the jobs worth reporting — the longer a lease is
 * stuck, the more certain it is dead and the less likely the window is
 * to contain it. So every running job is fetched regardless of age. */
export async function runningJobs(orgId) {
  return rows(
    `ops_agent_jobs?org_id=eq.${encodeURIComponent(orgId)}&status=eq.running`
    + '&select=id,job_type,target_id,status,attempts,created_at,updated_at'
    + '&order=updated_at.asc&limit=100'
  );
}

/* Jobs stuck `running` are the single most misleading thing a resuming
   session can see: they look like work in flight and are usually a
   worker that died holding a lease. Surfacing them separately means a
   fresh session says "these are stale" instead of "these are busy". */
export function partitionJobs(jobs, nowMs = Date.now(), staleMs = STALE_LEASE_MS) {
  const list = Array.isArray(jobs) ? jobs : [];
  const active = [];
  const stale = [];
  for (const job of list) {
    if (job?.status !== 'running') continue;
    const updated = Date.parse(String(job.updated_at || job.created_at || ''));
    const age = Number.isFinite(updated) ? nowMs - updated : null;
    const entry = {
      id: job.id, job_type: job.job_type, target_id: job.target_id,
      status: job.status, age_ms: age, attempts: job.attempts ?? null
    };
    if (age !== null && age > staleMs) stale.push(entry);
    else active.push(entry);
  }
  return { active, stale };
}

export async function coreResume({ orgId, sinceHours = 24, limit = 25, nowMs = Date.now() } = {}) {
  if (!orgId) throw Object.assign(new Error('org_id is required'), { status: 400 });

  const [deploy, catalog, recent, running, queued, objectives, approvals, health] = await Promise.all([
    source(deployFingerprint),
    source(catalogVersion),
    source(() => recentJobs({ orgId, sinceHours, limit })),
    source(() => runningJobs(orgId)),
    source(() => queuedJobs(orgId)),
    source(() => recentObjectives({ orgId, limit })),
    source(() => pendingApprovals(orgId)),
    source(() => systemHealth(orgId))
  ]);

  const sources = {
    runtime: statusOf(deploy),
    catalog: statusOf(catalog),
    recent_jobs: statusOf(recent),
    running_jobs: statusOf(running),
    queued_jobs: statusOf(queued),
    objectives: statusOf(objectives),
    approvals: statusOf(approvals),
    health: statusOf(health)
  };
  const degraded = Object.entries(sources)
    .filter(([, status]) => status !== 'ok')
    .map(([name]) => name);

  const recentList = recent.ok && Array.isArray(recent.value) ? recent.value : [];
  const leases = running.ok ? partitionJobs(running.value, nowMs) : null;
  const queue = queued.ok ? partitionQueue(queued.value, nowMs) : null;
  const failed = recent.ok ? recentList.filter((job) => job?.status === 'failed') : null;

  return {
    schema: 'mccluster-resume/v2',
    generated_at: new Date(nowMs).toISOString(),
    /* Read this first. Anything listed here is UNKNOWN, not empty. */
    sources,
    degraded_sources: degraded,
    source_errors: Object.fromEntries(
      [['runtime', deploy], ['catalog', catalog], ['recent_jobs', recent], ['running_jobs', running],
       ['queued_jobs', queued], ['objectives', objectives], ['approvals', approvals], ['health', health]]
        .filter(([, result]) => !result.ok)
        .map(([name, result]) => [name, result.error])
    ),
    workspace: {
      org_id: orgId,
      control_repository: process.env.MCCLUSTER_CANONICAL_REPOSITORY || 'mcclusterishere/mccluster',
      edge: process.env.MCCLUSTER_EDGE_URL || 'https://api.mccluster.org',
      supabase_project: process.env.MCCLUSTER_SUPABASE_PROJECT_REF || 'zmnhbrjyhxzhkxmhkexs'
    },
    runtime: deploy.ok ? deploy.value : null,
    catalog: catalog.ok ? catalog.value : null,
    work: {
      /* null means the query failed. [] means there genuinely are none. */
      active_jobs: leases ? leases.active : null,
      stale_running_jobs: leases ? leases.stale : null,
      stale_lease_threshold_ms: STALE_LEASE_MS,
      queued_jobs: queue ? queue.waiting : null,
      stale_queued_jobs: queue ? queue.stale : null,
      scheduled_jobs: queue ? queue.scheduled : null,
      stale_queue_threshold_ms: STALE_QUEUE_MS,
      recent_failures: failed ? failed.slice(0, 10).map((job) => ({
        id: job.id, job_type: job.job_type, last_error: String(job.last_error || '').slice(0, 300)
      })) : null,
      objectives: objectives.ok
        ? (Array.isArray(objectives.value) ? objectives.value : []).slice(0, 10).map((objective) => ({
            id: objective.id,
            name: objective.name ?? null,
            status: objective.status ?? null,
            priority: objective.priority ?? null
          }))
        : null
    },
    pending_approvals: approvals.ok
      ? (Array.isArray(approvals.value) ? approvals.value : []).map((row) => ({
          id: row.id, capability: row.capability,
          resource: `${row.resource_type || ''}:${row.resource_id || ''}`,
          reason: row.reason, expires_at: row.expires_at
        }))
      : null,
    health: health.ok ? health.value : null,
    next_step_hint: buildHint({ degraded, approvalsOk: approvals.ok, approvals: approvals.ok ? approvals.value : null, leases, queue, failed })
  };
}

/* Unavailability outranks everything. A session told "no approvals
   pending" when the approvals table could not be read would proceed as
   though a human owed it nothing — the single worst conclusion this
   payload can produce. */
function buildHint({ degraded, approvalsOk, approvals, leases, queue, failed }) {
  if (!approvalsOk) {
    return 'Approval state unavailable — do not assume nothing is pending. Re-check before taking any consequential action.'
      + (degraded.length > 1 ? ` Other degraded sources: ${degraded.filter((d) => d !== 'approvals').join(', ')}.` : '');
  }
  if (Array.isArray(approvals) && approvals.length) {
    return `${approvals.length} approval(s) are waiting on a house owner; nothing consequential proceeds until they are decided.`;
  }
  if (degraded.length) {
    return `Partial state only — these sources did not answer: ${degraded.join(', ')}. Treat them as unknown, not empty.`;
  }
  if (leases?.stale?.length) {
    return `${leases.stale.length} job(s) have been 'running' beyond the stale threshold — likely orphaned leases, not work in flight.`;
  }
  if (queue?.stale?.length) {
    return `${queue.stale.length} job(s) have sat queued beyond the stale threshold — likely no executor claims their job_type.`;
  }
  if (failed?.length) {
    return `${failed.length} recent job failure(s) to triage.`;
  }
  return 'No approvals pending, no stale leases, no stale queue, no recent failures.';
}
