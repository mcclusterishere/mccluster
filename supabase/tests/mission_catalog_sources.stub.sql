-- Production's shape where supabase/pending/20261119140000_mission_catalog_sources_v1.sql (and its rollback) touch it,
-- for the proofs scripts/test/mission-catalog-sources.integration.mjs (PGlite), .native.integration.mjs (PostgreSQL 16
-- and 17) and scripts/test/mission-sources-owner.integration.mjs (the owner route over this database). Test-only. Never
-- applied to a real project.
--
-- Production facts copied, from catalog reads of project zmnhbrjyhxzhkxmhkexs (SELECT only, no table row, no created_by):
--   - default privileges in schema public, role postgres (2026-11-19): tables anon and authenticated arwdm, service_role
--     arwdDxtm; functions service_role X; sequences anon and authenticated rwU. MAINTAIN ('m') exists from PostgreSQL 17
--     only, so it is granted here only when server_version_num >= 170000;
--   - org_members_role_check: role in ('owner', 'staff', 'viewer') (2026-11-19): a house member who is not the owner is
--     staff or viewer, never 'member';
--   - network_organizations_name_check (char_length(name) between 1 and 120) and network_organizations_slug_check
--     (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$') (2026-11-19). They come from the statement production stored for
--     20261002173558, not from the repository's copy of that file (maps/00-gaps.md F19, decision D11), so a stub built
--     from the repository alone would lack them;
--   - the policies and grants of network_organizations, network_organization_members and authenticity_checks, byte for
--     byte from supabase/migrations/20261002173558_action_network_organizations_authenticity_v1.sql:44-55;
--   - control_audit in the 0047 shape (supabase/replay_migrations/0047_control_authority_core.sql:73-86) with row level
--     security and control_audit_read (supabase/replay_migrations/20261028230000_schema_reconcile_production_only_v1.sql:887-889);
--   - action_missions' status check, grants and two policies (supabase/tests/action_mission_catalog.stub.sql, production's
--     2026-11-17 read) and action_mission_details' grants and two policies
--     (supabase/migrations/20261118021521_action_mission_details.sql:85-102): no insert, update or delete for anon or
--     authenticated on details;
--   - the two existing organization rows (authenticity-network, equity-uprise: verified, created_by null), with their seed
--     descriptions.
-- Stand-ins, smaller than production but the same where the tested SQL reads them: auth.users, auth.uid(), m_people,
-- m_links, current_m_uid(), eu_is_admin() (true when the request's claims carry "admin": "true"), private.is_org_member(),
-- network_groups, action_campaigns (its two policies are production's names over a stand-in status column), the columns
-- of action_missions and action_mission_details the tested SQL and the page read.
--
-- Fixture accounts (synthetic ids; 11111111-… and 22222222-… are also the League plane's "owner" and "peer"):
--   11111111-1111-4111-8111-111111111111  the house owner (org_members role owner)
--   22222222-2222-4222-8222-222222222222  house staff (role staff)
--   88888888-8888-4888-8888-888888888888  house viewer (role viewer)
--   66666666-6666-4666-8666-666666666666  a signed-in member with an M identity, in no house role
-- Fixture missions: three Drawdown drafts with details rows and one open mission from no catalog. The proofs open a
-- Drawdown mission (the publish, release step 9) when they need one.
do $r$ begin
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
exception when duplicate_object then null; end $r$;
grant anon, authenticated, service_role to postgres;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists auth;
create schema if not exists private;
grant usage on schema auth, private to anon, authenticated, service_role;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Production's default privileges (2026-11-19)
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
do $m$ begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter default privileges in schema public grant maintain on tables to anon, authenticated';
  end if;
end $m$;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant execute on functions to service_role;
alter default privileges in schema public grant usage, select, update on sequences to anon, authenticated;

create table public.m_people (id uuid primary key);
create table public.m_links (user_id uuid primary key, m_uid uuid references public.m_people (id));
create function public.current_m_uid() returns uuid language sql stable security definer set search_path = '' as
  $$ select m_uid from public.m_links where user_id = (select auth.uid()) $$;
create function public.eu_is_admin() returns boolean language sql stable as
  $$ select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'admin', '') = 'true' $$;
grant execute on function public.current_m_uid(), public.eu_is_admin() to anon, authenticated, service_role;

-- The house organization and its members
create table public.orgs (id uuid primary key default gen_random_uuid(), slug text not null unique);
create table public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  profile_id uuid not null,
  role text not null default 'viewer',
  constraint org_members_role_check check (role in ('owner', 'staff', 'viewer')),
  primary key (org_id, profile_id));
create function private.is_org_member(p_org uuid) returns boolean language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from public.org_members m where m.org_id = p_org and m.profile_id = (select auth.uid())) $$;
grant execute on function private.is_org_member(uuid) to anon, authenticated, service_role;

create table public.control_audit (
  id bigint generated always as identity primary key,
  org_id uuid references public.orgs (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_kind text not null default 'system',
  event text not null,
  capability text,
  resource_type text,
  resource_id text,
  command_id uuid,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now());
create index control_audit_org_at_idx on public.control_audit (org_id, at desc);
alter table public.control_audit enable row level security;
create policy control_audit_read on public.control_audit for select to authenticated using (private.is_org_member(org_id));

-- Organizations: the repository's table plus production's two checks, grants and policies
create table public.network_organizations (
 id uuid primary key default gen_random_uuid(), slug text not null, name text not null,
 organization_type text not null default 'community' check(organization_type in ('nonprofit','for_profit','committee','brand','community','project','school_org','other')),
 description text not null default '', website_url text,
 verification_state text not null default 'unverified' check(verification_state in ('unverified','pending','verified','rejected')),
 created_by uuid references public.m_people(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint network_organizations_name_check check ((char_length(name) >= 1) and (char_length(name) <= 120)),
 constraint network_organizations_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{1,63}$'));
create unique index network_organizations_slug_key on public.network_organizations(lower(slug));
create table public.network_organization_members(
 organization_id uuid not null references public.network_organizations(id) on delete cascade,
 m_uid uuid not null references public.m_people(id) on delete cascade,
 role text not null default 'member' check(role in ('member','checker','manager','admin','owner')),
 state text not null default 'joined' check(state in ('joined','invited','requested','suspended')),
 joined_at timestamptz not null default now(), primary key(organization_id,m_uid));
create table public.network_groups (id uuid primary key default gen_random_uuid(), slug text not null,
 organization_id uuid references public.network_organizations(id) on delete set null);
create table public.action_campaigns (id text primary key, status text not null default 'draft',
 organization_id uuid references public.network_organizations(id) on delete set null);
create table public.authenticity_checks(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.network_organizations(id) on delete cascade,
 group_id uuid references public.network_groups(id) on delete set null, campaign_id text references public.action_campaigns(id) on delete set null,
 submitted_by uuid not null references auth.users(id) on delete cascade, submitted_by_m_uid uuid references public.m_people(id) on delete set null,
 item_type text not null default 'sneakers', brand text not null default '', model text not null default '', colorway text not null default '',
 story text not null default '', evidence jsonb not null default '[]'::jsonb check(jsonb_typeof(evidence)='array'),
 status text not null default 'submitted',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.network_organizations enable row level security;
alter table public.network_organization_members enable row level security;
alter table public.authenticity_checks enable row level security;
alter table public.network_groups enable row level security;
alter table public.action_campaigns enable row level security;
revoke all on public.network_organizations,public.network_organization_members,public.authenticity_checks from public,anon,authenticated;
grant all on public.network_organizations,public.network_organization_members,public.authenticity_checks to service_role;
grant select on public.network_organizations to anon,authenticated;
grant select on public.network_organization_members to authenticated;
grant select,insert on public.authenticity_checks to authenticated;
create policy "public reads organizations" on public.network_organizations for select to anon,authenticated using(true);
create policy "members read organization membership" on public.network_organization_members for select to authenticated using(m_uid=(select public.current_m_uid()) or (select public.eu_is_admin()) or exists(select 1 from public.network_organization_members mine where mine.organization_id=network_organization_members.organization_id and mine.m_uid=(select public.current_m_uid()) and mine.state='joined'));
create policy "members read authenticity checks" on public.authenticity_checks for select to authenticated using((select auth.uid())=submitted_by or (select public.eu_is_admin()) or exists(select 1 from public.network_organization_members m where m.organization_id=authenticity_checks.organization_id and m.m_uid=(select public.current_m_uid()) and m.state='joined'));
create policy "members submit own authenticity checks" on public.authenticity_checks for insert to authenticated with check((select auth.uid())=submitted_by and submitted_by_m_uid=(select public.current_m_uid()));
create policy "groups are visible across the network" on public.network_groups for select to authenticated using (true);
create policy "anyone reads public campaigns" on public.action_campaigns for select to anon, authenticated
  using (status in ('live', 'paused', 'closed') or (select public.eu_is_admin()));
create policy "owner writes campaigns" on public.action_campaigns for all to authenticated
  using ((select public.eu_is_admin())) with check ((select public.eu_is_admin()));

-- Missions and their details
create table public.action_missions (
  id uuid primary key default gen_random_uuid(),
  campaign_id text references public.action_campaigns (id) on delete cascade,
  title text not null, description text not null default '', domain text not null default 'community',
  difficulty smallint not null default 1, base_points integer not null default 100,
  status text not null default 'draft', kind text not null default 'civic',
  constraint action_missions_status_check check (status = any (array['draft'::text, 'open'::text, 'paused'::text, 'closed'::text])));
alter table public.action_missions enable row level security;
revoke all on public.action_missions from public, anon, authenticated;
grant select on public.action_missions to anon;
grant select, insert, update, delete on public.action_missions to authenticated;
grant all on public.action_missions to service_role;
create policy "admins manage missions" on public.action_missions as permissive for all to authenticated
  using ((select public.eu_is_admin())) with check ((select public.eu_is_admin()));
create policy "public reads open missions" on public.action_missions as permissive for select to anon, authenticated
  using (((status = any (array['open'::text, 'paused'::text, 'closed'::text])) or (select public.eu_is_admin())));
create table public.action_mission_details (
  mission_id uuid not null, catalog text not null, slug text not null, credit_line text not null,
  about text, about_credit text, source_url text, license_name text, license_url text, doi text,
  constraint action_mission_details_pkey primary key (mission_id),
  constraint action_mission_details_mission_id_fkey foreign key (mission_id) references public.action_missions (id) on delete cascade,
  constraint action_mission_details_catalog_slug_key unique (catalog, slug),
  constraint action_mission_details_catalog_check check (catalog ~ '^[a-z][a-z0-9_-]{1,39}$'));
alter table public.action_mission_details enable row level security;
revoke all on table public.action_mission_details from public, anon, authenticated;
grant select on table public.action_mission_details to anon, authenticated;
grant all on table public.action_mission_details to service_role;
create policy "public reads open mission details" on public.action_mission_details
  as permissive for select to anon, authenticated
  using (exists (
    select 1 from public.action_missions m
     where m.id = action_mission_details.mission_id
       and ((m.status = any (array['open'::text, 'paused'::text, 'closed'::text])) or (select public.eu_is_admin()))
  ));
create policy "admins manage mission details" on public.action_mission_details
  as permissive for all to authenticated
  using ((select public.eu_is_admin()))
  with check ((select public.eu_is_admin()));

-- Fixture rows
insert into auth.users (id) values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222'),
  ('88888888-8888-4888-8888-888888888888'), ('66666666-6666-4666-8666-666666666666');
insert into public.m_people (id) values ('b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4');
insert into public.m_links (user_id, m_uid) values ('66666666-6666-4666-8666-666666666666', 'b4b4b4b4-b4b4-44b4-84b4-b4b4b4b4b4b4');
insert into public.orgs (id, slug) values ('c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0', 'mccluster');
insert into public.org_members (org_id, profile_id, role) values
  ('c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0', '22222222-2222-4222-8222-222222222222', 'staff'),
  ('c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0', '88888888-8888-4888-8888-888888888888', 'viewer');
insert into public.network_organizations (slug, name, organization_type, description, verification_state) values
  ('authenticity-network', 'Authenticity Network', 'community',
   'A community for evidence-based legit checks, counterfeit education, and authentic buying.', 'verified');
insert into public.network_organizations (slug, name, organization_type, description, website_url, verification_state) values
  ('equity-uprise', 'Equity Uprise', 'project',
   'The civic program of McCluster Corp. On the Uprise Action Network it is the cohort group for people who want to become Equity Uprise cohort policy writers.',
   'https://matthew.mccluster.org/docket-516.html', 'verified');
insert into public.action_missions (id, title, description, domain, difficulty, base_points, status) values
  ('d0000000-0000-4000-8000-000000000001', 'Fixture: insulate one draughty door', 'A Drawdown fixture mission.', 'community', 1, 100, 'draft'),
  ('d0000000-0000-4000-8000-000000000002', 'Fixture: map a bike route to school', 'A Drawdown fixture mission.', 'research', 2, 150, 'draft'),
  ('d0000000-0000-4000-8000-000000000003', 'Fixture: start a compost bin', 'A Drawdown fixture mission.', 'community', 1, 100, 'draft'),
  ('e0000000-0000-4000-8000-000000000001', 'Fixture: an open mission from no catalog', 'Not a Drawdown mission.', 'community', 1, 100, 'open');
insert into public.action_mission_details (mission_id, catalog, slug, credit_line, source_url) values
  ('d0000000-0000-4000-8000-000000000001', 'drawdown', 'drawdown-fixture-door', 'Fixture credit line.', 'https://drawdown.org/explorer'),
  ('d0000000-0000-4000-8000-000000000002', 'drawdown', 'drawdown-fixture-bike', 'Fixture credit line.', 'https://drawdown.org/explorer'),
  ('d0000000-0000-4000-8000-000000000003', 'drawdown', 'drawdown-fixture-compost', 'Fixture credit line.', 'https://drawdown.org/explorer');
