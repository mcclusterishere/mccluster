#!/usr/bin/env bash
# Runs the one-click creator onboarding (supabase/migrations/20261021050105_music_creator_one_click_v1.sql)
# and its behaviour tests against a throwaway local Postgres (16+), as the
# real API roles:
#   the API role stub, the music creator stub, the music creator platform
#   migration, the identity presentation migration, then the pending SQL,
#   then the behaviour tests.
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=postgres scripts/test-music-creator-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="music_creator_test_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/music_creator_onboarding.stub.sql
apply supabase/migrations/20260920041011_music_creator_platform_v1.sql
apply supabase/migrations/20261005054044_identity_presentations_music_action_v1.sql
# applied twice: the promoted SQL must be safe to re-run
apply supabase/migrations/20261021050105_music_creator_one_click_v1.sql
apply supabase/migrations/20261021050105_music_creator_one_click_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_creator_one_click.behaviour.sql
echo "music creator one-click chain: ok"
