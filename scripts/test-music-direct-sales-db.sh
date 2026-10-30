#!/usr/bin/env bash
# Runs supabase/pending/music_direct_sales_v1.sql and its behaviour tests against a
# throwaway local Postgres (16+), as the real API roles: the API role stub, the
# production shape of the three music_direct_* tables (lifted verbatim from
# supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql),
# a minimal public.music_catalog_objects, then the file (twice: it must be safe to
# re-run), the behaviour test, the rollback, the file again and the behaviour again.
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=postgres scripts/test-music-direct-sales-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="music_direct_sales_$$"
TMP="$(mktemp -d)"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null; rm -rf "$TMP"' EXIT
apply() { PGOPTIONS="--client-min-messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }

# the production tables, exactly as the replay migration creates them
awk '/^-- -+ music direct sales$/{on=1} /^-- -+ the ISRC registry$/{on=0} on' \
  supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql > "$TMP/direct_tables.sql"
grep -q 'create table public.music_direct_entitlements' "$TMP/direct_tables.sql" || { echo "could not lift the music_direct tables from the replay migration" >&2; exit 1; }

apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/music_direct_sales.stub.sql
apply "$TMP/direct_tables.sql"
apply supabase/pending/music_direct_sales_v1.sql
apply supabase/pending/music_direct_sales_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_direct_sales.behaviour.sql >/dev/null
echo "behaviour: ok"
apply supabase/pending/music_direct_sales_v1.rollback.sql
apply supabase/pending/music_direct_sales_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_direct_sales.behaviour.sql >/dev/null
echo "behaviour after rollback + re-apply: ok"
echo "music direct sales: ok"
