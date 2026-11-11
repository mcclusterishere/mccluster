#!/usr/bin/env bash
# Step 0 (supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql) against a
# throwaway local Postgres (16+), never production: the production-only objects come out exactly as the
# latest production evidence records them, and a second application changes nothing.
# Usage: PGHOST=/var/tmp/pg PGPORT=5497 PGUSER=postgres scripts/test-schema-reconcile-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
DB="schema_reconcile_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
SCHEMA_RECONCILE_DB_URL="postgresql://${PGUSER:-postgres}@/${DB}?host=${PGHOST:-/var/run/postgresql}&port=${PGPORT:-5432}" \
  node scripts/test/schema-reconcile-db.mjs
