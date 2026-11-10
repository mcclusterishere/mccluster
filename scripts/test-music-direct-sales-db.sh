#!/usr/bin/env bash
# Runs supabase/migrations/20261031180839_music_direct_sales_v1.sql, then
# 20261109175747_music_direct_asset_versions_v1.sql (the APPLIED production version), and their behaviour tests against a
# throwaway local Postgres (16+), as the real API roles: the API role stub, the
# production shape of the three music_direct_* tables (lifted verbatim from
# supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql),
# a minimal public.music_catalog_objects, then the file (twice: it must be safe to
# re-run), the behaviour test, the rollback, the file again and the behaviour again.
# Last, the backfill (COM-1): v1 applied again after the file, two purchases, one offer
# edited, the file applied again (the only way the backfill can meet an order).
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
# The applied rollout was authorized for a verified EMPTY order ledger: its first
# application must refuse when any order exists (commerce_rollout_orders_changed),
# and only idempotent re-application is allowed afterwards. Prove the guard with
# disposable fixtures, then clear them before the real application.
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' >/dev/null
insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,asset_bucket,asset_path,download_name,active)
values ('here--lightroom','here:lightroom','Lightroom',299,'mcc-gated-audio','direct-sales/here/lightroom/l.mp3','McCluster - Lightroom.mp3',true);
insert into public.music_direct_orders(id,offer_key,stripe_checkout_session_id,amount_cents,currency,status)
values ('70000000-0000-4000-8000-000000000001','here--lightroom','cs_test_guard',299,'usd','pending');
SQL
if PGOPTIONS="--client-min-messages=warning" psql -1 -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql >/dev/null 2>"$TMP/guard.err"; then
  echo "first application succeeded with an order present: the zero-order rollout guard no longer fires" >&2; exit 1
fi
grep -q commerce_rollout_orders_changed "$TMP/guard.err" || { echo "first application failed for another reason:" >&2; cat "$TMP/guard.err" >&2; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "delete from public.music_direct_orders; delete from public.music_direct_offers;" >/dev/null
echo "rollout guard: first application refused while an order existed (expected), fixtures cleared"
apply supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql
apply supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql
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
apply supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_direct_sales.behaviour.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_direct_asset_versions.behaviour.sql >/dev/null
echo "behaviour after rollback + re-apply: ok"

# Backfill (COM-1). The zero-order guard means a FIRST application never meets an order,
# so the backfill only runs on a RE-application: v1 applied again after the file (the
# file's header warns of this) brings back v1's order and entitlement guards, purchases
# made then are not pinned, and applying the file again must pin an order only when its
# offer is unchanged since the order (offers.updated_at <= orders.created_at). Any other
# paid order is held for the owner: unpinned, refusing asset_unresolved, the only row in
# music_direct_asset_review, resolved once by hand. It is never given today's file.
# v1's own preflight refuses to re-apply while any order exists, so start from none.
psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "delete from public.music_direct_entitlements; delete from public.music_direct_orders; delete from public.music_direct_offers;" >/dev/null
apply supabase/migrations/20261031180839_music_direct_sales_v1.sql
# Separate statements are separate transactions, so the pauses order the timestamps:
# offers written, then both purchases, then the owner replaces Antisocial's file.
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' >/dev/null
set role service_role;
insert into public.music_direct_offers(offer_key,catalog_key,title,price_cents,asset_bucket,asset_path,download_name,active)
values ('here--lightroom','here:lightroom','Lightroom',299,'mcc-gated-audio','direct-sales/here/lightroom/l.mp3','McCluster - Lightroom.mp3',true),
       ('here--antisocial','here:antisocial','Antisocial',299,'mcc-gated-audio','direct-sales/here/antisocial/a.wav','McCluster - Antisocial.wav',true);
select pg_sleep(0.05);
insert into public.music_direct_orders(id,offer_key,stripe_checkout_session_id,amount_cents,currency,status)
values ('70000000-0000-4000-8000-000000000001','here--lightroom','cs_test_bf1',299,'usd','pending'),
       ('70000000-0000-4000-8000-000000000002','here--antisocial','cs_test_bf2',299,'usd','pending');
select public.music_direct_fulfil('70000000-0000-4000-8000-000000000001','cs_test_bf1',299,'usd','pi_bf1','b@x.test');
select public.music_direct_fulfil('70000000-0000-4000-8000-000000000002','cs_test_bf2',299,'usd','pi_bf2','c@x.test');
select pg_sleep(0.05);
update public.music_direct_offers set asset_path='direct-sales/here/antisocial/b.wav' where offer_key='here--antisocial';
do $$ begin
  if (select count(*) from public.music_direct_entitlements) <> 2
     or exists (select 1 from public.music_direct_orders where asset_version_id is not null)
     or exists (select 1 from public.music_direct_entitlements where asset_version_id is not null) then
    raise exception 'FAILED: the purchases under the re-applied v1 are not two unpinned paid orders, so this would not test the backfill';
  end if;
end $$;
SQL
apply supabase/migrations/20261109175747_music_direct_asset_versions_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL' >/dev/null
create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FAILED: %', p_what; end if; end $$;
set role service_role;
do $b$
declare v_lightroom uuid; v_sold uuid; v_replacement uuid; t_unchanged uuid; t_edited uuid; r jsonb;
begin
  select id into v_lightroom from public.music_direct_asset_versions where offer_key='here--lightroom' and asset_path='direct-sales/here/lightroom/l.mp3';
  select id into v_sold from public.music_direct_asset_versions where offer_key='here--antisocial' and asset_path='direct-sales/here/antisocial/a.wav';
  select id into v_replacement from public.music_direct_asset_versions where offer_key='here--antisocial' and asset_path='direct-sales/here/antisocial/b.wav';
  perform pg_temp.check(v_lightroom is not null and v_sold is not null and v_replacement is not null, 'a version row for every file the offers were written with');
  select token into t_unchanged from public.music_direct_entitlements where order_id='70000000-0000-4000-8000-000000000001';
  select token into t_edited from public.music_direct_entitlements where order_id='70000000-0000-4000-8000-000000000002';

  /* unchanged since the purchase: pinned to that offer's file, order and entitlement */
  perform pg_temp.check((select asset_version_id = v_lightroom from public.music_direct_orders where id='70000000-0000-4000-8000-000000000001'), 'backfill pins the unchanged-offer order to its file');
  perform pg_temp.check((select asset_version_id = v_lightroom from public.music_direct_entitlements where token=t_unchanged), 'backfill pins the unchanged-offer entitlement to the same file');
  r := public.music_direct_reserve_download(t_unchanged, null);
  perform pg_temp.check((r->>'ok')::boolean and r->>'path' = 'direct-sales/here/lightroom/l.mp3', 'unchanged-offer purchase delivers its file');
  perform public.music_direct_settle_download((r->>'attempt_id')::uuid, 'released');

  /* edited after the purchase: no evidence which file was bought, so nothing is assigned */
  perform pg_temp.check((select asset_version_id is null from public.music_direct_orders where id='70000000-0000-4000-8000-000000000002'), 'edited-offer order stays unpinned (never today''s file)');
  perform pg_temp.check((select asset_version_id is null from public.music_direct_entitlements where token=t_edited), 'edited-offer entitlement stays unpinned');
  perform pg_temp.check((select count(*) = 1 and bool_and(order_id = '70000000-0000-4000-8000-000000000002' and offer_current_path = 'direct-sales/here/antisocial/b.wav')
                           from public.music_direct_asset_review), 'the edited-offer order is the only row in music_direct_asset_review');
  r := public.music_direct_reserve_download(t_edited, null);
  perform pg_temp.check(r->>'reason' = 'asset_unresolved', 'edited-offer purchase refuses asset_unresolved, got ' || r::text);
  perform pg_temp.check(not exists (select 1 from public.music_direct_download_attempts a join public.music_direct_entitlements e on e.id = a.entitlement_id where e.token = t_edited), 'the refusal held no download');

  /* the owner resolves it once, to the file it was sold with; the entitlement follows */
  update public.music_direct_orders set asset_version_id = v_sold where id='70000000-0000-4000-8000-000000000002';
  perform pg_temp.check((select asset_version_id = v_sold from public.music_direct_entitlements where token=t_edited), 'resolution reaches the entitlement');
  perform pg_temp.check(not exists (select 1 from public.music_direct_asset_review), 'review list empty after the resolution');
  r := public.music_direct_reserve_download(t_edited, null);
  perform pg_temp.check((r->>'ok')::boolean and r->>'path' = 'direct-sales/here/antisocial/a.wav', 'resolved purchase delivers the file it was sold with, not the replacement');
  begin
    update public.music_direct_orders set asset_version_id = v_replacement where id='70000000-0000-4000-8000-000000000002';
    raise exception 'FAILED: a resolved order was re-pointed at the replacement';
  exception when others then
    if sqlerrm not like '%music_direct_order_asset_immutable%' then raise; end if;
  end;
end $b$;
SQL
echo "backfill on re-application: unchanged offer pinned; edited offer held for review (asset_unresolved), resolved once by the owner"
echo "music direct sales: ok"
