-- MNET ACTION NETWORK v2 — organizing primitives on the canonical McCluster Network.
-- PENDING: apply to production only after review/test. Mnet IS the Action Network.
-- No duplicate identity, social graph, group, feed, or messaging system is introduced.

alter table public.action_campaigns
  add column if not exists mission_intro text;

-- First funding-readiness milestone. Public fundraising remains OFF.
update public.action_campaigns
   set money_goal_cents = 5000000,
       money_enabled = false
 where id = 'critical-minerals-drc-001';

-- Campaigns organize through existing Mnet rooms.
create table if not exists public.action_campaign_groups (
  campaign_id text not null references public.action_campaigns(id) on delete cascade,
  group_id uuid not null references public.network_groups(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (campaign_id, group_id)
);
create unique index if not exists action_campaign_groups_one_primary_idx
  on public.action_campaign_groups(campaign_id) where is_primary;

comment on table public.action_campaign_groups is
  'Campaign-to-Mnet-room links. Mnet is the Action Network; this table never creates a second community graph.';

create table if not exists public.action_missions (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references public.action_campaigns(id) on delete cascade,
  group_id uuid references public.network_groups(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  summary text not null default '',
  instructions text not null default '',
  mission_type text not null default 'volunteer'
    check (mission_type in ('research','organize','volunteer','resources','education','media','field','technical','other')),
  required_skills text[] not null default '{}',
  useful_resources text[] not null default '{}',
  geography text,
  participation_mode text not null default 'remote'
    check (participation_mode in ('remote','in_person','hybrid')),
  capacity integer check (capacity is null or capacity > 0),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  difficulty text not null default 'standard' check (difficulty in ('starter','standard','advanced')),
  starts_at timestamptz,
  due_at timestamptz,
  status text not null default 'draft' check (status in ('draft','open','paused','closed','cancelled')),
  organizer_m_uid uuid references public.m_people(id) on delete set null,
  prerequisites text not null default '',
  verification_requirements text not null default '',
  evidence_requirements text not null default '',
  safety_notes text not null default '',
  completion_criteria text not null default '',
  impact_metric text,
  impact_target numeric check (impact_target is null or impact_target >= 0),
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_at is null or starts_at is null or due_at >= starts_at)
);
create index if not exists action_missions_campaign_idx
  on public.action_missions(campaign_id,status,sort,created_at);
create index if not exists action_missions_group_idx
  on public.action_missions(group_id,status) where group_id is not null;

create table if not exists public.action_mission_assignments (
  mission_id uuid not null references public.action_missions(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  state text not null default 'accepted'
    check (state in ('accepted','in_progress','submitted','verified','declined','cancelled','needs_revision')),
  assigned_by_m_uid uuid references public.m_people(id) on delete set null,
  accepted_at timestamptz not null default now(),
  started_at timestamptz,
  submitted_at timestamptz,
  verified_at timestamptz,
  verified_by_m_uid uuid references public.m_people(id) on delete set null,
  submission_note text,
  verifier_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (mission_id,m_uid)
);
create index if not exists action_mission_assignments_member_idx
  on public.action_mission_assignments(m_uid,state,updated_at desc);
create index if not exists action_mission_assignments_review_idx
  on public.action_mission_assignments(state,submitted_at)
  where state in ('submitted','needs_revision');

create table if not exists public.action_mission_evidence (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null,
  m_uid uuid not null,
  kind text not null default 'link'
    check (kind in ('link','text','file','photo','video','other')),
  url text check (url is null or url ~ '^https://'),
  note text,
  created_at timestamptz not null default now(),
  foreign key (mission_id,m_uid)
    references public.action_mission_assignments(mission_id,m_uid) on delete cascade,
  check (nullif(btrim(coalesce(note,'')),'') is not null or url is not null)
);
create index if not exists action_mission_evidence_assignment_idx
  on public.action_mission_evidence(mission_id,m_uid,created_at);

create table if not exists public.action_contributions (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references public.action_campaigns(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  mission_id uuid references public.action_missions(id) on delete set null,
  kind text not null
    check (kind in ('mission','research','organizing','recruiting','event','resource','field','other')),
  summary text not null,
  quantity numeric not null default 1 check (quantity >= 0),
  unit text not null default 'contribution',
  verified boolean not null default false,
  verified_by_m_uid uuid references public.m_people(id) on delete set null,
  verified_at timestamptz,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence)='array'),
  created_at timestamptz not null default now(),
  check ((not verified and verified_at is null) or (verified and verified_at is not null))
);
create index if not exists action_contributions_member_idx
  on public.action_contributions(m_uid,verified,created_at desc);
create index if not exists action_contributions_campaign_idx
  on public.action_contributions(campaign_id,verified,created_at desc);

alter table public.action_campaign_groups enable row level security;
alter table public.action_missions enable row level security;
alter table public.action_mission_assignments enable row level security;
alter table public.action_mission_evidence enable row level security;
alter table public.action_contributions enable row level security;

create policy "members read campaign rooms" on public.action_campaign_groups
  for select to authenticated using (
    public.eu_is_admin() or exists (
      select 1 from public.action_participants p
       where p.campaign_id=action_campaign_groups.campaign_id and p.user_id=auth.uid()
    )
  );
create policy "owner writes campaign rooms" on public.action_campaign_groups
  for all to authenticated using (public.eu_is_admin()) with check (public.eu_is_admin());

create policy "participants read available missions" on public.action_missions
  for select to authenticated using (
    public.eu_is_admin() or (
      status in ('open','paused','closed')
      and exists (
        select 1 from public.action_participants p
         where p.campaign_id=action_missions.campaign_id and p.user_id=auth.uid()
      )
      and (group_id is null or exists (
        select 1 from public.network_group_members gm
         where gm.group_id=action_missions.group_id
           and gm.m_uid=public.current_m_uid() and gm.state='joined'
      ))
    )
  );
create policy "owner writes missions" on public.action_missions
  for all to authenticated using (public.eu_is_admin()) with check (public.eu_is_admin());

create policy "members read own assignments" on public.action_mission_assignments
  for select to authenticated using (m_uid=public.current_m_uid() or public.eu_is_admin());
create policy "members accept open missions" on public.action_mission_assignments
  for insert to authenticated with check (
    m_uid=public.current_m_uid() and assigned_by_m_uid is null and state='accepted'
    and exists (
      select 1 from public.action_missions m
      join public.action_participants p on p.campaign_id=m.campaign_id and p.user_id=auth.uid()
       where m.id=action_mission_assignments.mission_id and m.status='open'
         and (m.capacity is null or (
           select count(*) from public.action_mission_assignments a
            where a.mission_id=m.id and a.state not in ('declined','cancelled')
         ) < m.capacity)
         and (m.group_id is null or exists (
           select 1 from public.network_group_members gm
            where gm.group_id=m.group_id and gm.m_uid=public.current_m_uid() and gm.state='joined'
         ))
    )
  );
create policy "owner manages assignments" on public.action_mission_assignments
  for all to authenticated using (public.eu_is_admin()) with check (public.eu_is_admin());

create policy "members read own evidence" on public.action_mission_evidence
  for select to authenticated using (m_uid=public.current_m_uid() or public.eu_is_admin());
create policy "members submit own evidence" on public.action_mission_evidence
  for insert to authenticated with check (
    m_uid=public.current_m_uid()
    and exists (
      select 1 from public.action_mission_assignments a
       where a.mission_id=action_mission_evidence.mission_id
         and a.m_uid=public.current_m_uid()
         and a.state in ('accepted','in_progress','needs_revision','submitted')
    )
  );
create policy "owner manages evidence" on public.action_mission_evidence
  for all to authenticated using (public.eu_is_admin()) with check (public.eu_is_admin());

create policy "members read own contributions" on public.action_contributions
  for select to authenticated using (m_uid=public.current_m_uid() or public.eu_is_admin());
create policy "owner writes contributions" on public.action_contributions
  for all to authenticated using (public.eu_is_admin()) with check (public.eu_is_admin());

grant select on public.action_campaign_groups, public.action_missions,
  public.action_mission_assignments, public.action_mission_evidence, public.action_contributions
  to authenticated;
grant insert on public.action_mission_assignments, public.action_mission_evidence to authenticated;
grant all on public.action_campaign_groups, public.action_missions,
  public.action_mission_assignments, public.action_mission_evidence, public.action_contributions
  to service_role;

-- Member-facing mission list. Uses the canonical m_uid.
create or replace function public.action_my_missions()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'campaign_id',m.campaign_id,'group_id',m.group_id,'title',m.title,
    'summary',m.summary,'instructions',m.instructions,'mission_type',m.mission_type,
    'required_skills',to_jsonb(m.required_skills),'geography',m.geography,
    'participation_mode',m.participation_mode,'priority',m.priority,'difficulty',m.difficulty,
    'starts_at',m.starts_at,'due_at',m.due_at,'status',m.status,
    'evidence_requirements',m.evidence_requirements,'safety_notes',m.safety_notes,
    'completion_criteria',m.completion_criteria,'impact_metric',m.impact_metric,
    'assignment_state',a.state,'submitted_at',a.submitted_at,'verified_at',a.verified_at
  ) order by m.sort,m.due_at nulls last,m.created_at), '[]'::jsonb)
  from public.action_missions m
  join public.action_participants p on p.campaign_id=m.campaign_id and p.user_id=auth.uid()
  left join public.action_mission_assignments a
    on a.mission_id=m.id and a.m_uid=public.current_m_uid()
  where m.status in ('open','paused','closed')
    and (m.group_id is null or exists (
      select 1 from public.network_group_members gm
       where gm.group_id=m.group_id and gm.m_uid=public.current_m_uid() and gm.state='joined'
    ));
$$;
revoke all on function public.action_my_missions() from public,anon;
grant execute on function public.action_my_missions() to authenticated,service_role;
