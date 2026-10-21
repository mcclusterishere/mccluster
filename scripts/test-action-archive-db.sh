#!/usr/bin/env bash
# Applies the archive migration twice, then tests real database permissions and
# claim/reseed behavior in a new, throwaway LOCAL PostgreSQL database.
# Usage: PGHOST=/tmp/pg PGPORT=5432 PGUSER=postgres bash scripts/test-action-archive-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
archive_pg_host="${PGHOST:-127.0.0.1}"
case "$archive_pg_host" in
  localhost|127.0.0.1|::1|/*) ;;
  *) echo 'This regression gate requires a local scratch PostgreSQL server.' >&2; exit 1 ;;
esac
archive_db="action_archive_test_$$"
archive_catalog_db="action_catalog_test_$$"
archive_psql=(psql -X -q -h "$archive_pg_host" -p "${PGPORT:-5432}" -U "${PGUSER:-postgres}" -v ON_ERROR_STOP=1)
"${archive_psql[@]}" -d postgres -c "create database $archive_db" >/dev/null
cleanup() {
  "${archive_psql[@]}" -d postgres -c "drop database if exists $archive_db" >/dev/null
  "${archive_psql[@]}" -d postgres -c "drop database if exists $archive_catalog_db" >/dev/null
}
trap cleanup EXIT
"${archive_psql[@]}" -d postgres -c "create database $archive_catalog_db" >/dev/null
resolve_migration() {
  local suffix="$1"
  if [[ -f "supabase/pending/$suffix" ]]; then echo "supabase/pending/$suffix"; return; fi
  local matches=()
  shopt -s nullglob
  matches=(supabase/migrations/*_"$suffix")
  shopt -u nullglob
  if [[ ${#matches[@]} -ne 1 ]]; then echo "Expected one promoted migration for $suffix" >&2; return 1; fi
  echo "${matches[0]}"
}
archive_migration="$(resolve_migration action_archive_cohort_v1.sql)"
archive_reset_migration="$(resolve_migration action_mission_reset_v1.sql)"
apply() { "${archive_psql[@]}" -d "$1" -f "$2" >/dev/null; }
apply "$archive_db" supabase/tests/supabase_api_roles.stub.sql
apply "$archive_db" supabase/tests/action_archive.stub.sql
apply "$archive_db" "$archive_migration"
apply "$archive_db" "$archive_migration"
apply "$archive_db" supabase/tests/action_archive.behaviour.sql
echo 'PASS: archive publication, claim/replay, owner edits, reseeding and API-role boundaries'
apply "$archive_catalog_db" supabase/tests/supabase_api_roles.stub.sql
apply "$archive_catalog_db" supabase/tests/mnet_network_tables.stub.sql
apply "$archive_catalog_db" supabase/migrations/20261002061056_action_network_gamification_v1.sql
apply "$archive_catalog_db" supabase/migrations/20261016020407_action_partner_opportunity_drafts_v1.sql
apply "$archive_catalog_db" supabase/tests/action_mission_reset.stub.sql
apply "$archive_catalog_db" "$archive_reset_migration"
apply "$archive_catalog_db" "$archive_reset_migration"
apply "$archive_catalog_db" supabase/tests/action_mission_reset.behaviour.sql
echo 'PASS: three open missions, preserved proof access, idempotent acceptance, private arsenal and held CfAL draft'

