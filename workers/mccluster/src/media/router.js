import { collectAssetCandidates, normalizeFalStatus, resultFal, statusFal, submitFal, verifyFalWebhook } from './fal.js';
import { estimateModelCost } from './pricing.js';

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

async function rpc(env, name, payload) {
  return db(env, `rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
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

async function jobByProviderRequestId(env, requestId) {
  const rows = await db(env, `media_jobs?provider=eq.fal&provider_request_id=eq.${encodeURIComponent(requestId)}&select=*&limit=1`);
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

async function releaseReservation(env, jobId, reason) {
  return rpc(env, 'media_release_cost_reservation', {
    p_job_id: jobId,
    p_reason: reason || null
  });
}

async function saveAssets(env, orgId, jobId, result) {
  const candidates = collectAssetCandidates(result);
  const unique = [...new Map(candidates.map((a) => [a.url, a])).values()];
  if (!unique.length) return [];

  const existing = await db(env, `media_assets?job_id=eq.${encodeURIComponent(jobId)}&select=url`);
  const existingUrls = new Set((existing || []).map((asset) => asset.url));
  const body = unique
    .filter((asset) => !existingUrls.has(asset.url))
    .map((asset) => ({ ...asset, org_id: orgId, job_id: jobId }));
  if (!body.length) return [];

  return db(env, 'media_assets', {
    method: 'POST',
    headers: { prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
}

function budgetCents(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw Object.assign(new Error('budget_cents must be a non-negative number'), { status: 400 });
  }
  return Math.floor(parsed);
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

  const budget = budgetCents(body.budget_cents);
  const estimate = estimateModelCost(model, input);
  if (budget !== null && !estimate.available) {
    throw Object.assign(new Error('This model cannot be safely preflighted against a budget yet'), {
      status: 422,
      detail: { model_id: model.id, provider_model_id: model.provider_model_id, reason: estimate.reason }
    });
  }
  if (budget !== null && estimate.estimated_cost_cents > budget) {
    throw Object.assign(new Error('Estimated media cost exceeds budget'), {
      status: 422,
      detail: {
        model_id: model.id,
        estimated_cost_cents: estimate.estimated_cost_cents,
        budget_cents: budget
      }
    });
  }

  const created = await rpc(env, 'media_create_budgeted_job', {
    p_org_id: org.org_id,
    p_created_by: user.id,
    p_provider: model.provider,
    p_provider_model_id: model.provider_model_id,
    p_capability: model.capability,
    p_prompt: body.prompt || input.prompt || null,
    p_input: input,
    p_routing: {
      requested_model_id: model.id,
      requested_by: user.id,
      strategy: body.strategy || 'explicit-model',
      estimate_available: Boolean(estimate.available),
      estimate_reason: estimate.available ? null : estimate.reason,
      estimated_cost_cents_exact: estimate.available ? estimate.estimated_cost_cents_exact : null
    },
    p_estimated_cost_cents: estimate.available ? estimate.estimated_cost_cents : null,
    p_budget_cents: budget,
    p_pricing_snapshot: estimate.pricing_snapshot || model.cost_hint || {}
  });
  const job = Array.isArray(created) ? created[0] : created;
  if (!job?.id) throw Object.assign(new Error('Media job creation did not return a job'), { status: 500 });

  try {
    const webhookUrl = `${new URL(request.url).origin}/v1/media/webhooks/fal`;
    const submitted = await submitFal(env, model.provider_model_id, input, { webhookUrl });
    return patchJob(env, job.id, {
      provider_request_id: submitted.request_id,
      submitted_at: new Date().toISOString(),
      provider_status: { ...submitted, delivery: 'webhook' },
      status: 'queued'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchJob(env, job.id, {
      status: 'failed',
      error: { message }
    }).catch(() => null);
    await releaseReservation(env, job.id, `provider submission failed: ${message}`).catch(() => null);
    throw error;
  }
}

export async function handleFalWebhook(request, env) {
  const webhook = await verifyFalWebhook(request);
  const providerRequestId = webhook?.request_id || webhook?.gateway_request_id;
  if (!providerRequestId) throw Object.assign(new Error('fal webhook is missing request_id'), { status: 400 });

  const job = await jobByProviderRequestId(env, providerRequestId);
  if (!job) return { accepted: true, matched: false, request_id: providerRequestId };

  const falStatus = String(webhook?.status || '').toUpperCase();
  if (falStatus === 'ERROR') {
    const failed = await patchJob(env, job.id, {
      status: 'failed',
      provider_status: webhook,
      error: {
        message: typeof webhook.error === 'string' ? webhook.error : 'fal generation failed',
        detail: webhook.payload || null
      }
    });
    return { accepted: true, matched: true, job_id: failed?.id || job.id, status: 'failed' };
  }

  if (falStatus !== 'OK') {
    throw Object.assign(new Error('Unsupported fal webhook status'), { status: 400, detail: { status: webhook?.status || null } });
  }

  const result = webhook.payload || {};
  const completed = await patchJob(env, job.id, {
    status: 'completed',
    result,
    completed_at: job.completed_at || new Date().toISOString(),
    provider_status: webhook,
    error: null
  });
  await saveAssets(env, job.org_id, job.id, result);

  return { accepted: true, matched: true, job_id: completed?.id || job.id, status: 'completed' };
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
