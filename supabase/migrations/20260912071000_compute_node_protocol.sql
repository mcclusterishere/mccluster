-- McCluster self-hosted compute fabric v1.
-- GPU/accelerator nodes authenticate to Core with node-held Ed25519 keys.
-- Only the service-role-backed Core gateway mutates these tables/RPCs.

create extension if not exists pgcrypto;

create table if not exists public.ops_compute_nodes (
  id text primary key check (id ~ '^node_[a-f0-9]{24,64}$'),
  org_id uuid not null references public.orgs(id) on delete cascade,
  display_name text not null,
  public_key_pem text not null,
  key_fingerprint text not null unique,
  protocol_version text not null,
  agent_version text not null,
  state text not null default 'online'
    check (state in ('online','draining','offline','quarantined','revoked')),
  inventory jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '[]'::jsonb,
  labels jsonb not null default '{}'::jsonb,
  load jsonb not null default '{}'::jsonb,
  max_leases integer not null default 1 check (max_leases between 1 and 64),
  enrolled_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(inventory) = 'object'),
  check (jsonb_typeof(capabilities) = 'array'),
  check (jsonb_typeof(labels) = 'object'),
  check (jsonb_typeof(load) = 'object')
);

create index if not exists ops_compute_nodes_org_state_idx
  on public.ops_compute_nodes(org_id, state, last_seen_at desc);
create index if not exists ops_compute_nodes_last_seen_idx
  on public.ops_compute_nodes(last_seen_at desc);
create index if not exists ops_compute_nodes_capabilities_gin
  on public.ops_compute_nodes using gin(capabilities);

create table if not exists public.ops_compute_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  capability text not null,
  implementation text,
  input jsonb not null default '{}'::jsonb,
  requirements jsonb not null default '{}'::jsonb,
  priority integer not null default 0,
  status text not null default 'queued'
    check (status in ('queued','leased','running','done','failed','canceled')),
  run_after timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 100),
  locked_by_node_id text references public.ops_compute_nodes(id) on delete set null,
  locked_at timestamptz,
  output jsonb,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (capability ~ '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'),
  check (jsonb_typeof(input) = 'object'),
  check (jsonb_typeof(requirements) = 'object'),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists ops_compute_tasks_queue_idx
  on public.ops_compute_tasks(status, priority desc, run_after, created_at)
  where status = 'queued';
create index if not exists ops_compute_tasks_org_idx
  on public.ops_compute_tasks(org_id, updated_at desc);
create index if not exists ops_compute_tasks_capability_idx
  on public.ops_compute_tasks(capability, status, priority desc);

create table if not exists public.ops_compute_leases (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ops_compute_tasks(id) on delete cascade,
  node_id text not null references public.ops_compute_nodes(id) on delete cascade,
  status text not null default 'leased'
    check (status in ('leased','running','done','failed','expired','canceled')),
  lease_token_hash text not null,
  expires_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  progress jsonb not null default '{}'::jsonb,
  result jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(progress) = 'object')
);

create unique index if not exists ops_compute_one_active_lease_per_task
  on public.ops_compute_leases(task_id)
  where status in ('leased','running');
create index if not exists ops_compute_leases_node_idx
  on public.ops_compute_leases(node_id, status, expires_at);
create index if not exists ops_compute_leases_expiry_idx
  on public.ops_compute_leases(status, expires_at)
  where status in ('leased','running');

create table if not exists public.ops_compute_nonces (
  node_id text not null references public.ops_compute_nodes(id) on delete cascade,
  nonce text not null,
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (node_id, nonce)
);
create index if not exists ops_compute_nonces_expiry_idx on public.ops_compute_nonces(expires_at);

alter table public.ops_compute_nodes enable row level security;
alter table public.ops_compute_tasks enable row level security;
alter table public.ops_compute_leases enable row level security;
alter table public.ops_compute_nonces enable row level security;

revoke all on public.ops_compute_nodes from anon, authenticated;
revoke all on public.ops_compute_tasks from anon, authenticated;
revoke all on public.ops_compute_leases from anon, authenticated;
revoke all on public.ops_compute_nonces from anon, authenticated;

-- Replay protection is durable across Core restarts and multiple gateway replicas.
create or replace function public.compute_accept_nonce(
  p_node_id text,
  p_nonce text,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_expires_at <= now() then return false; end if;
  delete from public.ops_compute_nonces
   where node_id = p_node_id and expires_at < now();
  begin
    insert into public.ops_compute_nonces(node_id, nonce, expires_at)
    values (p_node_id, p_nonce, p_expires_at);
    return true;
  exception when unique_violation then
    return false;
  end;
end;
$$;

-- Atomic SKIP LOCKED lease claim. The node tells Core what it can execute;
-- Core never asks a node to accept arbitrary shell/code payloads.
create or replace function public.compute_claim_task(
  p_node_id text,
  p_capabilities text[],
  p_implementations text[],
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_node public.ops_compute_nodes%rowtype;
  v_task public.ops_compute_tasks%rowtype;
  v_lease_id uuid;
  v_token text;
  v_running integer;
  v_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 120), 900));
begin
  select * into v_node
    from public.ops_compute_nodes
   where id = p_node_id
   for update;
  if not found then return null; end if;
  if v_node.state <> 'online' or v_node.revoked_at is not null then return null; end if;
  if v_node.last_seen_at < now() - interval '3 minutes' then return null; end if;

  update public.ops_compute_leases
     set status = 'expired', updated_at = now(), last_error = coalesce(last_error, 'lease expired')
   where node_id = p_node_id
     and status in ('leased','running')
     and expires_at <= now();

  update public.ops_compute_tasks t
     set status = case when t.attempts < t.max_attempts then 'queued' else 'failed' end,
         locked_by_node_id = null,
         locked_at = null,
         run_after = case when t.attempts < t.max_attempts then now() + interval '30 seconds' else t.run_after end,
         last_error = coalesce(t.last_error, 'compute lease expired'),
         updated_at = now()
   where t.id in (
     select l.task_id from public.ops_compute_leases l
      where l.node_id = p_node_id and l.status = 'expired'
   ) and t.status in ('leased','running');

  select count(*) into v_running
    from public.ops_compute_leases
   where node_id = p_node_id
     and status in ('leased','running')
     and expires_at > now();
  if v_running >= v_node.max_leases then return null; end if;

  select * into v_task
    from public.ops_compute_tasks
   where org_id = v_node.org_id
     and status = 'queued'
     and run_after <= now()
     and attempts < max_attempts
     and capability = any(coalesce(p_capabilities, array[]::text[]))
     and (implementation is null or implementation = any(coalesce(p_implementations, array[]::text[])))
   order by priority desc, run_after asc, created_at asc
   for update skip locked
   limit 1;
  if not found then return null; end if;

  v_token := encode(gen_random_bytes(32), 'hex');
  insert into public.ops_compute_leases(task_id, node_id, status, lease_token_hash, expires_at)
  values (
    v_task.id,
    p_node_id,
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
    'lease_token', v_token,
    'expires_at', now() + make_interval(secs => v_seconds),
    'task', jsonb_build_object(
      'id', v_task.id,
      'org_id', v_task.org_id,
      'capability', v_task.capability,
      'implementation', v_task.implementation,
      'input', v_task.input,
      'requirements', v_task.requirements,
      'metadata', v_task.metadata
    )
  );
end;
$$;

create or replace function public.compute_start_lease(
  p_node_id text,
  p_lease_id uuid,
  p_lease_token text,
  p_extend_seconds integer default 120
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_lease public.ops_compute_leases%rowtype; v_seconds integer := greatest(30, least(coalesce(p_extend_seconds,120),900));
begin
  select * into v_lease from public.ops_compute_leases
   where id=p_lease_id and node_id=p_node_id for update;
  if not found or v_lease.status <> 'leased' or v_lease.expires_at <= now() then return null; end if;
  if encode(digest(p_lease_token,'sha256'),'hex') <> v_lease.lease_token_hash then return null; end if;
  update public.ops_compute_leases set status='running', started_at=coalesce(started_at,now()), expires_at=now()+make_interval(secs=>v_seconds), updated_at=now() where id=p_lease_id;
  update public.ops_compute_tasks set status='running', updated_at=now() where id=v_lease.task_id and locked_by_node_id=p_node_id;
  return jsonb_build_object('ok',true,'expires_at',now()+make_interval(secs=>v_seconds));
end;
$$;

create or replace function public.compute_heartbeat_lease(
  p_node_id text,
  p_lease_id uuid,
  p_lease_token text,
  p_progress jsonb default '{}'::jsonb,
  p_extend_seconds integer default 120
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_lease public.ops_compute_leases%rowtype; v_seconds integer := greatest(30, least(coalesce(p_extend_seconds,120),900));
begin
  select * into v_lease from public.ops_compute_leases where id=p_lease_id and node_id=p_node_id for update;
  if not found or v_lease.status <> 'running' or v_lease.expires_at <= now() then return null; end if;
  if encode(digest(p_lease_token,'sha256'),'hex') <> v_lease.lease_token_hash then return null; end if;
  update public.ops_compute_leases set progress=coalesce(p_progress,'{}'::jsonb), expires_at=now()+make_interval(secs=>v_seconds), updated_at=now() where id=p_lease_id;
  update public.ops_compute_tasks set updated_at=now() where id=v_lease.task_id and status='running';
  return jsonb_build_object('ok',true,'expires_at',now()+make_interval(secs=>v_seconds));
end;
$$;

create or replace function public.compute_complete_lease(
  p_node_id text,
  p_lease_id uuid,
  p_lease_token text,
  p_result jsonb default '{}'::jsonb
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_lease public.ops_compute_leases%rowtype;
begin
  select * into v_lease from public.ops_compute_leases where id=p_lease_id and node_id=p_node_id for update;
  if not found or v_lease.status <> 'running' then return false; end if;
  if encode(digest(p_lease_token,'sha256'),'hex') <> v_lease.lease_token_hash then return false; end if;
  update public.ops_compute_leases set status='done', result=coalesce(p_result,'{}'::jsonb), completed_at=now(), updated_at=now() where id=p_lease_id;
  update public.ops_compute_tasks set status='done', output=coalesce(p_result,'{}'::jsonb), locked_by_node_id=null, locked_at=null, last_error=null, updated_at=now() where id=v_lease.task_id and locked_by_node_id=p_node_id;
  return true;
end;
$$;

create or replace function public.compute_fail_lease(
  p_node_id text,
  p_lease_id uuid,
  p_lease_token text,
  p_error text,
  p_retry boolean default true
) returns boolean
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_lease public.ops_compute_leases%rowtype; v_task public.ops_compute_tasks%rowtype; v_retry boolean;
begin
  select * into v_lease from public.ops_compute_leases where id=p_lease_id and node_id=p_node_id for update;
  if not found or v_lease.status not in ('leased','running') then return false; end if;
  if encode(digest(p_lease_token,'sha256'),'hex') <> v_lease.lease_token_hash then return false; end if;
  select * into v_task from public.ops_compute_tasks where id=v_lease.task_id for update;
  v_retry := coalesce(p_retry,true) and v_task.attempts < v_task.max_attempts;
  update public.ops_compute_leases set status='failed', last_error=left(coalesce(p_error,'compute node failure'),4000), completed_at=now(), updated_at=now() where id=p_lease_id;
  update public.ops_compute_tasks
     set status=case when v_retry then 'queued' else 'failed' end,
         run_after=case when v_retry then now()+make_interval(secs=>least(3600, greatest(30, power(2, greatest(1,v_task.attempts))::integer * 15))) else run_after end,
         locked_by_node_id=null,
         locked_at=null,
         last_error=left(coalesce(p_error,'compute node failure'),4000),
         updated_at=now()
   where id=v_task.id;
  return true;
end;
$$;

revoke all on function public.compute_accept_nonce(text,text,timestamptz) from public, anon, authenticated;
revoke all on function public.compute_claim_task(text,text[],text[],integer) from public, anon, authenticated;
revoke all on function public.compute_start_lease(text,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.compute_heartbeat_lease(text,uuid,text,jsonb,integer) from public, anon, authenticated;
revoke all on function public.compute_complete_lease(text,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.compute_fail_lease(text,uuid,text,text,boolean) from public, anon, authenticated;

grant execute on function public.compute_accept_nonce(text,text,timestamptz) to service_role;
grant execute on function public.compute_claim_task(text,text[],text[],integer) to service_role;
grant execute on function public.compute_start_lease(text,uuid,text,integer) to service_role;
grant execute on function public.compute_heartbeat_lease(text,uuid,text,jsonb,integer) to service_role;
grant execute on function public.compute_complete_lease(text,uuid,text,jsonb) to service_role;
grant execute on function public.compute_fail_lease(text,uuid,text,text,boolean) to service_role;
