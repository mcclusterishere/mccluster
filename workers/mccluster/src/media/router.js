import { collectAssetCandidates, normalizeFalStatus, resultFal, statusFal, submitFal } from './fal.js';

function headers(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function db(env, path, options = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...headers(env), ...(options.headers || {}) }
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error('Media database request failed'), { status: res.status, detail: data });
  return data;
}

async function getOrg(env, userId, requestedOrgId) {
  if (requestedOrgId) {
    const rows = await db(env, `org_members?org_id=eq.${encodeURIComponent(requestedOrgId)}&profile_id=eq.${encodeURIComponent(userId)}&select=org_id,role&limit=1`);
    if (!rows?.length) throw Object.assign(new Error('You are not a member of that organization'), { status: 403 });
    return rows[0];
  }
  const rows = await db(env, `org_members?profile_id=eq.${encodeURIComponent(userId)}&select=org_id,role&order=added_at.asc&limit=1`);
  if (!rows?.length) throw Object.assign(new Error('No McCluster organization membership found'), { status: 403 });
  return rows[0];
}

async function modelById(env, id) {
  const rows = await db(env, `media_models?id=eq.${encodeURIComponent(id)}&enabled=eq.true&select=*`);
  return rows?.[0] || null;
}

async function jobById(env, id, orgId) {
  const rows = await db(env, `media_jobs?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(orgId)}&select=*`);
  return rows?.[0] || null;
}

async function patchJob(env, id, values) {
  const rows = await db(env, `media_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({ ...values, updated_at: new Date().toISOString() })
  });
  return rows?.[0] || null;
}

async function saveAssets(env, orgId, jobId, result) {
  const candidates = collectAssetCandidates(result);
  const unique = [...new Map(candidates.map((a) => [a.url, a])).values()];
  if (!unique.length) return [];
  const body = unique.map((asset) => ({ ...asset, org_id: orgId, job_id: jobId }));
  return db(env, 'media_assets', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
}

export async function listModels(request, env) {
  const url = new URL(request.url);
  const capability = url.searchParams.get('capability');
  const provider = url.searchParams.get('provider');
  let path = 'media_models?enabled=eq.true&order=capability.asc,display_name.asc&select=*';
  if (capability) path += `&capability=eq.${encodeURIComponent(capability)}`;
  if (provider) path += `&provider=eq.${encodeURIComponent(provider)}`;
  return db(env, path);
}

export async function createGeneration(request, env, user) {
  let body;
  try { body = await request.json(); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  const org = await getOrg(env, user.id, body.org_id || null);
  if (!body.model_id) throw Object.assign(new Error('model_id is required'), { status: 400 });
  const model = await modelById(env, body.model_id);
  if (!model) throw Object.assign(new Error('Unknown or disabled media model'), { status: 404 });
  if (model.provider !== 'fal') throw Object.assign(new Error('Provider adapter not installed'), { status: 501 });

  const input = { ...(body.input || {}) };
  if (body.prompt && !input.prompt) input.prompt = body.prompt;
  if (!Object.keys(input).length) throw Object.assign(new Error('input or prompt is required'), { status: 400 });

  const [job] = await db(env, 'media_jobs', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify({
      org_id: org.org_id,
      created_by: user.id,
      provider: model.provider,
      provider_model_id: model.provider_model_id,
      capability: model.capability,
      status: 'queued',
      prompt: body.prompt || input.prompt || null,
      input,
      routing: {
        requested_model_id: model.id,
        requested_by: user.id,
        budget_cents: Number.isFinite(body.budget_cents) ? Math.max(0, Math.floor(body.budget_cents)) : null,
        strategy: body.strategy || 'explicit-model'
      }
    })
  });

  try {
    const submitted = await submitFal(env, model.provider_model_id, input);
    return patchJob(env, job.id, {
      provider_request_id: submitted.request_id,
      submitted_at: new Date().toISOString(),
      provider_status: submitted,
      status: 'queued'
    });
  } catch (error) {
    await patchJob(env, job.id, {
      status: 'failed',
      error: { message: error instanceof Error ? error.message : String(error) }
    }).catch(() => null);
    throw error;
  }
}

export async function getGeneration(request, env, user, jobId, refresh = true) {
  const url = new URL(request.url);
  const org = await getOrg(env, user.id, url.searchParams.get('org_id'));
  let job = await jobById(env, jobId, org.org_id);
  if (!job) throw Object.assign(new Error('Media job not found'), { status: 404 });

  if (refresh && job.provider === 'fal' && job.provider_request_id && !['completed', 'failed', 'cancelled'].includes(job.status)) {
    const raw = await statusFal(env, job.provider_model_id, job.provider_request_id);
    const status = normalizeFalStatus(raw);
    job = await patchJob(env, job.id, { status, provider_status: raw });
  }

  if (job.status === 'completed' && (!job.result || Object.keys(job.result).length === 0)) {
    const result = await resultFal(env, job.provider_model_id, job.provider_request_id);
    job = await patchJob(env, job.id, {
      result: result.data || {},
      completed_at: new Date().toISOString(),
      provider_status: { ...(job.provider_status || {}), request_id: result.request_id }
    });
    const assets = await saveAssets(env, org.org_id, job.id, result.data || {});
    return { job, assets };
  }

  const assets = await db(env, `media_assets?job_id=eq.${encodeURIComponent(job.id)}&order=created_at.asc&select=*`);
  return { job, assets: assets || [] };
}
