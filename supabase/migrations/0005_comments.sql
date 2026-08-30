-- THE ROOM — fans get a voice. Anyone signed in (instant accounts
-- included) can speak; the world can read; only the owner can sweep.

create table if not exists public.comments (
  id      uuid primary key default gen_random_uuid(),
  at      timestamptz not null default now(),
  subject text not null,
  uid     uuid not null default auth.uid(),
  name    text not null check (char_length(name) between 1 and 60),
  body    text not null check (char_length(body) between 1 and 800),
  hidden  boolean not null default false
);

alter table public.comments enable row level security;

drop policy if exists cm_read on public.comments;
create policy cm_read on public.comments
  for select to anon, authenticated using (hidden = false);

drop policy if exists cm_speak on public.comments;
create policy cm_speak on public.comments
  for insert to authenticated with check (uid = auth.uid());

drop policy if exists cm_take_back on public.comments;
create policy cm_take_back on public.comments
  for delete to authenticated
  using (uid = auth.uid() or (auth.jwt() ->> 'email') = 'matthew@mccluster.org');

drop policy if exists cm_sweep on public.comments;
create policy cm_sweep on public.comments
  for update to authenticated
  using ((auth.jwt() ->> 'email') = 'matthew@mccluster.org');

grant select on public.comments to anon, authenticated;
grant insert, delete, update on public.comments to authenticated;

create index if not exists cm_subject on public.comments (subject, at desc);
