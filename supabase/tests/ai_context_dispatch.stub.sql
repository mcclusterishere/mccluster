-- Minimal pre-state for supabase/pending/20261124235900_ai_context_dispatch_v1.sql on a disposable database.
-- Only the columns the dispatch SQL touches. Never run against production.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists ai_context;
create table public.orgs (id uuid primary key, slug text not null, enabled boolean not null default true);
create table public.org_members (org_id uuid not null, profile_id uuid not null, role text not null);
create table public.ops_agent_jobs (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, job_type text not null, status text not null default 'queued',
  output jsonb not null default '{}'::jsonb, attempts integer not null default 0, last_error text, updated_at timestamptz not null default now());
create table public.control_capabilities (capability text primary key, description text not null, risk text not null default 'low' check (risk in ('low','medium','high')));
create table public.control_approvals (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), capability text not null references public.control_capabilities(capability),
  resource_type text not null, resource_id text not null, request_hash text not null, reason text,
  state text not null default 'pending' check (state in ('pending','approved','denied','expired')),
  requested_by uuid not null, decided_by uuid, created_at timestamptz not null default now(), decided_at timestamptz,
  expires_at timestamptz not null default now() + interval '30 minutes');
create table ai_context.decisions (
  id uuid primary key default gen_random_uuid(), org_id uuid not null, title text not null, decision text not null, rationale_summary text,
  risk_class text not null default 'low', status text not null default 'proposed', proposed_by text, approved_by uuid, approved_at timestamptz,
  metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create or replace function ai_context.workstream_require_house(p_org uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  if p_org is null or not exists (select 1 from public.orgs o where o.id = p_org and o.slug = 'mccluster' and o.enabled = true) then
    raise exception 'organization outside Core authority' using errcode = '42501';
  end if;
end;
$$;
insert into public.orgs values ('00000000-0000-4000-8000-000000000001', 'mccluster', true), ('00000000-0000-4000-8000-000000000002', 'tenant', true);
insert into public.org_members values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000aa', 'owner'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000bb', 'member');
