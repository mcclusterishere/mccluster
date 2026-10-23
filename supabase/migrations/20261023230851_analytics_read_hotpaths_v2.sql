-- Repair owner Analytics timeouts without changing exact counts or authorization.
-- Production: build the three indexes CONCURRENTLY using supabase/ops first,
-- verify indisvalid/indisready, then apply this migration. Replay builds normally.
-- Region metadata is already projected and backfilled by the v3/v4 geo migrations.
set local lock_timeout = '2s';
set local statement_timeout = '30s';

create index if not exists events_lean_first_party_counts_v2_idx
  on public.events_lean (at desc nulls last) include (name)
  where site_id is null and is_bot is not true;

create index if not exists events_lean_country_window_v2_idx
  on public.events_lean (upper(country), at) include (site_id, name, device_id, region, region_code)
  where not coalesce(is_bot, false);

create index if not exists media_news_articles_imported_v2_idx
  on public.media_news_articles (imported_at desc nulls last);

do $verify$
begin
  if (select count(*) from pg_index i join pg_class c on c.oid=i.indexrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (
        'events_lean_first_party_counts_v2_idx','events_lean_country_window_v2_idx',
        'media_news_articles_imported_v2_idx') and i.indisvalid and i.indisready) <> 3 then
    raise exception 'Analytics indexes are not ready; inspect concurrent builds before retrying';
  end if;
end
$verify$;

create or replace function public.analytics_region_totals(
  p_country text,
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null
)
returns table(region_code text, region text, page_views bigint, visitors bigint, folded boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with params as (
    select upper(coalesce(p_country, '')) as cc
  ),
  page_cutoff as (
    select coalesce(min(p.at), 'infinity'::timestamptz) as first_page_view
    from public.events_lean p
    where p.name = 'page_view' and p.site_id is not distinct from p_site
  ),
  w as materialized (
    select e.at, e.name, e.device_id,
      nullif(upper(left(regexp_replace(coalesce(e.region_code, ''), '[^A-Za-z0-9]', '', 'g'), 4)), '') as rc,
      nullif(left(btrim(coalesce(e.region, '')), 80), '') as rn
    from public.events_lean e cross join params pr
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and not coalesce(e.is_bot, false)
      and pr.cc ~ '^[A-Z]{2}$'
      and upper(e.country) = pr.cc
  ),
  per as (
    select coalesce(w.rc, '~' || lower(w.rn)) as k,
      max(w.rc) as rc, max(w.rn) as rn,
      count(*) filter (where w.name = 'page_view' or (w.name = 'bar_boot' and w.at < pc.first_page_view))::bigint as pv,
      count(distinct w.device_id)::bigint as vis
    from w cross join page_cutoff pc
    where w.rc is not null or w.rn is not null
    group by 1
  ),
  unknown as (
    select count(*) filter (where w.name = 'page_view' or (w.name = 'bar_boot' and w.at < pc.first_page_view))::bigint as pv,
      count(distinct w.device_id)::bigint as vis
    from w cross join page_cutoff pc
    where w.rc is null and w.rn is null
  )
  select per.rc, per.rn, per.pv, per.vis, false from per where per.pv >= 5
  union all
  select null, null, sum(per.pv)::bigint, null::bigint, true from per where per.pv between 1 and 4 having count(*) > 0
  union all
  select null, null, u.pv, u.vis, false from unknown u where u.pv > 0
  order by 5, 3 desc, 1 nulls last
  limit 500;
$$;

comment on function public.analytics_region_totals(text, timestamptz, timestamptz, uuid) is
  'Admin analytics only: page views and visitors per IP region (Cloudflare region / regionCode) inside one country. Regions under 5 page views are folded into one row; never city, postal, coordinates or IP.';

revoke all on function public.analytics_region_totals(text, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.analytics_region_totals(text, timestamptz, timestamptz, uuid) to service_role;
