-- Build outside a transaction before analytics_long_range_v4.
create index concurrently if not exists events_lean_summary_window_v4_idx on public.events_lean (site_id, at) include (name, device_id, session_id, dwell_s, country) where not is_bot;
