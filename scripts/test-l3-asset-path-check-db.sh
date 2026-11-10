#!/usr/bin/env bash
# Runs supabase/pending/l3_products_asset_path_check_v1.sql and its behaviour test
# against a throwaway local Postgres (16+). Never against a real project.
#
# public.l3_products is created exactly as
# supabase/replay_migrations/0071_level3_replay_foundation.sql creates it (the block is
# lifted from that file), with one-column stand-ins for the two tables it references.
# Ten rows are seeded BEFORE the file is applied: two plain, a draft with no file, and
# seven that break the CHECK's rule (a dot segment, an encoded segment, names outside
# the alphabet, ".." inside a name, too long), because the file adds its constraint
# NOT VALID: what matters is what happens to rows that are already there. Four of the
# seven are also paths the download function itself refuses. Then: the header's two
# read-only counts (lifted from the file's comment and run as written), the file twice
# (it must be safe to re-run), the behaviour test, the rollback, and the file and the
# counts again.
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=postgres bash scripts/test-l3-asset-path-check-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
FILE=supabase/pending/l3_products_asset_path_check_v1.sql
ORG=90000000-0000-4000-8000-0000000000a1
DB="l3_asset_path_check_$$"
TMP="$(mktemp -d)"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null; rm -rf "$TMP"' EXIT
apply() { PGOPTIONS="--client-min-messages=warning" psql -1 -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
sql() { psql -q -At -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
constraint() { sql -c "select coalesce((select case when convalidated then 'valid' else 'not valid' end from pg_constraint where conrelid = 'public.l3_products'::regclass and conname = 'l3_products_asset_path_plain_check'), 'absent')"; }

# public.l3_products, exactly as the replay migration creates it
awk '/^create table if not exists public\.l3_products \(/{on=1} on{print} on&&/^\);/{exit}' \
  supabase/replay_migrations/0071_level3_replay_foundation.sql > "$TMP/l3_products.sql"
grep -q '^  asset_path text,$' "$TMP/l3_products.sql" || { echo "could not lift public.l3_products from the replay migration" >&2; exit 1; }
sql >/dev/null <<SQL
create schema auth;
create table auth.users(id uuid primary key);
create table public.orgs(id uuid primary key);
insert into public.orgs(id) values ('$ORG');
SQL
apply "$TMP/l3_products.sql"

# rows that are there before the constraint: two plain, seven that break the CHECK's rule.
# The function itself refuses four of them (dots, encoded, trailing space, question mark);
# it accepts the other three (a name with spaces and brackets, ".." inside a name, a long path).
sql >/dev/null <<SQL
insert into public.l3_products(org_id, slug, title, price_cents, asset_path) values
  ('$ORG', 'legacy-plain-1',        'Plain',          100, 'packs/sound-pack-v1.zip'),
  ('$ORG', 'legacy-plain-2',        'Plain',          100, '11111111-1111-4111-8111-111111111111/pack.zip'),
  ('$ORG', 'legacy-dots',           'Dots',           100, '../other-bucket/x'),
  ('$ORG', 'legacy-space',          'Space',          100, 'packs/My Pack (v2).zip'),
  ('$ORG', 'legacy-encoded',        'Encoded',        100, '%2e%2e/other-bucket/x'),
  ('$ORG', 'legacy-inner-dots',     'Inner dots',     100, 'packs/final..mix.zip'),
  ('$ORG', 'legacy-long',           'Long',           100, repeat('a', 1025)),
  ('$ORG', 'legacy-trailing-space', 'Trailing space', 100, 'packs/pack.zip '),
  ('$ORG', 'legacy-question',       'Question',       100, 'packs/what?.zip'),
  ('$ORG', 'legacy-draft',          'Draft',          100, null);
SQL

# the two read-only counts, exactly as the file's header gives them
sed -n '/^-- >>> count (read-only)$/,/^-- <<< count$/p' "$FILE" | sed '1d;$d' | sed 's/^--//' > "$TMP/count.sql"
grep -q 'select count(\*) from public\.l3_products' "$TMP/count.sql" || { echo "could not lift the count from the file's header" >&2; exit 1; }
sed -n '/^-- >>> function count (read-only)$/,/^-- <<< function count$/p' "$FILE" | sed '1d;$d' | sed 's/^--//' > "$TMP/function-count.sql"
grep -q 'select count(\*) from public\.l3_products' "$TMP/function-count.sql" || { echo "could not lift the function count from the file's header" >&2; exit 1; }
count() { sql -f "$TMP/count.sql"; }
function_count() { sql -f "$TMP/function-count.sql"; }
expect() { [ "$2" = "$3" ] || { echo "$1: expected $3, found $2" >&2; exit 1; }; }

[ "$(sql -c "show standard_conforming_strings")" = "on" ] || { echo "the counts are written for standard_conforming_strings = on" >&2; exit 1; }
expect "the header's function count" "$(function_count)" 4
echo "function count: 4 (the seeded rows the download function refuses)"
expect "the header's count before apply" "$(count)" 7
echo "count before apply: 7 (the seeded rows that break the CHECK's rule)"
expect "the constraint before apply" "$(constraint)" absent
apply "$FILE"
apply "$FILE"
expect "the constraint after apply" "$(constraint)" "not valid"
expect "the count after apply (NOT VALID changes no row)" "$(count)" 7
sql -f supabase/tests/l3_products_asset_path_check.behaviour.sql >/dev/null
echo "behaviour: ok"
expect "the count once the rows are corrected" "$(count)" 0
expect "the function count once the rows are corrected" "$(function_count)" 0
expect "the constraint after VALIDATE" "$(constraint)" valid
echo "count after the rows are corrected: 0; VALIDATE passed"

apply supabase/pending/l3_products_asset_path_check_v1.rollback.sql
expect "the constraint after rollback" "$(constraint)" absent
sql -c "insert into public.l3_products(org_id, slug, title, price_cents, asset_path) values ('$ORG', 'after-rollback', 'x', 100, '../other-bucket/x')" >/dev/null
expect "the count after a row written under rollback" "$(count)" 1
expect "the function count after a row written under rollback" "$(function_count)" 1
echo "rollback: the constraint is gone and the table takes any text again"
apply "$FILE"
expect "the constraint after re-apply" "$(constraint)" "not valid"
expect "rows after re-apply" "$(sql -c "select count(*) from public.l3_products where slug = 'after-rollback'")" 1
echo "re-apply after rollback: NOT VALID again, the existing row left as it is"
echo "l3 products asset_path check: ok"
