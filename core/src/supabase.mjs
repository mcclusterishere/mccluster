import os from 'node:os';
import { assertCompletionEvidence } from './completion-evidence.mjs';

const SB = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || '');
const LEGACY_SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const API_KEY = SECRET_KEY || LEGACY_SERVICE_KEY;
export const workerId = String(process.env.MCCLUSTER_CORE_ID || `core:${os.hostname()}:${process.pid}`);
const STALE_JOB_MS = Math.max(60_000, Number(process.env.MCCLUSTER_STALE_JOB_MS || 10 * 60_000));
const STALE_SWEEP_MS = Math.max(15_000, Number(process.env.MCCLUSTER_STALE_SWEEP_MS || 60_000));
const UNSUPPORTED_JOB_GRACE_MS = Math.max(60_000, Number(process.env.MCCLUSTER_UNSUPPORTED_JOB_GRACE_MS || 10 * 60_000));
let lastStaleSweepAt = 0;

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

export async function recoverStaleJobs({ now = new Date() } = {}) {
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - STALE_JOB_MS).toISOString();

  const params = new URLSearchParams({
    status: 'eq.running',
    locked_at: `lt.${cutoff}`,
    select: 'id,attempts,max_attempts,locked_at,locked_by',
    order: 'locked_at.asc',
    limit: '100',
  });

  const { body: rows = [] } = await rest(`ops_agent_jobs?${params.toString()}`);
  let recovered = 0;

  for (const job of rows) {
    const attempts = Number(job.attempts || 0);
    const maxAttempts = Math.max(1, Number(job.max_attempts || 3));
    const exhausted = attempts >= maxAttempts;
    const patch = {
      status: exhausted ? 'failed' : 'queued',
      locked_at: null,
      locked_by: null,
      last_error: exhausted
        ? 'Recovered stale worker lock after final attempt; marked failed'
        : 'Recovered stale worker lock after heartbeat expired',
      updated_at: nowIso,
    };
    if (!exhausted) patch.run_after = nowIso;

    const match = new URLSearchParams({
      id: `eq.${job.id}`,
      status: 'eq.running',
      locked_at: `eq.${job.locked_at}`,
    });
    const { body: updated = [] } = await rest(`ops_agent_jobs?${match.toString()}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (updated.length) recovered += 1;
  }

  return recovered;
}

export async function quarantineUnsupportedJobs(supportedTypes, { now = new Date() } = {}) {
  const supported = new Set(supportedTypes || []);
  const cutoff = new Date(now.getTime() - UNSUPPORTED_JOB_GRACE_MS).toISOString();
  const nowIso = now.toISOString();
  const params = new URLSearchParams({
    status: 'eq.queued',
    created_at: `lt.${cutoff}`,
    select: 'id,job_type,created_at',
    order: 'created_at.asc',
    limit: '200',
  });

  const { body: rows = [] } = await rest(`ops_agent_jobs?${params.toString()}`);
  let quarantined = 0;

  for (const job of rows) {
    if (supported.has(job.job_type)) continue;
    const match = new URLSearchParams({ id: `eq.${job.id}`, status: 'eq.queued' });
    const { body: updated = [] } = await rest(`ops_agent_jobs?${match.toString()}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        status: 'failed',
        locked_at: null,
        locked_by: null,
        last_error: `Unsupported job type quarantined by Core: ${job.job_type}`,
        updated_at: nowIso,
      }),
    });
    if (updated.length) quarantined += 1;
  }

  return quarantined;
}

export async function claimNext(supportedTypes) {
  const supported = new Set(supportedTypes);
  if (!supported.size) return null;

  const sweepNow = Date.now();
  if (sweepNow - lastStaleSweepAt >= STALE_SWEEP_MS) {
    lastStaleSweepAt = sweepNow;
    const sweepDate = new Date(sweepNow);
    await recoverStaleJobs({ now: sweepDate });
    await quarantineUnsupportedJobs([...supported], { now: sweepDate });
  }

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

/* A FAILED SUBPROCESS KNOWS WHY IT FAILED. SAY SO.
 *
 * run() rejects with the child's stdout and stderr hanging off error.result,
 * and failJob threw all of it away and stored only the message. The first
 * autonomous code_patch run recorded exactly "/usr/local/bin/opencode exited
 * with 1" — true, useless, and unreachable without SSH to the node. Keeping a
 * tail of what the process actually said is the difference between a fixable
 * report and a shrug. Tails, not the whole stream: this column is read in a
 * digest and a control room, not a log viewer. */
function failureDetail(error) {
  const result = error && typeof error === 'object' ? error.result : null;
  if (!result) return '';
  const tail = (value, max) => {
    const text = String(value ?? '').trim();
    if (!text) return '';
    return text.length > max ? `…${text.slice(-max)}` : text;
  };
  const stderr = tail(result.stderr, 1200);
  const stdout = stderr ? '' : tail(result.stdout, 800);
  const parts = [];
  if (stderr) parts.push(`stderr: ${stderr}`);
  if (stdout) parts.push(`stdout: ${stdout}`);
  return parts.length ? `\n${parts.join('\n')}` : '';
}

export async function failJob(job, error) {
  const now = new Date();
  const attempts = Number(job.attempts || 0);
  const maxAttempts = Math.max(1, Number(job.max_attempts || 3));
  const exhausted = attempts >= maxAttempts;
  const delayMinutes = Math.min(60, Math.max(2, 2 ** Math.max(1, attempts)));
  const message = `${String(error?.message || error || 'unknown error')}${failureDetail(error)}`.slice(0, 4000);
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

/* THE HOUSE ORG, WHEN NOBODY SET MCCLUSTER_ORG_ID.
 *
 * The morning digest recorded itself only `if (ORG_ID)`, and that variable is
 * not set on the node. So every morning at 07:30 the digest was built, the SMS
 * attempt came back twilio_not_configured, and the report was dropped on the
 * floor without a trace — ops_signals held exactly one row, a hand-run test.
 *
 * Resolving the slug is one cheap lookup and it is cached for the life of the
 * process, so a missing environment variable costs a round trip instead of the
 * whole report. */
const HOUSE_SLUG = process.env.MCCLUSTER_ORG_SLUG || 'mccluster';
let houseOrgPromise = null;

export function houseOrgId() {
  if (!houseOrgPromise) {
    houseOrgPromise = rest(`orgs?slug=eq.${encodeURIComponent(HOUSE_SLUG)}&select=id&limit=1`)
      .then((rows) => (Array.isArray(rows) && rows[0] ? String(rows[0].id) : null))
      .catch(() => null);
  }
  return houseOrgPromise;
}

export async function addSignal({ orgId, kind, body, severity = 'info', source = 'mccluster-core', metadata = {} }) {
  const severityMap = {
    debug: 0,
    info: 1,
    notice: 2,
    warn: 3,
    warning: 3,
    error: 4,
    critical: 5,
  };

  const numericSeverity = Number.isFinite(Number(severity))
    ? Number(severity)
    : (severityMap[String(severity).toLowerCase()] ?? 1);

  const payload = {
    body,
    ...metadata,
  };

  const { body: rows = [] } = await rest('ops_signals', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      org_id: orgId,
      signal_type: kind,
      source,
      severity: numericSeverity,
      confidence: 1,
      payload,
      observed_at: new Date().toISOString(),
    }),
  });

  return rows[0] || null;
}
