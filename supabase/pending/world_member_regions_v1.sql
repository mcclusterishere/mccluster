-- WORLD MEMBER REGIONS V1 (pending; NOT applied in production)
--
-- What it fixes: the World's place card said "—" members almost everywhere.
-- Its count came from action_globe_public_regions, which is built from
-- action_globe_member_regions, a table nothing writes to. Owner, 2026-10-21:
-- "It should just count how many people have logged in with an account from
-- that IP region. Make it exact down to the state. So you can filter state
-- versus country in that way of how many user accounts."
--
-- What it counts: accounts, once each, at the place of their most recent
-- signed-in visit. public.events already stores what Cloudflare reports for
-- the visitor's IP (workers/mccluster/src/entry.js forwards it, the collect
-- function stores it):
--   * events.country                       request.cf.country    ("US")
--   * events.edge->>'cf-region-code'       request.cf.regionCode ("CT")
--   * events.longitude / events.latitude   request.cf.longitude / latitude
-- Nothing new is collected. A Global Privacy Control / Do Not Track visit has
-- no uid and no coordinates, so it is never counted here. Bot traffic is not
-- counted. An account counts once, where it last signed in from in the window
-- (at most 400 days, the events retention), so the countries add up to the
-- total. A deleted account no longer counts (the join to auth.users).
--
-- What leaves the database: country, region code, and the place rounded to
-- hundredths of a degree (the precision of the state shapes the globe uses to
-- find the state), with how many accounts are there. Never a uid, IP, city,
-- postal code, device or session.
--
-- Who can call it: service_role only. The Worker route GET /v1/world/members
-- (workers/mccluster/src/world-members.js) gives the house owner the exact
-- counts and places, and everyone else the country totals of five or more.
--
-- Rollback:
--   drop function if exists public.world_member_regions(integer);
--
-- Promote with supabase/pending/README.md (apply_migration under this name,
-- then git mv to supabase/migrations/<version>_world_member_regions_v1.sql).

create or replace function public.world_member_regions(p_days integer default 400)
returns table(country text, region_code text, lon double precision, lat double precision, accounts bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as (
    select distinct on (e.uid) e.uid,
      upper(e.country) as cc,
      nullif(upper(left(regexp_replace(coalesce(e.edge->>'cf-region-code', ''), '[^A-Za-z0-9]', '', 'g'), 4)), '') as rc,
      e.longitude, e.latitude
    from public.events e
    where e.uid is not null
      and e.at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 400), 400)))
      and not coalesce(e.is_bot, false)
      and upper(coalesce(e.country, '')) ~ '^[A-Z]{2}$'
      and upper(e.country) <> 'XX'
    order by e.uid, e.at desc
  ),
  placed as (
    select l.cc, l.rc,
      (l.longitude between -180 and 180 and l.latitude between -90 and 90
        and not (l.longitude = 0 and l.latitude = 0)) as has_place,
      l.longitude, l.latitude
    from latest l
    join auth.users u on u.id = l.uid
  )
  select p.cc, p.rc,
    case when p.has_place then round(p.longitude::numeric, 2)::double precision end,
    case when p.has_place then round(p.latitude::numeric, 2)::double precision end,
    count(*)::bigint
  from placed p
  group by 1, 2, 3, 4
  order by 5 desc, 1, 2
  limit 5000;
$$;

comment on function public.world_member_regions(integer) is
  'The World place card: accounts by the IP country, region code and rounded place of their latest signed-in visit (one place per account). Service role only; never a uid, IP, city, postal code or device.';

revoke all on function public.world_member_regions(integer) from public, anon, authenticated;
grant execute on function public.world_member_regions(integer) to service_role;
