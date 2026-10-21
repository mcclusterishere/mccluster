-- Isolated function-contract fixture only. Never apply to a real project.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
create or replace function public.current_m_uid() returns uuid language sql as $$ select auth.uid() $$;
create or replace function public.eu_is_admin() returns boolean language sql as $$ select false $$;
create or replace function public.join_action_mission(uuid) returns jsonb language sql as $$ select jsonb_build_object('assignment_id', gen_random_uuid()) $$;
alter table public.action_campaigns add column status text;
create table public.action_missions(id uuid primary key, status text);
create table public.action_bounties(id uuid primary key, campaign_id text, mission_id uuid, status text, eligibility text, max_awards int, reward_cents int, claim_ttl_minutes int);
create table public.action_cohorts(id uuid primary key, campaign_id text, status text);
create table public.action_cohort_members(cohort_id uuid, m_uid uuid);
create table public.action_bounty_funding_ledger(bounty_id uuid, delta_cents bigint, state text);
create table public.action_bounty_claims(
  id uuid primary key default gen_random_uuid(), bounty_id uuid not null,
  assignment_id uuid not null unique, user_id uuid not null, m_uid uuid not null,
  reward_cents int not null, status text not null, claimed_at timestamptz default now(),
  expires_at timestamptz not null, submitted_at timestamptz, approved_at timestamptz,
  paid_at timestamptz, reviewer_m_uid uuid, review_note text, payout_provider text, payout_ref text,
  unique(bounty_id,user_id)
);
