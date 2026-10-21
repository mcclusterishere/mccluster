#!/usr/bin/env bash
# Geographic audience contracts against a throwaway local Postgres database.
set -euo pipefail
cd "$(dirname "$0")/.."
DB="analytics_geo_audience_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase_api_roles.stub.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/analytics_geo_audience.behaviour.sql
