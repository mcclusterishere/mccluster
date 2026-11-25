-- Extra stand-ins for supabase/pending/music_label_artists_v1.sql, applied by
-- scripts/test-music-label-db.sh after the music release-integrity chain
-- (supabase_api_roles.stub.sql, music_creator_onboarding.stub.sql,
-- music_release_integrity.stub.sql and the three music migrations). Scratch
-- database only, never a real project.
--
-- The house: public.orgs / public.org_members and
-- public.mccluster_is_house_owner() as replay_migrations/0026_tenancy.sql and
-- 0072_org_helper_replay_foundation.sql define them (the parts the file
-- reads), and the M layer's columns from replay_migrations/0049_m_account_people.sql
-- that the role stub leaves out.
create table public.orgs(
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null default '',
  enabled boolean not null default true
);
create table public.org_members(
  org_id uuid not null references public.orgs(id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  primary key (org_id, profile_id)
);
create or replace function public.mccluster_is_house_owner()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
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
revoke execute on function public.mccluster_is_house_owner() from public, anon, authenticated;
grant execute on function public.mccluster_is_house_owner() to service_role;

alter table public.m_people
  add column if not exists status text not null default 'active' check (status in ('active','merged','disabled')),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();
alter table public.m_auth_user_links
  add column if not exists link_method text not null default 'bootstrap'
    check (link_method in ('bootstrap','signup','manual','provider_verified','admin_merge')),
  add column if not exists linked_at timestamptz not null default now();
create unique index if not exists m_auth_user_links_one_primary_idx on public.m_auth_user_links(m_uid) where is_primary;

-- creator_tracks comes from replay_migrations/0003_creator_cuts.sql, which
-- enables row level security; the onboarding stub's stand-in table does not.
-- Production has it on (the snapshot's relations row for creator_tracks).
alter table public.creator_tracks enable row level security;
