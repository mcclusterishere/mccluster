insert into public.events_lean(at,name,device_id,session_id,country) values
 ('2026-03-08T05:00:00Z','page_view','repeat','s1','US'),
 ('2026-03-09T03:59:59Z','page_view','repeat','s2','US'),
 ('2026-03-08T06:00:00Z','unknown_new_event','unknown','s3','US'),
 ('2026-03-08T07:00:00Z','checkout_go','intent','s4','US'),
 ('2026-03-08T08:00:00Z','click','engaged','s5','US'),
 ('2026-03-09T04:00:00Z','page_view','at-until','excluded','US'),
 ('2026-03-08T04:59:59Z','page_view','before-since','excluded','US');
insert into public.events_lean(at,name,device_id,session_id,country,is_bot,site_id) values
 ('2026-03-08T12:00:00Z','page_view','bot','bot','US',true,null),
 ('2026-03-08T12:00:00Z','page_view','tenant','tenant','US',false,'00000000-0000-4000-8000-000000000001');
insert into public.events(id,name,at,device_id)
 select id,name,at,device_id from public.events_lean;
insert into auth.users values
 ('00000000-0000-4000-8000-000000000002','2026-03-08T05:00:00Z','2026-03-09T04:00:00Z'),
 ('00000000-0000-4000-8000-000000000003','2026-03-09T04:00:00Z',null);

set role authenticated;
select set_config('request.jwt.claims','{"role":"house_owner"}',false);
-- Force a non-UTC session to prove daily account and event buckets agree.
set timezone='America/Los_Angeles';
do $test$
declare r jsonb; n bigint; v bigint; d date;
begin
  r:=public.analytics_stage_totals('2026-03-08T05:00:00Z','2026-03-09T04:00:00Z',null);
  select (x->>'value')::bigint into n from jsonb_array_elements(r->'stages') x where x->>'stage'='view';
  assert n=1, 'whole-window distinct must deduplicate repeat visitor across days and exclude bot/tenant/boundary';
  select (x->>'value')::bigint into n from jsonb_array_elements(r->'stages') x where x->>'stage'='engage';
  assert n=1, 'unknown events cannot inflate engagement';
  select (x->>'value')::bigint into n from jsonb_array_elements(r->'stages') x where x->>'stage'='unclassified';
  assert n=1, 'unknown events remain visible';
  assert (r->'accounts'->>'made_an_account')::int=1, 'auth record at until excluded';
  assert (r->'accounts'->>'confirmed_the_email')::int=0, 'confirmation at until excluded';
  assert r->'verified_payments'='null'::jsonb, 'click does not establish a verified payment';
  select sum(arrived),sum(engaged) into n,v from public.analytics_funnel('2026-03-08T05:00:00Z','2026-03-09T04:00:00Z');
  assert n=2 and v=1, 'legacy daily stage totals remain device-days, unknown excluded';
  select day into d from public.analytics_signups_window('2026-03-08T05:00:00Z','2026-03-09T04:00:00Z') where made_an_account=1;
  assert d=date '2026-03-08', 'account day must be UTC even under non-UTC session';
  r:=public.analytics_stage_totals('2026-03-08T05:00:00Z','2026-03-09T04:00:00Z','00000000-0000-4000-8000-000000000001');
  assert r->'accounts'='null'::jsonb, 'global accounts not attributed to tenant';
  select (x->>'value')::bigint into n from jsonb_array_elements(r->'stages') x where x->>'stage'='view';
  assert n=1, 'tenant gets its own stage population';
  r:=public.analytics_geo_audience('US','2026-03-08T05:00:00Z','2026-03-09T04:00:00Z');
  select (x->>'visitors')::bigint into n from jsonb_array_elements(r->'stages') x where x->>'stage'='unclassified';
  assert n=1, 'map retains unclassified stage';
end;
$test$;
select set_config('request.jwt.claims','{"role":"member"}',false);
do $test$
begin
  perform public.analytics_stage_totals('2026-03-08','2026-03-10');
  raise exception 'member unexpectedly authorized';
exception when insufficient_privilege then null;
end;
$test$;
reset role;
set role anon;
do $test$
begin
  perform public.analytics_stage_totals('2026-03-08','2026-03-10');
  raise exception 'anon unexpectedly authorized';
exception when insufficient_privilege then null;
end;
$test$;
reset role;
