-- Minimal stand-in for Supabase Storage's schema, for a scratch database only
-- (never applied to a real project). Columns mirror what policies and
-- functions under test read: storage.buckets, storage.objects (bucket_id,
-- name, owner, owner_id, metadata{size,mimetype}) and storage.foldername().
-- The Storage API sets `owner` from the caller's token; here the column
-- default does the same so a direct INSERT as `authenticated` behaves alike.
-- Applied after supabase_api_roles.stub.sql.
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;
create table if not exists storage.buckets(
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects(
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null,
  owner uuid default nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid,
  owner_id text default nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', ''),
  metadata jsonb,
  created_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
