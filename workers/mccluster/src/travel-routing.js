import { allowedOrigins, corsHeaders } from './lib/http.js';
import { normalizeRouteRequest, boundedJson } from '../../../js/travel/route-core.mjs';
import { routingProvider } from './travel-routing-provider.js';

export async function handleTravelRouting(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/travel/route') return null;
  const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: {
    ...corsHeaders(request, env), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, private', ...extra
  } });
  const origin = request.headers.get('origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return json({ error: 'Open Travel on a McCluster website to request directions.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...corsHeaders(request, env), 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return json({ error: 'Use POST to request directions.' }, 405, { allow: 'POST, OPTIONS' });
  if (url.search) return json({ error: 'Route coordinates belong in the private request body.' }, 400);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return json({ error: 'A JSON route request is required.' }, 415);
  let input;
  try { input = normalizeRouteRequest(await boundedJson(request, 2048)); }
  catch (error) { return json({ error: error instanceof SyntaxError ? 'Invalid route request.' : error.message }, 400); }
  if (!routingProvider(env) || !env.HereTenantAgent) return json({ error: 'Street routing is not connected yet. Please try again after the service is connected.' }, 503);
  try {
    const id = env.HereTenantAgent.idFromName('travel:street-routing:mccluster');
    const result = await env.HereTenantAgent.get(id).routeTravel(input);
    return json(result.route ? { route: result.route } : { error: result.error, retryAfter: result.retryAfter || 0 }, result.status || 200,
      result.retryAfter ? { 'retry-after': String(result.retryAfter) } : {});
  } catch {
    return json({ error: 'Street directions are temporarily unavailable. Please try again.' }, 503);
  }
}
