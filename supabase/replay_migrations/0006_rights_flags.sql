-- THE RIGHTS DESK — the rights class, flippable from the back office.
-- data/prints.json and data/gallery.json carry each frame's baseline
-- (editorial | released); this table overrides it live, so flipping a
-- frame from editorial to released when a contract lands never needs a
-- deploy. The store (js/counter.js) reads it anonymously on load; only
-- the owner writes it, from admin.html → Rights.
--
-- Apply: Supabase Dashboard → SQL editor → run this file.

create table if not exists public.rights_flags (
  id         text primary key,   -- photo / media / event id (rally-01, vaunt-runway)
  rights     text not null check (rights in ('editorial','released')),
  note       text,               -- why: "contract on file — both models"
  updated_at timestamptz not null default now()
);

alter table public.rights_flags enable row level security;

-- the whole store reads the law
drop policy if exists rf_read on public.rights_flags;
create policy rf_read on public.rights_flags
  for select to anon, authenticated using (true);

-- only the owner writes it
drop policy if exists rf_ins on public.rights_flags;
create policy rf_ins on public.rights_flags
  for insert to authenticated
  with check ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

drop policy if exists rf_upd on public.rights_flags;
create policy rf_upd on public.rights_flags
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

grant select on public.rights_flags to anon, authenticated;
grant insert, update on public.rights_flags to authenticated;
