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

function compact(error) {
  return String(error?.message || error || 'unknown error').slice(0, 300);
}

/* Every section degrades on its own. A session recovering from context
   loss must still get the parts that are readable when one source is
   down — an all-or-nothing bootstrap fails exactly when it is needed. */
async function attempt(fn, fallback) {
  try { return await fn(); }
  catch (error) { return { ...fallback, error: compact(error) }; }
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

  const [deploy, catalog, recent, running, objectives, approvals, health] = await Promise.all([
    attempt(deployFingerprint, { manifest_present: false, core_commit: null }),
    attempt(catalogVersion, { catalog_version: null }),
    attempt(() => recentJobs({ orgId, sinceHours, limit }), []),
    attempt(() => runningJobs(orgId), []),
    attempt(() => recentObjectives({ orgId, limit }), []),
    attempt(() => pendingApprovals(orgId), []),
    attempt(() => systemHealth(orgId), {})
  ]);

  const recentList = Array.isArray(recent) ? recent : [];
  const runningList = Array.isArray(running) ? running : [];
  const { active, stale } = partitionJobs(runningList, nowMs);
  const queued = recentList.filter((job) => job?.status === 'queued');
  const failed = recentList.filter((job) => job?.status === 'failed');
  const approvalList = Array.isArray(approvals) ? approvals : [];

  return {
    schema: 'mccluster-resume/v1',
    generated_at: new Date(nowMs).toISOString(),
    workspace: {
      org_id: orgId,
      control_repository: process.env.MCCLUSTER_CANONICAL_REPOSITORY || 'mcclusterishere/mccluster',
      edge: process.env.MCCLUSTER_EDGE_URL || 'https://api.mccluster.org',
      supabase_project: process.env.MCCLUSTER_SUPABASE_PROJECT_REF || 'zmnhbrjyhxzhkxmhkexs'
    },
    runtime: deploy,
    catalog,
    work: {
      active_jobs: active,
      /* Named `stale_running_jobs` rather than folded into active so a
         resuming model reports them as a problem, not as progress. */
      stale_running_jobs: stale,
      stale_lease_threshold_ms: STALE_LEASE_MS,
      queued_jobs: queued.map((job) => ({ id: job.id, job_type: job.job_type, target_id: job.target_id })),
      recent_failures: failed.slice(0, 10).map((job) => ({
        id: job.id, job_type: job.job_type, last_error: String(job.last_error || '').slice(0, 300)
      })),
      objectives: (Array.isArray(objectives) ? objectives : []).slice(0, 10).map((objective) => ({
        id: objective.id,
        /* production column is `name` */
        name: objective.name ?? null,
        status: objective.status ?? null,
        priority: objective.priority ?? null
      }))
    },
    /* What a human owes the system. A resuming session should lead with
       this: it is the only category it cannot clear by itself. */
    pending_approvals: approvalList.map((row) => ({
      id: row.id, capability: row.capability,
      resource: `${row.resource_type || ''}:${row.resource_id || ''}`,
      reason: row.reason, expires_at: row.expires_at
    })),
    health,
    next_step_hint: buildHint({ approvals: approvalList, stale, failed })
  };
}

function buildHint({ approvals, stale, failed }) {
  if (approvals.length) {
    return `${approvals.length} approval(s) are waiting on a house owner; nothing consequential proceeds until they are decided.`;
  }
  if (stale.length) {
    return `${stale.length} job(s) have been 'running' beyond the stale threshold — likely orphaned leases, not work in flight.`;
  }
  if (failed.length) {
    return `${failed.length} recent job failure(s) to triage.`;
  }
  return 'No approvals pending, no stale leases, no recent failures.';
}
