#!/usr/bin/env bash
# Runs supabase/pending/music_label_artists_v1.sql (the label model: one
# account, several artists; owner 2026-11-02) and its behaviour tests against
# a throwaway local Postgres (16+), as the real API roles, on the same chain
# scripts/test-music-release-integrity-db.sh builds (the API role stub, the
# music creator stubs, the creator platform, commerce and release-integrity
# migrations), plus supabase/tests/music_label_artists.stub.sql (the house) and
# .seed.sql (Matthew, a stranger, an ordinary creator).
#
#   1. the guards it replaces are production's (md5 of each body against
#      supabase/schema-manifest.json, the CI reset that production matches up
#      to CRLF line endings)
#   2. the file, twice (it must be safe to re-run), then the behaviour test:
#      Matthew writes PRIM3's rows, a stranger cannot, a revoked manager
#      cannot, an artist's own login later moves nothing
#   3. the rollback: the guard bodies and the 13 creator-table policy
#      expressions are byte-for-byte production's again (md5 against
#      docs/control-plane/evidence/production-schema-snapshot-2026-10-31.json),
#      the label objects are gone, and an act with releases is kept
#   4. the file again on top: the seed re-attaches the kept act
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=postgres scripts/test-music-label-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="music_label_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { PGOPTIONS="--client-min-messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
q() { psql -qAt -v ON_ERROR_STOP=1 -d "$DB" -c "$1"; }

apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/music_creator_onboarding.stub.sql
apply supabase/tests/music_release_integrity.stub.sql
apply supabase/migrations/20260920041011_music_creator_platform_v1.sql
apply supabase/migrations/20260920041250_music_commerce_v1.sql
apply supabase/migrations/20261030001000_music_release_payment_integrity_v1.sql
apply supabase/tests/music_label_artists.stub.sql
apply supabase/tests/music_label_artists.seed.sql

GUARDS="select string_agg(proname || '=' || left(md5(prosrc), 12), ' ' order by proname) from pg_proc
  where pronamespace = 'public'::regnamespace and proname in ('music_creator_guard','music_license_guard','music_track_guard')"
POLICIES="select string_agg(p.polname || '=' || left(md5(coalesce(pg_get_expr(p.polqual, p.polrelid), '')), 12)
  || '/' || left(md5(coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')), 12), ' ' order by p.polname)
  from pg_policy p join pg_class c on c.oid = p.polrelid
  where c.relnamespace = 'public'::regnamespace
    and c.relname in ('music_creator_profiles','creator_tracks','music_license_offers','music_rights_attestations')
    and p.polname not like '%public_read'"
# what production has: functions from the CI-reset manifest (production's
# bodies differ from it only by CRLF), policy expressions from the snapshot
expected() {
  node -e '
    const fs = require("fs");
    const rows = (f, s) => JSON.parse(fs.readFileSync(f, "utf8")).sections[s].rows;
    const guards = ["music_creator_guard", "music_license_guard", "music_track_guard"];
    const fn = rows("supabase/schema-manifest.json", "functions").filter((r) => r[0] === "public" && guards.includes(r[1]));
    const tables = ["music_creator_profiles", "creator_tracks", "music_license_offers", "music_rights_attestations"];
    const pol = rows("docs/control-plane/evidence/production-schema-snapshot-2026-10-31.json", "policies")
      .filter((r) => r[0] === "public" && tables.includes(r[1]) && !r[2].endsWith("public_read"));
    const blank = "d41d8cd98f00";
    if (process.argv[1] === "guards") console.log(fn.map((r) => r[1] + "=" + r[7]).sort().join(" "));
    else console.log(pol.map((r) => r[2] + "=" + (r[6] || blank) + "/" + (r[7] || blank)).sort().join(" "));
  ' "$1"
}
want_guards="$(expected guards)"; want_policies="$(expected policies)"
[ "$(q "$GUARDS")" = "$want_guards" ] || { echo "the guards before the file are not production's: $(q "$GUARDS") vs $want_guards" >&2; exit 1; }
echo "the guards the file replaces are production's"

apply supabase/pending/music_label_artists_v1.sql
apply supabase/pending/music_label_artists_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_label_artists.behaviour.sql >/dev/null
echo "behaviour: Matthew acts for PRIM3, a stranger cannot, a revoked manager cannot, a later login moves nothing"

apply supabase/pending/music_label_artists_v1.rollback.sql
[ "$(q "$GUARDS")" = "$want_guards" ] || { echo "rollback guards differ from production: $(q "$GUARDS")" >&2; exit 1; }
got_policies="$(q "$POLICIES")"
[ "$got_policies" = "$want_policies" ] || { printf 'rollback policies differ from production:\n got  %s\n want %s\n' "$got_policies" "$want_policies" >&2; exit 1; }
[ "$(q "select count(*) from pg_proc where proname like 'music_label_%' or proname in ('music_can_act_for','music_my_artists','music_rights_attestation_guard')")" = 0 ] \
  || { echo "rollback left label functions" >&2; exit 1; }
[ "$(q "select to_regclass('public.music_creator_managers') is null")" = t ] || { echo "rollback left the manager table" >&2; exit 1; }
[ "$(q "select string_agg(handle, ',' order by handle) from public.music_creator_profiles")" = "ana,matthew,prim3,test-artist" ] \
  || { echo "rollback: expected the acts with releases (prim3) or a login (test-artist) kept and the empty one (equity-uprise) removed: $(q "select string_agg(handle, ',' order by handle) from public.music_creator_profiles")" >&2; exit 1; }
echo "rollback: production's guards and policies restored; acts that hold releases kept"

apply supabase/pending/music_label_artists_v1.sql
[ "$(q "select count(*) from public.music_creator_managers m join public.music_creator_profiles p on p.m_uid = m.creator_m_uid
       where p.handle in ('prim3','equity-uprise') and m.manager_m_uid = '10000000-0000-4000-8000-0000000000a1' and m.revoked_at is null")" = 2 ] \
  || { echo "re-apply did not put PRIM3 and Equity Uprise back on the label" >&2; exit 1; }
echo "re-applied: PRIM3 (kept, with its release) and Equity Uprise are back on the label"
echo "music label artists: ok"
