/* THE BROWSER'S PREFLIGHT, ANSWERED BEFORE ANY GATE.

   A page that calls the API with its member's session sends an
   Authorization header, so the browser first asks, with an OPTIONS
   request that never carries the session, whether it may. Several route
   families here check the session (or the method) before they look at
   that question: /v1/mnet answered it 401 "Authentication required",
   /v1/creator-sites/publish and /v1/creator-billing/entitlement 405, the
   FBI desk 404. The browser then refused to make the real request at all
   ("Failed to fetch"), so a signed-in member's World never loaded its
   bootstrap and fell back to a screen with no globe (owner, 2026-10-15:
   "when I'm logged in as Benji Chase … not seeing the globe"). Guests were
   untouched: their reads carry no session and need no preflight.

   The old entry already answers its own such prefixes this way
   (src/entry.js AUTH_FIRST_PREFIXES) and Core answers every preflight
   (src/index.js). This answers the families the platform entry
   (src/entry-platform.js) routes before them. It answers only a real CORS
   preflight (an OPTIONS with Access-Control-Request-Method), only for these
   prefixes, with the same allowlisted headers every other route uses; it
   runs no handler and reads no data. /v1/collect and the whip routes keep
   their own answers (they serve other origins on purpose). */
import { corsHeaders } from './lib/http.js';

export const PREFLIGHT_FIRST_PREFIXES = [
  '/v1/mnet', '/v1/developer', '/v1/fbi', '/v1/platform',
  '/v1/compute', '/v1/ai',
  '/v1/creator-billing', '/v1/creator-sites', '/v1/action-connect',
  '/v1/action-archive',
  '/v1/identity',
  /* the morning brief (brief.html): the house owner's and region leaders' session rides with every call */
  '/v1/news-briefs',
  /* every account's front page: the editor saves with the account's session (./member-fronts.js) */
  '/v1/fronts',
  /* the merch marketplace: sellers and the owner call it with their session (./merch/router.js) */
  '/v1/merch'
];

export function preflightResponse(request, env) {
  if (request.method !== 'OPTIONS' || !request.headers.get('access-control-request-method')) return null;
  const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
  if (!PREFLIGHT_FIRST_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) return null;
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}
