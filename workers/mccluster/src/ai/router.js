import { fail, reply } from '../lib/http.js';
import { queueObjectiveSynthesis } from './objectives.js';

const MAX_BODY = 512 * 1024;
const OWNER_JOB_TYPES = new Set([
  'local_analysis',
  'repo_health',
  'objective_reflection',
  'portfolio_plan',
  'host_health',
  'code_patch',
  'game_studio_cycle',
  'preview_deploy'
]);

function serviceHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function houseOrgId(env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/orgs?slug=eq.mccluster&select=id&limit=1`, {
    headers: serviceHeaders(env)
  });
  const rows = await res.json().catch(() => []);
  return rows?.[0]?.id || null;
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY) throw Object.assign(new Error('payload too large'), { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('payload too large'), { status: 413 });
  try { return text ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error('invalid json'), { status: 400 }); }
}

/* Reads the same context function over GET. The caller's own bearer token is
   forwarded exactly as the POST path does, so the function still identifies the
   human and applies its own owner/admin check — the Worker does not widen it. */
async function readContextFunction(request, env, name, params) {
  const authorization = request.headers.get('authorization') || '';
  const query = new URLSearchParams();
  Object.keys(params).forEach((key) => {
    const value = params[key];
    if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  });
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/${name}?${query.toString()}`, {
    method: 'GET',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const message = data?.error || data?.message || `${name} failed`;
    throw Object.assign(new Error(message), {
      status: res.status >= 400 && res.status < 500 ? res.status : 502,
      detail: data
    });
  }
  return { status: res.status, data };
}

async function callContextFunction(request, env, name, body) {
  const authorization = request.headers.get('authorization') || '';
  const res = await fetch(`${env.SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const message = data?.error || data?.message || `${name} failed`;
    throw Object.assign(new Error(message), {
      status: res.status >= 400 && res.status < 500 ? res.status : 502,
      detail: data
    });
  }
  return { status: res.status, data };
}

async function countJobs(env, orgId, status) {
  const params = new URLSearchParams({ org_id: `eq.${orgId}`, select: 'id' });
  if (status) params.set('status', `eq.${status}`);
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs?${params.toString()}`, {
    headers: { ...serviceHeaders(env), Prefer: 'count=exact', Range: '0-0' }
  });
  if (!res.ok) return null;
  const range = res.headers.get('content-range') || '';
  const match = range.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function enqueueOwnerJob(env, orgId, body) {
  const jobType = String(body.job_type || '').trim();
  if (!OWNER_JOB_TYPES.has(jobType)) {
    throw Object.assign(new Error(`unsupported owner job type: ${jobType || '(empty)'}`), { status: 400 });
  }
  const targetType = String(body.target_type || 'portfolio').trim().slice(0, 120) || 'portfolio';
  const targetId = String(body.target_id || 'McCluster').trim().slice(0, 500) || 'McCluster';
  const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {};
  const priority = Math.min(100, Math.max(0, Number(body.priority ?? 50) || 0));
  const maxAttempts = Math.min(5, Math.max(1, Number(body.max_attempts ?? 3) || 3));
  const runAfter = body.run_after ? new Date(body.run_after) : new Date();
  if (Number.isNaN(runAfter.getTime())) throw Object.assign(new Error('invalid run_after'), { status: 400 });

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs`, {
    method: 'POST',
    headers: { ...serviceHeaders(env), Prefer: 'return=representation' },
    body: JSON.stringify({
      org_id: orgId,
      job_type: jobType,
      target_type: targetType,
      target_id: targetId,
      status: 'queued',
      priority,
      input,
      run_after: runAfter.toISOString(),
      max_attempts: maxAttempts
    })
  });
  const rows = await res.json().catch(() => []);
  if (!res.ok || !rows?.length) {
    throw Object.assign(new Error(rows?.message || 'failed to enqueue Core job'), { status: 502, detail: rows });
  }
  return rows[0];
}

async function getOwnerJob(env, orgId, jobId) {
  const params = new URLSearchParams({
    id: `eq.${jobId}`,
    org_id: `eq.${orgId}`,
    select: 'id,org_id,job_type,target_type,target_id,status,priority,input,output,last_error,attempts,max_attempts,locked_by,locked_at,created_at,updated_at',
    limit: '1'
  });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs?${params.toString()}`, {
    headers: serviceHeaders(env)
  });
  const rows = await res.json().catch(() => []);
  if (!res.ok) throw Object.assign(new Error('failed to read Core job'), { status: 502, detail: rows });
  return rows?.[0] || null;
}

async function latestSystemHealth(env, orgId) {
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    job_type: 'eq.host_health',
    status: 'eq.done',
    select: 'id,status,output,created_at,updated_at',
    order: 'updated_at.desc',
    limit: '1'
  });
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/ops_agent_jobs?${params.toString()}`, { headers: serviceHeaders(env) });
  const rows = await res.json().catch(() => []);
  if (!res.ok) throw Object.assign(new Error('failed to read system health'), { status: 502, detail: rows });
  const job = rows?.[0] || null;
  const checkedAt = job?.output?.checked_at || job?.updated_at || null;
  const ageMs = checkedAt && Number.isFinite(Date.parse(checkedAt)) ? Math.max(0, Date.now() - Date.parse(checkedAt)) : null;
  const staleAfterMs = 10 * 60_000;
  return {
    job,
    checked_at: checkedAt,
    age_ms: ageMs,
    stale: ageMs === null || ageMs > staleAfterMs,
    stale_after_ms: staleAfterMs,
    health: job?.output || null
  };
}

export async function handleAiRequest(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/v1/ai' && !path.startsWith('/v1/ai/')) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return fail(request, env, 'McCluster is not configured', 503);
  }
  if (!user) return fail(request, env, 'Authentication required', 401);

  const orgId = url.searchParams.get('org_id') || (await houseOrgId(env));
  if (!orgId) return fail(request, env, 'McCluster house organization is not configured', 503);

  const membershipsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(user.id)}&role=eq.owner&select=org_id,role&limit=1`,
    { headers: serviceHeaders(env) }
  );
  const memberships = await membershipsRes.json().catch(() => []);
  if (!memberships?.length) return fail(request, env, 'McCluster house owner access required', 403);

  if (path === '/v1/ai' && request.method === 'GET') {
    return reply(request, env, {
      ok: true,
      harness: 'ai_context-v4',
      durable_jobs: 'ops_agent_jobs',
      ingest: '/v1/ai/ingest',
      retrieve: '/v1/ai/retrieve',
      decisions: '/v1/ai/decisions',
      task: '/v1/ai/task',
      jobs: '/v1/ai/jobs',
      status: '/v1/ai/status',
      system_health: '/v1/ai/system-health',
      objective_synthesis: 'automatic after successful context ingest',
      allowed_job_types: [...OWNER_JOB_TYPES]
    });
  }

  if (path === '/v1/ai/status' && request.method === 'GET') {
    const [total, queued, running, failed, systemHealth] = await Promise.all([
      countJobs(env, orgId),
      countJobs(env, orgId, 'queued'),
      countJobs(env, orgId, 'running'),
      countJobs(env, orgId, 'failed'),
      latestSystemHealth(env, orgId).catch(() => null)
    ]);
    return reply(request, env, {
      ok: true,
      harness: 'ai_context-v4',
      context: { ingest: 'context-ingest', query: 'context-query', decisions: 'context-decision', core_reader: 'context-core' },
      execution: {
        table: 'ops_agent_jobs',
        jobs: { total, queued, running, failed },
        natural_language_ingress: '/v1/ai/task',
        explicit_ingress: '/v1/ai/jobs',
        conversation_objectives: 'reference-only objective_synthesis'
      },
      system_health: systemHealth ? {
        overall: systemHealth.health?.overall || 'unknown',
        checked_at: systemHealth.checked_at,
        age_ms: systemHealth.age_ms,
        stale: systemHealth.stale,
        endpoint: '/v1/ai/system-health'
      } : { overall: 'unknown', stale: true, endpoint: '/v1/ai/system-health' }
    });
  }

  if (path === '/v1/ai/system-health' && request.method === 'GET') {
    const current = await latestSystemHealth(env, orgId);
    return reply(request, env, {
      ok: Boolean(current.health),
      schema_version: current.health?.schema_version || null,
      overall: current.health?.overall || 'unknown',
      checked_at: current.checked_at,
      age_ms: current.age_ms,
      stale: current.stale,
      stale_after_ms: current.stale_after_ms,
      health_job_id: current.job?.id || null,
      health: current.health,
      refresh: { method: 'POST', path: '/v1/ai/system-health' }
    }, current.health ? 200 : 404);
  }

  if (path === '/v1/ai/system-health' && request.method === 'POST') {
    const body = await readJson(request);
    if (body.org_id && body.org_id !== orgId) return fail(request, env, 'cross-org health refresh denied', 403);
    const job = await enqueueOwnerJob(env, orgId, {
      job_type: 'host_health',
      target_type: 'host',
      target_id: 'ovh-mccluster-core',
      priority: body.priority ?? 95,
      max_attempts: body.max_attempts ?? 2,
      input: { requested_by: 'owner_api', requested_at: new Date().toISOString() }
    });
    return reply(request, env, { queued: true, system_health_refresh: true, job }, 202);
  }

  if (path === '/v1/ai/task' && request.method === 'POST') {
    const body = await readJson(request);
    if (body.org_id && body.org_id !== orgId) return fail(request, env, 'cross-org task denied', 403);
    const task = String(body.task || body.objective || '').trim().slice(0, 12000);
    if (!task) return fail(request, env, 'task or objective required', 400);
    const targetId = String(body.target_id || body.repository || 'McCluster').trim().slice(0, 500) || 'McCluster';
    const job = await enqueueOwnerJob(env, orgId, {
      job_type: 'objective_reflection',
      target_type: body.repository ? 'repository' : 'portfolio',
      target_id: targetId,
      priority: body.priority ?? 60,
      max_attempts: body.max_attempts ?? 3,
      input: {
        objective: task,
        task,
        max_next_jobs: Math.min(3, Math.max(1, Number(body.max_next_jobs ?? 2) || 2)),
        since_hours: Math.min(72, Math.max(1, Number(body.since_hours ?? 18) || 18)),
        conversation_origin: body.conversation_origin || null,
        requested_repository: body.repository || null
      }
    });
    return reply(request, env, {
      queued: true,
      mode: 'autonomous_reflection',
      job,
      safety: { production_deploy: false, auto_merge: false, unattended_code_patch_limit_per_reflection: 1 }
    }, 202);
  }

  if (path === '/v1/ai/jobs' && request.method === 'POST') {
    const body = await readJson(request);
    if (body.org_id && body.org_id !== orgId) return fail(request, env, 'cross-org job denied', 403);
    const job = await enqueueOwnerJob(env, orgId, body);
    return reply(request, env, { queued: true, job }, 202);
  }

  const jobMatch = path.match(/^\/v1\/ai\/jobs\/([0-9a-f-]{36})$/i);
  if (jobMatch && request.method === 'GET') {
    const job = await getOwnerJob(env, orgId, jobMatch[1]);
    if (!job) return fail(request, env, 'job not found', 404);
    return reply(request, env, { job });
  }

  if (path === '/v1/ai/ingest' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.org_id) body.org_id = orgId;
    if (body.org_id !== orgId) return fail(request, env, 'cross-org ingestion denied', 403);
    const { status, data } = await callContextFunction(request, env, 'context-ingest', body);

    let synthesis;
    try {
      synthesis = await queueObjectiveSynthesis(env, { orgId, ingestBody: body, ingestResult: data });
    } catch (error) {
      synthesis = {
        queued: false,
        error: 'objective_synthesis_enqueue_failed',
        detail: String(error?.message || error).slice(0, 500)
      };
    }

    const response = data && typeof data === 'object' && !Array.isArray(data)
      ? { ...data, objective_synthesis: synthesis }
      : { ingest: data, objective_synthesis: synthesis };
    return reply(request, env, response, status);
  }

  if (path === '/v1/ai/retrieve' && request.method === 'POST') {
    const body = await readJson(request);
    const payload = {
      org_id: body.org_id || orgId,
      query: String(body.query || body.q || '').slice(0, 4000),
      limit: Math.max(1, Math.min(Number(body.limit) || 12, 50)),
      include_messages: body.include_messages,
      include_memories: body.include_memories
    };
    if (payload.org_id !== orgId) return fail(request, env, 'cross-org retrieval denied', 403);
    const { status, data } = await callContextFunction(request, env, 'context-query', payload);
    return reply(request, env, data, status);
  }

  /* Reading decisions back. This is a method on the route that already records
     them, not a new namespace: the house-owner gate above already applies, and
     the function re-checks org membership itself. */
  if (path === '/v1/ai/decisions' && request.method === 'GET') {
    try {
      const { status, data } = await readContextFunction(request, env, 'context-decision', {
        org_id: orgId,
        status: url.searchParams.get('status'),
        risk_class: url.searchParams.get('risk_class'),
        limit: url.searchParams.get('limit'),
        before: url.searchParams.get('before'),
        before_id: url.searchParams.get('before_id')
      });
      return reply(request, env, data, status);
    } catch (error) {
      return fail(request, env, error.message || 'decision read failed', error.status || 502, error.detail);
    }
  }

  if (path === '/v1/ai/decisions' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body.org_id) body.org_id = orgId;
    if (body.org_id !== orgId) return fail(request, env, 'cross-org decision denied', 403);
    if (!String(body.title || '').trim()) return fail(request, env, 'title required', 400);
    if (!String(body.decision || body.rationale || '').trim()) return fail(request, env, 'decision required', 400);
    const { status, data } = await callContextFunction(request, env, 'context-decision', body);
    return reply(request, env, data, status);
  }

  return fail(request, env, 'Not found', 404);
}
