-- PRIM3 level builder: levels the house owner builds in prim3-builder.html (owner, 2026-11-02:
-- "on the back end ... a level builder ... drag and drop"; storage: Supabase, owner-only).
--
-- One row = one level document (the same JSON shape js/prim3-tactics/level-kit.mjs turns into an
-- engine config). Only the McCluster house owner creates, edits, publishes or deletes. Anyone may
-- read a level once it is published, so the game can load it; drafts stay private.
--
-- Additive only: a new table, a narrow helper and policies. Nothing existing changes.

create table if not exists public.prim3_levels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  title text not null check (char_length(title) between 1 and 80),
  data jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 400000),
  schema_version integer not null default 1 check (schema_version between 1 and 99),
  published boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.prim3_levels is 'PRIM3 tactics levels from the owner level builder. Drafts are owner-only; published rows are world-readable so the game can load them.';

-- Answers one question about the caller only: is this session the McCluster house owner?
-- Same rule as public.mccluster_is_house_owner(), exposed narrowly for these policies.
create or replace function public.prim3_levels_editor()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.org_members m
       join public.orgs o on o.id = m.org_id
       where o.slug = 'mccluster'
         and m.profile_id = auth.uid()
         and m.role = 'owner'
     );
$$;
revoke all on function public.prim3_levels_editor() from public;
grant execute on function public.prim3_levels_editor() to authenticated;

create or replace function public.prim3_levels_touch()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  new.updated_at := now();
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;
revoke all on function public.prim3_levels_touch() from public;

drop trigger if exists prim3_levels_touch on public.prim3_levels;
create trigger prim3_levels_touch before update on public.prim3_levels
for each row execute function public.prim3_levels_touch();

alter table public.prim3_levels enable row level security;

revoke all on public.prim3_levels from anon, authenticated;
grant select on public.prim3_levels to anon, authenticated;
grant insert, update, delete on public.prim3_levels to authenticated;

drop policy if exists "published levels are readable" on public.prim3_levels;
create policy "published levels are readable" on public.prim3_levels
  for select to anon, authenticated
  using (published);

drop policy if exists "house owner reads every level" on public.prim3_levels;
create policy "house owner reads every level" on public.prim3_levels
  for select to authenticated
  using (public.prim3_levels_editor());

drop policy if exists "house owner creates levels" on public.prim3_levels;
create policy "house owner creates levels" on public.prim3_levels
  for insert to authenticated
  with check (public.prim3_levels_editor() and created_by = auth.uid());

drop policy if exists "house owner edits levels" on public.prim3_levels;
create policy "house owner edits levels" on public.prim3_levels
  for update to authenticated
  using (public.prim3_levels_editor())
  with check (public.prim3_levels_editor());

drop policy if exists "house owner deletes levels" on public.prim3_levels;
create policy "house owner deletes levels" on public.prim3_levels
  for delete to authenticated
  using (public.prim3_levels_editor());
