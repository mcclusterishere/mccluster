#!/usr/bin/env bash
# Runs supabase/tests/analytics_country.behaviour.sql (the pending
# analytics_country_v1 reads) against a throwaway local Postgres (16+).
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=pg scripts/test-analytics-country-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="analytics_country_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase_api_roles.stub.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/analytics_country.behaviour.sql
