-- Preserve canonical join semantics; enforce regional consent at entry.
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

 if exists (select 1 from public.action_globe_mission_regions where mission_id = p_mission_id)
    and not public.action_globe_can_join_mission(v_m_uid, p_mission_id) then
   raise exception 'regional mission not eligible for this member';
 end if;

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
     -- A withdrawn assignment does not occupy a slot; enforce capacity on rejoin.
     if v_mission.capacity is not null then
       select count(*) into v_taken from public.action_mission_assignments
        where mission_id = p_mission_id and status <> 'withdrawn';
       if v_taken >= v_mission.capacity then raise exception 'this mission is full'; end if;
     end if;
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
