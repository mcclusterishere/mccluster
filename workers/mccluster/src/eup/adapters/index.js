/* The gate in front of every upstream request. Parsing is pure and tested with
   fixtures; fetching happens only when `assertFetchAllowed` passes (rights
   approved and unexpired, configured, bindings present, not paused) and only
   through the bounded same-host fetch. The USAspending boundary is the
   existing seek-first adapter; this module does not add a second gateway. */
import { fetchNoCrossHostRedirect } from '../../lib/safe-fetch.js';
import { assertFetchAllowed } from '../intake.js';
import * as sec from './sec.js';
import * as gleif from './gleif.js';
import * as congress from './congress.js';
import * as census from './census.js';
import * as ctAssembly from './ct-assembly.js';
import * as bridgeport from './bridgeport-council.js';

export const ADAPTERS = Object.freeze({ sec, gleif, congress, census, 'ct-assembly': ctAssembly, 'bridgeport-council': bridgeport });
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15000;

/* Bounded read of one upstream URL. Refuses before any network activity
   unless the gate passes. Returns {text, fetched_at}. */
export async function boundedUpstreamRead(source_id, state, env, url, { fetchImpl = fetch, now = Date.now, headers = {} } = {}) {
  const feedEntry = assertFetchAllowed(source_id, state, env, { now: now() });
  /* The source's registrable domain: its registered fetch host when the registry names one
     (the documentation URL of some sources lives on another host), otherwise its URL's host.
     A request may go to that domain or to a subdomain of it, compared by whole labels: a text
     suffix would let evilsec.gov through for sec.gov. No port, no credentials in the URL. */
  const registered = String(feedEntry.fetch_host || new URL(feedEntry.url).hostname).toLowerCase().replace(/^www\./, '');
  const domain = registered.split('.').slice(-2).join('.');
  const target = new URL(url);
  const invalid = (message) => Object.assign(new Error(message), { status: 400, reason: 'invalid_upstream' });
  if (target.protocol !== 'https:') throw invalid('upstream must be https');
  const hostname = target.hostname.toLowerCase();
  if (target.port || target.username || target.password) throw invalid('upstream carries a port or credentials');
  if (!(hostname === domain || hostname.endsWith(`.${domain}`))) throw invalid('upstream host outside the source');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchNoCrossHostRedirect(target.href, { headers: { accept: 'application/json, text/html;q=0.5', ...headers }, signal: controller.signal }, { fetchImpl, allowedHosts: [target.host] });
    if (!res.ok) throw Object.assign(new Error(`upstream ${res.status}`), { status: 503, reason: 'upstream_unavailable' });
    const reader = res.body?.getReader();
    if (!reader) return { text: await res.text(), fetched_at: new Date(now()).toISOString() };
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw Object.assign(new Error('upstream body too large'), { status: 503, reason: 'upstream_unavailable' }); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
    return { text: new TextDecoder().decode(bytes), fetched_at: new Date(now()).toISOString() };
  } finally {
    clearTimeout(timer);
  }
}
