/* Bridgeport City Council roster parser (proposed pilot). Input is the list of
   roster entries observed on the official council page. The page asserts a
   name and a district; it does not establish effective term dates, so terms
   are recorded as 'current' with null dates and coverage 'partial' until the
   clerk's records supply them. Personal contact details are never copied
   (contact-data minimisation). Pure; no network. */
import { provenance, intakeRecord } from '../provenance.js';

export const PARSER_VERSION = 'eup.bridgeport-council/1';
export const SOURCE_ID = 'official_bridgeport_council';
const RIGHTS = 'bridgeport-public-page-2026-11-unreviewed';
export const BRIDGEPORT_JURISDICTION = 'ct-bridgeport';
const URL = 'https://www.bridgeportct.gov/government/departments/city-council';

export function parseBridgeportCouncilRoster(entries, { fetched_at, raw_hash = null, observed_at = null }) {
  if (!Array.isArray(entries)) throw Object.assign(new Error('roster must be an array'), { status: 400, reason: 'parse_failed' });
  const base = { source_id: SOURCE_ID, url: URL, fetched_at, observed_at, parser_version: PARSER_VERSION, rights_revision: RIGHTS, coverage: 'partial' };
  const districts = new Map(); const persons = []; const terms = [];
  for (const e of entries) {
    const district = String(e?.district || '').trim(); const name = String(e?.name || '').trim();
    if (!/^\d{3}$/.test(district) || !name) continue;
    const seat = String(e.seat || '1');
    if (!districts.has(district)) districts.set(district, intakeRecord(`district:${district}`, {
      jurisdiction_external_id: BRIDGEPORT_JURISDICTION, title: `City Council, District ${district}`, office_type: 'legislative', seats: 2
    }, provenance({ ...base, source_record_id: `district:${district}` }), raw_hash));
    const personId = `person:${district}:${seat}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    persons.push(intakeRecord(personId, { display_name: name, external_ids: { roles: e.role ? [String(e.role)] : [] } }, provenance({ ...base, source_record_id: personId }), raw_hash));
    terms.push(intakeRecord(`term:${district}:${seat}:${personId}`, {
      office_external_id: `district:${district}`, seat_label: seat, person_external_id: personId, status: 'current', start_date: null, end_date: null
    }, provenance({ ...base, source_record_id: `term:${district}:${seat}`, coverage: 'partial' }), raw_hash));
  }
  return { offices: [...districts.values()], persons, terms };
}
