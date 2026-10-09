-- At Night: private, server-controlled adult eligibility. Pending deployment approval.
-- No ID scans, document numbers, dates of birth, or selfies stored in this table.
create table if not exists public.at_night_verifications (
 user_id uuid primary key references auth.users(id) on delete cascade,
 status text not null default 'pending' check (status in ('pending','verified','rejected','revoked')),
 adult_verified boolean not null default false,
 host_approved boolean not null default false,
 provider text,
 provider_reference text,
 verified_at timestamptz,
 expires_at timestamptz,
 revoked_at timestamptz,
 updated_at timestamptz not null default now(),
 constraint at_night_verified_consistency check (
  status <> 'verified' or (adult_verified and provider is not null and provider_reference is not null and verified_at is not null and expires_at is not null)
 )
);
alter table public.at_night_verifications enable row level security;
alter table public.at_night_verifications force row level security;
revoke all on public.at_night_verifications from anon, authenticated;
-- No client insert/update/select policies: trusted service-role processing only.
create index if not exists at_night_verifications_status_idx on public.at_night_verifications(status,expires_at);
comment on table public.at_night_verifications is 'Server-only ID provider eligibility assertions. Never store raw identity documents.';
