#!/usr/bin/env bash
# Builds the intel -> mission canon on a throwaway local Postgres (16+) as the
# real API roles and runs its behaviour test. Never touches a real project.
#   the API role stub, the tenancy + ops_ingest stub, the applied
#   ai_context.decisions migration, the applied Action Network gamification
#   migration, then the pending canon, then the behaviour test, then the
#   rollback (and the canon again, to prove the rollback is clean).
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=pg scripts/test-intel-canon-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="intel_canon_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/intel_canon_deps.stub.sql
# replay copy: the ledger copy keeps the dollar quoting exactly as production recorded it, which plain psql does not parse
apply supabase/replay_migrations/20261005063813_canonical_ai_context_decisions_v1.sql
apply supabase/migrations/20261002061056_action_network_gamification_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "alter table public.action_missions add column if not exists kind text not null default 'civic'" >/dev/null
apply supabase/pending/20261015210000_intel_mission_canon_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/intel_mission_canon.behaviour.sql
apply supabase/pending/20261015210000_intel_mission_canon_v1.rollback.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -At -c "select 'intel tables after rollback: ' || count(*) from pg_tables where schemaname='public' and tablename like 'intel\_%'"
apply supabase/pending/20261015210000_intel_mission_canon_v1.sql
echo "intel canon chain: ok"
