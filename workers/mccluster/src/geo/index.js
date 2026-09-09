import { fail, reply } from '../lib/http.js';
import { sourceCatalog } from './source-registry.js';

const SERVICE = 'mccluster-spatial-intelligence';
const UPSTREAM = 'https://github.com/bilawalsidhu/gods-eye-view';

function readiness(env) {
  const sources = sourceCatalog(env);
  const credentialed = sources.filter((source) => source.credential_required);
  const configured = credentialed.filter((source) => source.configured);
  const noCredential = sources.filter((source) => !source.credential_required);

  return {
    total_sources: sources.length,
    no_credential_sources: noCredential.length,
    credentialed_sources: credentialed.length,
    credentialed_sources_configured: configured.length,
    credentialed_sources_pending: credentialed.length - configured.length
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if ((path === '/v1/geo' || path === '/v1/geo/health') && request.method === 'GET') {
      return reply(request, env, {
        ok: true,
        service: SERVICE,
        mode: 'bootstrap',
        upstream_reference: UPSTREAM,
        database_schema_ready: false,
        adapters_live: false,
        readiness: readiness(env)
      });
    }

    if (path === '/v1/geo/sources' && request.method === 'GET') {
      return reply(request, env, {
        service: SERVICE,
        sources: sourceCatalog(env)
      });
    }

    return fail(request, env, 'Spatial intelligence route not found', 404);
  }
};
