-- Public civic policy registry and paid research briefs. No constituent targeting or political persuasion.
create table if not exists public.action_policy_bills (
 id uuid primary key default gen_random_uuid(),
 source text not null check (source in ('legiscan','congress_gov','official')),
 external_id text not null,
 jurisdiction text not null,
 region_key text references public.action_globe_regions(region_key),
 bill_number text not null,
 title text not null,
 summary text,
 status text not null default 'unknown',
 official_url text,
 source_url text,
 topic text not null default 'business_entrepreneurship',
 last_action_at timestamptz,
 synced_at timestamptz not null default now(),
 unique(source,external_id)
);
create index if not exists action_policy_bills_region_idx on public.action_policy_bills(region_key,topic,status);
create table if not exists public.action_policy_official_profiles (
 id uuid primary key default gen_random_uuid(),
 m_uid uuid unique references public.m_people(id) on delete cascade,
 display_name text not null,
 office_title text not null,
 jurisdiction text not null,
 region_key text references public.action_globe_regions(region_key),
 official_website text,
 verified_at timestamptz,
 verification_method text,
 published boolean not null default false,
 created_at timestamptz not null default now(),
 check (not published or verified_at is not null)
);
create table if not exists public.action_policy_memo_bounties (
 id uuid primary key default gen_random_uuid(),
 official_profile_id uuid not null references public.action_policy_official_profiles(id),
 bill_id uuid references public.action_policy_bills(id),
 title text not null,
 research_question text not null,
 deliverables text not null,
 amount_cents bigint not null check(amount_cents>0),
 currency text not null default 'USD' check(currency='USD'),
 status text not null default 'draft' check(status in ('draft','published','closed','awarded','cancelled')),
 funding_status text not null default 'unfunded' check(funding_status in ('unfunded','pending','verified','refunded')),
 due_at timestamptz,
 created_at timestamptz not null default now(),
 check (status<>'published' or funding_status='verified')
);
create table if not exists public.action_policy_memo_submissions (
 id uuid primary key default gen_random_uuid(),
 bounty_id uuid not null references public.action_policy_memo_bounties(id),
 submitter_uid uuid not null references public.m_people(id),
 document_path text not null,
 status text not null default 'submitted' check(status in ('submitted','under_review','accepted','declined')),
 submitted_at timestamptz not null default now(),
 unique(bounty_id,submitter_uid)
);
alter table public.action_policy_bills enable row level security;
alter table public.action_policy_official_profiles enable row level security;
alter table public.action_policy_memo_bounties enable row level security;
alter table public.action_policy_memo_submissions enable row level security;
revoke all on public.action_policy_bills,public.action_policy_official_profiles,public.action_policy_memo_bounties,public.action_policy_memo_submissions from anon,authenticated;
grant select on public.action_policy_bills,public.action_policy_official_profiles,public.action_policy_memo_bounties to anon,authenticated;
grant all on public.action_policy_bills,public.action_policy_official_profiles,public.action_policy_memo_bounties,public.action_policy_memo_submissions to service_role;
create policy action_policy_public_bills on public.action_policy_bills for select to anon,authenticated using(true);
create policy action_policy_public_verified_officials on public.action_policy_official_profiles for select to anon,authenticated using(published and verified_at is not null);
create policy action_policy_public_funded_bounties on public.action_policy_memo_bounties for select to anon,authenticated using(status='published' and funding_status='verified');
-- Submission documents and identities are service-only; no public RLS policy.
