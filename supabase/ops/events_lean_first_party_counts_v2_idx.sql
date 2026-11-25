-- Run alone, outside a transaction, before analytics_read_hotpaths_v2.
create index concurrently if not exists events_lean_first_party_counts_v2_idx
  on public.events_lean (at desc nulls last) include (name)
  where site_id is null and is_bot is not true;
