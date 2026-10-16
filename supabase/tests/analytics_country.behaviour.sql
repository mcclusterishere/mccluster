-- Behaviour test for supabase/pending/analytics_country_v1.sql on a scratch
-- Postgres (scripts/test-analytics-country-db.sh). Test-only.
-- events_lean stand-in: the production columns these reads use, with an
-- owner-only RLS policy shaped like "only the desk reads it".
create table public.events_lean(
  id uuid primary key default gen_random_uuid(), at timestamptz not null, site_id uuid, name text not null,
  path text, device_id text, session_id text, is_bot boolean not null default false, country text);
alter table public.events_lean enable row level security;
revoke all on table public.events_lean from public, anon, authenticated;
grant select on table public.events_lean to authenticated;
create policy desk_reads on public.events_lean for select to authenticated
  using (coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email','') = 'owner@example.test');

\i supabase/pending/analytics_country_v1.sql

-- fixtures: 6 US page views from 4 devices, 1 bot (US), 2 GB, 1 unknown country, 1 bad code, 1 other site, 1 out of window
insert into public.events_lean(at,name,device_id,session_id,is_bot,country,site_id) values
 (now()-interval '1 hour','page_view','d1','s1',false,'US',null),
 (now()-interval '1 hour','page_view','d1','s1',false,'us',null),
 (now()-interval '2 hour','page_view','d2','s2',false,'US',null),
 (now()-interval '3 hour','page_view','d3','s3',false,'US',null),
 (now()-interval '20 hour','page_view','d4','s4',false,'US',null),
 (now()-interval '20 hour','click','d4','s4',false,'US',null),
 (now()-interval '21 hour','page_view','d4','s5',false,'US',null),
 (now()-interval '1 hour','page_view','b1','sb',true,'US',null),
 (now()-interval '5 hour','page_view','g1','g1',false,'GB',null),
 (now()-interval '6 hour','page_view','g2','g2',false,'GB',null),
 (now()-interval '5 hour','page_view','x1','x1',false,null,null),
 (now()-interval '5 hour','page_view','x2','x2',false,'T1x',null),
 (now()-interval '5 hour','page_view','o1','o1',false,'US','00000000-0000-0000-0000-000000000001'),
 (now()-interval '30 hour','page_view','o2','o2',false,'US',null);

set role authenticated;
select set_config('request.jwt.claims','{"email":"owner@example.test"}',false);
do $t$
declare r record; s bigint; v bigint; n int;
begin
  select * into r from public.analytics_country_totals(now()-interval '24 hour', now(), null) where country='US';
  assert r.page_views = 6, 'US page views (bots, other sites, out of window excluded; lower-case code counted): '||r.page_views;
  assert r.visitors = 4, 'US visitors: '||r.visitors;
  assert r.sessions = 5, 'US sessions: '||r.sessions;
  select count(*) into n from public.analytics_country_totals(now()-interval '24 hour', now(), null);
  assert n = 2, 'only real two-letter countries come back: '||n;
  select count(*), sum(page_views) into n, s from public.analytics_country_series('us', now()-interval '24 hour', now(), null, 'UTC');
  assert n = 24, '24 buckets: '||n;
  assert s = 6, 'the series adds up to the total: '||s;
  select count(*) into n from public.analytics_country_series('USA', now()-interval '24 hour', now(), null, 'UTC') where page_views > 0;
  assert n = 0, 'a bad code reads nothing';
  select sum(page_views) into s from public.analytics_country_series('US', now()-interval '24 hour', now(), '00000000-0000-0000-0000-000000000001', 'UTC');
  assert s = 1, 'a site reads only its own events';
end $t$;
-- a signed-in member who is not the desk reads nothing (RLS)
select set_config('request.jwt.claims','{"email":"member@example.test"}',false);
do $t$ declare n int; begin
  select count(*) into n from public.analytics_country_totals(now()-interval '24 hour', now(), null);
  assert n = 0, 'RLS: a member reads no country rows';
end $t$;
reset role;
-- anon cannot call it at all
set role anon;
do $t$ begin
  perform public.analytics_country_totals(now()-interval '1 hour', now(), null);
  raise exception 'anon must not execute analytics_country_totals';
exception when insufficient_privilege then null; end $t$;
reset role;
select 'analytics_country behaviour: ok' as result;
