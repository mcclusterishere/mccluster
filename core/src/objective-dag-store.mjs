import { rest, workerId } from './supabase.mjs';
import { classifyDependencyRows, dependencyEvidenceFromRows, dependencyIdsFromJob } from './dependency-policy.mjs';

function ownedRunningParams(job) {
  return new URLSearchParams({
    id: `eq.${job.id}`,
    status: 'eq.running',
    locked_by: `eq.${workerId}`,
  }).toString();
}

export async function checkpointJobInput(job, input) {
  const { body: rows = [] } = await rest(`ops_agent_jobs?${ownedRunningParams(job)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      input: input && typeof input === 'object' ? input : {},
      updated_at: new Date().toISOString(),
    }),
  });
  if (!rows.length) throw new Error(`Lost ownership of job ${job.id} while checkpointing input`);
  return rows[0];
}

export async function enqueueJobWithId({
  jobId,
  orgId,
  jobType,
  targetType = 'portfolio',
  targetId = 'McCluster',
  input = {},
  priority = 25,
  runAfter = new Date().toISOString(),
  maxAttempts = 3,
} = {}) {
  if (!jobId) throw new Error('enqueueJobWithId requires jobId');
  if (!orgId) throw new Error('enqueueJobWithId requires orgId');
  if (!jobType) throw new Error('enqueueJobWithId requires jobType');

  const row = {
    id: String(jobId),
    org_id: orgId,
    job_type: jobType,
    target_type: targetType,
    target_id: targetId,
    status: 'queued',
    priority: Math.min(100, Math.max(0, Number(priority) || 0)),
    input: input && typeof input === 'object' ? input : {},
    run_after: runAfter,
    max_attempts: Math.max(1, Number(maxAttempts) || 3),
  };

  const { body: rows = [] } = await rest('ops_agent_jobs?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(row),
  });
  if (rows.length) return rows[0];

  const params = new URLSearchParams({ id: `eq.${jobId}`, select: '*', limit: '1' });
  const { body: existing = [] } = await rest(`ops_agent_jobs?${params.toString()}`);
  if (existing.length) return existing[0];
  throw new Error(`Failed to enqueue ${jobType} with deterministic id ${jobId}`);
}

async function dependencyState(job) {
  const ids = dependencyIdsFromJob(job);
  if (!ids.length) return { state: 'ready', dependency_ids: [], rows: [] };

  const params = new URLSearchParams({
    id: `in.(${ids.join(',')})`,
    select: 'id,job_type,target_type,target_id,status,output,last_error,updated_at',
    limit: String(ids.length),
  });
  const { body: rows = [] } = await rest(`ops_agent_jobs?${params.toString()}`);
  return { ...classifyDependencyRows(ids, rows), rows };
}

export async function prepareClaimedDagJob(job, { recheckMs } = {}) {
  const dependency = await dependencyState(job);
  if (dependency.state === 'ready') {
    if (!dependency.dependency_ids.length) return { action: 'execute', job };

    const input = job.input && typeof job.input === 'object' ? job.input : {};
    const evidence = input.evidence && typeof input.evidence === 'object' ? input.evidence : {};
    const nextInput = {
      ...input,
      evidence: {
        ...evidence,
        plan_dependencies: dependencyEvidenceFromRows(dependency.dependency_ids, dependency.rows || []),
      },
    };
    const updated = await checkpointJobInput(job, nextInput);
    return { action: 'execute', job: updated };
  }

  const now = new Date();
  const attempts = Math.max(0, Number(job.attempts || 1) - 1);
  if (dependency.state === 'failed') {
    const message = `Blocked by failed prerequisite job(s): ${(dependency.failed_ids || []).join(', ')}`.slice(0, 4000);
    const { body: rows = [] } = await rest(`ops_agent_jobs?${ownedRunningParams(job)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'failed',
        attempts,
        locked_at: null,
        locked_by: null,
        last_error: message,
        updated_at: now.toISOString(),
      }),
    });
    if (!rows.length) throw new Error(`Lost ownership of blocked job ${job.id}`);
    return { action: 'blocked', job: rows[0], dependency };
  }

  const delay = Math.min(5 * 60_000, Math.max(5_000, Number(recheckMs || process.env.MCCLUSTER_DEPENDENCY_RECHECK_MS || 30_000)));
  const { body: rows = [] } = await rest(`ops_agent_jobs?${ownedRunningParams(job)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'queued',
      attempts,
      run_after: new Date(now.getTime() + delay).toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: null,
      updated_at: now.toISOString(),
    }),
  });
  if (!rows.length) throw new Error(`Lost ownership of waiting job ${job.id}`);
  return { action: 'waiting', job: rows[0], dependency };
}
