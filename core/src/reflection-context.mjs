// Do not feed recursive job outputs or raw health telemetry back into the model.
export const REFLECTION_USER_BYTES = 6000;
const text = (value, max = 240) => typeof value === 'string' ? value.slice(0, max) : '';
const integer = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.min(max, Math.max(min, Math.trunc(Number(value)))) : fallback;

export function compactReflectionContext({ objective, maxJobs, objectives = [], jobs = [], health = null } = {}) {
  const sourceJobs = Array.isArray(jobs) ? jobs : [];
  const sourceObjectives = Array.isArray(objectives) ? objectives : [];
  const context = {
    objective: text(objective, 1200),
    max_next_jobs: integer(maxJobs, 0, 0, 3),
    canonical_objectives: sourceObjectives.slice(0, 8).map(row => ({
      id: text(row?.id, 80), title: text(row?.title || row?.name || row?.objective, 200),
      status: text(row?.status, 40), summary: text(row?.summary || row?.description, 280),
    })),
    recent_jobs: sourceJobs.filter(row => row?.job_type !== 'host_health').slice(0, 12).map(row => ({
      id: text(row?.id, 80), job_type: text(row?.job_type, 60), status: text(row?.status, 30),
      target_type: text(row?.target_type, 40), target_id: text(row?.target_id, 120),
      updated_at: text(row?.updated_at, 40), error: text(row?.last_error, 200),
      summary: text(row?.summary, 200),
    })),
    health: health && typeof health === 'object' ? {
      checked_at: text(health.checked_at, 40), overall: text(health.overall, 30),
      deployed_sha: /^[a-f0-9]{40}$/i.test(health.deployed_sha || '') ? health.deployed_sha : null,
      migration_parity: health.parity === true || health.parity === 'true',
      sha_match: health.sha_match === true || health.sha_match === 'true',
      failed_jobs_24h: integer(health.failures, 0, 0, 1000000),
    } : null,
    evidence_limits: { summarized: true, omitted_objectives: 0, omitted_jobs: 0 },
  };
  const updateOmissions = () => {
    context.evidence_limits.omitted_objectives = sourceObjectives.length - context.canonical_objectives.length;
    context.evidence_limits.omitted_jobs = sourceJobs.length - context.recent_jobs.length;
  };
  updateOmissions();
  // Enforce bytes after JSON escaping (including adversarial/multibyte strings).
  while (Buffer.byteLength(JSON.stringify(context)) > REFLECTION_USER_BYTES) {
    if (context.recent_jobs.length) context.recent_jobs.pop();
    else if (context.canonical_objectives.length) context.canonical_objectives.pop();
    else context.objective = context.objective.slice(0, Math.floor(context.objective.length / 2));
    updateOmissions();
  }
  return { context, json: JSON.stringify(context), bytes: Buffer.byteLength(JSON.stringify(context)) };
}

export async function loadReflectionJobs(rest, orgId, sinceHours, nowMs = Date.now()) {
  const query = new URLSearchParams({
    org_id: `eq.${orgId}`, job_type: 'neq.host_health',
    updated_at: `gte.${new Date(nowMs - sinceHours * 3600000).toISOString()}`,
    select: 'id,job_type,target_type,target_id,status,attempts,max_attempts,last_error,updated_at,summary:output->>summary',
    order: 'updated_at.desc,id.desc', limit: '12',
  });
  const { body } = await rest(`ops_agent_jobs?${query}`);
  if (!Array.isArray(body)) throw new Error('Reflection job evidence unavailable');
  return body;
}

export async function loadReflectionHealth(rest, orgId) {
  // Find the row using narrow columns before extracting JSON. Otherwise Postgres
  // evaluates every historical output before the top-N sort (51.7s in production).
  const identityQuery = new URLSearchParams({
    org_id: `eq.${orgId}`, job_type: 'eq.host_health', status: 'eq.done',
    select: 'id', order: 'updated_at.desc,id.desc', limit: '1',
  });
  const { body: identities } = await rest(`ops_agent_jobs?${identityQuery}`);
  if (!Array.isArray(identities)) throw new Error('Reflection health identity unavailable');
  if (!identities.length) return null;
  const id = identities[0]?.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '')) {
    throw new Error('Reflection health identity invalid');
  }
  const query = new URLSearchParams({
    id: `eq.${id}`, org_id: `eq.${orgId}`, job_type: 'eq.host_health', status: 'eq.done',
    select: 'checked_at:output->>checked_at,overall:output->>overall,deployed_sha:output->deployment->>deployed_sha,sha_match:output->deployment->>sha_match,parity:output->supabase->migration_attestation->>parity,failures:output->jobs->counts->>failed',
    limit: '1',
  });
  const { body } = await rest(`ops_agent_jobs?${query}`);
  if (!Array.isArray(body)) throw new Error('Reflection health evidence unavailable');
  // Deletion between reads means unavailable evidence, never another tenant's row.
  return body[0] || null;
}
