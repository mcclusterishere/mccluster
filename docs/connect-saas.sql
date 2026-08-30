-- ============================================================
-- CONNECT SAAS — the creator side of the backend.
--
-- One row per creator: their slug (the pay link), their plan
-- (free | premium), and their Stripe rail. The world can read
-- the public face; a creator can claim and edit their own desk;
-- the Stripe columns and the plan are SERVER-ONLY — the webhook
-- and connect-onboard write them with the service role, so no
-- one can stamp their own rail live or gift themselves premium.
--
-- PASTE: Supabase → SQL Editor ("Here" project) → run once.
-- ============================================================

create table if not exists public.providers (
  slug            text primary key,
  uid             uuid not null default auth.uid(),
  name            text not null,
  craft           text not null default '',
  rate            numeric not null default 0,
  plan            text not null default 'free',
  stripe_acct     text,
  charges_enabled boolean not null default false,
  stripe_customer text,
  created_at      timestamptz not null default now(),
  unique (uid)
);

alter table public.providers enable row level security;

-- the world sees the desk's public face
drop policy if exists providers_read on public.providers;
create policy providers_read on public.providers
  for select to anon, authenticated using (true);

-- a signed-in creator claims exactly one desk, as themselves
drop policy if exists providers_claim on public.providers;
create policy providers_claim on public.providers
  for insert to authenticated
  with check (uid = auth.uid());

-- and edits their own name/craft/rate
drop policy if exists providers_edit on public.providers;
create policy providers_edit on public.providers
  for update to authenticated
  using (uid = auth.uid());

-- column law: the rail and the plan are server-only.
revoke all on public.providers from anon, authenticated;
grant select (slug, uid, name, craft, rate, plan, stripe_acct, charges_enabled)
  on public.providers to anon, authenticated;
grant insert (slug, uid, name, craft, rate)
  on public.providers to authenticated;
grant update (name, craft, rate)
  on public.providers to authenticated;

-- self-check: expect providers_ready = 1
select count(*) as providers_ready from information_schema.tables
 where table_schema = 'public' and table_name = 'providers';
