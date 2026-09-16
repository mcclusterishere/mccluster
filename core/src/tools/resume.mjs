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

   It is also deliberately small. The point is the smallest sufficient
   package to re-enter the work: what this is, what is running, what is
   waiting on a human, what version of everything is live. Not a
   transcript replay.
   ============================================================ */

import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { recentJobs, recentObjectives, rest, workerId } from '../supabase.mjs';

const DEPLOY_MANIFEST = process.env.MCCLUSTER_DEPLOY_MANIFEST || '/opt/mccluster/core/.mccluster-deploy.json';
const CATALOG_PATH = new URL('../../capabilities/catalog.json', import.meta.url);

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

async function deployFingerprint() {
  const manifest = await readFile(DEPLOY_MANIFEST, 'utf8').then(JSON.parse).catch(() => null);
  return {
    core_commit: manifest?.deploy_sha || manifest?.sha || null,
    deployed_at: manifest?.deployed_at || null,
    deploy_ref: manifest?.deploy_ref || null,
    manifest_present: Boolean(manifest),
    host: os.hostname(),
    worker_id: workerId
  };
}

async function catalogVersion() {
  const catalog = await readFile(CATALOG_PATH, 'utf8').then(JSON.parse).catch(() => null);
  return {
    catalog_version: catalog?.catalogVersion || null,
    capabilities: Array.isArray(catalog?.capabilities) ? catalog.capabilities.length : null,
    bindings: Array.isArray(catalog?.bindings) ? catalog.bindings.length : null
  };
}

async function pendingApprovals(orgId) {
  const rows = await rest(
    `control_approvals?org_id=eq.${encodeURIComponent(orgId)}&state=eq.pending`
    + '&select=id,capability,resource_type,resource_id,reason,created_at,expires_at'
    + '&order=created_at.desc&limit=25'
  );
  return Array.isArray(rows) ? rows : [];
}

async function systemHealth(orgId) {
  const rows = await rest(
    `ops_system_contract?select=schema_version,migration_version,updated_at&limit=1`
  ).catch(() => null);
  const contract = Array.isArray(rows) ? rows[0] || null : null;
  const signals = await rest(
    `ops_signals?org_id=eq.${encodeURIComponent(orgId)}&select=kind,severity,created_at`
    + '&order=created_at.desc&limit=10'
  ).catch(() => []);
  return {
    contract,
    recent_signals: Array.isArray(signals) ? signals : []
  };
}

/* Jobs stuck `running` are the single most misleading thing a resuming
   session can see: they look like work in flight and are usually a
   worker that died holding a lease. Surfacing them separately means a
   fresh session says "these are stale" instead of "these are busy". */
function partitionJobs(jobs, nowMs = Date.now(), staleMs = 30 * 60_000) {
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

export { partitionJobs };

export async function coreResume({ orgId, sinceHours = 24, limit = 25 } = {}) {
  if (!orgId) throw Object.assign(new Error('org_id is required'), { status: 400 });

  const [deploy, catalog, jobs, objectives, approvals, health] = await Promise.all([
    attempt(deployFingerprint, { manifest_present: false }),
    attempt(catalogVersion, { catalog_version: null }),
    attempt(() => recentJobs({ orgId, sinceHours, limit }), []),
    attempt(() => recentObjectives({ orgId, limit }), []),
    attempt(() => pendingApprovals(orgId), []),
    attempt(() => systemHealth(orgId), {})
  ]);

  const jobList = Array.isArray(jobs) ? jobs : [];
  const { active, stale } = partitionJobs(jobList);
  const queued = jobList.filter((job) => job?.status === 'queued');
  const failed = jobList.filter((job) => job?.status === 'failed');

  return {
    schema: 'mccluster-resume/v1',
    generated_at: new Date().toISOString(),
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
      queued_jobs: queued.map((job) => ({ id: job.id, job_type: job.job_type, target_id: job.target_id })),
      recent_failures: failed.slice(0, 10).map((job) => ({
        id: job.id, job_type: job.job_type, last_error: String(job.last_error || '').slice(0, 300)
      })),
      objectives: (Array.isArray(objectives) ? objectives : []).slice(0, 10).map((objective) => ({
        id: objective.id, title: objective.title || objective.objective || null, status: objective.status || null
      }))
    },
    /* What a human owes the system. A resuming session should lead with
       this: it is the only category it cannot clear by itself. */
    pending_approvals: (Array.isArray(approvals) ? approvals : []).map((row) => ({
      id: row.id, capability: row.capability,
      resource: `${row.resource_type || ''}:${row.resource_id || ''}`,
      reason: row.reason, expires_at: row.expires_at
    })),
    health,
    next_step_hint: buildHint({ approvals, stale, failed })
  };
}

function buildHint({ approvals, stale, failed }) {
  if (Array.isArray(approvals) && approvals.length) {
    return `${approvals.length} approval(s) are waiting on a house owner; nothing consequential proceeds until they are decided.`;
  }
  if (stale.length) {
    return `${stale.length} job(s) have been 'running' beyond the stale threshold — likely orphaned leases, not work in flight.`;
  }
  if (Array.isArray(failed) && failed.length) {
    return `${failed.length} recent job failure(s) to triage.`;
  }
  return 'No approvals pending, no stale leases, no recent failures.';
}
