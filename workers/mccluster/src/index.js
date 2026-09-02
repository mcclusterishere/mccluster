import { corsHeaders, fail, logEvent, reply } from './lib/http.js';

export { HereTenantAgent } from './here-tenant-agent.js';

function configured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function sbHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function sb(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders(env) });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw Object.assign(new Error('McCluster database request failed'), { status: res.status, detail: data });
  return data;
}

async function authUser(req, env) {
  const authorization = req.headers.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization }
  });
  if (!res.ok) return null;
  return res.json();
}

async function appByKey(env, key) {
  const rows = await sb(env, `platform_apps?app_key=eq.${encodeURIComponent(key)}&enabled=eq.true&select=*`);
  return rows?.[0] || null;
}

async function feePolicy(env, appId, orgId) {
  const orgFilter = orgId ? `&org_id=eq.${encodeURIComponent(orgId)}` : '&org_id=is.null';
  let rows = await sb(env, `platform_fee_policies?app_id=eq.${encodeURIComponent(appId)}${orgFilter}&enabled=eq.true&order=effective_at.desc&limit=1&select=*`);
  if (!rows?.length && orgId) {
    rows = await sb(env, `platform_fee_policies?app_id=eq.${encodeURIComponent(appId)}&org_id=is.null&enabled=eq.true&order=effective_at.desc&limit=1&select=*`);
  }
  return rows?.[0] || null;
}

function pct(cents, bps) {
  return Math.round(Number(cents || 0) * Number(bps || 0) / 10000);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (path === '/health' && request.method === 'GET') {
        return reply(request, env, {
          ok: true,
          service: 'mccluster',
          supabase_project: env.MCCLUSTER_SUPABASE_PROJECT_REF || null,
          products: ['identity', 'apps', 'fees', 'payments', 'mobility'],
          canonical_identity: 'McCluster',
          durable_object: 'HereTenantAgent',
          durable_object_bound: Boolean(env.HereTenantAgent)
        });
      }

      if (path === '/internal/here-tenant-agent' && request.method === 'GET') {
        const id = env.HereTenantAgent.idFromName('health');
        const stub = env.HereTenantAgent.get(id);
        return stub.fetch(request);
      }

      if (!configured(env)) return fail(request, env, 'McCluster is not configured', 503);

      if (path === '/v1/me' && request.method === 'GET') {
        const user = await authUser(request, env);
        if (!user) return fail(request, env, 'Authentication required', 401);
        return reply(request, env, {
          user: { id: user.id, email: user.email, phone: user.phone, user_metadata: user.user_metadata || {} }
        });
      }

      if (path === '/v1/apps' && request.method === 'GET') {
        const rows = await sb(env, 'platform_apps?enabled=eq.true&order=product_family.asc,name.asc&select=app_key,name,product_family,kind,bundle_id,public_url,oauth_client_id,settings');
        return reply(request, env, { apps: rows || [] });
      }

      if (path === '/v1/fees/quote' && request.method === 'GET') {
        const appKey = url.searchParams.get('app_key');
        const baseCents = Math.max(0, Math.round(Number(url.searchParams.get('base_cents') || 0)));
        const whiteLabel = ['1', 'true', 'yes'].includes(String(url.searchParams.get('white_label') || '').toLowerCase());
        const orgId = url.searchParams.get('org_id') || null;
        if (!appKey || !baseCents) return fail(request, env, 'app_key and positive base_cents are required');
        const app = await appByKey(env, appKey);
        if (!app) return fail(request, env, 'Unknown McCluster application', 404);
        const policy = await feePolicy(env, app.id, orgId);
        if (!policy) return fail(request, env, 'No fee policy configured for this application', 404);
        const payerFee = pct(baseCents, policy.payer_fee_bps);
        const receiverBps = whiteLabel ? policy.white_label_payee_fee_bps : policy.payee_fee_bps;
        const receiverFee = pct(baseCents, receiverBps);
        return reply(request, env, {
          app: { key: app.app_key, name: app.name },
          policy: {
            key: policy.policy_key,
            currency: policy.currency,
            payer_fee_bps: policy.payer_fee_bps,
            payee_fee_bps: receiverBps,
            white_label: whiteLabel,
            white_label_subscription_cents: policy.white_label_subscription_cents
          },
          quote: {
            base_amount_cents: baseCents,
            payer_fee_cents: payerFee,
            payer_total_cents: baseCents + payerFee,
            payee_fee_cents: receiverFee,
            platform_revenue_before_processing_cents: payerFee + receiverFee,
            payee_economic_amount_cents: Math.max(0, baseCents - receiverFee)
          }
        });
      }

      if (path === '/api' || path.startsWith('/api/')) {
        return fail(request, env, 'Whip product routes belong on Worker mccluster. Put handlers in workers/mccluster/src/whip/.', 503);
      }

      return fail(request, env, 'Not found', 404);
    } catch (error) {
      logEvent('error', {
        path,
        method: request.method,
        message: error instanceof Error ? error.message : String(error),
        status: error.status || 500
      });
      return fail(request, env, error.message || 'McCluster request failed', error.status || 500, error.detail);
    }
  }
};
