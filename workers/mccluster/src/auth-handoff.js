/* ONE M ACCOUNT, EVERY HOST.

   Owner, 2026-10-14: "one M Account works on every site". A session is
   per origin (the browser's localStorage, js/backend.js), so a member
   signed in on matthew.mccluster.org arrives on humanuprise.com as a
   guest, and the other way round. This route carries the sign-in across
   without a password and without a second sign-in screen.

   HOW IT TRAVELS. The departing page's bar (js/tabbar.js) puts the
   member's current access token in the URL fragment of the cross-host
   link, the way auth/seek-first-handoff.html already hands a token to the
   console: a fragment is never sent to any server and never appears in a
   Referer, and the arriving page scrubs it from the address before
   anything else runs. The arriving page then POSTs here with that token
   as its bearer. This route checks the token with Supabase (the same
   check every member route makes), confirms the caller's Origin is one of
   the ecosystem's own, and asks Supabase's admin API for a magic-link
   token for that same account (generate_link: nothing is emailed). The
   page turns that token into a session of its own origin at Supabase
   (/auth/v1/verify, type magiclink), stores it the ordinary way and
   reloads signed in.

   WHAT IT NEVER DOES. It never returns a refresh token (that would hand
   one session to two origins, and Supabase's rotation would sign both out
   at the next refresh). It never mints for an origin outside the CORS
   allowlist: a page elsewhere cannot call it. It never trusts anything but
   the bearer the arriving page presents, which Supabase validates live.
   The magic-link token is single-use and short-lived by Supabase's own
   rule. Nothing is stored here: no code table, no migration. */
import { reply, fail, corsHeaders, allowedOrigins } from './lib/http.js';

export const HANDOFF_PATH = '/v1/auth/handoff';

function authHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' };
}

export async function handleAuthHandoff(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== HANDOFF_PATH) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  if (request.method !== 'POST') return fail(request, env, 'method not allowed', 405);

  const origin = request.headers.get('origin') || '';
  if (!origin || !allowedOrigins(env).includes(origin)) return fail(request, env, 'only the ecosystem\'s own hosts can carry a sign-in across', 403);
  const bearer = request.headers.get('authorization') || '';
  if (!/^bearer\s+\S+/i.test(bearer) || /^bearer\s+mcc_/i.test(bearer)) return fail(request, env, 'sign in first', 401);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return fail(request, env, 'sign-in handoff unavailable', 503);

  /* the token the arriving page carries is checked live, like any member route */
  const who = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: bearer } });
  if (!who.ok) return fail(request, env, 'sign in first', 401);
  const user = await who.json().catch(() => null);
  if (!user || !user.id) return fail(request, env, 'sign in first', 401);
  if (!user.email) return fail(request, env, 'this account has no email address to carry the sign-in across', 409);

  /* a magic-link token for the same account; generate_link emails nothing */
  const link = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: authHeaders(env),
    body: JSON.stringify({ type: 'magiclink', email: user.email })
  });
  const body = link.ok ? await link.json().catch(() => null) : null;
  const tokenHash = body && (body.hashed_token || (body.properties && body.properties.hashed_token)) || '';
  if (!tokenHash) return fail(request, env, 'the sign-in could not be carried across', 502);

  const res = reply(request, env, { token_hash: tokenHash, type: 'magiclink', origin });
  res.headers.set('cache-control', 'no-store');
  return res;
}
