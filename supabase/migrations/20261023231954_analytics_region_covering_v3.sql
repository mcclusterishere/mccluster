-- Cover the country expression's input too so PostgreSQL can use index-only
-- regional scans. Separate NULL-site cutoff queries so the first-party name/at
-- index finds the first page view without visiting every historical page view.
-- Build this index CONCURRENTLY via supabase/ops before applying in production.
set local lock_timeout = '2s';
set local statement_timeout = '30s';
create index if not exists events_lean_country_window_cover_v3_idx
  on public.events_lean (upper(country), at) include (country, site_id, name, device_id, region, region_code)
  where not coalesce(is_bot, false);
do $verify$
begin
  if not exists (select 1 from pg_index i where i.indexrelid =
    'public.events_lean_country_window_cover_v3_idx'::regclass and i.indisvalid and i.indisready) then
    raise exception 'Covering region index is not ready';
  end if;
end
$verify$;
-- v3 supersedes the narrow v2 index built during the same incident repair.
drop index if exists public.events_lean_country_window_v2_idx;

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
    select coalesce(case when p_site is null then
      (select min(p.at) from public.events_lean p where p.name = 'page_view' and p.site_id is null)
    else
      (select min(p.at) from public.events_lean p where p.name = 'page_view' and p.site_id = p_site)
    end, 'infinity'::timestamptz) as first_page_view
  ),
  w as materialized (
    select e.at, e.name, e.device_id,
      nullif(upper(left(regexp_replace(coalesce(e.region_code, ''), '[^A-Za-z0-9]', '', 'g'), 4)), '') as rc,
      nullif(left(btrim(coalesce(e.region, '')), 80), '') as rn
    from public.events_lean e cross join params pr
    where e.at >= p_since and e.at < p_until
      and ((p_site is null and e.site_id is null) or e.site_id = p_site)
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
