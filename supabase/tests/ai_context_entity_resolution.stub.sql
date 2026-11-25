-- Minimal pre-state for supabase/pending/20261125001000_ai_context_entity_resolution_v1.sql on a disposable database.
-- Only the columns the entity resolution SQL touches. Never run against production.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists ai_context;
create table public.orgs (id uuid primary key, slug text not null, enabled boolean not null default true);
create table public.org_members (org_id uuid not null, profile_id uuid not null, role text not null);
create table public.ops_ontology_objects (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.orgs(id), type_key text not null,
  object_key text not null, display_name text not null default '', properties jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(), unique (org_id, type_key, object_key), unique (id, org_id));
create table public.ops_entity_resolution_events (
  id bigint generated always as identity primary key, org_id uuid not null, namespace text not null, alias_key text not null,
  candidate_object_id uuid, selected_object_id uuid, source_record_id uuid,
  decision text not null check (decision in ('candidate','resolve','reject','reassign')),
  method text not null check (method in ('deterministic','rule','model','manual')),
  confidence numeric(4,3), rationale text, actor_user_id uuid,
  actor_kind text not null default 'system' check (actor_kind in ('owner','agent','system','service')), at timestamptz not null default now());
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
-- Fixture records: two leads that are one person (same email), a lead and a client with the same name and company
-- but no shared key (owner review), two venues with the same domain and name, and an unrelated contact.
insert into public.ops_ontology_objects (id, org_id, type_key, object_key, display_name, properties) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'lead', 'crm:lead:1', 'Dana Reyes', '{"email":"Dana.Reyes+events@Example.org"}'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'client', 'stripe:cus_2', 'Dana Reyes', '{"email":"dana.reyes@example.org"}'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'lead', 'crm:lead:3', 'Chris Okafor', '{"company":"Harbor Lights LLC"}'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'client', 'gmail:c4', 'Chris Okafor', '{"company":"Harbor Lights"}'),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'venue', 'places:5', 'The Loft', '{"website":"https://www.theloftct.com/"}'),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000001', 'venue', 'crm:venue:6', 'Loft Inc', '{"domain":"theloftct.com"}'),
  ('10000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000001', 'contact', 'gmail:c7', 'Sam Lee', '{"email":"sam@another.example"}'),
  ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'lead', 'tenant:1', 'Tenant Person', '{}');
