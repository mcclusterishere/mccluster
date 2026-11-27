#!/usr/bin/env bash
# Runs the Equity Uprise fellow onboarding (supabase/pending/eu_fellow_onboarding_v1.sql)
# and its behaviour tests against a throwaway local Postgres (16+), as the
# real API roles. The chain: the role stub, the member-network table stub, the
# Action Network cohorts (gamification v1), Cohort 1's campaign row, then the
# pending file twice (it must be idempotent), then the behaviour tests, then
# the rollback and a re-apply. Touches nothing remote.
# Usage:
#   PGHOST=/var/tmp/pg PGPORT=5497 PGUSER=postgres scripts/test-eu-fellow-onboarding-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
DB="eu_fellow_onboarding_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/mnet_network_tables.stub.sql
apply supabase/migrations/20261002061056_action_network_gamification_v1.sql
# Cohort 1's campaign (20261005054036_equity_uprise_group_docket_516r): only its id
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "insert into public.action_campaigns(id) values ('equity-uprise-003') on conflict do nothing" >/dev/null
apply supabase/pending/eu_fellow_onboarding_v1.sql
apply supabase/pending/eu_fellow_onboarding_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f supabase/tests/eu_fellow_onboarding.behaviour.sql
echo "rollback refuses while the 2026 roster has fellows, as designed:"
if psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/pending/eu_fellow_onboarding_v1.rollback.sql >/dev/null 2>&1; then
  echo "rollback should have refused"; exit 1; fi
echo "  refused"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "delete from public.action_cohort_members where cohort_id='a8813ab5-f066-47c2-976c-c19581b3cb71'" >/dev/null
apply supabase/pending/eu_fellow_onboarding_v1.rollback.sql
apply supabase/pending/eu_fellow_onboarding_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -tA -c "select case when count(*)=1 then 'cohort 2026 re-seeded' else 'cohort 2026 missing' end from public.eu_fellow_cohorts" 
echo "eu fellow onboarding: ok"
