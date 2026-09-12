-- Production hardening for compute task submission.
-- Retries with the same Idempotency-Key return the original task; reusing a
-- key with a different normalized request fails closed.

alter table public.ops_compute_tasks
  add column if not exists idempotency_key text,
  add column if not exists request_hash text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ops_compute_tasks_idempotency_key_check'
      and conrelid = 'public.ops_compute_tasks'::regclass
  ) then
    alter table public.ops_compute_tasks
      add constraint ops_compute_tasks_idempotency_key_check
      check (idempotency_key is null or idempotency_key ~ '^[!-~]{1,128}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'ops_compute_tasks_request_hash_check'
      and conrelid = 'public.ops_compute_tasks'::regclass
  ) then
    alter table public.ops_compute_tasks
      add constraint ops_compute_tasks_request_hash_check
      check (request_hash is null or request_hash ~ '^[a-f0-9]{64}$');
  end if;
end;
$$;

create unique index if not exists ops_compute_tasks_org_idempotency_uidx
  on public.ops_compute_tasks(org_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.compute_enqueue_task(
  p_org_id uuid,
  p_capability text,
  p_implementation text,
  p_input jsonb,
  p_requirements jsonb,
  p_priority integer,
  p_run_after timestamptz,
  p_max_attempts integer,
  p_metadata jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task public.ops_compute_tasks%rowtype;
  v_priority integer := coalesce(p_priority, 0);
  v_max_attempts integer := greatest(1, least(coalesce(p_max_attempts, 3), 100));
  v_input jsonb := coalesce(p_input, '{}'::jsonb);
  v_requirements jsonb := coalesce(p_requirements, '{}'::jsonb);
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_request_hash text;
begin
  if p_org_id is null then raise exception 'org_id is required'; end if;
  if p_capability is null or p_capability !~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$' then
    raise exception 'invalid compute capability';
  end if;
  if jsonb_typeof(v_input) <> 'object' or jsonb_typeof(v_requirements) <> 'object' or jsonb_typeof(v_metadata) <> 'object' then
    raise exception 'input, requirements and metadata must be JSON objects';
  end if;
  if p_idempotency_key is not null and p_idempotency_key !~ '^[!-~]{1,128}$' then
    raise exception 'invalid idempotency key';
  end if;

  v_request_hash := encode(digest(convert_to(jsonb_build_object(
    'capability', p_capability,
    'implementation', p_implementation,
    'input', v_input,
    'requirements', v_requirements,
    'priority', v_priority,
    'run_after', p_run_after,
    'max_attempts', v_max_attempts,
    'metadata', v_metadata
  )::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.ops_compute_tasks(
    org_id, capability, implementation, input, requirements, priority,
    run_after, max_attempts, metadata, idempotency_key, request_hash
  ) values (
    p_org_id, p_capability, p_implementation, v_input, v_requirements, v_priority,
    coalesce(p_run_after, now()), v_max_attempts, v_metadata, p_idempotency_key, v_request_hash
  )
  on conflict (org_id, idempotency_key) where idempotency_key is not null do nothing
  returning * into v_task;

  if found then
    return jsonb_build_object(
      'task', to_jsonb(v_task) - 'request_hash',
      'replayed', false,
      'conflict', false
    );
  end if;

  select * into v_task
    from public.ops_compute_tasks
   where org_id = p_org_id
     and idempotency_key = p_idempotency_key;

  if not found then
    raise exception 'idempotent compute enqueue could not resolve existing task';
  end if;

  if v_task.request_hash is distinct from v_request_hash then
    return jsonb_build_object(
      'task', jsonb_build_object('id', v_task.id),
      'replayed', false,
      'conflict', true
    );
  end if;

  return jsonb_build_object(
    'task', to_jsonb(v_task) - 'request_hash',
    'replayed', true,
    'conflict', false
  );
end;
$$;

revoke all on function public.compute_enqueue_task(uuid,text,text,jsonb,jsonb,integer,timestamptz,integer,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.compute_enqueue_task(uuid,text,text,jsonb,jsonb,integer,timestamptz,integer,jsonb,text)
  to service_role;
