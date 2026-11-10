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
# A takes the claim row and holds it; B and C arrive while it is held.
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
