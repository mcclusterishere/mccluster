-- STAGED ONLY. Creator cohort decision evidence; no production deployment.
-- All writes are reserved for a trusted service that validates enrollment,
-- cohort scope, reviewer identity, verification and permissions.
create table if not exists public.creator_team_preferences (
 id uuid primary key default gen_random_uuid(),
 cohort_id uuid not null references public.action_cohorts(id) on delete cascade,
 selector_user_id uuid not null references auth.users(id) on delete cascade,
 candidate_user_id uuid not null references auth.users(id) on delete cascade,
 target_role text not null check (char_length(trim(target_role)) between 2 and 80),
 preference_score smallint not null check (preference_score between 1 and 5),
 evidence_reference text,
 rationale text not null default '' check (char_length(rationale)<=2000),
 created_at timestamptz not null default now(),
 unique(cohort_id,selector_user_id,candidate_user_id,target_role),
 check(selector_user_id<>candidate_user_id)
);
create table if not exists public.creator_team_decisions (
 id uuid primary key default gen_random_uuid(),
 cohort_id uuid not null references public.action_cohorts(id) on delete cascade,
 super_creator_user_id uuid not null references auth.users(id),
 candidate_user_id uuid not null references auth.users(id),
 target_role text not null check (char_length(trim(target_role)) between 2 and 80),
 decision text not null check (decision in ('selected','declined','waitlisted')),
 preference_snapshot jsonb not null default '{}'::jsonb,
 aggregate_score numeric(5,2) check(aggregate_score between 0 and 100),
 deviation_from_peer_signal boolean not null default false,
 rationale text not null check (char_length(trim(rationale)) between 20 and 4000),
 evidence jsonb not null default '[]'::jsonb,
 policy_version text not null default 'creator-team-v1',
 decided_at timestamptz not null default now(),
 unique(cohort_id,super_creator_user_id,candidate_user_id,target_role)
);
create table if not exists public.creator_media_reviews (
 id uuid primary key default gen_random_uuid(),
 cohort_id uuid not null references public.action_cohorts(id) on delete cascade,
 reviewer_user_id uuid not null references auth.users(id),
 creator_user_id uuid not null references auth.users(id),
 media_reference text not null check (char_length(media_reference) between 1 and 2000),
 craft_score smallint not null check(craft_score between 1 and 5),
 fit_score smallint not null check(fit_score between 1 and 5),
 comment text not null check(char_length(trim(comment)) between 3 and 3000),
 created_at timestamptz not null default now()
);
create index if not exists creator_team_preferences_cohort_idx on public.creator_team_preferences(cohort_id,target_role,candidate_user_id);
create index if not exists creator_team_decisions_cohort_idx on public.creator_team_decisions(cohort_id,super_creator_user_id);
create index if not exists creator_media_reviews_creator_idx on public.creator_media_reviews(cohort_id,creator_user_id);
do $$
declare t text;
begin
 foreach t in array array['creator_team_preferences','creator_team_decisions','creator_media_reviews'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
-- Deliberately no client policies: application API must validate role,
-- membership, media ownership, access to peer signals and audit permissions.
-- Never expose individual peer votes to cohort applicants.
