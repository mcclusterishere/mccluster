import { handleCoreMcp, handleCoreStatus } from './mcp.js';
import { coreOAuthChallenge, coreOAuthMetadataResponse } from './oauth-resource.js';
import { corsHeaders } from './http.js';

const MCP_PATHS = new Set(['/mcp', '/v1/core/mcp']);
function response(request, env, body, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', ...corsHeaders(request, env) }
  });
}
async function authUser(request, env) {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(new Error('Identity provider is not configured'), { status: 503 });
  }
  const result = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { authorization, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    signal: AbortSignal.timeout(10000)
  });
  if (result.status === 401 || result.status === 403) return null;
  if (!result.ok) throw Object.assign(new Error('Identity provider unavailable'), { status: 503 });
  const user = await result.json();
  if (!user || typeof user.id !== 'string') throw Object.assign(new Error('Invalid identity response'), { status: 503 });
  return user;
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return response(request, env, null, 204);
    if (path === '/healthz' && request.method === 'GET') {
      return response(request, env, { ok: true, service: 'mccluster-mcp',
        deployment_sha: env.DEPLOY_SHA || 'unknown', deployment_ref: env.DEPLOY_REF || 'unknown' });
    }
    if (path === '/.well-known/oauth-protected-resource' && request.method === 'GET') {
      // Preserve the already-authorized resource identity during migration.
      return coreOAuthMetadataResponse();
    }
    if (!MCP_PATHS.has(path) && path !== '/v1/core') return response(request, env, { error: 'Not found' }, 404);
    if ((MCP_PATHS.has(path) && request.method !== 'POST') || (path === '/v1/core' && request.method !== 'GET')) {
      return response(request, env, { error: 'Method not allowed' }, 405);
    }
    try {
      const user = await authUser(request, env);
      const result = path === '/v1/core'
        ? await handleCoreStatus(request, env, user)
        : await handleCoreMcp(request, env, user);
      if (result.status === 401) return coreOAuthChallenge(request, env, result.body);
      return response(request, env, result.body, result.status);
    } catch (error) {
      return response(request, env, { error: error.status ? error.message : 'MCP transport unavailable' }, error.status || 503);
    }
  }
};
