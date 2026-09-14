import existing from './entry.js';
import { handlePlatformApi } from './platform-api-metered.js';
import { handlePlatformPlanApi } from './platform-api-plans.js';
import { handleComputeApi } from './compute-api.js';
import { enforceApiRateLimit } from './api-rate-limit.js';
import { handleSignalRequest } from './signals/router.js';
import { fail, reply } from './lib/http.js';

export { HereTenantAgent } from './here-tenant-agent.js';

async function authUser(req, env) {
  const authorization = req.headers.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization }
  });
  if (!res.ok) return null;
  return res.json();
}

function healthResponse(request, env) {
  return reply(request, env, {
    ok: true,
    service: 'mccluster',
    worker: 'mccluster',
    deployment_sha: env.DEPLOY_SHA || 'unknown',
    deployment_ref: env.DEPLOY_REF || 'unknown',
    supabase_project_ref: env.MCCLUSTER_SUPABASE_PROJECT_REF || null,
    capabilities: {
      platform_api: true,
      compute_gateway: true,
      api_rate_limit: true,
      atomic_metering: true,
      provider_cogs_reconciliation: true,
      byok_fail_closed: true,
      universal_signal_ingress: true,
    },
    checked_at: new Date().toISOString(),
  });
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/v1/health')) {
        return healthResponse(request, env);
      }

      const rateLimitResponse = await enforceApiRateLimit(request, env);
      if (rateLimitResponse) return rateLimitResponse;

      if (url.pathname === '/v1/signals') {
        const user = await authUser(request, env);
        const signalResponse = await handleSignalRequest(request, env, user);
        if (signalResponse) return signalResponse;
      }

      const computeResponse = await handleComputeApi(request, env);
      if (computeResponse) return computeResponse;
      const planResponse = await handlePlatformPlanApi(request, env);
      if (planResponse) return planResponse;
      const response = await handlePlatformApi(request, env);
      if (response) return response;
    } catch (error) {
      return fail(request, env, error.message || 'Platform API request failed', error.status || 500, error.detail);
    }
    return existing.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (existing.scheduled) return existing.scheduled(controller, env, ctx);
  }
};
