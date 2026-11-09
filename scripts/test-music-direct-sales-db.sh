#!/usr/bin/env bash
# Runs supabase/migrations/20261031180839_music_direct_sales_v1.sql, then
# 20261109120000_music_direct_asset_versions_v1.sql, and their behaviour tests against a
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
apply supabase/migrations/20261031180839_music_direct_sales_v1.sql
apply supabase/migrations/20261031180839_music_direct_sales_v1.sql
# COM-1/COM-2 regression (asset versions, reserve/settle): must FAIL on v1 alone
if psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_direct_asset_versions.behaviour.sql >/dev/null 2>&1; then
  echo "asset-versions behaviour passed against v1 alone: the regression no longer bites" >&2; exit 1
fi
echo "asset-versions behaviour fails on v1 alone (expected)"
# a paid order placed BEFORE asset_versions: backfilled when the offer is unchanged since
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' >/dev/null
insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,asset_bucket,asset_path,download_name,active)
values ('here--lightroom','here:lightroom','Lightroom',299,'mcc-gated-audio','direct-sales/here/lightroom/l.mp3','McCluster - Lightroom.mp3',true),
       ('here--antisocial','here:antisocial','Antisocial',299,'mcc-gated-audio','direct-sales/here/antisocial/a.wav','McCluster - Antisocial.wav',true);
insert into public.music_direct_orders(id,offer_key,stripe_checkout_session_id,amount_cents,currency,status)
values ('70000000-0000-4000-8000-000000000001','here--lightroom','cs_test_bf1',299,'usd','pending'),
       ('70000000-0000-4000-8000-000000000002','here--antisocial','cs_test_bf2',299,'usd','pending');
select public.music_direct_fulfil('70000000-0000-4000-8000-000000000001','cs_test_bf1',299,'usd','pi_bf1','b@x.test');
select public.music_direct_fulfil('70000000-0000-4000-8000-000000000002','cs_test_bf2',299,'usd','pi_bf2','c@x.test');
select pg_sleep(0.05);
update public.music_direct_offers set asset_path='direct-sales/here/antisocial/b.wav' where offer_key='here--antisocial';
SQL
apply supabase/pending/20261109120000_music_direct_asset_versions_v1.sql
apply supabase/pending/20261109120000_music_direct_asset_versions_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' >/dev/null
do $$
declare r jsonb;
begin
  if (select asset_version_id is null from public.music_direct_orders where id='70000000-0000-4000-8000-000000000001') then
    raise exception 'unchanged-offer order was not backfilled';
  end if;
  if (select asset_version_id is not null from public.music_direct_orders where id='70000000-0000-4000-8000-000000000002') then
    raise exception 'edited-offer order was backfilled without evidence';
  end if;
  if (select count(*) from public.music_direct_asset_review) <> 1 then raise exception 'review list should hold the ambiguous order'; end if;
  r := public.music_direct_claim_download((select token from public.music_direct_entitlements where order_id='70000000-0000-4000-8000-000000000001'));
  if r->>'path' <> 'direct-sales/here/lightroom/l.mp3' then raise exception 'backfilled order delivers wrong file: %', r; end if;
  r := public.music_direct_claim_download((select token from public.music_direct_entitlements where order_id='70000000-0000-4000-8000-000000000002'));
  if r->>'reason' <> 'asset_unresolved' then raise exception 'ambiguous order should refuse: %', r; end if;
end $$;
delete from public.music_direct_entitlements; delete from public.music_direct_orders; delete from public.music_direct_offers;
SQL
echo "backfill: unchanged offer pinned, edited offer held for review"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_direct_sales.behaviour.sql >/dev/null
echo "behaviour: ok"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_direct_asset_versions.behaviour.sql >/dev/null
echo "asset-versions behaviour: ok"
apply supabase/pending/music_direct_asset_versions_v1.rollback.sql
apply supabase/pending/music_direct_sales_v1.rollback.sql
# Preserve a pre-existing inactive offer while enforcing the path on every new write.
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' >/dev/null
insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,asset_bucket,asset_path,download_name,active)
values ('legacy-inactive','here:here','Legacy',100,'mcc-gated-audio','legacy/song.mp3','song.mp3',false);
SQL
apply supabase/migrations/20261031180839_music_direct_sales_v1.sql
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
apply supabase/pending/20261109120000_music_direct_asset_versions_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_direct_sales.behaviour.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_direct_asset_versions.behaviour.sql >/dev/null
echo "behaviour after rollback + re-apply: ok"
echo "music direct sales: ok"
