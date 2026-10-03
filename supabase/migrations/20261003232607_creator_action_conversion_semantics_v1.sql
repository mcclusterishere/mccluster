-- Finalize creator/action conversion semantics.
-- 1. Content attribution is first-touch for the lifetime of the mission
--    assignment; a later click/rejoin can never steal an earlier source.
-- 2. "proof submitted" is cumulative via submitted_at, so verification does
--    not make a previously submitted proof disappear from the funnel.
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
  v_prior_source uuid;
  v_attributed boolean := false;
begin
  if v_user is null then raise exception 'sign in to take a mission'; end if;
  if v_source is not null and (
    char_length(v_source) > 32 or v_source !~ '^[a-z0-9][a-z0-9._-]*$'
  ) then raise exception 'invalid action source'; end if;

  if p_content_id is not null then
    select c.action_mission_id into v_content_mission
    from public.social_content_items c
    where c.id = p_content_id;
    if not found or v_content_mission is distinct from p_mission_id then
      raise exception 'that content does not point to this mission';
    end if;
  end if;

  select a.status, a.source_content_id
    into v_prior_status, v_prior_source
  from public.action_mission_assignments a
  where a.mission_id = p_mission_id
    and a.user_id = v_user;

  v_result := public.join_action_mission(p_mission_id);
  v_assignment_id := (v_result->>'assignment_id')::uuid;

  if v_prior_status is null or (v_prior_status = 'withdrawn' and v_prior_source is null) then
    update public.action_mission_assignments
    set source_content_id = p_content_id,
        source_channel = v_source
    where id = v_assignment_id
      and user_id = v_user;
    v_attributed := p_content_id is not null or v_source is not null;
  end if;

  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'source_content_id', case when v_attributed then p_content_id else null end,
    'source_channel', case when v_attributed then v_source else null end
  ));
end;
$$;

create or replace function public.social_content_action_stats(p_content_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_out jsonb;
begin
  select c.org_id into v_org
  from public.social_content_items c
  where c.id = p_content_id;
  if v_org is null then raise exception 'content not found'; end if;
  if not private.is_org_member(v_org) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  with latest_metrics as (
    select distinct on (s.post_id)
      s.post_id, s.views, s.reach, s.comments, s.shares, s.saves
    from public.social_metric_snapshots s
    join public.social_posts p on p.id = s.post_id
    where p.content_id = p_content_id
    order by s.post_id, s.recorded_at desc
  ),
  action_counts as (
    select
      count(*)::int as joined,
      count(*) filter (where a.submitted_at is not null)::int as submitted,
      count(*) filter (where a.status = 'verified')::int as verified,
      count(*) filter (where a.status = 'rejected')::int as rejected
    from public.action_mission_assignments a
    where a.source_content_id = p_content_id
  ),
  external as (
    select
      count(*)::int as published_posts,
      coalesce(sum(l.views),0)::bigint as views,
      coalesce(sum(l.reach),0)::bigint as reach,
      coalesce(sum(l.comments),0)::bigint as comments,
      coalesce(sum(l.shares),0)::bigint as shares,
      coalesce(sum(l.saves),0)::bigint as saves
    from public.social_posts p
    left join latest_metrics l on l.post_id = p.id
    where p.content_id = p_content_id
  )
  select jsonb_build_object(
    'content_id', p_content_id,
    'joined', a.joined,
    'submitted', a.submitted,
    'verified', a.verified,
    'rejected', a.rejected,
    'published_posts', e.published_posts,
    'views', e.views,
    'reach', e.reach,
    'comments', e.comments,
    'shares', e.shares,
    'saves', e.saves,
    'network_posts', (
      select count(*) from public.network_posts n
      where n.content_id = p_content_id and n.deleted_at is null
    )
  ) into v_out
  from action_counts a cross join external e;

  return v_out;
end;
$$;

comment on function public.join_action_mission_attributed(uuid,uuid,text) is
  'Authenticated member command. SECURITY DEFINER is intentional. Attribution is first-touch for the mission assignment lifecycle: an existing source is never overwritten by a later click or rejoin.';
