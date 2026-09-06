import core from './index.js';
import { fail, reply } from './lib/http.js';
import { createGeneration, getGeneration, listModels } from './media/router.js';

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

    return core.fetch(request, env, ctx);
  }
};
