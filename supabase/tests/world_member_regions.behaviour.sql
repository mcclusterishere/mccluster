-- Test-only. Run on a disposable native PostgreSQL database after the real
-- telemetry DDL and world_member_regions migration. No base object is replaced.
-- scripts/test-world-member-regions-db.sh supplies auth/API-role stand-ins;
-- a full-reset CI database can run this same fixture with its real dependencies.
-- All synthetic accounts, telemetry, helpers and trigger side effects roll back.
begin;
set local statement_timeout = '20s';

do $baseline$
begin
  assert not exists (select 1 from public.events), 'fixture requires an empty disposable events table';
  assert not exists (select 1 from auth.users where id::text like 'd8710000-%'), 'synthetic account namespace must be unused';
  assert (select atttypid = 'uuid'::regtype from pg_attribute
    where attrelid = 'public.events'::regclass and attname = 'id'), 'real UUID event ID required';
end $baseline$;

create temp table world_member_regions_checks(label text primary key);
create function pg_temp.prove(label text, ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if ok is distinct from true then raise exception 'world member regions: %', label; end if;
  insert into pg_temp.world_member_regions_checks values (label);
end $$;
create function pg_temp.member_id(n integer) returns uuid
language sql immutable as $$ select ('d8710000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.event_id(n integer) returns uuid
language sql immutable as $$ select ('e8710000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.add_members(n integer) returns void language sql as $$
  insert into auth.users(id, email)
  select pg_temp.member_id(i), 'world-members-' || i || '@example.invalid' from generate_series(1, n) i
$$;

select pg_temp.prove('RPC returns one JSON value with an empty search path',
  (select not proretset and prorettype = 'jsonb'::regtype and prosecdef
    and 'search_path=""' = any(proconfig)
   from pg_proc where oid = 'public.world_member_regions(integer)'::regprocedure));
select pg_temp.prove('service role can execute', has_function_privilege('service_role', 'public.world_member_regions(integer)', 'execute'));
select pg_temp.prove('anon cannot execute', not has_function_privilege('anon', 'public.world_member_regions(integer)', 'execute'));
select pg_temp.prove('member cannot execute', not has_function_privilege('authenticated', 'public.world_member_regions(integer)', 'execute'));
set local role anon;
do $$ begin
  perform public.world_member_regions();
  raise exception 'anon unexpectedly executed the RPC';
exception when insufficient_privilege then null; end $$;
reset role;
set local role authenticated;
do $$ begin
  perform public.world_member_regions();
  raise exception 'member unexpectedly executed the RPC';
exception when insufficient_privilege then null; end $$;
reset role;

set local role service_role;
select pg_temp.prove('empty database returns the complete empty shape',
  public.world_member_regions() = '{"countries":{},"total":0,"cells":[]}'::jsonb);
reset role;

-- Each scenario uses a savepoint so the next sees no accounts or telemetry.
-- Keep successful assertion labels outside the scenario rollback.
savepoint latest;
select pg_temp.add_members(3);
insert into public.events(id, uid, at, name, country, longitude, latitude, edge, is_bot) values
 (pg_temp.event_id(1), pg_temp.member_id(1), now()-interval '4 days', 'page_view', 'US', -72.7, 41.7, '{"cf-region-code":"CT"}', false),
 (pg_temp.event_id(2), pg_temp.member_id(1), now()-interval '2 hours', 'page_view', 'ca', -79.384, 43.654, '{"cf-region-code":"ON"}', false),
 (pg_temp.event_id(3), pg_temp.member_id(1), now()-interval '1 hour', 'page_view', 'CA', -79.384, 43.654, '{"cf-region-code":"ON"}', false),
 (pg_temp.event_id(4), pg_temp.member_id(2), now()-interval '1 hour', 'page_view', 'GB', null, null, '{}', false),
 (pg_temp.event_id(5), pg_temp.member_id(3), now()-interval '2 hours', 'page_view', 'AU', null, null, '{}', false),
 (pg_temp.event_id(6), pg_temp.member_id(3), now(), 'page_view', 'US', -72.7, 41.7, '{}', true),
 (pg_temp.event_id(7), pg_temp.member_id(3), now(), 'page_view', 'XX', -72.7, 41.7, '{}', false);
set local role service_role;
select pg_temp.prove('one account at its latest eligible visit, with missing coordinates still counted',
  public.world_member_regions() = '{"countries":{"CA":1,"GB":1,"AU":1},"total":3,"cells":[[-79.38,43.65,1,"CA","ON"]]}'::jsonb);
reset role;
rollback to latest;
select pg_temp.prove('latest eligible visit and account deduplication passed', true);

savepoint excluded;
select pg_temp.add_members(8);
insert into public.events(id, uid, at, name, country, is_bot) values
 (pg_temp.event_id(1), null, now(), 'page_view', 'US', false),
 (pg_temp.event_id(2), pg_temp.member_id(99), now(), 'page_view', 'US', false),
 (pg_temp.event_id(3), pg_temp.member_id(1), now(), 'page_view', 'US', true),
 (pg_temp.event_id(4), pg_temp.member_id(2), now(), 'page_view', null, false),
 (pg_temp.event_id(5), pg_temp.member_id(3), now(), 'page_view', 'xx', false),
 (pg_temp.event_id(6), pg_temp.member_id(4), now(), 'page_view', 'USA', false),
 (pg_temp.event_id(7), pg_temp.member_id(5), now(), 'page_view', '', false),
 (pg_temp.event_id(8), pg_temp.member_id(6), now(), 'page_view', ' U', false),
 (pg_temp.event_id(9), pg_temp.member_id(7), now(), 'page_view', 'gb', null),
 (pg_temp.event_id(10), pg_temp.member_id(8), now(), 'page_view', 'CA', false);
delete from auth.users where id = pg_temp.member_id(8);
set local role service_role;
select pg_temp.prove('bots, guests, invalid countries and deleted accounts excluded; null bot is eligible',
  public.world_member_regions() = '{"countries":{"GB":1},"total":1,"cells":[]}'::jsonb);
reset role;
rollback to excluded;
select pg_temp.prove('excluded account and telemetry cases passed', true);

savepoint coordinates;
select pg_temp.add_members(13);
insert into public.events(id, uid, at, name, country, longitude, latitude, edge)
select pg_temp.event_id(n), pg_temp.member_id(n), now(), 'page_view', 'US', lon, lat, '{}'::jsonb
from (values
  (1, -72.684::double precision, 41.766::double precision),
  (2, 180.01, 10), (3, 10, 90.01), (4, -180.01, 10), (5, 10, -90.01),
  (6, 0, 0), (7, 0, 51), (8, 10, 0), (9, null, 10), (10, 10, null),
  (11, 'NaN'::double precision, 10), (12, 'Infinity'::double precision, 10),
  (13, -180, 90)) p(n, lon, lat);
set local role service_role;
select pg_temp.prove('invalid coordinates do not remove country counts',
  public.world_member_regions()->'countries' = '{"US":13}'::jsonb and (public.world_member_regions()->>'total')::int = 13);
select pg_temp.prove('coordinate rounding, inclusive bounds and single zero coordinates',
  (select jsonb_agg(c order by (c->>0)::numeric, (c->>1)::numeric)
   from jsonb_array_elements(public.world_member_regions()->'cells') c)
  = '[[-180,90,1,"US",""],[-72.68,41.77,1,"US",""],[0,51,1,"US",""],[10,0,1,"US",""]]'::jsonb);
reset role;
rollback to coordinates;
select pg_temp.prove('coordinate precision and bounds passed', true);

savepoint window_bounds;
select pg_temp.add_members(5);
insert into public.events(id, uid, at, name, country)
select pg_temp.event_id(n), pg_temp.member_id(n), observed, 'page_view', 'US'
from (values (1, now()-interval '1 day'), (2, now()-interval '1 day 1 microsecond'),
  (3, now()-interval '400 days'), (4, now()-interval '400 days 1 microsecond'),
  (5, now()-interval '1 hour')) p(n, observed);
set local role service_role;
select pg_temp.prove('default 400-day window includes its lower bound', (public.world_member_regions()->>'total')::int = 4);
select pg_temp.prove('null uses the default and large windows clamp to retention',
  public.world_member_regions(null) = public.world_member_regions(400)
  and public.world_member_regions(2147483647) = public.world_member_regions(400));
select pg_temp.prove('zero and negative windows clamp to one day, including its lower bound',
  (public.world_member_regions(1)->>'total')::int = 2
  and public.world_member_regions(0) = public.world_member_regions(1)
  and public.world_member_regions(-2147483648) = public.world_member_regions(1));
reset role;
rollback to window_bounds;
select pg_temp.prove('window boundaries and argument bounds passed', true);

savepoint equal_timestamps;
select pg_temp.add_members(1);
insert into public.events(id, uid, at, name, country) values
 (pg_temp.event_id(1), pg_temp.member_id(1), now(), 'page_view', 'US'),
 (pg_temp.event_id(2), pg_temp.member_id(1), now(), 'page_view', 'CA');
set local role service_role;
select pg_temp.prove('equal timestamps use a stable UUID tie-break',
  public.world_member_regions() = '{"countries":{"CA":1},"total":1,"cells":[]}'::jsonb);
reset role;
-- Reverse physical row order. The UUID breaks ties; it is not an arrival time.
delete from public.events where id = pg_temp.event_id(1);
insert into public.events(id, uid, at, name, country)
values (pg_temp.event_id(1), pg_temp.member_id(1), now(), 'page_view', 'US');
set local role service_role;
select pg_temp.prove('equal timestamp result is independent of heap insertion order',
  public.world_member_regions() = '{"countries":{"CA":1},"total":1,"cells":[]}'::jsonb);
reset role;
rollback to equal_timestamps;
select pg_temp.prove('deterministic latest-event tie cases passed', true);

savepoint region_cells;
select pg_temp.add_members(6);
insert into public.events(id, uid, at, name, country, longitude, latitude, edge)
select pg_temp.event_id(n), pg_temp.member_id(n), now(), 'page_view', cc, -72.701, 41.701, jsonb_build_object('cf-region-code', rc)
from (values (1, 'US', ' c-t '), (2, 'US', 'CT'), (3, 'US', 'abc_def!'),
  (4, 'US', '???'), (5, 'US', null), (6, 'GB', '')) p(n, cc, rc);
set local role service_role;
select pg_temp.prove('region codes sanitize, cells aggregate and countries remain separate',
  public.world_member_regions() = '{"countries":{"US":5,"GB":1},"total":6,"cells":[[-72.7,41.7,2,"US",""],[-72.7,41.7,2,"US","CT"],[-72.7,41.7,1,"GB",""],[-72.7,41.7,1,"US","ABCD"]]}'::jsonb);
reset role;
rollback to region_cells;
select pg_temp.prove('cell grouping and region sanitization passed', true);

savepoint large_population;
select pg_temp.add_members(1005);
insert into public.events(id, uid, at, name, country, longitude, latitude, edge)
select pg_temp.event_id(n), pg_temp.member_id(n), now(), 'page_view', 'US', -72.7, 41.7, '{"cf-region-code":"CT"}'::jsonb
from generate_series(1, 1005) n;
set local role service_role;
select pg_temp.prove('over 1000 accounts fit in one complete JSON result',
  public.world_member_regions() = '{"countries":{"US":1005},"total":1005,"cells":[[-72.7,41.7,1005,"US","CT"]]}'::jsonb);
reset role;
rollback to large_population;
select pg_temp.prove('large account population passed', true);

select count(*) as passed_scenarios from pg_temp.world_member_regions_checks;
rollback;
