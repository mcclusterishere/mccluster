/* Control → Build → Code: the first governed production good.

   One owner-gated edge route that submits exactly one canonical `code_patch`
   job (the same `ops_agent_jobs` row the `code.build` capability's binding
   `core.code.build` writes) and reads its receipt back. No new queue, table,
   identity, approval store or Worker. The router resolves the house
   organization and the caller's owner membership before this module runs;
   browser-supplied org, role, admin flags or path scope never grant anything,
   and repository and paths are validated again here against the same rules
   the Core executor enforces. Disabled by default: without the flag the route
   answers `unavailable`, never a fake success.

   Exactly-once: the job id is derived from (org, idempotency_key), so the
   ledger's primary key is the atomic boundary. Two concurrent submissions
   with one key cannot both insert; the loser reads the winner back. A reused
   key with a different payload is a conflict, never a silent replay. */
import { fail, reply } from '../lib/http.js';
import { recordEvent } from '../lib/observability.js';

export const CAPABILITY = 'code.build';
export const JOB_TYPE = 'code_patch';
export const FLAG = 'CONTROL_BUILD_CODE_ENABLED';
export const ROUTE = '/v1/ai/build/code';
export const LIMITS = Object.freeze({ task_min: 12, task_max: 20000, title_max: 500, paths_max: 20, path_max: 200, max_attempts: 2, priority: 80 });
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PATH_PREFIX = /^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 64 * 1024;
/* Mirror of core/src/executors/code-patch.mjs SENSITIVE. The executor is the
   authority; refusing here only stops a job that could never be accepted. */
export const SENSITIVE_RULES = Object.freeze([
  /^\.git(?:\/|$)/,
  /^\.github\/workflows(?:\/|$)/,
  /^\.github\/actions(?:\/|$)/,
  /^supabase\/migrations(?:\/|$)/,
  /^core\/systemd(?:\/|$)/,
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)(?:id_rsa|id_ed25519|authorized_keys|known_hosts)$/,
  /credential/i,
  /secret/i
]);
const JOB_FIELDS = 'id,org_id,job_type,target_type,target_id,status,priority,input,output,last_error,attempts,max_attempts,locked_by,locked_at,run_after,created_at,updated_at';

function serviceHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' };
}
export function enabled(env) { return String(env?.[FLAG] ?? '').trim().toLowerCase() === 'true'; }
export function allowlistedRepositories(env) {
  const raw = String(env?.MCCLUSTER_CODE_REPOS || 'mcclusterishere/mccluster');
  return Object.freeze([...new Set(raw.split(',').map((x) => x.trim()).filter((x) => REPO.test(x)))]);
}
export function sensitivePath(value) { return SENSITIVE_RULES.some((rule) => rule.test(value)); }
function cleanPath(value) {
  return String(value ?? '').trim().replace(/^\.\//, '').replace(/\/+$/, '');
}
export function validateBuildRequest(body, env) {
  const bad = (error) => ({ ok: false, status: 400, error });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('request body must be an object');
  const repository = String(body.repository ?? '').trim();
  if (!REPO.test(repository)) return bad('repository must be owner/repo');
  if (!allowlistedRepositories(env).includes(repository)) return bad(`repository is not allowlisted for Build: ${repository}`);
  const task = String(body.task ?? '').trim();
  if (task.length < LIMITS.task_min) return bad(`task must describe the change in at least ${LIMITS.task_min} characters`);
  if (task.length > LIMITS.task_max) return bad(`task is longer than ${LIMITS.task_max} characters`);
  const title = String(body.title ?? '').trim().slice(0, LIMITS.title_max);
  const rawPaths = body.allowed_paths === undefined || body.allowed_paths === null ? [] : body.allowed_paths;
  if (!Array.isArray(rawPaths)) return bad('allowed_paths must be a list of repository path prefixes');
  if (rawPaths.length > LIMITS.paths_max) return bad(`allowed_paths may list at most ${LIMITS.paths_max} prefixes`);
  const allowed_paths = [];
  for (const entry of rawPaths) {
    const prefix = cleanPath(entry);
    if (!prefix) continue;
    if (sensitivePath(prefix)) return bad(`allowed path is a protected location: ${prefix.slice(0, 80)}`);
    if (prefix.length > LIMITS.path_max || !PATH_PREFIX.test(prefix) || prefix.split('/').some((part) => part === '..' || part === '')) return bad(`allowed path is not a plain repository prefix: ${prefix.slice(0, 80)}`);
    if (!allowed_paths.includes(prefix)) allowed_paths.push(prefix);
  }
  const idempotency_key = String(body.idempotency_key ?? '').trim().toLowerCase();
  if (!UUID.test(idempotency_key)) return bad('idempotency_key must be a UUID chosen once per build request');
  return { ok: true, value: { repository, task, title, allowed_paths, idempotency_key } };
}
export function describe(env) {
  const on = enabled(env);
  return {
    capability: CAPABILITY,
    job_type: JOB_TYPE,
    binding: 'core.code.build',
    enabled: on,
    state: on ? 'available' : 'unavailable',
    unavailable_reason: on ? null : 'control_build_code_disabled',
    repositories: allowlistedRepositories(env),
    risk: 'write',
    approval: 'review-required',
    execution: 'async',
    output: 'draft_pr_only',
    max_attempts: LIMITS.max_attempts,
    priority: LIMITS.priority,
    limits: { task_max: LIMITS.task_max, title_max: LIMITS.title_max, paths_max: LIMITS.paths_max },
    protected_paths: SENSITIVE_RULES.map((rule) => rule.source),
    safety: { auto_merge: false, production_deploy: false, isolated_worktree: true, human_review: true },
    verification: 'A draft PR reported by Core is shown as reported until it is read back from GitHub independently.',
    approval_semantics: 'review-required means the draft PR is reviewed by a human after execution; no pre-execution approval record gates a queued job today.',
    flag_scope: `${FLAG} gates only this route. It does not cancel jobs already queued, and it does not gate the owner-only POST /v1/ai/jobs route, which accepts code_patch independently.`,
    submission_path: 'edge writes the canonical ops_agent_jobs row under the owner gate; the core.code.build binding writes the same row from Core. One shared contract is the consolidation target.',
    idempotency: 'job id is derived from (organization, idempotency_key); the ledger primary key is the atomic boundary; a reused key with a different payload is refused with 409.'
  };
}
/* The product never mistakes "unknown" for "empty" or "done". Each state here
   is derived from the stored job row, nothing is inferred from elapsed time. */
export function mapReceipt(job, approvalRead = { status: 'not_checked', approval: null }) {
  if (!job) return { state: 'unknown', reason: 'job_not_found' };
  const status = String(job.status || '').toLowerCase();
  const approvalSource = approvalRead && typeof approvalRead === 'object' && typeof approvalRead.status === 'string' ? approvalRead.status : 'not_checked';
  const approval = approvalSource === 'ok' ? approvalRead.approval : null;
  const state = approval && approval.state === 'pending' ? 'awaiting_approval'
    : status === 'queued' ? 'queued'
    : status === 'running' ? 'running'
    : status === 'done' || status === 'completed' || status === 'succeeded' ? 'completed'
    : status === 'failed' || status === 'error' ? 'failed'
    : status === 'cancelled' || status === 'skipped' ? 'cancelled'
    : 'unknown';
  const output = job.output && typeof job.output === 'object' ? job.output : null;
  const reported = output ? {
    branch: typeof output.branch === 'string' ? output.branch : null,
    pushed: output.pushed === true,
    draft_pr: typeof output.draft_pr === 'string' && /^https:\/\/github\.com\//.test(output.draft_pr) ? output.draft_pr : null,
    forbidden: Array.isArray(output.forbidden) ? output.forbidden.slice(0, 50) : null,
    tests: output.tests && typeof output.tests === 'object' ? output.tests : null,
    summary: typeof output.summary === 'string' ? output.summary.slice(0, 2000) : null,
    agent_output_tail: typeof output.agent_output_tail === 'string' ? output.agent_output_tail.slice(-4000) : null
  } : null;
  return {
    state,
    job_id: job.id,
    correlation_id: job.id,
    capability: CAPABILITY,
    job_type: job.job_type,
    repository: job.target_id,
    idempotency_key: job.input?.idempotency_key || null,
    title: job.input?.title || null,
    allowed_paths: Array.isArray(job.input?.allowed_paths) ? job.input.allowed_paths : [],
    attempts: Number(job.attempts) || 0,
    max_attempts: Number(job.max_attempts) || null,
    last_error: typeof job.last_error === 'string' ? job.last_error.slice(0, 2000) : null,
    locked_by: job.locked_by || null,
    created_at: job.created_at || null,
    updated_at: job.updated_at || null,
    run_after: job.run_after || null,
    approval: approval ? { id: approval.id, state: approval.state, expires_at: approval.expires_at || null } : null,
    /* ok: the approvals ledger answered (an absent row is a verified absence);
       unavailable: the read failed or returned something invalid, so nothing
       about approvals is known; not_checked: this response did not consult it. */
    approval_source: approvalSource,
    approval_state: approvalSource === 'ok' ? (approval ? approval.state : 'none') : 'unknown',
    request_fingerprint: typeof job.input?.request_fingerprint === 'string' ? job.input.request_fingerprint : null,
    reported,
    verification: { draft_pr_verified: false, head_sha: null, note: reported?.draft_pr ? 'Reported by Core. Not yet read back from GitHub.' : null }
  };
}
const encoder = new TextEncoder();
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/* UUID derived from the organization and the client's idempotency key. The
   same (org, key) always names the same job row, so the primary key refuses a
   second insert without any extra table, index or lock. Version nibble 8 marks
   it as a custom, non-random UUID. */
export async function deterministicJobId(orgId, key) {
  const hex = await sha256Hex(`mccluster:${CAPABILITY}:${String(orgId).toLowerCase()}:${String(key).toLowerCase()}`);
  const bytes = hex.slice(0, 32).split('');
  bytes[12] = '8';
  bytes[16] = ['8', '9', 'a', 'b'][parseInt(bytes[16], 16) & 3];
  const h = bytes.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}
/* What a key is bound to. A second request with the same key must carry the
   same objective; otherwise the caller gets a conflict instead of someone
   else's job. */
export async function requestFingerprint(value) {
  return sha256Hex(JSON.stringify({ repository: value.repository, task: value.task, title: value.title, allowed_paths: value.allowed_paths }));
}
async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('request body too large'), { status: 413 });
  if (!text.trim()) return {};
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('invalid JSON body'), { status: 400 }); }
}
async function findByKey(env, orgId, key) {
  const params = new URLSearchParams({ org_id: `eq.${orgId}`, job_type: `eq.${JOB_TYPE}`, 'input->>idempotency_key': `eq.${key}`, select: JOB_FIELDS, order: 'created_at.asc', limit: '1' });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs?${params.toString()}`, { headers: serviceHeaders(env) });
  const rows = await res.json().catch(() => []);
  if (!res.ok) throw Object.assign(new Error('failed to check for an existing build'), { status: 502, detail: rows });
  return rows?.[0] || null;
}
async function readJob(env, orgId, jobId) {
  const params = new URLSearchParams({ id: `eq.${jobId}`, org_id: `eq.${orgId}`, job_type: `eq.${JOB_TYPE}`, select: JOB_FIELDS, limit: '1' });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs?${params.toString()}`, { headers: serviceHeaders(env) });
  const rows = await res.json().catch(() => []);
  if (!res.ok) throw Object.assign(new Error('failed to read the build job'), { status: 502, detail: rows });
  return rows?.[0] || null;
}
async function pendingApproval(env, orgId, jobId) {
  const params = new URLSearchParams({ org_id: `eq.${orgId}`, capability: `eq.${CAPABILITY}`, resource_id: `eq.${jobId}`, state: 'eq.pending', select: 'id,state,expires_at', limit: '1' });
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/control_approvals?${params.toString()}`, { headers: serviceHeaders(env) });
    if (!res.ok) return { status: 'unavailable', approval: null, reason: `approvals read returned ${res.status}` };
    const rows = await res.json();
    if (!Array.isArray(rows)) return { status: 'unavailable', approval: null, reason: 'approvals read returned a non-list' };
    const row = rows[0] || null;
    if (row && (typeof row.id !== 'string' || typeof row.state !== 'string')) return { status: 'unavailable', approval: null, reason: 'approvals row is malformed' };
    return { status: 'ok', approval: row };
  } catch (error) {
    return { status: 'unavailable', approval: null, reason: error?.message || 'approvals read failed' };
  }
}
async function enqueue(env, orgId, value, user) {
  const row = {
    id: await deterministicJobId(orgId, value.idempotency_key),
    org_id: orgId,
    job_type: JOB_TYPE,
    target_type: 'repository',
    target_id: value.repository,
    status: 'queued',
    priority: LIMITS.priority,
    max_attempts: LIMITS.max_attempts,
    run_after: new Date().toISOString(),
    input: {
      task: value.task,
      title: value.title,
      allowed_paths: value.allowed_paths,
      idempotency_key: value.idempotency_key,
      request_fingerprint: await requestFingerprint(value),
      capability: CAPABILITY,
      requested_by: 'control_build',
      requested_by_user: user.id,
      requested_at: new Date().toISOString()
    }
  };
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs`, { method: 'POST', headers: { ...serviceHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify(row) });
  const rows = await res.json().catch(() => null);
  if (res.status === 409 || (rows && !Array.isArray(rows) && String(rows.code) === '23505')) {
    /* The primary key refused a second row for this (org, key): another
       request won the race. Read the winner back; the caller compares payloads. */
    const winner = await readJob(env, orgId, row.id);
    if (winner) return { job: winner, inserted: false };
    throw Object.assign(new Error('the build was queued by a concurrent request but could not be read back'), { status: 503 });
  }
  if (!res.ok || !Array.isArray(rows) || !rows.length) throw Object.assign(new Error(rows?.message || 'failed to queue the build'), { status: 502, detail: rows });
  return { job: rows[0], inserted: true };
}
async function replayOrConflict(request, env, user, orgId, existing, value) {
  const expected = await requestFingerprint(value);
  const stored = existing.input?.request_fingerprint;
  if (stored && stored !== expected) {
    recordEvent({ orgId, name: 'control.build.code.conflict', level: 'warn', outcome: 'refused', actorUserId: user.id, resourceType: 'ops_agent_job', resourceId: existing.id, message: 'Idempotency key reused with a different objective' });
    return reply(request, env, { error: 'idempotency_conflict', message: 'This idempotency key already names a different build. Start a new build to submit a different objective.', job_id: existing.id, receipt: mapReceipt(existing) }, 409);
  }
  recordEvent({ orgId, name: 'control.build.code.replayed', level: 'info', outcome: 'ok', actorUserId: user.id, resourceType: 'ops_agent_job', resourceId: existing.id, message: 'Build request replayed to its existing job' });
  return reply(request, env, { queued: false, replayed: true, job_id: existing.id, receipt: mapReceipt(existing) }, 200);
}
/* Runs after the router has verified the caller is a house owner and resolved
   `orgId` server-side. Returns null for paths it does not own. */
export async function handleBuildCode(request, env, user, orgId, path) {
  if (path !== ROUTE && !path.startsWith(`${ROUTE}/`)) return null;
  if (path === ROUTE && request.method === 'GET') return reply(request, env, describe(env));
  if (path === ROUTE && request.method === 'POST') {
    if (!enabled(env)) return reply(request, env, { state: 'unavailable', reason: 'control_build_code_disabled', capability: CAPABILITY, enabled: false }, 503);
    let body;
    try { body = await readJson(request); } catch (error) { return fail(request, env, error.message, error.status || 400); }
    if (body && body.org_id !== undefined && body.org_id !== orgId) return fail(request, env, 'cross-org build denied', 403);
    const checked = validateBuildRequest(body, env);
    if (!checked.ok) return fail(request, env, checked.error, checked.status);
    try {
      /* Fast path for retries; the insert below is the real guard. */
      const existing = await findByKey(env, orgId, checked.value.idempotency_key);
      if (existing) return replayOrConflict(request, env, user, orgId, existing, checked.value);
      const { job, inserted } = await enqueue(env, orgId, checked.value, user);
      if (!inserted) return replayOrConflict(request, env, user, orgId, job, checked.value);
      recordEvent({ orgId, name: 'control.build.code.queued', level: 'info', outcome: 'ok', actorUserId: user.id, resourceType: 'ops_agent_job', resourceId: job.id, message: `Build queued for ${checked.value.repository}`, detail: { repository: checked.value.repository, allowed_paths: checked.value.allowed_paths.length } });
      return reply(request, env, { queued: true, replayed: false, job_id: job.id, receipt: mapReceipt(job), safety: describe(env).safety }, 202);
    } catch (error) {
      return fail(request, env, error.message || 'build submission failed', error.status || 500, error.detail);
    }
  }
  const match = path.match(/^\/v1\/ai\/build\/code\/([0-9a-f-]{36})$/i);
  if (match && request.method === 'GET') {
    try {
      const job = await readJob(env, orgId, match[1].toLowerCase());
      if (!job) return fail(request, env, 'build not found', 404);
      const approvalRead = await pendingApproval(env, orgId, job.id);
      return reply(request, env, { receipt: mapReceipt(job, approvalRead) });
    } catch (error) {
      return fail(request, env, error.message || 'build read failed', error.status || 500, error.detail);
    }
  }
  return fail(request, env, 'unsupported build request', 405);
}
