-- Stand-ins for what supabase/pending/merch_marketplace_v1.sql relies on,
-- applied by scripts/test-merch-marketplace-db.sh after
-- supabase_api_roles.stub.sql. Shapes copied from the replay migrations
-- (0026_tenancy, 0031_org_helpers_out_of_the_api, 0047_control_authority_core,
-- 0055_client_connect) and production's storage tables. Scratch database only.
create table public.orgs (
  id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null,
  kind text not null default 'business' check (kind in ('studio', 'business', 'building')),
  settings jsonb not null default '{}'::jsonb, enabled boolean not null default true, created_at timestamptz not null default now());
create table public.org_members (
  org_id uuid not null references public.orgs(id) on delete cascade, profile_id uuid not null,
  role text not null default 'staff' check (role in ('owner', 'staff', 'viewer')),
  added_at timestamptz not null default now(), primary key (org_id, profile_id));
create table public.org_stripe_accounts (
  org_id uuid not null references public.orgs(id) on delete cascade, livemode boolean not null default false,
  account_reference text not null, stripe_account_id text, charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false, details_submitted boolean not null default false,
  onboarding_status text not null default 'not_started', requirements jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (org_id, livemode), unique (account_reference, livemode), unique (stripe_account_id));
create table public.control_audit (
  id bigint generated always as identity primary key, org_id uuid references public.orgs(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null, actor_kind text not null default 'system',
  event text not null, capability text, resource_type text, resource_id text, command_id uuid,
  detail jsonb not null default '{}'::jsonb, at timestamptz not null default now());
create function private.is_org_member(p_org uuid) returns boolean language sql stable security definer
  set search_path = public, pg_temp as $$
  select public.eu_is_admin() or exists (select 1 from public.org_members m where m.org_id = p_org and m.profile_id = auth.uid()) $$;
grant usage on schema private to anon, authenticated, service_role;
grant execute on function private.is_org_member(uuid) to anon, authenticated, service_role;
create schema if not exists storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
