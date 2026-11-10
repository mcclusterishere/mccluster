-- Recovery for paid media operations (audit 2026-11-09, finding C5, recovery
-- lane): repair, takeover, a guarded release, the operator decision and the
-- read-only candidate list the media router and its cron sweep call
-- (workers/mccluster/src/media/router.js, recovery.js).
--
-- ADDITIVE on supabase/migrations/20261109194957_media_operation_claims_v1.sql
-- (applied in production, frozen): v1's table, its state check
-- ('claimed','bound','failed') and its three RPCs are not touched, and neither
-- are 0053 (media_create_budgeted_job_v2, media_record_actual_cost_v2) or 0054
-- (media_release_cost_reservation). Every object here is new; the rollback
-- drops only these. Service-role only; no anon or authenticated grant.
-- Pending: not applied.
--
-- APPLY AS ONE TRANSACTION (psql --single-transaction, or the migration
-- runner's own transaction): the two guards below stop the whole file before
-- any index is built. The unique indexes are built without CONCURRENTLY, so
-- writes to media_jobs wait while they build (the table is small).
--
-- ORDER IS LOAD-BEARING:
--   forward:  apply this file BEFORE the Worker that calls the v2 names ships.
--             A Worker deployed first answers 503 operation_claims_unavailable
--             for every generation that carries an operation id (nothing is
--             reserved) and 503 recovery_unavailable on the operator routes.
--   backward: roll the Worker back BEFORE media_operation_claims_v2.rollback.sql.
--
-- Run these three read-only queries on the target first. The first two must
-- return no rows (resolve any row they return through the normal RPCs, never
-- by deleting a job); the third must return NO (the router writes error '{}',
-- never null):
--   select org_id, routing ->> 'operation_id' as operation_id, count(*)
--     from public.media_jobs where routing ->> 'operation_id' is not null
--     group by 1, 2 having count(*) > 1;
--   select provider, provider_request_id, count(*)
--     from public.media_jobs where provider_request_id is not null
--     group by 1, 2 having count(*) > 1;
--   select is_nullable from information_schema.columns
--     where table_schema = 'public' and table_name = 'media_jobs' and column_name = 'error';
--
-- Proof: scripts/test-media-recovery-db.sh (disposable PostgreSQL 16: the
-- applied chain, v1, this file twice, supabase/tests/media_operation_claims_v2.behaviour.sql,
-- the rollback, this file again, both guards).
--
-- What it adds, and the invariant each one closes:
--   1. media_jobs: UNIQUE (org_id, routing->>'operation_id') where present.
--      At most one job (one reservation) per (org, operation id), structurally.
--   2. media_jobs: UNIQUE (provider, provider_request_id) where present.
--      One provider request belongs to one job.
--   3. media_jobs: a partial index for the cron sweep's "open fal jobs with a
--      request id, oldest update first" read.
--   4. media_operation_claims: attempt, history, resolved_at, resolution.
--      Evidence of takeovers and repairs; v1's eleven columns are unchanged.
--   5. media_bind_operation_v2: idempotent bind by job identity (the job must
--      carry this operation id), so a loser's repair and the winner's bind
--      cannot fail each other; 'failed' -> 'bound' only through this repair;
--      a bound claim whose job row is gone is rebound.
--   6. media_claim_operation_v2: v1's claim, plus REPAIR (a claim whose
--      operation already has a job is bound to it) and TAKEOVER (a claim with
--      no job anywhere, older than p_expire_after, is re-claimed by the next
--      caller with the SAME fingerprint). A row whose job exists is never
--      taken over; a different fingerprint is refused before either.
--   7. media_fail_operation_v2: v1's fail, by the CURRENT attempt only, and
--      refused once a job exists for the operation (a reservation can never
--      hide behind a failed claim).
--   8. media_release_cost_reservation_v2: 0054's release, refused after
--      settlement, a no-op when already released, optionally conditional on
--      the job's status; returns what it did.
--   9. media_resolve_operation_job_v1: the operator decision (release, settle,
--      bind), bound to the job's organization, recorded on the job row.
--  10. media_operation_recovery_candidates_v1: read-only classification of
--      stuck claims and jobs for the operator surface and the cron evidence.

-- 1. one job per (org, operation id) ------------------------------------------
do $guard$
begin
  if exists (
    select 1 from public.media_jobs
    where routing ->> 'operation_id' is not null
    group by org_id, routing ->> 'operation_id'
    having count(*) > 1
  ) then
    raise exception using errcode = '23505',
      message = 'media_jobs holds more than one job for one (org_id, operation_id); resolve those rows before applying media_operation_claims_v2';
  end if;
end
$guard$;
create unique index if not exists media_jobs_org_operation_uidx
  on public.media_jobs (org_id, (routing ->> 'operation_id'))
  where routing ->> 'operation_id' is not null;

-- 2. one job per provider request ---------------------------------------------
do $guard$
begin
  if exists (
    select 1 from public.media_jobs
    where provider_request_id is not null
    group by provider, provider_request_id
    having count(*) > 1
  ) then
    raise exception using errcode = '23505',
      message = 'media_jobs holds more than one job for one (provider, provider_request_id); resolve those rows before applying media_operation_claims_v2';
  end if;
end
$guard$;
create unique index if not exists media_jobs_provider_request_uidx
  on public.media_jobs (provider, provider_request_id)
  where provider_request_id is not null;

-- 3. the sweep's read ---------------------------------------------------------
create index if not exists media_jobs_fal_open_updated_idx
  on public.media_jobs (updated_at)
  where provider = 'fal' and provider_request_id is not null
    and status in ('queued', 'running', 'reconciling');

-- 4. claim evidence columns ---------------------------------------------------
alter table public.media_operation_claims
  add column if not exists attempt integer not null default 1,
  add column if not exists history jsonb not null default '[]'::jsonb,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution jsonb;
create index if not exists media_operation_claims_claimed_idx
  on public.media_operation_claims (claimed_at) where state = 'claimed';
comment on column public.media_operation_claims.attempt is
  'Incremented by a takeover (media_claim_operation_v2): a claim with no job after the expiry window, re-claimed by a same-fingerprint caller. The winner passes it back to media_fail_operation_v2 so a superseded attempt cannot fail the current one.';
comment on column public.media_operation_claims.history is
  'Superseded attempts, appended by takeovers: {attempt, actor_id, claimed_at, bound_at, superseded_at, reason}.';
comment on column public.media_operation_claims.resolved_at is
  'When a repair last changed this claim (late bind or rebind). Null for a claim the winner bound itself.';
comment on column public.media_operation_claims.resolution is
  'Repair evidence: {kind: late_bind | rebind, at, prior_state, prior_failure, by, actor_id, ...}. Null for a claim the winner bound itself.';

-- 5. bind, idempotent, by job identity ----------------------------------------
create or replace function public.media_bind_operation_v2(
  p_org_id uuid,
  p_operation_id text,
  p_job_id uuid,
  p_note jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.media_operation_claims;
  v_job public.media_jobs;
  v_prior text;
  v_rebind boolean;
begin
  if p_org_id is null or p_operation_id is null or p_job_id is null then
    raise exception using errcode = '22023', message = 'org_id, operation_id and job_id are required';
  end if;
  select * into v_job from public.media_jobs where id = p_job_id;
  if not found
     or v_job.org_id is distinct from p_org_id
     or (v_job.routing ->> 'operation_id') is distinct from p_operation_id then
    raise exception using errcode = 'P0001', message = 'job_not_for_operation';
  end if;
  select * into v_row from public.media_operation_claims
  where org_id = p_org_id and operation_id = p_operation_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'operation_not_claimed';
  end if;
  if v_row.state = 'bound' and v_row.job_id is not null then
    if v_row.job_id = p_job_id then
      return jsonb_build_object('outcome', 'already_bound', 'claim', to_jsonb(v_row));
    end if;
    raise exception using errcode = 'P0001', message = 'operation_bound_elsewhere';
  end if;
  v_prior := v_row.state;
  /* bound with job_id null: the job row this claim pointed at is gone (the
     foreign key set it null) and the operation has a job again. */
  v_rebind := v_prior = 'bound';
  update public.media_operation_claims
  set job_id = p_job_id,
      state = 'bound',
      bound_at = now(),
      updated_at = now(),
      resolution = case
        when v_rebind then
          coalesce(resolution, '{}'::jsonb)
          || jsonb_build_object('kind', 'rebind', 'at', now(), 'prior_state', 'bound')
          || coalesce(p_note, '{}'::jsonb)
        when v_prior = 'failed' or p_note is not null then
          coalesce(resolution, '{}'::jsonb)
          || jsonb_build_object('kind', 'late_bind', 'at', now(), 'prior_state', v_prior, 'prior_failure', v_row.failure)
          || coalesce(p_note, '{}'::jsonb)
        else resolution end,
      resolved_at = case when v_rebind or v_prior = 'failed' or p_note is not null then now() else resolved_at end
  where org_id = p_org_id and operation_id = p_operation_id
  returning * into v_row;
  return jsonb_build_object(
    'outcome', case when v_prior = 'claimed' and p_note is null then 'bound' else 'repaired' end,
    'claim', to_jsonb(v_row)
  );
end;
$$;

-- 6. claim + repair + takeover ------------------------------------------------
create or replace function public.media_claim_operation_v2(
  p_org_id uuid,
  p_operation_id text,
  p_fingerprint text,
  p_actor_id uuid default null,
  p_operation_type text default 'media.generate',
  p_expire_after interval default interval '15 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.media_operation_claims;
  v_job_id uuid;
  v_bound jsonb;
  v_open boolean;
  v_since timestamptz;
  v_window interval := coalesce(p_expire_after, interval '15 minutes');
begin
  if p_org_id is null or p_operation_id is null or p_fingerprint is null then
    raise exception using errcode = '22023', message = 'org_id, operation_id and fingerprint are required';
  end if;
  insert into public.media_operation_claims (org_id, operation_id, fingerprint, actor_id, operation_type)
  values (p_org_id, p_operation_id, p_fingerprint, p_actor_id, coalesce(p_operation_type, 'media.generate'))
  on conflict (org_id, operation_id) do nothing
  returning * into v_row;
  if found then
    return jsonb_build_object('outcome', 'won', 'attempt', v_row.attempt, 'claim', to_jsonb(v_row));
  end if;

  select * into v_row from public.media_operation_claims
  where org_id = p_org_id and operation_id = p_operation_id
  for update;
  if not found then
    /* Only the v1 rollback removes claim rows. The caller fails closed. */
    raise exception using errcode = 'P0001', message = 'operation_claim_unavailable';
  end if;
  if v_row.fingerprint is distinct from p_fingerprint then
    raise exception using errcode = 'P0001', message = 'operation_payload_mismatch';
  end if;

  /* Open: the winner has not produced a job this claim can name. Either it
     is still 'claimed', or it is 'bound' to a job row that no longer exists. */
  v_open := v_row.state = 'claimed' or (v_row.state = 'bound' and v_row.job_id is null);

  /* Repair: the operation already has a job (the winner reserved it and then
     stopped before the bind, or a failure was recorded although the
     reservation had committed). The job is the truth; bind it so every
     reader gets it. */
  if v_open or v_row.state = 'failed' then
    select id into v_job_id from public.media_jobs
    where org_id = p_org_id and routing ->> 'operation_id' = p_operation_id
    order by created_at asc limit 1;
    if v_job_id is not null then
      v_bound := public.media_bind_operation_v2(p_org_id, p_operation_id, v_job_id,
        jsonb_build_object('by', 'media_claim_operation_v2', 'actor_id', p_actor_id));
      return jsonb_build_object('outcome', 'existing', 'repaired', true, 'claim', v_bound -> 'claim');
    end if;
  end if;

  /* Takeover: open, no job anywhere, older than the window. The same
     fingerprint (checked above) re-claims the same id; the superseded attempt
     stays in history. No money exists for it: no job means no reservation. */
  v_since := coalesce(v_row.bound_at, v_row.claimed_at);
  if v_open and v_since < now() - v_window then
    update public.media_operation_claims
    set state = 'claimed',
        job_id = null,
        bound_at = null,
        attempt = attempt + 1,
        actor_id = p_actor_id,
        claimed_at = now(),
        updated_at = now(),
        history = history || jsonb_build_object(
          'attempt', v_row.attempt, 'actor_id', v_row.actor_id, 'claimed_at', v_row.claimed_at,
          'bound_at', v_row.bound_at, 'superseded_at', now(),
          'reason', case when v_row.state = 'bound' then 'bound_job_missing' else 'expired_without_job' end)
    where org_id = p_org_id and operation_id = p_operation_id
    returning * into v_row;
    return jsonb_build_object('outcome', 'won', 'takeover', true, 'attempt', v_row.attempt, 'claim', to_jsonb(v_row));
  end if;

  return jsonb_build_object(
    'outcome', 'existing',
    'claim', to_jsonb(v_row),
    'expires_at', case when v_open then v_since + v_window end
  );
end;
$$;

-- 7. fail: definite, before any reservation, by the current attempt only ------
create or replace function public.media_fail_operation_v2(
  p_org_id uuid,
  p_operation_id text,
  p_failure jsonb,
  p_attempt integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.media_operation_claims;
begin
  if p_org_id is null or p_operation_id is null then
    raise exception using errcode = '22023', message = 'org_id and operation_id are required';
  end if;
  if p_attempt is null then
    raise exception using errcode = '22023', message = 'attempt is required';
  end if;
  select * into v_row from public.media_operation_claims
  where org_id = p_org_id and operation_id = p_operation_id
  for update;
  if not found or v_row.state <> 'claimed' then
    raise exception using errcode = 'P0001', message = 'operation_not_claimed';
  end if;
  if v_row.attempt <> p_attempt then
    raise exception using errcode = 'P0001', message = 'operation_attempt_superseded';
  end if;
  if exists (select 1 from public.media_jobs where org_id = p_org_id and routing ->> 'operation_id' = p_operation_id) then
    raise exception using errcode = 'P0001', message = 'operation_has_job';
  end if;
  update public.media_operation_claims
  set state = 'failed', failure = coalesce(p_failure, '{}'::jsonb), updated_at = now()
  where org_id = p_org_id and operation_id = p_operation_id
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- 8. release, guarded ---------------------------------------------------------
create or replace function public.media_release_cost_reservation_v2(
  p_job_id uuid,
  p_reason text default null,
  p_source text default 'mccluster-release',
  p_metadata jsonb default '{}'::jsonb,
  p_expect_status text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.media_jobs;
  v_reserved public.media_cost_events;
  v_released public.media_cost_events;
begin
  select * into v_job from public.media_jobs where id = p_job_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'Unknown media job';
  end if;
  /* The caller names the status it believes the job is in (the router: only
     'failed'). A job that moved on in the meantime keeps its reservation. */
  if p_expect_status is not null and not (v_job.status = any (p_expect_status)) then
    raise exception using errcode = 'P0001', message = 'job_status_mismatch',
      detail = format('status=%s', v_job.status);
  end if;
  if coalesce((v_job.routing ->> 'reservation_state') = 'settled', false)
     or exists (select 1 from public.media_cost_events where job_id = p_job_id and event_type = 'actual') then
    raise exception using errcode = 'P0001', message = 'reservation_already_settled';
  end if;
  select * into v_reserved from public.media_cost_events where job_id = p_job_id and event_type = 'reserved';
  if not found then
    return jsonb_build_object('released', false, 'reason', 'no_reservation', 'job_id', p_job_id);
  end if;
  select * into v_released from public.media_cost_events where job_id = p_job_id and event_type = 'released';
  if found then
    return jsonb_build_object('released', false, 'reason', 'already_released', 'job_id', p_job_id,
      'amount_usd_micros', v_released.amount_usd_micros, 'source', v_released.source);
  end if;
  insert into public.media_cost_events (
    org_id, job_id, event_type, amount_cents, amount_usd_micros, provider, provider_request_id,
    pricing_snapshot, quantity, unit, unit_price_usd_micros, pricing_version, source,
    raw_provider_usage, occurred_at, reconciled_at, metadata
  ) values (
    v_reserved.org_id, p_job_id, 'released', v_reserved.amount_cents, v_reserved.amount_usd_micros,
    v_reserved.provider, v_job.provider_request_id, v_reserved.pricing_snapshot, v_reserved.quantity,
    v_reserved.unit, v_reserved.unit_price_usd_micros, v_reserved.pricing_version,
    coalesce(p_source, 'mccluster-release'), '{}'::jsonb, now(), now(),
    jsonb_build_object('reason', p_reason, 'reserved_usd_micros', v_reserved.amount_usd_micros) || coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (job_id, event_type) do nothing;
  update public.media_jobs
  set routing = coalesce(routing, '{}'::jsonb) || jsonb_build_object(
        'reservation_state', 'released',
        'released_reserve_usd_micros', v_reserved.amount_usd_micros,
        'reservation_released_at', now()),
      updated_at = now()
  where id = p_job_id;
  return jsonb_build_object('released', true, 'job_id', p_job_id,
    'amount_usd_micros', v_reserved.amount_usd_micros, 'source', coalesce(p_source, 'mccluster-release'));
end;
$$;

-- 9. the operator decision ----------------------------------------------------
create or replace function public.media_resolve_operation_job_v1(
  p_org_id uuid,
  p_job_id uuid,
  p_decision text,
  p_actor_id uuid,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb,
  p_provider_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.media_jobs;
  v_last jsonb;
  v_history jsonb;
  v_outcome text;
  v_settled boolean;
  v_evidence boolean;
  v_given jsonb := coalesce(p_evidence, '{}'::jsonb);
  v_request_id text := nullif(btrim(coalesce(p_provider_request_id, '')), '');
  v_resolution jsonb;
  v_marks jsonb;
  v_release jsonb;
  v_bound jsonb;
  v_operation_id text;
  v_never_started boolean;
begin
  if p_decision is null or p_decision not in ('release', 'settle', 'bind') then
    raise exception using errcode = '22023', message = 'decision must be release, settle or bind';
  end if;
  if p_org_id is null or p_job_id is null or p_actor_id is null then
    raise exception using errcode = '22023', message = 'org_id, job_id and actor_id are required';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception using errcode = '22023', message = 'a reason is required';
  end if;
  if p_decision = 'settle' and v_request_id is null then
    raise exception using errcode = '22023', message = 'settle requires the provider request id';
  end if;

  select * into v_job from public.media_jobs where id = p_job_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'job_not_found';
  end if;
  if v_job.org_id is distinct from p_org_id then
    raise exception using errcode = 'P0001', message = 'job_not_in_org';
  end if;

  v_last := v_job.routing -> 'operator_resolution';
  v_history := coalesce(v_job.routing -> 'operator_resolution_history', '[]'::jsonb);
  v_outcome := v_job.provider_status ->> 'outcome';
  v_settled := coalesce((v_job.routing ->> 'reservation_state') = 'settled', false)
    or exists (select 1 from public.media_cost_events where job_id = p_job_id and event_type = 'actual');
  v_evidence := jsonb_typeof(v_given) = 'object' and v_given <> '{}'::jsonb;

  /* The same decision again answers with the decision already on record. */
  if v_last is not null and v_last ->> 'decision' = p_decision
     and (p_decision <> 'settle' or (v_last ->> 'provider_request_id') is not distinct from v_request_id) then
    return jsonb_build_object('outcome', 'already_resolved', 'job_id', p_job_id, 'resolution', v_last);
  end if;
  /* A different decision after one is on record: a release may be followed
     by a settle (the provider ran it after all); a settle may be followed by
     a release only once the attached request id is proven unknown (three
     consecutive provider 404s) and evidence is given; a bind restricts
     nothing. */
  if v_last is not null then
    if v_last ->> 'decision' = 'release' and p_decision = 'settle' then
      null;
    elsif v_last ->> 'decision' = 'settle' and p_decision = 'release' then
      if v_outcome is distinct from 'unknown_request' or not v_evidence then
        raise exception using errcode = 'P0001', message = 'release_after_settle_requires_unknown_request';
      end if;
    elsif v_last ->> 'decision' = 'bind' and p_decision in ('release', 'settle') then
      null;
    else
      raise exception using errcode = 'P0001', message = 'job_already_resolved';
    end if;
  end if;

  v_resolution := jsonb_build_object(
    'decision', p_decision, 'actor_id', p_actor_id, 'reason', p_reason, 'evidence', v_given,
    'at', now(), 'prior_status', v_job.status, 'prior_outcome', v_outcome,
    'prior_reservation_state', v_job.routing ->> 'reservation_state', 'prior_error', v_job.error,
    'provider_request_id', case when p_decision = 'settle' then v_request_id else v_job.provider_request_id end);
  v_marks := jsonb_build_object('operator_resolution', v_resolution, 'operator_resolution_history', v_history || v_resolution);

  if p_decision = 'bind' then
    v_operation_id := v_job.routing ->> 'operation_id';
    if v_operation_id is null then
      raise exception using errcode = '22023', message = 'job carries no operation_id';
    end if;
    v_bound := public.media_bind_operation_v2(p_org_id, v_operation_id, p_job_id,
      jsonb_build_object('by', 'operator', 'actor_id', p_actor_id, 'reason', p_reason));
    update public.media_jobs
    set routing = coalesce(routing, '{}'::jsonb) || v_marks, updated_at = now()
    where id = p_job_id;
    return jsonb_build_object('outcome', v_bound ->> 'outcome', 'job_id', p_job_id, 'status', v_job.status,
      'claim', v_bound -> 'claim', 'resolution', v_resolution);
  end if;

  /* release and settle move money or the provider handle */
  if v_settled then
    raise exception using errcode = 'P0001', message = 'reservation_already_settled';
  end if;
  /* A live provider request belongs to the refresh path (webhook, member
     read, cron sweep), never to an operator: only a failed job, or one whose
     request id the provider does not know, may be decided here. */
  if v_job.provider_request_id is not null and v_job.status <> 'failed'
     and v_outcome is distinct from 'unknown_request' then
    raise exception using errcode = 'P0001', message = 'job_has_provider_request';
  end if;
  if v_job.status not in ('queued', 'reconciling', 'failed') then
    raise exception using errcode = 'P0001', message = 'job_not_resolvable';
  end if;

  if p_decision = 'release' then
    /* Two states prove no provider request is running: a cas-v1 job that is
       still queued with no submit marker and no request id (the submit never
       started), and a job that already failed (a definite answer is on
       record). Anything else may have reached the provider: a person looks
       at the provider's own record first and what they saw is kept. */
    v_never_started := coalesce((v_job.routing ->> 'submit_protocol') = 'cas-v1', false)
      and v_job.provider_request_id is null and v_outcome is null and v_job.status = 'queued';
    if not v_never_started and v_job.status <> 'failed' and not v_evidence then
      raise exception using errcode = 'P0001', message = 'release_requires_evidence';
    end if;
    update public.media_jobs
    set status = 'failed',
        error = jsonb_build_object('message', p_reason, 'stage', 'recovery', 'decision', 'release'),
        provider_status = coalesce(provider_status, '{}'::jsonb)
          || jsonb_build_object('outcome', 'released_by_operator', 'released_at', now()),
        routing = coalesce(routing, '{}'::jsonb) || v_marks,
        updated_at = now()
    where id = p_job_id;
    v_release := public.media_release_cost_reservation_v2(
      p_job_id, p_reason, 'mccluster-operator-release',
      jsonb_build_object('actor_id', p_actor_id, 'evidence', v_given, 'decision', 'release'),
      array['failed']);
    return jsonb_build_object('outcome', 'released', 'job_id', p_job_id, 'status', 'failed',
      'release', v_release, 'resolution', v_resolution);
  end if;

  /* settle: attach the provider's request id and hand the job back to the
     refresh path, which fetches status and result by that id and settles the
     cost. Never writes a cost. A submit the provider definitely refused has
     no request to attach unless evidence says otherwise. */
  if v_job.status = 'failed'
     and (coalesce(v_outcome = 'submit_refused', false)
          or (coalesce((v_job.error ->> 'stage') = 'submit', false)
              and coalesce(v_job.error ->> 'uncertain', 'false') <> 'true'))
     and not v_evidence then
    raise exception using errcode = 'P0001', message = 'settle_requires_evidence';
  end if;
  if exists (
    select 1 from public.media_jobs
    where provider = v_job.provider and provider_request_id = v_request_id and id <> p_job_id
  ) then
    raise exception using errcode = 'P0001', message = 'provider_request_id_in_use';
  end if;
  begin
    update public.media_jobs
    set provider_request_id = v_request_id,
        submitted_at = coalesce(submitted_at, now()),
        status = 'queued',
        error = '{}'::jsonb,
        provider_status = (coalesce(provider_status, '{}'::jsonb) - 'unknown_request_count')
          || jsonb_build_object('outcome', 'attached_by_operator', 'attached_at', now(), 'request_id', v_request_id),
        routing = coalesce(routing, '{}'::jsonb) || v_marks,
        updated_at = now()
    where id = p_job_id;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'provider_request_id_in_use';
  end;
  return jsonb_build_object('outcome', 'settled', 'job_id', p_job_id, 'status', 'queued',
    'provider_request_id', v_request_id, 'resolution', v_resolution);
end;
$$;

-- 10. read-only recovery candidates -------------------------------------------
create or replace function public.media_operation_recovery_candidates_v1(
  p_org_id uuid default null,
  p_older_than interval default interval '15 minutes',
  p_limit integer default 50
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with params as (
    select coalesce(p_older_than, interval '15 minutes') as older_than
  ),
  open_claims as (
    select c.*,
           (select j.id from public.media_jobs j
            where j.org_id = c.org_id and j.routing ->> 'operation_id' = c.operation_id
            order by j.created_at asc limit 1) as job_by_routing
    from public.media_operation_claims c
    where (p_org_id is null or c.org_id = p_org_id)
      and (c.state in ('claimed', 'failed') or (c.state = 'bound' and c.job_id is null))
  ),
  jobs as (
    select j.id, j.org_id, j.provider, j.status, j.provider_request_id, j.created_at, j.updated_at,
           j.routing ->> 'operation_id' as operation_id,
           j.provider_status ->> 'outcome' as outcome,
           j.provider_status ->> 'attempted_at' as attempted_at,
           j.routing ->> 'submit_protocol' as submit_protocol,
           j.routing ->> 'reservation_state' as reservation_state,
           (select e.amount_usd_micros from public.media_cost_events e
            where e.job_id = j.id and e.event_type = 'reserved') as reserved_usd_micros,
           exists (select 1 from public.media_cost_events a
                   where a.job_id = j.id and a.event_type = 'actual') as has_actual
    from public.media_jobs j
    where (p_org_id is null or j.org_id = p_org_id)
  ),
  candidates as (
    -- C1: a claim with no job anywhere, past the window. No money exists.
    select 'claim_expired_without_job'::text as class, c.org_id, c.operation_id, null::uuid as job_id,
           null::text as status, null::text as outcome, null::text as provider_request_id,
           null::bigint as reserved_usd_micros,
           extract(epoch from now() - coalesce(c.bound_at, c.claimed_at))::bigint as age_seconds,
           null::text as attempted_at, null::text as submit_protocol,
           'none: a same-fingerprint retry takes over'::text as action
    from open_claims c, params p
    where c.state <> 'failed' and c.job_by_routing is null
      and coalesce(c.bound_at, c.claimed_at) < now() - p.older_than
    union all
    -- C2: a claim that does not name the job its operation already has.
    select 'claim_unbound_with_job', c.org_id, c.operation_id, j.id, j.status, j.outcome, j.provider_request_id,
           j.reserved_usd_micros, extract(epoch from now() - c.claimed_at)::bigint, j.attempted_at, j.submit_protocol,
           'bind: reconcile decision bind, or any same-id retry'
    from open_claims c join jobs j on j.id = c.job_by_routing
    union all
    -- C3: reserved under cas-v1 and never marked for submission.
    select 'reserved_never_submitted', j.org_id, j.operation_id, j.id, j.status, j.outcome, null,
           j.reserved_usd_micros, extract(epoch from now() - j.created_at)::bigint, j.attempted_at, j.submit_protocol,
           'release: reconcile decision release with a reason; no cas-v1 marker, the submit never started'
    from jobs j, params p
    where j.provider = 'fal' and j.status = 'queued' and j.provider_request_id is null and j.outcome is null
      and j.submit_protocol = 'cas-v1' and j.reservation_state = 'reserved'
      and j.created_at < now() - p.older_than
    union all
    -- C4: the submit may have reached the provider, or the row predates cas-v1.
    select 'submit_outcome_unknown', j.org_id, j.operation_id, j.id, j.status, j.outcome, null,
           j.reserved_usd_micros, extract(epoch from now() - j.created_at)::bigint, j.attempted_at, j.submit_protocol,
           'decide: check the provider console for the attempted window; settle with the request id or release with evidence'
    from jobs j, params p
    where j.status in ('queued', 'reconciling') and j.provider_request_id is null
      and j.reservation_state = 'reserved' and j.created_at < now() - p.older_than
      and (j.outcome in ('submitting', 'uncertain') or j.submit_protocol is distinct from 'cas-v1')
    union all
    -- C5: has a request id, not terminal, stale: the sweep or a member read polls it.
    select 'pollable_stale', j.org_id, j.operation_id, j.id, j.status, j.outcome, j.provider_request_id,
           j.reserved_usd_micros, extract(epoch from now() - j.updated_at)::bigint, j.attempted_at, j.submit_protocol,
           'poll: cron sweep or GET /v1/media/jobs/:id'
    from jobs j, params p
    where j.status in ('queued', 'running', 'reconciling') and j.provider_request_id is not null
      and j.updated_at < now() - p.older_than
    union all
    -- C6: failed with the reservation still held.
    select 'failed_still_reserved', j.org_id, j.operation_id, j.id, j.status, j.outcome, j.provider_request_id,
           j.reserved_usd_micros, extract(epoch from now() - j.updated_at)::bigint, j.attempted_at, j.submit_protocol,
           'release: reconcile decision release with a reason'
    from jobs j
    where j.status = 'failed' and j.reservation_state = 'reserved' and not j.has_actual
    union all
    -- C7: failed, and the provider billed it.
    select 'billed_while_failed', j.org_id, j.operation_id, j.id, j.status, j.outcome, j.provider_request_id,
           j.reserved_usd_micros, extract(epoch from now() - j.updated_at)::bigint, j.attempted_at, j.submit_protocol,
           'info: review'
    from jobs j
    where j.status = 'failed' and j.has_actual
  ),
  limited as (
    select * from candidates
    order by age_seconds desc, class, job_id
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  select jsonb_build_object(
    'generated_at', now(),
    'older_than', (select older_than::text from params),
    'counts', (select coalesce(jsonb_object_agg(t.class, t.n), '{}'::jsonb)
               from (select class, count(*) as n from candidates group by class) t),
    'by_org', (select coalesce(jsonb_agg(jsonb_build_object('org_id', o.org_id, 'counts', o.counts) order by o.org_id), '[]'::jsonb)
               from (select t.org_id, jsonb_object_agg(t.class, t.n) as counts
                     from (select org_id, class, count(*) as n from candidates group by org_id, class) t
                     group by t.org_id) o),
    'candidates', (select coalesce(jsonb_agg(to_jsonb(l) order by l.age_seconds desc, l.class, l.job_id), '[]'::jsonb)
                   from limited l)
  );
$$;

-- grants: service role only, like v1 ------------------------------------------
revoke all on function public.media_bind_operation_v2(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.media_claim_operation_v2(uuid, text, text, uuid, text, interval) from public, anon, authenticated;
revoke all on function public.media_fail_operation_v2(uuid, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.media_release_cost_reservation_v2(uuid, text, text, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.media_resolve_operation_job_v1(uuid, uuid, text, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.media_operation_recovery_candidates_v1(uuid, interval, integer) from public, anon, authenticated;
grant execute on function public.media_bind_operation_v2(uuid, text, uuid, jsonb) to service_role;
grant execute on function public.media_claim_operation_v2(uuid, text, text, uuid, text, interval) to service_role;
grant execute on function public.media_fail_operation_v2(uuid, text, jsonb, integer) to service_role;
grant execute on function public.media_release_cost_reservation_v2(uuid, text, text, jsonb, text[]) to service_role;
grant execute on function public.media_resolve_operation_job_v1(uuid, uuid, text, uuid, text, jsonb, text) to service_role;
grant execute on function public.media_operation_recovery_candidates_v1(uuid, interval, integer) to service_role;

comment on function public.media_bind_operation_v2(uuid, text, uuid, jsonb) is
  'Bind a paid-operation claim to the job that carries its operation id. Idempotent by job identity: already_bound for the same job, operation_bound_elsewhere for another. Repairs a claimed or failed claim, and rebinds a bound claim whose job row is gone.';
comment on function public.media_claim_operation_v2(uuid, text, text, uuid, text, interval) is
  'Atomic paid-operation claim with repair and takeover. won (first caller, or a same-fingerprint takeover of a claim with no job after p_expire_after); existing (the claim, repaired to its job when one exists, with expires_at while it is open). A different fingerprint raises operation_payload_mismatch and changes nothing.';
comment on function public.media_fail_operation_v2(uuid, text, jsonb, integer) is
  'Record a definite failure before any reservation, by the current attempt only. Refused when the attempt was superseded (operation_attempt_superseded) or a job exists for the operation (operation_has_job).';
comment on function public.media_release_cost_reservation_v2(uuid, text, text, jsonb, text[]) is
  'Release a media cost reservation once. Refused after settlement (reservation_already_settled) and when the job is not in one of p_expect_status (job_status_mismatch); a repeat answers already_released and keeps the first ledger row.';
comment on function public.media_resolve_operation_job_v1(uuid, uuid, text, uuid, text, jsonb, text) is
  'The operator decision for a stuck paid media job, bound to its organization: release (evidence required unless the submit provably never started or the job already failed), settle (attach the provider request id; the refresh path settles status and cost) or bind (repair its claim). Recorded in media_jobs.routing operator_resolution and operator_resolution_history.';
comment on function public.media_operation_recovery_candidates_v1(uuid, interval, integer) is
  'Read-only classification of stuck paid media claims and jobs (claim_expired_without_job, claim_unbound_with_job, reserved_never_submitted, submit_outcome_unknown, pollable_stale, failed_still_reserved, billed_while_failed) with counts, per-organization counts and the next action for each.';
