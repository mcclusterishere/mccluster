-- Recovery for pending 20261123013000_eup_world_display_v1.sql.
-- Equity Uprise shared World presentation support; owner approval required.
-- Roll callers back first. This removes only the untouched empty store.
-- Any owner save (even false) is a record: refuse rather than delete it. There
-- is no force flag. Export/retention and a separate reviewed recovery are needed.
-- Drift, later dependencies and obsolete transaction snapshots also refuse.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
-- Fresh statements after the lock must see every committed owner save.
do $$ begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '55000', message = 'WORLD_DISPLAY_READ_COMMITTED_REQUIRED';
  end if;
end $$;
select pg_advisory_xact_lock(hashtextextended('eup_world_display_v1', 0));

do $guard$
declare
  target oid := to_regclass('public.eup_world_display');
  functions integer;
  expected_owner oid := current_user::regrole::oid;
begin
  select count(*) into functions from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('eup_world_display_read','eup_world_display_set');
  if target is null and functions=0 then return; end if;
  if target is null or functions<>2
     or to_regprocedure('public.eup_world_display_read()') is null
     or to_regprocedure('public.eup_world_display_set(uuid,boolean)') is null then
    raise exception using errcode='55000', message='WORLD_DISPLAY_SCHEMA_DRIFT: partial or overloaded objects';
  end if;
  if not exists(select 1 from pg_class where oid=target and relkind='r' and relowner=expected_owner) then
    raise exception using errcode='55000', message='WORLD_DISPLAY_SCHEMA_DRIFT: table kind or owner';
  end if;
  lock table public.eup_world_display in access exclusive mode;
  if not exists(select 1 from pg_class where oid=target and relrowsecurity and not relforcerowsecurity)
     or (select jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
             coalesce(pg_get_expr(d.adbin,d.adrelid),''),a.attidentity,a.attgenerated) order by a.attnum)
         from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
         where a.attrelid=target and a.attnum>0 and not a.attisdropped)
        is distinct from '[["singleton","boolean",true,"true","",""],["public_news_heat_map","boolean",true,"false","",""]]'::jsonb
     or (select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid),convalidated,condeferrable) order by conname)
         from pg_constraint where conrelid=target)
        is distinct from '[["eup_world_display_pkey","PRIMARY KEY (singleton)",true,false],["eup_world_display_singleton_check","CHECK (singleton)",true,false]]'::jsonb
     or (select count(*) from pg_index where indrelid=target)<>1
     or exists(select 1 from pg_index where indrelid=target and (not indisprimary or not indisvalid or not indisready))
     or exists(select 1 from pg_policy where polrelid=target)
     or exists(select 1 from pg_trigger where tgrelid=target and not tgisinternal)
     or exists(select 1 from pg_rewrite where ev_class=target)
     or exists(select 1 from pg_inherits where inhrelid=target or inhparent=target)
     or exists(select 1 from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
         where c.oid=target and a.grantee<>expected_owner)
     or exists(select 1 from pg_attribute a where a.attrelid=target and a.attacl is not null)
  then
    raise exception using errcode='55000', message='WORLD_DISPLAY_SCHEMA_DRIFT: table contract';
  end if;
  if exists (
    select 1 from (values
      ('public.eup_world_display_read()'::regprocedure, 'sql', 's', 'e5a5e1058ea0b76991af4942595896d3', null::text[]),
      ('public.eup_world_display_set(uuid,boolean)'::regprocedure, 'plpgsql', 'v', '852b3058eec8e3961acb5f38925b919d', array['p_actor','p_public_news_heat_map'])
    ) expected(oid,language,volatility,body_hash,argument_names)
    join pg_proc p on p.oid=expected.oid join pg_language l on l.oid=p.prolang
    where p.proowner<>expected_owner or not p.prosecdef or p.prokind<>'f' or p.proretset
      or p.prorettype<>'boolean'::regtype or p.provolatile::text<>expected.volatility
      or l.lanname<>expected.language or md5(p.prosrc)<>expected.body_hash
      or p.proconfig is distinct from array['search_path=""']
      or p.proargnames is distinct from expected.argument_names or p.pronargdefaults<>0
      or p.proleakproof or p.proparallel<>'u'
      or not has_function_privilege('service_role',p.oid,'EXECUTE')
      or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee not in(expected_owner,'service_role'::regrole::oid) or a.is_grantable and a.grantee<>expected_owner)
  ) then
    raise exception using errcode='55000', message='WORLD_DISPLAY_SCHEMA_DRIFT: function contract';
  end if;
end $guard$;

do $$ begin
  if to_regclass('public.eup_world_display') is not null then
    if exists(select 1 from public.eup_world_display) then
      raise exception using errcode='55000', message='WORLD_DISPLAY_HAS_SAVED_DECISION';
    end if;
  end if;
end $$;
drop function if exists public.eup_world_display_set(uuid, boolean);
drop function if exists public.eup_world_display_read();
drop table if exists public.eup_world_display;
commit;
