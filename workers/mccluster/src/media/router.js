import { billingEventsFal, collectAssetCandidates, normalizeFalStatus, resultFal, statusFal, submitFal, verifyFalWebhook } from './fal.js';
import { estimateModelCost } from './pricing.js';
import { requireOrgId } from '../social/security.js';
import { requireCapability } from '../lib/capabilities.js';

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
  const orgId = requireOrgId(requestedOrgId);
  const rows = await db(env, `org_members?org_id=eq.${encodeURIComponent(orgId)}&profile_id=eq.${encodeURIComponent(userId)}&select=org_id,role&limit=1`);
  if (!rows?.length) throw Object.assign(new Error('You are not a member of that organization'), { status: 403 });
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

function estimatePayload(estimate) {
  if (!estimate?.available) return {};
  return {
    estimated_cost_cents: estimate.estimated_cost_cents,
    estimated_cost_cents_exact: estimate.estimated_cost_cents_exact,
    estimated_cost_usd_micros: estimate.estimated_cost_usd_micros,
    units: estimate.units ?? null,
    unit: estimate.unit ?? null,
    unit_price_cents: estimate.unit_price_cents ?? null,
    unit_price_usd_micros: estimate.unit_price_usd_micros ?? null,
    output_count: estimate.output_count ?? null,
    megapixels_per_output: estimate.megapixels_per_output ?? null,
    pricing_formula: estimate.pricing_formula ?? null
  };
}

function billingEventCostMicros(event) {
  const nano = Number(event?.cost_estimate_nano_usd);
  if (Number.isFinite(nano) && nano >= 0) return Math.ceil(nano / 1000);
  const total = Number(event?.cost_total);
  if (Number.isFinite(total) && total >= 0) return Math.ceil(total * 1_000_000);
  return null;
}

function billingEventUnitPriceMicros(event) {
  const price = Number(event?.unit_price);
  return Number.isFinite(price) && price >= 0 ? Math.ceil(price * 1_000_000) : null;
}

async function settleFalBillingEvent(env, job, event) {
  const actualCostMicros = billingEventCostMicros(event);
  if (actualCostMicros === null) return { settled: false, reason: 'billing_event_missing_cost' };

  const quantity = Number(event?.output_units);
  const estimate = job?.routing?.estimate || {};
  await rpc(env, 'media_record_actual_cost_v2', {
    p_job_id: job.id,
    p_actual_cost_usd_micros: actualCostMicros,
    p_quantity: Number.isFinite(quantity) ? quantity : null,
    p_unit: estimate.unit || null,
    p_unit_price_usd_micros: billingEventUnitPriceMicros(event),
    p_source: 'fal-billing-events',
    p_raw_provider_usage: event || {},
    p_occurred_at: event?.timestamp || null
  });

  return { settled: true, actual_cost_usd_micros: actualCostMicros };
}

async function reconcileFalJobs(env, jobs) {
  const candidates = (jobs || []).filter((job) => job?.provider === 'fal' && job?.provider_request_id && job?.actual_cost_cents === null);
  if (!candidates.length) return { configured: Boolean(env.FAL_ADMIN_KEY), checked: 0, settled: 0, pending: 0 };

  const billing = await billingEventsFal(env, candidates.map((job) => job.provider_request_id));
  if (!billing.available) {
    return {
      configured: Boolean(env.FAL_ADMIN_KEY),
      checked: candidates.length,
      settled: 0,
      pending: candidates.length,
      reason: billing.reason,
      retryable: Boolean(billing.retryable)
    };
  }

  const byRequestId = new Map((billing.events || []).map((event) => [String(event.request_id), event]));
  let settled = 0;
  let pending = 0;
  const failures = [];

  for (const job of candidates) {
    const event = byRequestId.get(String(job.provider_request_id));
    if (!event) {
      pending += 1;
      continue;
    }
    try {
      const result = await settleFalBillingEvent(env, job, event);
      if (result.settled) settled += 1;
      else pending += 1;
    } catch (error) {
      failures.push({ job_id: job.id, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    configured: true,
    checked: candidates.length,
    settled,
    pending: pending + failures.length,
    failures
  };
}

export async function reconcilePendingFalCosts(env, options = {}) {
  if (!env.FAL_ADMIN_KEY) return { configured: false, checked: 0, settled: 0, pending: 0, reason: 'fal_admin_key_not_configured' };
  const limit = Math.min(50, Math.max(1, Number(options.limit || 50)));
  const jobs = await db(env, `media_jobs?provider=eq.fal&status=eq.completed&actual_cost_cents=is.null&provider_request_id=not.is.null&order=completed_at.asc&limit=${limit}&select=*`);
  return reconcileFalJobs(env, jobs || []);
}

export async function reconcileFalJobCost(env, job) {
  const result = await reconcileFalJobs(env, [job]);
  return { ...result, settled_job: result.settled > 0 ? job.id : null };
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
  const org = await getOrg(env, user.id, body.org_id);
  // Membership is not permission. Generation calls fal.ai and spends real
  // money against the org's budget, so a viewer being in the org is not
  // enough — the grant matrix decides.
  await requireCapability(env, org, 'media.generate');
  if (!body.model_id) throw Object.assign(new Error('model_id is required'), { status: 400 });
  const model = await modelById(env, body.model_id);
  if (!model) throw Object.assign(new Error('Unknown or disabled media model'), { status: 404 });
  if (model.provider !== 'fal') throw Object.assign(new Error('Provider adapter not installed'), { status: 501 });

  const input = { ...(body.input || {}) };
  if (body.prompt && !input.prompt) input.prompt = body.prompt;
  if (!Object.keys(input).length) throw Object.assign(new Error('input or prompt is required'), { status: 400 });

  const budget = budgetCents(body.budget_cents);
  const budgetUsdMicros = budget === null ? null : budget * 10_000;
  const estimate = estimateModelCost(model, input);
  if (budget !== null && !estimate.available) {
    throw Object.assign(new Error('This model cannot be safely preflighted against a budget yet'), {
      status: 422,
      detail: { model_id: model.id, provider_model_id: model.provider_model_id, reason: estimate.reason }
    });
  }
  if (budgetUsdMicros !== null && estimate.estimated_cost_usd_micros > budgetUsdMicros) {
    throw Object.assign(new Error('Estimated media cost exceeds budget'), {
      status: 422,
      detail: {
        model_id: model.id,
        estimated_cost_cents: estimate.estimated_cost_cents,
        estimated_cost_usd_micros: estimate.estimated_cost_usd_micros,
        budget_cents: budget,
        budget_usd_micros: budgetUsdMicros
      }
    });
  }

  const estimateData = estimatePayload(estimate);
  const created = await rpc(env, 'media_create_budgeted_job_v2', {
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
      estimate_reason: estimate.available ? null : estimate.reason
    },
    p_estimated_cost_usd_micros: estimate.available ? estimate.estimated_cost_usd_micros : null,
    p_budget_cents: budget,
    p_pricing_snapshot: estimate.pricing_snapshot || model.cost_hint || {},
    p_estimate: estimateData
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
    await releaseReservation(env, job.id, 'fal generation did not produce a successful output').catch(() => null);
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
  const reconciliation = await reconcileFalJobCost(env, completed || job).catch((error) => ({
    configured: Boolean(env.FAL_ADMIN_KEY),
    settled: 0,
    pending: 1,
    reason: error instanceof Error ? error.message : String(error)
  }));

  return {
    accepted: true,
    matched: true,
    job_id: completed?.id || job.id,
    status: 'completed',
    cost_reconciliation: reconciliation
  };
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
    await saveAssets(env, org.org_id, job.id, result.data || {});
  }

  if (job.status === 'completed' && job.provider === 'fal' && job.provider_request_id && job.actual_cost_cents === null) {
    const reconciliation = await reconcileFalJobCost(env, job).catch(() => null);
    if (reconciliation?.settled) job = await jobById(env, job.id, org.org_id) || job;
  }

  const assets = await db(env, `media_assets?job_id=eq.${encodeURIComponent(job.id)}&order=created_at.asc&select=*`);
  return { job, assets: assets || [] };
}
