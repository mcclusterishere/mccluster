-- ANALYTICS COUNTRY V1 (pending; NOT applied in production)
--
-- What it fixes: the analytics globe can select a country, but no existing
-- read can be filtered by country. analytics_top(country) gives page views
-- per country and nothing else, so with a country selected the panel could
-- show that country's page views but not its visitors or its trend. These two
-- reads close that gap with the same rules as the reads beside them:
--   * events_lean, the narrow copy (same id, name, at, country),
--   * security invoker: RLS decides who reads (the desk; a tenant site owner
--     for their own site_id), exactly like analytics_totals / analytics_hourly,
--   * bots excluded, page_view counting identical to analytics_hourly
--     (bar_boot before the first page_view counts as a page view),
--   * country level only (the IP country Cloudflare reports); no region,
--     city or coordinates leave the database through these reads.
-- Small-group suppression (under 5) is applied by the panel, as for every
-- other country read; these reads return exact counts to the owner only.
--
-- Rollback:
--   drop function if exists public.analytics_country_totals(timestamptz, timestamptz, uuid);
--   drop function if exists public.analytics_country_series(text, timestamptz, timestamptz, uuid, text);
--
-- Promote with supabase/pending/README.md (apply_migration under this name,
-- then git mv to supabase/migrations/<version>_analytics_country_v1.sql).

create or replace function public.analytics_country_totals(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null
)
returns table(country text, page_views bigint, visitors bigint, sessions bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with page_cutoff as (
    select coalesce(min(p.at), 'infinity'::timestamptz) as first_page_view
    from public.events_lean p
    where p.name = 'page_view' and p.site_id is not distinct from p_site
  ),
  w as materialized (
    select e.at, e.name, upper(e.country) as country, e.device_id, e.session_id
    from public.events_lean e
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
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
$$;

comment on function public.analytics_country_totals(timestamptz, timestamptz, uuid) is
  'Page views, visitors and sessions per IP country (Cloudflare) in an exact window. Country level only; the panel folds countries under 5.';

create or replace function public.analytics_country_series(
  p_country text,
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null,
  p_tz text default 'UTC'
)
returns table(bucket timestamptz, bucket_label text, page_views bigint, visitors bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select p_since as since_at, p_until as until_at,
      (p_until - p_since) / 24.0 as bucket_span,
      nullif(extract(epoch from (p_until - p_since)) / 24.0, 0) as bucket_seconds,
      upper(coalesce(p_country, '')) as cc
  ),
  page_cutoff as (
    select coalesce(min(p.at), 'infinity'::timestamptz) as first_page_view
    from public.events_lean p
    where p.name = 'page_view' and p.site_id is not distinct from p_site
  ),
  w as materialized (
    select greatest(0, least(23, floor(extract(epoch from (e.at - p.since_at)) / p.bucket_seconds)::int)) as bucket_no,
      e.at, e.name, e.device_id
    from public.events_lean e cross join params p
    where e.at >= p.since_at and e.at < p.until_at
      and e.site_id is not distinct from p_site
      and not e.is_bot
      and p.cc ~ '^[A-Z]{2}$'
      and upper(e.country) = p.cc
  ),
  agg as (
    select w.bucket_no,
      count(*) filter (where w.name = 'page_view' or (w.name = 'bar_boot' and w.at < pc.first_page_view))::bigint as page_views,
      count(distinct w.device_id)::bigint as visitors
    from w cross join page_cutoff pc
    group by w.bucket_no
  ),
  buckets as (
    select g as bucket_no, p.since_at + g * p.bucket_span as bucket_start
    from params p cross join generate_series(0, 23) as g
  )
  select b.bucket_start,
    to_char(b.bucket_start at time zone p_tz, 'YYYY-MM-DD HH24:MI'),
    coalesce(a.page_views, 0)::bigint,
    coalesce(a.visitors, 0)::bigint
  from buckets b left join agg a on a.bucket_no = b.bucket_no
  order by b.bucket_no;
$$;

comment on function public.analytics_country_series(text, timestamptz, timestamptz, uuid, text) is
  '24 equal buckets of page views and visitors for one IP country in an exact window. Country level only.';

revoke all on function public.analytics_country_totals(timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.analytics_country_series(text, timestamptz, timestamptz, uuid, text) from public, anon;
grant execute on function public.analytics_country_totals(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.analytics_country_series(text, timestamptz, timestamptz, uuid, text) to authenticated;
