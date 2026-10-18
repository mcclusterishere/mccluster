-- ANALYTICS REGION V1 (pending; NOT applied in production)
--
-- What it adds: page views and visitors per STATE / PROVINCE inside one
-- country, for the owner's analytics globe (owner, 2026-10-16: "each state
-- mapped accordingly across the countries"). Admin analytics only.
--
-- What it reads: nothing new is collected. public.events already stores the
-- region Cloudflare reports for the visitor's IP:
--   * events.region            request.cf.region     ("Connecticut")
--   * events.edge->>'cf-region-code'  request.cf.regionCode ("CT")
-- (workers/mccluster/src/entry.js forwards both; supabase/functions/collect
-- stores the name in `region` and the raw header set in `edge`). Both are
-- already nulled for a visitor who sends Global Privacy Control / Do Not
-- Track, so this read never sees them for those visitors.
--
-- What leaves the database: country, region code, region name, counts.
-- Never city, postal code, coordinates, IP, ASN, device or session ids.
--
-- SMALL GROUPS ARE FOLDED HERE, not in the browser: a region with fewer than
-- 5 page views is never named; its views are summed into one row with
-- region_code = null and folded = true. Rows with no region at all come back
-- as one row with region_code = null, folded = false (the "no region" count).
--
-- Who can call it: service_role only. The Worker route
-- GET /v1/analytics/regions (workers/mccluster/src/analytics/router.js)
-- checks that the caller is the McCluster house owner first, so only the desk sees it.
-- It is not granted to authenticated, so a member can never call it through
-- PostgREST, and the public / member globe has no route to it.
--
-- Rollback:
--   drop function if exists public.analytics_region_totals(text, timestamptz, timestamptz, uuid);
--
-- Promote with supabase/pending/README.md (apply_migration under this name,
-- then git mv to supabase/migrations/<version>_analytics_region_v1.sql).

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
    from public.events p
    where p.name = 'page_view' and p.site_id is not distinct from p_site
  ),
  w as materialized (
    select e.at, e.name, e.device_id,
      nullif(upper(left(regexp_replace(coalesce(e.edge->>'cf-region-code', ''), '[^A-Za-z0-9]', '', 'g'), 4)), '') as rc,
      nullif(left(btrim(coalesce(e.region, '')), 80), '') as rn
    from public.events e cross join params pr
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
