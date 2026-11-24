-- Recovery for compute_owner_enrollment_v1. Explicit per-file approval required.
-- Disable new workspace/device admission first and recover the workspace file
-- before this one. Refuses any enrollment record, scoped node or active lease.
-- Existing nodes, tasks, leases and transcripts are never deleted or rewritten.
-- There is no force-wipe option. Preserve nonempty state and disable the feature.
-- The migration runner owns the transaction. This lock serializes scheduler
-- migrations and their recovery scripts; it does not serialize ordinary jobs.
set local lock_timeout = '5s';
select pg_advisory_xact_lock(821,20261122);
do $enrollment_rollback_guard$
declare expected record;actual record;function_oid oid;present_count integer:=0;has_rows boolean;
begin
  if to_regprocedure('public.compute_owner_workspace_status()') is not null
    or to_regprocedure('public.compute_claim_task_v4(text,text[],text[],integer)') is not null
    or to_regclass('public.ops_compute_pairs') is not null
    or to_regclass('public.ops_compute_pair_reservations') is not null
    or exists(select 1 from pg_attribute where attrelid='public.ops_compute_nodes'::regclass
      and attname in('pair_cleanup_required','pair_cleanup_details') and not attisdropped) then
    raise exception using errcode='55000',message='WORKSPACE_ROLLBACK_REQUIRED: recover workspace before enrollment';
  end if;
  for expected in select * from (values
      ('compute_enroll_once','compute_enroll_once(text,jsonb)','97918135eb8ec6a39d432bd52b6fe5e06649a8c808671c1528ecb6bf3abe0e24','plpgsql',false,'public, extensions, pg_temp',array['p_credential_hash','p_node']::text[],0,'','jsonb')
    ) as signatures(name,signature,body_sha,language_name,is_definer,search_path,arg_names,default_count,default_sql,return_type) loop
    function_oid := to_regprocedure('public.'||expected.signature);
    if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname=expected.name) > 1 then
      raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: unexpected overload '||expected.name;
    end if;
    if function_oid is null then continue; end if;
    select p.*,l.lanname into actual from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=function_oid;
    if encode(sha256(convert_to(actual.prosrc,'UTF8')),'hex') <> expected.body_sha
      or actual.lanname <> expected.language_name or actual.prosecdef is distinct from expected.is_definer
      or actual.proconfig is distinct from array['search_path='||expected.search_path]
      or coalesce(actual.proargnames,'{}'::text[]) is distinct from expected.arg_names
      or actual.pronargdefaults <> expected.default_count
      or coalesce(pg_get_expr(actual.proargdefaults,0),'') <> expected.default_sql
      or actual.prorettype <> expected.return_type::regtype or actual.proretset
      or actual.prokind <> 'f' or actual.proisstrict or actual.proleakproof
      or actual.provolatile <> 'v' or actual.proparallel <> 'u'
      or pg_get_userbyid(actual.proowner) <> 'postgres' then
      raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: reviewed function changed '||expected.signature;
    end if;
    present_count := present_count + 1;
  end loop;
  if (to_regclass('public.ops_compute_enrollments') is not null) is distinct from (present_count=1) then
    raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: partial enrollment schema';
  end if;
  lock table public.ops_compute_nodes,public.ops_compute_leases in share row exclusive mode;
  if to_regclass('public.ops_compute_enrollments') is not null then
    lock table public.ops_compute_enrollments in access exclusive mode;
    execute 'select exists(select 1 from public.ops_compute_enrollments)' into has_rows;
    if has_rows then raise exception using errcode='55000',message='ENROLLMENT_ROLLBACK_DATA_PRESENT: retain issued or consumed enrollment receipts'; end if;
  end if;
  if exists(select 1 from public.ops_compute_nodes where labels ? 'enrollment_id' or labels ? 'enrollment_scope')
    or exists(select 1 from public.ops_compute_leases where status in('leased','running')) then
    raise exception using errcode='55000',message='ENROLLMENT_ROLLBACK_DATA_PRESENT: scoped devices or active leases must be retained';
  end if;
end $enrollment_rollback_guard$;
drop function if exists public.compute_enroll_once(text,jsonb);
drop table if exists public.ops_compute_enrollments;
