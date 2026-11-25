-- compute_claim_task_yield_v3: pending, owner-approved only. Never applied here.
--
-- What it changes: public.compute_claim_task gains ONE optional parameter,
-- p_yield_seconds integer default 0 (clamped 0..300). A claim that passes a
-- positive value skips tasks created less than that many seconds ago, so a CPU
-- node that was told a GPU node is live (the gateway heartbeat's live_gpu_nodes)
-- can leave fresh work to it; a task that nobody claims within the yield is
-- taken as before. The returned 'task' JSON also carries 'priority'. The body
-- is the applied v2 (20261020210718_compute_lease_authority_v2.sql) with one
-- WHERE line added; the lease, expiry, concurrency and attempt rules are
-- unchanged.
--
-- Back-compat: the 4-argument call (positional or PostgREST named parameters,
-- which is what core/src/compute/store.mjs sends today) keeps working through
-- the default, so nothing changes until a node sends yield_seconds.
--
-- Why the old signature is dropped: CREATE OR REPLACE cannot add a parameter,
-- and keeping both overloads would make the gateway's named 4-argument call
-- ambiguous (two candidates match), so the 4-argument function is dropped in
-- the same transaction. Rollback: compute_claim_task_yield_v3.rollback.sql
-- recreates the v2 4-argument function verbatim.
--
-- Callers tolerate its absence: store.claimLease sends p_yield_seconds only
-- when asked to yield and, on PostgREST 404 PGRST202, retries without it and
-- remembers. PostgREST reloads its schema cache on DDL; if a PGRST202 still
-- appears after apply, run: notify pgrst, 'reload schema';
--
-- Proof (disposable PGlite or native PG, never production):
--   PGLITE_MODULE_PATH=<pinned PGlite>/dist/index.js node scripts/compute-lease-yield-sql-check.mjs
drop function if exists public.compute_claim_task(text, text[], text[], integer);
create function public.compute_claim_task(
  p_node_id text,
  p_capabilities text[],
  p_implementations text[],
  p_lease_seconds integer default 120,
  p_yield_seconds integer default 0
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
  v_yield integer := greatest(0, least(coalesce(p_yield_seconds, 0), 300));
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
     and (v_yield = 0 or t.created_at <= now() - make_interval(secs => v_yield))
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
    'yield_seconds', v_yield,
    'task', jsonb_build_object(
      'id', v_task.id,
      'org_id', v_task.org_id,
      'capability', v_task.capability,
      'implementation', v_implementation,
      'input', v_task.input,
      'requirements', v_task.requirements,
      'priority', v_task.priority,
      'metadata', v_task.metadata
    )
  );
end;
$$;

revoke all on function public.compute_claim_task(text,text[],text[],integer,integer) from public, anon, authenticated;
grant execute on function public.compute_claim_task(text,text[],text[],integer,integer) to service_role;
