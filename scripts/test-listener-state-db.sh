#!/usr/bin/env bash
# Test only in an isolated scratch Postgres, never against production.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="listener_state_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase_api_roles.stub.sql >/dev/null
# The existing pending migration must be idempotent and must not grant anon access.
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/20261021125121_listener_state_v1.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/20261021125121_listener_state_v1.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/listener_state.behaviour.sql
echo 'listener state: auth/RLS/upsert/size/cross-session checks passed'
