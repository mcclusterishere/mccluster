/* PRIM3 World is the house owner's app. Who the owner is stays the server's answer, never this browser's:
   GET https://api.mccluster.org/v1/status with the signed-in session's token (requireHouseOwner in Worker
   mccluster), the same check js/tabbar.js and js/owner-control-redirect.js make. A 2xx is the owner; anything
   else (no session, 401, 403, a timeout, the API unreachable) is not. Nothing is cached: every page entry and
   every return to a visible tab asks again. This is a display gate; the data behind it is DRAFT game text. */

export const API_ORIGIN = 'https://api.mccluster.org';
export const SESSION_KEY = 'mccdb_session';

export function storedToken(storage) {
  try {
    const s = JSON.parse((storage || globalThis.localStorage).getItem(SESSION_KEY) || 'null');
    return s && typeof s.access_token === 'string' && s.access_token ? s.access_token : null;
  } catch (e) { return null; }
}

/* resolves { owner: boolean, reason } and never throws */
export async function checkOwner({ fetchImpl = globalThis.fetch, storage, timeoutMs = 5000, auth = globalThis.MCC } = {}) {
  let token = storedToken(storage);
  if (!token) return { owner: false, reason: 'signed-out' };
  // the canonical auth helper refreshes an expired session when the page has it (js/mcc-auth.js, loaded by the bar)
  if (auth && typeof auth.refreshIfNeeded === 'function') {
    try { const s = await auth.refreshIfNeeded(); if (s && s.access_token) token = s.access_token; } catch (e) { /* keep the stored token */ }
  }
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetchImpl(API_ORIGIN + '/v1/status', { headers: { authorization: 'Bearer ' + token }, cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    return r && r.ok ? { owner: true, reason: 'owner' } : { owner: false, reason: r && (r.status === 401 || r.status === 403) ? 'not-owner' : 'unavailable' };
  } catch (e) {
    return { owner: false, reason: 'unavailable' };
  } finally { if (timer) clearTimeout(timer); }
}
