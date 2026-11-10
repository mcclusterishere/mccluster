#!/usr/bin/env bash
# Proves supabase/pending/media_operation_claims_v2.sql (recovery for paid media
# operations: repair, takeover, guarded release, the operator decision and the
# recovery candidates) against a throwaway local PostgreSQL (16+), as the real
# API roles. Nothing here touches a real project.
#
#   1. the chain production has: the API role stub, an org_members stub with
#      fixtures (supabase/tests/media_operation_claims_v2.stub.sql), the media
#      harness (0041), cost controls (0052, 0053, 0054) and the spend guard,
#      then supabase/migrations/20261109194957_media_operation_claims_v1.sql,
#      checked to be the statement production stored (SHA-256)
#   2. the file, twice, each time as ONE transaction (it must be safe to re-run)
#   3. supabase/tests/media_operation_claims_v2.behaviour.sql: 24 scenarios, as
#      the owner for fixtures and as service_role, anon and authenticated
#   4. three concurrent sessions on one expired claim: exactly one takes over
#   4b. the claim-row lock: a test-only trigger holds the first takeover inside
#       its UPDATE until the two other sessions wait on a lock; exactly one
#       takes over (three do when the claim-row read loses its FOR UPDATE)
#   4c. an operator's bind decision against a same-id retry repairing the same
#       open claim: no deadlock, the claim is bound once (40P01 when the
#       decision locks the job row FOR UPDATE instead of FOR NO KEY UPDATE)
#   5. the rollback: the six functions, four columns and four indexes are gone;
#      v1's table (11 columns) and three RPCs, 0054's release and 0053's
#      record_actual are byte-for-byte what they were before the file
#   6. the file again on the rolled-back database (with the behaviour's rows)
#   7. each duplicate guard refuses a prepared duplicate and, because the file
#      is one transaction, leaves nothing half-applied
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=postgres scripts/test-media-recovery-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="media_recovery_$$"
OUT="$(mktemp -d)"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'wait 2>/dev/null || true; psql -q -d postgres -c "drop database if exists $DB" >/dev/null; rm -rf "$OUT"' EXIT
apply() { PGOPTIONS="--client-min-messages=warning" psql -q -1 -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
q() { psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }
fail() { echo "$1" >&2; exit 1; }

V1=supabase/migrations/20261109194957_media_operation_claims_v1.sql
V2=supabase/pending/media_operation_claims_v2.sql
V1_SHA256=c1733f48360b901084a9af26d727a7e9e934be54cb7f2a545396bada21d008c1
ORG=123e4567-e89b-42d3-a456-426614174000
OWNER=423e4567-e89b-42d3-a456-426614174333

# 1. the applied chain ---------------------------------------------------------
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/media_operation_claims_v2.stub.sql
apply supabase/replay_migrations/0041_media_harness_core.sql
apply supabase/replay_migrations/0052_media_cost_controls.sql
apply supabase/replay_migrations/0053_media_cost_precision.sql
apply supabase/replay_migrations/0054_media_release_precision.sql
apply supabase/replay_migrations/20260908102000_media_spend_guard.sql
[ "$(sha256sum "$V1" | cut -d' ' -f1)" = "$V1_SHA256" ] \
  || fail "$V1 is not the statement production stored (docs/control-plane/evidence/releases-2026-11-09/CLAIMS-APPLIED-VERIFICATION.md)"
apply "$V1"
echo "claims v1 is the applied statement, byte for byte"

FROZEN="select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')=' || md5(p.prosrc), ' ' order by p.proname)
  from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('media_claim_operation_v1','media_bind_operation_v1','media_fail_operation_v1','media_release_cost_reservation','media_record_actual_cost_v2','media_create_budgeted_job_v2')"
V1_COLUMNS="select string_agg(column_name || ':' || data_type || ':' || is_nullable, ' ' order by ordinal_position)
  from information_schema.columns where table_schema = 'public' and table_name = 'media_operation_claims'"
V2_FUNCTIONS="select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
  ('media_claim_operation_v2','media_bind_operation_v2','media_fail_operation_v2','media_release_cost_reservation_v2','media_resolve_operation_job_v1','media_operation_recovery_candidates_v1')"
V2_INDEXES="select count(*) from pg_indexes where schemaname = 'public' and indexname in
  ('media_jobs_org_operation_uidx','media_jobs_provider_request_uidx','media_jobs_fal_open_updated_idx','media_operation_claims_claimed_idx')"
frozen_before="$(q "$FROZEN")"; columns_before="$(q "$V1_COLUMNS")"
[ "$(q "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'media_operation_claims'")" = 11 ] \
  || fail "claims v1 did not create its 11 columns"

# 2. the file, twice -----------------------------------------------------------
apply "$V2"
apply "$V2"
[ "$(q "$V2_FUNCTIONS")" = 6 ] || fail "expected the six v2 functions"
[ "$(q "$V2_INDEXES")" = 4 ] || fail "expected the four v2 indexes"
[ "$(q "$FROZEN")" = "$frozen_before" ] || fail "the file changed a v1, 0053 or 0054 function: $(q "$FROZEN")"

# 3. behaviour -----------------------------------------------------------------
PGOPTIONS="--client-min-messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/media_operation_claims_v2.behaviour.sql >"$OUT/behaviour.out" \
  || { cat "$OUT/behaviour.out" >&2; fail "behaviour failed"; }
grep -q "all assertions passed" "$OUT/behaviour.out" || { cat "$OUT/behaviour.out" >&2; fail "behaviour did not reach its end"; }
echo "behaviour: $(grep -c '^=== ' "$OUT/behaviour.out") scenarios, all assertions passed (owner fixtures; service_role, anon and authenticated)"

# 4. the takeover race ---------------------------------------------------------
q "insert into public.media_operation_claims (org_id, operation_id, fingerprint, actor_id, claimed_at)
   values ('$ORG', 'op-race', 'fp-race', '$OWNER', now() - interval '16 minutes')" >/dev/null
CLAIM="select (public.media_claim_operation_v2('$ORG', 'op-race', 'fp-race', '$OWNER') - 'claim')::text"
# A takes the claim row over and holds its transaction open; B and C arrive
# while it is held. They wait inside INSERT ... ON CONFLICT on A's new index
# entry and read the claim only after A commits, so this race does not depend
# on the claim-row lock; 4b exercises that lock.
psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -c "begin" -c "$CLAIM" -c "select pg_sleep(1.5)" -c "commit" >"$OUT/race-a.out" &
sleep 0.5
psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -c "$CLAIM" >"$OUT/race-b.out" &
psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -c "$CLAIM" >"$OUT/race-c.out" &
wait
[ "$(cat "$OUT"/race-?.out | grep -c '"takeover": true')" = 1 ] || { cat "$OUT"/race-?.out >&2; fail "race: expected exactly one takeover"; }
[ "$(cat "$OUT"/race-?.out | grep -c '"outcome": "existing"')" = 2 ] || { cat "$OUT"/race-?.out >&2; fail "race: expected two callers to read the pending claim"; }
[ "$(cat "$OUT"/race-?.out | grep '"outcome": "existing"' | grep -c '"expires_at": "')" = 2 ] || { cat "$OUT"/race-?.out >&2; fail "race: a pending answer carries no expires_at"; }
[ "$(q "select attempt || ':' || jsonb_array_length(history) || ':' || state from public.media_operation_claims where operation_id = 'op-race'")" = "2:1:claimed" ] \
  || fail "race: the claim was taken over more than once"
echo "race: three sessions on one expired claim, exactly one takeover (attempt 2), two pending with expires_at"

# Sessions of this run that are waiting on a heavyweight lock (a row, tuple or
# transaction lock). Its callers loop inside one transaction, so each reading
# runs pg_stat_clear_snapshot() first: pg_stat_activity is otherwise read once
# per transaction and cached.
WAITING_SQL="(select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and wait_event_type = 'Lock')"

# 4b. the claim-row lock -------------------------------------------------------
# A test-only BEFORE UPDATE trigger holds the first takeover of op-race-lock
# inside its UPDATE (the claim row is locked, but no new row version or index
# entry exists yet, so INSERT ... ON CONFLICT does not wait) until both other
# sessions wait on a lock. With the FOR UPDATE on media_claim_operation_v2's
# claim-row read they wait at that read and then see the takeover; without it
# they read the expired row, wait at their own takeover UPDATE and each takes
# the claim over again behind the first. The trigger refuses to let the race go
# unexercised, and it is dropped before anything else runs.
q "create function public.test_hold_first_takeover() returns trigger language plpgsql as \$t\$
   declare v_waiting bigint := 0;
   begin
     if new.operation_id = 'op-race-lock' and old.attempt = 1 then
       for i in 1..400 loop
         perform pg_stat_clear_snapshot();
         v_waiting := $WAITING_SQL;
         exit when v_waiting >= 2;
         perform pg_sleep(0.05);
       end loop;
       if v_waiting < 2 then
         raise exception 'race fixture: % session(s), not 2, waited behind the first takeover', v_waiting;
       end if;
     end if;
     return new;
   end \$t\$;
   create trigger test_hold_first_takeover before update on public.media_operation_claims
     for each row execute function public.test_hold_first_takeover()" >/dev/null
q "insert into public.media_operation_claims (org_id, operation_id, fingerprint, actor_id, claimed_at)
   values ('$ORG', 'op-race-lock', 'fp-race-lock', '$OWNER', now() - interval '16 minutes')" >/dev/null
HELD_CLAIM="select (public.media_claim_operation_v2('$ORG', 'op-race-lock', 'fp-race-lock', '$OWNER') - 'claim')::text"
for s in a b c; do psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -c "$HELD_CLAIM" >"$OUT/lock-$s.out" 2>&1 & done
wait
q "drop trigger test_hold_first_takeover on public.media_operation_claims; drop function public.test_hold_first_takeover()" >/dev/null
LOCK_STATE="$(q "select attempt || ':' || jsonb_array_length(history) || ':' || state from public.media_operation_claims where operation_id = 'op-race-lock'")"
lock_fail() { cat "$OUT"/lock-?.out >&2; fail "claim-row lock: $1 (attempt:history:state $LOCK_STATE)"; }
[ "$(cat "$OUT"/lock-?.out | grep -c '"takeover": true')" = 1 ] || lock_fail "expected exactly one takeover"
[ "$(cat "$OUT"/lock-?.out | grep '"outcome": "existing"' | grep -c '"expires_at": "')" = 2 ] || lock_fail "expected the two others to read the pending claim, with expires_at"
[ "$LOCK_STATE" = "2:1:claimed" ] || lock_fail "the claim was taken over more than once"
echo "claim-row lock: the first takeover held inside its UPDATE while two sessions waited; exactly one takeover (attempt 2), two pending"

# 4c. the operator's bind against a same-id retry ------------------------------
# A claim that is still 'claimed' although its job exists (the winner reserved
# and stopped before the bind). The retry R holds the claim row, the first lock
# media_claim_operation_v2 takes, until the operator's bind decision O has
# locked the job row and waits for the claim row; then R repairs the claim to
# the job, and binding takes the foreign key's KEY SHARE lock on that job row.
# media_resolve_operation_job_v1 locks the job FOR NO KEY UPDATE, which does not
# conflict with KEY SHARE: R binds, then O answers already_bound. FOR UPDATE
# would make the two wait on each other until PostgreSQL aborts one (40P01).
[ "$(q "select public.media_claim_operation_v2('$ORG', 'op-race-bind', 'fp-race-bind', '$OWNER') ->> 'outcome'")" = won ] \
  || fail "bind race: the fixture claim was not won"
BIND_JOB="$(q "select id from public.media_create_budgeted_job_v2('$ORG', '$OWNER', 'fal', 'fal-ai/flux-2', 'text-to-image', 'p', '{\"prompt\":\"p\"}'::jsonb,
  jsonb_build_object('operation_id', 'op-race-bind', 'requested_by', '$OWNER', 'submit_protocol', 'cas-v1'),
  12000, 5, '{}'::jsonb, '{\"units\":1,\"unit\":\"megapixel\",\"unit_price_usd_micros\":12000}'::jsonb)")"
[ "$(q "select state || ':' || coalesce(job_id::text, 'none') from public.media_operation_claims where operation_id = 'op-race-bind'")" = "claimed:none" ] \
  || fail "bind race: the fixture claim is not open"
PGAPPNAME=media-race-retry psql -qAt -v ON_ERROR_STOP=1 -d "$DB" \
  -c "begin" \
  -c "select 'retry holds the claim row' from public.media_operation_claims where org_id = '$ORG' and operation_id = 'op-race-bind' for update" \
  -c "do \$w\$ declare v_waiting bigint := 0; begin
        for i in 1..400 loop
          perform pg_stat_clear_snapshot();
          v_waiting := $WAITING_SQL;
          exit when v_waiting >= 1;
          perform pg_sleep(0.05);
        end loop;
        if v_waiting < 1 then raise exception 'race fixture: the operator decision never waited on the claim row'; end if;
      end \$w\$" \
  -c "select 'retry: ' || (public.media_claim_operation_v2('$ORG', 'op-race-bind', 'fp-race-bind', '$OWNER') - 'claim')::text" \
  -c "commit" >"$OUT/bind-retry.out" 2>&1 &
RETRY_PID=$!
# The operator starts once the retry holds the claim row: its row lock gave it a transaction id.
held=f
for _ in $(seq 400); do
  held="$(q "select exists (select 1 from pg_stat_activity a join pg_locks l on l.pid = a.pid
    where a.datname = current_database() and a.application_name = 'media-race-retry' and l.locktype = 'transactionid' and l.granted)")"
  [ "$held" = t ] && break
  sleep 0.05
done
[ "$held" = t ] || fail "bind race: the retry never held the claim row"
psql -qAt -v ON_ERROR_STOP=1 -d "$DB" \
  -c "select 'operator: ' || (public.media_resolve_operation_job_v1('$ORG', '$BIND_JOB', 'bind', '$OWNER', 'race: bind while a retry repairs', '{}'::jsonb, null) - 'resolution' - 'claim')::text" \
  >"$OUT/bind-operator.out" 2>&1 &
OPERATOR_PID=$!
retry_status=0; wait "$RETRY_PID" || retry_status=$?
operator_status=0; wait "$OPERATOR_PID" || operator_status=$?
bind_fail() {
  { echo "retry (exit $retry_status):"; cat "$OUT/bind-retry.out"; echo "operator (exit $operator_status):"; cat "$OUT/bind-operator.out"; } >&2
  fail "bind race: $1"
}
[ "$retry_status" = 0 ] && [ "$operator_status" = 0 ] || bind_fail "a session failed (a deadlock, 40P01, when the decision locks the job FOR UPDATE)"
grep -q '^retry: .*"repaired": true' "$OUT/bind-retry.out" || bind_fail "the retry did not repair the claim to its job"
grep -q '^operator: .*"outcome": "already_bound"' "$OUT/bind-operator.out" || bind_fail "the operator's bind did not find the claim bound to its job"
[ "$(q "select state || ':' || job_id from public.media_operation_claims where operation_id = 'op-race-bind'")" = "bound:$BIND_JOB" ] || bind_fail "the claim is not bound to the job"
[ "$(q "select routing -> 'operator_resolution' ->> 'decision' from public.media_jobs where id = '$BIND_JOB'")" = bind ] || bind_fail "the decision is not recorded on the job"
echo "bind race: an operator bind and a same-id retry on one open claim, no deadlock; the retry repaired it, the operator answered already_bound"

# 5. rollback ------------------------------------------------------------------
apply supabase/pending/media_operation_claims_v2.rollback.sql
[ "$(q "$V2_FUNCTIONS")" = 0 ] || fail "rollback left v2 functions"
[ "$(q "$V2_INDEXES")" = 0 ] || fail "rollback left v2 indexes"
[ "$(q "$V1_COLUMNS")" = "$columns_before" ] || fail "rollback: the claims table is not v1's 11 columns: $(q "$V1_COLUMNS")"
[ "$(q "$FROZEN")" = "$frozen_before" ] || fail "rollback touched a v1, 0053 or 0054 function"
[ "$(q "select count(*) > 0 from public.media_operation_claims")" = t ] || fail "rollback removed claim rows"
[ "$(q "select (public.media_claim_operation_v1('$ORG', 'op-after-rollback', 'fp', '$OWNER') ->> 'outcome')")" = won ] \
  || fail "rollback: the v1 claim no longer works"
echo "rollback: six functions, four columns and four indexes gone; v1, 0053 and 0054 untouched; claim rows kept"
apply supabase/pending/media_operation_claims_v2.rollback.sql

# 6. the file again ------------------------------------------------------------
apply "$V2"
[ "$(q "$V2_FUNCTIONS")" = 6 ] && [ "$(q "$V2_INDEXES")" = 4 ] || fail "re-apply did not restore the v2 objects"
[ "$(q "select (public.media_claim_operation_v2('$ORG', 'op-after-rollback', 'fp', '$OWNER') -> 'claim' ->> 'attempt')")" = 1 ] \
  || fail "re-apply: a claim made under v1 did not get attempt 1"
echo "re-applied on the rolled-back database"

# 7. the duplicate guards ------------------------------------------------------
refused() { # $1 = text the guard must print
  if PGOPTIONS="--client-min-messages=warning" psql -q -1 -v ON_ERROR_STOP=1 -d "$DB" -f "$V2" >/dev/null 2>"$OUT/guard.err"; then
    fail "the guard did not fire: $1"
  fi
  grep -q "$1" "$OUT/guard.err" || { cat "$OUT/guard.err" >&2; fail "the guard printed something else"; }
}
q "drop index public.media_jobs_org_operation_uidx" >/dev/null
q "drop index public.media_operation_claims_claimed_idx" >/dev/null
q "insert into public.media_jobs (org_id, provider, provider_model_id, capability, routing) values
   ('$ORG', 'openai', 'x', 'c', '{\"operation_id\":\"dup\"}'), ('$ORG', 'openai', 'x', 'c', '{\"operation_id\":\"dup\"}')" >/dev/null
refused "more than one job for one (org_id, operation_id)"
[ "$(q "$V2_INDEXES")" = 2 ] || fail "a refused apply built an index"
q "delete from public.media_jobs where routing ->> 'operation_id' = 'dup'" >/dev/null
apply "$V2"
q "drop index public.media_jobs_provider_request_uidx" >/dev/null
q "drop index public.media_jobs_org_operation_uidx" >/dev/null
q "insert into public.media_jobs (org_id, provider, provider_model_id, capability, provider_request_id) values
   ('$ORG', 'openai', 'x', 'c', 'dup-request'), ('$ORG', 'openai', 'x', 'c', 'dup-request')" >/dev/null
refused "more than one job for one (provider, provider_request_id)"
# one transaction: the first guard passed and its index was built, then the second guard undid it
[ "$(q "$V2_INDEXES")" = 2 ] || fail "a refused apply left the first unique index behind"
q "delete from public.media_jobs where provider_request_id = 'dup-request'" >/dev/null
apply "$V2"
[ "$(q "$V2_INDEXES")" = 4 ] || fail "the indexes are not back after the duplicates were resolved"
echo "guards: a duplicate (org_id, operation_id) and a duplicate (provider, provider_request_id) each stop the whole file"
echo "media recovery: ok"
