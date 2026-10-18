-- Test only: a narrow stand-in for the production events schema and RLS.
create table public.events(id uuid primary key default gen_random_uuid(), at timestamptz, name text, path text, device_id text, session_id text, site_id uuid, is_bot boolean default false, country text, region text, edge jsonb, props jsonb, source_host text);
create table public.event_taxonomy(event_name text primary key, stage text);
insert into public.event_taxonomy values ('page_view','view'),('song_start','content');
alter table public.events enable row level security;
create policy desk_read on public.events for select to authenticated using ((select public.eu_is_admin()));
\i supabase/migrations/20261017040826_analytics_geo_audience_v1.sql
insert into public.events(at,name,path,device_id,session_id,country,region,edge,source_host)
 select '2026-10-16T01:00Z'::timestamptz+g*interval '1 hour','page_view',case when g=2 then '/song' else '/' end,
 case when g<3 then 'repeat' else 'd'||g end,'s'||g,'US','Connecticut','{"cf-region-code":"CT"}', 'search'
 from generate_series(1,6) g;
insert into public.events(at,name,path,device_id,session_id,country,region,edge) values
 ('2026-10-16T10:00Z','song_start','/song','repeat','s1','US','Connecticut','{"cf-region-code":"CT"}'),
 ('2026-10-16T10:01Z','page_view','/song','repeat','s1','US','Connecticut','{"cf-region-code":"CT"}'),
 ('2026-10-16T10:00Z','page_view','/ny','ny','ny','US','New York','{"cf-region-code":"NY"}'),
 ('2026-10-16T10:00Z','page_view','/gb','gb','gb','GB',null,null),
 ('2026-10-17T00:00Z','page_view','/end','end','end','US','Connecticut','{"cf-region-code":"CT"}');
insert into public.events(at,name,device_id,session_id,country,is_bot) values('2026-10-16T10:00Z','page_view','bot','bot','US',true);
insert into public.events(at,name,device_id,session_id,country,site_id) values('2026-10-16T10:00Z','page_view','tenant','tenant','US','00000000-0000-0000-0000-000000000001');
alter table public.events add column referrer text, add column device jsonb, add column asn_org text;
create table public.events_lean(id uuid primary key,at timestamptz,site_id uuid,name text,path text,device_id text,session_id text,is_bot boolean,country text,referrer text,network text,src text,source text,track text,album text,listened_seconds numeric,dwell_s numeric,visible_s numeric,hidden_s numeric,depth numeric,exit_intent boolean,decision_id text,experience_surface text,experience_policy text,experience_experiment text,experience_arm text);
alter table public.events_lean enable row level security;
create policy desk_read on public.events_lean for select to authenticated using ((select public.eu_is_admin()));
\i supabase/migrations/20261017041311_analytics_geo_audience_hotpath_v2.sql
\i supabase/migrations/20261017041532_analytics_geo_audience_regions_v3.sql
insert into public.events_lean select (private.events_lean_row(e)).* from public.events e;
update public.events_lean set region=null,region_code=null;
\i supabase/migrations/20261017042608_analytics_geo_audience_region_backfill_v4.sql
create trigger events_lean_sync after insert or update on public.events for each row execute function private.events_lean_sync();
-- Existing trigger behavior and all prior projected fields survive the added region fields.
insert into public.events(at,name,device_id,session_id,country,region,edge,props) values ('2026-10-15','song_start','outside','outside','US','New York','{"cf-region-code":"ny"}','{"experience_arm":"control","decision_id":"d-test"}');
update public.events set region='Connecticut',edge='{"cf-region-code":"ct"}' where device_id='outside';
do $$ begin
 assert (select region_code='CT' and region='Connecticut' and experience_arm='control' and decision_id='d-test' from public.events_lean where device_id='outside'), 'trigger insert/update preserves existing projection and region';
end $$;
set role authenticated;
select set_config('request.jwt.claims','{"email":"matthew@mccluster.org"}',false);
do $$ declare r jsonb; begin
 r:=public.analytics_geo_audience('US','2026-10-16','2026-10-17');
 assert (r#>>'{totals,visitors}')::int=6, 'deduplicated country visitors, no bot/tenant/end-boundary/GB';
 assert (r#>>'{totals,returning}')::int=1, 'returning distinct device';
 assert jsonb_array_length(r->'series')=24, '24 zero-filled buckets';
 assert not r::text like '%/gb%', 'all cards share geographic predicate';
 r:=public.analytics_geo_audience('US','2026-10-16','2026-10-17',null,array['CT'],array['connecticut']);
 assert (r#>>'{totals,visitors}')::int=5, 'state distinct visitors';
 assert (r#>>'{totals,plays}')::int=1, 'real song_start definition';
 assert (r#>>'{totals,page_views}')::int=7, 'state views';
 assert not r::text like '%/ny%', 'state paths/pages/sources never include other state';
 assert jsonb_array_length(r->'paths')=1, 'transition in one scoped session';
 r:=public.analytics_geo_audience('US','2026-10-16','2026-10-17',null,array['NY'],array['new york']);
 assert (r->>'suppressed')::boolean and not r?'totals', 'small state group suppressed in database';
 r:=public.analytics_geo_audience('CA','2026-10-16','2026-10-17');
 assert (r#>>'{totals,visitors}')::int=0, 'successful empty country is zero';
 assert not has_function_privilege('anon','public.analytics_geo_audience(text,timestamptz,timestamptz,uuid,text[],text[],text)','EXECUTE'), 'anon cannot execute';
end $$;
select set_config('request.jwt.claims','{"email":"member@example.test"}',false);
do $$ begin
 begin perform public.analytics_geo_audience('US','2026-10-16','2026-10-17'); raise exception 'member was allowed';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
