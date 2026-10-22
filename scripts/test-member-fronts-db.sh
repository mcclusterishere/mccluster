#!/usr/bin/env bash
# Every account's front page (supabase/pending/member_fronts_v1.sql) against a throwaway local Postgres (16+), as the
# real API roles, with the Supabase role and Storage stand-ins. The file is applied twice (idempotent), then
# supabase/tests/member_fronts.behaviour.sql. Test only in an isolated scratch Postgres, never against production.
# Usage: PGHOST=/var/tmp/pg PGPORT=5497 PGUSER=postgres scripts/test-member-fronts-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
DB="member_fronts_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase_api_roles.stub.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase_storage.stub.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/pending/member_fronts_v1.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/pending/member_fronts_v1.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/member_fronts.behaviour.sql
