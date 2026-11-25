-- Production's shape of the mission tables and the functions around them, read (SELECT only: pg_attribute,
-- pg_constraint, pg_policy, pg_get_functiondef) from project zmnhbrjyhxzhkxmhkexs on 2026-11-17, for
-- scripts/test/mission-catalog.native.integration.mjs. Test-only. Never applied to a real project.
--
-- Applied after scripts/test/support/native-postgres.mjs supabaseShapedDatabase() (the three API roles,
-- auth.users, Supabase's default privileges). The test then applies the four applied globe migrations from
-- supabase/migrations/ (20261014013557, 20261014013601, 20261014014547, 20261014184518) and checks that every
-- function the pending SQL touches or calls has production's md5(prosrc).
--
-- Exact copies of production: the 18 columns, nine checks, keys, indexes, grants and both policies of
-- public.action_missions; auth.uid(), auth.jwt(), auth.role(); public.current_m_uid(); public.eu_is_admin();
-- public.intel_action_readiness_guard() and its two triggers; the columns, keys and checks of
-- public.action_mission_assignments and public.action_proofs.
-- Stand-ins, smaller than production but the same where the tested SQL reads them: m_people,
-- m_auth_user_links, eu_profiles, action_campaigns, intel_mission_decisions, intel_decision_readiness(),
-- social_content_items (a foreign key with ON DELETE SET NULL), action_creator_funding and
-- action_creator_payout_intents (each a mission_id with no foreign key, as production has them).
-- public.eu_role() is production's with one change: production names the house owner's address in its
-- second branch; this repository is public, so a reserved placeholder stands in. Every other admin is found
-- through eu_profiles.role, as in production.

-- auth: production's helpers, verbatim
create or replace function auth.uid() returns uuid language sql stable as $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
create or replace function auth.jwt() returns jsonb language sql stable as $function$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$;
create or replace function auth.role() returns text language sql stable as $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$;
grant execute on function auth.uid(), auth.jwt(), auth.role() to anon, authenticated, service_role;

-- Members: the canonical identity and its link to a sign-in
create table public.m_people(id uuid primary key default gen_random_uuid());
create table public.m_auth_user_links(
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  link_method text not null default 'bootstrap',
  is_primary boolean not null default true,
  linked_at timestamptz not null default now(),
  primary key (auth_user_id, m_uid)
);
create or replace function public.current_m_uid()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select m_uid from public.m_auth_user_links where auth_user_id=auth.uid() and is_primary=true limit 1;
$function$;
revoke all on function public.current_m_uid() from public, anon;
grant execute on function public.current_m_uid() to authenticated, service_role;

-- Admins
create table public.eu_profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'member' check (role = any (array['admin'::text, 'editor'::text, 'member'::text, 'host'::text, 'client'::text]))
);
alter table public.eu_profiles enable row level security;
revoke all on public.eu_profiles from public, anon, authenticated;
create or replace function public.eu_role()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case
    when auth.uid() is null then 'visitor'
    when (auth.jwt() ->> 'email') = 'owner@example.invalid' then 'admin'
    else coalesce((select p.role from public.eu_profiles p where p.id = auth.uid()), 'visitor')
  end;
$function$;
revoke all on function public.eu_role() from public, anon;
grant execute on function public.eu_role() to authenticated, service_role;
create or replace function public.eu_is_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$ select public.eu_role() = 'admin'; $function$;
revoke all on function public.eu_is_admin() from public;
grant execute on function public.eu_is_admin() to anon, authenticated, service_role;

-- Campaigns (production has none on 2026-11-17)
create table public.action_campaigns(
  id text primary key,
  slug text not null,
  status text not null default 'draft',
  title text not null
);
alter table public.action_campaigns enable row level security;

-- public.action_missions, column for column
create table public.action_missions (
  id uuid not null default gen_random_uuid(),
  campaign_id text,
  title text not null,
  description text not null default ''::text,
  domain text not null default 'community'::text,
  difficulty smallint not null default 1,
  base_points integer not null default 100,
  proof_required boolean not null default true,
  verification_mode text not null default 'review'::text,
  skills text[] not null default '{}'::text[],
  capacity integer,
  status text not null default 'draft'::text,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  kind text not null default 'civic'::text,
  discovery_category text
);
alter table public.action_missions add constraint action_missions_pkey PRIMARY KEY (id);
alter table public.action_missions add constraint action_missions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.action_campaigns(id) ON DELETE CASCADE;
alter table public.action_missions add constraint action_missions_base_points_check CHECK (((base_points >= 10) AND (base_points <= 1000)));
alter table public.action_missions add constraint action_missions_capacity_check CHECK (((capacity IS NULL) OR (capacity > 0)));
alter table public.action_missions add constraint action_missions_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 5)));
alter table public.action_missions add constraint action_missions_discovery_category_check CHECK ((discovery_category = ANY (ARRAY['create'::text, 'help'::text, 'explore'::text, 'earn'::text])));
alter table public.action_missions add constraint action_missions_domain_check CHECK ((domain = ANY (ARRAY['music'::text, 'advocacy'::text, 'community'::text, 'business'::text, 'research'::text, 'education'::text, 'mutual_aid'::text, 'creative'::text, 'other'::text])));
alter table public.action_missions add constraint action_missions_kind_check CHECK ((kind = ANY (ARRAY['civic'::text, 'clip'::text])));
alter table public.action_missions add constraint action_missions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'paused'::text, 'closed'::text])));
alter table public.action_missions add constraint action_missions_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 160)));
alter table public.action_missions add constraint action_missions_verification_mode_check CHECK ((verification_mode = ANY (ARRAY['review'::text, 'peer'::text, 'automatic'::text, 'none'::text])));
create index action_missions_campaign_id_idx on public.action_missions using btree (campaign_id) where (campaign_id is not null);
create index action_missions_kind_status_idx on public.action_missions using btree (kind, status);
alter table public.action_missions enable row level security;
revoke all on public.action_missions from public, anon, authenticated;
grant select on public.action_missions to anon;
grant select, insert, update, delete on public.action_missions to authenticated;
grant all on public.action_missions to service_role;
create policy "admins manage missions" on public.action_missions as permissive for all to authenticated
  using ((select public.eu_is_admin())) with check ((select public.eu_is_admin()));
create policy "public reads open missions" on public.action_missions as permissive for select to anon, authenticated
  using (((status = any (array['open'::text, 'paused'::text, 'closed'::text])) or (select public.eu_is_admin())));

-- Intel: a mission linked to a decision opens only when the decision is actionable
create table public.intel_mission_decisions(
  mission_id uuid primary key references public.action_missions(id) on delete restrict,
  org_id uuid not null,
  decision_id uuid not null,
  idempotency_key text not null default 'fixture',
  linked_by uuid not null default gen_random_uuid(),
  linked_at timestamptz not null default now()
);
alter table public.intel_mission_decisions enable row level security;
revoke all on public.intel_mission_decisions from public, anon, authenticated;
-- Production's reads ai_context; this stand-in never calls a decision actionable.
create or replace function public.intel_decision_readiness(p_org uuid, p_decision uuid)
 returns jsonb language sql stable as $function$ select jsonb_build_object('actionable', false) $function$;
create or replace function public.intel_action_readiness_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare m uuid; link record;
begin
  if tg_table_name='action_missions' then
    if new.status<>'open' then return new; end if;
    m:=new.id;
  else
    if new.status not in ('joined','in_progress') then return new; end if;
    m:=new.mission_id;
  end if;
  for link in select org_id,decision_id from public.intel_mission_decisions where mission_id=m loop
    if not coalesce((public.intel_decision_readiness(link.org_id,link.decision_id)->>'actionable')::boolean,false) then
      raise exception 'Intel mission requires a current reviewed decision and authorized approver' using errcode='42501';
    end if;
  end loop;
  return new;
end $function$;
revoke all on function public.intel_action_readiness_guard() from public, anon, authenticated;
grant execute on function public.intel_action_readiness_guard() to service_role;
create trigger intel_action_open_v2 before update of status on public.action_missions
  for each row execute function public.intel_action_readiness_guard();

-- Assignments and proofs, column for column (the two source foreign keys to social and live tables left out)
create table public.action_mission_assignments (
  id uuid not null default gen_random_uuid(),
  mission_id uuid not null,
  user_id uuid not null,
  m_uid uuid,
  status text not null default 'joined'::text,
  joined_at timestamp with time zone not null default now(),
  submitted_at timestamp with time zone,
  verified_at timestamp with time zone,
  source_content_id uuid,
  source_channel text,
  source_live_session_id uuid,
  source_reel text,
  source_actionable text
);
alter table public.action_mission_assignments add constraint action_mission_assignments_pkey PRIMARY KEY (id);
alter table public.action_mission_assignments add constraint action_mission_assignments_mission_id_user_id_key UNIQUE (mission_id, user_id);
alter table public.action_mission_assignments add constraint action_mission_assignments_mission_id_fkey FOREIGN KEY (mission_id) REFERENCES public.action_missions(id) ON DELETE CASCADE;
alter table public.action_mission_assignments add constraint action_mission_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.action_mission_assignments add constraint action_mission_assignments_status_check CHECK ((status = ANY (ARRAY['joined'::text, 'in_progress'::text, 'submitted'::text, 'verified'::text, 'rejected'::text, 'withdrawn'::text])));
alter table public.action_mission_assignments add constraint action_mission_assignments_source_actionable_check CHECK (((source_actionable IS NULL) OR (((char_length(source_actionable) >= 1) AND (char_length(source_actionable) <= 96)) AND (source_actionable ~ '^[a-z0-9][a-z0-9._:-]*$'::text))));
alter table public.action_mission_assignments add constraint action_mission_assignments_source_channel_check CHECK (((source_channel IS NULL) OR (((char_length(source_channel) >= 1) AND (char_length(source_channel) <= 32)) AND (source_channel ~ '^[a-z0-9][a-z0-9._-]*$'::text))));
alter table public.action_mission_assignments add constraint action_mission_assignments_source_reel_check CHECK (((source_reel IS NULL) OR (((char_length(source_reel) >= 1) AND (char_length(source_reel) <= 40)) AND (source_reel ~ '^[a-z0-9][a-z0-9._-]*$'::text))));
alter table public.action_mission_assignments enable row level security;
revoke all on public.action_mission_assignments from public, anon, authenticated;
grant select on public.action_mission_assignments to authenticated;
grant all on public.action_mission_assignments to service_role;
create trigger intel_action_start_v2 before insert or update of mission_id, status on public.action_mission_assignments
  for each row execute function public.intel_action_readiness_guard();

create table public.action_proofs (
  id uuid not null default gen_random_uuid(),
  assignment_id uuid not null,
  user_id uuid not null,
  proof_type text not null,
  proof_url text,
  statement text not null default ''::text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'pending'::text,
  reviewer_uid uuid,
  review_note text,
  created_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone
);
alter table public.action_proofs add constraint action_proofs_pkey PRIMARY KEY (id);
alter table public.action_proofs add constraint action_proofs_assignment_id_key UNIQUE (assignment_id);
alter table public.action_proofs add constraint action_proofs_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.action_mission_assignments(id) ON DELETE CASCADE;
alter table public.action_proofs add constraint action_proofs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.action_proofs add constraint action_proofs_proof_type_check CHECK ((proof_type = ANY (ARRAY['video'::text, 'photo'::text, 'link'::text, 'text'::text, 'artifact'::text])));
alter table public.action_proofs add constraint action_proofs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'rejected'::text])));
alter table public.action_proofs enable row level security;
revoke all on public.action_proofs from public, anon, authenticated;
grant select on public.action_proofs to authenticated;
grant all on public.action_proofs to service_role;

-- Two more kinds of reference production has to a mission
create table public.social_content_items (
  id uuid primary key default gen_random_uuid(),
  action_mission_id uuid references public.action_missions(id) on delete set null
);
alter table public.social_content_items enable row level security;
revoke all on public.social_content_items from public, anon, authenticated;
create table public.action_creator_funding (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid
);
alter table public.action_creator_funding enable row level security;
revoke all on public.action_creator_funding from public, anon, authenticated;
create table public.action_creator_payout_intents (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid
);
alter table public.action_creator_payout_intents enable row level security;
revoke all on public.action_creator_payout_intents from public, anon, authenticated;
