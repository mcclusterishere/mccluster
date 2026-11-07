-- Run only on a controlled local/reset Supabase database AFTER the pending
-- policy-preserving migration. Transaction rolls back all fixture writes.
begin;
do $test$
declare
  v_org uuid;
  v_id uuid;
  v_record uuid;
  v_second uuid;
  v_run uuid;
  v_first_seen timestamptz;
  v_license jsonb := '{"publisher":"Fixture","commercial_use":false,"review_before_redistribution":true}'::jsonb;
  v_retention jsonb := '{"days":3}'::jsonb;
  v_connector public.ops_ingest_connectors;
  v_snapshot public.ops_ingest_records;
begin
  select id into v_org from public.orgs where slug = 'fixture-policy' limit 1;
  if v_org is null then raise exception 'Seed the isolated fixture organization before running this test'; end if;

  v_id := private.ops_ingest_ensure_connector(v_org, 'market.fixture_policy_guard', 'api',
    'Market fixture source', 'Retention regression', v_retention, v_license);

  v_record := private.ops_ingest_upsert_record(v_org,'market.fixture_policy_guard','api',
    'Market fixture source','fixture:2026-10-20','economic_indicator',
    '{"url":"https://example.org/source","retrieved_at":"2026-10-21T00:00:00Z"}'::jsonb,
    '2026-10-20T00:00:00Z'::timestamptz,
    '{"indicator":"sample","value":42,"unit":"index"}'::jsonb);

  select * into v_connector from public.ops_ingest_connectors where id = v_id;
  select * into v_snapshot from public.ops_ingest_records where id = v_record;
  if v_connector.license_policy is distinct from v_license or
     v_connector.retention_policy is distinct from v_retention then
    raise exception 'Source policy erased by canonical record upsert';
  end if;
  if v_snapshot.license_policy is distinct from v_license or
     v_snapshot.retention_policy is distinct from v_retention then
    raise exception 'Record policy snapshot does not match source policy';
  end if;
  if v_connector.description <> 'Retention regression' then
    raise exception 'Metadata description unexpectedly overwritten';
  end if;
  perform private.ops_ingest_ensure_connector(v_org,'market.fixture_policy_guard','api',
    'Market fixture source','Retention regression',null,null);
  select * into v_connector from public.ops_ingest_connectors where id=v_id;
  if v_connector.license_policy<>v_license or v_connector.retention_policy<>v_retention then
    raise exception 'Null policy inputs erased authoritative policy'; end if;
  -- A replay must keep the original immutable first-seen time and policy snapshot.
  update public.ops_ingest_records set created_at='2026-10-21T00:00:00Z' where id=v_record;
  select created_at into v_first_seen from public.ops_ingest_records where id=v_record;
  perform private.ops_ingest_ensure_connector(v_org, 'market.fixture_policy_guard', 'api',
    'Market fixture source', 'Updated by operator', '{"days":1}', '{"commercial_use":false,"version":2}');
  v_second := private.ops_ingest_upsert_record(v_org,'market.fixture_policy_guard','api',
    'Market fixture source','fixture:2026-10-20','economic_indicator','{}',
    '2026-10-20T00:00:00Z','{"indicator":"sample","value":42,"unit":"index"}');
  if v_second<>v_record then raise exception 'Replay did not deduplicate'; end if;
  select * into v_snapshot from public.ops_ingest_records where id=v_record;
  if v_snapshot.created_at<>v_first_seen or v_snapshot.license_policy<>v_license then
    raise exception 'Replay rewrote original knowledge time or policy'; end if;
  v_run := (public.ops_ingest_begin_run_service(v_org,'market.fixture_policy_guard')->>'id')::uuid;
  perform set_config('role','service_role',true);
  v_second := (public.ops_ingest_write_record_service(v_org,v_run,'fixture:2026-10-20',
    'economic_indicator','{}','2026-10-20T00:00:00Z','{"indicator":"sample","value":43,"unit":"index"}')->>'record_id')::uuid;
  perform set_config('role','none',true);
  select * into v_snapshot from public.ops_ingest_records where id=v_second;
  if v_second=v_record or v_snapshot.license_policy<>'{"commercial_use":false,"version":2}'::jsonb or
    v_snapshot.retention_policy<>'{"days":1}'::jsonb then raise exception 'New version lost current authoritative policy'; end if;
  select * into v_connector from public.ops_ingest_connectors where id=v_id;
  if v_connector.description<>'Updated by operator' then raise exception 'Service write replaced operator description'; end if;
  if has_function_privilege('anon','public.ops_ingest_write_record_service(uuid,uuid,text,text,jsonb,timestamptz,jsonb)','EXECUTE') or
     has_function_privilege('authenticated','private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb)','EXECUTE') then
    raise exception 'Repair expanded ingestion privileges'; end if;
  if has_function_privilege('anon','public.market_layer1_policy_ready_service()', 'EXECUTE') or
     has_function_privilege('authenticated','public.market_layer1_policy_ready_service()', 'EXECUTE') then
    raise exception 'Policy readiness must be service-role-only';
  end if;
  if not has_function_privilege('service_role','public.market_layer1_policy_ready_service()', 'EXECUTE') then
    raise exception 'Policy readiness unavailable to service role';
  end if;
end
$test$;
rollback;
