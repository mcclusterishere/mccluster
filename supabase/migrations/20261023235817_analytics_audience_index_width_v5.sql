-- Keep ordered audience reads without indexing unbounded event payload text.
-- Prebuild the replacement concurrently with supabase/ops/events_lean_audience_order_v5_idx.sql.
-- The v4 covering form could reject an oversized projected referrer/path.
set local lock_timeout='2s';
set local statement_timeout='30s';
create index if not exists events_lean_audience_order_v5_idx on public.events_lean (at, id, name) where site_id is null and is_bot is false and device_id is not null;
do $verify$
begin
  if not exists (select 1 from pg_index where indexrelid='public.events_lean_audience_order_v5_idx'::regclass and indisvalid and indisready) then
    raise exception 'Ordered audience index is not ready';
  end if;
end
$verify$;
drop index if exists public.events_lean_audience_window_v4_idx;
