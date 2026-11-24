-- Shared platform infrastructure used by Equity Uprise; this file defines no building capability.
-- Recovery never overwrites or deletes connector policy records.
-- With any connector present, retain the fix and prepare a reviewed forward repair.
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
  for expected in select value from jsonb_array_elements('[{"signature":"private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb)","name":"private.ops_ingest_ensure_connector","hashes":["ddf87fda5fee738672420995717479d209300a527539af29c4e44c19f921e690","1b641a32040c6c76cd6f5efeb3c2945874771c8fa3f0970fec4347d41c775037"],"language":"plpgsql","definer":true,"volatility":"v","search_path":"search_path=public, pg_temp","args":["p_org","p_connector_key","p_kind","p_display_name","p_description","p_retention","p_license"],"default_count":3,"defaults":"''''::text, ''{}''::jsonb, ''{}''::jsonb","returns":"uuid"},{"signature":"public.market_layer1_policy_ready_service()","name":"public.market_layer1_policy_ready_service","hashes":["d95892506adc2c70423d1da857139277282327979577841606470f7c0989f26a"],"language":"sql","definer":false,"volatility":"s","search_path":"search_path=\"\"","args":[],"default_count":0,"defaults":"","returns":"boolean","allow_absent":true}]'::jsonb) loop
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
  if (to_regprocedure('public.market_layer1_policy_ready_service()') is not null) is distinct from
    exists(select 1 from pg_proc where oid='private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb)'::regprocedure and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='1b641a32040c6c76cd6f5efeb3c2945874771c8fa3f0970fec4347d41c775037') then
    raise exception using errcode='55000',message='PENDING_FUNCTION_CHANGED: partial connector-policy installation';
  end if;
end $reviewed_functions$;
do $retain_connector_policies$
begin
  if to_regprocedure('public.market_layer1_policy_ready_service()') is null then return; end if;
  lock table public.ops_ingest_connectors in access exclusive mode;
  if exists(select 1 from public.ops_ingest_connectors) then raise exception using errcode='55000',message='PENDING_ROLLBACK_DATA_PRESENT: retain connector policy protection'; end if;
end $retain_connector_policies$;
-- Exact original helper body from 20260919055029_universal_ingestion_entity_resolution_v1.sql.
create or replace function private.ops_ingest_ensure_connector(
  p_org uuid,
  p_connector_key text,
  p_kind text,
  p_display_name text,
  p_description text default '',
  p_retention jsonb default '{}'::jsonb,
  p_license jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare v_id uuid;
begin
  insert into public.ops_ingest_connectors(
    org_id,connector_key,kind,display_name,description,retention_policy,license_policy
  ) values (
    p_org,p_connector_key,p_kind,p_display_name,coalesce(p_description,''),
    coalesce(p_retention,'{}'::jsonb),coalesce(p_license,'{}'::jsonb)
  )
  on conflict (org_id,connector_key) do update set
    kind=excluded.kind,
    display_name=excluded.display_name,
    description=excluded.description,
    retention_policy=excluded.retention_policy,
    license_policy=excluded.license_policy,
    updated_at=now()
  returning id into v_id;
  return v_id;
end
$$;
drop function if exists public.market_layer1_policy_ready_service();
