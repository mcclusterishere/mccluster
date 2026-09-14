import os from 'node:os';
import { assertCompletionEvidence } from './completion-evidence.mjs';

const SB = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || '');
const LEGACY_SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const API_KEY = SECRET_KEY || LEGACY_SERVICE_KEY;
export const workerId = String(process.env.MCCLUSTER_CORE_ID || `core:${os.hostname()}:${process.pid}`);

function configured() {
  if (!SB || !API_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY (legacy) are required');
  }
}

export function buildSupabaseHeaders({ secretKey = SECRET_KEY, legacyServiceKey = LEGACY_SERVICE_KEY, extra = {} } = {}) {
  const apiKey = secretKey || legacyServiceKey;
  if (!apiKey) throw new Error('A Supabase backend API key is required');

  const base = {
    apikey: apiKey,
    'content-type': 'application/json',
  };

  if (!secretKey && legacyServiceKey) base.authorization = `Bearer ${legacyServiceKey}`;
  return { ...base, ...extra };
}

function headers(extra = {}) {
  configured();
  return buildSupabaseHeaders({ extra });
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

export async function heartbeat(job) {
  await rest(`ops_agent_jobs?${ownedRunningParams(job)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ locked_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  });
}

export async function completeJob(job, output) {
  assertCompletionEvidence(job, output);
  const now = new Date().toISOString();
  const { body: rows = [] } = await rest(`ops_agent_jobs?${ownedRunningParams(job)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      status: 'done',
      output,
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

export async function recentObjectives({ orgId, limit = 25 } = {}) {
  const params = new URLSearchParams({
    select: '*',
    limit: String(Math.min(100, Math.max(1, Number(limit) || 25))),
  });
  if (orgId) params.set('org_id', `eq.${orgId}`);
  const { body = [] } = await rest(`ops_objectives?${params.toString()}`);
  return body;
}

export async function recentSignals({ orgId, sinceHours = 168, limit = 100, statuses = ['new', 'processed'] } = {}) {
  const since = new Date(Date.now() - Math.max(1, Number(sinceHours)) * 3_600_000).toISOString();
  const params = new URLSearchParams({
    observed_at: `gte.${since}`,
    select: '*',
    order: 'observed_at.desc',
    limit: String(Math.min(200, Math.max(1, Number(limit) || 100))),
  });
  if (orgId) params.set('org_id', `eq.${orgId}`);
  if (Array.isArray(statuses) && statuses.length) params.set('status', `in.(${statuses.map((value) => String(value).replace(/[^a-z_]/gi, '')).join(',')})`);
  const { body = [] } = await rest(`ops_signals?${params.toString()}`);
  return body;
}

export async function signalById({ orgId, signalId } = {}) {
  if (!orgId || signalId === null || signalId === undefined || signalId === '') return null;
  const params = new URLSearchParams({ org_id: `eq.${orgId}`, id: `eq.${signalId}`, select: '*', limit: '1' });
  const { body = [] } = await rest(`ops_signals?${params.toString()}`);
  return body[0] || null;
}

export async function markSignalProcessed({ orgId, signalId, status = 'processed', objectiveId = null } = {}) {
  if (!orgId || signalId === null || signalId === undefined || signalId === '') return null;
  if (!['processed', 'ignored', 'failed'].includes(status)) throw new Error(`unsupported signal status: ${status}`);
  const params = new URLSearchParams({ org_id: `eq.${orgId}`, id: `eq.${signalId}` });
  const patch = { status, updated_at: new Date().toISOString() };
  if (objectiveId) patch.objective_id = objectiveId;
  const { body = [] } = await rest(`ops_signals?${params.toString()}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  return body[0] || null;
}

export async function enqueueJob({
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
  if (!orgId) throw new Error('enqueueJob requires orgId');
  if (!jobType) throw new Error('enqueueJob requires jobType');

  const row = {
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
  if (jobId) row.id = String(jobId);

  const endpoint = jobId ? 'ops_agent_jobs?on_conflict=id' : 'ops_agent_jobs';
  const prefer = jobId ? 'resolution=ignore-duplicates,return=representation' : 'return=representation';
  const { body: rows = [] } = await rest(endpoint, {
    method: 'POST',
    headers: { Prefer: prefer },
    body: JSON.stringify(row),
  });
  if (rows.length) return rows[0];

  if (jobId) {
    const params = new URLSearchParams({ id: `eq.${jobId}`, select: '*', limit: '1' });
    const { body: existing = [] } = await rest(`ops_agent_jobs?${params.toString()}`);
    if (existing.length) return existing[0];
  }

  throw new Error(`Failed to enqueue ${jobType}`);
}

export async function hasPendingJob({ orgId, jobType, targetId } = {}) {
  if (!orgId || !jobType) return false;
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    job_type: `eq.${jobType}`,
    status: 'in.(queued,running)',
    select: 'id',
    limit: '1',
  });
  if (targetId) params.set('target_id', `eq.${targetId}`);
  const { body = [] } = await rest(`ops_agent_jobs?${params.toString()}`);
  return body.length > 0;
}

export async function addSignal({
  orgId,
  signalType,
  source = 'mccluster-core',
  sourceRef = null,
  summary,
  severity = 50,
  confidence = 1,
  payload = {},
  fingerprint = null,
  observedAt = new Date().toISOString(),
} = {}) {
  if (!orgId || !signalType) throw new Error('addSignal requires orgId and signalType');
  const row = {
    org_id: orgId,
    signal_type: String(signalType).slice(0, 120),
    source: String(source).slice(0, 120),
    source_ref: sourceRef ? String(sourceRef).slice(0, 500) : null,
    severity: Math.min(100, Math.max(0, Number(severity) || 0)),
    confidence: Math.min(1, Math.max(0, Number(confidence) || 0)),
    payload: { ...(payload && typeof payload === 'object' ? payload : {}), ...(summary ? { summary: String(summary).slice(0, 4000) } : {}) },
    fingerprint: fingerprint ? String(fingerprint).slice(0, 128) : null,
    status: 'new',
    observed_at: observedAt,
    updated_at: new Date().toISOString(),
  };
  const endpoint = fingerprint ? 'ops_signals?on_conflict=org_id,fingerprint' : 'ops_signals';
  const { body: rows = [] } = await rest(endpoint, {
    method: 'POST',
    headers: { Prefer: fingerprint ? 'resolution=ignore-duplicates,return=representation' : 'return=representation' },
    body: JSON.stringify(row),
  });
  if (rows[0]) return rows[0];
  if (fingerprint) {
    const params = new URLSearchParams({ org_id: `eq.${orgId}`, fingerprint: `eq.${fingerprint}`, select: '*', limit: '1' });
    const { body = [] } = await rest(`ops_signals?${params.toString()}`);
    return body[0] || null;
  }
  return null;
}
