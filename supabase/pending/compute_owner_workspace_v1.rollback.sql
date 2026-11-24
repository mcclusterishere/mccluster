-- Equity Uprise shared-platform compute support; no independent building capability.
-- Recovery for compute_owner_workspace_v1. Explicit per-file approval required.
-- Stop new admission and quiesce the reviewed runtime first. This file refuses
-- active jobs/leases, every saved pair/reservation, cleanup details, scoped nodes
-- or workspace records. It never erases enrollment, queue or transcript data.
-- No force-wipe switch exists. If data remains, retain schema and disable the
-- feature until a separate data-preserving recovery is reviewed.
-- Only the exact known v2 scheduler source below may be restored. Unknown or
-- later function definitions cause a refusal before any schema change.
-- The migration runner owns the transaction. This lock serializes scheduler
-- migrations and their recovery scripts; it does not serialize ordinary jobs.
-- Reject transaction-wide snapshots before any lock wait or catalog/data read.
-- Recovery must observe rows committed while it waits for ordinary writers.
do $compute_migration_isolation$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode='55000',message='COMPUTE_READ_COMMITTED_REQUIRED: fresh snapshots are required for migration and recovery checks';
  end if;
end $compute_migration_isolation$;
set local lock_timeout = '5s';
select pg_advisory_xact_lock(821,20261122);
do $workspace_rollback_guard$
declare expected record;actual record;function_oid oid;present_count integer:=0;legacy_matched integer:=0;new_count integer;has_rows boolean;
begin
  if to_regprocedure('public.compute_claim_task(text,text[],text[],integer,integer)') is not null then
    raise exception using errcode='55000',message='COMPUTE_WORKSPACE_YIELD_CONFLICT: a yield scheduler cannot be overwritten by workspace recovery';
  end if;
  for expected in select * from (values
      ('compute_owner_workspace_status','compute_owner_workspace_status()','d0932c7153b91e0964b0344d4a580a8669e2913f4d3692e0777d955517fb9fda','sql',false,'public, pg_temp',array[]::text[],0,'','jsonb'),
      ('compute_reserve_pair','compute_reserve_pair(uuid,uuid,uuid,integer)','a0c56951d6bff5c0f6357292e332ee39a774f47f0c046720aac486c201ad0338','plpgsql',false,'public, pg_temp',array['p_org_id','p_pair_id','p_reservation_id','p_seconds']::text[],1,'900','jsonb'),
      ('compute_release_pair','compute_release_pair(uuid,uuid,text[])','de8db5c0cfcbe247874fd592794dbd618d9bb57df414d83ea17a68f2d50465c8','plpgsql',false,'public, pg_temp',array['p_org_id','p_reservation_id','p_clean_node_ids']::text[],1,'''{}''::text[]','jsonb'),
      ('compute_resume_owner_device','compute_resume_owner_device(uuid,text)','a1cb89104f37e53b39ef5906255e3302418a1e8294555fb507e79a3324b255ce','plpgsql',false,'public, pg_temp',array['p_org_id','p_node_id']::text[],0,'','jsonb'),
      ('compute_ack_pair_cleanup','compute_ack_pair_cleanup(text,uuid,jsonb)','88d1d01b7a3bb6e00c9872655adeb276dba8ba904a9f01d1b17a3fd6d2320fa8','plpgsql',false,'public, pg_temp',array['p_node_id','p_reservation_id','p_receipt']::text[],0,'','jsonb'),
      ('compute_reconcile_expired_pairs','compute_reconcile_expired_pairs(uuid)','5d4752fa02bd75782c0f6397c612841da1938e2a2864d6abe48bf676f45ccdb4','plpgsql',false,'public, pg_temp',array['p_org_id']::text[],0,'','jsonb'),
      ('compute_enqueue_pair_task','compute_enqueue_pair_task(uuid,uuid,jsonb,text)','aaf1369e65602e4bda79a7bfce33f484c233fe0b7ef9d151382a5c00377eff63','plpgsql',false,'public, extensions, pg_temp',array['p_org_id','p_reservation_id','p_task','p_idempotency_key']::text[],0,'','jsonb'),
      ('compute_claim_task_v4','compute_claim_task_v4(text,text[],text[],integer)','2957a4663c8be57f69fa4ebbc27e84c5095718da70df9ee3361770472fc196b9','plpgsql',false,'public, extensions, pg_temp',array['p_node_id','p_capabilities','p_implementations','p_lease_seconds']::text[],1,'120','jsonb'),
      ('ops_ai_submit_workspace_turn','ops_ai_submit_workspace_turn(uuid,uuid,uuid,uuid,text,jsonb)','892fc62123ef11f966dd682773ec7fc58bfd32214e3288094db10ca1b89d8de3','plpgsql',false,'public, pg_temp',array['p_org_id','p_thread_id','p_user_message_id','p_assistant_message_id','p_content','p_metadata']::text[],0,'','jsonb'),
      ('ops_ai_enqueue_workspace_task','ops_ai_enqueue_workspace_task(uuid,uuid,text,integer,jsonb,text)','1fb86d6c361e28b02df099b54397d570dae3c13626c536a3943d8699cd094f2e','plpgsql',false,'public, extensions, pg_temp',array['p_org_id','p_turn_id','p_job_lease','p_job_attempt','p_task','p_idempotency_key']::text[],0,'','jsonb'),
      ('ops_ai_checkpoint_workspace_turn','ops_ai_checkpoint_workspace_turn(uuid,uuid,text,integer,jsonb)','8c0b184b93772da3178bf42b48114647caca185e62ba388e429c597d82640394','plpgsql',false,'public, pg_temp',array['p_org_id','p_turn_id','p_job_lease','p_job_attempt','p_metadata']::text[],0,'','boolean'),
      ('ops_ai_complete_workspace_turn','ops_ai_complete_workspace_turn(uuid,uuid,text,integer,jsonb)','260338e864fbd8de95db509585ab11c6afd8415d390c852bf09ef0b9dc734184','plpgsql',false,'public, pg_temp',array['p_org_id','p_turn_id','p_job_lease','p_job_attempt','p_message']::text[],0,'','boolean'),
      ('ops_ai_stop_workspace_turn','ops_ai_stop_workspace_turn(uuid,uuid)','726074df73e9a148f057933672919a5f2fbc48ad9d17f8018cbc49fc50557ed0','plpgsql',false,'public, pg_temp',array['p_org_id','p_turn_id']::text[],0,'','jsonb')
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
  new_count:=present_count;
  if exists(select 1 from pg_proc where oid=to_regprocedure('public.compute_claim_task(text,text[],text[],integer)') and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='f58ca22a92c5950fe79adb88e1b0f64d0a815f2e42a90c88aea8ae251df8dc15') then
  for expected in select * from (values
      ('compute_claim_task','compute_claim_task(text,text[],text[],integer)','f58ca22a92c5950fe79adb88e1b0f64d0a815f2e42a90c88aea8ae251df8dc15','plpgsql',true,'public, extensions, pg_temp',array['p_node_id','p_capabilities','p_implementations','p_lease_seconds']::text[],1,'120','jsonb')
    ) as signatures(name,signature,body_sha,language_name,is_definer,search_path,arg_names,default_count,default_sql,return_type) loop
    function_oid := to_regprocedure('public.'||expected.signature);
    if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname=expected.name) > 1 then
      raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: unexpected overload '||expected.name;
    end if;
    if function_oid is null then raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: missing reviewed function '||expected.signature; end if;
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
    legacy_matched := legacy_matched + 1;
  end if;
  if exists(select 1 from pg_proc where oid=to_regprocedure('public.compute_claim_task(text,text[],text[],integer)') and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='16f2a71a0699c2bd0177de78f40253bd4f355e79e5e5fd873073640bccd39b5a') then
  for expected in select * from (values
      ('compute_claim_task','compute_claim_task(text,text[],text[],integer)','16f2a71a0699c2bd0177de78f40253bd4f355e79e5e5fd873073640bccd39b5a','sql',false,'public, extensions, pg_temp',array['p_node_id','p_capabilities','p_implementations','p_lease_seconds']::text[],1,'120','jsonb')
    ) as signatures(name,signature,body_sha,language_name,is_definer,search_path,arg_names,default_count,default_sql,return_type) loop
    function_oid := to_regprocedure('public.'||expected.signature);
    if (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname=expected.name) > 1 then
      raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: unexpected overload '||expected.name;
    end if;
    if function_oid is null then raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: missing reviewed function '||expected.signature; end if;
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
    legacy_matched := legacy_matched + 1;
  end if;
  if legacy_matched <> 1 then raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: claim scheduler is not an exact reviewed version'; end if;
  if new_count not in (0,13) then raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: partial workspace function set'; end if;
  if new_count=0 and (to_regclass('public.ops_compute_pairs') is not null or to_regclass('public.ops_compute_pair_reservations') is not null
      or exists(select 1 from pg_attribute where attrelid='public.ops_compute_nodes'::regclass and attname in('pair_cleanup_required','pair_cleanup_details') and not attisdropped)
      or not exists(select 1 from pg_proc where oid='public.compute_claim_task(text,text[],text[],integer)'::regprocedure and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='f58ca22a92c5950fe79adb88e1b0f64d0a815f2e42a90c88aea8ae251df8dc15')) then
    raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: orphaned workspace schema';
  end if;
  if new_count=13 and (to_regclass('public.ops_compute_pairs') is null or to_regclass('public.ops_compute_pair_reservations') is null
      or (select count(*) from pg_attribute where attrelid='public.ops_compute_nodes'::regclass and attname in('pair_cleanup_required','pair_cleanup_details') and not attisdropped)<>2
      or not exists(select 1 from pg_proc where oid='public.compute_claim_task(text,text[],text[],integer)'::regprocedure and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='16f2a71a0699c2bd0177de78f40253bd4f355e79e5e5fd873073640bccd39b5a')) then
    raise exception using errcode='55000',message='COMPUTE_BASELINE_CHANGED: workspace wrapper is not the reviewed version';
  end if;
  lock table public.ops_compute_nodes,public.ops_compute_leases,public.ops_compute_tasks,public.ops_agent_jobs,public.ops_ai_messages in share row exclusive mode;
  if to_regclass('public.ops_compute_pairs') is not null then
    lock table public.ops_compute_pairs,public.ops_compute_pair_reservations in access exclusive mode;
    execute 'select exists(select 1 from public.ops_compute_pairs) or exists(select 1 from public.ops_compute_pair_reservations)' into has_rows;
    if has_rows then raise exception using errcode='55000',message='WORKSPACE_ROLLBACK_DATA_PRESENT: retain saved pairs and reservation history'; end if;
  end if;
  if exists(select 1 from pg_attribute where attrelid='public.ops_compute_nodes'::regclass and attname='pair_cleanup_required' and not attisdropped) then
    execute 'select exists(select 1 from public.ops_compute_nodes where pair_cleanup_required or pair_cleanup_details is not null)' into has_rows;
    if has_rows then raise exception using errcode='55000',message='WORKSPACE_ROLLBACK_DATA_PRESENT: retain cleanup holds and receipts'; end if;
  end if;
  if exists(select 1 from public.ops_compute_nodes where labels ? 'enrollment_id' or labels ? 'enrollment_scope')
    or exists(select 1 from public.ops_compute_leases where status in('leased','running'))
    or exists(select 1 from public.ops_compute_tasks where status in('queued','leased','running') or requirements ? 'node_id' or requirements ? 'pair_reservation_id' or metadata->>'purpose'='owner-device-test')
    or exists(select 1 from public.ops_agent_jobs where job_type='resident_ai_turn' and status in('queued','running'))
    or exists(select 1 from public.ops_ai_messages where metadata ? 'workspace_route') then
    raise exception using errcode='55000',message='WORKSPACE_ROLLBACK_DATA_PRESENT: retain workspace records or active execution';
  end if;
end $workspace_rollback_guard$;

-- Exact source: 20261020210718_compute_lease_authority_v2.sql.
-- Function-body SHA-256: f58ca22a92c5950fe79adb88e1b0f64d0a815f2e42a90c88aea8ae251df8dc15.
create or replace function public.compute_claim_task(
  p_node_id text,
  p_capabilities text[],
  p_implementations text[],
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_node public.ops_compute_nodes%rowtype;
  v_task public.ops_compute_tasks%rowtype;
  v_task_id uuid;
  v_advertised jsonb;
  v_implementation text;
  v_lease_id uuid;
  v_token text;
  v_running integer;
  v_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 900));
begin
  -- Serialize claims per node. This makes node-wide and per-implementation
  -- concurrency admission atomic even if more than one gateway replica asks
  -- for work for the same node at the same time.
  select * into v_node
    from public.ops_compute_nodes
   where id = p_node_id
   for update;
  if not found then return null; end if;
  if v_node.state <> 'online' or v_node.revoked_at is not null then return null; end if;
  if v_node.last_seen_at < now() - interval '3 minutes' then return null; end if;

  -- Reclaim only leases that became expired in this transaction. Historical
  -- expired rows must never requeue a task that has since received a new lease.
  with newly_expired as (
    update public.ops_compute_leases
       set status = 'expired',
           updated_at = now(),
           completed_at = coalesce(completed_at, now()),
           last_error = coalesce(last_error, 'lease expired')
     where status in ('leased','running')
       and expires_at <= now()
     returning task_id
  )
  update public.ops_compute_tasks t
     set status = case when t.attempts < t.max_attempts then 'queued' else 'failed' end,
         locked_by_node_id = null,
         locked_at = null,
         run_after = case when t.attempts < t.max_attempts then now() + interval '30 seconds' else t.run_after end,
         last_error = coalesce(t.last_error, 'compute lease expired'),
         updated_at = now()
   where t.id in (select task_id from newly_expired)
     and t.status in ('leased','running');

  select count(*) into v_running
    from public.ops_compute_leases
   where node_id = p_node_id
     and status in ('leased','running')
     and expires_at > now();
  if v_running >= v_node.max_leases then return null; end if;

  -- PL/pgSQL row variables cannot participate in a multi-target INTO list.
  -- Lock the task row while selecting its id plus the exact advertised
  -- implementation, then hydrate the row variable from that already-locked id.
  select t.id, chosen.advertised
    into v_task_id, v_advertised
    from public.ops_compute_tasks t
    cross join lateral (
      select advertised
        from jsonb_array_elements(v_node.capabilities) as advertised
       where advertised->>'capability' = t.capability
         and advertised->>'implementation' = any(coalesce(p_implementations, array[]::text[]))
         and (t.implementation is null or advertised->>'implementation' = t.implementation)
         and coalesce(t.requirements->'features', '{}'::jsonb)
               <@ coalesce(advertised->'features', '{}'::jsonb)
         and (
           select count(*)
             from public.ops_compute_leases active_lease
            where active_lease.node_id = p_node_id
              and active_lease.implementation = advertised->>'implementation'
              and active_lease.status in ('leased','running')
              and active_lease.expires_at > now()
         ) < greatest(1, least(64, coalesce((advertised->>'max_concurrency')::integer, 1)))
       order by advertised->>'implementation'
       limit 1
    ) chosen
   where t.org_id = v_node.org_id
     and t.status = 'queued'
     and t.run_after <= now()
     and t.attempts < t.max_attempts
     and t.capability = any(coalesce(p_capabilities, array[]::text[]))
   order by t.priority desc, t.run_after asc, t.created_at asc
   for update of t skip locked
   limit 1;
  if not found then return null; end if;

  select * into strict v_task
    from public.ops_compute_tasks
   where id = v_task_id;

  v_implementation := v_advertised->>'implementation';
  if v_implementation is null then return null; end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.ops_compute_leases(
    task_id, node_id, implementation, attempt, status, lease_token_hash, expires_at
  ) values (
    v_task.id,
    p_node_id,
    v_implementation,
    v_task.attempts + 1,
    'leased',
    encode(digest(v_token, 'sha256'), 'hex'),
    now() + make_interval(secs => v_seconds)
  ) returning id into v_lease_id;

  update public.ops_compute_tasks
     set status = 'leased',
         attempts = attempts + 1,
         locked_by_node_id = p_node_id,
         locked_at = now(),
         updated_at = now()
   where id = v_task.id;

  return jsonb_build_object(
    'lease_id', v_lease_id,
    'task_id', v_task.id,
    'org_id', v_task.org_id,
    'node_id', p_node_id,
    'attempt', v_task.attempts + 1,
    'status', 'leased',
    'server_time', clock_timestamp(),
    'lease_token', v_token,
    'expires_at', now() + make_interval(secs => v_seconds),
    'task', jsonb_build_object(
      'id', v_task.id,
      'org_id', v_task.org_id,
      'capability', v_task.capability,
      'implementation', v_implementation,
      'input', v_task.input,
      'requirements', v_task.requirements,
      'metadata', v_task.metadata
    )
  );
end;
$$;
revoke all on function public.compute_claim_task(text,text[],text[],integer) from public, anon, authenticated;
grant execute on function public.compute_claim_task(text,text[],text[],integer) to service_role;

drop function if exists public.ops_ai_stop_workspace_turn(uuid,uuid);
drop function if exists public.ops_ai_complete_workspace_turn(uuid,uuid,text,integer,jsonb);
drop function if exists public.ops_ai_checkpoint_workspace_turn(uuid,uuid,text,integer,jsonb);
drop function if exists public.ops_ai_enqueue_workspace_task(uuid,uuid,text,integer,jsonb,text);
drop function if exists public.ops_ai_submit_workspace_turn(uuid,uuid,uuid,uuid,text,jsonb);
drop function if exists public.compute_claim_task_v4(text,text[],text[],integer);
drop function if exists public.compute_enqueue_pair_task(uuid,uuid,jsonb,text);
drop function if exists public.compute_reconcile_expired_pairs(uuid);
drop function if exists public.compute_ack_pair_cleanup(text,uuid,jsonb);
drop function if exists public.compute_resume_owner_device(uuid,text);
drop function if exists public.compute_release_pair(uuid,uuid,text[]);
drop function if exists public.compute_reserve_pair(uuid,uuid,uuid,integer);
drop function if exists public.compute_owner_workspace_status();
drop table if exists public.ops_compute_pair_reservations;
drop table if exists public.ops_compute_pairs;
alter table public.ops_compute_nodes drop column if exists pair_cleanup_details;
alter table public.ops_compute_nodes drop column if exists pair_cleanup_required;
