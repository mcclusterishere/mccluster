-- Cover location/network/IP searches without loading wide page-view payloads.
-- Existing projected search rows were checked: 7,236 rows, at most 250 bytes.
-- Measurements, search predicates, permissions and API timeout are unchanged.
set local lock_timeout = '2s';
set local statement_timeout = '30s';

create index if not exists events_first_party_search_v8_idx
  on public.events (at)
  include (session_id, device_id, ip, city, region, asn_org, postal)
  where site_id is null and name = 'page_view';

comment on index public.events_first_party_search_v8_idx is
  'Covers the existing first-party session/visitor location, IP and network search predicates.';
