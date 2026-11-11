#!/usr/bin/env bash
# supabase/pending/network_media_assets_pointer_guard_v1.sql (NOT applied in
# production) and its rollback, against a throwaway PostgreSQL (16 or 17), as
# the real API roles. Scratch databases only: it creates two, uses them and
# drops them. It never connects to Supabase.
#
# The table under test is built from the applied files' own DDL, byte for byte
# (the first lines of 20260920071811_mnet_real_network_v1.sql down to its
# Storage policies; m_people, m_auth_user_links and m_merge_people from replay
# 0049; current_m_uid() from replay 0051), on the stand-ins in
# supabase/tests/network_media_assets_pointer_guard.stub.sql, under the default
# privileges production has (Supabase's, as three applied migrations changed
# them): what the guard creates starts out as open as it would in production.
#
#   1. the fixture IS production's table: its column, constraint and index
#      signatures, its grants (to the letter on PostgreSQL 17; a 16 cannot hold
#      MAINTAIN), its four policies, the four "mnet media owner" Storage
#      policies and the bucket hash to the same values as
#      docs/control-plane/evidence/production-schema-snapshot-2026-11-03.json
#      (and 2026-11-09, where that file is present), by the snapshot's own SQL
#   2. the guard REFUSES to apply while a non-canonical row exists (its CHECK is
#      NOT VALID, which would freeze such a row), and applies nothing; the
#      precheck names them; the owner's decision is taken (they are deleted)
#   3. BEFORE the guard a member's (a) repoint, (b) delete-and-reinsert and
#      status flips all succeed; another member's row is out of reach
#   4. the guard, twice (safe to re-run: the second run changes nothing), over
#      a grant wider than production's, which it takes away whole
#   5. AFTER it the same statements are refused, by privilege and, with the old
#      grant restored by hand, by the trigger; the media function's and the
#      Worker's service-role writes and a SECURITY DEFINER attach still work;
#      no role moves a pointer; TRUNCATE is covered; the merge path moves owners
#      with an audit row, never to the wrong person, and never a row that names
#      somebody else's upload, through a second merge too; the constraint
#      validates at once; the documented residual is recorded
#   6. database B: the rollback does nothing where the guard is not applied;
#      apply -> rollback leaves NOTHING behind (the whole public and storage
#      catalog equals what it was) and is production's signatures again; the
#      member writes of step 3 work again; re-apply equals the first apply and
#      passes step 5; a rollback after a merge keeps the audit record, still
#      append-only; and the guard applies again on top of the kept record
#   scripts/db/media-asset-pointer-guard-precheck.sql and the media-signing
#   fix's scripts/db/media-asset-legacy-count.sql are both read at every stage,
#   against expected numbers and against each other.
#
# The same statements on the real Storage API, and on the official Supabase
# Postgres image as its restricted postgres role:
# scripts/test-network-media-storage-flow.sh (needs Docker).
#
# Usage:
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres scripts/test-network-media-pointer-guard-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export PGOPTIONS="${PGOPTIONS:---client-min-messages=warning}"
. scripts/test/support/network-media-fixture.sh

A="nma_pointer_guard_$$"; B="${A}_rb"
trap 'psql -q -d postgres -c "drop database if exists $A" -c "drop database if exists $B" >/dev/null 2>&1' EXIT

# The fixture: stand-ins, then the applied files' own DDL, then what names an upload.
fixture() {
  psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $1" >/dev/null
  nm_apply "$1" "$NM_T.stub.sql"
  nm_applied_ddl "$1"
  nm_apply "$1" "$NM_T.refs.stub.sql"
  nm_apply "$1" "$NM_T.seed.sql"
}

echo "PostgreSQL $(nm_q postgres 'show server_version')"

# ---------------------------------------------------------------- database A
fixture "$A"
echo "1. the fixture, built from the applied migrations' own DDL"
nm_evidence "$A" production
# total ok not_canonical prefix_not_linked legacy | proofs levels fbi clips any | poster joint post in_use |
# staged ready attached blocked deleted | prefix_not_linked: after_a_merge other
nm_counts "$A" "on the seed" "14 12 0 2 2 1 0 0 0 1 0 0 0 0 1 9 2 1 1 0 2" "14 0 2 5 1 5 0"

echo "2. the guard refuses to apply while a non-canonical row exists"
nm_apply "$A" "$NM_T.legacy.sql" -v cleanup=false
nm_counts "$A" "with the non-canonical rows" "17 12 3 2 5 1 0 0 1 2 0 0 1 2 1 11 3 1 1 0 2" "17 3 2 6 2 6 0"
echo "   the precheck: 3 not canonical (1 named by a clipping source, 1 attached to a post), 2 naming somebody else's upload (1 named by a proof); the legacy count agrees"
nm_mark "$A" unguarded
refusal="$(psql -q -v ON_ERROR_STOP=1 -d "$A" -f "$NM_PENDING" 2>&1 >/dev/null || true)"
case "$refusal" in
  *"network_media_assets_pointer_guard_v1 was not applied: 3 row(s) of network_media_assets are not canonical uploads"*) ;;
  *) nm_fail "the guard should have refused to apply with 3 non-canonical rows; psql said: $refusal" ;;
esac
nm_mark "$A" refused
nm_same "$A" unguarded refused "a refused apply changed the catalog"
nm_evidence "$A" production
echo "   refused, and nothing was applied: \"3 row(s) of network_media_assets are not canonical uploads\""
nm_apply "$A" "$NM_T.legacy.sql" -v cleanup=true
nm_counts "$A" "after the owner's decision" "14 12 0 2 2 1 0 0 0 1 0 0 0 0 1 9 2 1 1 0 2" "14 0 2 5 1 5 0"

echo "3. before the guard"
nm_attacks "$A" false
nm_mark "$A" before

echo "4. the guard, applied twice"
# A wider grant than production's (what Supabase's own default privileges hand
# to the API roles, before production's hardening of 2026-09-19): the guard
# takes all of it from anon and authenticated, not only what production holds.
nm_q "$A" "grant insert, update, delete, truncate, references, trigger on public.network_media_assets to anon, authenticated" >/dev/null
nm_apply "$A" "$NM_PENDING"
nm_mark "$A" applied
nm_apply "$A" "$NM_PENDING"
nm_mark "$A" applied_again
nm_same "$A" applied applied_again "a second run of the guard changed the catalog"
nm_evidence "$A" guarded
nm_counts "$A" "after the guard (it must not change them)" "14 12 0 2 2 1 0 0 0 1 0 0 0 0 1 9 2 1 1 0 2" "14 0 2 5 1 5 0"

echo "5. after the guard"
nm_attacks "$A" true
nm_behaviour "$A"
nm_counts "$A" "after the behaviour test" "13 11 0 2 2 1 0 0 0 1 0 0 0 0 1 11 1 0 0 0 2" "13 0 2 4 1 5 1"
# a second merge on top of the first; in between, the count tells what waits to follow it
nm_apply "$A" "$NM_T.chain.sql" -v follow=false
nm_counts "$A" "between a merge and its follow" "13 1 0 12 12 2 1 0 1 4 0 0 1 0 1 11 1 0 0 10 2" "13 0 12 4 4 5 1"
echo "   after m_merge_people(B, A): the precheck shows 10 uploads waiting to follow the merge, apart from the 2 rows that name somebody else's upload"
nm_notices "$A" -v follow=true -f "$NM_T.chain.sql"
nm_counts "$A" "after the second follow" "13 11 0 2 2 1 0 0 0 1 0 0 0 0 1 11 1 0 0 0 2" "13 0 2 4 1 5 1"
# a validated constraint survives a re-run of the guard
nm_apply "$A" "$NM_PENDING"
[ "$(nm_q "$A" "select convalidated from pg_constraint where conname = 'network_media_assets_canonical_upload_check'")" = t ] \
  || nm_fail "re-running the guard un-validated the constraint"
echo "   re-running the guard keeps the validated constraint validated"

# ---------------------------------------------------------------- database B
echo "6. apply, rollback, re-apply (a second database)"
fixture "$B"
nm_mark "$B" before
# the rollback does nothing where the guard is not applied, even when that
# database is not production's 2026-09-20 state any more
nm_q "$B" "alter policy network_media_owner_update on public.network_media_assets using (owner_m_uid = (select public.current_m_uid()))" >/dev/null
nm_q "$B" "revoke delete on public.network_media_assets from authenticated" >/dev/null
nm_q "$B" 'drop policy "mnet media owner delete" on storage.objects' >/dev/null
nm_mark "$B" drifted
nm_apply "$B" "$NM_ROLLBACK"
nm_mark "$B" drifted_rolled_back
nm_same "$B" drifted drifted_rolled_back "the rollback rewrote a database the guard was never applied to"
echo "   the rollback on a database the guard is not applied to: nothing changes"
nm_q "$B" "alter policy network_media_owner_update on public.network_media_assets using (owner_m_uid = public.current_m_uid())" >/dev/null
nm_q "$B" "grant delete on public.network_media_assets to authenticated" >/dev/null
awk '/^drop policy if exists "mnet media owner delete"/{on=1} on{print} /auth\.uid\(\)::text\);/{if(on) exit}' \
  supabase/migrations/20260920071811_mnet_real_network_v1.sql | nm_pipe "$B"
nm_mark "$B" restored
nm_same "$B" before restored "the test did not put the second database back"

nm_apply "$B" "$NM_PENDING"
nm_mark "$B" applied
nm_apply "$B" "$NM_ROLLBACK"
nm_mark "$B" rolled_back
nm_same "$B" before rolled_back "the rollback left something behind"
echo "   apply -> rollback: the public and storage catalogs equal what they were, object for object"
nm_evidence "$B" production
nm_attacks "$B" false
nm_apply "$B" "$NM_ROLLBACK"
nm_mark "$B" rolled_back_twice
nm_same "$B" before rolled_back_twice "a second rollback changed the catalog"
nm_apply "$B" "$NM_PENDING"
nm_mark "$B" reapplied
nm_same "$B" applied reapplied "the re-applied guard differs from the first apply"
echo "   re-apply: identical to the first apply"
nm_evidence "$B" guarded
nm_attacks "$B" true
nm_behaviour "$B" >/dev/null
echo "   the behaviour test passes on the re-applied guard"
# a rollback after a merge keeps the record of it, still append-only, and only that
moves="$(nm_q "$B" 'select count(*) from public.network_media_asset_owner_moves')"
[ "$moves" = 3 ] || nm_fail "expected 3 audit rows before the rollback, found $moves"
nm_apply "$B" "$NM_ROLLBACK"
[ "$(nm_q "$B" 'select count(*) from public.network_media_asset_owner_moves')" = 3 ] || nm_fail "the rollback dropped the audit record"
[ "$(nm_q "$B" "select string_agg(proname, ',' order by proname) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'network\_media\_%'")" = network_media_asset_owner_moves_append_only ] \
  || nm_fail "after the rollback only the audit record's append-only function may remain"
[ "$(nm_q "$B" "select count(*) from pg_trigger where not tgisinternal and tgrelid = 'public.network_media_assets'::regclass")" = 0 ] || nm_fail "the rollback left a trigger on the table"
for write in "update public.network_media_asset_owner_moves set reason = 'rewritten after the rollback'" \
             "delete from public.network_media_asset_owner_moves" "truncate public.network_media_asset_owner_moves"; do
  out="$(psql -q -v ON_ERROR_STOP=1 -d "$B" -c "$write" 2>&1 || true)"
  case "$out" in *network_media_asset_owner_moves_append_only*) ;; *) nm_fail "the kept audit record is not append-only any more: $write -> $out" ;; esac
done
[ "$(nm_q "$B" "select has_table_privilege('service_role', 'public.network_media_asset_owner_moves', 'insert') or has_table_privilege('authenticated', 'public.network_media_asset_owner_moves', 'select')")" = f ] \
  || nm_fail "the kept audit record is open to an API role"
nm_evidence "$B" production
echo "   rollback after a merge: the 3 audit rows are kept, still append-only; everything else is production's again"
nm_apply "$B" "$NM_PENDING"
[ "$(nm_q "$B" 'select count(*) from public.network_media_asset_owner_moves')" = 3 ] || nm_fail "re-applying on the kept record lost it"
nm_evidence "$B" guarded
echo "   the guard applies again on top of the kept record"

echo "network media assets pointer guard: ok"
