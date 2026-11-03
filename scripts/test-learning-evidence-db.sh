#!/usr/bin/env bash
# Runs supabase/migrations/20261103160000_learning_evidence_v1.sql and its behaviour
# tests against a throwaway local Postgres (16+) as the real API roles:
#   1. stubs + migration, applied twice (idempotent);
#   2. supabase/tests/learning_evidence.behaviour.sql.
# Usage:
#   PGHOST=/var/tmp/pg PGPORT=5497 PGUSER=postgres scripts/test-learning-evidence-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
DB="learning_evidence_test_$$"
cleanup() { psql -q -d postgres -c "drop database if exists $DB" >/dev/null; }
trap cleanup EXIT
apply() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/supabase_storage.stub.sql
apply supabase/tests/learning_evidence.stub.sql
apply supabase/migrations/20261103160000_learning_evidence_v1.sql
apply supabase/migrations/20261103160000_learning_evidence_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f supabase/tests/learning_evidence.behaviour.sql
echo "learning evidence: ok"
