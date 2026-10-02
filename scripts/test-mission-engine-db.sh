#!/usr/bin/env bash
# Runs the Mission Engine migration and its behaviour tests against a
# throwaway local Postgres (16+), as the real API roles. Usage:
#   PGHOST=/tmp PGPORT=5499 PGUSER=postgres scripts/test-mission-engine-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="mission_engine_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase_api_roles.stub.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/20261002061056_action_network_gamification_v1.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/action_mission_engine.behaviour.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/20261002063754_action_network_fellowship_v1.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/action_fellowship.behaviour.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/pending_migrations/action_network_demographics_antiracism_v1.sql >/dev/null
echo "demographics migration still applies on top"
