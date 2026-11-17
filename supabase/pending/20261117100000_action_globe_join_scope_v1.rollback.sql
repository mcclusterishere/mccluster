-- Recovery artifact for 20261117100000_action_globe_join_scope_v1.sql: never a forward migration.
-- Owner approval required, like the forward file. Run it as postgres, as the forward file was (the Supabase
-- MCP `apply_migration` runs as postgres); the service role cannot, since it owns neither the table nor the
-- functions (read 2026-11-17).
--
-- What it does, in one transaction:
--   1. Restores production's bodies of action_globe_can_join_mission() and join_action_mission(), read
--      (SELECT only) on 2026-11-17. They are copied byte for byte from the applied migrations
--      supabase/migrations/20261014014547_action_globe_region_activation.sql and
--      supabase/migrations/20261014184518_action_globe_join_authorization.sql, so afterwards
--      md5(prosrc) is a73db92bb2c4b4e6da84b1e311c82b84 for action_globe_can_join_mission and
--      e0684ebe350296c5e6c06de55624ed42 for join_action_mission, as in production before the forward file.
--      Both keep SECURITY DEFINER, search_path '' and production's grants.
--   2. Drops the join_scope check and the join_scope column of action_globe_mission_regions.
-- WARNING: with the old bodies back, ANY pin row again makes its mission unjoinable for every member until
-- that member has a consented, unlocked region there. If pins exist and their missions must stay joinable,
-- delete those pins first. The join_scope values are lost.
-- It REFUSES, changing nothing (55000), unless both functions are the forward file's or already production's,
-- by md5(prosrc). Anything else means another migration has replaced them since, such as the whole pins file
-- (20261015230000_action_mission_pins_arcs_black_business.sql): putting production's join back over it would
-- drop its arc check (a mission arc's next step waits for the step before it) and, with its origin and context
-- pins in place, make every pinned mission unjoinable again. Roll that file back first (the steps are in its
-- header; they restore production's two functions), then this one. The table lock comes first, so a migration
-- that alters the same table cannot slip in between the check and the change.
-- Safe to run twice, and harmless where the forward file never ran and nothing else replaced the functions.
begin;
set local lock_timeout = '5s';

lock table public.action_globe_mission_regions in access exclusive mode;
do $join_scope_rollback_guard$
declare
  v_join text := (select md5(p.prosrc) from pg_catalog.pg_proc p
                   where p.oid = to_regprocedure('public.join_action_mission(uuid)'));
  v_can text := (select md5(p.prosrc) from pg_catalog.pg_proc p
                  where p.oid = to_regprocedure('public.action_globe_can_join_mission(uuid,uuid)'));
begin
  -- the forward file's bodies and production's (2026-11-17), below
  if v_join is null or v_join not in ('f29d7657d536e60f1b7df33ee17bcde4', 'e0684ebe350296c5e6c06de55624ed42')
     or v_can is null or v_can not in ('70700a7b0f68a24a1664d38097685bf5', 'a73db92bb2c4b4e6da84b1e311c82b84') then
    raise exception 'join scope v1 rollback refused: join_action_mission (md5 %) or action_globe_can_join_mission (md5 %) is neither the forward file''s nor production''s',
      coalesce(v_join, 'absent'), coalesce(v_can, 'absent')
      using errcode = '55000',
            hint = 'Another migration has replaced them, such as 20261015230000_action_mission_pins_arcs_black_business.sql; roll it back first. Nothing was changed.';
  end if;
end
$join_scope_rollback_guard$;

create or replace function public.action_globe_can_join_mission(p_m_uid uuid,p_mission_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(
  select 1 from public.action_globe_mission_regions mr
  join public.action_missions mission on mission.id=mr.mission_id
  join public.action_globe_member_regions member on member.m_uid=p_m_uid
     and member.region_key=mr.region_key
  where mr.mission_id=p_mission_id and mr.published and mission.status='open'
    and (select s.unlocked from public.action_globe_region_unlock_status(mr.region_key) s)
 )
$$;
revoke all on function public.action_globe_can_join_mission(uuid,uuid) from public,anon,authenticated;
grant execute on function public.action_globe_can_join_mission(uuid,uuid) to service_role;

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
revoke all on function public.join_action_mission(uuid) from public, anon;
grant execute on function public.join_action_mission(uuid) to authenticated, service_role;

alter table public.action_globe_mission_regions drop constraint if exists action_globe_mission_regions_join_scope_check;
alter table public.action_globe_mission_regions drop column if exists join_scope;

commit;
