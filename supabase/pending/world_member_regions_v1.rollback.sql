-- Shared platform infrastructure used by Equity Uprise; this file defines no building capability.
-- Remove only the exact reviewed aggregate RPC. Events and identities remain intact.
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
drop function if exists public.world_member_regions(integer);
