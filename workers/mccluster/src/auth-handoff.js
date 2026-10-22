import { allowedOrigins, corsHeaders } from './lib/http.js';

export const HANDOFF_PATH = '/v1/auth/handoff';

/** The old bearer-to-admin-magic-link exchange is retired. A valid short-lived
 * bearer is not permission to mint an independent refreshable session.
 * Existing per-origin sessions and ordinary password/PKCE sign-in still work.
 * A future cross-origin broker must bind a one-time code to the destination's
 * PKCE verifier; this route must never call admin/generate_link. */
export async function handleAuthHandoff(request, env) {
  if (new URL(request.url).pathname !== HANDOFF_PATH) return null;
  const origin = request.headers.get('origin');
  const answer = (body, status) => new Response(body === null ? null : JSON.stringify(body), {
    status, headers: { ...corsHeaders(request, env), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
  if (!origin || !allowedOrigins(env).includes(origin)) return answer({ error: 'Origin not allowed' }, 403);
  if (request.method === 'OPTIONS') return answer(null, 204);
  if (request.method !== 'POST') return answer({ error: 'POST required' }, 405);
  return answer({ error: 'cross_origin_reauthentication_required', message: 'Sign in on the destination site. Automatic token handoff has been retired.' }, 410);
}
