-- A verified Equity Uprise policy memo is an alternate, substantive
-- application qualification. Existing three-verified-action path stays.
-- The server still validates eligibility; no automatic team admission.
-- The application is the existing Action Network fellowship queue.

create or replace function public.action_fellowship_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid),
  n as (select count(*)::int as verified from public.action_mission_assignments a, me where a.user_id = me.uid and a.status = 'verified'),
  latest as (
    select f.id, f.status, f.created_at, f.reviewed_at, f.review_note
    from public.action_fellowship_applications f, me where f.user_id = me.uid
    order by f.created_at desc limit 1)
  select case when (select uid from me) is null then null else jsonb_build_object(
    'verified_actions', (select verified from n),
    'needed', public.action_fellowship_min_verified(),
    'eligible', (select verified from n) >= public.action_fellowship_min_verified()
      OR EXISTS (
        SELECT 1 FROM public.action_mission_assignments a, me
        WHERE a.user_id=me.uid AND a.status='verified'
          AND a.mission_id='368fd75a-77d2-4de0-9722-17020674a914'::uuid
      ),
    'application', (select to_jsonb(latest) from latest)
  ) end;
$$;


create or replace function public.apply_for_fellowship(
 p_why text,
 p_project text default '',
 p_hours_per_week integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_m_uid uuid := public.current_m_uid();
 v_verified integer;
 v_why text := btrim(coalesce(p_why, ''));
 v_project text := btrim(coalesce(p_project, ''));
 v_id uuid;
begin
 if v_user is null then raise exception 'sign in to apply'; end if;
 if v_m_uid is null then raise exception 'your Action identity is not ready yet'; end if;
 if char_length(v_why) < 40 then raise exception 'tell us why in at least 40 characters'; end if;
 if char_length(v_why) > 3000 or char_length(v_project) > 3000 then raise exception 'keep each answer under 3,000 characters'; end if;
 if p_hours_per_week is not null and (p_hours_per_week < 1 or p_hours_per_week > 60) then raise exception 'hours per week must be between 1 and 60'; end if;

 select count(*) into v_verified from public.action_mission_assignments where user_id = v_user and status = 'verified';
 if v_verified < public.action_fellowship_min_verified()
    and not exists (
      select 1 from public.action_mission_assignments a
      where a.user_id=v_user and a.status='verified'
        and a.mission_id='368fd75a-77d2-4de0-9722-17020674a914'::uuid
    ) then
   raise exception 'the fellowship opens after % verified actions; you have %', public.action_fellowship_min_verified(), v_verified;
 end if;
 if exists (select 1 from public.action_fellowship_applications where user_id = v_user and status = 'submitted') then
   raise exception 'you already have an application in review';
 end if;
 if exists (select 1 from public.action_fellowship_applications where user_id = v_user and status = 'accepted') then
   raise exception 'you are already a fellow';
 end if;

 insert into public.action_fellowship_applications(user_id, m_uid, why, project, hours_per_week, verified_actions_at_apply)
 values (v_user, v_m_uid, v_why, v_project, p_hours_per_week, v_verified)
 returning id into v_id;
 return jsonb_build_object('application_id', v_id, 'status', 'submitted', 'verified_actions', v_verified);
end;
$$;


