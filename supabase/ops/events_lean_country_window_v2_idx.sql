-- Run alone, outside a transaction, before analytics_read_hotpaths_v2.
create index concurrently if not exists events_lean_country_window_v2_idx
  on public.events_lean (upper(country), at) include (site_id, name, device_id, region, region_code)
  where not coalesce(is_bot, false);
