/* Control → Build → Code: the first governed production good.

   One owner-gated edge route that submits exactly one canonical `code_patch`
   job (the same `ops_agent_jobs` row the `code.build` capability's binding
   `core.code.build` writes) and reads its receipt back. No new queue, table,
   identity, approval store or Worker. The router resolves the house
   organization and the caller's owner membership before this module runs;
   browser-supplied org, role, admin flags or path scope never grant anything,
   and repository and paths are validated again here against the same rules
   the Core executor enforces. Disabled by default: without the flag the route
   answers `unavailable`, never a fake success. */
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
    verification: 'A draft PR reported by Core is shown as reported until it is read back from GitHub independently.'
  };
}
/* The product never mistakes "unknown" for "empty" or "done". Each state here
   is derived from the stored job row, nothing is inferred from elapsed time. */
export function mapReceipt(job, approval = null) {
  if (!job) return { state: 'unknown', reason: 'job_not_found' };
  const status = String(job.status || '').toLowerCase();
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
    reported,
    verification: { draft_pr_verified: false, head_sha: null, note: reported?.draft_pr ? 'Reported by Core. Not yet read back from GitHub.' : null }
  };
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
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/control_approvals?${params.toString()}`, { headers: serviceHeaders(env) }).catch(() => null);
  if (!res || !res.ok) return null;
  const rows = await res.json().catch(() => []);
  return rows?.[0] || null;
}
async function enqueue(env, orgId, value, user) {
  const row = {
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
      capability: CAPABILITY,
      requested_by: 'control_build',
      requested_by_user: user.id,
      requested_at: new Date().toISOString()
    }
  };
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs`, { method: 'POST', headers: { ...serviceHeaders(env), Prefer: 'return=representation' }, body: JSON.stringify(row) });
  const rows = await res.json().catch(() => []);
  if (!res.ok || !rows?.length) throw Object.assign(new Error(rows?.message || 'failed to queue the build'), { status: 502, detail: rows });
  return rows[0];
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
      const existing = await findByKey(env, orgId, checked.value.idempotency_key);
      if (existing) {
        recordEvent({ orgId, name: 'control.build.code.replayed', level: 'info', outcome: 'ok', actorUserId: user.id, resourceType: 'ops_agent_job', resourceId: existing.id, message: 'Build request replayed to its existing job' });
        return reply(request, env, { queued: false, replayed: true, job_id: existing.id, receipt: mapReceipt(existing) }, 200);
      }
      const job = await enqueue(env, orgId, checked.value, user);
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
      const approval = await pendingApproval(env, orgId, job.id);
      return reply(request, env, { receipt: mapReceipt(job, approval) });
    } catch (error) {
      return fail(request, env, error.message || 'build read failed', error.status || 500, error.detail);
    }
  }
  return fail(request, env, 'unsupported build request', 405);
}
