#!/usr/bin/env bash
# Applies Whip's schema (supabase/replay_migrations/0037_whip_mobility.sql),
# then the pending supabase/pending/whip_driver_application_consent_v1.sql
# twice, its behaviour test, the rollback, and the pending file again, on a
# throwaway local Postgres (16+).
# Usage: PGHOST=/var/tmp/pg PGPORT=5497 PGUSER=postgres scripts/test-whip-driver-consent-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
DB="whip_consent_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/replay_migrations/0037_whip_mobility.sql
apply supabase/pending/whip_driver_application_consent_v1.sql
apply supabase/pending/whip_driver_application_consent_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/whip_driver_application_consent.behaviour.sql
apply supabase/pending/whip_driver_application_consent_v1.rollback.sql
test "$(psql -tA -d "$DB" -c "select count(*) from information_schema.columns where table_name='drivers' and column_name like 'application_consent%'")" = "0"
echo "rollback removes the columns: ok"
apply supabase/pending/whip_driver_application_consent_v1.sql
echo "whip driver application consent: ok"
