-- PENDING ONLY. Requires compute_lease_authority_v2 and resident AI tables.
-- The reviewed release must apply this alongside compute_owner_enrollment_v1.
-- No migration history entry is created by this source file.
begin;
-- Server-owned recovery holds are separate from worker-supplied labels. A
-- signed heartbeat cannot clear a model-memory cleanup requirement.
alter table public.ops_compute_nodes add column if not exists pair_cleanup_required boolean not null default false;
alter table public.ops_compute_nodes add column if not exists pair_cleanup_details jsonb;
create table if not exists public.ops_compute_pairs (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id),
 name text not null check(char_length(name) between 1 and 80), node_ids text[] not null,
 state text not null default 'unavailable' check(state in ('unavailable','testing','ready','reserved','draining','running','cleanup','failed')),
 reason text not null default 'Both Macs need a supported local distributed runtime and a shared-model benchmark.',
 model_id text not null default 'mlx-community/Qwen3.5-27B-4bit', model_revision text,
 runtime jsonb not null default '{}', benchmark jsonb, updated_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 check(cardinality(node_ids)=2 and node_ids[1]<>node_ids[2])
);
create table if not exists public.ops_compute_pair_reservations (
 node_id text primary key references public.ops_compute_nodes(id),
 org_id uuid not null references public.orgs(id), pair_id uuid not null references public.ops_compute_pairs(id),
 reservation_id uuid not null, expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
alter table public.ops_compute_pairs enable row level security;
alter table public.ops_compute_pair_reservations enable row level security;
revoke all on public.ops_compute_pairs,public.ops_compute_pair_reservations from public,anon,authenticated;
grant select,insert,update,delete on public.ops_compute_pairs,public.ops_compute_pair_reservations to service_role;
create index if not exists ops_compute_pair_reservation_id on public.ops_compute_pair_reservations(reservation_id);

create or replace function public.compute_owner_workspace_status() returns jsonb
language sql security invoker set search_path=public,pg_temp as $$
 select '{"version":1,"node_pinning":true,"pair_reservations":true,"turn_stop":true}'::jsonb;
$$;
revoke all on function public.compute_owner_workspace_status() from public,anon,authenticated;
grant execute on function public.compute_owner_workspace_status() to service_role;

-- Locks both node rows in ID order before reserving either. Claims use the same
-- node lock. Existing leases finish; new independent claims cannot enter.
create or replace function public.compute_reserve_pair(p_org_id uuid,p_pair_id uuid,p_reservation_id uuid,p_seconds integer default 900)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.ops_compute_pairs%rowtype; n public.ops_compute_nodes%rowtype; c integer:=0; active_count integer:=0;
begin
 if p_org_id is null or p_pair_id is null or p_reservation_id is null then raise exception 'PAIR_REQUEST_INVALID'; end if;
 select * into p from public.ops_compute_pairs where id=p_pair_id and org_id=p_org_id for update;
 if not found then raise exception 'PAIR_NOT_FOUND'; end if;
 if exists(select 1 from public.ops_compute_pair_reservations where reservation_id=p_reservation_id and (pair_id<>p_pair_id or org_id<>p_org_id)) then raise exception 'PAIR_RESERVATION_CONFLICT'; end if;
 for n in select * from public.ops_compute_nodes where id=any(p.node_ids) order by id for update loop
  if n.org_id<>p_org_id or n.state<>'online' or n.revoked_at is not null or n.pair_cleanup_required or n.last_seen_at is null or n.last_seen_at<clock_timestamp()-interval '3 minutes' then raise exception 'PAIR_DEVICE_UNAVAILABLE'; end if;
  if n.inventory->>'platform' is distinct from 'darwin' or n.inventory->>'arch' is distinct from 'arm64' or not exists(
   select 1 from jsonb_array_elements(n.capabilities) cap where cap->>'capability'='compute.pair.control' and cap->>'implementation'='exo.mlx.local'
  ) then raise exception 'PAIR_RUNTIME_UNAVAILABLE'; end if;
  if exists(select 1 from public.ops_compute_pair_reservations where node_id=n.id and reservation_id<>p_reservation_id) then raise exception 'PAIR_BUSY'; end if;
  c:=c+1;
 end loop;
 if c<>2 then raise exception 'PAIR_DEVICE_UNAVAILABLE'; end if;
 insert into public.ops_compute_pair_reservations(node_id,org_id,pair_id,reservation_id,expires_at)
 select unnest(p.node_ids),p_org_id,p_pair_id,p_reservation_id,clock_timestamp()+make_interval(secs=>greatest(30,least(1800,p_seconds)))
 on conflict(node_id) do update set expires_at=excluded.expires_at where ops_compute_pair_reservations.reservation_id=p_reservation_id;
 select count(*) into active_count from public.ops_compute_leases where node_id=any(p.node_ids) and status in ('leased','running') and expires_at>clock_timestamp();
 update public.ops_compute_pairs set state=case when active_count>0 then 'draining' else 'reserved' end,updated_at=clock_timestamp() where id=p.id;
 return jsonb_build_object('reservation_id',p_reservation_id,'node_ids',p.node_ids,'active_leases',active_count);
end;$$;
revoke all on function public.compute_reserve_pair(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.compute_reserve_pair(uuid,uuid,uuid,integer) to service_role;

-- Cleanup must be acknowledged by both devices. If a worker cannot confirm
-- unload, release the reservation but pause it, so ordinary jobs cannot race
-- a model that may still occupy memory. The laptop/OVH are never touched.
create or replace function public.compute_release_pair(p_org_id uuid,p_reservation_id uuid,p_clean_node_ids text[] default '{}')
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r record; p public.ops_compute_pairs%rowtype; ids text[]:='{}'; pair_ids uuid[]:='{}'; task_ids uuid[]:='{}'; paused_ids text[]:='{}'; clean_ids text[];
begin
 -- Reserve, enqueue and release all take the pair lock before node locks.
 -- This avoids a pair/node lock inversion during concurrent cleanup/reserve.
 for p in select pair_row.* from public.ops_compute_pairs pair_row where pair_row.org_id=p_org_id and exists(
  select 1 from public.ops_compute_pair_reservations pr where pr.pair_id=pair_row.id and pr.org_id=p_org_id and pr.reservation_id=p_reservation_id
 ) order by pair_row.id for update loop pair_ids:=array_append(pair_ids,p.id); end loop;
 for r in select n.id,pr.pair_id from public.ops_compute_nodes n join public.ops_compute_pair_reservations pr on pr.node_id=n.id
  where pr.org_id=p_org_id and pr.reservation_id=p_reservation_id order by n.id for update of n loop
  ids:=array_append(ids,r.id);
 end loop;
 if cardinality(ids)=0 then return jsonb_build_object('released',true,'already_released',true,'node_ids','[]'::jsonb,'paused_node_ids','[]'::jsonb,'task_ids','[]'::jsonb); end if;
 select coalesce(array_agg(distinct id order by id),'{}'::text[]) into clean_ids from unnest(coalesce(p_clean_node_ids,'{}')) id;
 if cardinality(clean_ids)<>cardinality(coalesce(p_clean_node_ids,'{}')) or not(clean_ids <@ ids) then raise exception 'PAIR_CLEANUP_IDS_INVALID'; end if;
 -- Cancel every unfinished command owned by this reservation before slots
 -- reopen. Current node -> lease -> task ordering matches lease transitions.
 select coalesce(array_agg(id),'{}'::uuid[]) into task_ids from public.ops_compute_tasks
  where org_id=p_org_id and requirements->>'pair_reservation_id'=p_reservation_id::text;
 for r in select id from public.ops_compute_leases where task_id=any(task_ids) and status in('leased','running') order by id for update loop null; end loop;
 update public.ops_compute_leases set status='canceled',completed_at=clock_timestamp(),updated_at=clock_timestamp(),last_error='Pair reservation released'
  where task_id=any(task_ids) and status in('leased','running');
 update public.ops_compute_tasks set status='canceled',locked_by_node_id=null,locked_at=null,updated_at=clock_timestamp(),last_error='Pair reservation released'
  where id=any(task_ids) and status in('queued','leased','running');
 for r in select id from public.ops_compute_nodes where id=any(ids) order by id loop
  if not(r.id=any(clean_ids)) then
   update public.ops_compute_nodes set pair_cleanup_required=true,
    pair_cleanup_details=jsonb_build_object('reservation_id',p_reservation_id,'required_at',clock_timestamp(),'reason','The shared runtime did not confirm model unload.'),
    state=case when revoked_at is null and state not in('revoked','quarantined') then 'draining' else state end,
    updated_at=clock_timestamp() where id=r.id;
   paused_ids:=array_append(paused_ids,r.id);
  end if;
 end loop;
 for p in select * from public.ops_compute_pairs where id=any(pair_ids) loop
  update public.ops_compute_pairs set state=case when p.node_ids <@ clean_ids and benchmark is not null then 'ready' else 'unavailable' end,
   reason=case when p.node_ids <@ clean_ids then 'Pair released. Readiness requires a current benchmark and both devices online.' else 'Cleanup was not confirmed on both Macs. Unconfirmed workers are paused; unload the shared runtime before resuming.' end,
   updated_at=clock_timestamp() where id=p.id;
 end loop;
 delete from public.ops_compute_pair_reservations where org_id=p_org_id and reservation_id=p_reservation_id;
 return jsonb_build_object('released',true,'node_ids',ids,'paused_node_ids',paused_ids,'task_ids',task_ids);
end;$$;
revoke all on function public.compute_release_pair(uuid,uuid,text[]) from public,anon,authenticated;
grant execute on function public.compute_release_pair(uuid,uuid,text[]) to service_role;

-- Resume shares the node lock with cleanup and revocation. A browser-side
-- read/check/PATCH could otherwise race a cleanup hold or revive a revoked
-- identity. The hold is cleared only by separately verified local cleanup.
create or replace function public.compute_resume_owner_device(p_org_id uuid,p_node_id text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare n public.ops_compute_nodes%rowtype;
begin
 select * into n from public.ops_compute_nodes where id=p_node_id and org_id=p_org_id for update;
 if not found then raise exception 'DEVICE_NOT_FOUND'; end if;
 if n.revoked_at is not null or n.state='revoked' then raise exception 'DEVICE_REVOKED'; end if;
 if n.state='quarantined' then raise exception 'DEVICE_QUARANTINED'; end if;
 if n.pair_cleanup_required then raise exception 'DEVICE_PAIR_CLEANUP_REQUIRED'; end if;
 update public.ops_compute_nodes set state='online',updated_at=clock_timestamp() where id=n.id returning * into n;
 return to_jsonb(n);
end;$$;
revoke all on function public.compute_resume_owner_device(uuid,text) from public,anon,authenticated;
grant execute on function public.compute_resume_owner_device(uuid,text) to service_role;

-- Only the signed gateway calls this after an explicitly invoked local
-- controller unload/probe. It clears the matching hold, never auto-resumes.
-- A browser cannot invoke this RPC or acknowledge cleanup for another node.
create or replace function public.compute_ack_pair_cleanup(p_node_id text,p_reservation_id uuid,p_receipt jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare n public.ops_compute_nodes%rowtype; observed timestamptz; required_at timestamptz;
begin
 select * into n from public.ops_compute_nodes where id=p_node_id for update;
 if not found or n.revoked_at is not null or n.state in('revoked','quarantined') or n.labels->>'enrolled_trust' is distinct from 'owned' then return null; end if;
 if not n.pair_cleanup_required or n.pair_cleanup_details->>'reservation_id' is distinct from p_reservation_id::text then return null; end if;
 if jsonb_typeof(p_receipt) is distinct from 'object' or p_receipt->>'schema' is distinct from 'mccluster-pair-cleanup/1'
  or p_receipt->>'runtime' is distinct from 'exo' or p_receipt->>'unloaded' is distinct from 'true' or p_receipt->>'model_instances' is distinct from '0' then return null; end if;
 begin observed:=(p_receipt->>'observed_at')::timestamptz; required_at:=(n.pair_cleanup_details->>'required_at')::timestamptz;
 exception when others then return null; end;
 if observed is null or required_at is null or observed<required_at or observed<clock_timestamp()-interval '5 minutes' or observed>clock_timestamp()+interval '1 minute' then return null; end if;
 if exists(select 1 from public.ops_compute_pair_reservations where node_id=n.id) or exists(
  select 1 from public.ops_compute_leases where node_id=n.id and status in('leased','running') and expires_at>clock_timestamp()
 ) then return null; end if;
 update public.ops_compute_nodes set pair_cleanup_required=false,
  pair_cleanup_details=pair_cleanup_details||jsonb_build_object('confirmed_at',clock_timestamp(),'receipt',p_receipt),
  state='draining',updated_at=clock_timestamp() where id=n.id returning * into n;
 return jsonb_build_object('node_id',n.id,'state',n.state,'cleanup_confirmed',true,'resume_available',true);
end;$$;
revoke all on function public.compute_ack_pair_cleanup(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.compute_ack_pair_cleanup(text,uuid,jsonb) to service_role;

-- Crash recovery is deliberately fail closed. An expired reservation cannot
-- admit ordinary work until its commands are fenced and both Macs are paused.
create or replace function public.compute_reconcile_expired_pairs(p_org_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r record; reservation uuid; candidates uuid[]:='{}'; released uuid[]:='{}';
begin
 -- Lock every candidate pair before any node, then every candidate node in
 -- one global ID order. Calling release one pair at a time without these
 -- locks could invert node ordering across two pairs against an owner Stop.
 for r in select p.id from public.ops_compute_pairs p where p.org_id=p_org_id and exists(
  select 1 from public.ops_compute_pair_reservations pr where pr.pair_id=p.id and pr.org_id=p_org_id and pr.expires_at<=clock_timestamp()
 ) order by p.id for update loop
  -- A concurrent keepalive may have extended the reservation while this
  -- reconciler waited for its pair lock. Never release renewed authority.
  for reservation in select distinct pr.reservation_id from public.ops_compute_pair_reservations pr
   where pr.org_id=p_org_id and pr.pair_id=r.id and not exists(
    select 1 from public.ops_compute_pair_reservations live where live.org_id=p_org_id and live.reservation_id=pr.reservation_id and live.expires_at>clock_timestamp()
   ) loop candidates:=array_append(candidates,reservation); end loop;
 end loop;
 for r in select n.id from public.ops_compute_nodes n where n.id in(
  select pr.node_id from public.ops_compute_pair_reservations pr where pr.org_id=p_org_id and pr.reservation_id=any(candidates)
 ) order by n.id for update loop null; end loop;
 foreach reservation in array candidates loop
  perform public.compute_release_pair(p_org_id,reservation,'{}');
  released:=array_append(released,reservation);
 end loop;
 return jsonb_build_object('released_reservations',released,'count',cardinality(released));
end;$$;
revoke all on function public.compute_reconcile_expired_pairs(uuid) from public,anon,authenticated;
grant execute on function public.compute_reconcile_expired_pairs(uuid) to service_role;

-- Pair commands serialize with release. No runner can append an orphaned
-- command after cleanup commits. Cleanup itself may run after a chat stop.
create or replace function public.compute_enqueue_pair_task(p_org_id uuid,p_reservation_id uuid,p_task jsonb,p_idempotency_key text)
returns jsonb language plpgsql security invoker set search_path=public,extensions,pg_temp as $$
declare p public.ops_compute_pairs%rowtype; member_id text; pair_id uuid; metadata jsonb;
begin
 if jsonb_typeof(p_task) is distinct from 'object' or p_reservation_id is null or p_idempotency_key is null
  or p_task->>'capability' is distinct from 'compute.pair.control' or p_task->>'implementation' is distinct from 'exo.mlx.local' then raise exception 'PAIR_TASK_INVALID'; end if;
 select pr.pair_id into pair_id from public.ops_compute_pair_reservations pr where pr.org_id=p_org_id and pr.reservation_id=p_reservation_id order by pr.node_id limit 1;
 select * into p from public.ops_compute_pairs where id=pair_id and org_id=p_org_id for update;
 if not found then raise exception 'PAIR_RESERVATION_LOST'; end if;
 member_id:=p_task->'requirements'->>'node_id';
 if p_task->'requirements'->>'pair_reservation_id' is distinct from p_reservation_id::text or not coalesce(member_id=any(p.node_ids),false)
  or (select count(*) from public.ops_compute_pair_reservations pr where pr.org_id=p_org_id and pr.pair_id=p.id and pr.reservation_id=p_reservation_id and pr.node_id=any(p.node_ids) and pr.expires_at>clock_timestamp())<>2 then raise exception 'PAIR_RESERVATION_LOST'; end if;
 metadata:=coalesce(p_task->'metadata','{}'::jsonb)||jsonb_build_object('pair_id',p.id,'reservation_id',p_reservation_id);
 return public.compute_enqueue_task(p_org_id,p_task->>'capability',p_task->>'implementation',coalesce(p_task->'input','{}'::jsonb),coalesce(p_task->'requirements','{}'::jsonb),
  coalesce((p_task->>'priority')::integer,90),(p_task->>'run_after')::timestamptz,coalesce((p_task->>'max_attempts')::integer,1),metadata,p_idempotency_key);
end;$$;
revoke all on function public.compute_enqueue_pair_task(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.compute_enqueue_pair_task(uuid,uuid,jsonb,text) to service_role;
create or replace function public.compute_claim_task_v4(
  p_node_id text,
  p_capabilities text[],
  p_implementations text[],
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security invoker
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
  if v_node.state <> 'online' or v_node.revoked_at is not null or v_node.pair_cleanup_required then return null; end if;
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
     and (not (t.requirements ? 'node_id') or t.requirements->>'node_id' = p_node_id)
     and (
       (not (t.requirements ? 'pair_reservation_id') and not exists (
         select 1 from public.ops_compute_pair_reservations r where r.node_id=p_node_id
       )) or exists (
         select 1 from public.ops_compute_pair_reservations r
         where r.node_id=p_node_id and r.org_id=v_node.org_id
           and r.reservation_id::text=t.requirements->>'pair_reservation_id'
           and r.expires_at>clock_timestamp()
       )
     )
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

revoke all on function public.compute_claim_task_v4(text,text[],text[],integer) from public, anon, authenticated;
grant execute on function public.compute_claim_task_v4(text,text[],text[],integer) to service_role;


-- Preserve the old RPC signature, but enforce the SAME pins/reservations even
-- when an older gateway calls it. There is no permissive fallback path.
create or replace function public.compute_claim_task(p_node_id text,p_capabilities text[],p_implementations text[],p_lease_seconds integer default 120)
returns jsonb language sql security invoker set search_path=public,extensions,pg_temp as $$
 select public.compute_claim_task_v4(p_node_id,p_capabilities,p_implementations,p_lease_seconds);
$$;
revoke all on function public.compute_claim_task(text,text[],text[],integer) from public,anon,authenticated;
grant execute on function public.compute_claim_task(text,text[],text[],integer) to service_role;

create or replace function public.ops_ai_submit_workspace_turn(p_org_id uuid,p_thread_id uuid,p_user_message_id uuid,p_assistant_message_id uuid,p_content text,p_metadata jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare prior public.ops_ai_messages%rowtype; result record;
begin
 if jsonb_typeof(p_metadata) is distinct from 'object' or jsonb_typeof(p_metadata->'workspace_route') is distinct from 'object' then raise exception 'AI_TURN_METADATA_INVALID'; end if;
 select * into result from public.ops_ai_submit_turn(p_org_id,p_thread_id,p_user_message_id,p_assistant_message_id,p_content,coalesce(p_metadata->>'input_mode','text'));
 -- The base insert can wait on another request using the same message ID.
 -- Re-read only AFTER that wait, under the message lock, before comparing the
 -- route and review source. Concurrent conflicting retries cannot adopt the
 -- first request's message while silently changing its route.
 select * into strict prior from public.ops_ai_messages where id=p_user_message_id for update;
 if prior.org_id<>p_org_id or prior.thread_id<>p_thread_id or prior.role<>'user' or prior.content<>btrim(p_content) then raise exception 'AI_TURN_ID_CONFLICT'; end if;
 if prior.metadata ? 'workspace_route' then
  if prior.metadata->'workspace_route' is distinct from p_metadata->'workspace_route'
   or prior.metadata->'review_of_turn_id' is distinct from p_metadata->'review_of_turn_id'
   or prior.metadata->'review_source' is distinct from p_metadata->'review_source'
   or coalesce(prior.metadata->'images','[]'::jsonb) is distinct from coalesce(p_metadata->'images','[]'::jsonb)
   or coalesce(prior.metadata->'allow_browser','false'::jsonb) is distinct from coalesce(p_metadata->'allow_browser','false'::jsonb) then raise exception 'AI_TURN_ID_CONFLICT'; end if;
 else
  update public.ops_ai_messages set metadata=metadata||p_metadata where id=p_user_message_id;
 end if;
 return to_jsonb(result);
end;$$;
revoke all on function public.ops_ai_submit_workspace_turn(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ops_ai_submit_workspace_turn(uuid,uuid,uuid,uuid,text,jsonb) to service_role;

-- Admission of a routed compute task and the resident job authority check
-- share one transaction. Stop locks this same job before fencing fabric work,
-- so a stale runner cannot enqueue a new task immediately after an owner stop.
create or replace function public.ops_ai_enqueue_workspace_task(p_org_id uuid,p_turn_id uuid,p_job_lease text,p_job_attempt integer,p_task jsonb,p_idempotency_key text)
returns jsonb language plpgsql security invoker set search_path=public,extensions,pg_temp as $$
declare j public.ops_agent_jobs%rowtype; task jsonb; result jsonb; v_metadata jsonb;
begin
 select * into j from public.ops_agent_jobs where id=p_turn_id and org_id=p_org_id and job_type='resident_ai_turn' for update;
 if not found or j.status is distinct from 'running' or p_job_lease is null or j.locked_by is distinct from p_job_lease or j.attempts is distinct from p_job_attempt then raise exception 'AI_TURN_LEASE_LOST'; end if;
 if exists(select 1 from public.ops_ai_messages where id=(j.input->>'assistant_message_id')::uuid and org_id=p_org_id) then raise exception 'AI_TURN_ALREADY_COMPLETED'; end if;
 if jsonb_typeof(p_task) is distinct from 'object' or p_idempotency_key is null or not coalesce(p_task->>'capability' in('ai.chat','compute.pair.control'),false) then raise exception 'AI_TURN_TASK_INVALID'; end if;
 v_metadata:=coalesce(p_task->'metadata','{}'::jsonb)||jsonb_build_object('turn_id',p_turn_id);
 task:=p_task||jsonb_build_object('metadata',v_metadata);
 if task->'requirements' ? 'pair_reservation_id' then
  result:=public.compute_enqueue_pair_task(p_org_id,(task->'requirements'->>'pair_reservation_id')::uuid,task,p_idempotency_key);
 else
  if task->>'capability'<>'ai.chat' then raise exception 'AI_TURN_TASK_INVALID'; end if;
  result:=public.compute_enqueue_task(p_org_id,task->>'capability',task->>'implementation',coalesce(task->'input','{}'::jsonb),coalesce(task->'requirements','{}'::jsonb),
   coalesce((task->>'priority')::integer,100),(task->>'run_after')::timestamptz,coalesce((task->>'max_attempts')::integer,3),v_metadata,p_idempotency_key);
 end if;
 if result->>'conflict'='true' then raise exception 'AI_TURN_TASK_CONFLICT'; end if;
 update public.ops_ai_messages set metadata=metadata||jsonb_build_object('active_compute_task_id',result->'task'->>'id') where id=(j.input->>'user_message_id')::uuid and org_id=p_org_id;
 return result;
end;$$;
revoke all on function public.ops_ai_enqueue_workspace_task(uuid,uuid,text,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.ops_ai_enqueue_workspace_task(uuid,uuid,text,integer,jsonb,text) to service_role;

create or replace function public.ops_ai_checkpoint_workspace_turn(p_org_id uuid,p_turn_id uuid,p_job_lease text,p_job_attempt integer,p_metadata jsonb)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare j public.ops_agent_jobs%rowtype;
begin
 select * into j from public.ops_agent_jobs where id=p_turn_id and org_id=p_org_id and job_type='resident_ai_turn' for update;
 if not found or j.status is distinct from 'running' or p_job_lease is null or j.locked_by is distinct from p_job_lease or j.attempts is distinct from p_job_attempt then return false; end if;
 update public.ops_ai_messages set metadata=metadata||p_metadata where id=(j.input->>'user_message_id')::uuid and org_id=p_org_id;
 return true;
end;$$;
revoke all on function public.ops_ai_checkpoint_workspace_turn(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.ops_ai_checkpoint_workspace_turn(uuid,uuid,text,integer,jsonb) to service_role;

create or replace function public.ops_ai_complete_workspace_turn(p_org_id uuid,p_turn_id uuid,p_job_lease text,p_job_attempt integer,p_message jsonb)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare j public.ops_agent_jobs%rowtype;
begin
 select * into j from public.ops_agent_jobs where id=p_turn_id and org_id=p_org_id and job_type='resident_ai_turn' for update;
 if not found or j.status is distinct from 'running' or p_job_lease is null or j.locked_by is distinct from p_job_lease or j.attempts is distinct from p_job_attempt then return false; end if;
 if j.input->>'assistant_message_id' is distinct from p_message->>'id' or j.input->>'thread_id' is distinct from p_message->>'thread_id' then return false; end if;
 insert into public.ops_ai_messages(id,thread_id,org_id,role,content,model,implementation,compute_task_id,metadata)
 values((p_message->>'id')::uuid,(p_message->>'thread_id')::uuid,p_org_id,'assistant',p_message->>'content',p_message->>'model',p_message->>'implementation',p_message->>'compute_task_id',coalesce(p_message->'metadata','{}')) on conflict(id) do nothing;
 update public.ops_ai_messages set metadata=metadata||'{"task_status":"done"}'::jsonb where id=(j.input->>'user_message_id')::uuid and org_id=p_org_id;
 return true;
end;$$;
revoke all on function public.ops_ai_complete_workspace_turn(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.ops_ai_complete_workspace_turn(uuid,uuid,text,integer,jsonb) to service_role;

create or replace function public.ops_ai_stop_workspace_turn(p_org_id uuid,p_turn_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare j public.ops_agent_jobs%rowtype; n record; ids uuid[];
begin
 select * into j from public.ops_agent_jobs where id=p_turn_id and org_id=p_org_id and job_type='resident_ai_turn' for update;
 if not found then raise exception 'AI_TURN_NOT_FOUND'; end if;
 if exists(select 1 from public.ops_ai_messages where id=(j.input->>'assistant_message_id')::uuid and org_id=p_org_id) or j.status='done' then return jsonb_build_object('stopped',false,'status','done'); end if;
 if j.status='canceled' then return jsonb_build_object('stopped',true,'status','canceled'); end if;
 -- Lock possible claimants, including nodes without a lease yet. Otherwise a
 -- queued task could acquire an unseen lease between the lease and task
 -- updates. Enqueue is already serialized on this job row. Stable node ->
 -- lease -> task ordering matches claims and signed lease transitions.
 for n in select * from public.ops_compute_nodes where org_id=p_org_id order by id for update loop null; end loop;
 select array_agg(id) into ids from public.ops_compute_tasks where org_id=p_org_id and metadata->>'turn_id'=p_turn_id::text and status in('queued','leased','running');
 for n in select id from public.ops_compute_leases where task_id=any(ids) and status in('leased','running') order by id for update loop null; end loop;
 update public.ops_compute_leases set status='canceled',completed_at=clock_timestamp(),updated_at=clock_timestamp(),last_error='Stopped by owner' where task_id=any(ids) and status in('leased','running');
 update public.ops_compute_tasks set status='canceled',locked_by_node_id=null,locked_at=null,last_error='Stopped by owner',updated_at=clock_timestamp() where id=any(ids);
 update public.ops_agent_jobs set status='canceled',locked_by=null,locked_at=null,updated_at=clock_timestamp(),last_error='Stopped by owner' where id=j.id;
 update public.ops_ai_messages set metadata=metadata||'{"task_status":"canceled","stopped_by_owner":true}'::jsonb where id=(j.input->>'user_message_id')::uuid and org_id=p_org_id;
 return jsonb_build_object('stopped',true,'status','canceled','turn_id',p_turn_id);
end;$$;
revoke all on function public.ops_ai_stop_workspace_turn(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ops_ai_stop_workspace_turn(uuid,uuid) to service_role;
commit;
