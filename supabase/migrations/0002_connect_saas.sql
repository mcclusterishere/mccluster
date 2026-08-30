-- CONNECT SAAS — the creator side of the backend. One row per
-- creator: slug (the pay link), plan, and the Stripe rail. The
-- Stripe columns and the plan are SERVER-ONLY (service role).

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

drop policy if exists providers_read on public.providers;
create policy providers_read on public.providers
  for select to anon, authenticated using (true);

drop policy if exists providers_claim on public.providers;
create policy providers_claim on public.providers
  for insert to authenticated
  with check (uid = auth.uid());

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
