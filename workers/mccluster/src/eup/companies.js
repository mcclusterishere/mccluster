/* E=Up Companies & Finance reads. Identity (CIK, LEI, ticker) and typed
   locations are kept separate: an exchange listing is never shown as a
   headquarters, and a location without a sourced geocode has geocode null.
   Facts carry period/unit/currency and amendment lineage; awards keep agency,
   recipient, obligation/outlay and place of performance apart from any
   officeholder. `quote` is always null until a separately licensed quote
   succeeds (market_prices is held); this module never calls the finance or
   world-markets adapters. Owner-only (router). */
import { companyRead, readSourceStates, withholdRestricted } from './intake.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PIN_KINDS = new Set(['headquarters', 'facility', 'place_of_performance']);

function pin(location) {
  if (!PIN_KINDS.has(location.kind) || location.lat === null || location.lat === undefined) return null;
  return { lat: location.lat, lon: location.lon, precision: location.geocode_precision || null, method: location.geocode_method || null, kind: location.kind };
}

export function projectCompany(record, states, now) {
  const keep = (rows) => withholdRestricted(rows, states, { now });
  const locations = keep(record.locations || []).rows.map((l) => ({
    kind: l.kind, address: l.address, effective_from: l.effective_from, effective_to: l.effective_to,
    geocode: l.lat === null || l.lat === undefined ? null : { lat: l.lat, lon: l.lon, precision: l.geocode_precision, method: l.geocode_method },
    pin: pin(l), provenance: l.provenance
  }));
  const facts = keep(record.facts || []).rows.map((f) => ({ concept: f.concept, period: { start: f.period_start, end: f.period_end }, unit: f.unit, currency: f.currency, value: f.value, amended: f.amended, supersedes: f.supersedes, provenance: f.provenance }));
  const awards = keep(record.awards || []).rows.map((a) => ({ award_id: a.external_id, agency: a.agency, recipient: a.recipient, obligation: a.obligation, outlay: a.outlay, period: { start: a.period_start, end: a.period_end }, place_of_performance: a.place_of_performance, provenance: a.provenance, note: 'Reported federal award; not evidence that any officeholder caused it.' }));
  return {
    entity: { id: record.entity.id, legal_name: record.entity.legal_name, status: record.entity.status, review_state: record.entity.review_state, revision: record.entity.revision, provenance: record.entity.provenance },
    identifiers: (record.identifiers || []).map((i) => ({ scheme: i.scheme, value: i.value })),
    locations, facts, awards,
    headquarters_pin: locations.find((l) => l.kind === 'headquarters' && l.pin)?.pin || null,
    quote: null, quote_note: 'Market quotes are held pending verified provider, feed, display and storage rights.'
  };
}

export async function handleCompanies(request, env, ctx) {
  const { parts, url, fail } = ctx;
  if (request.method !== 'GET') throw fail(405, 'Companies & Finance is read-only in this release', 'read_only');
  let states = [];
  try { states = await readSourceStates(env, ctx); } catch (error) { if (error?.reason !== 'storage_unavailable') throw error; }
  if (parts[0] === 'search' && parts.length === 1) {
    const q = String(url.searchParams.get('q') || '').trim();
    if (q.length < 2 || q.length > 120) throw fail(400, 'q must be 2-120 characters', 'invalid_request');
    const rows = await companyRead(env, ctx, 'search', { q });
    const { rows: kept, withheld } = withholdRestricted(Array.isArray(rows) ? rows : [], states, { now: ctx.now() });
    return { ok: true, results: kept.map((r) => ({ id: r.id, legal_name: r.legal_name, status: r.status, review_state: r.review_state, identifiers: r.identifiers })), count: kept.length, withheld };
  }
  if (parts.length === 1 && UUID.test(parts[0])) {
    const record = await companyRead(env, ctx, 'get', { id: parts[0] });
    if (!record?.entity) throw fail(404, 'Company not found', 'not_found');
    const { rows } = withholdRestricted([record.entity], states, { now: ctx.now() });
    if (!rows.length) throw fail(403, 'This record is withheld pending rights review', 'rights_withheld');
    return { ok: true, company: projectCompany(record, states, ctx.now()) };
  }
  throw fail(404, 'Unknown companies route', 'not_found');
}
