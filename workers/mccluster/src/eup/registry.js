/* E=Up source registry: ONE model over the planning inventory
   (eup-admin-workspace/FEED-REGISTRY.json, 2026-11-09) and the existing
   civic_source_registry rows. Definitions live here; mutable state lives in
   public.eup_source_registry_state (supabase/pending/eup_intake_v1.sql).

   No entry grants access, represents a configured account or authorises
   storage/redistribution. `access` is the rights review state: 'held' sources
   are never fetched; 'not_reviewed' sources are not fetched until an owner
   review records 'approved' in state. `configured` is true only when every
   credential binding named here is present in the Worker environment AND
   state says configured. Cadences are proposals, not source SLAs. */

export const RETIRED_DEPENDENCIES = Object.freeze([
  { id: 'google_civic_representatives', retired_on: '2025-04-30', source: 'https://groups.google.com/g/google-civicinfo-api/c/lR8kT7Uc0sE' },
  { id: 'propublica_congress_api', source: 'https://projects.propublica.org/api-docs/congress-api/' }
]);

const feed = (entry) => Object.freeze({ access: 'not_reviewed', credentialEnv: [], civic_source_key: null, cadence: null, ...entry });

export const FEED_REGISTRY = Object.freeze([
  feed({ id: 'congress_gov', label: 'Congress.gov', provider: 'Library of Congress', purpose: ['federal_members', 'federal_bills', 'legislative_actions'], url: 'https://github.com/LibraryOfCongress/api.congress.gov', fetch_host: 'api.congress.gov', coverage: 'US federal; collection-specific history and vote coverage', credentialEnv: ['CONGRESS_API_KEY'], civic_source_key: 'congress_gov', rights: 'review_endpoint_and_attachment_terms', cadence: '15-60 minutes for selected active bills; daily roster reconciliation', adapter: 'congress' }),
  feed({ id: 'official_ct_legislation', label: 'Connecticut General Assembly', provider: 'State of Connecticut', purpose: ['state_bills', 'state_actions', 'official_text'], url: 'https://www.cga.ct.gov/asp/menu/legdownload.asp', coverage: 'Connecticut; proposed pilot', rights: 'state_source_terms_review_required', cadence: 'daily index check', adapter: 'ct-assembly' }),
  feed({ id: 'official_ct_offices', label: 'Connecticut municipal register', provider: 'Connecticut Secretary of the State', purpose: ['municipal_office_discovery', 'officeholder_crosscheck'], url: 'https://portal.ct.gov/SOTS/Register-Manual/Section-VII/Towns-Cities-and-Boroughs--Officers-and-Statistics', coverage: 'Connecticut municipal register; cross-check only', rights: 'state_source_terms_review_required', cadence: 'weekly change detection', adapter: null }),
  feed({ id: 'official_bridgeport_council', label: 'Bridgeport City Council', provider: 'City of Bridgeport', purpose: ['municipal_offices', 'officeholder_roster', 'agendas', 'minutes'], url: 'https://www.bridgeportct.gov/government/departments/city-council', coverage: 'Bridgeport, Connecticut; proposed pilot only', rights: 'municipal_terms_review_and_contact_data_minimization_required', cadence: 'daily agenda check, weekly roster check', adapter: 'bridgeport-council' }),
  feed({ id: 'official_ct_elections', label: 'Connecticut election results', provider: 'Connecticut Secretary of the State', purpose: ['election_directory', 'contests', 'results', 'certification'], url: 'https://portal.ct.gov/sots/Election-Services/Election-Results/Election-Results', coverage: 'Connecticut state/local publications; endpoint-specific', rights: 'source_and_vendor_terms_review_required', cadence: 'daily outside elections', adapter: null }),
  feed({ id: 'census_tiger', label: 'Census TIGER/Line boundaries', provider: 'US Census Bureau', purpose: ['jurisdiction_geometry', 'district_geometry'], url: 'https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html', coverage: 'US layers by vintage; local ward gaps need official GIS', rights: 'government_geography_reusable_preserve_source_vintage', cadence: 'monthly catalogue check', adapter: 'census' }),
  feed({ id: 'sec_edgar', label: 'SEC EDGAR', provider: 'US Securities and Exchange Commission', purpose: ['company_identity', 'filings', 'xbrl_facts', 'address_assertions'], url: 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', coverage: 'SEC filers; no stock quotes', credentialEnv: ['SEC_USER_AGENT'], rights: 'factual_extraction_and_filing_links_review_third_party_material', cadence: 'bounded polling below 10 requests/second aggregate', adapter: 'sec' }),
  feed({ id: 'gleif', label: 'GLEIF LEI records', provider: 'Global Legal Entity Identifier Foundation', purpose: ['legal_entity', 'headquarters_address', 'legal_address', 'reported_parent'], url: 'https://www.gleif.org/en/lei-data/gleif-api', coverage: 'LEI-covered entities only', rights: 'CC0_LEI_data_separate_geocoding_and_trademark_terms', cadence: 'daily incremental reconciliation', adapter: 'gleif' }),
  feed({ id: 'usaspending', label: 'USAspending', provider: 'US Treasury', purpose: ['federal_awards', 'award_recipients', 'government_funding_context'], url: 'https://api.usaspending.gov/docs/', coverage: 'US federal awards; reporting delays and thresholds apply', rights: 'preserve_official_data_caveats_and_field_provenance', cadence: 'daily scoped reconciliation', adapter: 'seek-first:usaspending' }),
  feed({ id: 'openfec', label: 'OpenFEC', provider: 'Federal Election Commission', purpose: ['federal_campaign_finance'], url: 'https://api.open.fec.gov/developers/', coverage: 'Federal filings; not local results or personal spending', credentialEnv: ['OPENFEC_API_KEY'], access: 'held', rights: 'HOLD_current_AUP_commercial_use_and_contributor_restrictions_need_intended_use_review', terms: 'https://github.com/fecgov/FEC/blob/master/ACCEPTABLE-USE-POLICY.md', adapter: null }),
  feed({ id: 'market_prices', label: 'Market prices', provider: 'Existing Alpaca / Finnhub / EODHD adapters', purpose: ['quotes', 'history', 'paper_simulation_context'], url: 'https://docs.alpaca.markets/us/docs/about-market-data-api', coverage: 'Provider/account/feed-specific', access: 'held', rights: 'HOLD_verify_admin_display_storage_and_redistribution_rights', adapter: null }),
  feed({ id: 'legiscan_secondary', label: 'LegiScan (secondary)', provider: 'LegiScan', purpose: ['state_bill_discovery'], url: 'https://legiscan.com/legiscan', coverage: 'Provider-covered legislative records', credentialEnv: ['LEGISCAN_API_KEY'], civic_source_key: 'legiscan', access: 'held', rights: 'HOLD_review_plan_terms_and_replace_public_table_ingestion_for_admin_preview', adapter: null }),
  feed({ id: 'congressional_financial_disclosures', label: 'Congressional financial disclosures', provider: 'US House / Senate', purpose: ['personal_disclosure_ranges'], url: 'https://disclosures-clerk.house.gov/', coverage: 'Collection intentionally disabled in workers/mccluster/src/finance/foundation.js', access: 'held', rights: 'HOLD_statutory_access_and_use_conditions_unverified', adapter: null })
]);

export const feedById = (id) => FEED_REGISTRY.find((f) => f.id === id) || null;

/* Credential presence by NAME only; values are never read into a response. */
export function bindingsPresent(feedEntry, env = {}) {
  return feedEntry.credentialEnv.every((name) => typeof env[name] === 'string' && env[name].length > 0);
}

/* Merge a definition with its stored state into the Sources & Review row.
   `records` stays null when unknown: a missing count is not zero. */
export function sourceRow(feedEntry, state = null, { now = Date.now(), staleAfterMs = 7 * 86400000 } = {}, env = {}) {
  const access = feedEntry.access === 'held' ? 'held' : (state?.access === 'approved' ? 'approved' : 'not_reviewed');
  const configured = access === 'approved' && state?.configured === true && bindingsPresent(feedEntry, env);
  const lastSuccess = state?.last_success_at ? Date.parse(state.last_success_at) : NaN;
  const availability = !Number.isFinite(lastSuccess) ? 'unavailable' : (now - lastSuccess > staleAfterMs ? 'stale' : 'available');
  return {
    id: feedEntry.id, label: feedEntry.label, provider: feedEntry.provider, purpose: feedEntry.purpose,
    configured, access, paused: state?.paused === true,
    availability,
    last_attempt_at: state?.last_attempt_at ?? null, last_success_at: state?.last_success_at ?? null, last_error: state?.last_error ?? null,
    records: Number.isInteger(state?.records) ? state.records : null,
    unresolved: Number.isInteger(state?.unresolved) ? state.unresolved : null,
    next_run_at: state?.next_run_at ?? null, quota_reset_at: state?.quota_reset_at ?? null,
    url: feedEntry.url, rights: feedEntry.rights, rights_revision: state?.rights_revision ?? null, rights_expires_at: state?.rights_expires_at ?? null,
    terms: feedEntry.terms ?? null, coverage: feedEntry.coverage, cadence_proposal: feedEntry.cadence,
    civic_source_key: feedEntry.civic_source_key, adapter: feedEntry.adapter, revision: state?.revision ?? 0
  };
}

/* Rights checks happen BEFORE an upstream request and BEFORE a cached or
   stored record is returned. Throws with a reason; never consults the network. */
export function assertRights(feedEntry, state, { now = Date.now(), fail } = {}) {
  const err = (status, message, reason) => (fail ? fail(status, message, reason) : Object.assign(new Error(message), { status, reason }));
  if (!feedEntry) throw err(404, 'Unknown source', 'unknown_source');
  if (feedEntry.access === 'held') throw err(403, `${feedEntry.label} is held pending rights review`, 'rights_held');
  if (state?.access !== 'approved') throw err(403, `${feedEntry.label} access has not been reviewed`, 'rights_not_reviewed');
  if (state?.rights_expires_at && Date.parse(state.rights_expires_at) <= now) throw err(403, `${feedEntry.label} entitlement expired`, 'rights_expired');
  return true;
}
