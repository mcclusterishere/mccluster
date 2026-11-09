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
   This router does not touch the consumer `/v1/world/environment` contract. */
import { reply } from '../lib/http.js';
import { handleOverview } from './overview.js';
import { handleLeague } from './league.js';
import { handleCivic } from './civic.js';
import { handleCompanies } from './companies.js';
import { handleSources } from './sources.js';

export const EUP_PREFIX = '/v1/eup';
export const EUP_SECTIONS = Object.freeze(['overview', 'league', 'civic', 'companies', 'sources']);
const SECTION_HANDLERS = { overview: handleOverview, league: handleLeague, civic: handleCivic, companies: handleCompanies, sources: handleSources };
const fail = (status, message, reason) => Object.assign(new Error(message), { status, reason });

export async function handleEup(request, env, { requireHouseOwner, fetchImpl = fetch, now = Date.now } = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path !== EUP_PREFIX && !path.startsWith(EUP_PREFIX + '/')) return null;
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
    const result = await handler(request, env, { user, parts, url, fetchImpl, now, fail });
    if (result instanceof Response) { result.headers.set('cache-control', 'private, no-store'); return result; }
    return respond(result && typeof result === 'object' && 'ok' in result ? result : { ok: true, value: result });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const reason = error?.reason || (status === 401 ? 'authentication_required' : status === 403 ? 'owner_required' : status === 404 ? 'not_found' : status === 503 ? 'unavailable' : 'error');
    return respond({ ok: false, error: status >= 500 && status !== 503 ? 'E=Up request failed' : (error?.message || 'Request failed'), reason }, status);
  }
}
