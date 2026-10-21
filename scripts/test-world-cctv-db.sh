#!/usr/bin/env bash
# Runs the World CCTV eligibility behaviour tests against a throwaway local
# Postgres (16+), as the real API roles: the role and member-network stubs, the gamification and
# proof-review migrations, the clip-mission kind column, then
# supabase/tests/world_cctv_eligibility.behaviour.sql (no pending SQL: location
# consent is the privacy acknowledgement on the member's auth record).
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=pg scripts/test-world-cctv-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="world_cctv_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/mnet_network_tables.stub.sql
apply supabase/migrations/20261002061056_action_network_gamification_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "alter table public.action_missions add column if not exists kind text not null default 'civic'" >/dev/null
apply supabase/migrations/20261004015451_action_proof_retry_and_review_notifications_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/world_cctv_eligibility.behaviour.sql
echo "world cctv eligibility chain: ok"
