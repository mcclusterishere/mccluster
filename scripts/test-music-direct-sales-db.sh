#!/usr/bin/env bash
# Runs supabase/pending/music_direct_sales_v1.sql and its behaviour tests against a
# throwaway local Postgres (16+), as the real API roles: the API role stub, the
# production shape of the three music_direct_* tables (lifted verbatim from
# supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql),
# a minimal public.music_catalog_objects, then the file (twice: it must be safe to
# re-run), the behaviour test, the rollback, the file again and the behaviour again.
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=postgres scripts/test-music-direct-sales-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="music_direct_sales_$$"
TMP="$(mktemp -d)"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null; rm -rf "$TMP"' EXIT
apply() { PGOPTIONS="--client-min-messages=warning" psql -1 -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }

# the production tables, exactly as the replay migration creates them
awk '/^-- -+ music direct sales$/{on=1} /^-- -+ the ISRC registry$/{on=0} on' \
  supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql > "$TMP/direct_tables.sql"
grep -q 'create table public.music_direct_entitlements' "$TMP/direct_tables.sql" || { echo "could not lift the music_direct tables from the replay migration" >&2; exit 1; }

apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/music_direct_sales.stub.sql
apply "$TMP/direct_tables.sql"
apply supabase/pending/music_direct_sales_v1.sql
apply supabase/pending/music_direct_sales_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_direct_sales.behaviour.sql >/dev/null
echo "behaviour: ok"
apply supabase/pending/music_direct_sales_v1.rollback.sql
# Preserve a pre-existing inactive offer while enforcing the path on every new write.
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' >/dev/null
insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,asset_bucket,asset_path,download_name,active)
values ('legacy-inactive','here:here','Legacy',100,'mcc-gated-audio','legacy/song.mp3','song.mp3',false);
SQL
apply supabase/pending/music_direct_sales_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' >/dev/null
do $$
begin
  if not exists(select 1 from public.music_direct_offers where offer_key='legacy-inactive' and not active) then
    raise exception 'inactive legacy offer was not preserved';
  end if;
  begin
    update public.music_direct_offers set active=true where offer_key='legacy-inactive';
    raise exception 'legacy path was allowed to reactivate';
  exception when check_violation then
    if sqlerrm not like '%private_asset%' then raise; end if;
  end;
end $$;
SQL
echo "inactive legacy offer preserved; unsafe reactivation refused"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_direct_sales.behaviour.sql >/dev/null
echo "behaviour after rollback + re-apply: ok"
echo "music direct sales: ok"
