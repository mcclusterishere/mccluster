-- STAGED: recipient identity mapping. No live Connect account creation until backend is enabled.
create table if not exists public.an_connect_recipients(
 user_id uuid primary key references auth.users(id) on delete restrict,
 stripe_account_id text unique check(stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
 account_kind text not null default 'recipient' check(account_kind in ('recipient','merchant')),
 environment text not null check(environment in ('test','live')),
 onboarding_status text not null default 'pending' check(onboarding_status in ('pending','onboarding','restricted','ready')),
 transfers_enabled boolean not null default false,
 payouts_enabled boolean not null default false,
 requirements_due jsonb not null default '[]'::jsonb,
 updated_at timestamptz not null default now(),
 check(onboarding_status<>'ready' or (transfers_enabled and payouts_enabled))
);
alter table public.an_connect_recipients enable row level security;
alter table public.an_connect_recipients force row level security;
revoke all on public.an_connect_recipients from public,anon,authenticated;
grant all on public.an_connect_recipients to service_role;
-- API must resolve account by authenticated user_id only, never accept a client-supplied
-- account ID. Verify returned account status via Stripe before every transfer.
