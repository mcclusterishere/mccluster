-- Minimal stand-ins for the tables the music creator platform migration
-- (supabase/migrations/20260920041011_music_creator_platform_v1.sql), the
-- identity presentation migration (20261005054044) and the one-click creator
-- onboarding (supabase/migrations/20261021050105_music_creator_one_click_v1.sql) touch. Scratch
-- database only, never a real project. Applied after
-- supabase_api_roles.stub.sql by scripts/test-music-creator-db.sh.
--
-- current_m_uid() is replaced with the production definition (the primary
-- m_auth_user_links row) and, like production since the P0 containment
-- (replay_migrations/20260913174500_p0_control_plane_containment.sql), it is
-- NOT executable by anon.

create or replace function auth.role() returns text language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '')
$$;
grant execute on function auth.role() to anon, authenticated, service_role;

create table public.m_auth_user_links(
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  is_primary boolean not null default true
);
create or replace function public.current_m_uid() returns uuid language sql stable security definer set search_path to 'public' as $$
  select m_uid from public.m_auth_user_links where auth_user_id = auth.uid() and is_primary = true limit 1;
$$;
revoke execute on function public.current_m_uid() from public, anon;
grant execute on function public.current_m_uid() to authenticated, service_role;

create table public.platform_profiles(
  user_id uuid primary key references auth.users(id) on delete cascade,
  mccluster_id text unique, display_name text, avatar_url text
);
create table public.platform_apps(
  id uuid primary key default gen_random_uuid(), app_key text unique, name text, product_family text,
  kind text, public_url text, enabled boolean default true, settings jsonb default '{}'::jsonb
);
create table public.network_profiles(
  m_uid uuid primary key references public.m_people(id) on delete cascade,
  display_name text, headline text, bio text, avatar_url text, banner_url text, website_url text,
  visibility text not null default 'public'
);
create table public.fan_profiles(user_id uuid primary key references auth.users(id), display_name text, legal_name text);
create table public.l3_products(id uuid primary key default gen_random_uuid());
create table public.creator_tracks(
  id uuid primary key default gen_random_uuid(), uid uuid, title text, artist text,
  created_at timestamptz not null default now()
);

create schema if not exists storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
