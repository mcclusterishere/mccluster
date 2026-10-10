-- STAGED: dynamic creator comparison pool and auditable human-reviewed selection.
-- Not a deployed ranking or admission system.
create table if not exists public.creator_selection_profiles (
 creator_user_id uuid primary key references auth.users(id) on delete cascade,
 discipline text not null check(discipline in ('recording_artist','producer','audio_engineer','photographer','videographer','other')),
 stage text not null check(stage in ('new','emerging','established')),
 available_hours_weekly integer not null check(available_hours_weekly between 1 and 80),
 onboarding_started_at timestamptz not null default now(),
 trial_started_at date,
 trial_completed_at date,
 updated_at timestamptz not null default now()
);
create table if not exists public.creator_talent_reviews (
 id uuid primary key default gen_random_uuid(),
 creator_user_id uuid not null references auth.users(id) on delete cascade,
 reviewer_user_id uuid not null references auth.users(id),
 rubric_version text not null default 'talent-v1',
 technique smallint not null check(technique between 0 and 100),
 originality smallint not null check(originality between 0 and 100),
 craft smallint not null check(craft between 0 and 100),
 audience_fit smallint not null check(audience_fit between 0 and 100),
 evidence_reference text not null check(char_length(evidence_reference) between 1 and 2000),
 reviewed_at timestamptz not null default now(),
 unique(creator_user_id,reviewer_user_id,rubric_version),
 check(creator_user_id<>reviewer_user_id)
);
create table if not exists public.creator_selection_snapshots (
 id uuid primary key default gen_random_uuid(),
 creator_user_id uuid not null references auth.users(id) on delete cascade,
 report_card_id uuid not null references public.creator_trial_report_cards(id),
 score_version text not null default 'creator-selection-v1',
 peer_discipline text not null,
 peer_stage text not null,
 peer_sample_size integer not null check(peer_sample_size>=0),
 market_score numeric(5,2) check(market_score between 0 and 100),
 talent_score numeric(5,2) check(talent_score between 0 and 100),
 execution_score numeric(5,2) check(execution_score between 0 and 100),
 total_score numeric(5,2) generated always as (
 case when market_score is not null and talent_score is not null and execution_score is not null
 then round((market_score+talent_score+execution_score)/3,2) else null end
 ) stored,
 market_percentile numeric(5,2) check(market_percentile between 0 and 100),
 evidence jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 unique(creator_user_id,report_card_id,score_version),
 check(peer_sample_size>=20 or market_percentile is null)
);
create index if not exists creator_selection_pool_idx on public.creator_selection_profiles(discipline,stage,trial_completed_at);
create index if not exists creator_talent_reviews_creator_idx on public.creator_talent_reviews(creator_user_id,rubric_version);
create index if not exists creator_selection_snapshots_creator_idx on public.creator_selection_snapshots(creator_user_id,created_at desc);
do $$
declare t text;
begin
 foreach t in array array['creator_selection_profiles','creator_talent_reviews','creator_selection_snapshots'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('alter table public.%I force row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
grant select on public.creator_selection_profiles,public.creator_selection_snapshots to authenticated;
create policy creator_selection_profile_owner_read on public.creator_selection_profiles
 for select to authenticated using(creator_user_id=(select auth.uid()));
create policy creator_selection_snapshot_owner_read on public.creator_selection_snapshots
 for select to authenticated using(creator_user_id=(select auth.uid()));
-- No direct browser writes to profiles, reviews, or snapshots.
-- Privileged enrollment service must validate role/stage and authenticated identity.
-- Talent reviews are staff-only; reviewer authorization is checked by the future server endpoint.
create or replace function public.creator_selection_snapshot_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Creator selection snapshots are immutable'; end $$;
create trigger creator_selection_snapshot_immutable before update or delete on public.creator_selection_snapshots
 for each row execute function public.creator_selection_snapshot_immutable();

-- A snapshot must never attach one creator's score to another creator's report.
create or replace function public.creator_selection_validate_report_owner()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.creator_trial_report_cards r
   where r.id=new.report_card_id and r.creator_user_id=new.creator_user_id)
 then raise exception 'Creator report ownership mismatch'; end if;
 return new;
end $$;
create trigger creator_selection_report_owner before insert on public.creator_selection_snapshots
 for each row execute function public.creator_selection_validate_report_owner();
revoke all on function public.creator_selection_validate_report_owner() from public,anon,authenticated;
