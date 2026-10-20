-- W06: additive lease authority receipts; pending reviewed production promotion.
-- Existing tables/RPC signatures remain canonical. Historical attempts remain
-- unknown; only an active, currently owned lease can inherit the current attempt.
alter table public.ops_compute_leases add column if not exists attempt integer
  check (attempt > 0);
update public.ops_compute_leases l set attempt=t.attempts
from public.ops_compute_tasks t
where l.attempt is null and l.task_id=t.id and l.node_id=t.locked_by_node_id
  and l.status in ('leased','running') and t.status in ('leased','running')
  and t.attempts > 0;

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

-- Internal invoker helper; only existing service-role-only wrappers may call it.
create or replace function public.compute_transition_lease_v2(
  p_action text, p_node_id text, p_lease_id uuid, p_lease_token text,
  p_payload jsonb default '{}'::jsonb, p_extend_seconds integer default 120,
  p_retry boolean default true
) returns jsonb
language plpgsql security invoker set search_path = public, extensions, pg_temp
as $$
declare
  v_node public.ops_compute_nodes%rowtype;
  v_lease public.ops_compute_leases%rowtype;
  v_task public.ops_compute_tasks%rowtype;
  v_now timestamptz;
  v_retry boolean;
  v_seconds integer := greatest(30,least(coalesce(p_extend_seconds,120),900));
begin
  if p_action not in ('start','heartbeat','complete','fail') then return null; end if;
  -- Match claim's node -> lease -> task lock order. Revocation and cancellation
  -- cannot commit between authorization and result persistence.
  select * into v_node from public.ops_compute_nodes where id=p_node_id for update;
  if not found or v_node.state not in ('online','draining') or v_node.revoked_at is not null then return null; end if;
  select * into v_lease from public.ops_compute_leases where id=p_lease_id and node_id=p_node_id for update;
  if not found or p_lease_token is null or encode(digest(p_lease_token,'sha256'),'hex') <> v_lease.lease_token_hash then return null; end if;
  select * into v_task from public.ops_compute_tasks where id=v_lease.task_id for update;
  if not found or v_task.org_id <> v_node.org_id or v_lease.attempt is null or v_task.attempts <> v_lease.attempt then return null; end if;
  v_now := clock_timestamp(); -- Re-evaluate expiry AFTER any lock wait.
  -- Lost-response retries converge on the same durable result without another
  -- write or replacing a committed payload with a different one.
  if p_action='complete' and v_lease.status='done' and v_task.status='done' then
    if v_lease.result is distinct from coalesce(p_payload,'{}'::jsonb) or v_task.output is distinct from v_lease.result then return null; end if;
    return jsonb_build_object('ok',true,'replayed',true);
  end if;
  if v_task.locked_by_node_id is distinct from p_node_id or v_task.status not in ('leased','running')
     or v_lease.status not in ('leased','running') or v_lease.expires_at <= v_now then return null; end if;
  if p_action in ('heartbeat','complete') and (v_lease.status <> 'running' or v_task.status <> 'running') then return null; end if;
  if p_action='start' and (v_lease.status <> 'leased' or v_task.status <> 'leased') then return null; end if;
  if p_action in ('start','heartbeat') then
    update public.ops_compute_leases set status='running',
      started_at=coalesce(started_at,v_now), expires_at=v_now+make_interval(secs=>v_seconds),
      progress=case when p_action='heartbeat' then coalesce(p_payload,'{}'::jsonb) else progress end,
      updated_at=v_now where id=p_lease_id returning * into v_lease;
    update public.ops_compute_tasks set status='running',updated_at=v_now where id=v_task.id;
    return jsonb_build_object('ok',true,'lease_id',v_lease.id,'task_id',v_task.id,
      'org_id',v_task.org_id,'node_id',p_node_id,'attempt',v_lease.attempt,
      'status',v_lease.status,'server_time',v_now,'expires_at',v_lease.expires_at);
  elsif p_action='complete' then
    update public.ops_compute_leases set status='done',result=coalesce(p_payload,'{}'::jsonb),
      completed_at=v_now,updated_at=v_now where id=p_lease_id;
    update public.ops_compute_tasks set status='done',output=coalesce(p_payload,'{}'::jsonb),
      locked_by_node_id=null,locked_at=null,last_error=null,updated_at=v_now where id=v_task.id;
  else
    v_retry := coalesce(p_retry,true) and v_task.attempts < v_task.max_attempts;
    update public.ops_compute_leases set status='failed',
      last_error=left(coalesce(p_payload->>'error','compute node failure'),4000),
      completed_at=v_now,updated_at=v_now where id=p_lease_id;
    update public.ops_compute_tasks set status=case when v_retry then 'queued' else 'failed' end,
      run_after=case when v_retry then v_now+make_interval(secs=>least(3600,greatest(30,(power(2,least(7,greatest(1,v_task.attempts)))*15)::integer))) else run_after end,
      locked_by_node_id=null,locked_at=null,
      last_error=left(coalesce(p_payload->>'error','compute node failure'),4000),updated_at=v_now where id=v_task.id;
  end if;
  return jsonb_build_object('ok',true,'replayed',false);
end;
$$;
revoke all on function public.compute_transition_lease_v2(text,text,uuid,text,jsonb,integer,boolean) from public, anon, authenticated, service_role;

create or replace function public.compute_start_lease(p_node_id text,p_lease_id uuid,p_lease_token text,p_extend_seconds integer default 120)
returns jsonb language sql security definer set search_path = public, extensions, pg_temp
as $$ select public.compute_transition_lease_v2('start',p_node_id,p_lease_id,p_lease_token,'{}'::jsonb,p_extend_seconds,true); $$;

create or replace function public.compute_heartbeat_lease(p_node_id text,p_lease_id uuid,p_lease_token text,p_progress jsonb default '{}'::jsonb,p_extend_seconds integer default 120)
returns jsonb language sql security definer set search_path = public, extensions, pg_temp
as $$ select public.compute_transition_lease_v2('heartbeat',p_node_id,p_lease_id,p_lease_token,p_progress,p_extend_seconds,true); $$;

create or replace function public.compute_complete_lease(p_node_id text,p_lease_id uuid,p_lease_token text,p_result jsonb default '{}'::jsonb)
returns boolean language sql security definer set search_path = public, extensions, pg_temp
as $$ select coalesce((public.compute_transition_lease_v2('complete',p_node_id,p_lease_id,p_lease_token,p_result)->>'ok')::boolean,false); $$;

create or replace function public.compute_fail_lease(p_node_id text,p_lease_id uuid,p_lease_token text,p_error text,p_retry boolean default true)
returns boolean language sql security definer set search_path = public, extensions, pg_temp
as $$ select coalesce((public.compute_transition_lease_v2('fail',p_node_id,p_lease_id,p_lease_token,jsonb_build_object('error',p_error),120,p_retry)->>'ok')::boolean,false); $$;

revoke all on function public.compute_start_lease(text,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.compute_heartbeat_lease(text,uuid,text,jsonb,integer) from public, anon, authenticated;
revoke all on function public.compute_complete_lease(text,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.compute_fail_lease(text,uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.compute_start_lease(text,uuid,text,integer) to service_role;
grant execute on function public.compute_heartbeat_lease(text,uuid,text,jsonb,integer) to service_role;
grant execute on function public.compute_complete_lease(text,uuid,text,jsonb) to service_role;
grant execute on function public.compute_fail_lease(text,uuid,text,text,boolean) to service_role;
