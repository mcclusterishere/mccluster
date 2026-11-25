/* SEC EDGAR parsers: submissions (identity + address assertions) and
   companyfacts (XBRL facts). Pure functions over already-fetched JSON; no
   network. SEC is a filings/facts source, never a stock-price feed. An address
   in a filing is that filing's assertion with its own location kind; it is
   never promoted to a geocoded headquarters here (geocoding needs its own
   permitted source and precision record). */
import { provenance, intakeRecord } from '../provenance.js';

export const PARSER_VERSION = 'eup.sec/1';
export const SOURCE_ID = 'sec_edgar';
const RIGHTS = 'sec-edgar-public-2026-11';

const cik10 = (value) => String(value ?? '').replace(/\D/g, '').padStart(10, '0');

export function parseSecSubmissions(json, { fetched_at, raw_hash = null }) {
  if (!json || typeof json !== 'object' || !json.cik) throw Object.assign(new Error('SEC submissions record has no cik'), { status: 400, reason: 'parse_failed' });
  const cik = cik10(json.cik);
  const url = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const base = { source_id: SOURCE_ID, url, fetched_at, parser_version: PARSER_VERSION, rights_revision: RIGHTS, coverage: 'partial' };
  const identifiers = [{ scheme: 'cik', value: cik }];
  for (const t of json.tickers || []) if (typeof t === 'string' && t) identifiers.push({ scheme: 'ticker', value: t.toUpperCase() });
  const company = intakeRecord(`cik:${cik}`, { legal_name: String(json.name || '').trim(), status: json.entityType ? String(json.entityType) : 'unknown', identifiers },
    provenance({ ...base, source_record_id: `submissions:${cik}` }), raw_hash);
  const locations = [];
  for (const [kind, key] of [['registered_office', 'business'], ['mailing_address', 'mailing']]) {
    const a = json.addresses?.[key];
    if (!a || !(a.street1 || a.city)) continue;
    locations.push(intakeRecord(`cik:${cik}:${key}`, {
      identifier_scheme: 'cik', identifier_value: cik, kind,
      address: { street1: a.street1 || null, street2: a.street2 || null, city: a.city || null, state: a.stateOrCountry || null, postal_code: a.zipCode || null, country: a.stateOrCountryDescription || null },
      geocode: null
    }, provenance({ ...base, source_record_id: `submissions:${cik}:${key}`, coverage: 'partial' }), raw_hash));
  }
  return { company, locations };
}

/* Facts: one record per (concept, unit, period, accession). A later filing that
   restates the same concept/period becomes a separate fact marked amended by
   the store (it supersedes, never overwrites). */
export function parseSecCompanyFacts(json, { fetched_at, raw_hash = null, concepts = null, limit = 500 }) {
  if (!json || typeof json !== 'object' || !json.cik) throw Object.assign(new Error('SEC companyfacts record has no cik'), { status: 400, reason: 'parse_failed' });
  const cik = cik10(json.cik);
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const out = [];
  for (const [taxonomy, byConcept] of Object.entries(json.facts || {})) {
    for (const [concept, body] of Object.entries(byConcept || {})) {
      const name = `${taxonomy}:${concept}`;
      if (concepts && !concepts.includes(name)) continue;
      for (const [unit, points] of Object.entries(body.units || {})) {
        for (const p of points || []) {
          if (!p || typeof p.val !== 'number' || !p.end || !p.accn) continue;
          const [cur] = unit.split('/');
          out.push(intakeRecord(`${cik}:${name}:${unit}:${p.start || ''}:${p.end}:${p.accn}`, {
            identifier_scheme: 'cik', identifier_value: cik, concept: name, period_start: p.start || null, period_end: p.end,
            unit, currency: /^[A-Z]{3}$/.test(cur) ? cur : null, value: p.val, form: p.form || null, filed: p.filed || null
          }, provenance({ source_id: SOURCE_ID, source_record_id: `companyfacts:${cik}:${p.accn}:${name}:${p.end}`, url, fetched_at, upstream_updated_at: p.filed || null, parser_version: PARSER_VERSION, rights_revision: RIGHTS, coverage: 'partial' }), raw_hash));
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}
