import existing from './entry.js';
import { build } from '../.wrangler/build-provenance.mjs';
import { handlePlatformApi } from './platform-api-metered.js';
import { publishDueNetworkPosts, reapStaleLiveSessions, pruneNetworkRateEvents } from './platform-api.js';
import { handlePlatformPlanApi } from './platform-api-plans.js';
import { handleComputeApi } from './compute-api.js';
import { enforceApiRateLimit } from './api-rate-limit.js';
import { fail, reply } from './lib/http.js';
import { observeScheduled } from './lib/observability.js';
import { ingestGdeltNews } from './world-news.js';
import { companySiteResponse } from './company-site/router.js';
import { humanUpriseResponse } from './human-uprise/router.js';
import { handleAuthHandoff } from './auth-handoff.js';
import { preflightResponse } from './preflight.js';
import { handleCreatorCheckout } from './creator-billing.js';
import { handleActionConnect } from './action-connect.js';
import { handleCreatorBillingWebhook } from './creator-billing-webhook.js';
import { handleCreatorEntitlement } from './creator-entitlement.js';
import { handleCreatorPublish } from './creator-site-publish.js';
import { handleCreatorSiteView } from './creator-site-view.js';
import { handleLiveMissions, runLiveMaintenance } from './live/index.js';
import { handleIdentity } from './identity/router.js';

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
    /* McCluster Corp's property (mccluster.org, www.mccluster.org): the World
       at its root, the company page at /company. Null for every other host,
       so the API below is untouched. Inert until the owner routes the apex
       to this Worker: docs/control-plane/DOMAINS-AND-ENTITIES.md */
    const company = await companySiteResponse(request, env);
    if (company) return company;
    /* Human Uprise's own door (humanuprise.com, www): the World by host, the
       same way. Null for every other host; inert until the owner routes it:
       docs/action-network/EQUITY-UPRISE-PUBLIC-GLOBE-ENTRY.md */
    const humanUprise = await humanUpriseResponse(request, env);
    if (humanUprise) return humanUprise;
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/v1/health')) {
        return healthResponse(request, env);
      }
      /* a browser's preflight for a member route is answered before any sign-in gate (./preflight.js);
         without this, every signed-in member's World call was refused by the browser */
      const preflight = preflightResponse(request, env);
      if (preflight) return preflight;

      const billingWebhook = await handleCreatorBillingWebhook(request, env);
      if (billingWebhook) return billingWebhook;
      /* live missions (./live/index.js): flagged off with LIVE_MISSIONS_ENABLED;
         its Cloudflare webhooks authenticate themselves, so it sits before the key gate */
      const live = await handleLiveMissions(request, env);
      if (live) return live;
      /* identity verification levels: the Persona ID check (flagged off by
         PERSONA_ENABLED) and the entitlement answer Halo reads
         (./identity/router.js, docs/control-plane/IDENTITY-VERIFICATION-LEVELS.md) */
      const identity = await handleIdentity(request, env);
      if (identity) return identity;
      const rateLimitResponse = await enforceApiRateLimit(request, env);
      if (rateLimitResponse) return rateLimitResponse;
      /* one M Account, every host: the sign-in handoff (auth-handoff.js) */
      const handoff = await handleAuthHandoff(request, env);
      if (handoff) return handoff;

      const creatorSiteView = await handleCreatorSiteView(request, env);
      if (creatorSiteView) return creatorSiteView;
      const creatorPublish = await handleCreatorPublish(request, env);
      if (creatorPublish) return creatorPublish;
      const creatorEntitlement = await handleCreatorEntitlement(request, env);
      if (creatorEntitlement) return creatorEntitlement;
      const actionConnect = await handleActionConnect(request, env);
      if (actionConnect) return actionConnect;
      const creatorCheckout = await handleCreatorCheckout(request, env);
      if (creatorCheckout) return creatorCheckout;
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
    /* Scheduled Human Uprise posts ride the same five-minute cron as the
       social queue. A failure here is logged and never stops the rest. */
    ctx.waitUntil(publishDueNetworkPosts(env, { limit: 20 }).catch((error) => {
      console.error(JSON.stringify({ event: 'mnet_scheduled_publish_failed', message: error instanceof Error ? error.message : String(error) }));
    }));
    ctx.waitUntil(reapStaleLiveSessions(env, { limit: 20 }).catch((error) => {
      console.error(JSON.stringify({ event: 'mnet_live_reap_failed', message: error instanceof Error ? error.message : String(error) }));
    }));
    ctx.waitUntil(runLiveMaintenance(env).catch((error) => {
      console.error(JSON.stringify({ event: 'live_missions_maintenance_failed', message: error instanceof Error ? error.message : String(error) }));
    }));
    ctx.waitUntil(pruneNetworkRateEvents(env).catch((error) => {
      console.error(JSON.stringify({ event: 'mnet_rate_prune_failed', message: error instanceof Error ? error.message : String(error) }));
    }));
    /* the World's news: GDELT's newest 15-minute file, read once, kept a week; off until
       WORLD_NEWS_INGEST_ENABLED is "true" (./world-news.js) */
    ctx.waitUntil(observeScheduled(env, ctx, 'world.news_ingest', () => ingestGdeltNews(env, { scheduledTime: controller?.scheduledTime })).then((report) => {
      if (report && report.skipped === 'disabled') return;
      if (report && (report.files?.length || report.error || report.skipped || report.pruned !== null || report.prune_error)) {
        const failed = report.error || report.prune_error || report.files?.some((f) => !f.ingested);
        (failed ? console.error : console.log)(JSON.stringify({ event: 'world_news_ingest', ...report }));
      }
    }).catch((error) => {
      console.error(JSON.stringify({ event: 'world_news_ingest_failed', message: error instanceof Error ? error.message : String(error) }));
    }));
    if (existing.scheduled) return existing.scheduled(controller, env, ctx);
  }
};
