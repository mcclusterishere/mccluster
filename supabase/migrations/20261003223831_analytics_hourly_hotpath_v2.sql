-- ANALYTICS HOURLY HOTPATH V2
-- Canonical production migration: 20261003223831.
-- Fix intermittent statement_timeout failures in the 24h Control chart.
-- The v1 implementation joined events against 24 generated buckets. Under
-- authenticated PostgREST + RLS, that could exceed the request timeout.
-- This version scans the selected 24-hour window once, assigns each event to
-- one bucket, aggregates once, then left-joins the 24 canonical buckets.

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
      (p_until - p_since) / 24.0 as bucket_span,
      nullif(extract(epoch from (p_until - p_since)) / 24.0, 0) as bucket_seconds
  ),
  page_cutoff as (
    select coalesce(min(p.at), 'infinity'::timestamptz) as first_page_view
    from public.events_lean p
    where p.name = 'page_view'
      and p.site_id is not distinct from p_site
  ),
  window_events as materialized (
    select
      greatest(0, least(23, floor(
        extract(epoch from (e.at - p.since_at)) / p.bucket_seconds
      )::int)) as bucket_no,
      e.at,
      e.name,
      e.device_id,
      e.session_id,
      e.dwell_s
    from public.events_lean e
    cross join params p
    where e.at >= p.since_at
      and e.at < p.until_at
      and e.site_id is not distinct from p_site
      and not e.is_bot
  ),
  aggregate_by_hour as (
    select
      w.bucket_no,
      count(*) filter (
        where w.name = 'page_view'
           or (w.name = 'bar_boot' and w.at < pc.first_page_view)
      )::bigint as page_views,
      count(*) filter (where w.name = 'acquired')::bigint as visits,
      count(distinct w.device_id)::bigint as visitors,
      count(distinct w.session_id)::bigint as sessions,
      count(*) filter (where w.name in ('album_play', 'song_start'))::bigint as plays,
      count(*)::bigint as events,
      round(avg(w.dwell_s), 1) as avg_dwell_s
    from window_events w
    cross join page_cutoff pc
    group by w.bucket_no
  ),
  buckets as (
    select
      g as bucket_no,
      p.since_at + g * p.bucket_span as bucket_start
    from params p
    cross join generate_series(0, 23) as g
  )
  select
    b.bucket_start as hour,
    to_char(b.bucket_start at time zone p_tz, 'FMHH12:MI AM') as hour_label,
    coalesce(a.page_views, 0)::bigint,
    coalesce(a.visits, 0)::bigint,
    coalesce(a.visitors, 0)::bigint,
    coalesce(a.sessions, 0)::bigint,
    coalesce(a.plays, 0)::bigint,
    coalesce(a.events, 0)::bigint,
    a.avg_dwell_s
  from buckets b
  left join aggregate_by_hour a on a.bucket_no = b.bucket_no
  order by b.bucket_no;
$$;

comment on function public.analytics_hourly(timestamptz, timestamptz, uuid, text) is
  'Exact 24-point rolling-hour analytics series for Control. Scans the selected window once, aggregates once, and fills missing hours with zeroes.';

revoke all on function public.analytics_hourly(timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.analytics_hourly(timestamptz, timestamptz, uuid, text) to authenticated;
