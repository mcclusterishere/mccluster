-- Build outside a transaction before analytics_long_range_v4.
create index concurrently if not exists events_identity_cover_v4_idx on public.events (at desc, id desc, uid) include (site_id, device_id, session_id) where device_id is not null and uid is not null;
