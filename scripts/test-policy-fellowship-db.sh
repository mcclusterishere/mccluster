#!/usr/bin/env bash
# Runs the Policy Fellowship ladder (supabase/pending/policy_fellowship_ladder_v1.sql)
# and its behaviour tests against a throwaway local Postgres (16+), as the
# real API roles. The chain: the role stub, the member-network table stub
# (network_notifications), the mission engine, proof review history, the
# fellowship, cohort admission, globe regions, the policy registry, then the
# pending ladder, then supabase/tests/policy_fellowship_ladder.behaviour.sql.
# Usage:
#   PGHOST=/var/tmp/pg PGPORT=5497 PGUSER=postgres scripts/test-policy-fellowship-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
DB="policy_ladder_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/mnet_network_tables.stub.sql
apply supabase/migrations/20261002061056_action_network_gamification_v1.sql
apply supabase/migrations/20261004015451_action_proof_retry_and_review_notifications_v1.sql
apply supabase/migrations/20261002063754_action_network_fellowship_v1.sql
apply supabase/migrations/20261005054040_action_cohort_admission_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "alter table public.action_missions add column if not exists kind text not null default 'civic'" >/dev/null
apply supabase/migrations/20261014013557_action_globe_regions.sql
apply supabase/migrations/20261014020454_action_policy_memo_bounties.sql
# creator accounts: only the columns the ladder's creator_exclusive switch reads
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "create table if not exists public.creator_billing_subscriptions(stripe_subscription_id text primary key, owner_user_id uuid, status text, current_period_end timestamptz)" >/dev/null
apply supabase/pending/policy_fellowship_ladder_v1.sql
# applying twice must be harmless
apply supabase/pending/policy_fellowship_ladder_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/policy_fellowship_ladder.behaviour.sql
echo "policy fellowship ladder: ok"
