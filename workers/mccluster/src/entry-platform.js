import existing from './entry.js';
import { build } from '../.wrangler/build-provenance.mjs';
import { handlePlatformApi } from './platform-api-metered.js';
import { handlePlatformPlanApi } from './platform-api-plans.js';
import { handleComputeApi } from './compute-api.js';
import { enforceApiRateLimit } from './api-rate-limit.js';
import { fail, reply } from './lib/http.js';

export { HereTenantAgent } from './here-tenant-agent.js';

function healthResponse(request, env) {
  return reply(request, env, {
    ok: true,
    service: 'mccluster',
    worker: 'mccluster',
    deployment_sha: build.dirty ? 'unknown' : build.sha,
    deployment_ref: env.DEPLOY_REF || build.ref,
    supabase_project_ref: env.MCCLUSTER_SUPABASE_PROJECT_REF || null,
    capabilities: {
      platform_api: true,
      compute_gateway: true,
      api_rate_limit: true,
      atomic_metering: true,
      provider_cogs_reconciliation: true,
      byok_fail_closed: true,
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
