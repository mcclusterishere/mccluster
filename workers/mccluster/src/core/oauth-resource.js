import { corsHeaders } from '../lib/http.js';

export const CORE_MCP_RESOURCE = 'https://api.mccluster.org/v1/core/mcp';
export const CORE_MCP_RESOURCE_METADATA = 'https://api.mccluster.org/.well-known/oauth-protected-resource';
export const SUPABASE_AUTHORIZATION_SERVER = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/auth/v1';
export const CORE_MCP_SCOPES = ['email'];

export function coreOAuthMetadata() {
  return {
    resource: CORE_MCP_RESOURCE,
    resource_name: 'McCluster Core',
    authorization_servers: [SUPABASE_AUTHORIZATION_SERVER],
    scopes_supported: [...CORE_MCP_SCOPES]
  };
}

export function coreOAuthMetadataResponse() {
  return new Response(JSON.stringify(coreOAuthMetadata()), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff'
    }
  });
}

export function coreOAuthChallenge(request, env, body) {
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(request, env),
      'cache-control': 'no-store',
      'www-authenticate': `Bearer resource_metadata="${CORE_MCP_RESOURCE_METADATA}", scope="${CORE_MCP_SCOPES.join(' ')}"`
    }
  });
}
