-- ANALYTICS HOURLY V1
-- Canonical production migration: 20261003154052.
-- The Control 24h chart must be a real 24-point hourly series. This RPC
-- divides the exact selected 24-hour timestamp window into 24 consecutive
-- one-hour buckets and left-joins events so zero-traffic hours still exist.

create or replace function public.analytics_hourly(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null,
  p_tz text default 'UTC'
)
returns table(
  hour timestamptz,
  hour_label text,
  page_views bigint,
  visits bigint,
  visitors bigint,
  sessions bigint,
  plays bigint,
  events bigint,
  avg_dwell_s numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select
      p_since as since_at,
      p_until as until_at,
      (p_until - p_since) / 24.0 as bucket_span
  ),
  page_cutoff as (
    select coalesce(min(p.at), 'infinity'::timestamptz) as first_page_view
    from public.events_lean p
    where p.name = 'page_view'
      and p.site_id is not distinct from p_site
  ),
  buckets as (
    select
      g as bucket_no,
      p.since_at + g * p.bucket_span as bucket_start,
      p.since_at + (g + 1) * p.bucket_span as bucket_end
    from params p
    cross join generate_series(0, 23) as g
  )
  select
    b.bucket_start as hour,
    to_char(b.bucket_start at time zone p_tz, 'FMHH12:MI AM') as hour_label,
    count(e.at) filter (
      where e.name = 'page_view'
         or (e.name = 'bar_boot' and e.at < pc.first_page_view)
    )::bigint as page_views,
    count(e.at) filter (where e.name = 'acquired')::bigint as visits,
    count(distinct e.device_id)::bigint as visitors,
    count(distinct e.session_id)::bigint as sessions,
    count(e.at) filter (where e.name in ('album_play', 'song_start'))::bigint as plays,
    count(e.at)::bigint as events,
    round(avg(e.dwell_s), 1) as avg_dwell_s
  from buckets b
  cross join page_cutoff pc
  left join public.events_lean e
    on e.at >= b.bucket_start
   and e.at < b.bucket_end
   and e.site_id is not distinct from p_site
   and not e.is_bot
  group by b.bucket_no, b.bucket_start, pc.first_page_view
  order by b.bucket_no;
$$;

comment on function public.analytics_hourly(timestamptz, timestamptz, uuid, text) is
  'Exact 24-point rolling-hour analytics series for the Control 24h chart. Always returns 24 consecutive one-hour buckets, including zero-traffic buckets.';

revoke all on function public.analytics_hourly(timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.analytics_hourly(timestamptz, timestamptz, uuid, text) to authenticated;
