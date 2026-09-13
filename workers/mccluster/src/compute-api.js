import { fail, reply } from './lib/http.js';

const encoder = new TextEncoder();

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    ...extra,
  };
}

async function service(env, path, init = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: serviceHeaders(env, init.headers || {}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw Object.assign(new Error(data?.message || data?.error || 'Database request failed'), { status: res.status, detail: data });
  return data;
}

async function rpc(env, name, body = {}) {
  return service(env, `rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function apiKeyPrincipal(request, env) {
  const auth = request.headers.get('authorization') || '';
  const raw = auth.toLowerCase().startsWith('bearer mcc_') ? auth.slice(7).trim() : '';
  if (!raw) return null;
  const prefix = raw.slice(0, 16);
  const hash = await sha256(raw);
  const keys = await service(env, `api_keys?key_prefix=eq.${encodeURIComponent(prefix)}&secret_hash=eq.${hash}&status=eq.active&select=id,consumer_id,scopes,expires_at&limit=1`);
  const key = keys?.[0];
  if (!key) return null;
  if (key.expires_at && Date.parse(key.expires_at) < Date.now()) return null;
  const consumers = await service(env, `api_consumers?id=eq.${key.consumer_id}&status=eq.active&select=id,name,plan_code,hard_spend_limit_cents,settings&limit=1`);
  const consumer = consumers?.[0];
  if (!consumer) return null;
  return { key, consumer };
}

function hasScope(principal, scope) {
  return !!principal?.key?.scopes?.some((s) => s === '*' || s === scope || s === `${scope.split(':')[0]}:*` || s === 'compute:*');
}

function requestId(request) {
  return request.headers.get('idempotency-key') || request.headers.get('x-request-id') || crypto.randomUUID();
}

async function bodyJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function routeFor(env, principal, id, input) {
  const selected = await rpc(env, 'compute_select_route', {
    p_request_id: id,
    p_consumer_id: principal.consumer.id,
    p_capability: input.capability,
    p_input_units: numberOr(input.input_units),
    p_output_units: numberOr(input.output_units),
    p_quantity: Math.max(0, numberOr(input.quantity, 1)),
    p_max_cost_microusd: input.max_cost_microusd ?? null,
    p_max_latency_ms: input.max_latency_ms ?? null,
    p_min_quality: Math.max(0, Math.min(100, numberOr(input.min_quality, 0))),
    p_data_policy: input.data_policy ?? null,
  });
  return selected?.[0] || null;
}

async function reserve(env, principal, id, input, route) {
  const result = await rpc(env, 'compute_reserve_credits', {
    p_request_id: id,
    p_consumer_id: principal.consumer.id,
    p_api_key_id: principal.key.id,
    p_task: input.task || input.capability,
    p_capability: input.capability,
    p_estimated_upstream_cost_microusd: route.estimated_upstream_microusd,
    p_target_margin_bps: route.target_margin_bps,
    p_source_app_id: input.source_app_id ?? null,
    p_m_uid: null,
    p_metadata: {
      route: route.model_key,
      provider: route.provider_key,
      max_cost_microusd: input.max_cost_microusd ?? null,
      max_latency_ms: input.max_latency_ms ?? null,
      data_policy: input.data_policy ?? null,
    },
  });
  return result?.[0] || null;
}

async function settle(env, id, status, route, usage = {}) {
  const result = await rpc(env, 'compute_settle_request', {
    p_request_id: id,
    p_status: status,
    p_provider_key: route?.provider_key ?? null,
    p_model_id: route?.model_id ?? null,
    p_input_units: numberOr(usage.input_units),
    p_output_units: numberOr(usage.output_units),
    p_actual_upstream_cost_microusd: Math.max(0, Math.round(numberOr(usage.actual_upstream_cost_microusd))),
    p_target_margin_bps: route?.target_margin_bps ?? 2500,
    p_latency_ms: usage.latency_ms ?? null,
    p_cached: !!usage.cached,
    p_retry_count: Math.max(0, Math.round(numberOr(usage.retry_count))),
    p_response_metadata: usage.response_metadata || {},
    p_error_code: usage.error_code ?? null,
    p_error_detail: usage.error_detail ?? null,
  });
  return result?.[0] || null;
}

async function executeConfiguredProvider(env, route, input) {
  // Provider execution is intentionally adapter-gated. A route is only executable
  // when it has a verified price, is enabled, and the corresponding secret exists.
  // This initial gateway supports OpenAI-compatible HTTP providers. Additional
  // media/3D/GPU adapters plug into the same reservation/settlement contract.
  const modelRows = await service(env, `compute_models?id=eq.${route.model_id}&select=id,provider_key,model_key,billing_unit,metadata&limit=1`);
  const model = modelRows?.[0];
  if (!model) throw Object.assign(new Error('Selected model is unavailable'), { status: 503 });

  const providerRows = await service(env, `compute_providers?provider_key=eq.${encodeURIComponent(route.provider_key)}&select=provider_key,base_url,status,reseller_status,metadata&limit=1`);
  const provider = providerRows?.[0];
  if (!provider || provider.status !== 'available') throw Object.assign(new Error('Provider route is not available'), { status: 503 });
  if (provider.reseller_status === 'byok_only') {
    throw Object.assign(new Error('Customer BYOK credential required; McCluster platform credentials may not be used for this provider'), { status: 503 });
  }
  if (provider.reseller_status !== 'allowed') throw Object.assign(new Error('Provider is not cleared for commercial execution'), { status: 503 });

  const secretMap = {
    openai: env.OPENAI_API_KEY,
    fireworks: env.FIREWORKS_API_KEY,
    together: env.TOGETHER_API_KEY,
  };
  const token = secretMap[provider.provider_key];
  if (!token) throw Object.assign(new Error('Provider credential is not configured'), { status: 503 });
  if (!provider.base_url) throw Object.assign(new Error('Provider base URL is not configured'), { status: 503 });

  const started = Date.now();
  const upstream = await fetch(`${provider.base_url.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model.model_key,
      messages: input.messages || [{ role: 'user', content: String(input.prompt || '') }],
      temperature: input.temperature,
      max_tokens: input.max_output_tokens,
      stream: false,
    }),
  });
  const text = await upstream.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  if (!upstream.ok) throw Object.assign(new Error(payload?.error?.message || payload?.message || 'Upstream provider failed'), { status: 502, upstream: payload });

  const usage = payload?.usage || {};
  return {
    payload,
    input_units: usage.prompt_tokens || usage.input_tokens || 0,
    output_units: usage.completion_tokens || usage.output_tokens || 0,
    latency_ms: Date.now() - started,
    // For safety, exact provider COGS must come from normalized provider accounting.
    // Until an adapter can calculate exact actual cost, settlement uses the selected
    // route estimate and records that fact in response metadata.
    actual_upstream_cost_microusd: route.estimated_upstream_cost_microusd,
    response_metadata: { cost_basis: 'route_estimate_pending_provider_reconciliation' },
  };
}

export async function handleComputeApi(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/v1/compute') && !path.startsWith('/v1/ai/route')) return null;

  const principal = await apiKeyPrincipal(request, env);
  if (!principal) return fail(request, env, 'Valid McCluster API key required', 401);
  if (!hasScope(principal, 'compute:read') && !hasScope(principal, 'compute:write')) return fail(request, env, 'API key lacks compute scope', 403);

  if (path === '/v1/compute/catalog' && request.method === 'GET') {
    const providers = await service(env, 'compute_providers?select=provider_key,name,provider_type,status,reseller_status,supports_byok&order=name.asc');
    const models = await service(env, 'compute_models?enabled=eq.true&select=id,provider_key,model_key,display_name,capability,billing_unit,quality_tier,latency_tier,price_verified_at&order=capability.asc,display_name.asc');
    return reply(request, env, { credit_value: '1000 credits = $1.00 list value', providers, models });
  }

  if (path === '/v1/compute/balance' && request.method === 'GET') {
    const rows = await rpc(env, 'api_credit_balance', { p_consumer: principal.consumer.id });
    return reply(request, env, { consumer_id: principal.consumer.id, credits: Number(rows ?? 0) });
  }

  if (path === '/v1/compute/estimate' && request.method === 'POST') {
    if (!hasScope(principal, 'compute:read')) return fail(request, env, 'API key lacks compute:read', 403);
    const input = await bodyJson(request);
    if (!input.capability) return fail(request, env, 'capability is required', 400);
    const id = requestId(request);
    const route = await routeFor(env, principal, id, input);
    if (!route) return fail(request, env, 'No eligible route', 503);
    return reply(request, env, { request_id: id, route, credit_value: '1000 credits = $1.00 list value' });
  }

  if ((path === '/v1/compute/run' || path === '/v1/ai/route') && request.method === 'POST') {
    if (!hasScope(principal, 'compute:write')) return fail(request, env, 'API key lacks compute:write', 403);
    const input = await bodyJson(request);
    if (!input.capability) return fail(request, env, 'capability is required', 400);
    const id = requestId(request);
    const route = await routeFor(env, principal, id, input);
    if (!route) return fail(request, env, 'No eligible route', 503);
    const reservation = await reserve(env, principal, id, input, route);

    if (input.dry_run === true) {
      const settlement = await settle(env, id, 'cancelled', route, { response_metadata: { dry_run: true } });
      return reply(request, env, { request_id: id, dry_run: true, route, reservation, settlement });
    }

    try {
      const result = await executeConfiguredProvider(env, route, input);
      const settlement = await settle(env, id, 'succeeded', route, result);
      return reply(request, env, {
        request_id: id,
        provider: route.provider_key,
        model: route.model_key,
        credits_charged: settlement?.charged_credits ?? null,
        gross_margin_bps: settlement?.gross_margin_bps ?? null,
        latency_ms: result.latency_ms,
        output: result.payload,
      });
    } catch (error) {
      await settle(env, id, 'failed', route, {
        error_code: 'upstream_failed',
        error_detail: error.upstream || { message: error.message },
      }).catch(() => {});
      throw error;
    }
  }

  const reqMatch = path.match(/^\/v1\/compute\/requests\/([^/]+)$/);
  if (reqMatch && request.method === 'GET') {
    if (!hasScope(principal, 'compute:read')) return fail(request, env, 'API key lacks compute:read', 403);
    const id = encodeURIComponent(reqMatch[1]);
    const rows = await service(env, `compute_requests?request_id=eq.${id}&consumer_id=eq.${principal.consumer.id}&select=request_id,task,capability,provider_key,model_id,status,input_units,output_units,estimated_upstream_cost_microusd,actual_upstream_cost_microusd,retail_cost_microusd,credits_reserved,credits_charged,retry_count,latency_ms,cached,error_code,created_at,completed_at&limit=1`);
    if (!rows?.length) return fail(request, env, 'Compute request not found', 404);
    return reply(request, env, { request: rows[0] });
  }

  return null;
}
