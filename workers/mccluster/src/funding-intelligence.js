/* Funding Opportunity Intelligence — canonical Worker, owner-gated at the router.
   Read-only external discovery. No grant application, payment, bounty publication,
   or promise of award. Never call with an unchecked identity. */
import { fail, reply } from './lib/http.js';
import { evaluateFundingRegister, FUNDING_REGISTER_VERSION } from './funding-requirements.js';

export const FUNDING_PREFIX = '/v1/control/funding';
const GRANTS_URL = 'https://api.grants.gov/v1/api/search2';
const AWARDS_URL = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const GRANTS_SOURCE = 'https://www.grants.gov/api/common/search2';
const AWARDS_SOURCE = 'https://api.usaspending.gov/docs/endpoints';
const MAX_ROWS = 12, MAX_KEYWORD = 90;

function cleanKeyword(v) {
  const keyword = String(v || '').trim().replace(/\s+/g, ' ');
  return keyword.length <= MAX_KEYWORD && /^[\p{L}\p{N}\s&.,\-'()/]+$/u.test(keyword) ? keyword : null;
}
const text = (v, n = 250) => String(v ?? '').slice(0, n);
export function possibleMissionFamilies(title) {
  const s = String(title || '').toLowerCase(), keys = [];
  if (/health|medicaid|snap|nutrition|coverage|benefits|public health/.test(s)) keys.push('health_resource_outreach');
  if (/workforce|job|employment|economic mobil|career|apprentice/.test(s)) keys.push('workforce_support');
  if (/environment|climate|garden|conserv|green|restoration/.test(s)) keys.push('community_environment');
  if (/housing|homeless|shelter/.test(s)) keys.push('housing_navigation');
  if (/city|municipal|public service|311|government technolog/.test(s)) keys.push('municipal_service_navigation');
  return keys; // Suggestions only. Never auto-create or activate a mission.
}
function sanitizeHit(hit) {
  if (!hit || typeof hit !== 'object') return null;
  const id = String(hit.id || '');
  const safeId = /^\d{1,12}$/.test(id) ? id : null;
  const title = text(hit.title, 230);
  if (!title) return null;
  return {
    source: 'grants_gov', source_id: text(hit.number || id, 90), title,
    agency: text(hit.agencyName || hit.agencyCode, 180),
    status: text(hit.oppStatus, 40).toLowerCase(),
    opens_on: text(hit.openDate, 30), closes_on: text(hit.closeDate, 30),
    source_url: safeId ? 'https://www.grants.gov/search-results-detail/' + safeId : 'https://www.grants.gov/search-grants',
    suggested_mission_families: possibleMissionFamilies(title),
    funding_authorized: false
  };
}
function sanitizeAward(row) {
  if (!row || typeof row !== 'object') return null;
  const title = text(row.Description || row['Award ID'], 250);
  if (!title) return null;
  return {
    source: 'usaspending', award_id: text(row['Award ID'], 100),
    title, recipient: text(row['Recipient Name'], 170),
    agency: text(row['Awarding Agency'], 170),
    obligated_amount: row['Award Amount'] !== null && row['Award Amount'] !== '' && Number.isFinite(Number(row['Award Amount'])) ? Number(row['Award Amount']) : null,
    start_date: text(row['Start Date'], 30), end_date: text(row['End Date'], 30),
    source_url: 'https://www.usaspending.gov/',
    suggested_mission_families: possibleMissionFamilies(title),
    funding_authorized: false
  };
}
async function jsonPost(url, data, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    // Fixed upstream URLs only. Manual redirects prevent requests to arbitrary hosts.
    const r = await fetchImpl(url, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(data)
    });
    if (!r.ok) throw new Error('Upstream HTTP ' + r.status);
    if (Number(r.headers.get('content-length') || 0) > 524288 || !r.body) throw new Error('Response too large or empty');
    const reader = r.body.getReader(), chunks = []; let size = 0;
    try { for (;;) { const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 524288) { await reader.cancel(); throw new Error('Response too large'); } chunks.push(value);
    }} finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid upstream response');
    return parsed;
  } finally { clearTimeout(timeout); }
}
function privateReply(req, env, payload) {
  const r = reply(req, env, payload);
  r.headers.set('cache-control', 'private, no-store');
  r.headers.set('vary', 'authorization, origin');
  r.headers.set('x-robots-tag', 'noindex, nofollow');
  return r;
}
export async function handleFundingIntelligence(request, env, { fetchImpl = fetch, read = null } = {}) {
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '');
  if (!path.startsWith(FUNDING_PREFIX)) return null;
  if (request.method !== 'GET') return fail(request, env, 'Method not allowed', 405);
  if (path === FUNDING_PREFIX + '/register') {
    const route = url.searchParams.get('route_id');
    if (route !== null && !/^[CDORN]\d{2}$/.test(route)) return fail(request, env, 'Invalid funding route identifier', 400);
    if (!read) return fail(request, env, 'Catalog connection unavailable', 503);
    try {
      const filter = route ? '&criteria_register->>route_id=eq.' + route : '';
      const rows = await read('action_funding_opportunities?select=opportunity_id,funder_name,program_title,source_url,availability,criteria_register' +
        '&order=opportunity_id.asc&limit=101' + filter);
      if (!Array.isArray(rows)) throw new Error('Invalid catalog response');
      const selected = route ? rows.filter(row => row.criteria_register?.route_id === route) : rows;
      return privateReply(request, env, {
        ok: true, schema_state: 'installed', projection_version: FUNDING_REGISTER_VERSION,
        source: 'action_funding_opportunities', checked_at: new Date().toISOString(),
        items: selected.slice(0, 100).map(row => evaluateFundingRegister(row, { details: !!route })),
        completeness: { state: selected.length > 100 ? 'truncated' : 'complete', limit: 100 },
        funding_authorized: false, payout_enabled: false,
        applicant_review: 'Requires an authorized private applicant record; catalog facts cannot establish eligibility.'
      });
    } catch (error) {
      // PostgREST reports an absent selected column as 400/PGRST204; an absent
      // relation can be 404. Neither is an empty opportunity market.
      const missing = [400, 404, 406].includes(error?.status);
      return privateReply(request, env, {
        ok: false, schema_state: missing ? 'not_installed' : 'unavailable', items: [],
        projection_version: FUNDING_REGISTER_VERSION,
        message: missing ? 'Funding criteria register migration has not been installed.' : 'Funding criteria register could not be read.',
        completeness: { state: 'unavailable', limit: 100 }, funding_authorized: false, payout_enabled: false
      });
    }
  }
  if (path === FUNDING_PREFIX + '/catalog') {
    if (!read) return fail(request, env, 'Catalog connection unavailable', 503);
    // These relations must exist before Control can show drafts; missing is
    // explicitly "not installed" rather than silently fabricating records.
    try {
      const [opportunities, drafts] = await Promise.all([
        read('action_funding_opportunities?select=opportunity_id,funder_name,program_title,source_kind,availability,source_url,eligibility_note,reviewed_at&order=funder_name.asc&limit=100'),
        read('action_partner_mission_drafts?select=draft_id,opportunity_id,presenting_to,title,mission_category,instruction,metric_keys,proof_policy,relationship_status,status,visibility,claim_enabled,compensation_cents&order=draft_id.asc&limit=100')
      ]);
      // Fail closed even if a bad data migration made draft rows public.
      return privateReply(request, env, {
        ok: true, source: 'supabase_private', schema_state: 'installed',
        opportunities: Array.isArray(opportunities) ? opportunities : [],
        drafts: Array.isArray(drafts) ? drafts.filter(d => d.status === 'draft' && d.visibility === 'admin_only' && d.claim_enabled === false && d.compensation_cents === null) : [],
        payout_enabled: false
      });
    } catch (error) {
      const missing = [404, 406].includes(error?.status);
      return privateReply(request, env, {
        ok: false, schema_state: missing ? 'not_installed' : 'unavailable',
        message: missing ? 'Private funding catalog migration has not been installed.' : 'Private funding catalog could not be read.',
        opportunities: [], drafts: [], payout_enabled: false
      });
    }
  }
  if (path === FUNDING_PREFIX + '/search' || path === FUNDING_PREFIX + '/awards') {
    const keyword = cleanKeyword(url.searchParams.get('keyword'));
    if (!keyword) return fail(request, env, 'Provide a valid search term (1–90 characters)', 400);
    try {
      if (path.endsWith('/search')) {
        const payload = {
          rows: MAX_ROWS, keyword, oppStatuses: 'posted|forecasted', eligibilities: '',
          agencies: '', oppNum: '', aln: '', fundingCategories: ''
        };
        const raw = await jsonPost(GRANTS_URL, payload, fetchImpl);
        if (raw.errorcode !== 0 || !raw.data || !Array.isArray(raw.data.oppHits)) throw new Error('Grants.gov search response unavailable');
        return privateReply(request, env, {
          ok: true, kind: 'opportunities', provider: 'Grants.gov',
          search_term: keyword, checked_at: new Date().toISOString(),
          source_url: GRANTS_SOURCE,
          total: Math.max(0, Number(raw.data.hitCount) || 0),
          items: raw.data.oppHits.slice(0, MAX_ROWS).map(sanitizeHit).filter(Boolean)
        });
      }
      const raw = await jsonPost(AWARDS_URL, {
        filters: { keywords: [keyword], award_type_codes: ['02', '03', '04', '05'] },
        fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Description', 'Start Date', 'End Date', 'Awarding Agency'],
        page: 1, limit: MAX_ROWS, sort: 'Award Amount', order: 'desc', spending_level: 'awards'
      }, fetchImpl);
      if (!Array.isArray(raw.results)) throw new Error('USAspending award response unavailable');
      return privateReply(request, env, {
        ok: true, kind: 'past_awards', provider: 'USAspending.gov',
        search_term: keyword, checked_at: new Date().toISOString(),
        source_url: AWARDS_SOURCE,
        items: raw.results.slice(0, MAX_ROWS).map(sanitizeAward).filter(Boolean),
        caveat: 'Historical federal awards are not available funds or an authorization to spend.'
      });
    } catch (error) {
      return privateReply(request, env, {
        ok: false, kind: path.endsWith('/search') ? 'opportunities' : 'past_awards',
        checked_at: new Date().toISOString(), items: [],
        message: 'The official funding data provider was unavailable. No zero-result claim is made.'
      });
    }
  }
  return fail(request, env, 'Not found', 404);
}
