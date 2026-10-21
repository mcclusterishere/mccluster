-- STAGED ONLY: imported from PR #424 for consolidation review. DO NOT APPLY as-is.
-- Reconcile migration versions with live production ledger, existing allocations, rights authorization, and function security before promotion.
-- Explicit cohort ISRC authorization; membership alone does not grant QT6KV issuance.
create table if not exists public.music_cohort_isrc_grants (
 cohort_id uuid not null references public.action_cohorts(id),
 m_uid uuid not null references public.music_creator_profiles(m_uid),
 isrc_eligible boolean not null default false,
 rights_authorized boolean not null default false,
 rights_evidence_url text not null default '',
 approved_by uuid,
 approved_at timestamptz,
 revoked_at timestamptz,
 primary key (cohort_id,m_uid),
 check (not isrc_eligible or (rights_authorized and approved_by is not null and approved_at is not null and rights_evidence_url <> ''))
);
alter table public.music_cohort_isrc_grants enable row level security;
revoke all on public.music_cohort_isrc_grants from public,anon,authenticated;
grant select,insert,update on public.music_cohort_isrc_grants to service_role;
