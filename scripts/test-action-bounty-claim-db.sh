#!/usr/bin/env bash
# Isolated contract regression. Requires a local scratch PostgreSQL server.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="bounty_claim_guard_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; }
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/action_bounty_claim_guard.stub.sql
apply supabase/pending/action_bounty_claim_existing_row_guard_v1.sql
apply supabase/pending/action_bounty_claim_existing_row_guard_v1.sql
apply supabase/tests/action_bounty_claim_guard.behaviour.sql
echo 'bounty claim existence guard: ok'
