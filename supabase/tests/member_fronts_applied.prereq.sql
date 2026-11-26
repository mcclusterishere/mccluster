-- Test-only stand-ins for the tables the applied member-front schema
-- (supabase/migrations/20261124164026_member_fronts_shared_revision_directory.sql) reads. Never applied to a real project.
create table if not exists public.platform_profiles(user_id uuid primary key, mccluster_id text, display_name text, avatar_url text);
create table if not exists public.m_auth_user_links(auth_user_id uuid, m_uid uuid references public.m_people(id), is_primary boolean default true);
create table if not exists public.network_profiles(m_uid uuid primary key, display_name text, avatar_url text, headline text, visibility text default 'public');
