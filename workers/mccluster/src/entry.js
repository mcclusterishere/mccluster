import core from './index.js';
import { fail, logEvent, reply } from './lib/http.js';
import { handleClientRequest } from './client.js';
import clientConnect from './connect.js';
import { getUsage, createGeneration, getGeneration, handleFalWebhook, listModels, reconcilePendingFalCosts } from './media/router.js';
import { createBakeoff } from './media/orchestrator.js';
import { recommendModels } from './media/recommend.js';
import { handleMediaMcp } from './media/mcp.js';
import { handleCoreMcp, handleCoreStatus } from './core/mcp.js';
import { coreOAuthChallenge, coreOAuthMetadataResponse } from './core/oauth-resource.js';
import { attachCompletedVariantAssets, handleSocialRequest } from './social/router.js';
import { processInstagramPublishQueue, syncInstagramInsights } from './social/meta.js';
import { handleMetaWebhook } from './social/webhook.js';
import { handleAiRequest } from './ai/router.js';
import { handleCommsRequest } from './comms/router.js';
import { handleRelayEnrollment } from './comms/enrollment.js';
import { handleAnalyticsRequest } from './analytics/router.js';
import { requireMembership, resolveWorkspaces } from './workspaces.js';
import { setLeadStatus } from './leads.js';
import { recentAudit } from './lib/audit.js';

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

    // Activated only after the isolated transport is deployed and verified.
    // Forward the original request once: retrying a tools/call can duplicate work.
    if (env.MCP_EDGE && ['/v1/core/mcp', '/v1/core', '/.well-known/oauth-protected-resource'].includes(path)) {
      return env.MCP_EDGE.fetch(request);
    }

    if (path === '/healthz' && request.method === 'GET') {
      return reply(request, env, {
        ok: true,
        service: 'mccluster',
        contract: 'mccluster-system-health/v1',
        revision: env.CF_VERSION_METADATA?.id || null,
        checked_at: new Date().toISOString()
      });
    }

    if (path === '/.well-known/oauth-protected-resource' && request.method === 'GET') {
      return coreOAuthMetadataResponse();
    }

    if (path === '/a.js' && request.method === 'GET') {
      const site = (url.searchParams.get('site') || '').trim();
      const consent = (url.searchParams.get('consent') || 'required').trim();
      if (!/^mca_[a-f0-9]{32}$/i.test(site)) {
        return new Response('/* invalid McCluster Analytics site key */', {
          status: 400,
          headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' }
        });
      }
      const js = `(function(){var s=document.createElement("script");s.async=true;s.src="https://mccluster.org/js/mc-analytics.js";s.dataset.site=${JSON.stringify(site)};s.dataset.consent=${JSON.stringify(consent)};(document.head||document.documentElement).appendChild(s);}());`;
      return new Response(js, {
        headers: {
          'content-type': 'application/javascript; charset=utf-8',
          'cache-control': 'public, max-age=300, stale-while-revalidate=86400',
          'access-control-allow-origin': '*',
          'x-content-type-options': 'nosniff'
        }
      });
    }


    /* ============================================================
       TELEMETRY INTAKE — the house's own eyes, on the house's own domain.

       Two things only a Worker can do, and both of them matter.

       IT SEES WHERE THE VISITOR ACTUALLY IS. `request.cf` carries the
       country, region, city, postal code, latitude, longitude, timezone
       and — the one nothing else gives you — the ASN and the network's
       name. Supabase edge functions do not receive any of that: a
       request arriving there carries `cf-ray` and nothing else, which
       was measured rather than assumed. So the enrichment has to happen
       here, at the only place that holds the facts.

       IT IS NOT BLOCKED. api.mccluster.org is first-party. Every
       blocklist in every ad blocker carries the Google and Meta
       endpoints, and a third of visitors never appear in Google
       Analytics for exactly that reason. They appear here.

       This route enriches and forwards; it deliberately does not write.
       supabase/functions/collect stays the single writer of
       public.events, so there is one place where a row is shaped, one
       place that validates, and no second copy to drift.
       ============================================================ */
    if (path === '/v1/collect') {
      const origin = request.headers.get('origin') || '*';
      const cors = {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'authorization, apikey, content-type',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-max-age': '86400',
        'vary': 'origin'
      };
      if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ ok: false, reason: 'POST only' }), {
          status: 405, headers: { ...cors, 'content-type': 'application/json' }
        });
      }

      const cf = request.cf || {};
      const headers = {
        'content-type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        'user-agent': request.headers.get('user-agent') || '',
        'cf-connecting-ip': request.headers.get('cf-connecting-ip') || ''
      };
      /* The collector already knows how to read these names, so the
         enrichment arrives as the headers Cloudflare would have sent if
         Supabase had forwarded them. One reader, one vocabulary. */
      const put = (name, value) => {
        if (value !== undefined && value !== null && value !== '') headers[name] = String(value);
      };
      put('cf-ipcountry', cf.country);
      put('cf-region', cf.region);
      put('cf-region-code', cf.regionCode);
      put('cf-ipcity', cf.city);
      put('cf-postal-code', cf.postalCode);
      put('cf-iplatitude', cf.latitude);
      put('cf-iplongitude', cf.longitude);
      put('cf-timezone', cf.timezone);
      put('cf-ipcontinent', cf.continent);
      put('cf-asn', cf.asn);
      put('cf-as-organization', cf.asOrganization);

      /* CONNECTION QUALITY AND TRANSPORT. These are observed by Cloudflare,
         not asserted by the browser body. They are useful for answering
         whether a conversion problem is a page problem or a network problem.
         Deliberately excluded: JA3/JA4 and TLS-client fingerprint hashes. */
      put('cf-colo', cf.colo);
      put('cf-metro-code', cf.metroCode);
      put('cf-is-eu-country', cf.isEUCountry);
      put('cf-http-protocol', cf.httpProtocol);
      put('cf-tls-version', cf.tlsVersion);
      put('cf-tls-cipher', cf.tlsCipher);
      put('cf-client-tcp-rtt', cf.clientTcpRtt);
      put('cf-client-quic-rtt', cf.clientQuicRtt);
      put('cf-edge-delivery-rate', cf.edgeL4 && cf.edgeL4.deliveryRate);
      put('cf-client-accept-encoding', cf.clientAcceptEncoding);
      put('cf-request-priority', cf.requestPriority);

      /* Bot Management fields are classification signals, not identity.
         Fingerprint values such as ja3Hash/ja4 are intentionally not sent. */
      put('cf-bot-score', cf.botManagement && cf.botManagement.score);
      put('cf-verified-bot', cf.botManagement && cf.botManagement.verifiedBot);
      put('cf-static-resource', cf.botManagement && cf.botManagement.staticResource);
      /* THE OPT-OUT HAS TO SURVIVE THE HOP. This route builds a fresh header
         set rather than passing the request's own through, which means any
         header not named here is dropped — and a privacy signal that gets
         dropped on the way to the only thing that acts on it is worse than
         never having been sent, because the notice says it is honoured.
         The collector reads both names. */
      put('sec-gpc', request.headers.get('sec-gpc'));
      put('dnt', request.headers.get('dnt'));
      /* Site-bound analytics needs the embedding page origin to prove that a
         public pixel key is being used by a domain the customer verified. */
      put('origin', request.headers.get('origin'));
      put('referer', request.headers.get('referer'));
      put('sec-fetch-site', request.headers.get('sec-fetch-site'));

      /* A visitor's own token, when they have one, so the collector can
         attribute the event. It is verified there, never here. */
      const auth = request.headers.get('authorization');
      if (auth) headers.authorization = auth;

      try {
        const upstream = await fetch(`${env.SUPABASE_URL}/functions/v1/collect`, {
          method: 'POST',
          headers,
          body: await request.text()
        });
        return new Response(await upstream.text(), {
          status: upstream.status,
          headers: { ...cors, 'content-type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, reason: 'collector unreachable' }), {
          status: 502, headers: { ...cors, 'content-type': 'application/json' }
        });
      }
    }

    if (path === '/v1/analytics' || path.startsWith('/v1/analytics/')) {
      try {
        const user = await authUser(request, env);
        const analyticsResponse = await handleAnalyticsRequest(request, env, user);
        if (analyticsResponse) return analyticsResponse;
      } catch (error) {
        return fail(request, env, error.message || 'Analytics request failed', error.status || 500, error.detail);
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

    if (path === '/v1/core/mcp' && request.method === 'POST') {
      try {
        const user = await authUser(request, env);
        const { status, body } = await handleCoreMcp(request, env, user);
        if (status === 401) return coreOAuthChallenge(request, env, body);
        return reply(request, env, body, status);
      } catch (error) {
        return fail(request, env, error.message || 'Core MCP request failed', error.status || 500, error.detail);
      }
    }

    if (path === '/v1/core' && request.method === 'GET') {
      try {
        const user = await authUser(request, env);
        const { status, body } = await handleCoreStatus(request, env, user);
        return reply(request, env, body, status);
      } catch (error) {
        return fail(request, env, error.message || 'Core status request failed', error.status || 500, error.detail);
      }
    }

    /* WHICH WORKSPACES THIS TOKEN MAY OPEN. Ahead of every module route
       on purpose: a page calls this first and hands the chosen org_id to
       whatever it opens next. It never authorizes a write on its own —
       the module still checks membership where the write happens. */
    if (path === '/v1/workspaces/me' && request.method === 'GET') {
      try {
        const user = await authUser(request, env);
        if (!user) return fail(request, env, 'Authentication required', 401);
        return reply(request, env, await resolveWorkspaces(env, user));
      } catch (error) {
        return fail(request, env, error.message || 'Workspace lookup failed', error.status || 500, error.detail);
      }
    }

    /* The ledger, read back. Scoped to one org and membership-checked, so
       a tenant never reads another tenant's history. */
    if (path === '/v1/audit/recent' && request.method === 'GET') {
      try {
        const user = await authUser(request, env);
        if (!user) return fail(request, env, 'Authentication required', 401);
        const orgId = url.searchParams.get('org_id');
        await requireMembership(env, user, orgId);
        const events = await recentAudit(env, orgId, url.searchParams.get('limit'));
        return reply(request, env, { events });
      } catch (error) {
        return fail(request, env, error.message || 'Audit read failed', error.status || 500, error.detail);
      }
    }

    /* Working the pipeline. This used to be a browser PATCH straight at
       public.leads behind an RLS policy comparing the JWT email to one
       literal address — see src/leads.js for why that had to move. */
    if (path === '/v1/leads/status' && request.method === 'POST') {
      try {
        const user = await authUser(request, env);
        if (!user) return fail(request, env, 'Authentication required', 401);
        return reply(request, env, await setLeadStatus(request, env, user));
      } catch (error) {
        return fail(request, env, error.message || 'Lead update failed', error.status || 500, error.detail);
      }
    }

    if (path === '/v1/media/usage' && request.method === 'GET') {
      try {
        const user = await authUser(request, env);
        if (!user) return fail(request, env, 'Authentication required', 401);
        return reply(request, env, await getUsage(request, env, user));
      } catch (error) {
        return fail(request, env, error.message || 'Media usage request failed', error.status || 500, error.detail);
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
        return fail(request, env, error.message || 'Media bakeoff failed', error.status || 500, error.detail);
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

    if (path === '/v1/comms' || path.startsWith('/v1/comms/')) {
      const user = await authUser(request, env);
      const enrollment = await handleRelayEnrollment(request, env, user);
      if (enrollment) return enrollment;
      const response = await handleCommsRequest(request, env, user);
      if (response) return response;
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
