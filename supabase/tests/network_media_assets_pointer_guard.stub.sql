-- Stand-ins for what the applied DDL under test needs before it can run on a
-- scratch Postgres. Applied by scripts/test-network-media-pointer-guard-db.sh
-- BEFORE the real DDL it then reads out of the applied files, byte for byte:
--   supabase/replay_migrations/0049_m_account_people.sql   m_people, m_auth_user_links, m_merge_people
--   supabase/replay_migrations/0051_m_account_uid_rpc.sql  current_m_uid()
--   supabase/migrations/20260920071811_mnet_real_network_v1.sql, from its first
--     line to its Storage policies: network_media_assets, its policies and
--     grants, the mnet-media bucket and the four "mnet media owner" policies
-- Nothing about the table under test is written here. Test only; never
-- applied to a real project. With `psql -v real_storage=1` the storage
-- stand-ins are skipped (the real Storage API owns that schema); with
-- `-v real_supabase=1` as well, so are the roles and the auth stand-ins.

\if :{?real_supabase}
-- scripts/test-network-media-storage-flow.sh with SUPABASE_DB_IMAGE: the
-- official Supabase Postgres image already has the API roles, the auth schema
-- and auth.uid()/auth.role(); this file runs there as the restricted
-- `postgres` role (not a superuser, not the owner of auth or storage).
\else
-- The API roles, as Supabase creates them: the service role bypasses RLS,
-- the other two do not.
do $r$ begin create role anon nologin; exception when duplicate_object then null; end $r$;
do $r$ begin create role authenticated nologin; exception when duplicate_object then null; end $r$;
do $r$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $r$;
grant anon, authenticated, service_role to current_user;

create schema auth;
grant usage on schema public, auth to anon, authenticated, service_role;

create table auth.users (id uuid primary key, email text);
-- auth.uid() and auth.role() as Supabase defines them: PostgREST sets
-- request.jwt.claims, the Storage API also sets the older per-claim settings.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')::text
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
\endif

\if :{?real_storage}
-- scripts/test-network-media-storage-flow.sh: the real Storage API creates and
-- owns the storage schema, so nothing stands in for it.
\else
-- Storage, with the columns the policies and the tests read. As in
-- production: every upload (and every overwrite) gets a new version, the
-- bytes' eTag and size live in metadata, and the API roles hold the table
-- grants (RLS is the wall).
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  version text default gen_random_uuid()::text,
  metadata jsonb default jsonb_build_object('eTag', md5(random()::text), 'size', 1024),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
\endif

-- What the first lines of 20260920071811 alter or reference.
create table public.platform_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text
);
create table public.network_posts (
  id uuid primary key default gen_random_uuid(),
  author_m_uid uuid not null,
  body text not null default '',
  created_at timestamptz not null default now()
);
-- What public.m_merge_people moves besides the logins (0049).
create table public.m_devices (
  id uuid primary key default gen_random_uuid(),
  m_uid uuid not null,
  device_key text not null,
  last_seen_at timestamptz not null default now(),
  last_app_id uuid,
  last_org_id uuid,
  metadata jsonb not null default '{}'::jsonb
);
create table public.m_person_apps (
  m_uid uuid not null,
  app_id uuid not null,
  org_id uuid not null,
  role text not null default 'user',
  settings jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (m_uid, app_id, org_id)
);
