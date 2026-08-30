-- ============================================================
-- THE FRONT DESK — the CRM rail.
--
-- One table. The front door lets ANYONE drop a lead in (insert
-- only — nobody can read the pile back). The desk lets ONLY the
-- owner read and work the pipeline. Google Ads attribution
-- (utm_* / gclid) rides in on every lead from js/crm.js.
--
-- PASTE: Supabase → SQL Editor ("Here" project) → run once.
-- ============================================================

create table if not exists public.leads (
  id       uuid primary key default gen_random_uuid(),
  at       timestamptz not null default now(),
  name     text not null,
  email    text not null,
  want     text not null default '',
  note     text not null default '',
  page     text not null default '',
  source   text not null default 'direct',   -- 'google-ads', 'instagram', 'direct', …
  medium   text,
  campaign text,
  gclid    text,
  status   text not null default 'new' check (status in ('new','replied','booked','closed'))
);

alter table public.leads enable row level security;

-- the front door: anyone can drop a lead; nobody reads them back
drop policy if exists leads_in on public.leads;
create policy leads_in on public.leads
  for insert to anon, authenticated with check (true);

-- the desk: only the owner reads and works the pipeline
drop policy if exists leads_desk on public.leads;
create policy leads_desk on public.leads
  for select to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

drop policy if exists leads_work on public.leads;
create policy leads_work on public.leads
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

grant insert on public.leads to anon, authenticated;
grant select, update on public.leads to authenticated;

create index if not exists leads_at on public.leads (at desc);

-- self-check: expect leads_ready = 1
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'leads') as leads_ready;
