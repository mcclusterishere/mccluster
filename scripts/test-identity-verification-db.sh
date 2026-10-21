#!/usr/bin/env bash
# Runs the identity verification levels migration
# (supabase/pending/20261015230000_identity_verification_levels_v1.sql) and its
# behaviour tests against throwaway local Postgres databases (16+), as the
# real API roles. The chain is the Policy Fellowship ladder's
# (scripts/test-policy-fellowship-db.sh; this file extends that one's tables)
# plus a Storage stub. Steps:
#   1. chain + ladder + this file, applied twice (idempotent);
#   2. supabase/tests/identity_verification_levels.behaviour.sql;
#   3. the rollback file, then the ladder and this file again (round trip);
#   4. a second database: chain + ladder + this file, then the LADDER's own
#      behaviour tests, so extending its tables broke nothing.
# Usage:
#   PGHOST=/var/tmp/pg PGPORT=5497 PGUSER=postgres scripts/test-identity-verification-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
DB="identity_levels_test_$$"
DB2="identity_levels_ladder_$$"
cleanup() { psql -q -d postgres -c "drop database if exists $DB" >/dev/null; psql -q -d postgres -c "drop database if exists $DB2" >/dev/null; }
trap cleanup EXIT
apply() { psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; echo "applied $2 ($1)"; }
sql() { psql -q -v ON_ERROR_STOP=1 -d "$1" -c "$2" >/dev/null; }
build() {
  local db="$1"
  psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $db" >/dev/null
  apply "$db" supabase/tests/supabase_api_roles.stub.sql
  apply "$db" supabase/tests/supabase_storage.stub.sql
  apply "$db" supabase/tests/mnet_network_tables.stub.sql
  apply "$db" supabase/migrations/20261002061056_action_network_gamification_v1.sql
  apply "$db" supabase/migrations/20261004015451_action_proof_retry_and_review_notifications_v1.sql
  apply "$db" supabase/migrations/20261002063754_action_network_fellowship_v1.sql
  apply "$db" supabase/migrations/20261005054040_action_cohort_admission_v1.sql
  sql "$db" "alter table public.action_missions add column if not exists kind text not null default 'civic'"
  apply "$db" supabase/migrations/20261014013557_action_globe_regions.sql
  apply "$db" supabase/migrations/20261014020454_action_policy_memo_bounties.sql
  sql "$db" "create table if not exists public.creator_billing_subscriptions(stripe_subscription_id text primary key, owner_user_id uuid, status text, current_period_end timestamptz)"
  sql "$db" "create table if not exists public.action_participants(campaign_id text not null, user_id uuid not null, referral_code text not null unique, referred_by text, primary key (campaign_id, user_id))"
  apply "$db" supabase/pending/policy_fellowship_ladder_v1.sql
  apply "$db" supabase/pending/20261015230000_identity_verification_levels_v1.sql
}

build "$DB"
# applying twice must be harmless
apply "$DB" supabase/pending/20261015230000_identity_verification_levels_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/identity_verification_levels.behaviour.sql
echo "identity verification levels behaviour: ok"

# round trip on a database that holds rows (videos emptied first, as the rollback says)
sql "$DB" "delete from storage.objects where bucket_id = 'identity-verification-videos'"
apply "$DB" supabase/pending/20261015230000_identity_verification_levels_v1.rollback.sql
sql "$DB" "do \$\$ begin if to_regclass('public.identity_submissions') is not null then raise exception 'rollback left identity_submissions'; end if; end \$\$"
apply "$DB" supabase/pending/policy_fellowship_ladder_v1.sql
apply "$DB" supabase/pending/20261015230000_identity_verification_levels_v1.sql
echo "rollback and re-apply: ok"

build "$DB2"
psql -q -v ON_ERROR_STOP=1 -d "$DB2" -f supabase/tests/policy_fellowship_ladder.behaviour.sql
echo "policy fellowship ladder behaviour with identity levels applied: ok"
echo "identity verification levels: ok"
