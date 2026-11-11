-- Behaviour of supabase/pending/media_operation_claims_v2.sql on a disposable
-- PostgreSQL 16 (run by scripts/test-media-recovery-db.sh, after the applied
-- media chain, supabase/migrations/20261109194957_media_operation_claims_v1.sql
-- and the file itself, twice). Every expectation is asserted; a wrong answer
-- aborts the run. Fixtures: supabase/tests/media_operation_claims_v2.stub.sql.
\set ON_ERROR_STOP on

-- helpers ---------------------------------------------------------------------
create function pg_temp.org() returns uuid language sql immutable as $$ select '123e4567-e89b-42d3-a456-426614174000'::uuid $$;
create function pg_temp.owner() returns uuid language sql immutable as $$ select '423e4567-e89b-42d3-a456-426614174333'::uuid $$;
create function pg_temp.member() returns uuid language sql immutable as $$ select '523e4567-e89b-42d3-a456-426614174444'::uuid $$;
create function pg_temp.org2() returns uuid language sql immutable as $$ select '223e4567-e89b-42d3-a456-426614174000'::uuid $$;
create function pg_temp.owner2() returns uuid language sql immutable as $$ select '623e4567-e89b-42d3-a456-426614174999'::uuid $$;

create function pg_temp.ok(p_condition boolean, p_message text) returns void language plpgsql as $$
begin
  if p_condition is not true then raise exception 'assertion failed: %', p_message; end if;
end $$;

-- The statement must raise exactly this message (and SQLSTATE, when given).
create function pg_temp.expect_error(p_sql text, p_message text, p_state text default null) returns void language plpgsql as $$
declare v_state text; v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    if v_message <> p_message then
      raise exception 'expected error "%" but got "%" (%) from: %', p_message, v_message, v_state, p_sql;
    end if;
    if p_state is not null and v_state <> p_state then
      raise exception 'expected SQLSTATE % but got % ("%") from: %', p_state, v_state, v_message, p_sql;
    end if;
    return;
  end;
  raise exception 'expected error "%" but the statement succeeded: %', p_message, p_sql;
end $$;

-- A reservation the way the router makes one. p_protocol 'cas-v1' is what the
-- router writes from this change on; null is a row from before it (legacy).
create function pg_temp.reserve(
  p_op text, p_protocol text default 'cas-v1',
  p_org uuid default '123e4567-e89b-42d3-a456-426614174000',
  p_actor uuid default '423e4567-e89b-42d3-a456-426614174333'
) returns uuid language sql as $$
  select id from public.media_create_budgeted_job_v2(
    p_org, p_actor, 'fal', 'fal-ai/flux-2', 'text-to-image', 'p', '{"prompt":"p"}'::jsonb,
    jsonb_strip_nulls(jsonb_build_object('operation_id', p_op, 'requested_by', p_actor, 'submit_protocol', p_protocol)),
    12000, 5, '{}'::jsonb, '{"units":1,"unit":"megapixel","unit_price_usd_micros":12000}'::jsonb)
$$;

create function pg_temp.claim(
  p_op text, p_fp text,
  p_actor uuid default '423e4567-e89b-42d3-a456-426614174333',
  p_org uuid default '123e4567-e89b-42d3-a456-426614174000'
) returns jsonb language sql as $$
  select public.media_claim_operation_v2(p_org, p_op, p_fp, p_actor)
$$;

create function pg_temp.resolve(
  p_job uuid, p_decision text, p_reason text, p_evidence jsonb default '{}'::jsonb, p_request_id text default null,
  p_org uuid default '123e4567-e89b-42d3-a456-426614174000',
  p_actor uuid default '423e4567-e89b-42d3-a456-426614174333'
) returns jsonb language sql as $$
  select public.media_resolve_operation_job_v1(p_org, p_job, p_decision, p_actor, p_reason, p_evidence, p_request_id)
$$;

-- The router's CAS_SUBMIT filter, as SQL: the only state in which a caller may
-- send the provider request for a job.
create function pg_temp.cas_submit_matches(p_job uuid) returns integer language sql as $$
  select count(*)::integer from public.media_jobs
  where id = p_job and status = 'queued' and routing ->> 'reservation_state' = 'reserved'
    and provider_request_id is null and (provider_status ->> 'outcome') is null
$$;

create function pg_temp.class_of(p_job uuid, p_org uuid default null) returns text language sql as $$
  select string_agg(c ->> 'class', ',' order by c ->> 'class')
  from jsonb_array_elements(public.media_operation_recovery_candidates_v1(p_org, interval '15 minutes', 200) -> 'candidates') c
  where c ->> 'job_id' = p_job::text and c ->> 'class' <> 'claim_unbound_with_job'
$$;

\echo === 01 v1 is untouched by v2: state check, the three v1 functions, 11 + 4 columns
do $$ begin
  perform pg_temp.ok((select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.media_operation_claims'::regclass and contype = 'c') ~ 'claimed.*bound.*failed', 'v1 state check changed');
  perform pg_temp.ok((select count(*) from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('media_claim_operation_v1', 'media_bind_operation_v1', 'media_fail_operation_v1')) = 3, 'v1 functions missing');
  perform pg_temp.ok((select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'media_operation_claims') = 15, 'expected 11 v1 + 4 v2 columns');
end $$;

\echo === 02 claim: won; a retry inside the window is pending with expires_at; after the window the SAME fingerprint takes over
do $$ declare r jsonb; begin
  r := pg_temp.claim('op-s1', 'fp-1');
  perform pg_temp.ok(r ->> 'outcome' = 'won' and (r ->> 'attempt')::int = 1 and r -> 'claim' ->> 'state' = 'claimed', 'first claim: ' || r::text);
  r := pg_temp.claim('op-s1', 'fp-1');
  perform pg_temp.ok(r ->> 'outcome' = 'existing' and r -> 'claim' ->> 'state' = 'claimed' and r ->> 'expires_at' is not null and r ->> 'takeover' is null, 'retry inside the window: ' || r::text);
  perform pg_temp.ok((r ->> 'expires_at')::timestamptz = (r -> 'claim' ->> 'claimed_at')::timestamptz + interval '15 minutes', 'expires_at is claimed_at + the window: ' || r::text);
  update public.media_operation_claims set claimed_at = now() - interval '16 minutes' where operation_id = 'op-s1';
  r := pg_temp.claim('op-s1', 'fp-1', pg_temp.owner2());
  perform pg_temp.ok(r ->> 'outcome' = 'won' and (r ->> 'takeover')::boolean and (r ->> 'attempt')::int = 2, 'takeover: ' || r::text);
  perform pg_temp.ok(jsonb_array_length(r -> 'claim' -> 'history') = 1 and r -> 'claim' -> 'history' -> 0 ->> 'reason' = 'expired_without_job'
    and (r -> 'claim' -> 'history' -> 0 ->> 'attempt')::int = 1 and r -> 'claim' -> 'history' -> 0 ->> 'actor_id' = pg_temp.owner()::text, 'history: ' || r::text);
  perform pg_temp.ok(r -> 'claim' ->> 'actor_id' = pg_temp.owner2()::text, 'the claim names the new attempt''s actor: ' || r::text);
  -- a third caller right after the takeover is pending again (fresh claimed_at)
  r := pg_temp.claim('op-s1', 'fp-1', null);
  perform pg_temp.ok(r ->> 'outcome' = 'existing' and r -> 'claim' ->> 'state' = 'claimed' and (r -> 'claim' ->> 'attempt')::int = 2, 'after the takeover: ' || r::text);
end $$;

\echo === 03 a different fingerprint is refused before any repair or takeover, even past the window
select pg_temp.expect_error($$select pg_temp.claim('op-s1', 'fp-OTHER', null)$$, 'operation_payload_mismatch', 'P0001');
update public.media_operation_claims set claimed_at = now() - interval '16 minutes' where operation_id = 'op-s1';
select pg_temp.expect_error($$select pg_temp.claim('op-s1', 'fp-OTHER', null)$$, 'operation_payload_mismatch', 'P0001');
select pg_temp.ok((select attempt = 2 and state = 'claimed' from public.media_operation_claims where operation_id = 'op-s1'), 'a mismatch changed the row');
select pg_temp.expect_error($$select public.media_claim_operation_v2(null, 'x', 'fp')$$, 'org_id, operation_id and fingerprint are required', '22023');

\echo === 04 fail v2: an attempt is required; a superseded attempt cannot fail the current one; the current one can; a failed claim is terminal
select pg_temp.expect_error($$select public.media_fail_operation_v2(pg_temp.org(), 'op-s1', '{"message":"no attempt"}'::jsonb)$$, 'attempt is required', '22023');
select pg_temp.expect_error($$select public.media_fail_operation_v2(pg_temp.org(), 'op-s1', '{"message":"no attempt"}'::jsonb, null)$$, 'attempt is required', '22023');
select pg_temp.expect_error($$select public.media_fail_operation_v2(pg_temp.org(), 'op-s1', '{"message":"late"}'::jsonb, 1)$$, 'operation_attempt_superseded', 'P0001');
select pg_temp.expect_error($$select public.media_fail_operation_v2(pg_temp.org(), 'no-such-op', '{}'::jsonb, 1)$$, 'operation_not_claimed', 'P0001');
do $$ declare r jsonb; begin
  r := public.media_fail_operation_v2(pg_temp.org(), 'op-s1', '{"message":"budget","stage":"preflight"}'::jsonb, 2);
  perform pg_temp.ok(r ->> 'state' = 'failed' and r -> 'failure' ->> 'message' = 'budget', 'fail by the current attempt: ' || r::text);
  update public.media_operation_claims set claimed_at = now() - interval '1 day' where operation_id = 'op-s1';
  r := pg_temp.claim('op-s1', 'fp-1', null);
  perform pg_temp.ok(r ->> 'outcome' = 'existing' and r -> 'claim' ->> 'state' = 'failed' and r ->> 'expires_at' is null, 'a failed claim is never taken over: ' || r::text);
end $$;
select pg_temp.expect_error($$select public.media_fail_operation_v2(pg_temp.org(), 'op-s1', '{}'::jsonb, 2)$$, 'operation_not_claimed', 'P0001');

\echo === 05 repair: reservation made, no bind; the next same-id call binds and reads the job; the late winner bind is idempotent
do $$ declare r jsonb; j uuid; b jsonb; begin
  r := pg_temp.claim('op-s2', 'fp-2');
  j := pg_temp.reserve('op-s2');
  r := pg_temp.claim('op-s2', 'fp-2', pg_temp.owner2());
  perform pg_temp.ok(r ->> 'outcome' = 'existing' and (r ->> 'repaired')::boolean and (r -> 'claim' ->> 'job_id')::uuid = j and r -> 'claim' ->> 'state' = 'bound', 'repair: ' || r::text);
  perform pg_temp.ok(r -> 'claim' -> 'resolution' ->> 'kind' = 'late_bind' and r -> 'claim' -> 'resolution' ->> 'by' = 'media_claim_operation_v2'
    and r -> 'claim' -> 'resolution' ->> 'actor_id' = pg_temp.owner2()::text and r -> 'claim' ->> 'resolved_at' is not null, 'repair evidence: ' || r::text);
  b := public.media_bind_operation_v2(pg_temp.org(), 'op-s2', j);
  perform pg_temp.ok(b ->> 'outcome' = 'already_bound' and (b -> 'claim' ->> 'job_id')::uuid = j, 'late winner bind: ' || b::text);
  r := pg_temp.claim('op-s2', 'fp-2');
  perform pg_temp.ok(r ->> 'outcome' = 'existing' and r ->> 'repaired' is null and (r -> 'claim' ->> 'job_id')::uuid = j and r ->> 'expires_at' is null, 'repeat: ' || r::text);
end $$;
\echo --- a claim whose job exists is never taken over, however old
update public.media_operation_claims set claimed_at = now() - interval '1 day', state = 'claimed', job_id = null, bound_at = null where operation_id = 'op-s2';
do $$ declare r jsonb; begin
  r := pg_temp.claim('op-s2', 'fp-2');
  perform pg_temp.ok(r ->> 'outcome' = 'existing' and (r ->> 'repaired')::boolean and r -> 'claim' ->> 'state' = 'bound' and (r -> 'claim' ->> 'attempt')::int = 1, 'old claim with a job: ' || r::text);
end $$;

\echo === 06 the winner binds its own job: plain bound, no repair evidence
do $$ declare r jsonb; j uuid; b jsonb; begin
  r := pg_temp.claim('op-win', 'fp-w');
  j := pg_temp.reserve('op-win');
  b := public.media_bind_operation_v2(pg_temp.org(), 'op-win', j);
  perform pg_temp.ok(b ->> 'outcome' = 'bound' and b -> 'claim' ->> 'resolution' is null and b -> 'claim' ->> 'resolved_at' is null, 'winner bind: ' || b::text);
end $$;

\echo === 07 fail is refused once a job exists; a legacy v1 failure with a job is repaired by the next call
do $$ declare r jsonb; j uuid; begin
  r := pg_temp.claim('op-s6', 'fp-6');
  j := pg_temp.reserve('op-s6');
end $$;
select pg_temp.expect_error($$select public.media_fail_operation_v2(pg_temp.org(), 'op-s6', '{"message":"transport"}'::jsonb, 1)$$, 'operation_has_job', 'P0001');
do $$ declare r jsonb; begin
  r := public.media_fail_operation_v1(pg_temp.org(), 'op-s6', '{"message":"legacy preflight","stage":"preflight"}'::jsonb);
  perform pg_temp.ok(r ->> 'state' = 'failed', 'v1 fail (frozen) still fails the claim: ' || r::text);
  r := pg_temp.claim('op-s6', 'fp-6');
  perform pg_temp.ok(r ->> 'outcome' = 'existing' and (r ->> 'repaired')::boolean and r -> 'claim' ->> 'state' = 'bound'
    and r -> 'claim' -> 'resolution' ->> 'prior_state' = 'failed'
    and r -> 'claim' -> 'resolution' -> 'prior_failure' ->> 'message' = 'legacy preflight', 'repair of a failed claim: ' || r::text);
end $$;

\echo === 08 bind v2 refusals: a job of another operation, no job, no claim, another organization, a claim bound elsewhere
do $$ declare r jsonb; j uuid; begin
  r := pg_temp.claim('op-bind', 'fp-b');
  j := pg_temp.reserve('op-noclaim');
end $$;
select pg_temp.expect_error(format($$select public.media_bind_operation_v2(pg_temp.org(), 'op-bind', %L)$$, (select id from public.media_jobs where routing ->> 'operation_id' = 'op-s2')), 'job_not_for_operation', 'P0001');
select pg_temp.expect_error($$select public.media_bind_operation_v2(pg_temp.org(), 'op-bind', gen_random_uuid())$$, 'job_not_for_operation', 'P0001');
select pg_temp.expect_error(format($$select public.media_bind_operation_v2(pg_temp.org(), 'op-noclaim', %L)$$, (select id from public.media_jobs where routing ->> 'operation_id' = 'op-noclaim')), 'operation_not_claimed', 'P0001');
select pg_temp.expect_error(format($$select public.media_bind_operation_v2(pg_temp.org2(), 'op-s2', %L)$$, (select id from public.media_jobs where routing ->> 'operation_id' = 'op-s2')), 'job_not_for_operation', 'P0001');
select pg_temp.expect_error($$select public.media_bind_operation_v2(pg_temp.org(), 'op-bind', null)$$, 'org_id, operation_id and job_id are required', '22023');
-- a claim that names another job (never reachable through these RPCs; made by hand)
update public.media_operation_claims set job_id = (select id from public.media_jobs where routing ->> 'operation_id' = 'op-noclaim')
  where operation_id = 'op-s6';
select pg_temp.expect_error(format($$select public.media_bind_operation_v2(pg_temp.org(), 'op-s6', %L)$$, (select id from public.media_jobs where routing ->> 'operation_id' = 'op-s6')), 'operation_bound_elsewhere', 'P0001');
update public.media_operation_claims set job_id = (select id from public.media_jobs where routing ->> 'operation_id' = 'op-s6') where operation_id = 'op-s6';
select pg_temp.ok((select state = 'claimed' and job_id is null from public.media_operation_claims where operation_id = 'op-bind'), 'a claim with no job stays claimed');

\echo === 09 one job per (org, operation id): the unique index refuses a second reservation; another organization and one-offs are independent
select pg_temp.expect_error($$select pg_temp.reserve('op-s2')$$, 'duplicate key value violates unique constraint "media_jobs_org_operation_uidx"', '23505');
do $$ declare a uuid; b uuid; r jsonb; begin
  r := pg_temp.claim('op-s2', 'fp-other-org', pg_temp.owner2(), pg_temp.org2());
  perform pg_temp.ok(r ->> 'outcome' = 'won', 'the same operation id in another organization is its own claim: ' || r::text);
  a := pg_temp.reserve('op-s2', 'cas-v1', pg_temp.org2(), pg_temp.owner2());
  r := public.media_bind_operation_v2(pg_temp.org2(), 'op-s2', a);
  perform pg_temp.ok(r ->> 'outcome' = 'bound', 'the same operation id reserves and binds in another organization: ' || r::text);
  a := pg_temp.reserve(null); b := pg_temp.reserve(null);
  perform pg_temp.ok(a <> b, 'one-off jobs (no operation id) are unlimited');
end $$;
\echo --- the spend guard still refuses a member who is not an owner (42501): the caller refusal the router never records as a failure
select pg_temp.expect_error($$select pg_temp.reserve('op-member', 'cas-v1', pg_temp.org(), pg_temp.member())$$, 'Organization owner access is required to spend on media generation', '42501');

\echo === 10 release v2: once; refused after settlement; a no-op without a reservation; conditional on the status the caller expects
do $$ declare j uuid; r jsonb; begin
  j := pg_temp.reserve('op-rel');
  -- the router patches 'failed' first, then releases expecting 'failed'
  perform pg_temp.expect_error(format($q$select public.media_release_cost_reservation_v2(%L, 'not failed yet', 'mccluster-release', '{}'::jsonb, array['failed'])$q$, j), 'job_status_mismatch', 'P0001');
  perform pg_temp.ok((select routing ->> 'reservation_state' from public.media_jobs where id = j) = 'reserved', 'a refused release moved money');
  update public.media_jobs set status = 'failed' where id = j;
  r := public.media_release_cost_reservation_v2(j, 'first', 'mccluster-release', '{"stage":"submit"}'::jsonb, array['failed']);
  perform pg_temp.ok((r ->> 'released')::boolean and (r ->> 'amount_usd_micros')::bigint = 12000 and r ->> 'source' = 'mccluster-release', 'release 1: ' || r::text);
  r := public.media_release_cost_reservation_v2(j, 'second', 'mccluster-release', '{}'::jsonb, array['failed']);
  perform pg_temp.ok((r ->> 'released')::boolean is false and r ->> 'reason' = 'already_released' and (r ->> 'amount_usd_micros')::bigint = 12000, 'release 2: ' || r::text);
  perform pg_temp.ok((select count(*) from public.media_cost_events where job_id = j and event_type = 'released') = 1, 'two released rows');
  perform pg_temp.ok((select metadata ->> 'reason' = 'first' and metadata ->> 'stage' = 'submit' and (metadata ->> 'reserved_usd_micros')::bigint = 12000
    from public.media_cost_events where job_id = j and event_type = 'released'), 'the second release overwrote the first');
  perform pg_temp.ok((select routing ->> 'reservation_state' = 'released' and (routing ->> 'released_reserve_usd_micros')::bigint = 12000
    from public.media_jobs where id = j), 'released state');
  -- without an expectation it behaves like 0054 for an unsettled job (any status)
  j := pg_temp.reserve('op-rel-any');
  r := public.media_release_cost_reservation_v2(j, 'no expectation');
  perform pg_temp.ok((r ->> 'released')::boolean, 'release without an expected status: ' || r::text);

  -- settle, then release: refused, the reconciliation's ledger row is untouched
  j := pg_temp.reserve('op-hzA');
  update public.media_jobs set status = 'completed', provider_request_id = 'req-hzA' where id = j;
  perform public.media_record_actual_cost_v2(j, 9000, 1, 'megapixel', 9000, 'fal-billing-events', '{}'::jsonb, now());
  perform pg_temp.expect_error(format($q$select public.media_release_cost_reservation_v2(%L, 'webhook ERROR replay after settlement')$q$, j), 'reservation_already_settled', 'P0001');
  update public.media_jobs set status = 'failed' where id = j;
  perform pg_temp.expect_error(format($q$select public.media_release_cost_reservation_v2(%L, 'replay', 'mccluster-release', '{}'::jsonb, array['failed'])$q$, j), 'reservation_already_settled', 'P0001');
  perform pg_temp.ok((select amount_usd_micros = 3000 and source = 'mccluster-reconciliation' from public.media_cost_events where job_id = j and event_type = 'released'), 'the reconciliation release was overwritten');
  perform pg_temp.ok((select routing ->> 'reservation_state' from public.media_jobs where id = j) = 'settled', 'the settled state flipped');
  -- 0054 (frozen; the fallback a Worker uses when v2 is missing) still overwrites: that is why the router calls v2
  perform public.media_release_cost_reservation(j, '0054 overwrite');
  perform pg_temp.ok((select amount_usd_micros from public.media_cost_events where job_id = j and event_type = 'released') = 12000, '0054 semantics changed');

  -- unmetered: no reservation to release
  j := (select id from public.media_create_budgeted_job_v2(pg_temp.org(), pg_temp.owner(), 'openai', 'x', 'text-to-image', 'p', '{}'::jsonb, '{"operation_id":"op-unm"}'::jsonb, null, null, '{}'::jsonb, '{}'::jsonb));
  r := public.media_release_cost_reservation_v2(j, 'noop');
  perform pg_temp.ok((r ->> 'released')::boolean is false and r ->> 'reason' = 'no_reservation', 'unmetered: ' || r::text);
  perform pg_temp.expect_error($q$select public.media_release_cost_reservation_v2(gen_random_uuid(), 'x')$q$, 'Unknown media job', '22023');
end $$;

\echo === 11 a running job with a live provider request: release v2 expecting failed and the operator decision both refuse
do $$ declare j uuid; begin
  j := pg_temp.reserve('op-live');
  update public.media_jobs set status = 'running', provider_request_id = 'req-live', provider_status = '{"outcome":"submitted"}'::jsonb where id = j;
  perform pg_temp.expect_error(format($q$select public.media_release_cost_reservation_v2(%L, 'r', 'mccluster-release', '{}'::jsonb, array['failed'])$q$, j), 'job_status_mismatch', 'P0001');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', 'r', '{"x":1}'::jsonb)$q$, j), 'job_has_provider_request', 'P0001');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'settle', 'r', '{"x":1}'::jsonb, 'req-other')$q$, j), 'job_has_provider_request', 'P0001');
  update public.media_jobs set status = 'reconciling' where id = j;
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', 'r', '{"x":1}'::jsonb)$q$, j), 'job_has_provider_request', 'P0001');
  perform pg_temp.ok((select routing ->> 'reservation_state' = 'reserved' and routing -> 'operator_resolution' is null from public.media_jobs where id = j), 'a refused decision changed the job');
end $$;

\echo === 12 operator release: a cas-v1 job that never started needs only a reason; afterwards the submit CAS matches nothing; idempotent
do $$ declare j uuid; r jsonb; begin
  j := pg_temp.reserve('op-c3');
  perform pg_temp.ok(pg_temp.cas_submit_matches(j) = 1, 'a fresh cas-v1 reservation is submittable');
  update public.media_jobs set created_at = now() - interval '30 minutes' where id = j;
  perform pg_temp.ok(pg_temp.class_of(j) = 'reserved_never_submitted', 'class C3: ' || coalesce(pg_temp.class_of(j), 'none'));
  r := pg_temp.resolve(j, 'release', 'never submitted: no cas-v1 marker');
  perform pg_temp.ok(r ->> 'outcome' = 'released' and r ->> 'status' = 'failed' and (r -> 'release' ->> 'released')::boolean
    and (r -> 'release' ->> 'amount_usd_micros')::bigint = 12000 and r -> 'release' ->> 'source' = 'mccluster-operator-release', 'C3 release: ' || r::text);
  perform pg_temp.ok((select status = 'failed' and error ->> 'stage' = 'recovery' and error ->> 'decision' = 'release'
    and provider_status ->> 'outcome' = 'released_by_operator' and provider_status ->> 'released_at' is not null
    and routing ->> 'reservation_state' = 'released' from public.media_jobs where id = j), 'C3 job after release');
  perform pg_temp.ok((select routing -> 'operator_resolution' ->> 'decision' = 'release'
    and routing -> 'operator_resolution' ->> 'actor_id' = pg_temp.owner()::text
    and routing -> 'operator_resolution' ->> 'prior_status' = 'queued'
    and routing -> 'operator_resolution' ->> 'prior_reservation_state' = 'reserved'
    and jsonb_array_length(routing -> 'operator_resolution_history') = 1 from public.media_jobs where id = j), 'the decision is recorded on the job');
  perform pg_temp.ok((select source = 'mccluster-operator-release' and metadata ->> 'actor_id' = pg_temp.owner()::text and metadata ->> 'decision' = 'release'
    from public.media_cost_events where job_id = j and event_type = 'released'), 'the ledger row names the operator');
  -- a late retry of the same operation can never submit a released job
  perform pg_temp.ok(pg_temp.cas_submit_matches(j) = 0, 'the submit CAS still matches a released job');
  perform pg_temp.ok(pg_temp.class_of(j) is null, 'a released job is still a candidate: ' || coalesce(pg_temp.class_of(j), ''));
  -- the same decision again: the decision on record, no second ledger row
  r := pg_temp.resolve(j, 'release', 'again');
  perform pg_temp.ok(r ->> 'outcome' = 'already_resolved' and r -> 'resolution' ->> 'reason' = 'never submitted: no cas-v1 marker', 'C3 repeat: ' || r::text);
  perform pg_temp.ok((select count(*) from public.media_cost_events where job_id = j) = 2, 'C3 ledger rows');
  perform pg_temp.ok((select jsonb_array_length(routing -> 'operator_resolution_history') from public.media_jobs where id = j) = 1, 'a repeat appended history');
end $$;

\echo === 13 operator release: a legacy row, a submitting marker and an uncertain outcome need evidence
do $$ declare j uuid; r jsonb; begin
  -- a row from before cas-v1: a missing marker proves nothing
  j := pg_temp.reserve('op-legacy', null);
  update public.media_jobs set created_at = now() - interval '30 minutes' where id = j;
  perform pg_temp.ok(pg_temp.class_of(j) = 'submit_outcome_unknown', 'a legacy row is class C4: ' || coalesce(pg_temp.class_of(j), 'none'));
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', 'no evidence')$q$, j), 'release_requires_evidence', 'P0001');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', 'empty evidence', '{}'::jsonb)$q$, j), 'release_requires_evidence', 'P0001');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', 'not an object', '"looked"'::jsonb)$q$, j), 'release_requires_evidence', 'P0001');
  perform pg_temp.ok((select status = 'queued' and routing ->> 'reservation_state' = 'reserved' from public.media_jobs where id = j), 'a refused release changed the legacy row');
  r := pg_temp.resolve(j, 'release', 'provider console: no request in the window', '{"console_checked_at":"2026-11-09T21:00:00Z","requests_seen":0}'::jsonb);
  perform pg_temp.ok(r ->> 'outcome' = 'released', 'legacy release with evidence: ' || r::text);
  perform pg_temp.ok((select routing -> 'operator_resolution' -> 'evidence' ->> 'requests_seen' = '0' from public.media_jobs where id = j), 'evidence not kept on the job');
  perform pg_temp.ok((select metadata -> 'evidence' ->> 'requests_seen' = '0' from public.media_cost_events where job_id = j and event_type = 'released'), 'evidence not kept on the ledger row');

  -- an uncertain outcome (the bytes may have left)
  j := pg_temp.reserve('op-c4');
  update public.media_jobs set status = 'reconciling', created_at = now() - interval '30 minutes',
    provider_status = '{"outcome":"uncertain","attempted_at":"2026-11-09T20:00:00Z"}'::jsonb, error = '{"uncertain":true,"stage":"submit"}'::jsonb where id = j;
  perform pg_temp.ok(pg_temp.class_of(j) = 'submit_outcome_unknown', 'an uncertain outcome is class C4');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', 'no evidence')$q$, j), 'release_requires_evidence', 'P0001');

  -- a submitting marker (the isolate stopped mid-submit)
  j := pg_temp.reserve('op-c4b');
  update public.media_jobs set created_at = now() - interval '30 minutes',
    provider_status = '{"outcome":"submitting","attempted_at":"2026-11-09T20:00:00Z"}'::jsonb where id = j;
  perform pg_temp.ok(pg_temp.class_of(j) = 'submit_outcome_unknown', 'a submitting marker is class C4');
  perform pg_temp.ok(pg_temp.cas_submit_matches(j) = 0, 'a marked job is still submittable');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', 'no evidence')$q$, j), 'release_requires_evidence', 'P0001');
end $$;

\echo === 14 operator release: a failed job that still holds its reservation (with or without a request id) needs only a reason
do $$ declare j uuid; r jsonb; begin
  j := pg_temp.reserve('op-c6');
  update public.media_jobs set status = 'failed', provider_request_id = 'req-failed', error = '{"message":"provider reported failure","stage":"provider"}'::jsonb where id = j;
  perform pg_temp.ok(pg_temp.class_of(j) = 'failed_still_reserved', 'class C6: ' || coalesce(pg_temp.class_of(j), 'none'));
  r := pg_temp.resolve(j, 'release', 'failed job still reserved');
  perform pg_temp.ok(r ->> 'outcome' = 'released' and (r -> 'release' ->> 'released')::boolean, 'C6 release: ' || r::text);
  perform pg_temp.ok(r -> 'resolution' ->> 'provider_request_id' = 'req-failed' and r -> 'resolution' -> 'prior_error' ->> 'stage' = 'provider', 'the prior state is kept in the decision: ' || r::text);
  perform pg_temp.ok(pg_temp.class_of(j) is null, 'C6 is cleared by the release');
  -- a failed job whose reservation the router already released: the decision is recorded, no money moves twice
  j := pg_temp.reserve('op-c6b');
  update public.media_jobs set status = 'failed' where id = j;
  perform public.media_release_cost_reservation_v2(j, 'router release', 'mccluster-release', '{}'::jsonb, array['failed']);
  r := pg_temp.resolve(j, 'release', 'operator confirms');
  perform pg_temp.ok(r ->> 'outcome' = 'released' and (r -> 'release' ->> 'released')::boolean is false and r -> 'release' ->> 'reason' = 'already_released', 'already released: ' || r::text);
  perform pg_temp.ok((select source from public.media_cost_events where job_id = j and event_type = 'released') = 'mccluster-release', 'the first ledger row was replaced');
end $$;

\echo === 15 operator decisions are bound to the organization; settled jobs and bad arguments are refused
do $$ declare j uuid; begin
  j := pg_temp.reserve('op-org');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', 'wrong org', '{"x":1}'::jsonb, null, pg_temp.org2(), pg_temp.owner2())$q$, j), 'job_not_in_org', 'P0001');
  perform pg_temp.expect_error($q$select pg_temp.resolve(gen_random_uuid(), 'release', 'no job')$q$, 'job_not_found', 'P0001');
  perform pg_temp.ok((select status = 'queued' and routing -> 'operator_resolution' is null from public.media_jobs where id = j), 'another organization changed the job');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'abandon', 'r')$q$, j), 'decision must be release, settle or bind', '22023');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', '   ')$q$, j), 'a reason is required', '22023');
  perform pg_temp.expect_error(format($q$select public.media_resolve_operation_job_v1(pg_temp.org(), %L, 'release', null, 'r')$q$, j), 'org_id, job_id and actor_id are required', '22023');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'settle', 'no id')$q$, j), 'settle requires the provider request id', '22023');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'settle', 'blank id', '{}'::jsonb, '  ')$q$, j), 'settle requires the provider request id', '22023');
  -- settled: neither decision
  update public.media_jobs set status = 'completed', provider_request_id = 'req-org' where id = j;
  perform public.media_record_actual_cost_v2(j, 9000, 1, 'megapixel', 9000, 'fal-billing-events', '{}'::jsonb, now());
  update public.media_jobs set status = 'failed' where id = j;
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', 'r', '{"x":1}'::jsonb)$q$, j), 'reservation_already_settled', 'P0001');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'settle', 'r', '{"x":1}'::jsonb, 'req-z')$q$, j), 'reservation_already_settled', 'P0001');
  perform pg_temp.ok(pg_temp.class_of(j) = 'billed_while_failed', 'failed and billed is class C7: ' || coalesce(pg_temp.class_of(j), 'none'));
  -- a completed job is not the operator's
  j := pg_temp.reserve('op-done');
  update public.media_jobs set status = 'completed' where id = j;
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'settle', 'r', '{"x":1}'::jsonb, 'req-done')$q$, j), 'job_not_resolvable', 'P0001');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', 'r', '{"x":1}'::jsonb)$q$, j), 'job_not_resolvable', 'P0001');
end $$;

\echo === 16 operator settle: attaches the request id and hands the job to the refresh path; never writes a cost; one request id, one job
do $$ declare j uuid; k uuid; r jsonb; begin
  j := pg_temp.reserve('op-s3');
  update public.media_jobs set status = 'reconciling', provider_status = '{"outcome":"uncertain","unknown_request_count":2}'::jsonb, error = '{"uncertain":true,"stage":"submit"}'::jsonb where id = j;
  r := pg_temp.resolve(j, 'settle', 'found it in the provider console', '{"console":"fal"}'::jsonb, ' req-from-console ');
  perform pg_temp.ok(r ->> 'outcome' = 'settled' and r ->> 'status' = 'queued' and r ->> 'provider_request_id' = 'req-from-console', 'settle: ' || r::text);
  perform pg_temp.ok((select provider_request_id = 'req-from-console' and status = 'queued' and error = '{}'::jsonb and submitted_at is not null
    and provider_status ->> 'outcome' = 'attached_by_operator' and provider_status ->> 'request_id' = 'req-from-console'
    and provider_status -> 'unknown_request_count' is null
    and routing ->> 'reservation_state' = 'reserved' and actual_cost_cents is null from public.media_jobs where id = j), 'settled job');
  perform pg_temp.ok((select count(*) from public.media_cost_events where job_id = j) = 1, 'settle wrote a cost event');
  perform pg_temp.ok(pg_temp.cas_submit_matches(j) = 0, 'a settled job is still submittable');
  -- the same decision with the same id: the decision on record; a different id: refused
  r := pg_temp.resolve(j, 'settle', 'again', '{}'::jsonb, 'req-from-console');
  perform pg_temp.ok(r ->> 'outcome' = 'already_resolved', 'settle repeat: ' || r::text);
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'settle', 'another id', '{"x":1}'::jsonb, 'req-second')$q$, j), 'job_already_resolved', 'P0001');
  -- the same request id cannot be attached to a second job
  k := pg_temp.reserve('op-s3b');
  update public.media_jobs set status = 'reconciling', provider_status = '{"outcome":"uncertain"}'::jsonb where id = k;
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'settle', 'r', '{}'::jsonb, 'req-from-console')$q$, k), 'provider_request_id_in_use', 'P0001');
  -- and the unique index refuses it even from a plain update
  perform pg_temp.expect_error(format($q$update public.media_jobs set provider_request_id = 'req-from-console' where id = %L$q$, k), 'duplicate key value violates unique constraint "media_jobs_provider_request_uidx"', '23505');
  perform pg_temp.ok((select provider_request_id is null from public.media_jobs where id = k), 'a refused attach changed the second job');
end $$;

\echo === 17 settle then release: refused until the provider proves the attached id unknown, and then only with evidence
do $$ declare j uuid; r jsonb; begin
  j := (select id from public.media_jobs where routing ->> 'operation_id' = 'op-s3');
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', 'changed my mind', '{"x":1}'::jsonb)$q$, j), 'release_after_settle_requires_unknown_request', 'P0001');
  -- three consecutive provider 404s: the sweep marks the request unknown
  update public.media_jobs set status = 'reconciling', provider_status = provider_status || '{"outcome":"unknown_request","unknown_request_count":3}'::jsonb where id = j;
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'release', 'no evidence')$q$, j), 'release_after_settle_requires_unknown_request', 'P0001');
  r := pg_temp.resolve(j, 'release', 'the provider does not know this request', '{"status_checks":3,"last_status":404}'::jsonb);
  perform pg_temp.ok(r ->> 'outcome' = 'released' and (r -> 'release' ->> 'released')::boolean, 'release after an unknown request: ' || r::text);
  perform pg_temp.ok((select jsonb_array_length(routing -> 'operator_resolution_history') = 2
    and routing -> 'operator_resolution_history' -> 0 ->> 'decision' = 'settle'
    and routing -> 'operator_resolution_history' -> 1 ->> 'decision' = 'release'
    and routing -> 'operator_resolution' ->> 'decision' = 'release' from public.media_jobs where id = j), 'both decisions are in the history');
end $$;

\echo === 18 release then settle: accepted (the provider ran it after all); history holds both
do $$ declare j uuid; r jsonb; begin
  j := (select id from public.media_jobs where routing ->> 'operation_id' = 'op-c3');
  r := pg_temp.resolve(j, 'settle', 'the provider billed this request after the release', '{}'::jsonb, 'req-after-release');
  perform pg_temp.ok(r ->> 'outcome' = 'settled' and r ->> 'status' = 'queued', 'settle after release: ' || r::text);
  perform pg_temp.ok((select status = 'queued' and provider_request_id = 'req-after-release' and error = '{}'::jsonb
    and routing ->> 'reservation_state' = 'released'
    and jsonb_array_length(routing -> 'operator_resolution_history') = 2
    and routing -> 'operator_resolution_history' -> 0 ->> 'decision' = 'release'
    and routing -> 'operator_resolution' ->> 'decision' = 'settle'
    and routing -> 'operator_resolution' ->> 'prior_status' = 'failed' from public.media_jobs where id = j), 'job after release then settle');
  -- the refresh path completes it and the cost settles through record_actual: the ledger self-corrects
  update public.media_jobs set status = 'completed' where id = j;
  perform public.media_record_actual_cost_v2(j, 9000, 1, 'megapixel', 9000, 'fal-billing-events', '{}'::jsonb, now());
  perform pg_temp.ok((select routing ->> 'reservation_state' = 'settled' and actual_cost_cents = 1
    and jsonb_array_length(routing -> 'operator_resolution_history') = 2 from public.media_jobs where id = j), 'settlement after release then settle; the decision history survives');
end $$;

\echo === 19 settle on a submit the provider definitely refused needs evidence
do $$ declare j uuid; r jsonb; begin
  j := pg_temp.reserve('op-refused');
  update public.media_jobs set status = 'failed', provider_status = '{"outcome":"submit_refused","provider_status_code":422}'::jsonb, error = '{"message":"Unprocessable input","stage":"submit"}'::jsonb where id = j;
  perform public.media_release_cost_reservation_v2(j, 'provider submission failed', 'mccluster-release', '{}'::jsonb, array['failed']);
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'settle', 'no evidence', '{}'::jsonb, 'req-refused')$q$, j), 'settle_requires_evidence', 'P0001');
  r := pg_temp.resolve(j, 'settle', 'the console shows the request ran', '{"console_request_id":"req-refused"}'::jsonb, 'req-refused');
  perform pg_temp.ok(r ->> 'outcome' = 'settled', 'settle with evidence after a refusal: ' || r::text);
  -- an error staged at submit without the uncertain flag is the same definite refusal
  j := pg_temp.reserve('op-refused-2');
  update public.media_jobs set status = 'failed', error = '{"message":"x","stage":"submit"}'::jsonb where id = j;
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'settle', 'no evidence', '{}'::jsonb, 'req-refused-2')$q$, j), 'settle_requires_evidence', 'P0001');
end $$;

\echo === 20 operator bind: repairs the claim of the job it names; a release may follow; a job without an operation id cannot be bound
do $$ declare j uuid; r jsonb; begin
  r := pg_temp.claim('op-opbind', 'fp-ob');
  j := pg_temp.reserve('op-opbind');
  update public.media_operation_claims set claimed_at = now() - interval '20 minutes' where operation_id = 'op-opbind';
  perform pg_temp.ok((public.media_operation_recovery_candidates_v1(pg_temp.org()) -> 'counts' ->> 'claim_unbound_with_job')::int >= 1, 'a claimed row whose job exists is class C2');
  r := pg_temp.resolve(j, 'bind', 'bind the claim to its job');
  perform pg_temp.ok(r ->> 'outcome' = 'repaired' and r -> 'claim' ->> 'state' = 'bound' and (r -> 'claim' ->> 'job_id')::uuid = j
    and r -> 'claim' -> 'resolution' ->> 'by' = 'operator' and r -> 'claim' -> 'resolution' ->> 'reason' = 'bind the claim to its job', 'operator bind: ' || r::text);
  perform pg_temp.ok((select status = 'queued' and routing ->> 'reservation_state' = 'reserved'
    and routing -> 'operator_resolution' ->> 'decision' = 'bind' from public.media_jobs where id = j), 'a bind moved the job or its money');
  r := pg_temp.resolve(j, 'bind', 'again');
  perform pg_temp.ok(r ->> 'outcome' = 'already_resolved', 'bind repeat: ' || r::text);
  -- a bind restricts nothing: the never-started job may still be released
  r := pg_temp.resolve(j, 'release', 'never submitted');
  perform pg_temp.ok(r ->> 'outcome' = 'released' and (select jsonb_array_length(routing -> 'operator_resolution_history') from public.media_jobs where id = j) = 2, 'release after bind: ' || r::text);
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'bind', 'after a release')$q$, j), 'job_already_resolved', 'P0001');
  j := pg_temp.reserve(null);
  perform pg_temp.expect_error(format($q$select pg_temp.resolve(%L, 'bind', 'no operation id')$q$, j), 'job carries no operation_id', '22023');
end $$;

\echo === 21 a bound claim whose job row is gone: pending with expires_at, taken over after the window, rebound when a job appears
do $$ declare r jsonb; j uuid; k uuid; begin
  r := pg_temp.claim('op-bn', 'fp-bn');
  j := pg_temp.reserve('op-bn');
  r := public.media_bind_operation_v2(pg_temp.org(), 'op-bn', j);
  delete from public.media_jobs where id = j;
  perform pg_temp.ok((select state = 'bound' and job_id is null from public.media_operation_claims where operation_id = 'op-bn'), 'the foreign key did not null the job id');
  r := pg_temp.claim('op-bn', 'fp-bn');
  perform pg_temp.ok(r ->> 'outcome' = 'existing' and r -> 'claim' ->> 'state' = 'bound' and r -> 'claim' ->> 'job_id' is null
    and (r ->> 'expires_at')::timestamptz = (r -> 'claim' ->> 'bound_at')::timestamptz + interval '15 minutes', 'bound without a job inside the window: ' || r::text);
  perform pg_temp.expect_error($q$select pg_temp.claim('op-bn', 'fp-OTHER')$q$, 'operation_payload_mismatch', 'P0001');
  perform pg_temp.expect_error($q$select public.media_fail_operation_v2(pg_temp.org(), 'op-bn', '{}'::jsonb, 1)$q$, 'operation_not_claimed', 'P0001');
  update public.media_operation_claims set bound_at = now() - interval '16 minutes' where operation_id = 'op-bn';
  perform pg_temp.ok((public.media_operation_recovery_candidates_v1(pg_temp.org()) -> 'counts' ->> 'claim_expired_without_job')::int >= 1, 'a bound claim with no job past the window is class C1');
  r := pg_temp.claim('op-bn', 'fp-bn', pg_temp.owner2());
  perform pg_temp.ok(r ->> 'outcome' = 'won' and (r ->> 'takeover')::boolean and (r ->> 'attempt')::int = 2 and r -> 'claim' ->> 'state' = 'claimed'
    and r -> 'claim' ->> 'bound_at' is null and r -> 'claim' -> 'history' -> 0 ->> 'reason' = 'bound_job_missing', 'takeover of a bound claim with no job: ' || r::text);

  -- rebind: the job row is gone and the operation has a job again
  r := pg_temp.claim('op-bn2', 'fp-bn2');
  j := pg_temp.reserve('op-bn2');
  r := public.media_bind_operation_v2(pg_temp.org(), 'op-bn2', j);
  delete from public.media_jobs where id = j;
  k := pg_temp.reserve('op-bn2');
  r := pg_temp.claim('op-bn2', 'fp-bn2');
  perform pg_temp.ok(r ->> 'outcome' = 'existing' and (r ->> 'repaired')::boolean and (r -> 'claim' ->> 'job_id')::uuid = k
    and r -> 'claim' -> 'resolution' ->> 'kind' = 'rebind' and r -> 'claim' -> 'resolution' ->> 'prior_state' = 'bound', 'rebind through the claim: ' || r::text);
  -- and directly through bind v2
  r := pg_temp.claim('op-bn3', 'fp-bn3');
  j := pg_temp.reserve('op-bn3');
  r := public.media_bind_operation_v2(pg_temp.org(), 'op-bn3', j);
  delete from public.media_jobs where id = j;
  k := pg_temp.reserve('op-bn3');
  r := public.media_bind_operation_v2(pg_temp.org(), 'op-bn3', k);
  perform pg_temp.ok(r ->> 'outcome' = 'repaired' and (r -> 'claim' ->> 'job_id')::uuid = k and r -> 'claim' -> 'resolution' ->> 'kind' = 'rebind', 'rebind through bind v2: ' || r::text);
end $$;

\echo === 22 candidates: one organization holding exactly one of each class; counts, per-organization counts, fields, order and limit
do $$ declare r jsonb; c jsonb; j uuid; one jsonb; begin
  -- C1 a claim with no job, past the window
  perform pg_temp.claim('o2-c1', 'fp', pg_temp.owner2(), pg_temp.org2());
  update public.media_operation_claims set claimed_at = now() - interval '50 minutes' where org_id = pg_temp.org2() and operation_id = 'o2-c1';
  -- C2 a claimed row whose job exists (the job itself is fresh, so it is no other class)
  perform pg_temp.claim('o2-c2', 'fp', pg_temp.owner2(), pg_temp.org2());
  j := pg_temp.reserve('o2-c2', 'cas-v1', pg_temp.org2(), pg_temp.owner2());
  -- C3 reserved under cas-v1, never marked
  j := pg_temp.reserve('o2-c3', 'cas-v1', pg_temp.org2(), pg_temp.owner2());
  update public.media_jobs set created_at = now() - interval '40 minutes' where id = j;
  -- C4 a legacy row with no request id
  j := pg_temp.reserve('o2-c4', null, pg_temp.org2(), pg_temp.owner2());
  update public.media_jobs set created_at = now() - interval '30 minutes' where id = j;
  -- C5 a running job with a request id, stale
  j := pg_temp.reserve('o2-c5', 'cas-v1', pg_temp.org2(), pg_temp.owner2());
  update public.media_jobs set provider_request_id = 'o2-req-poll', status = 'running', updated_at = now() - interval '20 minutes',
    provider_status = '{"outcome":"submitted","attempted_at":"2026-11-09T20:00:00Z"}'::jsonb where id = j;
  -- C6 failed, reservation still held
  j := pg_temp.reserve('o2-c6', 'cas-v1', pg_temp.org2(), pg_temp.owner2());
  update public.media_jobs set status = 'failed', updated_at = now() - interval '10 minutes' where id = j;
  -- C7 failed and billed
  j := pg_temp.reserve('o2-c7', 'cas-v1', pg_temp.org2(), pg_temp.owner2());
  update public.media_jobs set status = 'completed', provider_request_id = 'o2-req-billed' where id = j;
  perform public.media_record_actual_cost_v2(j, 9000, 1, 'megapixel', 9000, 'fal-billing-events', '{}'::jsonb, now());
  update public.media_jobs set status = 'failed', updated_at = now() - interval '5 minutes' where id = j;
  -- the job reserved in scenario 09 for this organization is fresh: not a candidate

  r := public.media_operation_recovery_candidates_v1(pg_temp.org2(), interval '15 minutes', 50);
  c := r -> 'counts';
  perform pg_temp.ok(c = '{"claim_expired_without_job":1,"claim_unbound_with_job":1,"reserved_never_submitted":1,"submit_outcome_unknown":1,"pollable_stale":1,"failed_still_reserved":1,"billed_while_failed":1}'::jsonb, 'counts: ' || c::text);
  perform pg_temp.ok(jsonb_array_length(r -> 'by_org') = 1 and r -> 'by_org' -> 0 ->> 'org_id' = pg_temp.org2()::text and r -> 'by_org' -> 0 -> 'counts' = c, 'by_org: ' || (r -> 'by_org')::text);
  perform pg_temp.ok(jsonb_array_length(r -> 'candidates') = 7 and r ->> 'older_than' = '00:15:00' and r ->> 'generated_at' is not null, 'candidate rows: ' || r::text);
  -- oldest first
  perform pg_temp.ok(r -> 'candidates' -> 0 ->> 'class' = 'claim_expired_without_job' and r -> 'candidates' -> 1 ->> 'class' = 'reserved_never_submitted'
    and r -> 'candidates' -> 2 ->> 'class' = 'submit_outcome_unknown', 'order by age: ' || (r -> 'candidates')::text);
  select x into one from jsonb_array_elements(r -> 'candidates') x where x ->> 'class' = 'pollable_stale';
  perform pg_temp.ok(one ->> 'provider_request_id' = 'o2-req-poll' and one ->> 'status' = 'running' and one ->> 'outcome' = 'submitted'
    and one ->> 'attempted_at' = '2026-11-09T20:00:00Z' and one ->> 'submit_protocol' = 'cas-v1' and one ->> 'operation_id' = 'o2-c5'
    and (one ->> 'reserved_usd_micros')::bigint = 12000 and (one ->> 'age_seconds')::bigint >= 1199 and one ->> 'action' like 'poll:%', 'candidate fields: ' || one::text);
  select x into one from jsonb_array_elements(r -> 'candidates') x where x ->> 'class' = 'submit_outcome_unknown';
  perform pg_temp.ok(one ->> 'submit_protocol' is null and one ->> 'action' like 'decide:%' and one ->> 'provider_request_id' is null, 'legacy candidate: ' || one::text);
  select x into one from jsonb_array_elements(r -> 'candidates') x where x ->> 'class' = 'reserved_never_submitted';
  perform pg_temp.ok(one ->> 'action' like 'release:%' and one ->> 'outcome' is null, 'C3 candidate: ' || one::text);
  select x into one from jsonb_array_elements(r -> 'candidates') x where x ->> 'class' = 'claim_expired_without_job';
  perform pg_temp.ok(one ->> 'job_id' is null and one ->> 'operation_id' = 'o2-c1' and one ->> 'action' like 'none:%', 'C1 candidate: ' || one::text);
  select x into one from jsonb_array_elements(r -> 'candidates') x where x ->> 'class' = 'claim_unbound_with_job';
  perform pg_temp.ok(one ->> 'operation_id' = 'o2-c2' and one ->> 'job_id' is not null and one ->> 'action' like 'bind:%', 'C2 candidate: ' || one::text);
  select x into one from jsonb_array_elements(r -> 'candidates') x where x ->> 'class' = 'billed_while_failed';
  perform pg_temp.ok(one ->> 'action' = 'info: review' and one ->> 'provider_request_id' = 'o2-req-billed', 'C7 candidate: ' || one::text);
  -- the limit bounds the rows, never the counts; it is clamped to 1..200
  r := public.media_operation_recovery_candidates_v1(pg_temp.org2(), interval '15 minutes', 2);
  perform pg_temp.ok(jsonb_array_length(r -> 'candidates') = 2 and r -> 'counts' = c, 'limit 2: ' || r::text);
  r := public.media_operation_recovery_candidates_v1(pg_temp.org2(), interval '15 minutes', 0);
  perform pg_temp.ok(jsonb_array_length(r -> 'candidates') = 1, 'limit 0 clamps to 1');
  r := public.media_operation_recovery_candidates_v1(pg_temp.org2(), interval '15 minutes', 100000);
  perform pg_temp.ok(jsonb_array_length(r -> 'candidates') = 7, 'a large limit is clamped, not an error');
  -- a longer window drops the classes that are not old enough yet
  r := public.media_operation_recovery_candidates_v1(pg_temp.org2(), interval '45 minutes', 50);
  perform pg_temp.ok(r -> 'counts' = '{"claim_expired_without_job":1,"claim_unbound_with_job":1,"failed_still_reserved":1,"billed_while_failed":1}'::jsonb, 'window 45 minutes: ' || (r -> 'counts')::text);
  r := public.media_operation_recovery_candidates_v1(pg_temp.org2(), null, null);
  perform pg_temp.ok(r -> 'counts' = c, 'null window and limit fall back to the defaults: ' || (r -> 'counts')::text);
  -- every organization: both appear, each with its own counts
  r := public.media_operation_recovery_candidates_v1();
  perform pg_temp.ok(jsonb_array_length(r -> 'by_org') = 2
    and (select x -> 'counts' from jsonb_array_elements(r -> 'by_org') x where x ->> 'org_id' = pg_temp.org2()::text) = c
    and (select (x -> 'counts' ->> 'submit_outcome_unknown')::int from jsonb_array_elements(r -> 'by_org') x where x ->> 'org_id' = pg_temp.org()::text) >= 2, 'by_org for every organization: ' || (r -> 'by_org')::text);
  -- a decision clears its row: release C6, bind C2, a same-fingerprint retry takes over C1
  j := (select id from public.media_jobs where org_id = pg_temp.org2() and routing ->> 'operation_id' = 'o2-c6');
  perform pg_temp.resolve(j, 'release', 'failed job still reserved', '{}'::jsonb, null, pg_temp.org2(), pg_temp.owner2());
  j := (select id from public.media_jobs where org_id = pg_temp.org2() and routing ->> 'operation_id' = 'o2-c2');
  perform pg_temp.resolve(j, 'bind', 'bind it', '{}'::jsonb, null, pg_temp.org2(), pg_temp.owner2());
  perform pg_temp.claim('o2-c1', 'fp', pg_temp.owner2(), pg_temp.org2());
  r := public.media_operation_recovery_candidates_v1(pg_temp.org2(), interval '15 minutes', 50);
  perform pg_temp.ok(r -> 'counts' = '{"reserved_never_submitted":1,"submit_outcome_unknown":1,"pollable_stale":1,"billed_while_failed":1}'::jsonb, 'after the decisions: ' || (r -> 'counts')::text);
end $$;

\echo === 23 grants: anon and authenticated are refused on all six functions and on the table
do $$ declare fn text; role_name text; begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach fn in array array[
      $q$select public.media_claim_operation_v2('123e4567-e89b-42d3-a456-426614174000', 'x', 'fp')$q$,
      $q$select public.media_bind_operation_v2('123e4567-e89b-42d3-a456-426614174000', 'x', gen_random_uuid())$q$,
      $q$select public.media_fail_operation_v2('123e4567-e89b-42d3-a456-426614174000', 'x', '{}'::jsonb, 1)$q$,
      $q$select public.media_release_cost_reservation_v2(gen_random_uuid())$q$,
      $q$select public.media_resolve_operation_job_v1('123e4567-e89b-42d3-a456-426614174000', gen_random_uuid(), 'release', gen_random_uuid(), 'r')$q$,
      $q$select public.media_operation_recovery_candidates_v1()$q$,
      $q$select count(*) from public.media_operation_claims$q$,
      $q$insert into public.media_operation_claims (org_id, operation_id, fingerprint) values ('123e4567-e89b-42d3-a456-426614174000', 'direct', 'fp')$q$
    ] loop
      execute format('set local role %I', role_name);
      begin
        execute fn;
        reset role;
        raise exception '% was allowed: %', role_name, fn;
      exception when insufficient_privilege then
        reset role;
      end;
    end loop;
  end loop;
end $$;
select pg_temp.ok((select count(*) from information_schema.routine_privileges
  where routine_schema = 'public' and grantee in ('PUBLIC', 'anon', 'authenticated')
    and routine_name in ('media_claim_operation_v2', 'media_bind_operation_v2', 'media_fail_operation_v2',
      'media_release_cost_reservation_v2', 'media_resolve_operation_job_v1', 'media_operation_recovery_candidates_v1')) = 0,
  'a v2 function is executable by PUBLIC, anon or authenticated');
select pg_temp.ok((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
  and proconfig @> array['search_path=public, pg_temp']
  and proname in ('media_claim_operation_v2', 'media_bind_operation_v2', 'media_fail_operation_v2',
    'media_release_cost_reservation_v2', 'media_resolve_operation_job_v1', 'media_operation_recovery_candidates_v1')) = 6,
  'every v2 function is SECURITY DEFINER with a pinned search_path');

\echo === 24 service_role (what the Worker is) runs the whole protocol
set role service_role;
do $$ declare r jsonb; j uuid; begin
  r := public.media_claim_operation_v2('123e4567-e89b-42d3-a456-426614174000', 'op-svc', 'fp-svc', '423e4567-e89b-42d3-a456-426614174333');
  if r ->> 'outcome' <> 'won' then raise exception 'service claim: %', r; end if;
  j := (select id from public.media_create_budgeted_job_v2(
    '123e4567-e89b-42d3-a456-426614174000', '423e4567-e89b-42d3-a456-426614174333', 'fal', 'fal-ai/flux-2', 'text-to-image', 'p', '{"prompt":"p"}'::jsonb,
    '{"operation_id":"op-svc","submit_protocol":"cas-v1"}'::jsonb, 12000, 5, '{}'::jsonb, '{}'::jsonb));
  r := public.media_bind_operation_v2('123e4567-e89b-42d3-a456-426614174000', 'op-svc', j);
  if r ->> 'outcome' <> 'bound' then raise exception 'service bind: %', r; end if;
  begin
    perform public.media_fail_operation_v2('123e4567-e89b-42d3-a456-426614174000', 'op-svc', '{}'::jsonb, 1);
    raise exception 'service fail was accepted for a bound claim';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'operation_not_claimed' then raise; end if;
  end;
  r := public.media_operation_recovery_candidates_v1('123e4567-e89b-42d3-a456-426614174000');
  if r -> 'counts' is null then raise exception 'service candidates: %', r; end if;
  r := public.media_resolve_operation_job_v1('123e4567-e89b-42d3-a456-426614174000', j, 'release', '423e4567-e89b-42d3-a456-426614174333', 'never submitted');
  if r ->> 'outcome' <> 'released' or (r -> 'release' ->> 'released')::boolean is not true then raise exception 'service resolve: %', r; end if;
  r := public.media_release_cost_reservation_v2(j, 'again', 'mccluster-release', '{}'::jsonb, array['failed']);
  if r ->> 'reason' <> 'already_released' then raise exception 'service release: %', r; end if;
  r := public.media_claim_operation_v2('123e4567-e89b-42d3-a456-426614174000', 'op-svc', 'fp-svc', null);
  if r ->> 'outcome' <> 'existing' or (r -> 'claim' ->> 'job_id')::uuid <> j then raise exception 'service readback: %', r; end if;
end $$;
reset role;

select 'media_operation_claims_v2 behaviour: all assertions passed' as result;
