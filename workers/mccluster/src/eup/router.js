/* E=Up admin workspace API: owner-only at every boundary.
   Owner direction (2026-11-09): the first deeper E=Up release is an admin-only
   product workspace inside Control (Products → E=Up). Nothing under this prefix
   is reachable without the verified house owner (`requireHouseOwner` from the
   Worker entry); a hidden tab, an `admin=true` parameter or a route name is not
   authorization. Every response is private/no-store. Sections are separate
   modules so each can be reviewed and gated on its own:
     overview   module state, geography, drafts, queues, freshness, blockers
     league     Environmental Justice League campaigns/missions/applications/proof
     civic      Civic League offices, terms, legislation, elections (private intake)
     companies  company identity, sourced locations, filings, awards
     sources    connector registry, rights/configuration, review queue, refresh/pause
     modules    persisted module policy: install, enable, drain, disable (owner commands)
   This router does not touch the consumer `/v1/world/environment` contract.

   ONE explicit exception to "owner-only": the League member branch, PREFIX.member of ./league-contract.js
   (/v1/eup/member/league and below). It never calls requireHouseOwner; it verifies the bearer with the Worker's own
   session check (`authUser`, the one index.js uses for /v1/me) and hands ./league-member.js that verified user and
   nothing else. No bearer is 401 before anything is called. Every member answer is private, no-store and varies on
   Origin and Authorization. Everything else under /v1/eup, /v1/eup/member itself included, stays owner-only. */
import { reply } from '../lib/http.js';
import { handleOverview } from './overview.js';
import { handleLeague } from './league.js';
import { handleLeagueMember } from './league-member.js';
import { PATTERNS, PREFIX } from './league-contract.js';
import { handleCivic } from './civic.js';
import { handleCompanies } from './companies.js';
import { handleSources } from './sources.js';
import { handleModules } from './modules.js';

export const EUP_PREFIX = '/v1/eup';
export const EUP_SECTIONS = Object.freeze(['overview', 'league', 'civic', 'companies', 'sources', 'modules']);
/* The one prefix under EUP_PREFIX that a signed-in account which is not a house owner can reach. */
export const EUP_MEMBER_LEAGUE_PREFIX = PREFIX.member;
const SECTION_HANDLERS = { overview: handleOverview, league: handleLeague, civic: handleCivic, companies: handleCompanies, sources: handleSources, modules: handleModules };
const fail = (status, message, reason) => Object.assign(new Error(message), { status, reason });

/* The error body every E=Up answer uses: a fixed sentence and a reason, never upstream text for a 5xx. */
function failure(error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const reason = error?.reason || (status === 401 ? 'authentication_required' : status === 403 ? 'owner_required' : status === 404 ? 'not_found' : status === 503 ? 'unavailable' : 'error');
  return [{ ok: false, error: status >= 500 && status !== 503 ? 'E=Up request failed' : (error?.message || 'Request failed'), reason }, status];
}

/* The League member branch. The bearer is checked for presence first, so a request without one reaches no
   session check, RPC or storage call at all. */
async function handleMemberBranch(request, env, { authUser, url, path, fetchImpl, now, rpcTimeoutMs }) {
  const respond = (data, status = 200) => {
    const r = reply(request, env, data, status);
    r.headers.set('cache-control', 'private, no-store');
    r.headers.set('vary', 'Origin, Authorization');
    return r;
  };
  try {
    if (!/^bearer\s+\S/i.test(request.headers.get('authorization') || '')) throw fail(401, 'Authentication required', 'authentication_required');
    if (typeof authUser !== 'function') throw fail(503, 'Authorization unavailable', 'authorization_unavailable');
    let user;
    try { user = await authUser(request, env); } catch { throw fail(503, 'Authorization unavailable', 'authorization_unavailable'); }
    if (!user || typeof user.id !== 'string' || !PATTERNS.uuid.test(user.id)) throw fail(401, 'Authentication required', 'authentication_required');
    const rest = path.length > EUP_MEMBER_LEAGUE_PREFIX.length ? path.slice(EUP_MEMBER_LEAGUE_PREFIX.length + 1) : '';
    const result = await handleLeagueMember(request, env, { user: { id: user.id.toLowerCase() }, rest, url, fetchImpl, now, fail, rpcTimeoutMs });
    return respond(result);
  } catch (error) {
    return respond(...failure(error));
  }
}

export async function handleEup(request, env, { requireHouseOwner, authUser, fetchImpl = fetch, now = Date.now, rpcTimeoutMs } = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== EUP_PREFIX && !path.startsWith(EUP_PREFIX + '/')) return null;
  if (path === EUP_MEMBER_LEAGUE_PREFIX || path.startsWith(EUP_MEMBER_LEAGUE_PREFIX + '/')) {
    return handleMemberBranch(request, env, { authUser, url, path, fetchImpl, now, rpcTimeoutMs });
  }
  const respond = (data, status = 200) => {
    const r = reply(request, env, data, status);
    r.headers.set('cache-control', 'private, no-store');
    return r;
  };
  try {
    if (typeof requireHouseOwner !== 'function') throw fail(503, 'Authorization unavailable', 'authorization_unavailable');
    const user = await requireHouseOwner(request, env);
    if (!user?.id) throw fail(401, 'Authentication required', 'authentication_required');
    const rest = path.slice(EUP_PREFIX.length + 1);
    const [section, ...parts] = rest ? rest.split('/') : [];
    if (!section) return respond({ ok: true, sections: EUP_SECTIONS, scope: 'house_owner' });
    const handler = SECTION_HANDLERS[section];
    if (!handler) throw fail(404, 'Unknown E=Up section', 'unknown_section');
    const result = await handler(request, env, { user, parts, url, fetchImpl, now, fail, rpcTimeoutMs });
    if (result instanceof Response) { result.headers.set('cache-control', 'private, no-store'); return result; }
    return respond(result && typeof result === 'object' && 'ok' in result ? result : { ok: true, value: result });
  } catch (error) {
    return respond(...failure(error));
  }
}
