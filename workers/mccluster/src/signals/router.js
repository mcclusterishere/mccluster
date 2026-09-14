import { fail, reply } from '../lib/http.js';

const MAX_BODY = 256 * 1024;
const SOURCE_TYPES = new Set([
  'conversation', 'sms', 'email', 'calendar_event', 'commitment', 'funding',
  'infrastructure', 'client_work', 'repository', 'system', 'manual'
]);

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY) throw Object.assign(new Error('payload too large'), { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('payload too large'), { status: 413 });
  try { return text ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error('invalid json'), { status: 400 }); }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function deterministicUuid(hex) {
  const chars = String(hex).slice(0, 32).padEnd(32, '0').split('');
  chars[12] = '5';
  chars[16] = ['8', '9', 'a', 'b'][parseInt(chars[16] || '0', 16) % 4];
  const value = chars.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function rest(env, path, init = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: serviceHeaders(env, init.headers || {}),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) {
    throw Object.assign(new Error(body?.message || body?.error || `Supabase ${response.status}`), {
      status: 502,
      detail: body,
    });
  }
  return body;
}

async function requireHouseOwner(env, user) {
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
  const orgs = await rest(env, 'orgs?slug=eq.mccluster&select=id&limit=1');
  const orgId = orgs?.[0]?.id;
  if (!orgId) throw Object.assign(new Error('McCluster house organization is not configured'), { status: 503 });
  const params = new URLSearchParams({
    org_id: `eq.${orgId}`,
    profile_id: `eq.${user.id}`,
    role: 'eq.owner',
    select: 'org_id',
    limit: '1',
  });
  const memberships = await rest(env, `org_members?${params.toString()}`);
  if (!memberships?.length) throw Object.assign(new Error('McCluster house owner access required'), { status: 403 });
  return orgId;
}

function boundedObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export async function ingestSignal(env, { orgId, body, synthesize = true } = {}) {
  const sourceType = String(body?.source_type || body?.source || 'manual').trim().toLowerCase();
  if (!SOURCE_TYPES.has(sourceType)) throw Object.assign(new Error(`unsupported source_type: ${sourceType}`), { status: 400 });

  const signalType = String(body?.signal_type || body?.kind || sourceType).trim().slice(0, 120);
  const sourceRef = String(body?.source_ref || body?.external_id || body?.idempotency_key || '').trim().slice(0, 500);
  const summary = String(body?.summary || body?.body || body?.title || '').trim().slice(0, 4000);
  if (!signalType || !summary) throw Object.assign(new Error('signal_type/kind and summary/body are required'), { status: 400 });

  const observed = body?.observed_at ? new Date(body.observed_at) : new Date();
  if (Number.isNaN(observed.getTime())) throw Object.assign(new Error('invalid observed_at'), { status: 400 });
  const severity = Math.min(100, Math.max(0, Number(body?.severity ?? body?.priority ?? 50) || 0));
  const confidence = Math.min(1, Math.max(0, Number(body?.confidence ?? 1) || 0));
  const idempotencyKey = String(body?.idempotency_key || '').slice(0, 500);
  const fingerprint = await sha256([
    orgId, sourceType, sourceRef, idempotencyKey, signalType, summary,
  ].join('\n'));

  const payload = {
    ...boundedObject(body?.payload),
    summary,
    source_type: sourceType,
    project: String(body?.project || body?.payload?.project || '').slice(0, 240) || null,
    initiative: String(body?.initiative || body?.payload?.initiative || '').slice(0, 240) || null,
    department: String(body?.department || body?.payload?.department || '').slice(0, 120) || null,
    deadline: body?.deadline || body?.payload?.deadline || null,
    objective_synthesis: synthesize && body?.synthesize_objectives !== false,
  };

  const inserted = await rest(env, 'ops_signals?on_conflict=org_id,fingerprint', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      org_id: orgId,
      signal_type: signalType,
      source: sourceType,
      source_ref: sourceRef || null,
      severity,
      confidence,
      payload,
      observed_at: observed.toISOString(),
      fingerprint,
      status: 'new',
      updated_at: new Date().toISOString(),
    }),
  });

  let signal = inserted?.[0] || null;
  if (!signal) {
    const params = new URLSearchParams({ org_id: `eq.${orgId}`, fingerprint: `eq.${fingerprint}`, select: '*', limit: '1' });
    signal = (await rest(env, `ops_signals?${params.toString()}`))?.[0] || null;
  }
  if (!signal) throw Object.assign(new Error('signal ingestion produced no durable signal'), { status: 502 });

  let job = null;
  const shouldSynthesize = synthesize && body?.synthesize_objectives !== false;
  if (shouldSynthesize) {
    const jobId = deterministicUuid(await sha256(`objective-synthesis:signal:${fingerprint}`));
    const jobs = await rest(env, 'ops_agent_jobs?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        id: jobId,
        org_id: orgId,
        job_type: 'objective_synthesis',
        target_type: 'signal',
        target_id: String(signal.id),
        status: 'queued',
        priority: Math.min(85, Math.max(20, Math.round(severity))),
        input: {
          source: {
            signal_id: signal.id,
            source_type: sourceType,
            source_ref: sourceRef || null,
            fingerprint,
            observed_at: observed.toISOString(),
          },
          schedule_reflection: body?.schedule_reflection !== false,
        },
        max_attempts: 3,
      }),
    });
    job = jobs?.[0] || (await rest(env, `ops_agent_jobs?id=eq.${jobId}&select=*&limit=1`))?.[0] || null;
  }

  return {
    signal,
    duplicate: !inserted?.length,
    objective_synthesis: shouldSynthesize ? { queued: Boolean(job), job_id: job?.id || null } : { queued: false, reason: 'disabled' },
  };
}

export async function handleSignalRequest(request, env, user) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/v1/signals') return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(request, env, 'McCluster is not configured', 503);
  const orgId = await requireHouseOwner(env, user);

  if (request.method === 'GET') {
    const params = new URLSearchParams({ org_id: `eq.${orgId}`, select: '*', order: 'observed_at.desc', limit: '100' });
    const signals = await rest(env, `ops_signals?${params.toString()}`);
    return reply(request, env, { schema: 'mccluster-signal/v1', signals });
  }
  if (request.method !== 'POST') return fail(request, env, 'Method not allowed', 405);

  const body = await readJson(request);
  if (body.org_id && body.org_id !== orgId) return fail(request, env, 'cross-org signal denied', 403);
  const result = await ingestSignal(env, { orgId, body, synthesize: true });
  return reply(request, env, { schema: 'mccluster-signal/v1', ...result }, 202);
}
