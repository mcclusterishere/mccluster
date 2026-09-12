import os from 'node:os';

const SB = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
export const workerId = String(process.env.MCCLUSTER_CORE_ID || `core:${os.hostname()}:${process.pid}`);

function configured() {
  if (!SB || !SERVICE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

function headers(extra = {}) {
  configured();
  return {
    apikey: SERVICE_KEY,
    authorization: `Bearer ${SERVICE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function parse(res) {
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; }
  catch { body = text; }
  if (!res.ok) {
    const message = body?.message || body?.hint || body?.error || `${res.status} ${res.statusText}`;
    const error = new Error(message);
    error.status = res.status;
    error.detail = body;
    throw error;
  }
  return { body, headers: res.headers, status: res.status };
}

export async function rest(path, init = {}) {
  configured();
  return parse(await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: headers(init.headers || {}),
  }));
}

export async function claimNext(supportedTypes) {
  const supported = new Set(supportedTypes);
  if (!supported.size) return null;

  const now = new Date().toISOString();
  const params = new URLSearchParams({
    status: 'eq.queued',
    run_after: `lte.${now}`,
    select: '*',
    order: 'priority.desc,run_after.asc,created_at.asc',
    limit: '50',
  });
  const { body: rows = [] } = await rest(`ops_agent_jobs?${params.toString()}`);

  for (const job of rows) {
    if (!supported.has(job.job_type)) continue;
    const attempts = Number(job.attempts || 0) + 1;
    const patchParams = new URLSearchParams({ id: `eq.${job.id}`, status: 'eq.queued' });
    const { body: claimed = [] } = await rest(`ops_agent_jobs?${patchParams.toString()}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'running',
        attempts,
        locked_at: now,
        locked_by: workerId,
        last_error: null,
        updated_at: now,
      }),
    });
    if (claimed.length) return claimed[0];
  }
  return null;
}

function ownedRunningParams(job) {
  return new URLSearchParams({
    id: `eq.${job.id}`,
    status: 'eq.running',
    locked_by: `eq.${workerId}`,
  }).toString();
}

export async function heartbeat(job) {
  await rest(`ops_agent_jobs?${ownedRunningParams(job)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ locked_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
}

export async function completeJob(job, output) {
  const now = new Date().toISOString();
  const { body: rows = [] } = await rest(`ops_agent_jobs?${ownedRunningParams(job)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'done',
      output: output && typeof output === 'object' ? output : { result: output ?? null },
      locked_at: null,
      locked_by: null,
      last_error: null,
      updated_at: now,
    }),
  });
  if (!rows.length) throw new Error(`Lost ownership of job ${job.id} before completion`);
  return rows[0];
}

export async function failJob(job, error) {
  const now = new Date();
  const attempts = Number(job.attempts || 0);
  const maxAttempts = Math.max(1, Number(job.max_attempts || 3));
  const exhausted = attempts >= maxAttempts;
  const delayMinutes = Math.min(60, Math.max(2, 2 ** Math.max(1, attempts)));
  const message = String(error?.message || error || 'unknown error').slice(0, 4000);
  const patch = {
    status: exhausted ? 'failed' : 'queued',
    locked_at: null,
    locked_by: null,
    last_error: message,
    updated_at: now.toISOString(),
  };
  if (!exhausted) patch.run_after = new Date(now.getTime() + delayMinutes * 60_000).toISOString();

  const { body: rows = [] } = await rest(`ops_agent_jobs?${ownedRunningParams(job)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  return rows[0] || null;
}

export async function recentJobs({ orgId, sinceHours = 12, limit = 25 } = {}) {
  const since = new Date(Date.now() - Math.max(1, Number(sinceHours)) * 3_600_000).toISOString();
  const params = new URLSearchParams({
    updated_at: `gte.${since}`,
    select: 'id,org_id,job_type,target_type,target_id,status,priority,output,last_error,attempts,max_attempts,created_at,updated_at',
    order: 'updated_at.desc',
    limit: String(Math.min(100, Math.max(1, Number(limit) || 25))),
  });
  if (orgId) params.set('org_id', `eq.${orgId}`);
  const { body = [] } = await rest(`ops_agent_jobs?${params.toString()}`);
  return body;
}

export async function addSignal({ orgId, kind, body, severity = 'info', source = 'mccluster-core', metadata = {} }) {
  const { body: rows = [] } = await rest('ops_signals', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ org_id: orgId, kind, body, severity, source, metadata }),
  });
  return rows[0] || null;
}
