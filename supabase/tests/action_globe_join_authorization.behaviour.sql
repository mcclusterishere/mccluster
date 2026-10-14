-- Run only against isolated Supabase CI. Read-only assertions; transaction rolls back.
begin;
do $audit$
declare
  join_source text;
  denied boolean := false;
begin
  if has_function_privilege('anon','public.join_action_mission(uuid)','EXECUTE') then
    raise exception 'anon must not execute join_action_mission';
  end if;
  if not has_function_privilege('authenticated','public.join_action_mission(uuid)','EXECUTE') then
    raise exception 'authenticated members must be able to call canonical join';
  end if;
  if has_function_privilege('anon','public.action_globe_can_join_mission(uuid,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.action_globe_can_join_mission(uuid,uuid)','EXECUTE') then
    raise exception 'regional eligibility helper leaked to untrusted roles';
  end if;
  if has_table_privilege('authenticated','public.action_mission_assignments','INSERT')
    or has_table_privilege('authenticated','public.action_mission_assignments','UPDATE')
    or has_table_privilege('authenticated','public.action_globe_member_regions','INSERT')
    or has_table_privilege('authenticated','public.action_globe_member_regions','UPDATE') then
    raise exception 'authenticated role has direct mutation privileges';
  end if;
  select pg_get_functiondef('public.join_action_mission(uuid)'::regprocedure) into join_source;
  -- Regression guard: the rejoin branch must check capacity before reactivation.
  if position('if v_assignment.status = ''withdrawn'' then' in join_source)=0
     or position('if v_taken >= v_mission.capacity then' in join_source)=0 then
    raise exception 'withdrawn rejoin capacity guard missing';
  end if;
  if position('action_globe_can_join_mission(v_m_uid, p_mission_id)' in join_source)=0 then
    raise exception 'canonical mission join does not enforce regional eligibility';
  end if;
end
$audit$;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
do $audit$
declare
  error_message text;
begin
  begin
    perform public.join_action_mission('00000000-0000-0000-0000-000000000001'::uuid);
    raise exception 'anonymous identity unexpectedly joined a mission';
  exception when others then
    get stacked diagnostics error_message = message_text;
    if error_message <> 'sign in to take a mission' then
      raise exception 'unexpected unauthenticated join result: %',error_message;
    end if;
  end;
end
$audit$;
rollback;
