-- Run alone, outside a transaction, before analytics_region_covering_v3.
create index concurrently if not exists events_lean_country_window_cover_v3_idx
  on public.events_lean (upper(country), at) include (country, site_id, name, device_id, region, region_code)
  where not coalesce(is_bot, false);
