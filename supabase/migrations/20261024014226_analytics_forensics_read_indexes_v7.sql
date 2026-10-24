-- Keep Site health session/visitor reads below the existing 8s API deadline.
-- Measured 30-day session plan: 9.17s before, 1.69s with these two indexes.
-- Indexes only: no measurement, function, permission or timeout changes.
set local lock_timeout = '2s';
set local statement_timeout = '30s';

create index if not exists events_first_party_identity_v7_idx
  on public.events (at)
  include (uid, session_id, device_id)
  where site_id is null and uid is not null;

create index if not exists events_lean_unsessioned_window_v7_idx
  on public.events_lean (at)
  where site_id is null and session_id is null;

comment on index public.events_first_party_identity_v7_idx is
  'Covers first-party session and visitor identity aggregation without fetching wide event payloads.';
comment on index public.events_lean_unsessioned_window_v7_idx is
  'Counts unsessioned first-party events in a time window without scanning all event payloads.';
