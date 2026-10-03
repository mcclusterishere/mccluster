import existing from './entry.js';
import { build } from '../.wrangler/build-provenance.mjs';
import { handlePlatformApi } from './platform-api-metered.js';
import { publishDueNetworkPosts, reapStaleLiveSessions, pruneNetworkRateEvents } from './platform-api.js';
import { handlePlatformPlanApi } from './platform-api-plans.js';
import { handleComputeApi } from './compute-api.js';
import { enforceApiRateLimit } from './api-rate-limit.js';
import { fail, reply } from './lib/http.js';
import { companySiteResponse } from './company-site/router.js';

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
    /* McCluster Corp's property (mccluster.org, www.mccluster.org). Null for
       every other host, so the API below is untouched. Inert until the
       owner routes the apex to this Worker: docs/control-plane/DOMAINS-AND-ENTITIES.md */
    const company = companySiteResponse(request);
    if (company) return company;
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
    /* Scheduled Action Network posts ride the same five-minute cron as the
       social queue. A failure here is logged and never stops the rest. */
    ctx.waitUntil(publishDueNetworkPosts(env, { limit: 20 }).catch((error) => {
      console.error(JSON.stringify({ event: 'mnet_scheduled_publish_failed', message: error instanceof Error ? error.message : String(error) }));
    }));
    ctx.waitUntil(reapStaleLiveSessions(env, { limit: 20 }).catch((error) => {
      console.error(JSON.stringify({ event: 'mnet_live_reap_failed', message: error instanceof Error ? error.message : String(error) }));
    }));
    ctx.waitUntil(pruneNetworkRateEvents(env).catch((error) => {
      console.error(JSON.stringify({ event: 'mnet_rate_prune_failed', message: error instanceof Error ? error.message : String(error) }));
    }));
    if (existing.scheduled) return existing.scheduled(controller, env, ctx);
  }
};
