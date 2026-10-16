-- Minimal stand-ins for the tables the mission pins / arcs / Black business
-- migration touches that the scratch chain does not otherwise create. Columns
-- mirror the real DDL: network_organizations and network_organization_members
-- from supabase/migrations/20261002173558_action_network_organizations_authenticity_v1.sql,
-- control_audit from production (information_schema, read 2026-10-15). Test
-- only; never applied to a real project. Applied after the gamification and
-- globe migrations in scripts/test-mission-pins-db.sh.
create table if not exists public.network_organizations (
 id uuid primary key default gen_random_uuid(), slug text not null, name text not null,
 organization_type text not null default 'community' check(organization_type in ('nonprofit','for_profit','committee','brand','community','project','school_org','other')),
 description text not null default '', website_url text,
 verification_state text not null default 'unverified' check(verification_state in ('unverified','pending','verified','rejected')),
 created_by uuid references public.m_people(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index if not exists network_organizations_slug_key on public.network_organizations(lower(slug));
create table if not exists public.network_organization_members(
 organization_id uuid not null references public.network_organizations(id) on delete cascade,
 m_uid uuid not null references public.m_people(id) on delete cascade,
 role text not null default 'member' check(role in ('member','checker','manager','admin','owner')),
 state text not null default 'joined' check(state in ('joined','invited','requested','suspended')),
 joined_at timestamptz not null default now(), primary key(organization_id,m_uid));
create table if not exists public.control_audit (
 id bigserial primary key, org_id uuid, actor_user_id uuid, actor_kind text not null, event text not null,
 capability text, resource_type text, resource_id text, command_id uuid, detail jsonb not null default '{}'::jsonb,
 at timestamptz not null default now());
revoke all on public.network_organizations, public.network_organization_members, public.control_audit from anon, authenticated;

-- the campaigns and the seven missions the curation names, at their 2026-10-15 production status
insert into public.action_campaigns(id) values ('critical-minerals-drc-001'), ('equity-uprise-003'), ('end-racism-002') on conflict do nothing;
insert into public.action_missions (id, campaign_id, title, description, domain, status) values
 ('9144bd42-f94a-494e-a17a-a45f9e155f86', 'critical-minerals-drc-001', 'Trace the minerals in your phone', 'fixture', 'research', 'open'),
 ('49d654e1-dfc8-42aa-a26e-22912ebf8dc6', 'critical-minerals-drc-001', 'Recycle one dead device the right way', 'fixture', 'community', 'open'),
 ('368fd75a-77d2-4de0-9722-17020674a914', 'equity-uprise-003', 'Write a policy memo', 'fixture', 'research', 'open'),
 ('df26314d-d4e1-47e3-b980-1b60b1a682ea', 'equity-uprise-003', 'Co-write a policy reform paper', 'fixture', 'research', 'draft'),
 ('7cfac26a-d757-42b9-803b-970f9d5030a8', 'equity-uprise-003', 'File a public comment', 'fixture', 'advocacy', 'open'),
 ('d7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c', null, 'Spend with intention', 'fixture', 'community', 'open'),
 ('ba66d4a3-cb62-4403-9b56-7ee00af059d8', 'end-racism-002', 'Spend $20 at a Black-owned business, then put them on', 'fixture', 'business', 'draft');
