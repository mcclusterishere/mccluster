#!/usr/bin/env bash
# The member-front schema production actually has (supabase/migrations/20261124164026_member_fronts_shared_revision_directory.sql)
# against a throwaway local Postgres (16+), with the Supabase role and Storage stand-ins, then the Worker's write shape,
# the database's public read and the browser's uploads (supabase/tests/member_fronts_applied_worker.behaviour.sql).
# Test only in an isolated scratch Postgres, never against production.
# Usage: PGHOST=/var/tmp/pg PGPORT=5497 PGUSER=postgres scripts/test-member-fronts-applied-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
DB="member_fronts_applied_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase_api_roles.stub.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase_storage.stub.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/member_fronts_applied.prereq.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/20261124164026_member_fronts_shared_revision_directory.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -At -d "$DB" -f supabase/tests/member_fronts_applied_worker.behaviour.sql
