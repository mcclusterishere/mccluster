-- Shared platform infrastructure used by Equity Uprise; this file defines no building capability.
-- Stop routing publish requests to the five-argument RPC before recovery.
-- Keep all published sites, grants and the paid legacy publisher. Client access
-- remains revoked; recovery does not restore inherited browser EXECUTE grants.
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
  for expected in select value from jsonb_array_elements('[{"signature":"public.creator_publish_site(uuid,text,text,text)","name":"public.creator_publish_site","hashes":["5a2fc324a7486c483771385c5ecc0a03406bade1e18fe2e2f6990ce3c1c1fc40"],"language":"plpgsql","definer":false,"volatility":"v","search_path":"search_path=public, pg_temp","args":["p_org_id","p_title","p_tagline","p_bio"],"default_count":0,"defaults":"","returns":"text"},{"signature":"public.creator_publish_site(uuid,text,text,text,uuid)","name":"public.creator_publish_site","hashes":["d81b98bbc312d18e47d02911980552cd8235ab01d8e57469a2a8c3e6a47021b5"],"language":"plpgsql","definer":false,"volatility":"v","search_path":"search_path=public, pg_temp","args":["p_org_id","p_title","p_tagline","p_bio","p_user_id"],"default_count":0,"defaults":"","returns":"text","allow_absent":true}]'::jsonb) loop
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
  if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname='creator_publish_site'
    and oid not in ('public.creator_publish_site(uuid,text,text,text)'::regprocedure,coalesce(to_regprocedure('public.creator_publish_site(uuid,text,text,text,uuid)'),0))) then
    raise exception using errcode='55000',message='PENDING_FUNCTION_CHANGED: unexpected creator publisher overload';
  end if;
end $reviewed_functions$;
drop function if exists public.creator_publish_site(uuid,text,text,text,uuid);
revoke all on function public.creator_publish_site(uuid,text,text,text) from public,anon,authenticated;
