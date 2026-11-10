/* The Connecticut / Bridgeport bounded pilot as SYNTHETIC intake records, in
   apply order. Jurisdiction names and source URLs are real public identifiers;
   every person, vote count, bill text and company is invented. This is a
   proposed pilot for review, not an owner choice or a coverage limit. */
const FETCHED = '2026-11-09T12:00:00.000Z';
const prov = (source_id, source_record_id, url, extra = {}) => ({
  source_id, source_record_id, url, fetched_at: FETCHED, observed_at: FETCHED, effective_from: null, effective_to: null, upstream_updated_at: null,
  parser_version: 'eup.pilot-fixture/1', raw_hash: null, rights_revision: 'pilot-fixture-2026-11', review_state: 'intake', coverage: 'partial', ...extra
});
const rec = (source_id, external_id, fields, url, raw_hash = null, extra = {}) => ({ external_id, ...fields, raw_hash, provenance: prov(source_id, external_id, url, extra) });

const CIVIC = 'official_ct_offices';
const CGA = 'official_ct_legislation';
const ELEC = 'official_ct_elections';
const SEC = 'sec_edgar';
const GLEIF = 'gleif';
const USAS = 'usaspending';
const CT_URL = 'https://portal.ct.gov/SOTS/Register-Manual/Section-VII/Towns-Cities-and-Boroughs--Officers-and-Statistics';
const BPT_URL = 'https://www.bridgeportct.gov/government/departments/city-council';
const CGA_URL = 'https://www.cga.ct.gov/asp/cgabillstatus/cgabillstatus.asp?selBillType=Bill&bill_num=HB90042&which_year=2026';
const ELEC_URL = 'https://portal.ct.gov/sots/Election-Services/Election-Results/Election-Results';

export function pilotRecords() {
  return [
    { source_id: CIVIC, kind: 'jurisdiction', records: [
      rec(CIVIC, 'us', { country_code: 'US', level: 'country', name: 'United States', parent_external_id: null, external_ids: { iso: 'US' } }, CT_URL, 'h-us'),
      rec(CIVIC, 'ct-state', { country_code: 'US', level: 'state', name: 'Connecticut', parent_external_id: 'us', external_ids: { fips: '09', usps: 'CT' } }, CT_URL, 'h-ct'),
      rec(CIVIC, 'ct-fairfield', { country_code: 'US', level: 'county', name: 'Fairfield County (historical)', parent_external_id: 'ct-state', external_ids: { fips: '09001' } }, CT_URL, 'h-ff'),
      rec(CIVIC, 'ct-bridgeport', { country_code: 'US', level: 'municipality', name: 'Bridgeport', parent_external_id: 'ct-state', external_ids: { fips_place: '0908000' } }, BPT_URL, 'h-bpt'),
      rec(CIVIC, 'ct-bridgeport-d130', { country_code: 'US', level: 'ward', name: 'Council District 130', parent_external_id: 'ct-bridgeport', external_ids: {} }, BPT_URL, 'h-d130'),
      rec(CIVIC, 'ct-hd-128', { country_code: 'US', level: 'district', name: 'State House District 128', parent_external_id: 'ct-state', external_ids: {} }, CT_URL, 'h-hd128')
    ] },
    /* a state house district overlaps the city; it is not inside the ward tree */
    { source_id: CIVIC, kind: 'jurisdiction_relation', records: [
      rec(CIVIC, 'rel:bpt-hd128', { parent_external_id: 'ct-bridgeport', child_external_id: 'ct-hd-128', relation: 'overlaps' }, CT_URL, 'h-rel1'),
      rec(CIVIC, 'rel:ff-bpt', { parent_external_id: 'ct-fairfield', child_external_id: 'ct-bridgeport', relation: 'contains' }, CT_URL, 'h-rel2')
    ] },
    { source_id: CIVIC, kind: 'boundary', records: [
      rec(CIVIC, 'tiger:2025:09:place', { jurisdiction_external_id: 'ct-bridgeport', vintage: '2025', effective_from: '2025-01-01', effective_to: null, geometry_ref: null }, 'https://www2.census.gov/geo/tiger/TIGER2025/PLACE/tl_2025_09_place.zip', 'h-tiger')
    ] },
    { source_id: CIVIC, kind: 'office', records: [
      rec(CIVIC, 'office:bpt-mayor', { jurisdiction_external_id: 'ct-bridgeport', title: 'Mayor', office_type: 'executive', seats: 1 }, BPT_URL, 'h-o1'),
      rec(CIVIC, 'office:bpt-d130', { jurisdiction_external_id: 'ct-bridgeport-d130', title: 'City Council, District 130', office_type: 'legislative', seats: 2 }, BPT_URL, 'h-o2'),
      rec(CIVIC, 'office:bpt-clerk', { jurisdiction_external_id: 'ct-bridgeport', title: 'City Clerk', office_type: 'administrative', seats: 1 }, BPT_URL, 'h-o3')
    ] },
    { source_id: CIVIC, kind: 'person', records: [
      rec(CIVIC, 'person:a', { display_name: 'Synthetic Officeholder A', external_ids: {} }, BPT_URL, 'h-pa'),
      rec(CIVIC, 'person:b', { display_name: 'Synthetic Officeholder B', external_ids: {} }, BPT_URL, 'h-pb'),
      rec(CIVIC, 'person:c', { display_name: 'Synthetic Former Officeholder C', external_ids: {} }, BPT_URL, 'h-pc'),
      rec(CIVIC, 'person:d', { display_name: 'Synthetic Candidate D', external_ids: {} }, ELEC_URL, 'h-pd')
    ] },
    { source_id: CIVIC, kind: 'term', records: [
      rec(CIVIC, 'term:mayor:current', { office_external_id: 'office:bpt-mayor', seat_label: '1', person_external_id: 'person:a', status: 'current', start_date: '2023-12-01', end_date: null }, BPT_URL, 'h-t1'),
      rec(CIVIC, 'term:mayor:former', { office_external_id: 'office:bpt-mayor', seat_label: '1', person_external_id: 'person:c', status: 'former', start_date: '2019-12-01', end_date: '2023-11-30' }, BPT_URL, 'h-t2'),
      rec(CIVIC, 'term:d130:1', { office_external_id: 'office:bpt-d130', seat_label: '1', person_external_id: 'person:b', status: 'current', start_date: '2025-12-01', end_date: null }, BPT_URL, 'h-t3'),
      rec(CIVIC, 'term:d130:2', { office_external_id: 'office:bpt-d130', seat_label: '2', person_external_id: null, status: 'vacant', start_date: '2026-03-01', end_date: null }, BPT_URL, 'h-t4')
    ] },
    { source_id: CGA, kind: 'jurisdiction', records: [ rec(CGA, 'ct-state', { country_code: 'US', level: 'state', name: 'Connecticut', parent_external_id: null, external_ids: { fips: '09' } }, CGA_URL, 'h-cga-ct') ] },
    { source_id: CGA, kind: 'committee', records: [ rec(CGA, 'committee:ET', { jurisdiction_external_id: 'ct-state', name: 'Joint Committee on Energy and Technology', chamber: 'Joint' }, CGA_URL, 'h-cm') ] },
    { source_id: CGA, kind: 'bill', records: [
      rec(CGA, 'bill:2026-HB90042', { jurisdiction_external_id: 'ct-state', body: 'House', session: '2026', identifier: 'HB 90042', title: 'An Act Concerning Synthetic Grid Resilience Reporting', status: 'Referred to committee', enacted: false, enacted_at: null, effective_at: null, text_hash: 'cga:2026-HB90042:raised', version_label: 'Raised Bill', text_published_at: '2026-02-10' }, CGA_URL, 'h-b1')
    ] },
    { source_id: CGA, kind: 'bill_action', records: [
      rec(CGA, 'action:2026-HB90042:1', { bill_external_id: 'bill:2026-HB90042', action_at: '2026-02-10', chamber: 'House', description: 'Referred to Joint Committee on Energy and Technology', committee_external_id: 'committee:ET' }, CGA_URL, 'h-a1')
    ] },
    { source_id: ELEC, kind: 'jurisdiction', records: [ rec(ELEC, 'ct-bridgeport', { country_code: 'US', level: 'municipality', name: 'Bridgeport', parent_external_id: null, external_ids: { fips_place: '0908000' } }, ELEC_URL, 'h-el-bpt') ] },
    { source_id: ELEC, kind: 'office', records: [ rec(ELEC, 'office:bpt-mayor', { jurisdiction_external_id: 'ct-bridgeport', title: 'Mayor', office_type: 'executive', seats: 1 }, ELEC_URL, 'h-el-o1') ] },
    { source_id: ELEC, kind: 'person', records: [
      rec(ELEC, 'person:a', { display_name: 'Synthetic Officeholder A', external_ids: {} }, ELEC_URL, 'h-el-pa'),
      rec(ELEC, 'person:d', { display_name: 'Synthetic Candidate D', external_ids: {} }, ELEC_URL, 'h-el-pd')
    ] },
    { source_id: ELEC, kind: 'election_contest', records: [
      rec(ELEC, 'contest:2027-bpt-mayor', { jurisdiction_external_id: 'ct-bridgeport', office_external_id: 'office:bpt-mayor', name: 'Mayor of Bridgeport, 2027 municipal election (synthetic)', election_date: '2027-11-02', term_starts_on: '2027-12-01' }, ELEC_URL, 'h-ec')
    ] },
    { source_id: ELEC, kind: 'candidacy', records: [
      rec(ELEC, 'cand:2027-bpt-mayor:a', { contest_external_id: 'contest:2027-bpt-mayor', person_external_id: 'person:a', party: 'Synthetic Party 1', registration_status: 'registered' }, ELEC_URL, 'h-c1'),
      rec(ELEC, 'cand:2027-bpt-mayor:d', { contest_external_id: 'contest:2027-bpt-mayor', person_external_id: 'person:d', party: 'Synthetic Party 2', registration_status: 'registered' }, ELEC_URL, 'h-c2')
    ] },
    { source_id: ELEC, kind: 'election_result', records: [
      rec(ELEC, 'result:2027-bpt-mayor:a:preliminary', { candidacy_external_id: 'cand:2027-bpt-mayor:a', stage: 'preliminary', votes: 10001, certified_at: null }, ELEC_URL, 'h-r1'),
      rec(ELEC, 'result:2027-bpt-mayor:d:preliminary', { candidacy_external_id: 'cand:2027-bpt-mayor:d', stage: 'preliminary', votes: 9000, certified_at: null }, ELEC_URL, 'h-r2')
    ] },
    { source_id: SEC, kind: 'company', records: [
      rec(SEC, 'cik:0001234567', { legal_name: 'Synthetic Grid Components Inc', status: 'operating', identifiers: [{ scheme: 'cik', value: '0001234567' }, { scheme: 'ticker', value: 'SYNG' }] }, 'https://data.sec.gov/submissions/CIK0001234567.json', 'h-co')
    ] },
    { source_id: SEC, kind: 'company_location', records: [
      rec(SEC, 'cik:0001234567:business', { identifier_scheme: 'cik', identifier_value: '0001234567', kind: 'registered_office', address: { street1: '1 Synthetic Way', city: 'Stamford', state: 'CT' }, geocode: null }, 'https://data.sec.gov/submissions/CIK0001234567.json', 'h-l1'),
      rec(SEC, 'cik:0001234567:exchange', { identifier_scheme: 'cik', identifier_value: '0001234567', kind: 'exchange', address: { name: 'Nasdaq', city: 'New York', state: 'NY' }, geocode: { lat: 40.7569, lon: -73.9860, precision: 'street', method: 'fixture' } }, 'https://data.sec.gov/submissions/CIK0001234567.json', 'h-l2')
    ] },
    { source_id: SEC, kind: 'company_fact', records: [
      rec(SEC, 'fact:rev:2025:orig', { identifier_scheme: 'cik', identifier_value: '0001234567', concept: 'us-gaap:Revenues', period_start: '2025-01-01', period_end: '2025-12-31', unit: 'USD', currency: 'USD', value: 120000000, amended: false }, 'https://data.sec.gov/api/xbrl/companyfacts/CIK0001234567.json', 'h-f1')
    ] },
    { source_id: GLEIF, kind: 'company', records: [
      rec(GLEIF, 'lei:SYNTH00000000000GRID', { legal_name: 'Synthetic Grid Components Inc', status: 'issued', identifiers: [{ scheme: 'lei', value: 'SYNTH00000000000GRID' }, { scheme: 'cik', value: '0001234567' }] }, 'https://api.gleif.org/api/v1/lei-records/SYNTH00000000000GRID', 'h-g1')
    ] },
    { source_id: GLEIF, kind: 'company_location', records: [
      rec(GLEIF, 'lei:SYNTH00000000000GRID:hq', { identifier_scheme: 'lei', identifier_value: 'SYNTH00000000000GRID', kind: 'headquarters', address: { street1: '250 Harbor Example Drive', city: 'Bridgeport', region: 'US-CT' }, geocode: { lat: 41.1792, lon: -73.1894, precision: 'locality', method: 'fixture-centroid' } }, 'https://api.gleif.org/api/v1/lei-records/SYNTH00000000000GRID', 'h-g2')
    ] },
    { source_id: USAS, kind: 'company_award', records: [
      rec(USAS, 'award:SYN-26-0001', { identifier_scheme: 'cik', identifier_value: '0001234567', agency: 'Department of Energy (synthetic record)', recipient: 'Synthetic Grid Components Inc', obligation: 2500000, outlay: 400000, period_start: '2026-01-01', period_end: '2026-12-31', place_of_performance: { city: 'Bridgeport', state: 'CT', country: 'US' } }, 'https://api.usaspending.gov/api/v2/search/spending_by_award/', 'h-aw')
    ] }
  ];
}

/* Follow-up batches used by the integration test. */
export const CGA_SECOND_TEXT = rec(CGA, 'bill:2026-HB90042', { jurisdiction_external_id: 'ct-state', body: 'House', session: '2026', identifier: 'HB 90042', title: 'An Act Concerning Synthetic Grid Resilience Reporting', status: 'Joint Favorable Substitute', enacted: false, enacted_at: null, effective_at: null, text_hash: 'cga:2026-HB90042:file-copy-1', version_label: 'File Copy 1', text_published_at: '2026-03-28' }, CGA_URL, 'h-b2');
export const CGA_AMENDMENT = rec(CGA, 'amendment:2026-HB90042:LCO4123', { bill_external_id: 'bill:2026-HB90042', label: 'LCO 4123', status: 'proposed', applies_to_version: 2 }, CGA_URL, 'h-am');
export const CERTIFIED_RESULTS = [
  rec(ELEC, 'result:2027-bpt-mayor:a:certified', { candidacy_external_id: 'cand:2027-bpt-mayor:a', stage: 'certified', votes: 10004, certified_at: '2027-11-20' }, ELEC_URL, 'h-r3'),
  rec(ELEC, 'result:2027-bpt-mayor:d:certified', { candidacy_external_id: 'cand:2027-bpt-mayor:d', stage: 'certified', votes: 8998, certified_at: '2027-11-20' }, ELEC_URL, 'h-r4')
];
export const SEC_RESTATED_FACT = rec(SEC, 'fact:rev:2025:amend', { identifier_scheme: 'cik', identifier_value: '0001234567', concept: 'us-gaap:Revenues', period_start: '2025-01-01', period_end: '2025-12-31', unit: 'USD', currency: 'USD', value: 118500000, amended: true }, 'https://data.sec.gov/api/xbrl/companyfacts/CIK0001234567.json', 'h-f2', { fetched_at: '2026-11-09T13:00:00.000Z' });
export const BAD_GEOGRAPHY = [
  rec(CIVIC, 'ct-orphan-ward', { country_code: 'US', level: 'ward', name: 'Orphan Ward', parent_external_id: 'does-not-exist', external_ids: {} }, BPT_URL, 'h-orphan'),
];
export const BAD_COORDINATES = rec(GLEIF, 'lei:SYNTH00000000000GRID:bad', { identifier_scheme: 'lei', identifier_value: 'SYNTH00000000000GRID', kind: 'facility', address: {}, geocode: { lat: 412.0, lon: -73.0, precision: 'street', method: 'fixture' } }, 'https://api.gleif.org/api/v1/lei-records/SYNTH00000000000GRID', 'h-badgeo');
export const IDENTITY_CONFLICT = rec(GLEIF, 'lei:OTHER0000000000ENTTY', { legal_name: 'Synthetic Other Entity LLC', status: 'issued', identifiers: [{ scheme: 'lei', value: 'OTHER0000000000ENTTY' }, { scheme: 'cik', value: '0001234567' }] }, 'https://api.gleif.org/api/v1/lei-records/OTHER0000000000ENTTY', 'h-conf');
