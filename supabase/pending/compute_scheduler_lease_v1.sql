-- PENDING ONLY. Owner review, isolated SQL proof and explicit migration approval
-- are required before applying this to canonical Supabase. No ledger entry here.
--
-- Compute scheduler lease (docs/control-plane/DEVICE-JOBS-SCHEDULER-STANDBY.md).
--
-- The compute fabric has one scheduler: the McCluster Core compute gateway
-- claiming and handing out device leases over Supabase. This file makes "which
-- Core instance is the scheduler" a durable, fenced fact instead of an
-- assumption, so the OVH Core can be the normal (primary) scheduler and the
-- owner's Windows box can stand by with the same shared job state.
--
-- Design:
--   * One row per org in public.ops_compute_scheduler_leases. The holder's
--     authority is (holder_id, term). The term is a fencing token: it only ever
--     increases, and it increases on every change of holder.
--   * Exactly one holder is live per org: the row holder, while expires_at is
--     in the future and released_at is null. Everything else is a candidate.
--   * A candidate takes over ONLY when the row is expired or released, or when
--     the live holder named it in handover_to and that grace window is open.
--     Nobody preempts a live holder. A primary never preempts a live standby;
--     a standby never preempts a live primary.
--   * The old holder is fenced the moment the term moves: its renew, release
--     and handover calls answer ok=false reason 'fenced' with the live holder,
--     and the Core steps down on that answer (scheduler-election.mjs).
--   * Every RPC locks the org row FOR UPDATE first and reads
--     clock_timestamp() AFTER the lock, so a call that waited behind another
--     writer judges expiry at the time it actually runs.
--   * TTL is clamped to 10..300 seconds; the handover grace to 10..900.
--   * history keeps the last 20 transitions (fresh, expired_takeover,
--     handover_requested, handover, released). Renewals are not recorded.
--   * Supabase is the shared job state already (ops_compute_tasks/leases); the
--     standby holds no private state. This file adds no second queue.
--   * Writes happen only through the service_role RPCs. The table grants
--     select to service_role for diagnostics and nothing to anyone else.

create table if not exists public.ops_compute_scheduler_leases (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  holder_id text not null check (holder_id ~ '^[a-z0-9][a-z0-9._-]{0,78}$'),
  holder_role text not null check (holder_role in ('primary','standby')),
  term bigint not null check (term >= 1),
  acquired_at timestamptz not null,
  renewed_at timestamptz not null,
  expires_at timestamptz not null,
  handover_to text check (handover_to is null or handover_to ~ '^[a-z0-9][a-z0-9._-]{0,78}$'),
  handover_requested_at timestamptz,
  handover_expires_at timestamptz,
  released_at timestamptz,
  updated_at timestamptz not null default now(),
  history jsonb not null default '[]'::jsonb
);

alter table public.ops_compute_scheduler_leases enable row level security;
revoke all on public.ops_compute_scheduler_leases from public, anon, authenticated;
grant select on public.ops_compute_scheduler_leases to service_role;

-- Internal helper: append one transition and keep the last 20. Not an RPC;
-- nobody may execute it directly (the definer RPCs below call it).
create or replace function public.compute_scheduler_history_push(
  p_history jsonb, p_at timestamptz, p_event text, p_from_holder text, p_to_holder text, p_term bigint
) returns jsonb
language sql immutable
set search_path = public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(e order by ord), '[]'::jsonb)
    from (
      select e, ord
        from jsonb_array_elements(
          coalesce(p_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'at', p_at, 'event', p_event, 'from_holder', p_from_holder, 'to_holder', p_to_holder, 'term', p_term))
        ) with ordinality as t(e, ord)
       order by ord desc
       limit 20
    ) s;
$$;
revoke all on function public.compute_scheduler_history_push(jsonb,timestamptz,text,text,text,bigint) from public, anon, authenticated, service_role;

-- a) acquire: fresh | renewed | expired_takeover | handover | held
create or replace function public.compute_scheduler_acquire(
  p_org_id uuid,
  p_holder_id text,
  p_holder_role text,
  p_ttl_seconds integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.ops_compute_scheduler_leases%rowtype;
  v_now timestamptz;
  v_ttl integer := greatest(10, least(coalesce(p_ttl_seconds, 30), 300));
  v_expired boolean;
  v_reason text;
  v_term bigint;
begin
  if p_org_id is null then raise exception 'p_org_id is required'; end if;
  if p_holder_id is null or p_holder_id !~ '^[a-z0-9][a-z0-9._-]{0,78}$' then raise exception 'invalid holder id'; end if;
  if p_holder_role is null or p_holder_role not in ('primary','standby') then raise exception 'invalid holder role'; end if;

  select * into v_row from public.ops_compute_scheduler_leases where org_id = p_org_id for update;
  if not found then
    -- Two fresh candidates can race the insert; the loser re-reads under lock
    -- and falls through to the ordinary rules against the winner's row.
    v_now := clock_timestamp();
    insert into public.ops_compute_scheduler_leases(org_id, holder_id, holder_role, term, acquired_at, renewed_at, expires_at, updated_at, history)
      values (p_org_id, p_holder_id, p_holder_role, 1, v_now, v_now, v_now + make_interval(secs => v_ttl), v_now,
              public.compute_scheduler_history_push('[]'::jsonb, v_now, 'fresh', null, p_holder_id, 1))
      on conflict (org_id) do nothing
      returning * into v_row;
    if found then
      return jsonb_build_object('active', true, 'holder_id', v_row.holder_id, 'holder_role', v_row.holder_role, 'term', v_row.term,
        'expires_at', v_row.expires_at, 'server_time', v_now, 'reason', 'fresh', 'handover_to', null);
    end if;
    select * into strict v_row from public.ops_compute_scheduler_leases where org_id = p_org_id for update;
  end if;

  v_now := clock_timestamp(); -- evaluated AFTER the lock wait
  v_expired := v_row.released_at is not null or v_row.expires_at <= v_now;

  if v_row.holder_id = p_holder_id and not v_expired then
    update public.ops_compute_scheduler_leases
       set renewed_at = v_now, expires_at = v_now + make_interval(secs => v_ttl), holder_role = p_holder_role, updated_at = v_now
     where org_id = p_org_id
     returning * into v_row;
    return jsonb_build_object('active', true, 'holder_id', v_row.holder_id, 'holder_role', v_row.holder_role, 'term', v_row.term,
      'expires_at', v_row.expires_at, 'server_time', v_now, 'reason', 'renewed',
      'handover_to', case when v_row.handover_expires_at > v_now then v_row.handover_to else null end);
  end if;

  if v_expired then
    v_reason := 'expired_takeover';
  elsif v_row.handover_to = p_holder_id and v_row.handover_expires_at > v_now then
    v_reason := 'handover';
  else
    return jsonb_build_object('active', false, 'holder_id', v_row.holder_id, 'holder_role', v_row.holder_role, 'term', v_row.term,
      'expires_at', v_row.expires_at, 'server_time', v_now, 'reason', 'held',
      'handover_to', case when v_row.handover_expires_at > v_now then v_row.handover_to else null end);
  end if;

  v_term := v_row.term + 1;
  update public.ops_compute_scheduler_leases
     set holder_id = p_holder_id, holder_role = p_holder_role, term = v_term,
         acquired_at = v_now, renewed_at = v_now, expires_at = v_now + make_interval(secs => v_ttl),
         handover_to = null, handover_requested_at = null, handover_expires_at = null,
         released_at = null, updated_at = v_now,
         history = public.compute_scheduler_history_push(history, v_now, v_reason, v_row.holder_id, p_holder_id, v_term)
   where org_id = p_org_id
   returning * into v_row;
  return jsonb_build_object('active', true, 'holder_id', v_row.holder_id, 'holder_role', v_row.holder_role, 'term', v_row.term,
    'expires_at', v_row.expires_at, 'server_time', v_now, 'reason', v_reason, 'handover_to', null);
end;
$$;

-- b) renew: ok only for the live (holder, term); otherwise fenced
create or replace function public.compute_scheduler_renew(
  p_org_id uuid,
  p_holder_id text,
  p_term bigint,
  p_ttl_seconds integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.ops_compute_scheduler_leases%rowtype;
  v_now timestamptz;
  v_ttl integer := greatest(10, least(coalesce(p_ttl_seconds, 30), 300));
begin
  select * into v_row from public.ops_compute_scheduler_leases where org_id = p_org_id for update;
  v_now := clock_timestamp();
  if not found then
    return jsonb_build_object('ok', false, 'holder_id', null, 'term', null, 'expires_at', null, 'server_time', v_now, 'reason', 'fenced', 'handover_to', null);
  end if;
  if v_row.holder_id = p_holder_id and v_row.term = p_term and v_row.released_at is null and v_row.expires_at > v_now then
    update public.ops_compute_scheduler_leases
       set renewed_at = v_now, expires_at = v_now + make_interval(secs => v_ttl), updated_at = v_now
     where org_id = p_org_id
     returning * into v_row;
    return jsonb_build_object('ok', true, 'holder_id', v_row.holder_id, 'term', v_row.term, 'expires_at', v_row.expires_at,
      'server_time', v_now, 'reason', 'renewed',
      'handover_to', case when v_row.handover_expires_at > v_now then v_row.handover_to else null end);
  end if;
  return jsonb_build_object('ok', false, 'holder_id', v_row.holder_id, 'term', v_row.term, 'expires_at', v_row.expires_at,
    'server_time', v_now, 'reason', 'fenced', 'handover_to', null);
end;
$$;

-- c) release: voluntary step-down by the (holder, term)
create or replace function public.compute_scheduler_release(
  p_org_id uuid,
  p_holder_id text,
  p_term bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.ops_compute_scheduler_leases%rowtype;
  v_now timestamptz;
begin
  select * into v_row from public.ops_compute_scheduler_leases where org_id = p_org_id for update;
  v_now := clock_timestamp();
  if not found or v_row.holder_id <> p_holder_id or v_row.term <> p_term then
    return jsonb_build_object('ok', false, 'reason', 'fenced', 'holder_id', v_row.holder_id, 'term', v_row.term, 'server_time', v_now);
  end if;
  if v_row.released_at is not null then
    return jsonb_build_object('ok', true, 'reason', 'released', 'term', v_row.term, 'server_time', v_now);
  end if;
  update public.ops_compute_scheduler_leases
     set released_at = v_now, expires_at = v_now, updated_at = v_now,
         handover_to = null, handover_requested_at = null, handover_expires_at = null,
         history = public.compute_scheduler_history_push(history, v_now, 'released', p_holder_id, null, v_row.term)
   where org_id = p_org_id;
  return jsonb_build_object('ok', true, 'reason', 'released', 'term', v_row.term, 'server_time', v_now);
end;
$$;

-- d) handover: the live holder names its successor for a grace window
create or replace function public.compute_scheduler_handover(
  p_org_id uuid,
  p_holder_id text,
  p_term bigint,
  p_to_holder_id text,
  p_grace_seconds integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.ops_compute_scheduler_leases%rowtype;
  v_now timestamptz;
  v_grace integer := greatest(10, least(coalesce(p_grace_seconds, 120), 900));
begin
  select * into v_row from public.ops_compute_scheduler_leases where org_id = p_org_id for update;
  v_now := clock_timestamp();
  if not found or v_row.holder_id <> p_holder_id or v_row.term <> p_term or v_row.released_at is not null or v_row.expires_at <= v_now then
    return jsonb_build_object('ok', false, 'reason', 'fenced', 'handover_to', null, 'handover_expires_at', null,
      'holder_id', v_row.holder_id, 'term', v_row.term, 'server_time', v_now);
  end if;
  if p_to_holder_id is null or p_to_holder_id = p_holder_id or p_to_holder_id !~ '^[a-z0-9][a-z0-9._-]{0,78}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'handover_to', null, 'handover_expires_at', null,
      'holder_id', v_row.holder_id, 'term', v_row.term, 'server_time', v_now);
  end if;
  update public.ops_compute_scheduler_leases
     set handover_to = p_to_holder_id, handover_requested_at = v_now,
         handover_expires_at = v_now + make_interval(secs => v_grace), updated_at = v_now,
         history = public.compute_scheduler_history_push(history, v_now, 'handover_requested', p_holder_id, p_to_holder_id, v_row.term)
   where org_id = p_org_id
   returning * into v_row;
  return jsonb_build_object('ok', true, 'reason', 'handover_requested', 'handover_to', v_row.handover_to,
    'handover_expires_at', v_row.handover_expires_at, 'holder_id', v_row.holder_id, 'term', v_row.term, 'server_time', v_now);
end;
$$;

-- e) status: the row plus a computed 'live'; null when no row
create or replace function public.compute_scheduler_status(
  p_org_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_row public.ops_compute_scheduler_leases%rowtype;
  v_now timestamptz;
begin
  select * into v_row from public.ops_compute_scheduler_leases where org_id = p_org_id for update;
  v_now := clock_timestamp();
  if not found then return null; end if;
  return to_jsonb(v_row) || jsonb_build_object(
    'live', v_row.released_at is null and v_row.expires_at > v_now,
    'handover_pending', v_row.handover_to is not null and v_row.handover_expires_at > v_now,
    'server_time', v_now);
end;
$$;

revoke all on function public.compute_scheduler_acquire(uuid,text,text,integer) from public, anon, authenticated;
revoke all on function public.compute_scheduler_renew(uuid,text,bigint,integer) from public, anon, authenticated;
revoke all on function public.compute_scheduler_release(uuid,text,bigint) from public, anon, authenticated;
revoke all on function public.compute_scheduler_handover(uuid,text,bigint,text,integer) from public, anon, authenticated;
revoke all on function public.compute_scheduler_status(uuid) from public, anon, authenticated;
grant execute on function public.compute_scheduler_acquire(uuid,text,text,integer) to service_role;
grant execute on function public.compute_scheduler_renew(uuid,text,bigint,integer) to service_role;
grant execute on function public.compute_scheduler_release(uuid,text,bigint) to service_role;
grant execute on function public.compute_scheduler_handover(uuid,text,bigint,text,integer) to service_role;
grant execute on function public.compute_scheduler_status(uuid) to service_role;
