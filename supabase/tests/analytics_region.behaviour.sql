-- Behaviour test for supabase/migrations/20261017030554_analytics_region_v1.sql on a scratch
-- Postgres (scripts/test-analytics-region-db.sh). Test-only.
-- events stand-in: only the production columns this read uses.
create table public.events(
  id uuid primary key default gen_random_uuid(), at timestamptz not null, site_id uuid, name text not null,
  device_id text, is_bot boolean, country text, region text, city text, latitude double precision, longitude double precision, edge jsonb);

\i supabase/migrations/20261017030554_analytics_region_v1.sql

-- fixtures: CT 6 views (4 devices, code + name), NY 3 views (folded), MA 1 view (folded),
-- 2 US views with no region (GPC), 1 bot in CT, 1 GB, 1 other site, 1 out of window
insert into public.events(at,name,device_id,is_bot,country,region,city,latitude,longitude,edge,site_id) values
 (now()-interval '1 hour','page_view','d1',false,'US','Connecticut','Hartford',41.7,-72.7,'{"cf-region-code":"CT"}',null),
 (now()-interval '1 hour','page_view','d1',false,'us','Connecticut','Hartford',41.7,-72.7,'{"cf-region-code":"CT"}',null),
 (now()-interval '2 hour','page_view','d2',false,'US','Connecticut','New Haven',41.3,-72.9,'{"cf-region-code":"CT"}',null),
 (now()-interval '3 hour','page_view','d3',false,'US','Connecticut',null,null,null,'{"cf-region-code":"CT"}',null),
 (now()-interval '4 hour','page_view','d4',false,'US','Connecticut',null,null,null,'{"cf-region-code":"CT"}',null),
 (now()-interval '4 hour','page_view','d4',false,'US','Connecticut',null,null,null,'{"cf-region-code":"CT"}',null),
 (now()-interval '4 hour','click','d4',false,'US','Connecticut',null,null,null,'{"cf-region-code":"CT"}',null),
 (now()-interval '1 hour','page_view','b1',true,'US','Connecticut',null,null,null,'{"cf-region-code":"CT"}',null),
 (now()-interval '5 hour','page_view','n1',false,'US','New York',null,null,null,'{"cf-region-code":"NY"}',null),
 (now()-interval '5 hour','page_view','n2',false,'US','New York',null,null,null,'{"cf-region-code":"NY"}',null),
 (now()-interval '5 hour','page_view','n3',false,'US','New York',null,null,null,'{}',null),
 (now()-interval '5 hour','page_view','m1',false,'US','Massachusetts',null,null,null,'{"cf-region-code":"MA"}',null),
 (now()-interval '5 hour','page_view','q1',false,'US',null,null,null,null,'{"opted_out":"1"}',null),
 (now()-interval '5 hour','page_view','q2',false,'US',null,null,null,null,null,null),
 (now()-interval '5 hour','page_view','g1',false,'GB','England',null,null,null,'{"cf-region-code":"ENG"}',null),
 (now()-interval '5 hour','page_view','o1',false,'US','Connecticut',null,null,null,'{"cf-region-code":"CT"}','00000000-0000-0000-0000-000000000001'),
 (now()-interval '30 hour','page_view','o2',false,'US','Connecticut',null,null,null,'{"cf-region-code":"CT"}',null);

set role service_role;
do $t$
declare r record; n int; s bigint;
begin
  select * into r from public.analytics_region_totals('us', now()-interval '24 hour', now(), null) where region_code='CT';
  assert r.page_views = 6, 'CT page views (bot, other site, out of window, click excluded): '||r.page_views;
  assert r.visitors = 4, 'CT visitors: '||r.visitors;
  assert r.region = 'Connecticut', 'CT name';
  select count(*) into n from public.analytics_region_totals('US', now()-interval '24 hour', now(), null) where region_code is not null;
  assert n = 1, 'only regions with 5+ views are named: '||n;
  select page_views into s from public.analytics_region_totals('US', now()-interval '24 hour', now(), null) where folded;
  assert s = 4, 'NY (3, split code/name) and MA (1) fold into one row: '||s;
  select page_views into s from public.analytics_region_totals('US', now()-interval '24 hour', now(), null) where region_code is null and not folded;
  assert s = 2, 'no-region views are counted, not named: '||s;
  select count(*) into n from public.analytics_region_totals('USA', now()-interval '24 hour', now(), null);
  assert n = 0, 'a bad country code reads nothing';
end $t$;
reset role;
-- a signed-in member and anon cannot call it at all
set role authenticated;
do $t$ begin
  perform public.analytics_region_totals('US', now()-interval '1 hour', now(), null);
  raise exception 'authenticated must not execute analytics_region_totals';
exception when insufficient_privilege then null; end $t$;
reset role;
set role anon;
do $t$ begin
  perform public.analytics_region_totals('US', now()-interval '1 hour', now(), null);
  raise exception 'anon must not execute analytics_region_totals';
exception when insufficient_privilege then null; end $t$;
reset role;
select 'analytics_region behaviour: ok' as result;
