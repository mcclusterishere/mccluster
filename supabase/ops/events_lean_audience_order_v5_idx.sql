-- Build outside a transaction before analytics_audience_index_width_v5.
create index concurrently if not exists events_lean_audience_order_v5_idx on public.events_lean (at, id, name) where site_id is null and is_bot is false and device_id is not null;
