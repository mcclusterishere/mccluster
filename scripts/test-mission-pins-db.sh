#!/usr/bin/env bash
# Runs supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql
# and its behaviour tests against a throwaway local Postgres (16+), as the real
# API roles. The chain reproduces production's 2026-10-15 shape: the role stub,
# the member-network stub, the gamification migration, the globe region,
# activation and join-authorization migrations, the pins stub (organizations,
# control_audit, the seven curated missions), the already-applied demo pins,
# then the pending file TWICE (it must be idempotent), then the tests.
# Usage:
#   PGHOST=/var/tmp/pg PGPORT=5499 PGUSER=postgres scripts/test-mission-pins-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="mission_pins_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/mnet_network_tables.stub.sql
apply supabase/migrations/20261002061056_action_network_gamification_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "alter table public.action_missions add column if not exists kind text not null default 'civic'" >/dev/null
apply supabase/migrations/20261014013557_action_globe_regions.sql
apply supabase/migrations/20261014014547_action_globe_region_activation.sql
apply supabase/migrations/20261014184518_action_globe_join_authorization.sql
apply supabase/tests/action_mission_pins.stub.sql
apply supabase/tests/action_globe_demo_pins_v1.applied.sql
apply supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql
apply supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/action_mission_pins_arcs_business.behaviour.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/action_globe_join_authorization.behaviour.sql >/dev/null
echo "existing join-authorization audit still passes"
echo "mission pins chain: ok"
