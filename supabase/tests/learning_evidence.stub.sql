-- Test-only stand-ins for learning_evidence_v1: the house organization tables the
-- reviewer test reads. Apply after supabase_api_roles.stub.sql and
-- supabase_storage.stub.sql in an isolated database. Never production.
create table if not exists public.orgs(id uuid primary key default gen_random_uuid(), slug text unique not null);
create table if not exists public.org_members(org_id uuid references public.orgs(id), profile_id uuid, role text not null, primary key (org_id, profile_id));
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
revoke all on public.orgs, public.org_members from anon, authenticated;
