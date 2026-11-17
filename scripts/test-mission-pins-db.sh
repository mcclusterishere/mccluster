#!/usr/bin/env bash
# Runs supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql
# and its behaviour tests against a throwaway local Postgres (16+), as the real
# API roles. The chain reproduces production's 2026-10-15 shape: the role stub,
# the member-network stub, the gamification migration, the globe region,
# activation and join-authorization migrations, the pins stub (organizations,
# control_audit, the seven curated missions), the already-applied demo pins,
# then the pending file TWICE (it must be idempotent), then the tests.
# It runs the chain twice: as above, then with the minimal join scope extract
# (20261117100000_action_globe_join_scope_v1.sql) applied first, which must
# leave the whole pins file free to follow it. After the pins file, the
# extract and its rollback must both refuse, changing nothing: either would
# put an older join_action_mission over the pins file's, which also checks a
# mission arc's earlier step.
# Usage:
#   PGHOST=/var/tmp/pg PGPORT=5499 PGUSER=postgres scripts/test-mission-pins-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="mission_pins_test_$$"
DB2="mission_pins_scope_test_$$"
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null; psql -q -d postgres -c "drop database if exists $DB2" >/dev/null' EXIT
# The two join functions' bodies and the pin table's columns and constraints, as one line.
fingerprint() {
  psql -At -v ON_ERROR_STOP=1 -d "$1" -c "select string_agg(x, ' | ' order by x) from (
      select p.oid::regprocedure::text || ' ' || md5(p.prosrc) as x from pg_proc p
       where p.oid in ('public.join_action_mission(uuid)'::regprocedure, 'public.action_globe_can_join_mission(uuid,uuid)'::regprocedure)
      union all
      select 'column ' || column_name::text from information_schema.columns
       where table_schema = 'public' and table_name = 'action_globe_mission_regions'
      union all
      select 'constraint ' || conname::text from pg_constraint where conrelid = 'public.action_globe_mission_regions'::regclass) s"
}
refused_after_pins() {
  local db="$1" file="$2" out
  if out=$(psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$file" 2>&1); then
    echo "FAIL: $file ran on top of the whole pins file" >&2; exit 1
  fi
  if ! grep -q 'refused: join_action_mission' <<<"$out"; then
    echo "FAIL: $file failed for another reason: $out" >&2; exit 1
  fi
  echo "refused on top of the whole pins file, as it must: $file"
}
chain() {
  local db="$1" first="${2:-}"
  psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $db" >/dev/null
  apply() { psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$1" >/dev/null; echo "applied $1"; }
  apply supabase/tests/supabase_api_roles.stub.sql
  apply supabase/tests/mnet_network_tables.stub.sql
  apply supabase/migrations/20261002061056_action_network_gamification_v1.sql
  psql -q -v ON_ERROR_STOP=1 -d "$db" -c "alter table public.action_missions add column if not exists kind text not null default 'civic'" >/dev/null
  apply supabase/migrations/20261014013557_action_globe_regions.sql
  apply supabase/migrations/20261014014547_action_globe_region_activation.sql
  apply supabase/migrations/20261014184518_action_globe_join_authorization.sql
  apply supabase/tests/action_mission_pins.stub.sql
  apply supabase/tests/action_globe_demo_pins_v1.applied.sql
  if [ -n "$first" ]; then apply "$first"; fi
  apply supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql
  apply supabase/pending/20261015230000_action_mission_pins_arcs_black_business.sql
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/tests/action_mission_pins_arcs_business.behaviour.sql
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/tests/action_globe_join_authorization.behaviour.sql >/dev/null
  if [ -n "$first" ]; then
    local before
    before=$(fingerprint "$db")
    refused_after_pins "$db" "$first"
    refused_after_pins "$db" "${first%.sql}.rollback.sql"
    if [ "$(fingerprint "$db")" != "$before" ]; then
      echo "FAIL: a refused file changed the join functions or the pin table" >&2; exit 1
    fi
    if [ "$(psql -At -d "$db" -c "select prosrc like '%action_mission_arc_unlocked%' from pg_proc where oid = 'public.join_action_mission(uuid)'::regprocedure")" != t ]; then
      echo "FAIL: the pins file's join lost its arc check" >&2; exit 1
    fi
    echo "the pins file's join, with its arc check, is untouched"
  fi
}
chain "$DB"
echo "existing join-authorization audit still passes"
echo "mission pins chain: ok"
chain "$DB2" supabase/pending/20261117100000_action_globe_join_scope_v1.sql
echo "mission pins chain on top of the minimal join scope (20261117100000): ok"
