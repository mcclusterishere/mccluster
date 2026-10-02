-- Minimal stand-ins for the Supabase pieces the Mission Engine migration relies on:
-- the API roles and their default grants, auth.uid(), current_m_uid(), eu_is_admin().
-- Test-only. Never applied to a real project.
do $r$ begin create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; exception when duplicate_object then null; end $r$;
grant anon, authenticated, service_role to postgres;
create extension if not exists pgcrypto;
create schema auth; create schema private;
grant usage on schema auth, public to anon, authenticated, service_role;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.m_people(id uuid primary key default gen_random_uuid());
create table public.m_links(user_id uuid primary key, m_uid uuid references public.m_people(id));
create function public.current_m_uid() returns uuid language sql stable security definer set search_path='' as $$ select m_uid from public.m_links where user_id = (select auth.uid()) $$;
create function public.eu_is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email','') = 'matthew@mccluster.org' $$;
grant execute on function public.current_m_uid(), public.eu_is_admin() to anon, authenticated, service_role;
create table public.action_campaigns(id text primary key);
-- Supabase default: new public tables are granted to the API roles
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.network_media_assets(id uuid primary key default gen_random_uuid(), owner_m_uid uuid, media_type text, status text default 'ready');
