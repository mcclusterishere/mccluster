-- Action Network gamification v1: reward verified useful action, never ideology or attention.
create table public.action_missions (
 id uuid primary key default gen_random_uuid(), campaign_id text references public.action_campaigns(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 160), description text not null default '',
 domain text not null default 'community' check(domain in ('music','advocacy','community','business','research','education','mutual_aid','creative','other')),
 difficulty smallint not null default 1 check(difficulty between 1 and 5), base_points integer not null default 100 check(base_points between 10 and 1000),
 proof_required boolean not null default true, verification_mode text not null default 'review' check(verification_mode in ('review','peer','automatic','none')),
 skills text[] not null default '{}', capacity integer check(capacity is null or capacity>0), status text not null default 'draft' check(status in ('draft','open','paused','closed')),
 starts_at timestamptz, ends_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.action_mission_assignments (
 id uuid primary key default gen_random_uuid(), mission_id uuid not null references public.action_missions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, m_uid uuid, status text not null default 'joined' check(status in ('joined','in_progress','submitted','verified','rejected','withdrawn')),
 joined_at timestamptz not null default now(), submitted_at timestamptz, verified_at timestamptz, unique(mission_id,user_id)
);
create table public.action_proofs (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.action_mission_assignments(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, proof_type text not null check(proof_type in ('video','photo','link','text','artifact')),
 proof_url text, statement text not null default '', metadata jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in ('pending','verified','rejected')), reviewer_uid uuid, review_note text, created_at timestamptz not null default now(), reviewed_at timestamptz,
 unique(assignment_id)
);
create table public.action_points_ledger (
 id uuid primary key default gen_random_uuid(), m_uid uuid not null references public.m_people(id) on delete cascade,
 assignment_id uuid references public.action_mission_assignments(id) on delete set null, kind text not null check(kind in ('mission','consistency','collaboration','impact','adjustment')),
 points integer not null check(points between -5000 and 5000), reason text not null, factors jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create unique index action_points_one_mission_award on public.action_points_ledger(assignment_id,kind) where assignment_id is not null and kind='mission';
create table public.action_skill_progress (
 m_uid uuid not null references public.m_people(id) on delete cascade, skill text not null, xp integer not null default 0 check(xp>=0), verified_actions integer not null default 0 check(verified_actions>=0), updated_at timestamptz not null default now(), primary key(m_uid,skill)
);
create table public.action_cohorts (
 id uuid primary key default gen_random_uuid(), campaign_id text references public.action_campaigns(id) on delete cascade, name text not null, description text not null default '', goal_points integer, status text not null default 'active' check(status in ('active','complete','archived')), created_at timestamptz not null default now()
);
create table public.action_cohort_members (
 cohort_id uuid not null references public.action_cohorts(id) on delete cascade, m_uid uuid not null references public.m_people(id) on delete cascade, joined_at timestamptz not null default now(), primary key(cohort_id,m_uid)
);
alter table public.action_missions enable row level security; alter table public.action_mission_assignments enable row level security; alter table public.action_proofs enable row level security; alter table public.action_points_ledger enable row level security; alter table public.action_skill_progress enable row level security; alter table public.action_cohorts enable row level security; alter table public.action_cohort_members enable row level security;
create policy "public reads open missions" on public.action_missions for select to anon,authenticated using(status in ('open','paused','closed') or (select public.eu_is_admin()));
create policy "admins manage missions" on public.action_missions for all to authenticated using((select public.eu_is_admin())) with check((select public.eu_is_admin()));
create policy "members read own assignments" on public.action_mission_assignments for select to authenticated using(user_id=(select auth.uid()) or (select public.eu_is_admin()));
create policy "members join own open missions" on public.action_mission_assignments for insert to authenticated
 with check(user_id=(select auth.uid()) and m_uid=public.current_m_uid() and exists(select 1 from public.action_missions m where m.id=mission_id and m.status='open' and (m.starts_at is null or m.starts_at<=now()) and (m.ends_at is null or m.ends_at>now())));
create policy "members update own active assignments" on public.action_mission_assignments for update to authenticated
 using(user_id=(select auth.uid()) and status in ('joined','in_progress'))
 with check(user_id=(select auth.uid()) and m_uid=public.current_m_uid() and status in ('joined','in_progress','submitted','withdrawn'));
create policy "members read own proofs" on public.action_proofs for select to authenticated using(user_id=(select auth.uid()) or (select public.eu_is_admin()));
create policy "members submit own proof" on public.action_proofs for insert to authenticated
 with check(user_id=(select auth.uid()) and exists(select 1 from public.action_mission_assignments a where a.id=assignment_id and a.user_id=(select auth.uid()) and a.status in ('joined','in_progress','submitted')));
create policy "members read own points" on public.action_points_ledger for select to authenticated using(m_uid=public.current_m_uid() or (select public.eu_is_admin()));
create policy "members read own skills" on public.action_skill_progress for select to authenticated using(m_uid=public.current_m_uid() or (select public.eu_is_admin()));
create policy "public reads active cohorts" on public.action_cohorts for select to anon,authenticated using(status in ('active','complete') or (select public.eu_is_admin()));
create policy "members read cohort roster" on public.action_cohort_members for select to authenticated using(true);
create policy "admins manage cohorts" on public.action_cohorts for all to authenticated using((select public.eu_is_admin())) with check((select public.eu_is_admin()));
grant select on public.action_missions,public.action_cohorts to anon,authenticated;
grant select,insert,update on public.action_mission_assignments to authenticated;
grant select,insert on public.action_proofs to authenticated;
grant select on public.action_points_ledger,public.action_skill_progress,public.action_cohort_members to authenticated;
