#!/usr/bin/env bash
# Runs supabase/pending/live_missions_v1.sql and its behaviour tests against a
# throwaway local Postgres (16+), as the real API roles. The chain: the API
# role stub, the member-network stub, the gamification migration, the proof
# retry migration, the bounty schema (its seed rows skipped: they need the
# full campaign table), the bounty lifecycle guard, a storage.buckets stand-in,
# the pending live-missions file, then the behaviour tests, then the rollback
# (which must leave the earlier chain intact and apply cleanly again).
#
# EXTRA_SQL="a.sql b.sql" applies more files right before the live file (for
# example PR #444's mission_admin_approval_v1.sql, to check both together).
# Usage:
#   PGHOST=/var/tmp/pg PGPORT=5499 PGUSER=postgres scripts/test-live-missions-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB="live_missions_test_$$"
TMP="$(mktemp -d)"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null; rm -rf "$TMP"' EXIT
apply() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; echo "applied $1"; }
sql() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "$1" >/dev/null; }
apply supabase/tests/supabase_api_roles.stub.sql
apply supabase/tests/mnet_network_tables.stub.sql
apply supabase/migrations/20261002061056_action_network_gamification_v1.sql
sql "alter table public.action_missions add column if not exists kind text not null default 'civic';
     alter table public.action_campaigns add column if not exists money_enabled boolean not null default false,
       add column if not exists allocation_note text, add column if not exists status text not null default 'live'"
apply supabase/migrations/20261004015451_action_proof_retry_and_review_notifications_v1.sql
# schema and functions only (lines before the seed inserts)
SEED_LINE=$(grep -n '^insert into public.action_campaigns' supabase/migrations/20261003235507_homelessness_action_bounties_v1.sql | head -1 | cut -d: -f1)
head -n $((SEED_LINE - 1)) supabase/migrations/20261003235507_homelessness_action_bounties_v1.sql > "$TMP/bounties_schema.sql"
apply "$TMP/bounties_schema.sql"
apply supabase/migrations/20261004000628_action_bounty_lifecycle_guard_v2.sql
sql "create schema if not exists storage;
     create table if not exists storage.buckets(id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[])"
for f in ${EXTRA_SQL:-}; do apply "$f"; done
apply supabase/pending/live_missions_v1.sql
apply supabase/pending/live_missions_v1.sql   # idempotent re-apply
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/live_missions.behaviour.sql | grep -q 'live missions behaviour: ok'
echo "behaviour: ok"
test "$(psql -tA -d "$DB" -c "select count(*) from storage.buckets where id='live-mission-recordings' and not public")" = 1
echo "private recording bucket: ok"
apply supabase/pending/live_missions_v1.rollback.sql
test "$(psql -tA -d "$DB" -c "select count(*) from pg_tables where schemaname='public' and tablename like 'action_live_%'")" = 0
test "$(psql -tA -d "$DB" -c "select count(*) from pg_tables where schemaname='public' and tablename in ('action_bounties','action_bounty_claims','action_proofs','action_missions')")" = 4
echo "rollback: ok"
apply supabase/pending/live_missions_v1.sql
echo "re-apply after rollback: ok"
echo "live missions chain: ok"
