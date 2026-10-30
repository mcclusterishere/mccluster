#!/usr/bin/env bash
# Runs supabase/pending/merch_marketplace_v1.sql (PENDING, not applied in
# production) and its behaviour tests against a throwaway local Postgres
# (16+), as the real API roles: the API role stub, the marketplace stub
# (orgs, org_members, org_stripe_accounts, control_audit, storage), the
# pending file twice (it must be safe to re-run), the behaviour file, then
# the rollback and the file again (rollback is clean and re-apply works).
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=postgres scripts/test-merch-marketplace-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="merch_marketplace_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { PGOPTIONS="--client-min-messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/merch_marketplace.stub.sql
apply supabase/pending/merch_marketplace_v1.sql
apply supabase/pending/merch_marketplace_v1.sql
apply supabase/tests/merch_marketplace.behaviour.sql
apply supabase/pending/merch_marketplace_v1.rollback.sql
apply supabase/pending/merch_marketplace_v1.sql
echo "merch marketplace v1: ok"
