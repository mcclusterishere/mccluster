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


-- Mission review is one transaction: lock assignment/proof, decide, and award once.
create or replace function public.review_action_proof(
 p_proof_id uuid,
 p_decision text,
 p_review_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_proof public.action_proofs%rowtype;
 v_assignment public.action_mission_assignments%rowtype;
 v_mission public.action_missions%rowtype;
 v_reviewer uuid;
 v_points integer;
 v_skill text;
 v_awarded boolean := false;
begin
 if (select auth.uid()) is null or not (select public.eu_is_admin()) then
   raise exception 'not authorized';
 end if;
 if p_decision not in ('verified','rejected') then
   raise exception 'decision must be verified or rejected';
 end if;

 select * into v_proof from public.action_proofs where id=p_proof_id for update;
 if not found then raise exception 'proof not found'; end if;
 select * into v_assignment from public.action_mission_assignments where id=v_proof.assignment_id for update;
 select * into v_mission from public.action_missions where id=v_assignment.mission_id;
 v_reviewer := public.current_m_uid();

 if v_proof.status <> 'pending' then
   return jsonb_build_object('proof_id',v_proof.id,'status',v_proof.status,'assignment_id',v_assignment.id,'idempotent',true);
 end if;

 update public.action_proofs
 set status=p_decision, reviewer_uid=v_reviewer, review_note=nullif(trim(p_review_note),''),
     reviewed_at=now()
 where id=v_proof.id;

 if p_decision='rejected' then
   update public.action_mission_assignments set status='rejected' where id=v_assignment.id;
   return jsonb_build_object('proof_id',v_proof.id,'status','rejected','assignment_id',v_assignment.id,'awarded',false);
 end if;

 if v_assignment.m_uid is null then raise exception 'assignment has no Action identity'; end if;
 v_points := round(v_mission.base_points * case v_mission.difficulty when 1 then 1.0 when 2 then 1.15 when 3 then 1.35 when 4 then 1.6 else 2.0 end);

 insert into public.action_points_ledger(m_uid,assignment_id,kind,points,reason,factors)
 values(v_assignment.m_uid,v_assignment.id,'mission',v_points,'Verified mission: '||v_mission.title,
   jsonb_build_object('base_points',v_mission.base_points,'difficulty',v_mission.difficulty,'proof_confidence',1.0))
 on conflict (assignment_id,kind) where assignment_id is not null and kind='mission' do nothing;
 get diagnostics v_awarded = row_count;

 if v_awarded then
   foreach v_skill in array v_mission.skills loop
     insert into public.action_skill_progress(m_uid,skill,xp,verified_actions,updated_at)
     values(v_assignment.m_uid,v_skill,v_points,1,now())
     on conflict(m_uid,skill) do update
       set xp=public.action_skill_progress.xp+excluded.xp,
           verified_actions=public.action_skill_progress.verified_actions+1,
           updated_at=now();
   end loop;
 end if;

 update public.action_mission_assignments
 set status='verified', verified_at=coalesce(verified_at,now())
 where id=v_assignment.id;

 return jsonb_build_object('proof_id',v_proof.id,'status','verified','assignment_id',v_assignment.id,'points',v_points,'awarded',v_awarded);
end;
$$;
revoke all on function public.review_action_proof(uuid,text,text) from public, anon;
grant execute on function public.review_action_proof(uuid,text,text) to authenticated;
