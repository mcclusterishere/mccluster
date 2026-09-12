import core from './index.js';
import { fail, logEvent, reply } from './lib/http.js';
import { handleClientRequest } from './client.js';
import clientConnect from './connect.js';
import { createGeneration, getGeneration, handleFalWebhook, listModels, reconcilePendingFalCosts } from './media/router.js';
import { createBakeoff } from './media/orchestrator.js';
import { recommendModels } from './media/recommend.js';
import { handleMediaMcp } from './media/mcp.js';
import { attachCompletedVariantAssets, handleSocialRequest } from './social/router.js';
import { processInstagramPublishQueue, syncInstagramInsights } from './social/meta.js';
import { handleMetaWebhook } from './social/webhook.js';
import { handleAiRequest } from './ai/router.js';
import { acceptFabricEvent, drainFabricOutbox, fabricStatus } from './fabric/router.js';

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

export { HereTenantAgent } from './here-tenant-agent.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/v1/fabric/events' && request.method === 'POST') {
      try {
        return await acceptFabricEvent(request, env);
      } catch (error) {
        return fail(request, env, error.message || 'Fabric event relay failed', error.status || 500, error.detail);
      }
    }

    const fabricStatusMatch = path.match(/^\/v1\/fabric\/events\/([0-9a-f-]{36})$/i);
    if (fabricStatusMatch && request.method === 'GET') {
      try {
        const user = await authUser(request, env);
        if (!user) return fail(request, env, 'Authentication required', 401);
        return reply(request, env, await fabricStatus(env, fabricStatusMatch[1]));
      } catch (error) {
        return fail(request, env, error.message || 'Fabric status request failed', error.status || 500, error.detail);
      }
    }

    try {
      const clientResponse = await handleClientRequest(request, env);
      if (clientResponse) return clientResponse;
    } catch (error) {
      return fail(request, env, error.message || 'Client request failed', error.status || 500, error.detail);
    }

    try {
      const connectResponse = await clientConnect.fetch(request, env, url, reply, fail, logEvent);
      if (connectResponse) return connectResponse;
    } catch (error) {
      return fail(request, env, error.message || 'Client Connect request failed', error.status || 500, error.detail);
    }

    if (path === '/v1/media/webhooks/fal' && request.method === 'POST') {
      try {
        const result = await handleFalWebhook(request, env);
        return reply(request, env, result);
      } catch (error) {
        return fail(request, env, error.message || 'fal webhook failed', error.status || 500, error.detail);
      }
    }

    if (path === '/v1/social/webhooks/meta' && ['GET', 'POST'].includes(request.method)) {
      try {
        return await handleMetaWebhook(request, env);
      } catch (error) {
        return fail(request, env, error.message || 'Meta webhook failed', error.status || 500, error.detail);
      }
    }

    if (path === '/v1/media/mcp' && request.method === 'POST') {
      try {
        const user = await authUser(request, env);
        const { status, body } = await handleMediaMcp(request, env, user);
        return reply(request, env, body, status);
      } catch (error) {
        return fail(request, env, error.message || 'Media MCP request failed', error.status || 500, error.detail);
      }
    }

    if (path === '/v1/media/models' && request.method === 'GET') {
      try {
        const user = await authUser(request, env);
        if (!user) return fail(request, env, 'Authentication required', 401);
        const models = await listModels(request, env);
        return reply(request, env, { models });
      } catch (error) {
        return fail(request, env, error.message || 'Media model request failed', error.status || 500, error.detail);
      }
    }

    if (path === '/v1/media/recommend' && request.method === 'POST') {
      try {
        const user = await authUser(request, env);
        if (!user) return fail(request, env, 'Authentication required', 401);
        const recommendation = await recommendModels(request, env);
        return reply(request, env, recommendation);
      } catch (error) {
        return fail(request, env, error.message || 'Media recommendation failed', error.status || 500, error.detail);
      }
    }

    if (path === '/v1/media/generate' && request.method === 'POST') {
      try {
        const user = await authUser(request, env);
        if (!user) return fail(request, env, 'Authentication required', 401);
        const job = await createGeneration(request, env, user);
        return reply(request, env, { job }, 202);
      } catch (error) {
        return fail(request, env, error.message || 'Media generation request failed', error.status || 500, error.detail);
      }
    }

    if (path === '/v1/media/bakeoff' && request.method === 'POST') {
      try {
        const user = await authUser(request, env);
        if (!user) return fail(request, env, 'Authentication required', 401);
        const bakeoff = await createBakeoff(request, env, user);
        return reply(request, env, bakeoff, 202);
      } catch (error) {
        return fail(request, env, error.message || 'Media bakeoff request failed', error.status || 500, error.detail);
      }
    }

    const jobMatch = path.match(/^\/v1\/media\/jobs\/([0-9a-f-]{36})$/i);
    if (jobMatch && request.method === 'GET') {
      try {
        const user = await authUser(request, env);
        if (!user) return fail(request, env, 'Authentication required', 401);
        const data = await getGeneration(request, env, user, jobMatch[1], true);
        return reply(request, env, data);
      } catch (error) {
        return fail(request, env, error.message || 'Media job request failed', error.status || 500, error.detail);
      }
    }

    if (path === '/v1/social' || path.startsWith('/v1/social/')) {
      try {
        const user = await authUser(request, env);
        if (!user) return fail(request, env, 'Authentication required', 401);
        const data = await handleSocialRequest(request, env, user);
        const accepted = request.method === 'POST' && ['/v1/social/variants/generate', '/v1/social/publish'].includes(path);
        return reply(request, env, data, accepted ? 202 : 200);
      } catch (error) {
        return fail(request, env, error.message || 'Social request failed', error.status || 500, error.detail);
      }
    }

    if (path === '/v1/ai' || path.startsWith('/v1/ai/')) {
      try {
        const user = await authUser(request, env);
        const response = await handleAiRequest(request, env, user);
        if (response) return response;
      } catch (error) {
        return fail(request, env, error.message || 'AI harness request failed', error.status || 500, error.detail);
      }
    }

    return core.fetch(request, env, ctx);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(Promise.all([
      drainFabricOutbox(env, { limit: 100 }).catch((error) => {
        console.error(JSON.stringify({ event: 'fabric_cloudflare_relay_failed', message: error instanceof Error ? error.message : String(error) }));
      }),
      reconcilePendingFalCosts(env, { limit: 50 }).catch((error) => {
        console.error(JSON.stringify({ event: 'media_cost_reconciliation_failed', message: error instanceof Error ? error.message : String(error) }));
      }),
      attachCompletedVariantAssets(env).catch((error) => {
        console.error(JSON.stringify({ event: 'social_variant_attachment_failed', message: error instanceof Error ? error.message : String(error) }));
      }),
      processInstagramPublishQueue(env, { limit: 10 }).catch((error) => {
        console.error(JSON.stringify({ event: 'social_instagram_publish_cycle_failed', message: error instanceof Error ? error.message : String(error) }));
      }),
      syncInstagramInsights(env, { limit: 25 }).catch((error) => {
        console.error(JSON.stringify({ event: 'social_instagram_insights_sync_failed', message: error instanceof Error ? error.message : String(error) }));
      })
    ]));
  }
};
