/* FILE A PUBLIC COMMENT: open federal comment periods, read only.
   (owner mission curation, 2026-10-15: "integrate government APIs
   (Regulations.gov / Federal Register) so users pick what to comment on
   through the platform").

     GET  /v1/public-comment/open      members   open comment periods, both sources merged
     POST /v1/public-comment/handoff   members   a member's draft checked against the
                                                 official limits, with the official form's link

   Behind PUBLIC_COMMENT_LISTING_ENABLED (default off: unset, or anything but
   "true", answers 404 as if the route did not exist).

   The platform NEVER files a comment. The person files it on the agency's
   official form (Regulations.gov "commenton" page, or the form the Federal
   Register document names); the handoff only gives them their text and the
   link. Regulations.gov's comment-posting API (POST /v4/comments) needs a
   separately approved posting key, certification that every comment is a
   real person's own and lawfully gathered, links to its terms and privacy
   notice, and agency approval before a comment appears
   (https://open.gsa.gov/api/regulationsgov/). Using it would be a separate,
   owner-approved change with explicit per-comment consent: not this file.

   Sources and limits (docs/action-network/PUBLIC-COMMENT-ADAPTER.md):
   - Regulations.gov API v4, https://api.regulations.gov/v4/documents,
     key from api.data.gov in X-Api-Key (env REGULATIONS_GOV_API_KEY, a
     secret: never logged, never returned). api.data.gov's default limit is
     1,000 requests an hour per key (https://api.data.gov/docs/developer-manual/).
     filter[withinCommentPeriod]=true is the documented "open for comment"
     filter (true only; omit it otherwise), filter[agencyId] an agency
     acronym, filter[documentType] one of Notice, Rule, Proposed Rule,
     Supporting & Related Material, Other; page[size] 5–250.
   - Federal Register API v1, https://www.federalregister.gov/api/v1/documents.json,
     no key. conditions[type][]=PRORULE, conditions[agencies][]=<slug>,
     conditions[term]=<words>. The comment deadline (comments_close_on) is
     filtered here, in code, because it can be empty.
   Without the key, the Regulations.gov half says "not_configured"; a source
   that fails says "error". Neither is ever a count of zero. */
import { fail, reply } from './lib/http.js';
import { bearerUser } from './world-layers.js';

export const PUBLIC_COMMENT_FLAG = 'PUBLIC_COMMENT_LISTING_ENABLED';
export const REGULATIONS_GOV_KEY_ENV = 'REGULATIONS_GOV_API_KEY';
export const COMMENT_MAX_CHARS = 5000; // Regulations.gov's comment field limit
const TTL = 900;
const TIMEOUT_MS = 12000;
const PAGE = 25;

export const US_STATES = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
});

export function enabled(env) {
  return String((env && env[PUBLIC_COMMENT_FLAG]) || '').trim().toLowerCase() === 'true';
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const today = (now) => new Date(now).toISOString().slice(0, 10);

/* the member's filters, bounded: an agency, a topic, a state; nothing else reaches a provider */
export function parseQuery(url) {
  const p = url.searchParams;
  const agency = clean(p.get('agency'), 20).toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const agencySlug = clean(p.get('agency_slug'), 80).toLowerCase().replace(/[^a-z0-9-]/g, '');
  const topic = clean(p.get('q'), 120);
  const stateCode = clean(p.get('state'), 2).toUpperCase();
  const state = US_STATES[stateCode] ? stateCode : '';
  return { agency, agency_slug: agencySlug, q: topic, state };
}

/* a state is a words match ("mentions Connecticut"), never a claim about jurisdiction */
function searchWords(query) {
  return [query.q, query.state ? US_STATES[query.state] : ''].filter(Boolean).join(' ').trim();
}

async function upstream(url, init, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'McCluster-Action/1.0 (https://mccluster.org)', ...((init && init.headers) || {}) } });
    if (!res.ok) throw new Error(`provider ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function regulationsGovUrl(query) {
  const u = new URL('https://api.regulations.gov/v4/documents');
  u.searchParams.set('filter[withinCommentPeriod]', 'true');
  u.searchParams.set('filter[documentType]', 'Proposed Rule');
  if (query.agency) u.searchParams.set('filter[agencyId]', query.agency);
  const words = searchWords(query);
  if (words) u.searchParams.set('filter[searchTerm]', words);
  u.searchParams.set('sort', 'commentEndDate');
  u.searchParams.set('page[size]', String(PAGE));
  return u.toString();
}

export function federalRegisterUrl(query, now = Date.now()) {
  const u = new URL('https://www.federalregister.gov/api/v1/documents.json');
  u.searchParams.append('conditions[type][]', 'PRORULE');
  if (query.agency_slug) u.searchParams.append('conditions[agencies][]', query.agency_slug);
  const words = searchWords(query);
  if (words) u.searchParams.set('conditions[term]', words);
  u.searchParams.set('conditions[comment_date][gte]', today(now));
  u.searchParams.set('order', 'newest');
  u.searchParams.set('per_page', String(PAGE));
  for (const f of ['document_number', 'title', 'type', 'agencies', 'publication_date', 'comments_close_on', 'html_url', 'comment_url', 'regulations_dot_gov_info', 'docket_ids']) {
    u.searchParams.append('fields[]', f);
  }
  return u.toString();
}

const httpsOrNull = (v) => (typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v) ? v : null);
const idOk = (v) => (typeof v === 'string' && /^[A-Za-z0-9._-]{3,80}$/.test(v) ? v : null);

export function normalizeRegulationsGov(body) {
  const rows = Array.isArray(body && body.data) ? body.data : [];
  const out = [];
  for (const r of rows) {
    const a = (r && r.attributes) || {};
    const id = idOk(r && r.id);
    if (!id || a.openForComment === false || a.withdrawn === true) continue;
    out.push({
      provider: 'regulations_gov',
      document_id: id,
      docket_id: idOk(a.docketId),
      fr_doc_num: idOk(a.frDocNum),
      title: clean(a.title, 400),
      agency: clean(a.agencyId, 20),
      type: clean(a.documentType, 40),
      posted: a.postedDate || null,
      comment_end: a.commentEndDate || null,
      official_url: `https://www.regulations.gov/document/${id}`,
      comment_url: `https://www.regulations.gov/commenton/${id}`
    });
  }
  return out;
}

export function normalizeFederalRegister(body, now = Date.now()) {
  const rows = Array.isArray(body && body.results) ? body.results : [];
  const day = today(now);
  const out = [];
  for (const r of rows) {
    const num = idOk(r && r.document_number);
    const close = typeof (r && r.comments_close_on) === 'string' ? r.comments_close_on : null;
    if (!num || !close || close < day) continue; // no deadline, or past it: not open as far as we can tell
    const rg = (r && r.regulations_dot_gov_info) || {};
    const rgDoc = idOk(rg.document_id);
    out.push({
      provider: 'federal_register',
      document_id: rgDoc || num,
      docket_id: idOk(Array.isArray(r.docket_ids) ? r.docket_ids[0] : null),
      fr_doc_num: num,
      title: clean(r.title, 400),
      agency: clean(Array.isArray(r.agencies) && r.agencies[0] && (r.agencies[0].short_name || r.agencies[0].name), 80),
      type: clean(r.type, 40),
      posted: r.publication_date || null,
      comment_end: close,
      official_url: httpsOrNull(r.html_url),
      comment_url: httpsOrNull(r.comment_url) || (rgDoc ? `https://www.regulations.gov/commenton/${rgDoc}` : httpsOrNull(r.html_url))
    });
  }
  return out;
}

/* one list: a Federal Register notice and its Regulations.gov document are the same proceeding */
export function mergeDocuments(lists) {
  const seen = new Map();
  for (const list of lists) {
    for (const d of list) {
      const key = d.fr_doc_num ? `fr:${d.fr_doc_num}` : `rg:${d.document_id}`;
      const had = seen.get(key);
      if (!had) { seen.set(key, d); continue; }
      // keep the Regulations.gov form link when both sources know the proceeding
      if (had.provider !== 'regulations_gov' && d.provider === 'regulations_gov') seen.set(key, { ...d, also_in: ['federal_register'] });
      else if (!had.also_in) had.also_in = [d.provider];
    }
  }
  return [...seen.values()].sort((a, b) => String(a.comment_end || '9999').localeCompare(String(b.comment_end || '9999')));
}

export async function listOpenComments(query, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const providers = {};
  const lists = [];
  const key = env && env[REGULATIONS_GOV_KEY_ENV];
  if (!key) {
    providers.regulations_gov = { status: 'not_configured', env: REGULATIONS_GOV_KEY_ENV };
  } else {
    try {
      const docs = normalizeRegulationsGov(await upstream(regulationsGovUrl(query), { headers: { 'x-api-key': key } }, fetchImpl));
      providers.regulations_gov = { status: 'ok', count: docs.length };
      lists.push(docs);
    } catch (e) {
      providers.regulations_gov = { status: 'error', error: String(e && e.message || e).replace(key, '[key]').slice(0, 120) };
    }
  }
  try {
    const docs = normalizeFederalRegister(await upstream(federalRegisterUrl(query, now), {}, fetchImpl), now);
    providers.federal_register = { status: 'ok', count: docs.length };
    lists.push(docs);
  } catch (e) {
    providers.federal_register = { status: 'error', error: String(e && e.message || e).slice(0, 120) };
  }
  const anyOk = Object.values(providers).some((p) => p.status === 'ok');
  return {
    ok: anyOk,
    query,
    fetched_at: new Date(now).toISOString(),
    providers,
    documents: anyOk ? mergeDocuments(lists) : [],
    state_match: query.state ? 'mentions' : null,
    submission: 'official_form_only',
    attribution: 'Regulations.gov (GSA) and the Federal Register (Office of the Federal Register / GPO)'
  };
}

/* The member's draft, checked against the official limits, and where to file it. Nothing is stored or sent. */
export function commentHandoff({ comment_url, text } = {}) {
  const url = httpsOrNull(comment_url);
  if (!url || !/^https:\/\/(www\.)?(regulations\.gov|federalregister\.gov)\//.test(url)) {
    return { ok: false, error: 'Pick a proceeding from the list first.' };
  }
  const body = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
  if (!body) return { ok: false, error: 'Write your comment first.' };
  const chars = [...body].length;
  const emoji = /\p{Extended_Pictographic}/u.test(body);
  return {
    ok: chars <= COMMENT_MAX_CHARS,
    comment_url: url,
    text: body,
    chars,
    max_chars: COMMENT_MAX_CHARS,
    warnings: [
      ...(chars > COMMENT_MAX_CHARS ? [`Over ${COMMENT_MAX_CHARS} characters: shorten it or attach a file on the official form.`] : []),
      ...(emoji ? ['Some official forms reject emoji.'] : [])
    ],
    filed_by: 'you',
    next: 'Open the official form, paste your comment, and submit it there yourself. Keep the tracking number it gives you as your proof.'
  };
}

function cacheKey(query) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString();
  return new Request(`https://cache.mccluster.internal/public-comment/open?${q}`);
}

export async function handlePublicComment(request, env, { fetchImpl = fetch, cacheImpl = null, now = Date.now() } = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/public-comment/open' && url.pathname !== '/v1/public-comment/handoff') return null;
  if (!enabled(env)) return fail(request, env, 'Not found', 404);
  const user = await bearerUser(request, env, fetchImpl);
  if (!user) return fail(request, env, 'Sign in to find a comment period', 401, { members_only: true });

  if (url.pathname === '/v1/public-comment/handoff') {
    if (request.method !== 'POST') return fail(request, env, 'Method not allowed', 405);
    const body = await request.json().catch(() => ({}));
    const out = commentHandoff(body || {});
    const res = reply(request, env, out, out.ok || out.chars ? 200 : 400);
    res.headers.set('cache-control', 'private, no-store');
    return res;
  }

  if (request.method !== 'GET') return fail(request, env, 'Method not allowed', 405);
  const query = parseQuery(url);
  const store = cacheImpl || (globalThis.caches && globalThis.caches.default) || null;
  const key = cacheKey(query);
  let body = null;
  if (store) {
    const hit = await store.match(key).catch(() => null);
    if (hit) body = await hit.json().catch(() => null);
  }
  if (!body || !body.fetched_at || now - Date.parse(body.fetched_at) >= TTL * 1000) {
    body = await listOpenComments(query, env, { fetchImpl, now });
    // only a good answer is kept; a failure is retried on the next request
    if (store && body.ok) await store.put(key, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${TTL}` } })).catch(() => {});
  }
  const res = reply(request, env, body, body.ok ? 200 : 502);
  res.headers.set('cache-control', 'private, no-store');
  res.headers.set('vary', 'origin, authorization');
  return res;
}
