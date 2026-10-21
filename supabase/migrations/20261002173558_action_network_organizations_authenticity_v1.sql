-- ACTION NETWORK ORGANIZATIONS + AUTHENTICITY v1
-- Promotes Mnet groups into organization-owned program fronts without changing
-- existing group/post IDs. Seeds the first vertical: Authenticity Network ->
-- The Heat Chart · Authenticity -> Be Authentic -> legit-check missions.
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
create index if not exists network_organization_members_m_uid_idx on public.network_organization_members(m_uid) where state='joined';
alter table public.network_groups add column if not exists organization_id uuid references public.network_organizations(id) on delete set null;
alter table public.network_groups add column if not exists group_type text not null default 'community' check(group_type in ('community','program','committee','chapter','campaign_hub','service'));
alter table public.network_groups add column if not exists front_page_url text;
create index if not exists network_groups_organization_idx on public.network_groups(organization_id);
alter table public.action_campaigns add column if not exists organization_id uuid references public.network_organizations(id) on delete set null;
alter table public.action_campaigns add column if not exists group_id uuid references public.network_groups(id) on delete set null;
create index if not exists action_campaigns_organization_idx on public.action_campaigns(organization_id);
create table if not exists public.authenticity_checks(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.network_organizations(id) on delete cascade,
 group_id uuid references public.network_groups(id) on delete set null, campaign_id text references public.action_campaigns(id) on delete set null,
 submitted_by uuid not null references auth.users(id) on delete cascade, submitted_by_m_uid uuid references public.m_people(id) on delete set null,
 item_type text not null default 'sneakers', brand text not null default '', model text not null default '', colorway text not null default '',
 story text not null default '', evidence jsonb not null default '[]'::jsonb check(jsonb_typeof(evidence)='array'),
 status text not null default 'submitted' check(status in ('submitted','community_review','needs_more_evidence','likely_authentic','inconclusive','suspected_counterfeit','confirmed_authentic','confirmed_counterfeit','closed')),
 final_basis text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.authenticity_check_reviews(
 id uuid primary key default gen_random_uuid(), check_id uuid not null references public.authenticity_checks(id) on delete cascade,
 reviewer_m_uid uuid not null references public.m_people(id) on delete cascade,
 verdict text not null check(verdict in ('authentic','likely_authentic','inconclusive','suspected_counterfeit','counterfeit')),
 reasoning text not null check(char_length(reasoning) between 10 and 3000),
 evidence jsonb not null default '[]'::jsonb check(jsonb_typeof(evidence)='array'),
 created_at timestamptz not null default now(), unique(check_id,reviewer_m_uid));
alter table public.network_organizations enable row level security;
alter table public.network_organization_members enable row level security;
alter table public.authenticity_checks enable row level security;
alter table public.authenticity_check_reviews enable row level security;
revoke all on public.network_organizations,public.network_organization_members,public.authenticity_checks,public.authenticity_check_reviews from public,anon,authenticated;
grant all on public.network_organizations,public.network_organization_members,public.authenticity_checks,public.authenticity_check_reviews to service_role;
grant select on public.network_organizations to anon,authenticated;
grant select on public.network_organization_members to authenticated;
grant select,insert on public.authenticity_checks to authenticated;
grant select,insert,update on public.authenticity_check_reviews to authenticated;
create policy "public reads organizations" on public.network_organizations for select to anon,authenticated using(true);
create policy "members read organization membership" on public.network_organization_members for select to authenticated using(m_uid=(select public.current_m_uid()) or (select public.eu_is_admin()) or exists(select 1 from public.network_organization_members mine where mine.organization_id=network_organization_members.organization_id and mine.m_uid=(select public.current_m_uid()) and mine.state='joined'));
create policy "members read authenticity checks" on public.authenticity_checks for select to authenticated using((select auth.uid())=submitted_by or (select public.eu_is_admin()) or exists(select 1 from public.network_organization_members m where m.organization_id=authenticity_checks.organization_id and m.m_uid=(select public.current_m_uid()) and m.state='joined'));
create policy "members submit own authenticity checks" on public.authenticity_checks for insert to authenticated with check((select auth.uid())=submitted_by and submitted_by_m_uid=(select public.current_m_uid()));
create policy "members read authenticity reviews" on public.authenticity_check_reviews for select to authenticated using((select public.eu_is_admin()) or reviewer_m_uid=(select public.current_m_uid()) or exists(select 1 from public.authenticity_checks c where c.id=authenticity_check_reviews.check_id and c.submitted_by=(select auth.uid())));
create policy "organization checkers add reviews" on public.authenticity_check_reviews for insert to authenticated with check(reviewer_m_uid=(select public.current_m_uid()) and exists(select 1 from public.authenticity_checks c join public.network_organization_members m on m.organization_id=c.organization_id where c.id=authenticity_check_reviews.check_id and m.m_uid=(select public.current_m_uid()) and m.state='joined' and m.role in ('checker','manager','admin','owner')));
create policy "reviewers update own reviews" on public.authenticity_check_reviews for update to authenticated using(reviewer_m_uid=(select public.current_m_uid())) with check(reviewer_m_uid=(select public.current_m_uid()));
with org as (
 insert into public.network_organizations(slug,name,organization_type,description,verification_state)
 values('authenticity-network','Authenticity Network','community','A community for evidence-based legit checks, counterfeit education, and authentic buying.','verified')
 on conflict (lower(slug)) do update set description=excluded.description,updated_at=now() returning id),
oid as (select id from org union all select id from public.network_organizations where lower(slug)='authenticity-network' limit 1),
grp as (
 insert into public.network_groups(slug,name,purpose,visibility,organization_id,group_type)
 select 'heat-chart-authenticity','The Heat Chart · Authenticity','Get a legit check, contribute evidence, and help the community make better authenticity calls.','open',id,'service' from oid
 on conflict (lower(slug)) do update set organization_id=excluded.organization_id,group_type=excluded.group_type,purpose=excluded.purpose returning id,organization_id),
gid as (select id,organization_id from grp union all select g.id,g.organization_id from public.network_groups g where lower(g.slug)='heat-chart-authenticity' limit 1)
insert into public.action_campaigns(id,slug,status,program,title,kicker,headline,body,money_enabled,organization_id,group_id,sort)
select 'be-authentic','be-authentic','live','authenticity-network','Be Authentic','THE HEAT CHART','Know what you wear. Help somebody else know too.','Submit your own pair for a community legit check, or contribute evidence to another check. The item is the subject of the review—not the person wearing it.',false,organization_id,id,30 from gid
on conflict(id) do update set organization_id=excluded.organization_id,group_id=excluded.group_id,title=excluded.title,kicker=excluded.kicker,headline=excluded.headline,body=excluded.body,status='live',updated_at=now();
insert into public.action_missions(campaign_id,title,description,domain,difficulty,base_points,proof_required,verification_mode,skills,status)
select 'be-authentic',v.title,v.description,'community',v.difficulty,v.points,true,v.mode,v.skills,'open' from (values
('Get my kicks legit checked','Submit clear evidence of a pair you own or are considering buying. Community reviewers examine the item and explain the basis for their call.',1::smallint,75,'peer',array['authentication','consumer-literacy']::text[]),
('Help legit check a pair','Review a submitted pair and contribute specific, evidence-based observations. No harassment and no claims about the person wearing the item.',2::smallint,100,'review',array['authentication','research']::text[]),
('Document a suspicious listing','Capture a public commercial listing and document the product evidence that makes it worth reviewing. Do not target private individuals.',2::smallint,100,'review',array['authentication','research','consumer-literacy']::text[]))
as v(title,description,difficulty,points,mode,skills)
where not exists(select 1 from public.action_missions m where m.campaign_id='be-authentic' and m.title=v.title);