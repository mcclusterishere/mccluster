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
# supabase/tests/network_media_assets_pointer_guard.stub.sql.
#
#   1. the fixture IS production's table: its column, constraint and index
#      signatures, its four policies, the four "mnet media owner" Storage
#      policies and the bucket hash to the same values as
#      docs/control-plane/evidence/production-schema-snapshot-2026-11-03.json
#      (and 2026-11-09, where that file is present), by the snapshot's own SQL
#   2. BEFORE the guard a member's (a) repoint, (b) delete-and-reinsert and
#      status flips all succeed; another member's row is out of reach
#   3. the guard, twice (safe to re-run: the second run changes nothing)
#   4. AFTER it the same statements are refused, by privilege and, with the old
#      grant restored by hand, by the trigger; the media function's and the
#      Worker's service-role writes and a SECURITY DEFINER attach still work;
#      no role moves a pointer; the merge path moves owners with an audit row;
#      NOT VALID freezes legacy rows; the constraint validates once they are gone
#   5. database B: apply -> rollback leaves NOTHING behind (the whole public and
#      storage catalog equals what it was) and is production's signatures again;
#      the member writes of step 2 work again; re-apply equals the first apply
#      and passes step 4; a rollback after a merge keeps the audit record;
#      and the guard applies again on top of the kept record
#   6. scripts/db/media-asset-legacy-count.sql answers the seeded counts
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
# total ok not_canonical prefix_not_linked legacy | proofs levels fbi clips any | poster joint post in_use | staged ready attached blocked deleted
[ "$(nm_count "$A")" = "17 12 3 2 5 1 0 0 1 2 0 0 1 2 1 11 3 1 1" ] || nm_fail "legacy count on the seed: $(nm_count "$A")"
echo "   legacy count on the seed: 3 not canonical, 2 prefix not linked; of those 1 named by a proof, 1 by a clipping source, 1 attached to a post"
echo "2. before the guard"
nm_attacks "$A" false
nm_mark "$A" before

echo "3. the guard, applied twice"
nm_apply "$A" "$NM_PENDING"
nm_mark "$A" applied
nm_apply "$A" "$NM_PENDING"
nm_mark "$A" applied_again
nm_same "$A" applied applied_again "a second run of the guard changed the catalog"
nm_evidence "$A" guarded
[ "$(nm_count "$A")" = "17 12 3 2 5 1 0 0 1 2 0 0 1 2 1 11 3 1 1" ] || nm_fail "the guard changed the legacy count: $(nm_count "$A")"

echo "4. after the guard"
nm_attacks "$A" true
nm_behaviour "$A"
[ "$(nm_count "$A")" = "12 10 0 2 2 1 0 0 0 1 0 0 0 0 1 10 1 0 0" ] || nm_fail "legacy count after the behaviour test: $(nm_count "$A")"
echo "   legacy count now: 0 not canonical, 2 prefix not linked (rows naming B's uploads; one is still named by a proof)"
# a validated constraint survives a re-run of the guard
nm_apply "$A" "$NM_PENDING"
[ "$(nm_q "$A" "select convalidated from pg_constraint where conname = 'network_media_assets_canonical_upload_check'")" = t ] \
  || nm_fail "re-running the guard un-validated the constraint"
echo "   re-running the guard keeps the validated constraint validated"

# ---------------------------------------------------------------- database B
echo "5. apply, rollback, re-apply (a second database)"
fixture "$B"
nm_mark "$B" before
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
# a rollback after a merge keeps the record of it, and only that
moves="$(nm_q "$B" 'select count(*) from public.network_media_asset_owner_moves')"
[ "$moves" = 3 ] || nm_fail "expected 3 audit rows before the rollback, found $moves"
nm_apply "$B" "$NM_ROLLBACK"
[ "$(nm_q "$B" 'select count(*) from public.network_media_asset_owner_moves')" = 3 ] || nm_fail "the rollback dropped the audit record"
[ "$(nm_q "$B" "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'network\_media\_%'")" = 0 ] \
  || nm_fail "the rollback left a guard function behind"
[ "$(nm_q "$B" "select count(*) from pg_trigger where not tgisinternal and tgname like 'network\_media\_%'")" = 0 ] || nm_fail "the rollback left a trigger behind"
[ "$(nm_q "$B" "select has_table_privilege('service_role', 'public.network_media_asset_owner_moves', 'insert') or has_table_privilege('authenticated', 'public.network_media_asset_owner_moves', 'select')")" = f ] \
  || nm_fail "the kept audit record is open to an API role"
nm_evidence "$B" production
echo "   rollback after a merge: the 3 audit rows are kept, everything else is production's again"
nm_apply "$B" "$NM_PENDING"
[ "$(nm_q "$B" 'select count(*) from public.network_media_asset_owner_moves')" = 3 ] || nm_fail "re-applying on the kept record lost it"
nm_evidence "$B" guarded
echo "   the guard applies again on top of the kept record"

echo "network media assets pointer guard: ok"
