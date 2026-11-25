#!/usr/bin/env bash
# Runs supabase/migrations/20261030001000_music_release_payment_integrity_v1.sql
# (applied in production 2026-10-30; its rollback stays in supabase/pending/) and its
# behaviour tests against a throwaway local Postgres (16+), as the real API
# roles: the API role stub, the music creator stubs, the music creator
# platform and commerce migrations, the migration file (twice: it must be safe
# to re-run), then supabase/tests/music_release_payment_integrity.behaviour.sql.
# Usage:
#   PGHOST=/tmp/pg PGPORT=5499 PGUSER=postgres scripts/test-music-release-integrity-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="music_release_integrity_$$"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
apply() { PGOPTIONS="--client-min-messages=warning" psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/music_creator_onboarding.stub.sql
apply supabase/tests/music_release_integrity.stub.sql
apply supabase/migrations/20260920041011_music_creator_platform_v1.sql
apply supabase/migrations/20260920041250_music_commerce_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_release_payment_integrity.seed.sql >/dev/null
echo "seeded the pre-migration catalogue"
apply supabase/migrations/20261030001000_music_release_payment_integrity_v1.sql
apply supabase/migrations/20261030001000_music_release_payment_integrity_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/music_release_payment_integrity.behaviour.sql >/dev/null
# the rollback must apply cleanly on top
apply supabase/pending/music_release_payment_integrity_v1.rollback.sql
echo "music release and payment integrity: ok"
