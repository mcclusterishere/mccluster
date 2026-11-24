-- Rollback of compute_claim_task_yield_v3.sql: drop the 5-argument function and
-- recreate the applied v2 4-argument public.compute_claim_task verbatim
-- (supabase/migrations/20261020210718_compute_lease_authority_v2.sql, lines
-- 12-160: the function, its revoke and its grant). After this, a claim that
-- sends p_yield_seconds fails with undefined_function, which
-- core/src/compute/store.mjs tolerates by dropping the parameter.
-- The migration runner owns the transaction. This lock serializes scheduler
-- migrations and their recovery scripts; it does not serialize ordinary jobs.
set local lock_timeout = '5s';
select pg_advisory_xact_lock(821,20261122);
do $yield_preflight$
declare expected record;actual record;function_oid oid;present_count integer:=0;legacy_matched integer:=0;
begin
  if to_regprocedure('public.compute_owner_workspace_status()') is not null
    or to_regprocedure('public.compute_claim_task_v4(text,text[],text[],integer)') is not null
    or to_regclass('public.ops_compute_pairs') is not null
    or to_regclass('public.ops_compute_pair_reservations') is not null
    or exists(select 1 from pg_attribute where attrelid='public.ops_compute_nodes'::regclass
      and attname in('pair_cleanup_required','pair_cleanup_details') and not attisdropped) then
    raise exception using errcode='55000',message='COMPUTE_WORKSPACE_YIELD_CONFLICT: workspace and legacy yield schedulers cannot overwrite each other';
  end if;
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
  if exists(select 1 from pg_proc where oid=to_regprocedure('public.compute_claim_task(text,text[],text[],integer,integer)') and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='77c49d0d2fabe6f9b6e47e21bdfdd6136e2e527642edde9a0a7cc07b0b4d646a') then
  for expected in select * from (values
      ('compute_claim_task','compute_claim_task(text,text[],text[],integer,integer)','77c49d0d2fabe6f9b6e47e21bdfdd6136e2e527642edde9a0a7cc07b0b4d646a','plpgsql',true,'public, extensions, pg_temp',array['p_node_id','p_capabilities','p_implementations','p_lease_seconds','p_yield_seconds']::text[],2,'120, 0','jsonb')
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
end $yield_preflight$;

drop function if exists public.compute_claim_task(text,text[],text[],integer,integer);
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
