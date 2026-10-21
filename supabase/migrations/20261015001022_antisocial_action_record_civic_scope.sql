-- Preserve the civic/paid-work boundary while retaining Anti-Social level progress.
create or replace function public.action_record()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid, public.current_m_uid() as m_uid)
  select case when (select uid from me) is null then null else jsonb_build_object(
    'verified_actions', (select count(*) from public.action_mission_assignments a join public.action_missions m on m.id = a.mission_id, me where a.user_id = me.uid and a.status = 'verified' and m.kind = 'civic'),
    'points', (select coalesce(sum(l.points), 0) from public.action_points_ledger l, me where l.m_uid = me.m_uid),
    'in_progress', (select count(*) from public.action_mission_assignments a join public.action_missions m on m.id = a.mission_id, me where a.user_id = me.uid and a.status in ('joined','in_progress','submitted') and m.kind = 'civic'),
    'missions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignment_id', a.id, 'mission_id', m.id, 'title', m.title, 'domain', m.domain,
        'skills', m.skills, 'status', a.status, 'joined_at', a.joined_at, 'submitted_at', a.submitted_at,
        'verified_at', a.verified_at, 'points', (select l.points from public.action_points_ledger l where l.assignment_id = a.id and l.kind = 'mission'),
        'review_note', case when a.status in ('verified','rejected') then (select p.review_note from public.action_proofs p where p.assignment_id = a.id) end,
        'levels', coalesce((select jsonb_agg(jsonb_build_object('level', lv.level, 'status', lv.status, 'review_note', lv.review_note) order by lv.level)
                            from public.action_antisocial_levels lv where lv.assignment_id = a.id), '[]'::jsonb),
        'level_count', case when m.id = 'a17050c1-a551-4c5c-80c1-5a1750c1a001'::uuid then 3 end
      ) order by coalesce(a.verified_at, a.submitted_at, a.joined_at) desc)
      from public.action_mission_assignments a join public.action_missions m on m.id = a.mission_id, me
      where a.user_id = me.uid and a.status <> 'withdrawn' and m.kind = 'civic'), '[]'::jsonb),
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
