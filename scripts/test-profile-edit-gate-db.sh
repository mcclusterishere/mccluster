#!/usr/bin/env bash
# Runs the profile edit gate migration
# (supabase/pending/20261016010000_profile_edit_gate_v1.sql) and its behaviour
# tests against throwaway local Postgres databases (16+), as the real API
# roles. The chain is the identity verification levels' own
# (scripts/test-identity-verification-db.sh: the ladder, then the identity
# levels) plus the real fan_profiles migration and a minimal
# music_creator_profiles. Steps:
#   1. chain + this file, applied twice (idempotent);
#   2. supabase/tests/profile_edit_gate.behaviour.sql;
#   3. the rollback file, then this file again (round trip);
#   4. a second database: chain + this file, then the IDENTITY LEVELS' and
#      the LADDER's own behaviour tests, so this file broke neither.
# Usage:
#   PGHOST=/var/tmp/pg PGPORT=5497 PGUSER=postgres scripts/test-profile-edit-gate-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
DB="profile_edit_test_$$"
DB2="profile_edit_compat_$$"
DB3="profile_edit_ladder_$$"
cleanup() { for d in "$DB" "$DB2" "$DB3"; do psql -q -d postgres -c "drop database if exists $d" >/dev/null; done; }
trap cleanup EXIT
GATE=supabase/pending/20261016010000_profile_edit_gate_v1.sql
apply() { psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null; echo "applied $2 ($1)"; }
sql() { psql -q -v ON_ERROR_STOP=1 -d "$1" -c "$2" >/dev/null; }
build() {
  local db="$1"
  psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $db" >/dev/null
  apply "$db" supabase/tests/supabase_api_roles.stub.sql
  apply "$db" supabase/tests/supabase_storage.stub.sql
  apply "$db" supabase/tests/mnet_network_tables.stub.sql
  apply "$db" supabase/migrations/20261002061056_action_network_gamification_v1.sql
  apply "$db" supabase/migrations/20261004015451_action_proof_retry_and_review_notifications_v1.sql
  apply "$db" supabase/migrations/20261002063754_action_network_fellowship_v1.sql
  apply "$db" supabase/migrations/20261005054040_action_cohort_admission_v1.sql
  sql "$db" "alter table public.action_missions add column if not exists kind text not null default 'civic'"
  apply "$db" supabase/migrations/20261014013557_action_globe_regions.sql
  apply "$db" supabase/migrations/20261014020454_action_policy_memo_bounties.sql
  sql "$db" "create table if not exists public.creator_billing_subscriptions(stripe_subscription_id text primary key, owner_user_id uuid, status text, current_period_end timestamptz)"
  sql "$db" "create table if not exists public.action_participants(campaign_id text not null, user_id uuid not null, referral_code text not null unique, referred_by text, primary key (campaign_id, user_id))"
  apply "$db" supabase/pending/policy_fellowship_ladder_v1.sql
  apply "$db" supabase/pending/20261015230000_identity_verification_levels_v1.sql
  # the profile tables the gate protects: fan_profiles is the real migration
  # (it needs auth.users.email_confirmed_at); music_creator_profiles keeps only
  # the columns the gate reads (20260920041011_music_creator_platform_v1)
  sql "$db" "alter table auth.users add column if not exists email_confirmed_at timestamptz"
  apply "$db" supabase/migrations/20260919042036_fan_profiles.sql
  sql "$db" "create table if not exists public.music_creator_profiles(m_uid uuid primary key references public.m_people(id) on delete cascade, handle text not null unique check (handle ~ '^[a-z0-9][a-z0-9._-]{2,39}\$'), artist_name text not null, updated_at timestamptz not null default now())"
  apply "$db" "$GATE"
}

build "$DB"
apply "$DB" "$GATE"   # applying twice must be harmless
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/profile_edit_gate.behaviour.sql
echo "profile edit gate behaviour: ok"

# round trip on a database that holds rows (videos emptied first, as the rollback says)
sql "$DB" "delete from storage.objects where bucket_id = 'identity-verification-videos' and name in (select object_path from public.identity_submissions where level = 'profile_edit')"
apply "$DB" supabase/pending/20261016010000_profile_edit_gate_v1.rollback.sql
sql "$DB" "do \$\$ begin if to_regclass('public.profile_edit_requests') is not null or exists (select 1 from pg_trigger where tgname = 'zz_profile_edit_guard') then raise exception 'rollback left the gate behind'; end if; end \$\$"
sql "$DB" "do \$\$ begin if exists (select 1 from public.identity_submissions where level = 'profile_edit') then raise exception 'rollback left profile edit submissions'; end if; end \$\$"
apply "$DB" "$GATE"
echo "rollback and re-apply: ok"

build "$DB2"
psql -q -v ON_ERROR_STOP=1 -d "$DB2" -f supabase/tests/identity_verification_levels.behaviour.sql
echo "identity verification levels behaviour with the profile edit gate applied: ok"
build "$DB3"
psql -q -v ON_ERROR_STOP=1 -d "$DB3" -f supabase/tests/policy_fellowship_ladder.behaviour.sql
echo "policy fellowship ladder behaviour with the profile edit gate applied: ok"
echo "profile edit gate: ok"
