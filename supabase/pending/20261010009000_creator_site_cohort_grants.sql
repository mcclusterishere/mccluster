-- STAGED: owner-curated cohort publication grants; no payment required.
create table if not exists public.creator_site_cohort_grants(
 org_id uuid primary key,
 creator_user_id uuid not null references auth.users(id),
 cohort_id uuid not null,
 granted_by uuid not null references auth.users(id),
 granted_at timestamptz not null default now(),
 revoked_at timestamptz,
 reason text not null check(length(trim(reason)) between 8 and 500)
);
create index if not exists creator_site_cohort_grants_creator_idx
 on public.creator_site_cohort_grants(creator_user_id) where revoked_at is null;
alter table public.creator_site_cohort_grants enable row level security;
alter table public.creator_site_cohort_grants force row level security;
revoke all on public.creator_site_cohort_grants from public,anon,authenticated;
grant all on public.creator_site_cohort_grants to service_role;
-- Only a trusted audited owner review action may grant/revoke.
-- A grant must validate current selected-cohort membership via
-- action_cohort_members.m_uid -> m_auth_user_links.auth_user_id.
-- Read-time and publish-time entitlement must check revoked_at IS NULL.
