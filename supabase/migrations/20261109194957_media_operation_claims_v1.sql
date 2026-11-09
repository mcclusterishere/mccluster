-- Atomic paid-operation claims for the media router
-- (workers/mccluster/src/media/router.js createGeneration).
-- Audit 2026-11-09 finding C5, remaining work: the transport nonce store
-- (core_signed_nonces_v1, applied 20261109180829) stops a captured signed
-- envelope from being accepted twice, but the router's operation dedupe was
-- check-then-create: two concurrent calls carrying the same stable
-- operation_id (a Core retry with a fresh signature, two isolates, a client
-- retry) each found no job, each reserved budget and each submitted to the
-- provider. A unique insert here is the atomic claim: exactly one caller wins
-- the right to reserve and submit; every other caller gets the winner's
-- durable outcome (the bound job id) or a "pending" answer it can read back.
-- Reusing an operation id with a different request body is refused.
-- Service-role only; no anon or authenticated grant. Pending: not applied.
create table if not exists public.media_operation_claims (
  org_id uuid not null,
  operation_id text not null,
  fingerprint text not null,
  actor_id uuid,
  operation_type text not null default 'media.generate',
  state text not null default 'claimed'
    check (state in ('claimed', 'bound', 'failed')),
  job_id uuid references public.media_jobs(id) on delete set null,
  failure jsonb,
  claimed_at timestamptz not null default now(),
  bound_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (org_id, operation_id)
);
create index if not exists media_operation_claims_job_idx on public.media_operation_claims (job_id);
alter table public.media_operation_claims enable row level security;
revoke all on public.media_operation_claims from anon, authenticated;
comment on table public.media_operation_claims is
  'One row per (org, operation_id): the atomic winner/loser decision for a paid media operation. Terminal rows are kept as evidence; a deliberate new attempt uses a new operation id.';

-- Claim: returns {"outcome":"won"} for the first caller, otherwise the
-- existing row as {"outcome":"existing","claim":{...}}. A different
-- fingerprint for the same (org, operation_id) raises 23505-adjacent
-- application error P0001 'operation_payload_mismatch' and changes nothing.
create or replace function public.media_claim_operation_v1(
  p_org_id uuid,
  p_operation_id text,
  p_fingerprint text,
  p_actor_id uuid default null,
  p_operation_type text default 'media.generate'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.media_operation_claims;
begin
  if p_org_id is null or p_operation_id is null or p_fingerprint is null then
    raise exception using errcode = '22023', message = 'org_id, operation_id and fingerprint are required';
  end if;
  insert into public.media_operation_claims (org_id, operation_id, fingerprint, actor_id, operation_type)
  values (p_org_id, p_operation_id, p_fingerprint, p_actor_id, coalesce(p_operation_type, 'media.generate'))
  on conflict (org_id, operation_id) do nothing
  returning * into v_row;
  if found then
    return jsonb_build_object('outcome', 'won', 'claim', to_jsonb(v_row));
  end if;
  select * into v_row from public.media_operation_claims
  where org_id = p_org_id and operation_id = p_operation_id;
  if v_row.fingerprint is distinct from p_fingerprint then
    raise exception using errcode = 'P0001', message = 'operation_payload_mismatch';
  end if;
  return jsonb_build_object('outcome', 'existing', 'claim', to_jsonb(v_row));
end;
$$;

-- Bind: the winner records the job its reservation produced. Only a
-- 'claimed' row can be bound, exactly once.
create or replace function public.media_bind_operation_v1(
  p_org_id uuid,
  p_operation_id text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.media_operation_claims;
begin
  update public.media_operation_claims
  set job_id = p_job_id, state = 'bound', bound_at = now(), updated_at = now()
  where org_id = p_org_id and operation_id = p_operation_id and state = 'claimed'
  returning * into v_row;
  if not found then
    raise exception using errcode = 'P0001', message = 'operation_not_claimed';
  end if;
  return to_jsonb(v_row);
end;
$$;

-- Fail: a DEFINITE failure before any reservation existed (validation, budget
-- preflight, reservation RPC refused). The row stays as evidence so a loser
-- reads the same refusal instead of reserving a second time. An uncertain
-- provider outcome is never recorded here: that job keeps its reservation and
-- the claim stays bound to it.
create or replace function public.media_fail_operation_v1(
  p_org_id uuid,
  p_operation_id text,
  p_failure jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.media_operation_claims;
begin
  update public.media_operation_claims
  set state = 'failed', failure = coalesce(p_failure, '{}'::jsonb), updated_at = now()
  where org_id = p_org_id and operation_id = p_operation_id and state = 'claimed'
  returning * into v_row;
  if not found then
    raise exception using errcode = 'P0001', message = 'operation_not_claimed';
  end if;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.media_claim_operation_v1(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.media_bind_operation_v1(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.media_fail_operation_v1(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.media_claim_operation_v1(uuid, text, text, uuid, text) to service_role;
grant execute on function public.media_bind_operation_v1(uuid, text, uuid) to service_role;
grant execute on function public.media_fail_operation_v1(uuid, text, jsonb) to service_role;
