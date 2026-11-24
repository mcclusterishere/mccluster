-- Disposable full-reset PostgreSQL integration proof after applying the four migrations:
-- core_reflection_read_indexes_v1, ops_signals_digest_window_unique_v1,
-- world_publisher_verified_geo_v1, market_layer1_preserve_source_policy.
-- Never run against production. No base function/table/trigger is replaced or disabled.
-- Every synthetic row and every real trigger side effect rolls back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '20s';

do $baseline$
declare index_name text;
begin
  assert exists (select 1 from public.orgs where slug='mccluster' and enabled), 'full reset must contain the house organization';
  assert exists (select 1 from pg_trigger where tgrelid='public.ops_agent_jobs'::regclass
    and tgname='ops_ontology_sync_job_t' and tgenabled='O'), 'real ontology job trigger required';
  assert exists (select 1 from pg_trigger where tgrelid='public.ops_signals'::regclass
    and tgname='trg_ops_signal_rescore' and tgenabled='O'), 'real signal rescore trigger required';
  foreach index_name in array array['ops_agent_jobs_reflection_health_idx','ops_agent_jobs_reflection_recent_idx','ops_signals_core_digest_window_key'] loop
    assert exists (select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
      where c.relnamespace='public'::regnamespace and c.relname=index_name and i.indisvalid and i.indisready),
      format('valid, ready index required: %s',index_name);
  end loop;
  assert (select indisunique from pg_index where indexrelid='public.ops_signals_core_digest_window_key'::regclass), 'digest index must be unique';
  assert (select relrowsecurity from pg_class where oid='public.media_news_sources'::regclass), 'publisher RLS must remain enabled';
end $baseline$;

select set_config('mccluster.small_migration_test_org',(select id::text from public.orgs where slug='mccluster'),true);
insert into public.orgs(id,slug,name) values
  ('e8240000-0000-4000-8000-000000000002','small-migration-reset-tenant','Synthetic migration tenant');

insert into public.ops_agent_jobs(id,org_id,job_type,status,updated_at) values
  ('e8240000-0000-4000-8000-000000000003',current_setting('mccluster.small_migration_test_org')::uuid,'repo_health','done','2026-11-24T00:00:00Z'),
  ('e8240000-0000-4000-8000-000000000004',current_setting('mccluster.small_migration_test_org')::uuid,'host_health','done','2026-11-24T00:00:01Z');
do $jobs$
begin
  assert exists (select 1 from public.ops_ontology_objects where source_ref->>'table'='ops_agent_jobs'
    and source_ref->>'pk'='e8240000-0000-4000-8000-000000000003'), 'real job insertion must preserve ontology materialization';
end $jobs$;

do $digest$
declare house uuid := current_setting('mccluster.small_migration_test_org')::uuid;
begin
  insert into public.ops_signals(org_id,signal_type,source,payload)
    values(house,'core_morning_digest','small-migration-reset-proof','{"window_id":"small-migration-reset-window"}');
  begin
    insert into public.ops_signals(org_id,signal_type,source,payload)
      values(house,'core_morning_digest','small-migration-reset-proof','{"window_id":"small-migration-reset-window"}');
    raise exception 'same-organization duplicate digest was accepted';
  exception when unique_violation then null; end;
  insert into public.ops_signals(org_id,signal_type,source,payload) values
    ('e8240000-0000-4000-8000-000000000002','core_morning_digest','small-migration-reset-proof','{"window_id":"small-migration-reset-window"}'),
    (house,'other_signal','small-migration-reset-proof','{"window_id":"small-migration-reset-window"}'),
    (house,'core_morning_digest','small-migration-reset-proof','{}'),
    (house,'core_morning_digest','small-migration-reset-proof','{}');
  assert (select count(*)=5 from public.ops_signals where source='small-migration-reset-proof'), 'digest scope must allow other tenants/types and legacy rows';
end $digest$;

insert into public.media_news_sources(id,domain,language_code)
  values('e8240000-0000-4000-8000-000000000005','small-migration-reset.example','en');
do $publisher$
declare assignment text;
begin
  assert exists (select 1 from public.media_news_sources where id='e8240000-0000-4000-8000-000000000005'
    and headquarters_latitude is null and headquarters_longitude is null and publisher_kind is null), 'legacy insert shape must still work';
  update public.media_news_sources set publisher_kind='wire',headquarters_label='Synthetic verified publisher',
    headquarters_latitude=40,headquarters_longitude=-75,headquarters_basis='official_address',
    headquarters_source_url='https://small-migration-reset.example/about',headquarters_verified_at=now()
    where id='e8240000-0000-4000-8000-000000000005';
  foreach assignment in array array[
    'publisher_kind=''unknown''','headquarters_latitude=91','headquarters_longitude=-181',
    'headquarters_basis=''story_mention''','headquarters_source_url=''http://small-migration-reset.example''',
    'headquarters_longitude=null','headquarters_basis=null','headquarters_verified_at=null','headquarters_source_url=null'
  ] loop
    begin
      execute format('update public.media_news_sources set %s where id=''e8240000-0000-4000-8000-000000000005''',assignment);
      raise exception 'invalid publisher metadata was accepted: %',assignment;
    exception when check_violation then null; end;
  end loop;
end $publisher$;

do $connector$
declare
  house uuid := current_setting('mccluster.small_migration_test_org')::uuid;
  first_id uuid; replay_id uuid; value public.ops_ingest_connectors%rowtype;
begin
  first_id := private.ops_ingest_ensure_connector(house,'small-migration-reset','api','Synthetic source','Verified fixture',
    '{"days":30}','{"permission":"read"}');
  replay_id := private.ops_ingest_ensure_connector(house,'small-migration-reset','api','Synthetic source','Canonical McCluster source adapter');
  assert replay_id=first_id, 'ensure must reuse the canonical connector';
  perform private.ops_ingest_ensure_connector(house,'small-migration-reset','api','Synthetic source','Canonical McCluster source adapter',null,null);
  perform private.ops_ingest_ensure_connector(house,'small-migration-reset','api','Synthetic source','Canonical McCluster source adapter','{}','{}');
  select * into strict value from public.ops_ingest_connectors where id=first_id;
  assert value.description='Verified fixture' and value.retention_policy='{"days":30}'::jsonb
    and value.license_policy='{"permission":"read"}'::jsonb, 'omitted/empty policies or canonical placeholder erased reviewed policy';
  perform private.ops_ingest_ensure_connector(house,'small-migration-reset','api','Synthetic source','Explicit replacement','{"days":14}','{"permission":"quoted"}');
  select * into strict value from public.ops_ingest_connectors where id=first_id;
  assert value.description='Explicit replacement' and value.retention_policy='{"days":14}'::jsonb
    and value.license_policy='{"permission":"quoted"}'::jsonb, 'explicit reviewed policy change was lost';
end $connector$;

do $privileges$
declare role_name text; privilege_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    foreach privilege_name in array array['select','insert','update','delete'] loop
      assert not has_table_privilege(role_name,'public.media_news_sources',privilege_name), 'client publisher privilege leaked';
    end loop;
    assert not has_function_privilege(role_name,'private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb)','execute'), 'private helper grant leaked';
    assert not has_function_privilege(role_name,'public.market_layer1_policy_ready_service()','execute'), 'readiness probe client grant leaked';
  end loop;
  assert has_function_privilege('service_role','public.market_layer1_policy_ready_service()','execute'), 'service readiness grant missing';
end $privileges$;

set local role anon;
do $anon$
begin
  begin perform 1 from public.media_news_sources; raise exception 'anon read publisher table';
  exception when insufficient_privilege then null; end;
  begin perform public.market_layer1_policy_ready_service(); raise exception 'anon called readiness';
  exception when insufficient_privilege then null; end;
end $anon$;
reset role;
set local role authenticated;
do $member$
begin
  begin insert into public.media_news_sources(domain) values('denied-small-migration.example'); raise exception 'member wrote publisher table';
  exception when insufficient_privilege then null; end;
  begin perform public.market_layer1_policy_ready_service(); raise exception 'member called readiness';
  exception when insufficient_privilege then null; end;
end $member$;
reset role;
set local role service_role;
do $service$
begin
  assert public.market_layer1_policy_ready_service(), 'service readiness false';
  insert into public.media_news_sources(id,domain)
    values('e8240000-0000-4000-8000-000000000006','service-small-migration-reset.example');
end $service$;
reset role;

rollback;
do $cleanup$
begin
  assert not exists (select 1 from public.orgs where id='e8240000-0000-4000-8000-000000000002'), 'fixture tenant persisted';
  assert not exists (select 1 from public.ops_agent_jobs where id in ('e8240000-0000-4000-8000-000000000003','e8240000-0000-4000-8000-000000000004')), 'fixture jobs persisted';
  assert not exists (select 1 from public.ops_ontology_objects where source_ref->>'pk' in ('e8240000-0000-4000-8000-000000000003','e8240000-0000-4000-8000-000000000004')), 'real trigger side effects persisted';
  assert not exists (select 1 from public.ops_signals where source='small-migration-reset-proof'), 'fixture signals persisted';
  assert not exists (select 1 from public.ops_ingest_connectors where connector_key='small-migration-reset'), 'fixture policy persisted';
  assert not exists (select 1 from public.media_news_sources where id in ('e8240000-0000-4000-8000-000000000005','e8240000-0000-4000-8000-000000000006')), 'fixture publisher persisted';
end $cleanup$;
select 'PASS small migration full-reset behavior and rollback' as result;
