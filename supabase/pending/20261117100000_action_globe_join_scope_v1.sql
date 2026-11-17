-- JOINING A PINNED MISSION: A PIN SHOWS WHERE, IT DOES NOT DECIDE WHO (join scope v1)
--
-- PENDING. Not applied to production. Owner approval required. Apply with the Supabase MCP
-- `apply_migration` (it runs as postgres, which owns the table and both functions) under the name
-- `action_globe_join_scope_v1`, then promote with the steps in supabase/pending/README.md ("To promote
-- one"). The service role cannot apply it: it owns neither the table nor the functions (read 2026-11-17).
-- Order: supabase/pending/PROMOTION-ORDER.md, section 10.
-- Rollback: 20261117100000_action_globe_join_scope_v1.rollback.sql.
-- Proof before apply: scripts/test/mission-catalog.native.integration.mjs (a disposable PostgreSQL built
-- to production's shape as read on 2026-11-17).
--
-- Why. Production's join_action_mission() (md5(prosrc) e0684ebe350296c5e6c06de55624ed42, read-only
-- 2026-11-17; it is supabase/migrations/20261014184518_action_globe_join_authorization.sql) refuses a
-- mission that has ANY row in action_globe_mission_regions, published or not, unless the member has a
-- consented region there and that region is unlocked (two members by default). action_globe_member_regions
-- has 0 rows, so writing one pin today makes its mission unjoinable for every member, through every join
-- path (join_action_mission_attributed, _live and _origin call it). Production has 0 pins today, so
-- nothing is locked yet: this file must land before the first pin is written.
--
-- What it does. The minimal extract of 20261015230000_action_mission_pins_arcs_black_business.sql
-- (sections 3 and 5) that decouples joining from pins, and nothing else from that file:
--   1. action_globe_mission_regions gains join_scope text not null default 'anywhere', checked to
--      ('anywhere', 'region_members'). 'anywhere' is a display pin; only 'region_members' limits who may
--      join. Any existing row becomes 'anywhere' (0 rows in production on 2026-11-17).
--   2. action_globe_can_join_mission() also requires the pin's join_scope to be 'region_members'.
--   3. join_action_mission() runs the region check only when the mission has a PUBLISHED pin whose
--      join_scope is 'region_members'. Every other line is production's: sign-in, the Action identity, the
--      open status and dates, the existing assignment and the withdrawn rejoin, capacity, the insert and
--      the result. Both functions keep SECURITY DEFINER, search_path '' and their grants (the join:
--      authenticated and service_role; the eligibility helper: service_role only).
-- Not here: the multi-pin key, pin_role and sort_order, country regions and country lists, origins, arcs,
-- calls to action, card extras, business listings, the public pin RPC and the curation section. The
-- public pin RPC, action_globe_public_region_missions(), is unchanged: it shows every published pin of
-- an open mission, whatever its join_scope.
-- The whole pins file can still follow this one: it adds the same column and the same check under the
-- same names, and replaces both functions with its own versions (scripts/test-mission-pins-db.sh runs it
-- on top of this file). After that, this file must never run again, and its rollback must wait until the
-- pins file is rolled back: both would replace the pins file's join_action_mission, which also checks a
-- mission arc's earlier step. Both refuse instead (below).
--
-- It REFUSES, changing nothing (55000), unless both functions are still production's (the first run) or
-- this file's own (a rerun), by md5(prosrc): anything else means another migration has replaced them,
-- such as the pins file. The table lock comes first, so a migration that alters the same table cannot
-- slip in between the check and the change.
--
-- Idempotent: safe to run twice.
begin;
set local lock_timeout = '5s';

lock table public.action_globe_mission_regions in access exclusive mode;
do $join_scope_guard$
declare
  v_join text := (select md5(p.prosrc) from pg_catalog.pg_proc p
                   where p.oid = to_regprocedure('public.join_action_mission(uuid)'));
  v_can text := (select md5(p.prosrc) from pg_catalog.pg_proc p
                  where p.oid = to_regprocedure('public.action_globe_can_join_mission(uuid,uuid)'));
begin
  -- production's bodies (2026-11-17) and this file's own, below
  if v_join is null or v_join not in ('e0684ebe350296c5e6c06de55624ed42', 'f29d7657d536e60f1b7df33ee17bcde4')
     or v_can is null or v_can not in ('a73db92bb2c4b4e6da84b1e311c82b84', '70700a7b0f68a24a1664d38097685bf5') then
    raise exception 'join scope v1 refused: join_action_mission (md5 %) or action_globe_can_join_mission (md5 %) is neither production''s nor this file''s',
      coalesce(v_join, 'absent'), coalesce(v_can, 'absent')
      using errcode = '55000',
            hint = 'Another migration has replaced them, such as 20261015230000_action_mission_pins_arcs_black_business.sql, which already holds this change. Nothing was changed.';
  end if;
end
$join_scope_guard$;

alter table public.action_globe_mission_regions
  add column if not exists join_scope text not null default 'anywhere';
alter table public.action_globe_mission_regions drop constraint if exists action_globe_mission_regions_join_scope_check;
alter table public.action_globe_mission_regions add constraint action_globe_mission_regions_join_scope_check
  check (join_scope in ('anywhere','region_members'));
comment on column public.action_globe_mission_regions.join_scope is
  'anywhere: a display pin, every signed-in member may join. region_members: only a member with a consented region here may join, once the region is unlocked.';

-- Trusted backend only: never accept the acting user ID from a public client.
create or replace function public.action_globe_can_join_mission(p_m_uid uuid,p_mission_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(
  select 1 from public.action_globe_mission_regions mr
  join public.action_missions mission on mission.id=mr.mission_id
  join public.action_globe_member_regions member on member.m_uid=p_m_uid
     and member.region_key=mr.region_key
  where mr.mission_id=p_mission_id and mr.published and mr.join_scope='region_members'
    and mission.status='open'
    and (select s.unlocked from public.action_globe_region_unlock_status(mr.region_key) s)
 )
$$;
revoke all on function public.action_globe_can_join_mission(uuid,uuid) from public,anon,authenticated;
grant execute on function public.action_globe_can_join_mission(uuid,uuid) to service_role;

-- Preserve canonical join semantics; a pin gates entry only when it says region_members.
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

 -- display pins never gate; only a published pin marked region_members does
 if exists (select 1 from public.action_globe_mission_regions
             where mission_id = p_mission_id and published and join_scope = 'region_members')
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

commit;
