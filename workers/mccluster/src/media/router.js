import { currentTrace, recordEvent } from '../lib/observability.js';
import { billingEventsFal, classifySubmitError, collectAssetCandidates, normalizeFalStatus, resultFal, statusFal, submitFal, verifyFalWebhook } from './fal.js';
import { estimateModelCost } from './pricing.js';
import { requireOrgId } from '../social/security.js';
import { requireCapability } from '../lib/capabilities.js';
import { validateModelInput } from './input-contract.js';
import { recordAudit } from '../lib/audit.js';

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

export async function modelById(env, id) {
  const rows = await db(env, `media_models?id=eq.${encodeURIComponent(id)}&enabled=eq.true&select=*`);
  return rows?.[0] || null;
}

async function jobById(env, id, orgId) {
  const rows = await db(env, `media_jobs?id=eq.${encodeURIComponent(id)}&org_id=eq.${encodeURIComponent(orgId)}&select=*`);
  return rows?.[0] || null;
}

/* Idempotent paid work (audit C5): a stable operation id makes a repeated
   request resolve to the one job it already made instead of a second
   reservation and provider submission. The decision is an ATOMIC CLAIM in
   public.media_operation_claims (pending media_operation_claims_v1.sql): the
   first caller to insert (org_id, operation_id) wins the right to reserve
   budget and submit; it binds the job id to the claim; every other caller,
   whatever isolate or retry it came from, gets that job back. A reused id
   with a different request body is refused (fingerprint mismatch). The old
   check-then-create lookup is kept only as the loser's readback. Core MCP
   calls carry a stable id from Core (core/src/tools/mcp-http.mjs); API callers
   may send their own. Without an id the request is a deliberate one-off. */
const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export function operationIdFrom(body) {
  const raw = body?.operation_id;
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !OPERATION_ID.test(raw)) {
    throw Object.assign(new Error('operation_id must be 1-128 characters of letters, digits, ".", "_", ":" or "-"'), { status: 400 });
  }
  return raw;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/* What the operation id is bound to: the org, the resolved model, the exact
   provider input, the budget and the strategy. Key order never matters. */
export async function operationFingerprint(body, model) {
  const input = { ...(body?.input || {}) };
  if (body?.prompt && !input.prompt) input.prompt = body.prompt;
  const text = canonicalJson({
    org_id: body?.org_id || null,
    model_id: model?.id || body?.model_id || null,
    provider_model_id: model?.provider_model_id || null,
    input,
    budget_cents: body?.budget_cents ?? null,
    strategy: body?.strategy || 'explicit-model'
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function jobByOperationId(env, orgId, operationId) {
  const rows = await db(env, `media_jobs?org_id=eq.${encodeURIComponent(orgId)}&routing->>operation_id=eq.${encodeURIComponent(operationId)}&select=*&order=created_at.asc&limit=1`);
  return rows?.[0] || null;
}

/* Org-checked readback of the job bound to an operation id (the loser's and
   the reconciler's handle). Membership is required; null when nothing is bound. */
export async function jobForOperation(request, env, user) {
  let body;
  try { body = await request.json(); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  const org = await getOrg(env, user.id, body.org_id);
  const operationId = operationIdFrom(body);
  if (!operationId) throw Object.assign(new Error('operation_id is required'), { status: 400 });
  return jobByOperationId(env, org.org_id, operationId);
}

function claimError(status, message, reason, detail) {
  return Object.assign(new Error(message), { status, reason, detail });
}

/* Winner/loser protocol. Returns { won: true } for the winner, otherwise the
   durable outcome: the bound job, the recorded definite failure, or a
   'pending' refusal when the winner has not bound a job yet (read back with
   the same operation id; the id never changes hands). Fails closed when the
   claim RPC cannot be consulted. */
async function claimOperation(env, { orgId, operationId, fingerprint, actorId, operationType }) {
  let claim;
  try {
    claim = await rpc(env, 'media_claim_operation_v1', {
      p_org_id: orgId, p_operation_id: operationId, p_fingerprint: fingerprint, p_actor_id: actorId, p_operation_type: operationType
    });
  } catch (error) {
    if (/operation_payload_mismatch/.test(String(error?.detail?.message || error?.message))) {
      throw claimError(409, 'operation_id was already used with a different request', 'operation_payload_mismatch', { operation_id: operationId });
    }
    throw claimError(503, 'Paid operation claims are unavailable; nothing was reserved', 'operation_claims_unavailable', { operation_id: operationId });
  }
  const outcome = Array.isArray(claim) ? claim[0] : claim;
  if (outcome?.outcome === 'won') return { won: true };
  const row = outcome?.claim;
  if (!row) throw claimError(503, 'Paid operation claim returned no decision; nothing was reserved', 'operation_claims_unavailable', { operation_id: operationId });
  if (row.state === 'failed') {
    const message = row.failure?.message || 'The operation already failed';
    throw claimError(409, message, 'operation_failed', { operation_id: operationId, failure: row.failure || null });
  }
  if (row.job_id) {
    const job = await jobById(env, row.job_id, orgId) || await jobByOperationId(env, orgId, operationId);
    if (job) return { won: false, job };
  }
  /* claimed but not bound yet: the winner is mid-flight */
  const job = await jobByOperationId(env, orgId, operationId);
  if (job) return { won: false, job };
  throw claimError(409, 'This operation is already in progress; read it back by operation_id', 'operation_pending', { operation_id: operationId, claimed_at: row.claimed_at || null });
}

async function bindOperation(env, orgId, operationId, jobId) {
  return rpc(env, 'media_bind_operation_v1', { p_org_id: orgId, p_operation_id: operationId, p_job_id: jobId });
}

async function failOperation(env, orgId, operationId, failure) {
  return rpc(env, 'media_fail_operation_v1', { p_org_id: orgId, p_operation_id: operationId, p_failure: failure }).catch(() => null);
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

/* Media spend, aggregated from the media_cost_events ledger.

   Every other control on spend is per job, so nothing could answer "how much
   of the funded provider balance is gone". Membership is enough to read it —
   this exposes no prompt, asset or model input, only amounts the ledger
   already settled or reserved. */
export async function getUsage(request, env, user) {
  const url = new URL(request.url);
  const org = await getOrg(env, user.id, url.searchParams.get('org_id'));

  const groupBy = (url.searchParams.get('group_by') || 'day').toLowerCase();
  if (!['day', 'provider', 'capability', 'model'].includes(groupBy)) {
    throw Object.assign(new Error('group_by must be day, provider, capability, or model'), { status: 400 });
  }

  const parseWhen = (name) => {
    const raw = url.searchParams.get(name);
    if (!raw) return null;
    const when = new Date(raw);
    if (Number.isNaN(when.getTime())) throw Object.assign(new Error(`${name} must be a timestamp`), { status: 400 });
    return when.toISOString();
  };

  const rollup = await rpc(env, 'media_usage_rollup', {
    p_org_id: org.org_id,
    p_from: parseWhen('from'),
    p_to: parseWhen('to'),
    p_group_by: groupBy
  });
  /* PostgREST returns a scalar function result directly or wrapped in a
     single-element array depending on the call shape. */
  return Array.isArray(rollup) ? rollup[0] : rollup;
}

export async function getMediaBudget(request, env, user) {
  const url = new URL(request.url);
  const org = await getOrg(env, user.id, url.searchParams.get('org_id'));
  if (org.role !== 'owner') {
    throw Object.assign(new Error('Organization owner access is required to manage the media allowance'), { status: 403 });
  }
  const rows = await db(
    env,
    `org_media_budgets?org_id=eq.${encodeURIComponent(org.org_id)}&select=org_id,enabled,monthly_limit_cents,warn_at_percent,updated_by,created_at,updated_at&limit=1`
  );
  const budget = rows?.[0] || {
    org_id: org.org_id,
    enabled: false,
    monthly_limit_cents: null,
    warn_at_percent: 80,
    updated_by: null,
    created_at: null,
    updated_at: null
  };
  return { budget };
}

export async function updateMediaBudget(request, env, user) {
  const url = new URL(request.url);
  const org = await getOrg(env, user.id, url.searchParams.get('org_id'));
  if (org.role !== 'owner') {
    throw Object.assign(new Error('Organization owner access is required to manage the media allowance'), { status: 403 });
  }

  let body;
  try { body = await request.json(); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }

  if (typeof body.enabled !== 'boolean') {
    throw Object.assign(new Error('enabled must be true or false'), { status: 400 });
  }

  let monthlyLimit = body.monthly_limit_cents;
  if (monthlyLimit === '' || monthlyLimit === undefined) monthlyLimit = null;
  if (monthlyLimit !== null) {
    monthlyLimit = Number(monthlyLimit);
    if (!Number.isSafeInteger(monthlyLimit) || monthlyLimit < 0) {
      throw Object.assign(new Error('monthly_limit_cents must be a non-negative integer or null'), { status: 400 });
    }
  }
  if (body.enabled && monthlyLimit === null) {
    throw Object.assign(new Error('A monthly limit is required when the media allowance is enabled'), { status: 400 });
  }

  const warnAt = body.warn_at_percent === undefined ? 80 : Number(body.warn_at_percent);
  if (!Number.isInteger(warnAt) || warnAt < 1 || warnAt > 100) {
    throw Object.assign(new Error('warn_at_percent must be an integer from 1 to 100'), { status: 400 });
  }

  const rows = await db(env, 'org_media_budgets?on_conflict=org_id&select=org_id,enabled,monthly_limit_cents,warn_at_percent,updated_by,created_at,updated_at', {
    method: 'POST',
    headers: { prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({
      org_id: org.org_id,
      enabled: body.enabled,
      monthly_limit_cents: monthlyLimit,
      warn_at_percent: warnAt,
      updated_by: user.id,
      updated_at: new Date().toISOString()
    })
  });
  const budget = rows?.[0];
  if (!budget) throw Object.assign(new Error('Media allowance update did not return a record'), { status: 502 });

  const audit = await recordAudit(env, {
    orgId: org.org_id,
    actorUserId: user.id,
    actorKind: 'user',
    event: 'media_budget.updated',
    capability: 'media.budget.manage',
    resourceType: 'org_media_budget',
    resourceId: org.org_id,
    detail: {
      enabled: budget.enabled,
      monthly_limit_cents: budget.monthly_limit_cents,
      warn_at_percent: budget.warn_at_percent
    }
  });

  return { budget, audit };
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

export async function createGeneration(request, env, user, deps = {}) {
  const submit = typeof deps.submit === 'function' ? deps.submit : submitFal;
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

  const operationId = operationIdFrom(body);
  const input = { ...(body.input || {}) };
  if (body.prompt && !input.prompt) input.prompt = body.prompt;
  if (!Object.keys(input).length) throw Object.assign(new Error('input or prompt is required'), { status: 400 });
  validateModelInput(model, input);

  let claimed = false;
  if (operationId) {
    /* Both callers of a duplicated operation get the same durable outcome,
       whatever state it reached (queued, reconciling, failed, completed).
       Exactly one of them reserves and submits. */
    const fingerprint = await operationFingerprint(body, model);
    const decision = await claimOperation(env, {
      orgId: org.org_id, operationId, fingerprint, actorId: user.id, operationType: body.strategy ? `media.generate:${body.strategy}` : 'media.generate'
    });
    if (!decision.won) return decision.job;
    claimed = true;
  }
  /* Definite failures before a reservation exists are recorded on the claim
     so a loser reads the same refusal instead of reserving. */
  const definiteBeforeReserve = async (error) => {
    if (claimed) await failOperation(env, org.org_id, operationId, { message: error?.message || String(error), status: error?.status || null, stage: 'preflight' });
    throw error;
  };

  const budget = budgetCents(body.budget_cents);
  const budgetUsdMicros = budget === null ? null : budget * 10_000;
  const estimate = estimateModelCost(model, input);
  if (budget !== null && !estimate.available) {
    await definiteBeforeReserve(Object.assign(new Error('This model cannot be safely preflighted against a budget yet'), {
      status: 422,
      detail: { model_id: model.id, provider_model_id: model.provider_model_id, reason: estimate.reason }
    }));
  }
  if (budgetUsdMicros !== null && estimate.estimated_cost_usd_micros > budgetUsdMicros) {
    await definiteBeforeReserve(Object.assign(new Error('Estimated media cost exceeds budget'), {
      status: 422,
      detail: {
        model_id: model.id,
        estimated_cost_cents: estimate.estimated_cost_cents,
        estimated_cost_usd_micros: estimate.estimated_cost_usd_micros,
        budget_cents: budget,
        budget_usd_micros: budgetUsdMicros
      }
    }));
  }

  const estimateData = estimatePayload(estimate);
  let created;
  try {
    created = await rpc(env, 'media_create_budgeted_job_v2', {
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
      operation_id: operationId,
      estimate_available: Boolean(estimate.available),
      estimate_reason: estimate.available ? null : estimate.reason,
      /* The provider webhook arrives later on its own request; it rejoins
         this trace through the job row. */
      trace_id: currentTrace()?.trace_id || null
    },
    p_estimated_cost_usd_micros: estimate.available ? estimate.estimated_cost_usd_micros : null,
    p_budget_cents: budget,
    p_pricing_snapshot: estimate.pricing_snapshot || model.cost_hint || {},
    p_estimate: estimateData
    });
  } catch (error) {
    /* The reservation RPC refused (budget, allowance, validation): nothing was
       reserved, so this is a definite failure of the operation. */
    const refusal = Object.assign(new Error(error?.detail?.message || error?.message || 'Media job reservation failed'), {
      status: error?.status === 400 ? 422 : (error?.status || 502), detail: error?.detail || null
    });
    await definiteBeforeReserve(refusal);
  }
  const job = Array.isArray(created) ? created[0] : created;
  if (!job?.id) throw Object.assign(new Error('Media job creation did not return a job'), { status: 500 });
  if (claimed) {
    /* Bind before submitting so a loser arriving now reads this job rather
       than 'pending'. If the bind cannot be recorded the reservation exists
       but no provider request has been sent: release and fail definitively. */
    try {
      await bindOperation(env, org.org_id, operationId, job.id);
    } catch (error) {
      await patchJob(env, job.id, { status: 'failed', error: { message: 'operation bind failed before submission', detail: error?.detail || null } }).catch(() => null);
      await releaseReservation(env, job.id, 'operation bind failed before submission').catch(() => null);
      throw claimError(503, 'Paid operation could not be bound; the reservation was released and nothing was submitted', 'operation_claims_unavailable', { operation_id: operationId, job_id: job.id });
    }
  }
  const spend = {
    model_id: model.id,
    provider_model_id: model.provider_model_id,
    capability: model.capability,
    estimated_cost_cents: estimate.available ? estimate.estimated_cost_cents : null,
    budget_cents: budget
  };
  recordEvent({
    orgId: org.org_id, name: 'media.generation.reserved', actorUserId: user.id,
    resourceType: 'media_job', resourceId: job.id,
    message: `Reserved ${model.capability} on ${model.provider_model_id}`,
    detail: spend
  });

  const submitStarted = Date.now();
  const attemptedAt = new Date().toISOString();
  let submitted;
  try {
    const webhookUrl = `${new URL(request.url).origin}/v1/media/webhooks/fal`;
    submitted = await submit(env, model.provider_model_id, input, { webhookUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const classification = classifySubmitError(error);
    if (classification === 'uncertain') {
      /* The bytes may have reached the provider (timeout, abort, network loss,
         5xx after send). The job may be running and will be billed. Keep the
         reservation, record the attempt as evidence and leave the job for
         reconciliation. Never resubmit automatically: a retry with the same
         operation id reads this job back; a deliberate new attempt needs a
         new operation id. */
      recordEvent({
        orgId: org.org_id, name: 'media.generation.submit_uncertain', kind: 'dependency', level: 'warn', outcome: 'error',
        actorUserId: user.id, resourceType: 'media_job', resourceId: job.id, durationMs: Date.now() - submitStarted,
        message: `fal submission outcome unknown; reservation kept for reconciliation: ${message.slice(0, 300)}`,
        detail: spend
      });
      await patchJob(env, job.id, {
        status: 'reconciling',
        error: { message, uncertain: true, stage: 'submit' },
        provider_status: { outcome: 'uncertain', attempted_at: attemptedAt, error: message.slice(0, 500), delivery: 'webhook' }
      }).catch(() => null);
      throw claimError(502, `Provider outcome is unknown; the reservation is kept for reconciliation: ${message}`, 'provider_outcome_uncertain', { job_id: job.id, operation_id: operationId });
    }
    recordEvent({
      orgId: org.org_id, name: 'media.generation.submit_failed', kind: 'dependency', level: 'error', outcome: 'error',
      actorUserId: user.id, resourceType: 'media_job', resourceId: job.id, durationMs: Date.now() - submitStarted,
      message: `fal submission failed; reservation released: ${message.slice(0, 300)}`,
      detail: spend
    });
    await patchJob(env, job.id, {
      status: 'failed',
      error: { message, stage: 'submit' }
    }).catch(() => null);
    await releaseReservation(env, job.id, `provider submission failed: ${message}`).catch(() => null);
    throw error;
  }
  recordEvent({
    orgId: org.org_id, name: 'media.generation.submitted', kind: 'dependency', actorUserId: user.id,
    resourceType: 'media_job', resourceId: job.id, durationMs: Date.now() - submitStarted,
    message: `Submitted to fal (${model.provider_model_id})`,
    detail: { ...spend, provider_request_id: submitted.request_id || null }
  });
  try {
    return await patchJob(env, job.id, {
      provider_request_id: submitted.request_id,
      submitted_at: new Date().toISOString(),
      provider_status: { ...submitted, delivery: 'webhook' },
      status: 'queued'
    });
  } catch (error) {
    /* The provider accepted; only our record failed. The reservation stays and
       the request id is the reconciliation handle. */
    const message = error instanceof Error ? error.message : String(error);
    recordEvent({
      orgId: org.org_id, name: 'media.generation.persist_failed', kind: 'dependency', level: 'error', outcome: 'error',
      actorUserId: user.id, resourceType: 'media_job', resourceId: job.id,
      message: `provider accepted ${submitted.request_id || '?'} but the job record could not be updated: ${message.slice(0, 300)}`,
      detail: { ...spend, provider_request_id: submitted.request_id || null }
    });
    await patchJob(env, job.id, {
      status: 'reconciling',
      provider_request_id: submitted.request_id,
      error: { message, uncertain: true, stage: 'persist' },
      provider_status: { ...submitted, outcome: 'accepted_unrecorded', delivery: 'webhook' }
    }).catch(() => null);
    throw claimError(502, 'Provider accepted the job but its record could not be saved; reservation kept', 'provider_accepted_persistence_failed', { job_id: job.id, provider_request_id: submitted.request_id || null, operation_id: operationId });
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
    recordEvent({
      orgId: job.org_id, name: 'media.generation.failed', kind: 'dependency', level: 'error', outcome: 'error',
      traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id,
      message: 'fal reported the generation failed; reservation released',
      detail: { provider_request_id: providerRequestId, provider_model_id: job.provider_model_id || null }
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
  recordEvent({
    orgId: job.org_id, name: 'media.generation.completed', kind: 'dependency',
    traceId: job.routing?.trace_id, resourceType: 'media_job', resourceId: job.id,
    durationMs: job.submitted_at ? Date.now() - Date.parse(job.submitted_at) : null,
    message: 'fal completed the generation',
    detail: { provider_request_id: providerRequestId, provider_model_id: job.provider_model_id || null }
  });
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
