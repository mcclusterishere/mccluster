-- Pending empty-install recovery only. Once any configuration, reservation,
-- carry, receipt or ledger entry exists, retain the data and use a forward repair.
-- Check and drop in one statement so a failed check releases every lock and
-- a writer cannot add a row between the emptiness check and the drops.
-- Fingerprints cover the named tables and their columns, constraints, indexes,
-- sequences, trigger modes, functions, RLS policies and per-role grants. The
-- installer owner is normalized so a different role cannot silently adopt
-- objects. The same three receipts were measured on PostgreSQL 17 and 18.
do $rollback$
declare
  ledger_tables constant text[] := array[
    'ops_compute_ledger_operations',
    'ops_compute_display_points',
    'ops_compute_account_carry',
    'ops_compute_contribution_ledger',
    'ops_compute_spend_reservations',
    'ops_compute_fraud_reviews',
    'ops_compute_known_answer_tasks',
    'ops_compute_private_grants',
    'ops_compute_account_relations',
    'ops_compute_account_quotas',
    'ops_compute_model_classes',
    'ops_compute_node_accounts',
    'ops_compute_accounts'
  ];
  known constant text[] := array[
    '9e281337aa5228ec76aac29b819e34afced2f875609465893db1922a07895285', -- b9c2ed1d
    'bece3d7b1e7de95095441554eba81453e4596f4b7ddf321b48baaa9063e317c4', -- a0a30ef9
    '9271cfd65228ea38fde20b6693bf2558ade571e686186f40578bd42c199d8ad4' -- fb12d1c5
  ];
  signature text;
  target text;
  relation_kind "char";
  original_timeout text := current_setting('lock_timeout');
  original_visibility text := current_setting('row_security');
  original_path text := current_setting('search_path');
  present integer := 0;
  populated boolean;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'ledger rollback requires READ COMMITTED' using errcode = '55000';
  end if;
  perform set_config('search_path', 'pg_catalog,public', true);
  perform set_config('lock_timeout', '5s', true);
  perform pg_advisory_xact_lock(hashtextextended('public.compute_contribution_ledger_v1.install',0));
  foreach target in array ledger_tables loop
    select relkind into relation_kind from pg_catalog.pg_class where oid=to_regclass(format('public.%I',target));
    if found then
      if relation_kind <> 'r' then
        raise exception 'ledger rollback refused: unexpected relation kind for %', target using errcode='55000';
      end if;
      execute format('lock table public.%I in access exclusive mode',target);
      present := present + 1;
    end if;
  end loop;
  perform set_config('row_security', 'off', true);
  with named as (
    select c.* from pg_catalog.pg_class c
     where c.relnamespace = 'public'::regnamespace and exists (
       select from unnest(ledger_tables) n where c.relname = n or starts_with(c.relname::text, n || '_')
     )
  ), relations as (
    select c.* from pg_catalog.pg_class c where c.oid in (
      select oid from named
      union select indexrelid from pg_catalog.pg_index where indrelid in (select oid from named)
      union select objid from pg_catalog.pg_depend where objid in (select oid from pg_catalog.pg_class where relkind='S')
        and classid='pg_class'::regclass
        and refclassid='pg_class'::regclass and refobjid in (select oid from named) and deptype in ('a','i')
    )
  ), routines as (
    select p.* from pg_catalog.pg_proc p where p.pronamespace='public'::regnamespace and starts_with(p.proname::text,'compute_ledger_')
  ), privileges as (
    select 'relation:'||c.relname as subject, c.relowner as owner,
           coalesce(c.relacl, acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner)) as acl
      from relations c where c.relkind not in ('i','I')
    union all
    select 'column:'||c.relname||'.'||a.attname, c.relowner, a.attacl
      from relations c join pg_catalog.pg_attribute a on a.attrelid=c.oid where a.attnum>0 and a.attacl is not null
    union all
    select 'function:'||p.oid::regprocedure::text,p.proowner,coalesce(p.proacl,acldefault('f',p.proowner)) from routines p
  ), facts(item) as (
    select jsonb_build_array('relation', c.relname,c.relkind,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity,
      c.relreplident,c.relispartition,c.reloptions,am.amname,
      case when pg_get_userbyid(c.relowner)=current_user then '<installer>' else pg_get_userbyid(c.relowner) end)
      from relations c left join pg_catalog.pg_am am on am.oid=c.relam
    union all
    select jsonb_build_array('column',c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
      a.attidentity,a.attgenerated,a.attcollation::regcollation::text,pg_get_expr(d.adbin,d.adrelid))
      from relations c join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
      left join pg_catalog.pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where c.relkind in ('r','p')
    union all
    select jsonb_build_array('constraint',c.relname,k.conname,k.convalidated,pg_get_constraintdef(k.oid))
      from relations c join pg_catalog.pg_constraint k on k.conrelid=c.oid where k.contype<>'n'
    union all
    select jsonb_build_array('invalid-constraint',c.relname,k.conname)
      from relations c join pg_catalog.pg_constraint k on k.conrelid=c.oid where not k.convalidated
    union all
    select jsonb_build_array('index',c.relname,ix.indisvalid,ix.indisready,ix.indislive,pg_get_indexdef(c.oid))
      from relations c join pg_catalog.pg_index ix on ix.indexrelid=c.oid
    union all
    select jsonb_build_array('trigger',c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid))
      from relations c join pg_catalog.pg_trigger t on t.tgrelid=c.oid where not t.tgisinternal
    union all
    select jsonb_build_array('constraint-trigger',t.tgrelid::regclass::text,k.conname,f.proname,t.tgtype,t.tgenabled)
      from pg_catalog.pg_trigger t join pg_catalog.pg_constraint k on k.oid=t.tgconstraint
      join pg_catalog.pg_proc f on f.oid=t.tgfoid where t.tgisinternal and k.conrelid in (select oid from relations)
    union all
    select jsonb_build_array('policy',c.relname,k.polname) from relations c join pg_catalog.pg_policy k on k.polrelid=c.oid
    union all
    select jsonb_build_array('rule',c.relname,r.rulename,r.ev_enabled,pg_get_ruledef(r.oid))
      from relations c join pg_catalog.pg_rewrite r on r.ev_class=c.oid
    union all
    select jsonb_build_array('inheritance',h.inhrelid::regclass::text,h.inhparent::regclass::text)
      from pg_catalog.pg_inherits h where h.inhrelid in (select oid from relations) or h.inhparent in (select oid from relations)
    union all
    select jsonb_build_array('sequence',c.relname,s.seqtypid::regtype::text,s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle)
      from relations c join pg_catalog.pg_sequence s on s.seqrelid=c.oid
    union all
    select jsonb_build_array('sequence-owner',c.relname,d.refobjid::regclass::text,d.refobjsubid,d.deptype)
      from relations c join pg_catalog.pg_depend d on d.classid='pg_class'::regclass and d.objid=c.oid
     where c.relkind='S' and d.refclassid='pg_class'::regclass and d.deptype in ('a','i')
    union all
    select jsonb_build_array('routine',p.oid::regprocedure::text,p.prokind,p.prosupport::text,
      case when pg_get_userbyid(p.proowner)=current_user then '<installer>' else pg_get_userbyid(p.proowner) end,
      case when p.prokind<>'a' then pg_get_functiondef(p.oid) end) from routines p
    union all
    select jsonb_build_array('grant',a.subject,
      case when x.grantee=a.owner then '<owner>' when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end,
      case when x.grantor=a.owner then '<owner>' else pg_get_userbyid(x.grantor) end,
      x.privilege_type,x.is_grantable)
      from privileges a cross join lateral aclexplode(a.acl) x
  )
  select coalesce(encode(sha256(convert_to(string_agg(item::text,E'\n' order by item::text collate "C"),'UTF8')),'hex'),'absent')
    into signature from facts;
  if signature='absent' then
    perform set_config('row_security', original_visibility, true);
    perform set_config('lock_timeout', original_timeout, true);
    perform set_config('search_path', original_path, true);
    return;
  end if;
  if present <> cardinality(ledger_tables) then
    raise exception 'ledger rollback refused: incomplete installation' using errcode='55000';
  end if;
  foreach target in array ledger_tables loop
    execute format('select exists (select from public.%I)', target) into populated;
    if populated then
      raise exception 'ledger rollback refused: % contains data; use a reviewed forward repair', target
        using errcode = '55000';
    end if;
  end loop;

  if not (signature = any(known)) then
    raise exception 'ledger rollback refused: unrecognized catalog fingerprint %', signature using errcode='55000';
  end if;
  drop function if exists public.compute_ledger_resolve_submission(uuid,uuid,text);
  drop function if exists public.compute_ledger_reserve(text,text,uuid,bigint,integer,text,integer);
  drop function if exists public.compute_ledger_settle(text,uuid,text,integer,jsonb,text,text,bigint);
  drop function if exists public.compute_ledger_release(text,uuid,text,text,bigint);
  drop function if exists public.compute_ledger_correct(text,bigint,text,bigint,bigint,text);
  drop function if exists public.compute_ledger_balances(text);
  drop function if exists public.compute_ledger_receipt(uuid);
  drop function if exists public.compute_ledger_balances_internal(text);
  drop function if exists public.compute_ledger_operation_lookup(text,text,text);
  drop function if exists public.compute_ledger_term_ok(uuid,text,bigint);
  drop function if exists public.compute_ledger_sha256(text);
  -- RESTRICT is intentional. External dependents must block the whole rollback.
  foreach target in array ledger_tables loop
    execute format('drop table public.%I restrict', target);
  end loop;
  drop function if exists public.compute_ledger_check_commit_term();
  drop function if exists public.compute_ledger_lock_term(uuid,text,bigint);
  drop function public.compute_ledger_append_only();
  perform set_config('row_security', original_visibility, true);
  perform set_config('lock_timeout', original_timeout, true);
  perform set_config('search_path', original_path, true);
end
$rollback$;
