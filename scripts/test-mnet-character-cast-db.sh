#!/usr/bin/env bash
# The MNET character cast (supabase/pending/mnet_character_cast_v1.sql) against a throwaway local Postgres (16+),
# as the real API roles, with stand-ins for the tables it touches. Applied twice (idempotent), behaviour,
# rollback, re-applied, behaviour again. Test only in an isolated scratch Postgres, never against production.
# Usage: PGHOST=/var/run/postgresql PGUSER=postgres scripts/test-mnet-character-cast-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
run() {
  local db="$1"
  psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $db" >/dev/null
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/tests/supabase_api_roles.stub.sql >/dev/null
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/tests/mnet_character_cast.stub.sql >/dev/null
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/pending/mnet_character_cast_v1.sql >/dev/null
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/pending/mnet_character_cast_v1.sql >/dev/null
  if [ "${2:-}" = "rollback" ]; then
    psql -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/pending/mnet_character_cast_v1.rollback.sql >/dev/null
    psql -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/pending/mnet_character_cast_v1.sql >/dev/null
  fi
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f supabase/tests/mnet_character_cast.behaviour.sql
}
A="mnet_character_cast_test_$$"; B="${A}_rb"
trap 'psql -q -d postgres -c "drop database if exists $A" >/dev/null; psql -q -d postgres -c "drop database if exists $B" >/dev/null' EXIT
run "$A"
run "$B" rollback
