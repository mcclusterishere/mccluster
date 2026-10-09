-- STAGED: immutable three-day baseline snapshots and one-time consultation entitlements.
-- Not a deployment or a verified analytics ingestion pipeline.
create table if not exists public.creator_trial_report_cards (
 id uuid primary key default gen_random_uuid(),
 creator_user_id uuid not null references auth.users(id) on delete cascade,
 trial_start date not null,
 trial_end date not null,
 policy_version text not null default 'creator-trial-v1',
 measurement_status text not null check(measurement_status in ('complete','partial','unavailable')),
 metrics jsonb not null default '{}'::jsonb,
 milestone_recommendations jsonb not null default '[]'::jsonb,
 source_provenance jsonb not null default '{}'::jsonb,
 generated_at timestamptz not null default now(),
 check(trial_end=trial_start+2),
 unique(creator_user_id,trial_start,policy_version)
);
create table if not exists public.creator_consultation_entitlements (
 creator_user_id uuid primary key references auth.users(id) on delete cascade,
 duration_minutes integer not null default 15 check(duration_minutes=15),
 status text not null default 'available' check(status in ('available','reserved','redeemed','expired')),
 booking_reference text unique,
 granted_at timestamptz not null default now(),
 redeemed_at timestamptz,
 check((status='redeemed')=(redeemed_at is not null))
);
create index if not exists creator_trial_reports_creator_idx on public.creator_trial_report_cards(creator_user_id,generated_at desc);
alter table public.creator_trial_report_cards enable row level security;
alter table public.creator_trial_report_cards force row level security;
alter table public.creator_consultation_entitlements enable row level security;
alter table public.creator_consultation_entitlements force row level security;
revoke all on public.creator_trial_report_cards,public.creator_consultation_entitlements from public,anon,authenticated;
grant select on public.creator_trial_report_cards,public.creator_consultation_entitlements to authenticated;
create policy creator_report_owner_read on public.creator_trial_report_cards
for select to authenticated using(creator_user_id=(select auth.uid()));
create policy creator_consultation_owner_read on public.creator_consultation_entitlements
for select to authenticated using(creator_user_id=(select auth.uid()));
-- Writes are service-role only after server-side validation of the metric source.
-- Enforce append-only report cards, including for privileged writers.
create or replace function public.creator_trial_report_immutable()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'Creator trial report cards are immutable'; end $$;
create trigger creator_trial_report_immutable before update or delete on public.creator_trial_report_cards
for each row execute function public.creator_trial_report_immutable();
