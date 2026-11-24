#!/usr/bin/env bash
# Shared platform verification support used by Equity Uprise; no building capability.
# Full-reset companion to the native race proof. Only the disposable CI database.
set -euo pipefail
case "${RESET_DB_URL:-}" in
  postgresql://postgres:postgres@127.0.0.1:54322/postgres) ;;
  *) echo 'RESET_DB_URL must name the isolated localhost:54322 CI reset.' >&2; exit 2 ;;
esac
unset PGHOST PGHOSTADDR PGSERVICE PGSERVICEFILE
cd "$(dirname "$0")/.."
query() { psql "$RESET_DB_URL" -X -q -A -t -v ON_ERROR_STOP=1 -c "$1"; }
apply() { psql "$RESET_DB_URL" -X -q -1 -v ON_ERROR_STOP=1 -f "$1" >/dev/null; }
test "$(query "select to_regclass('supabase_migrations.schema_migrations') is not null")" = t
names=(
  core_reflection_read_indexes_v1
  ops_signals_digest_window_unique_v1
  world_publisher_verified_geo_v1
  20261022015000_market_layer1_preserve_source_policy
)
for pass in 1 2; do
  for name in "${names[@]}"; do apply "supabase/pending/$name.sql"; done
  psql "$RESET_DB_URL" -X -q -v ON_ERROR_STOP=1 -f supabase/tests/small_pending_migrations.integration.sql
done

# The behavior fixture rolled back its synthetic writes. Recovery may remove
# optional indexes/empty attributes, but never erase canonical connector rows.
connector_count=$(query 'select count(*) from public.ops_ingest_connectors')
connector_before=$(query "select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from public.ops_ingest_connectors c")
helper_before=$(query "select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb)'::regprocedure")
recovery_log=$(mktemp)
trap 'rm -f "$recovery_log"' EXIT
for pass in 1 2; do
  for name in core_reflection_read_indexes_v1 ops_signals_digest_window_unique_v1 world_publisher_verified_geo_v1; do
    apply "supabase/pending/$name.rollback.sql"
  done
  if test "$connector_count" -eq 0; then
    apply supabase/pending/20261022015000_market_layer1_preserve_source_policy.rollback.sql
  else
    if apply supabase/pending/20261022015000_market_layer1_preserve_source_policy.rollback.sql >"$recovery_log" 2>&1; then
      echo 'Connector recovery unexpectedly ignored canonical policy records.' >&2; exit 1
    fi
    if ! rg -q 'PENDING_ROLLBACK_DATA_PRESENT: retain connector policy protection' "$recovery_log"; then
      cat "$recovery_log" >&2; exit 1
    fi
    test "$(query "select encode(sha256(convert_to(prosrc,'UTF8')),'hex') from pg_proc where oid='private.ops_ingest_ensure_connector(uuid,text,text,text,text,jsonb,jsonb)'::regprocedure")" = "$helper_before"
  fi
done
test "$(query "select md5(coalesce(jsonb_agg(to_jsonb(c) order by id)::text,'[]')) from public.ops_ingest_connectors c")" = "$connector_before"
for name in "${names[@]}"; do apply "supabase/pending/$name.sql"; done
psql "$RESET_DB_URL" -X -q -v ON_ERROR_STOP=1 -f supabase/tests/small_pending_migrations.integration.sql
echo 'Four optional repairs: complete reset behavior, repeatable recovery/refusal, retained canonical policies and reapply passed.'
