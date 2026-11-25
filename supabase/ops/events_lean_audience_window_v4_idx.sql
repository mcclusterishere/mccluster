-- Build outside a transaction before analytics_long_range_v4.
create index concurrently if not exists events_lean_audience_window_v4_idx on public.events_lean (at, id, name) include (path, device_id, session_id, track, src, source, referrer, is_bot, listened_seconds, dwell_s, visible_s) where site_id is null and is_bot is false and device_id is not null;
