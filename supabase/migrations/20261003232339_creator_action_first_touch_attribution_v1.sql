-- Attribution is a conversion event, not last-click history.
-- If a member already has an active assignment, seeing creator content later
-- must not retroactively credit that content with the join. A new assignment
-- or a withdrawn assignment that is reactivated can be attributed.
create or replace function public.join_action_mission_attributed(
  p_mission_id uuid,
  p_content_id uuid default null,
  p_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_result jsonb;
  v_assignment_id uuid;
  v_content_mission uuid;
  v_source text := nullif(lower(btrim(coalesce(p_source,''))), '');
  v_prior_status text;
begin
  if v_user is null then raise exception 'sign in to take a mission'; end if;
  if v_source is not null and (
    char_length(v_source) > 32 or v_source !~ '^[a-z0-9][a-z0-9._-]*$'
  ) then
    raise exception 'invalid action source';
  end if;

  if p_content_id is not null then
    select c.action_mission_id into v_content_mission
    from public.social_content_items c
    where c.id = p_content_id;
    if not found or v_content_mission is distinct from p_mission_id then
      raise exception 'that content does not point to this mission';
    end if;
  end if;

  select a.status into v_prior_status
  from public.action_mission_assignments a
  where a.mission_id = p_mission_id
    and a.user_id = v_user;

  v_result := public.join_action_mission(p_mission_id);
  v_assignment_id := (v_result->>'assignment_id')::uuid;

  if v_prior_status is null or v_prior_status = 'withdrawn' then
    update public.action_mission_assignments
    set source_content_id = p_content_id,
        source_channel = v_source
    where id = v_assignment_id
      and user_id = v_user;
  end if;

  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'source_content_id', case when v_prior_status is null or v_prior_status = 'withdrawn' then p_content_id else null end,
    'source_channel', case when v_prior_status is null or v_prior_status = 'withdrawn' then v_source else null end
  ));
end;
$$;

comment on function public.join_action_mission_attributed(uuid,uuid,text) is
  'Authenticated member command. SECURITY DEFINER is intentional. Attribution is written only when the content creates or reactivates the assignment; an already-active assignment is never retroactively credited to a later click.';
