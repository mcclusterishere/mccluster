#!/usr/bin/env bash
# supabase/pending/20261128090000_storage_public_bucket_listing_v1.sql on a throwaway local
# Postgres (16+), never production: stub of production's policies, the finding reproduced,
# apply, behaviour, rollback (the finding is back), re-apply twice (idempotent), behaviour again.
# Usage: PGHOST=/var/tmp/pg PGPORT=5497 PGUSER=postgres scripts/test-storage-listing-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
P=supabase/pending
T=supabase/tests
F=$P/20261128090000_storage_public_bucket_listing_v1.sql
R=$P/20261128090000_storage_public_bucket_listing_v1.rollback.sql
db="storage_listing_$$"
trap 'psql -q -d postgres -c "drop database if exists $db" >/dev/null' EXIT
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $db" >/dev/null
run() { for f in "$@"; do psql -X -q -1 -v ON_ERROR_STOP=1 -d "$db" -f "$f" >/dev/null; done; }
check() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$db" -f "$1" | grep -E ': ok$'; }
anon_sees() { psql -X -q -t -A -v ON_ERROR_STOP=1 -d "$db" -c "select t_as('anon'); select count(*) from storage.objects;" | tail -1; }

run $T/supabase_api_roles.stub.sql $T/schema_test_helpers.sql $T/supabase_storage.stub.sql $T/storage_public_bucket_listing_v1.stub.sql
[ "$(anon_sees)" = 8 ] && echo "production today: anon lists all 8 files: ok"
run "$F"
check $T/storage_public_bucket_listing_v1.behaviour.sql
run "$R"
[ "$(anon_sees)" -gt 0 ] && echo "rollback restores the bucket-wide reads: ok"
run "$F" "$F"
check $T/storage_public_bucket_listing_v1.behaviour.sql
echo "storage_public_bucket_listing_v1: all ok"
