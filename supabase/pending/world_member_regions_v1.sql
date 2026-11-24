-- Shared platform infrastructure used by Equity Uprise; this file defines no building capability.
-- The migration runner owns one transaction for this entire file.
set local lock_timeout = '5s';
do $migration_isolation$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='PENDING_REQUIRES_READ_COMMITTED: recovery must see writes committed before its table lock';
  end if;
end $migration_isolation$;
select pg_advisory_xact_lock(20261124,2);
do $reviewed_functions$
declare expected jsonb; actual record; function_oid oid;
begin
  for expected in select value from jsonb_array_elements('[{"signature":"public.world_member_regions(integer)","name":"public.world_member_regions","hashes":["fa1e543bd1a0aae8b42cf21422365f68b0ecf7421f97c8b6ee7f5c991e0b71b8"],"language":"sql","definer":true,"volatility":"s","search_path":"search_path=\"\"","args":["p_days"],"default_count":1,"defaults":"400","returns":"jsonb","allow_absent":true}]'::jsonb) loop
    function_oid:=to_regprocedure(expected->>'signature');
    if function_oid is null then
      if coalesce((expected->>'allow_absent')::boolean,false) then continue; end if;
      raise exception using errcode='55000',message='PENDING_FUNCTION_CHANGED: missing reviewed function '||(expected->>'signature');
    end if;
    select p.*,l.lanname into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=function_oid;
    if not (expected->'hashes' ? encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex'))
      or actual.lanname<>expected->>'language' or actual.prosecdef is distinct from (expected->>'definer')::boolean
      or actual.provolatile::text<>expected->>'volatility' or actual.proparallel<>'u'
      or actual.proconfig is distinct from array[expected->>'search_path']
      or to_jsonb(coalesce(actual.proargnames,'{}'::text[])) is distinct from expected->'args'
      or actual.pronargdefaults<>(expected->>'default_count')::integer
      or coalesce(pg_get_expr(actual.proargdefaults,0),'')<>expected->>'defaults'
      or actual.prorettype<>(expected->>'returns')::regtype or actual.proretset
      or actual.prokind<>'f' or actual.proisstrict or actual.proleakproof
      or pg_get_userbyid(actual.proowner)<>'postgres' then
      raise exception using errcode='55000',message='PENDING_FUNCTION_CHANGED: reviewed function changed '||(expected->>'signature');
    end if;
  end loop;
  if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='world_member_regions'
      and oid is distinct from to_regprocedure('public.world_member_regions(integer)')) then
    raise exception using errcode='55000',message='PENDING_FUNCTION_CHANGED: unexpected world member aggregate overload';
  end if;
end $reviewed_functions$;
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
-- non-bot signed-in visit with a valid country. Equal timestamps use the
-- event UUID as a stable tie-break, not as an arrival time.
-- public.events already stores what Cloudflare reports for
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
-- What leaves the database: one JSON answer. `countries` counts every account
-- by country (an account with no coordinates too), `total` is all of them,
-- and `cells` are [lon, lat, accounts, country, region code] with the place
-- rounded to hundredths of a degree (the precision of the state shapes the
-- globe uses to find the state). Never a uid, IP, city, postal code, device or
-- session. It is a single value rather than rows, so no row cap can cut the
-- totals short.
--
-- Who can call it: service_role only. The Worker route GET /v1/world/members
-- (workers/mccluster/src/world-members.js) gives the house owner the exact
-- counts and places, and everyone else the country totals of five or more.
--
-- Recovery: world_member_regions_v1.rollback.sql verifies the reviewed function
-- before removing it, while preserving all telemetry and identity rows.
--
-- Promote with supabase/pending/README.md (apply_migration under this name,
-- then git mv to supabase/migrations/<version>_world_member_regions_v1.sql).

create or replace function public.world_member_regions(p_days integer default 400)
returns jsonb
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
    order by e.uid, e.at desc, e.id desc
  ),
  placed as (
    select l.cc, l.rc,
      case when l.longitude between -180 and 180 and l.latitude between -90 and 90
        and not (l.longitude = 0 and l.latitude = 0) then round(l.longitude::numeric, 2) end as lon,
      case when l.longitude between -180 and 180 and l.latitude between -90 and 90
        and not (l.longitude = 0 and l.latitude = 0) then round(l.latitude::numeric, 2) end as lat
    from latest l
    join auth.users u on u.id = l.uid
  ),
  by_country as (
    select p.cc, count(*) as n from placed p group by 1
  ),
  by_place as (
    select p.cc, coalesce(p.rc, '') as rc, p.lon, p.lat, count(*) as n
    from placed p where p.lon is not null group by 1, 2, 3, 4
  )
  -- ONE ANSWER, NOT A SET: every account is in the totals, and no row cap (PostgREST's max rows included) can cut it short
  select jsonb_build_object(
    'countries', coalesce((select jsonb_object_agg(c.cc, c.n) from by_country c), '{}'::jsonb),
    'total', (select count(*) from placed),
    'cells', coalesce((select jsonb_agg(jsonb_build_array(b.lon, b.lat, b.n, b.cc, b.rc) order by b.n desc, b.cc, b.rc) from by_place b), '[]'::jsonb)
  );
$$;

comment on function public.world_member_regions(integer) is
  'The World place card: accounts by the IP country, region code and rounded place of their latest signed-in visit (one place per account), as one JSON answer {countries, total, cells}. Service role only; never a uid, IP, city, postal code or device.';

revoke all on function public.world_member_regions(integer) from public, anon, authenticated;
grant execute on function public.world_member_regions(integer) to service_role;
