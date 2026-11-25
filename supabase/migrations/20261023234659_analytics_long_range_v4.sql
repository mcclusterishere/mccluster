-- Follow-up for the authenticated 30-day identity and summary timeouts.
-- Prebuild indexes CONCURRENTLY using supabase/ops; no event or auth data changes.
-- Function signatures, counting semantics, invoker security and existing grants stay intact.
set local lock_timeout='2s';
set local statement_timeout='30s';
create index if not exists events_identity_cover_v4_idx on public.events (at desc, id desc, uid) include (site_id, device_id, session_id) where device_id is not null and uid is not null;
create index if not exists events_lean_summary_window_v4_idx on public.events_lean (site_id, at) include (name, device_id, session_id, dwell_s, country) where not is_bot;
create index if not exists media_news_geo_window_v4_idx on public.media_news_articles (ingestion_provider, published_at, id) where location_country_fips is not null;
create index if not exists events_lean_audience_window_v4_idx on public.events_lean (at, id, name) include (path, device_id, session_id, track, src, source, referrer, is_bot, listened_seconds, dwell_s, visible_s) where site_id is null and is_bot is false and device_id is not null;
do $verify$
begin
  if (select count(*) from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname in ('events_identity_cover_v4_idx','events_lean_summary_window_v4_idx','media_news_geo_window_v4_idx','events_lean_audience_window_v4_idx') and i.indisvalid and i.indisready) <> 4 then
    raise exception 'Long-range analytics indexes are not ready';
  end if;
end
$verify$;
-- Replace the intermediate index from this investigation with its covering form.
drop index if exists public.events_identity_window_v4_idx;

CREATE OR REPLACE FUNCTION public.analytics_daily(p_since timestamp with time zone, p_until timestamp with time zone DEFAULT now(), p_site uuid DEFAULT NULL::uuid, p_tz text DEFAULT 'UTC'::text)
 RETURNS TABLE(day date, page_views bigint, visits bigint, visitors bigint, sessions bigint, plays bigint, events bigint, avg_dwell_s numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select (e.at at time zone p_tz)::date,
    count(*) filter (where e.name = 'page_view' or (e.name = 'bar_boot' and e.at < (
      select coalesce(case when p_site is null then
        (select min(p.at) from public.events_lean p where p.name = 'page_view' and p.site_id is null)
      else
        (select min(p.at) from public.events_lean p where p.name = 'page_view' and p.site_id = p_site)
      end, 'infinity'::timestamptz)))),
    count(*) filter (where e.name = 'acquired'),
    count(distinct e.device_id),
    count(distinct e.session_id),
    count(*) filter (where e.name in ('album_play', 'song_start')),
    count(*),
    round(avg(e.dwell_s), 1)
  from public.events_lean e
  where e.at >= p_since and e.at < p_until
    and ((p_site is null and e.site_id is null) or e.site_id = p_site)
    and not e.is_bot
  group by 1
  order by 1;
$function$;


CREATE OR REPLACE FUNCTION public.analytics_hourly(p_since timestamp with time zone, p_until timestamp with time zone DEFAULT now(), p_site uuid DEFAULT NULL::uuid, p_tz text DEFAULT 'UTC'::text)
 RETURNS TABLE(hour timestamp with time zone, hour_label text, page_views bigint, visits bigint, visitors bigint, sessions bigint, plays bigint, events bigint, avg_dwell_s numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with params as (
    select
      p_since as since_at,
      p_until as until_at,
      (p_until - p_since) / 24.0 as bucket_span,
      nullif(extract(epoch from (p_until - p_since)) / 24.0, 0) as bucket_seconds
  ),
  page_cutoff as (
    select coalesce(case when p_site is null then
        (select min(p.at) from public.events_lean p where p.name = 'page_view' and p.site_id is null)
      else
        (select min(p.at) from public.events_lean p where p.name = 'page_view' and p.site_id = p_site)
      end, 'infinity'::timestamptz) as first_page_view
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
      and ((p_site is null and e.site_id is null) or e.site_id = p_site)
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
$function$;


CREATE OR REPLACE FUNCTION public.analytics_totals(p_since timestamp with time zone, p_until timestamp with time zone DEFAULT now(), p_site uuid DEFAULT NULL::uuid)
 RETURNS TABLE(page_views bigint, visits bigint, visitors bigint, sessions bigint, plays bigint, events bigint, first_event timestamp with time zone, identity_since timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select
    count(*) filter (where e.name = 'page_view' or (e.name = 'bar_boot' and e.at < (
      select coalesce(case when p_site is null then
        (select min(p.at) from public.events_lean p where p.name = 'page_view' and p.site_id is null)
      else
        (select min(p.at) from public.events_lean p where p.name = 'page_view' and p.site_id = p_site)
      end, 'infinity'::timestamptz)))),
    count(*) filter (where e.name = 'acquired'),
    count(distinct e.device_id),
    count(distinct e.session_id),
    count(*) filter (where e.name in ('album_play', 'song_start')),
    count(*),
    min(e.at),
    min(e.at) filter (where e.device_id is not null)
  from public.events_lean e
  where e.at >= p_since and e.at < p_until
    and ((p_site is null and e.site_id is null) or e.site_id = p_site)
    and not e.is_bot;
$function$;

CREATE OR REPLACE FUNCTION public.analytics_country_totals(p_since timestamp with time zone, p_until timestamp with time zone DEFAULT now(), p_site uuid DEFAULT NULL::uuid)
 RETURNS TABLE(country text, page_views bigint, visitors bigint, sessions bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with page_cutoff as (
    select coalesce(case when p_site is null then
      (select min(p.at) from public.events_lean p where p.name='page_view' and p.site_id is null)
    else
      (select min(p.at) from public.events_lean p where p.name='page_view' and p.site_id=p_site)
    end, 'infinity'::timestamptz) as first_page_view
  ),
  w as materialized (
    select e.at, e.name, upper(e.country) as country, e.device_id, e.session_id
    from public.events_lean e
    where e.at >= p_since and e.at < p_until
      and ((p_site is null and e.site_id is null) or e.site_id=p_site)
      and not e.is_bot
      and e.country ~ '^[A-Za-z]{2}$'
  )
  select
    w.country,
    count(*) filter (where w.name = 'page_view' or (w.name = 'bar_boot' and w.at < pc.first_page_view))::bigint,
    count(distinct w.device_id)::bigint,
    count(distinct w.session_id)::bigint
  from w cross join page_cutoff pc
  group by w.country
  order by 2 desc, 1
  limit 250;
$function$;
