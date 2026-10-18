\set ON_ERROR_STOP on
begin;
do $$ declare r record; begin
 for r in select tablename from pg_tables where schemaname='public' and tablename like 'seek\_first\_%' escape '\' loop
  assert not has_table_privilege('anon','public.'||r.tablename,'select'), 'anon spatial read';
  assert not has_table_privilege('authenticated','public.'||r.tablename,'select'), 'member spatial read';
  assert has_table_privilege('service_role','public.'||r.tablename,'insert'), 'missing service writer';
 end loop;
 assert not has_function_privilege('authenticated','public.claim_instagram_discovery_accounts(integer)','execute');
 assert not has_function_privilege('anon','public.claim_social_insight_posts(integer)','execute');
end $$;
insert into public.orgs(id,slug,name) values('10000000-0000-4000-8000-000000000001','pipeline-test','Pipeline test');
insert into public.social_accounts(id,org_id,platform,external_account_id,status)
 values('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','instagram','pipeline-ig','connected');
set local role service_role;
do $$ declare claimed integer; begin
 perform public.claim_instagram_discovery_accounts(10);
 select count(*) into claimed from public.claim_instagram_discovery_accounts(10) where external_account_id='pipeline-ig';
 assert claimed=0,'account lease must prevent immediate second claim';
end $$;
insert into public.social_posts(id,org_id,account_id,external_media_id,publish_mode,published_at)
 values('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','old-post','imported',now()-interval '30 days');
do $$ declare claimed integer; begin
 select count(*) into claimed from public.claim_social_insight_posts(100) where external_media_id='old-post';
 assert claimed=1,'historical import must get an initial measurement';
 select count(*) into claimed from public.claim_social_insight_posts(100) where external_media_id='old-post';
 assert claimed=0,'insight lease must prevent immediate second claim';
end $$;
insert into public.social_metric_snapshots(org_id,post_id,views,reach,source)
 values('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',null,0,'platform_api');
do $$ begin
 assert (select views is null and reach=0 from public.social_metric_snapshots where post_id='10000000-0000-4000-8000-000000000003'), 'unknown and measured zero must remain distinct';
end $$;
insert into public.seek_first_events(org_id,source_key,external_id,event_type,location)
 values('10000000-0000-4000-8000-000000000001','usgs','pipeline-quake','earthquake','POINT(-72 41)')
 on conflict(org_id,source_key,external_id) do update set observed_at=now();
insert into public.seek_first_events(org_id,source_key,external_id,event_type,location)
 values('10000000-0000-4000-8000-000000000001','usgs','pipeline-quake','earthquake','POINT(-72 41)')
 on conflict(org_id,source_key,external_id) do update set observed_at=now();
do $$ begin
 assert (select count(*)=1 from public.seek_first_events where external_id='pipeline-quake'),'spatial replay must deduplicate';
end $$;
rollback;
