-- Action Network gamification v1: reward verified useful action, never ideology or attention.
--
-- Points are feedback. Access is the reward. A mission is joined, proved and
-- reviewed only through the server functions below; members hold no insert
-- or update right on assignments, proofs, points or skills, so nobody can
-- write themselves a verified mission, a verified proof or an award.
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
create index action_mission_assignments_user_idx on public.action_mission_assignments(user_id, joined_at desc);
create index action_mission_assignments_m_uid_idx on public.action_mission_assignments(m_uid) where m_uid is not null;
create table public.action_proofs (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.action_mission_assignments(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, proof_type text not null check(proof_type in ('video','photo','link','text','artifact')),
 proof_url text, statement text not null default '', metadata jsonb not null default '{}'::jsonb,
 status text not null default 'pending' check(status in ('pending','verified','rejected')), reviewer_uid uuid, review_note text, created_at timestamptz not null default now(), reviewed_at timestamptz,
 unique(assignment_id)
);
-- one piece of evidence proves one mission: the same link cannot be reused
create unique index action_proofs_one_use_per_url on public.action_proofs(lower(proof_url)) where proof_url is not null and status <> 'rejected';
create unique index action_proofs_one_use_per_upload on public.action_proofs((metadata->>'asset_id')) where metadata ? 'asset_id' and status <> 'rejected';
create table public.action_points_ledger (
 id uuid primary key default gen_random_uuid(), m_uid uuid not null references public.m_people(id) on delete cascade,
 assignment_id uuid references public.action_mission_assignments(id) on delete set null, kind text not null check(kind in ('mission','consistency','collaboration','impact','adjustment')),
 points integer not null check(points between -5000 and 5000), reason text not null, factors jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create unique index action_points_one_mission_award on public.action_points_ledger(assignment_id,kind) where assignment_id is not null and kind='mission';
create index action_points_ledger_m_uid_idx on public.action_points_ledger(m_uid, created_at desc);
create table public.action_skill_progress (
 m_uid uuid not null references public.m_people(id) on delete cascade, skill text not null, xp integer not null default 0 check(xp>=0), verified_actions integer not null default 0 check(verified_actions>=0), updated_at timestamptz not null default now(), primary key(m_uid,skill)
);
create table public.action_cohorts (
 id uuid primary key default gen_random_uuid(), campaign_id text references public.action_campaigns(id) on delete cascade, name text not null, description text not null default '', goal_points integer, status text not null default 'active' check(status in ('active','complete','archived')), created_at timestamptz not null default now()
);
create table public.action_cohort_members (
 cohort_id uuid not null references public.action_cohorts(id) on delete cascade, m_uid uuid not null references public.m_people(id) on delete cascade, joined_at timestamptz not null default now(), primary key(cohort_id,m_uid)
);
create index action_cohort_members_m_uid_idx on public.action_cohort_members(m_uid);

alter table public.action_missions enable row level security; alter table public.action_mission_assignments enable row level security; alter table public.action_proofs enable row level security; alter table public.action_points_ledger enable row level security; alter table public.action_skill_progress enable row level security; alter table public.action_cohorts enable row level security; alter table public.action_cohort_members enable row level security;

-- Supabase grants every new public table to anon and authenticated by
-- default. Start from nothing and grant back only what each role reads.
revoke all on public.action_missions, public.action_mission_assignments, public.action_proofs, public.action_points_ledger, public.action_skill_progress, public.action_cohorts, public.action_cohort_members from public, anon, authenticated;
grant all on public.action_missions, public.action_mission_assignments, public.action_proofs, public.action_points_ledger, public.action_skill_progress, public.action_cohorts, public.action_cohort_members to service_role;
grant select on public.action_missions, public.action_cohorts to anon, authenticated;
grant insert, update, delete on public.action_missions, public.action_cohorts to authenticated;  -- admin-only by policy
grant select on public.action_mission_assignments, public.action_proofs, public.action_points_ledger, public.action_skill_progress, public.action_cohort_members to authenticated;

create policy "public reads open missions" on public.action_missions for select to anon,authenticated using(status in ('open','paused','closed') or (select public.eu_is_admin()));
create policy "admins manage missions" on public.action_missions for all to authenticated using((select public.eu_is_admin())) with check((select public.eu_is_admin()));
create policy "members read own assignments" on public.action_mission_assignments for select to authenticated using(user_id=(select auth.uid()) or (select public.eu_is_admin()));
create policy "members read own proofs" on public.action_proofs for select to authenticated using(user_id=(select auth.uid()) or (select public.eu_is_admin()));
create policy "members read own points" on public.action_points_ledger for select to authenticated using(m_uid=(select public.current_m_uid()) or (select public.eu_is_admin()));
create policy "members read own skills" on public.action_skill_progress for select to authenticated using(m_uid=(select public.current_m_uid()) or (select public.eu_is_admin()));
create policy "public reads active cohorts" on public.action_cohorts for select to anon,authenticated using(status in ('active','complete') or (select public.eu_is_admin()));
create policy "admins manage cohorts" on public.action_cohorts for all to authenticated using((select public.eu_is_admin())) with check((select public.eu_is_admin()));
-- a roster is private: you see your own memberships, the desk sees all
create policy "members read own cohort membership" on public.action_cohort_members for select to authenticated using(m_uid=(select public.current_m_uid()) or (select public.eu_is_admin()));


-- ---------------------------------------------------------------------------
-- JOIN. The server decides who you are, whether the mission is open, and
-- whether there is room. Joining twice returns the same assignment; joining
-- again after withdrawing reopens it.
-- ---------------------------------------------------------------------------
create or replace function public.join_action_mission(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_m_uid uuid := public.current_m_uid();
 v_mission public.action_missions%rowtype;
 v_assignment public.action_mission_assignments%rowtype;
 v_taken integer;
begin
 if v_user is null then raise exception 'sign in to take a mission'; end if;
 if v_m_uid is null then raise exception 'your Action identity is not ready yet'; end if;

 select * into v_mission from public.action_missions where id = p_mission_id for update;
 if not found or v_mission.status <> 'open'
    or (v_mission.starts_at is not null and v_mission.starts_at > now())
    or (v_mission.ends_at is not null and v_mission.ends_at <= now()) then
   raise exception 'this mission is not open';
 end if;

 select * into v_assignment from public.action_mission_assignments
  where mission_id = p_mission_id and user_id = v_user for update;
 if found then
   if v_assignment.status = 'withdrawn' then
     update public.action_mission_assignments set status = 'in_progress', joined_at = now()
      where id = v_assignment.id returning * into v_assignment;
   end if;
   return jsonb_build_object('assignment_id', v_assignment.id, 'status', v_assignment.status, 'mission_id', p_mission_id);
 end if;

 if v_mission.capacity is not null then
   select count(*) into v_taken from public.action_mission_assignments
    where mission_id = p_mission_id and status <> 'withdrawn';
   if v_taken >= v_mission.capacity then raise exception 'this mission is full'; end if;
 end if;

 insert into public.action_mission_assignments(mission_id, user_id, m_uid, status)
 values (p_mission_id, v_user, v_m_uid, 'in_progress')
 returning * into v_assignment;
 return jsonb_build_object('assignment_id', v_assignment.id, 'status', v_assignment.status, 'mission_id', p_mission_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- PROVE. Only your own active assignment, only pending, never verified by
-- you. A pending proof can be replaced until it is reviewed.
-- ---------------------------------------------------------------------------
create or replace function public.submit_action_proof(
 p_assignment_id uuid,
 p_proof_type text,
 p_proof_url text default null,
 p_statement text default '',
 p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_assignment public.action_mission_assignments%rowtype;
 v_mission public.action_missions%rowtype;
 v_existing public.action_proofs%rowtype;
 v_url text := nullif(btrim(coalesce(p_proof_url, '')), '');
 v_statement text := btrim(coalesce(p_statement, ''));
 v_meta jsonb := '{}'::jsonb;
 v_media_type text;
 v_proof_id uuid;
begin
 if v_user is null then raise exception 'sign in to submit proof'; end if;
 if p_proof_type not in ('video','photo','link','text','artifact') then raise exception 'unknown proof type'; end if;
 if v_url is not null and (v_url !~* '^https://' or char_length(v_url) > 2000) then raise exception 'proof links must be https'; end if;
 if char_length(v_statement) > 4000 then raise exception 'keep the statement under 4,000 characters'; end if;
 if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or pg_column_size(p_metadata) > 4096 then raise exception 'invalid proof details'; end if;
 -- an upload is evidence only if it is the member's own file from the
 -- Create/media pipeline; the server records its type, not the client
 if p_metadata ? 'asset_id' then
   if (p_metadata->>'asset_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'invalid upload'; end if;
   select a.media_type into v_media_type from public.network_media_assets a
    where a.id = (p_metadata->>'asset_id')::uuid and a.owner_m_uid = public.current_m_uid() and a.status in ('ready','staged');
   if v_media_type is null then raise exception 'that upload is not yours or is not ready'; end if;
   v_meta := jsonb_build_object('asset_id', p_metadata->>'asset_id', 'media_type', v_media_type);
 end if;
 if v_url is null and v_meta = '{}'::jsonb and char_length(v_statement) < 20 then raise exception 'add an upload or a link, or describe what you did in at least 20 characters'; end if;

 select * into v_assignment from public.action_mission_assignments where id = p_assignment_id for update;
 if not found or v_assignment.user_id <> v_user then raise exception 'assignment not found'; end if;
 if v_assignment.status not in ('joined','in_progress','submitted') then raise exception 'this mission is not taking proof'; end if;
 select * into v_mission from public.action_missions where id = v_assignment.mission_id;
 if v_mission.status not in ('open','paused') then raise exception 'this mission is closed'; end if;

 if v_url is not null and exists (
   select 1 from public.action_proofs p
    where lower(p.proof_url) = lower(v_url) and p.status <> 'rejected' and p.assignment_id <> v_assignment.id
 ) then
   raise exception 'that proof has already been used for another mission';
 end if;
 if v_meta ? 'asset_id' and exists (
   select 1 from public.action_proofs p
    where p.metadata->>'asset_id' = v_meta->>'asset_id' and p.status <> 'rejected' and p.assignment_id <> v_assignment.id
 ) then
   raise exception 'that upload has already been used for another mission';
 end if;

 select * into v_existing from public.action_proofs where assignment_id = v_assignment.id for update;
 if found then
   if v_existing.status <> 'pending' then raise exception 'this proof has already been reviewed'; end if;
   update public.action_proofs
      set proof_type = p_proof_type, proof_url = v_url, statement = v_statement, metadata = v_meta, created_at = now()
    where id = v_existing.id;
   v_proof_id := v_existing.id;
 else
   insert into public.action_proofs(assignment_id, user_id, proof_type, proof_url, statement, metadata, status)
   values (v_assignment.id, v_user, p_proof_type, v_url, v_statement, v_meta, 'pending')
   returning id into v_proof_id;
 end if;

 update public.action_mission_assignments set status = 'submitted', submitted_at = now() where id = v_assignment.id;
 return jsonb_build_object('proof_id', v_proof_id, 'assignment_id', v_assignment.id, 'status', 'submitted');
end;
$$;

create or replace function public.withdraw_action_mission(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_assignment public.action_mission_assignments%rowtype;
begin
 if v_user is null then raise exception 'sign in first'; end if;
 select * into v_assignment from public.action_mission_assignments where id = p_assignment_id for update;
 if not found or v_assignment.user_id <> v_user then raise exception 'assignment not found'; end if;
 if v_assignment.status not in ('joined','in_progress','submitted') then raise exception 'this mission can no longer be withdrawn'; end if;
 delete from public.action_proofs where assignment_id = v_assignment.id and status = 'pending';
 update public.action_mission_assignments set status = 'withdrawn' where id = v_assignment.id;
 return jsonb_build_object('assignment_id', v_assignment.id, 'status', 'withdrawn');
end;
$$;

-- ---------------------------------------------------------------------------
-- REVIEW. One transaction: lock assignment and proof, decide, award once.
-- ---------------------------------------------------------------------------
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
 v_rows integer := 0;
 v_share integer := 0;
 v_awarded boolean := false;
begin
 if (select auth.uid()) is null or not (select public.eu_is_admin()) then
   raise exception 'not authorized';
 end if;
 if p_decision not in ('verified','rejected') then
   raise exception 'decision must be verified or rejected';
 end if;

 -- lock order matches submit_action_proof: assignment, then proof
 select a.* into v_assignment from public.action_mission_assignments a
  join public.action_proofs p on p.assignment_id = a.id
  where p.id = p_proof_id for update of a;
 if not found then raise exception 'proof not found'; end if;
 select * into v_proof from public.action_proofs where id = p_proof_id for update;
 select * into v_mission from public.action_missions where id = v_assignment.mission_id;
 v_reviewer := public.current_m_uid();

 if v_proof.status <> 'pending' then
   return jsonb_build_object('proof_id',v_proof.id,'status',v_proof.status,'assignment_id',v_assignment.id,'idempotent',true,'awarded',false);
 end if;
 if v_proof.user_id = (select auth.uid()) then raise exception 'you cannot review your own proof'; end if;
 if v_assignment.status <> 'submitted' then raise exception 'this assignment is not waiting for review'; end if;

 update public.action_proofs
 set status=p_decision, reviewer_uid=v_reviewer, review_note=nullif(btrim(coalesce(p_review_note,'')),''),
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
 get diagnostics v_rows = row_count;
 v_awarded := v_rows > 0;

 if v_awarded then
   -- skill XP is the award shared across the mission's skills (reward doc: Skills)
   v_share := round(v_points::numeric / greatest(coalesce(array_length(v_mission.skills, 1), 1), 1));
   foreach v_skill in array v_mission.skills loop
     insert into public.action_skill_progress(m_uid,skill,xp,verified_actions,updated_at)
     values(v_assignment.m_uid,v_skill,v_share,1,now())
     on conflict(m_uid,skill) do update
       set xp=public.action_skill_progress.xp+excluded.xp,
           verified_actions=public.action_skill_progress.verified_actions+1,
           updated_at=now();
   end loop;
 end if;

 update public.action_mission_assignments
 set status='verified', verified_at=coalesce(verified_at,now())
 where id=v_assignment.id;

 return jsonb_build_object('proof_id',v_proof.id,'status','verified','assignment_id',v_assignment.id,'points',case when v_awarded then v_points else 0 end,'awarded',v_awarded);
end;
$$;

-- ---------------------------------------------------------------------------
-- THE ACTION RECORD. Your own verified work, read in one call.
-- ---------------------------------------------------------------------------
create or replace function public.action_record()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid, public.current_m_uid() as m_uid)
  select case when (select uid from me) is null then null else jsonb_build_object(
    'verified_actions', (select count(*) from public.action_mission_assignments a, me where a.user_id = me.uid and a.status = 'verified'),
    'points', (select coalesce(sum(l.points), 0) from public.action_points_ledger l, me where l.m_uid = me.m_uid),
    'in_progress', (select count(*) from public.action_mission_assignments a, me where a.user_id = me.uid and a.status in ('joined','in_progress','submitted')),
    'missions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', a.id, 'mission_id', m.id, 'title', m.title, 'domain', m.domain,
        'skills', m.skills, 'status', a.status, 'joined_at', a.joined_at, 'submitted_at', a.submitted_at,
        'verified_at', a.verified_at, 'points', (select l.points from public.action_points_ledger l where l.assignment_id = a.id and l.kind = 'mission'),
        'review_note', case when a.status in ('verified','rejected') then (select p.review_note from public.action_proofs p where p.assignment_id = a.id) end
      ) order by coalesce(a.verified_at, a.submitted_at, a.joined_at) desc)
      from public.action_mission_assignments a join public.action_missions m on m.id = a.mission_id, me
      where a.user_id = me.uid and a.status <> 'withdrawn'), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object('skill', s.skill, 'xp', s.xp, 'verified_actions', s.verified_actions) order by s.xp desc)
      from public.action_skill_progress s, me where s.m_uid = me.m_uid), '[]'::jsonb),
    'cohorts', coalesce((
      select jsonb_agg(jsonb_build_object('cohort_id', c.id, 'name', c.name, 'status', c.status, 'goal_points', c.goal_points,
        'points', (select coalesce(sum(l.points), 0) from public.action_points_ledger l join public.action_cohort_members cm2 on cm2.m_uid = l.m_uid where cm2.cohort_id = c.id),
        'members', (select count(*) from public.action_cohort_members cm3 where cm3.cohort_id = c.id)))
      from public.action_cohort_members cm join public.action_cohorts c on c.id = cm.cohort_id, me
      where cm.m_uid = me.m_uid), '[]'::jsonb)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- THE RECEIPT. A verified action, safe to share: the mission and the date,
-- never the person, the proof or the review. Anything not verified reads as
-- nothing at all.
-- ---------------------------------------------------------------------------
create or replace function public.action_receipt(p_assignment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'assignment_id', a.id, 'mission_id', m.id, 'title', m.title, 'domain', m.domain,
    'skills', m.skills, 'campaign_id', m.campaign_id, 'verified_at', a.verified_at,
    'mission_open', m.status = 'open')
  from public.action_mission_assignments a
  join public.action_missions m on m.id = a.mission_id
  where a.id = p_assignment_id and a.status = 'verified';
$$;

revoke all on function public.join_action_mission(uuid) from public, anon;
revoke all on function public.submit_action_proof(uuid,text,text,text,jsonb) from public, anon;
revoke all on function public.withdraw_action_mission(uuid) from public, anon;
revoke all on function public.review_action_proof(uuid,text,text) from public, anon;
revoke all on function public.action_record() from public, anon;
revoke all on function public.action_receipt(uuid) from public;
grant execute on function public.join_action_mission(uuid) to authenticated, service_role;
grant execute on function public.submit_action_proof(uuid,text,text,text,jsonb) to authenticated, service_role;
grant execute on function public.withdraw_action_mission(uuid) to authenticated, service_role;
grant execute on function public.review_action_proof(uuid,text,text) to authenticated, service_role;
grant execute on function public.action_record() to authenticated, service_role;
grant execute on function public.action_receipt(uuid) to anon, authenticated, service_role;
