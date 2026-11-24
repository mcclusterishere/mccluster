-- Shared platform infrastructure used by Equity Uprise; this file defines no building capability.
-- Data-preserving recovery: pause new RPC draft saves and publication, keeping
-- the visibility fix and all pages. This deliberately does not restore the defect.
-- Stop incoming save requests first; already-admitted calls may finish.
-- Read, get-self, unpublish and takedown RPCs retain their exact existing grants.
-- The legacy Worker route is separate and retains its companion API guard.
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
  for expected in select value from jsonb_array_elements('[{"signature":"member_fronts_private.save(jsonb,integer,boolean,boolean)","name":"member_fronts_private.save","hashes":["b561c9eeb3115dbe57736ad6748de78c69e1160a08ca1a9b8a34bc057b0d0dc9"],"language":"plpgsql","definer":true,"volatility":"v","search_path":"search_path=\"\"","args":["p_config","p_expected_revision","p_publish","p_globe_opt_in"],"default_count":0,"defaults":"","returns":"jsonb"},{"signature":"public.member_front_save(jsonb,integer,boolean,boolean)","name":"public.member_front_save","hashes":["313fb3d456caf0deb0826c899bdfbd9fabac50c9e4a55cc29880db1df5e008ea"],"language":"sql","definer":false,"volatility":"v","search_path":"search_path=\"\"","args":["p_config","p_expected_revision","p_publish","p_globe_opt_in"],"default_count":0,"defaults":"","returns":"jsonb"}]'::jsonb) loop
    function_oid:=to_regprocedure(expected->>'signature');
    if function_oid is null then
      if coalesce((expected->>'allow_absent')::boolean,false) then continue; end if;
      raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_CHANGED: missing reviewed function '||(expected->>'signature');
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
      raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_CHANGED: reviewed function changed '||(expected->>'signature');
    end if;
  end loop;

end $reviewed_functions$;
do $save_admission$
declare function_oid oid; api_grants integer; mode text; observed text; comment_value text;
begin
  foreach function_oid in array array['public.member_front_save(jsonb,integer,boolean,boolean)'::regprocedure,'member_fronts_private.save(jsonb,integer,boolean,boolean)'::regprocedure] loop
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=function_oid and (a.grantor<>'postgres'::regrole or a.grantee not in('postgres'::regrole,'authenticated'::regrole,'service_role'::regrole)
        or a.privilege_type<>'EXECUTE' or (a.grantee<>'postgres'::regrole and a.is_grantable))) then
      raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_ADMISSION_CHANGED: unreviewed execute grant';
    end if;
    select count(*) into api_grants from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=function_oid and a.grantee in('authenticated'::regrole,'service_role'::regrole) and a.privilege_type='EXECUTE';
    if api_grants not in(0,2) then raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_ADMISSION_CHANGED: partial admission'; end if;
    observed:=case when api_grants=2 then 'active' else 'paused' end;
    if mode is not null and mode<>observed then raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_ADMISSION_CHANGED: entry points differ'; end if;
    mode:=observed;
  end loop;
  comment_value:=obj_description('public.member_front_save(jsonb,integer,boolean,boolean)'::regprocedure,'pg_proc');
  if (mode='active' and comment_value is not null) or (mode='paused' and comment_value is distinct from 'mccluster-member-front-visibility-recovery/1: save-paused') then
    raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_ADMISSION_CHANGED: unrelated comment or ACL change';
  end if;
  if mode='paused' and not exists(select 1 from pg_proc where oid='member_fronts_private.save(jsonb,integer,boolean,boolean)'::regprocedure and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='b561c9eeb3115dbe57736ad6748de78c69e1160a08ca1a9b8a34bc057b0d0dc9') then
    raise exception using errcode='55000',message='MEMBER_FRONT_SAVE_ADMISSION_CHANGED: paused state lacks the visibility guard';
  end if;
end $save_admission$;

revoke all on function public.member_front_save(jsonb,integer,boolean,boolean),member_fronts_private.save(jsonb,integer,boolean,boolean) from authenticated,service_role;
comment on function public.member_front_save(jsonb,integer,boolean,boolean) is 'mccluster-member-front-visibility-recovery/1: save-paused';
notify pgrst,'reload schema';
