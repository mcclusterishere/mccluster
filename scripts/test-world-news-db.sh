#!/usr/bin/env bash
# Runs the World's GDELT news SQL and its behaviour tests against a throwaway
# local Postgres (16+), as the real API roles:
#   the API role stub (plus auth.role() and the two civic tables #432's media
#   graph references), ChatGPT's #432 media namespace (the five 20261014
#   migrations, unchanged), then the pending world_gdelt_gkg_news_v1.sql,
#   then the behaviour tests.
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=pg scripts/test-world-news-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="world_news_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { psql -q -v ON_ERROR_STOP=1 --single-transaction -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
apply supabase/tests/supabase_api_roles.stub.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null <<'SQL'
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') $$;
grant execute on function auth.role() to anon, authenticated, service_role;
create table public.civic_jurisdictions(id uuid primary key default gen_random_uuid());
create table public.civic_offices(id uuid primary key default gen_random_uuid());
SQL
apply supabase/migrations/20261014021258_candidate_labs_media_graph.sql
apply supabase/migrations/20261014023302_media_geo_ingestion.sql
apply supabase/migrations/20261014023317_media_ingest_rpc.sql
apply supabase/migrations/20261014023548_media_news_namespace.sql
apply supabase/migrations/20261014023813_gdelt_backoff_cache.sql
apply supabase/pending/world_gdelt_gkg_news_v1.sql
# applied twice: the file is safe to re-run
apply supabase/pending/world_gdelt_gkg_news_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -o /dev/null -f supabase/tests/world_gdelt_gkg_news.behaviour.sql
echo "world news chain: ok"
