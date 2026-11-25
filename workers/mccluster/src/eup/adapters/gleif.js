/* GLEIF LEI record parser. Legal address and headquarters address are
   different assertions and stay different location kinds; registration status
   (ISSUED/LAPSED/RETIRED) is kept. CC0 LEI data; geocoding is not part of the
   record and is left null. Pure; no network. */
import { provenance, intakeRecord } from '../provenance.js';

export const PARSER_VERSION = 'eup.gleif/1';
export const SOURCE_ID = 'gleif';
const RIGHTS = 'gleif-cc0-2026-11';

const addr = (a) => ({ street1: a?.addressLines?.[0] || null, street2: a?.addressLines?.[1] || null, city: a?.city || null, region: a?.region || null, postal_code: a?.postalCode || null, country: a?.country || null });

export function parseGleifRecord(json, { fetched_at, raw_hash = null }) {
  const data = json?.data?.attributes ? json.data : json;
  const attributes = data?.attributes;
  const lei = String(attributes?.lei || data?.id || '').trim();
  if (!/^[A-Z0-9]{20}$/.test(lei)) throw Object.assign(new Error('GLEIF record has no valid LEI'), { status: 400, reason: 'parse_failed' });
  const url = `https://api.gleif.org/api/v1/lei-records/${lei}`;
  const entity = attributes.entity || {};
  const registration = attributes.registration || {};
  const base = { source_id: SOURCE_ID, url, fetched_at, upstream_updated_at: registration.lastUpdateDate || null, parser_version: PARSER_VERSION, rights_revision: RIGHTS, coverage: 'partial' };
  const company = intakeRecord(`lei:${lei}`, {
    legal_name: String(entity.legalName?.name || '').trim(), status: String(registration.status || entity.status || 'unknown').toLowerCase(),
    identifiers: [{ scheme: 'lei', value: lei }], reported_parent: attributes.relationships?.directParent?.links?.['lei-record'] ? 'reported' : 'none_or_exception'
  }, provenance({ ...base, source_record_id: `lei:${lei}` }), raw_hash);
  const locations = [];
  if (entity.legalAddress) locations.push(intakeRecord(`lei:${lei}:legal`, { identifier_scheme: 'lei', identifier_value: lei, kind: 'registered_office', address: addr(entity.legalAddress), geocode: null }, provenance({ ...base, source_record_id: `lei:${lei}:legal` }), raw_hash));
  if (entity.headquartersAddress) locations.push(intakeRecord(`lei:${lei}:hq`, { identifier_scheme: 'lei', identifier_value: lei, kind: 'headquarters', address: addr(entity.headquartersAddress), geocode: null }, provenance({ ...base, source_record_id: `lei:${lei}:hq` }), raw_hash));
  return { company, locations };
}
