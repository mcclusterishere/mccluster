#!/usr/bin/env bash
# Mission admin approval (supabase/pending/mission_admin_approval_v1.sql) and
# the gated track rule (supabase/pending/gated_track_mission_identity_v1.sql),
# on a throwaway local Postgres (16+), as the real API roles.
#
# 1. Regression: the existing behaviour suites (mission engine, fellowship,
#    Anti-Social connections + levels, Policy Fellowship ladder) run again with
#    both pending files applied on top. They drive the real review RPCs as the
#    desk, so they prove the admin path still works end to end.
# 2. supabase/tests/mission_admin_approval.behaviour.sql proves every former
#    automatic / self-service path can no longer verify, mint or release.
# 3. supabase/tests/gated_track_mission_identity.behaviour.sql proves the
#    0-3 missions x identity matrix, and that no stream token is issued locked.
# Usage:
#   PGHOST=/var/tmp/pg PGPORT=5497 PGUSER=postgres scripts/test-mission-admin-approval-db.sh
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
cd "$(dirname "$0")/.."
DBS=()
cleanup() { for d in "${DBS[@]:-}"; do [ -n "$d" ] && psql -q -d postgres -c "drop database if exists $d" >/dev/null; done; }
trap cleanup EXIT

sql() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "$1" >/dev/null; }
apply() { psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$1" >/dev/null; }
# one block "create [or replace] function public.<name>(...) ... $$;" lifted from a migration
lift() { python3 -I - "$1" "$2" <<'PY' | psql -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null
import re, sys
txt = open(sys.argv[1]).read(); name = sys.argv[2]
m = None
for m2 in re.finditer(r'create\s+(?:or\s+replace\s+)?function\s+' + re.escape(name) + r'\s*\(.*?\$(\w*)\$.*?\$\1\$\s*;', txt, re.I | re.S):
    m = m2
if not m: sys.exit('function %s not found in %s' % (name, sys.argv[1]))
print(m.group(0))
PY
}

fresh() {
  DB="mission_approval_$1_$$"; DBS+=("$DB")
  psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB" >/dev/null
  apply supabase/tests/supabase_api_roles.stub.sql
  apply supabase/tests/mnet_network_tables.stub.sql
  apply supabase/migrations/20261002061056_action_network_gamification_v1.sql
}

# The whole chain the two pending files sit on (production order).
# PR #443 (identity verification levels). Defaults are where its files land
# once merged; override to test against its branch before that.
IDENTITY_SQL="${IDENTITY_SQL:-supabase/pending/20261015230000_identity_verification_levels_v1.sql}"
IDENTITY_STORAGE_STUB="${IDENTITY_STORAGE_STUB:-supabase/tests/supabase_storage.stub.sql}"
IDENTITY_TEST="${IDENTITY_TEST:-supabase/tests/identity_verification_levels.behaviour.sql}"

full_chain() {
  fresh "$1"
  [ -f "$IDENTITY_STORAGE_STUB" ] && apply "$IDENTITY_STORAGE_STUB"
  sql "alter table public.action_missions add column if not exists kind text not null default 'civic'"
  apply supabase/migrations/20261004015451_action_proof_retry_and_review_notifications_v1.sql
  apply supabase/migrations/20261002135458_action_network_feed_shares_v1.sql
  apply supabase/migrations/20261002063754_action_network_fellowship_v1.sql
  apply supabase/migrations/20261005054040_action_cohort_admission_v1.sql
  apply supabase/migrations/20261014185154_antisocial_get_social_three_levels_draft.sql
  apply supabase/migrations/20261015000455_antisocial_get_social_completion_v1.sql
  apply supabase/migrations/20261015001022_antisocial_action_record_civic_scope.sql
  apply supabase/migrations/20261014013557_action_globe_regions.sql
  apply supabase/migrations/20261014020454_action_policy_memo_bounties.sql
  sql "create table if not exists public.creator_billing_subscriptions(stripe_subscription_id text primary key, owner_user_id uuid, status text, current_period_end timestamptz)"
  sql "create table if not exists public.action_participants(campaign_id text not null, user_id uuid not null, referral_code text not null unique, referred_by text, primary key (campaign_id, user_id))"
  apply supabase/pending/policy_fellowship_ladder_v1.sql
  # Bounty claims: the real table shape (20261003235507) and the real sync trigger (v2 guard, 20261004000628).
  sql "create table public.action_bounty_claims(id uuid primary key default gen_random_uuid(), bounty_id uuid, assignment_id uuid not null unique references public.action_mission_assignments(id) on delete cascade, user_id uuid not null, m_uid uuid not null, reward_cents integer not null default 500, status text not null default 'reserved' check (status in ('reserved','submitted','approved','rejected','cancelled','expired','paid')), claimed_at timestamptz not null default now(), expires_at timestamptz not null default now() + interval '1 day', submitted_at timestamptz, approved_at timestamptz, paid_at timestamptz, reviewer_m_uid uuid, review_note text, payout_provider text, payout_ref text)"
  lift supabase/migrations/20261004000628_action_bounty_lifecycle_guard_v2.sql public.action_bounty_sync_claim
  sql "create trigger action_bounty_sync_claim_trg after update of status on public.action_mission_assignments for each row execute function public.action_bounty_sync_claim()"
  # Clips: only the columns the guards and clip_release_due read (20261006170955); the
  # marketplace itself needs the full Supabase stack and runs in API Economic Core CI.
  sql "create table public.orgs(id uuid primary key default gen_random_uuid(), owner_uid uuid)"
  sql "create function private.is_org_owner(p_org uuid) returns boolean language sql stable security definer set search_path='' as \$\$ select exists(select 1 from public.orgs o where o.id = p_org and o.owner_uid = (select auth.uid())) \$\$"
  sql "grant usage on schema private to anon, authenticated, service_role; grant execute on function private.is_org_owner(uuid) to authenticated, service_role"
  sql "create table public.action_clip_campaigns(mission_id uuid primary key references public.action_missions(id), org_id uuid not null references public.orgs(id), approval_mode text not null default 'creator' check (approval_mode in ('auto','creator')), keep_live_days integer not null default 0, status text not null default 'draft', updated_at timestamptz default now())"
  sql "create table public.action_clip_claims(id uuid primary key default gen_random_uuid(), mission_id uuid, status text not null default 'active')"
  sql "create table public.action_clip_submissions(id uuid primary key default gen_random_uuid(), mission_id uuid not null, claim_id uuid not null references public.action_clip_claims(id), user_id uuid not null, status text not null default 'tracking', review_state text not null default 'pending' check (review_state in ('not_required','pending','approved','rejected')), posted_at timestamptz default now() - interval '2 days', live_checked_at timestamptz default now(), updated_at timestamptz default now())"
  sql "create table public.action_clip_earnings(id uuid primary key default gen_random_uuid(), mission_id uuid not null, claim_id uuid not null references public.action_clip_claims(id), submission_id uuid references public.action_clip_submissions(id), amount_cents bigint not null default 100, state text not null default 'held', hold_until timestamptz not null default now() - interval '1 hour', released_at timestamptz)"
  lift supabase/migrations/20261006170955_action_clipping_marketplace_v1.sql public.clip_release_due   # as applied (f9370119)
  sql "grant all on public.orgs, public.action_clip_campaigns, public.action_clip_claims, public.action_clip_submissions, public.action_clip_earnings, public.action_bounty_claims to service_role"
  # Music: the listen ledger and gated plays as applied.
  apply supabase/migrations/20260928012324_music_listen_gate.sql
  apply supabase/migrations/20260930222516_music_listen_gate_hardening.sql
  sql "create table public.event_taxonomy(event_name text primary key, stage text not null, note text not null default '')"
}

pending() {
  apply supabase/pending/mission_admin_approval_v1.sql
  apply supabase/pending/mission_admin_approval_v1.sql   # twice: idempotent
  apply supabase/pending/gated_track_mission_identity_v1.sql
  apply supabase/pending/gated_track_mission_identity_v1.sql
  echo "  applied both pending files twice"
}

echo "0. control: the same writes WITHOUT the pending file succeed (the gap)"
full_chain control
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/mission_admin_approval.control.sql

echo "1. existing suites with the pending files applied"
fresh engine; apply supabase/migrations/20261004015451_action_proof_retry_and_review_notifications_v1.sql
sql "alter table public.action_missions add column if not exists kind text not null default 'civic'"
apply supabase/pending/mission_admin_approval_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/action_mission_engine.behaviour.sql >/dev/null
apply supabase/migrations/20261002063754_action_network_fellowship_v1.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/action_fellowship.behaviour.sql >/dev/null
echo "  mission engine + fellowship behaviour: ok"

full_chain antisocial; pending
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/antisocial_connections.behaviour.sql >/dev/null
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/antisocial_levels.behaviour.sql >/dev/null
n=$(psql -At -d "$DB" -c "select count(*) from public.action_proof_review_history where source = 'antisocial_level' and decision = 'verified'")
[ "$n" -ge 6 ] || { echo "expected the Anti-Social level reviews in action_proof_review_history, got $n"; exit 1; }
echo "  antisocial connections + levels behaviour: ok ($n level verifications archived in action_proof_review_history)"

full_chain ladder; pending
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/policy_fellowship_ladder.behaviour.sql >/dev/null
echo "  policy fellowship ladder behaviour: ok"

echo "2. every former automatic path"
full_chain guards; pending
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/mission_admin_approval.behaviour.sql

echo "3. the gated track rule, in every apply order with the identity PR (#443)"
gated_mine_last() { psql -q -d postgres -c "alter database $DB set mcc.test_progress_owner = 'gated'" >/dev/null; }
full_chain gate_a; pending; gated_mine_last
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/gated_track_mission_identity.behaviour.sql
echo "  3a. #440 -> approval -> gated (no #443): ok"
if [ -f "$IDENTITY_SQL" ]; then
  full_chain gate_b
  apply supabase/pending/mission_admin_approval_v1.sql
  apply "$IDENTITY_SQL"
  apply supabase/pending/gated_track_mission_identity_v1.sql
  apply supabase/pending/gated_track_mission_identity_v1.sql
  gated_mine_last
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/gated_track_mission_identity.behaviour.sql
  echo "  3b. #440 -> approval -> #443 -> gated: ok"
  if [ -f "$IDENTITY_TEST" ]; then
    full_chain gate_b2
    apply supabase/pending/mission_admin_approval_v1.sql
    apply "$IDENTITY_SQL"
    apply supabase/pending/gated_track_mission_identity_v1.sql
    psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$IDENTITY_TEST" >/dev/null
    echo "  3b'. #443's own behaviour suite with the gated file applied after it: ok"
  fi
  full_chain gate_c; pending
  apply "$IDENTITY_SQL"
  apply "$IDENTITY_SQL"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/gated_track_mission_identity.behaviour.sql
  echo "  3c. #440 -> approval -> gated -> #443 (applies cleanly; the gate is still right): ok"
else
  echo "  3b/3c skipped: $IDENTITY_SQL not present (PR #443 not merged; set IDENTITY_SQL to test against its branch)"
fi
echo "mission admin approval + gated track: ok"
