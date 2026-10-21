-- ACTION ORIGIN ATTRIBUTION V2
-- Durable first-touch attribution from campaign action choice through verified completion.
-- Production migration: 20261004021226_action_origin_attribution_v2

alter table public.action_mission_assignments
  add column source_reel text,
  add column source_actionable text;

alter table public.action_mission_assignments
  add constraint action_mission_assignments_source_reel_check
  check (
    source_reel is null or (
      char_length(source_reel) between 1 and 40
      and source_reel ~ '^[a-z0-9][a-z0-9._-]*$'
    )
  ),
  add constraint action_mission_assignments_source_actionable_check
  check (
    source_actionable is null or (
      char_length(source_actionable) between 1 and 96
      and source_actionable ~ '^[a-z0-9][a-z0-9._:-]*$'
    )
  );

create index action_assignments_source_origin_idx
  on public.action_mission_assignments(source_channel, source_reel, source_actionable, status)
  where source_channel is not null or source_reel is not null or source_actionable is not null;

create or replace function public.join_action_mission_origin(
  p_mission_id uuid,
  p_content_id uuid,
  p_source text,
  p_reel text,
  p_actionable text
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
  v_reel text := nullif(lower(btrim(coalesce(p_reel,''))), '');
  v_actionable text := nullif(lower(btrim(coalesce(p_actionable,''))), '');
  v_prior_status text;
  v_prior_content uuid;
  v_prior_channel text;
  v_prior_reel text;
  v_prior_actionable text;
  v_attributed boolean := false;
begin
  if v_user is null then raise exception 'sign in to take a mission'; end if;

  if v_source is not null and (
    char_length(v_source) > 32 or v_source !~ '^[a-z0-9][a-z0-9._-]*$'
  ) then raise exception 'invalid action source'; end if;

  if v_reel is not null and (
    char_length(v_reel) > 40 or v_reel !~ '^[a-z0-9][a-z0-9._-]*$'
  ) then raise exception 'invalid reel source'; end if;

  if v_actionable is not null and (
    char_length(v_actionable) > 96 or v_actionable !~ '^[a-z0-9][a-z0-9._:-]*$'
  ) then raise exception 'invalid actionable source'; end if;

  if p_content_id is not null then
    select c.action_mission_id into v_content_mission
    from public.social_content_items c
    where c.id = p_content_id;
    if not found or v_content_mission is distinct from p_mission_id then
      raise exception 'that content does not point to this mission';
    end if;
  end if;

  select
    a.status,
    a.source_content_id,
    a.source_channel,
    a.source_reel,
    a.source_actionable
  into
    v_prior_status,
    v_prior_content,
    v_prior_channel,
    v_prior_reel,
    v_prior_actionable
  from public.action_mission_assignments a
  where a.mission_id = p_mission_id
    and a.user_id = v_user;

  v_result := public.join_action_mission(p_mission_id);
  v_assignment_id := (v_result->>'assignment_id')::uuid;

  if v_prior_status is null
     or (
       v_prior_status = 'withdrawn'
       and v_prior_content is null
       and v_prior_channel is null
       and v_prior_reel is null
       and v_prior_actionable is null
     ) then
    update public.action_mission_assignments
    set source_content_id = p_content_id,
        source_channel = v_source,
        source_reel = v_reel,
        source_actionable = v_actionable
    where id = v_assignment_id
      and user_id = v_user;

    v_attributed := p_content_id is not null
      or v_source is not null
      or v_reel is not null
      or v_actionable is not null;
  end if;

  return v_result || jsonb_strip_nulls(jsonb_build_object(
    'source_content_id', case when v_attributed then p_content_id else null end,
    'source_channel', case when v_attributed then v_source else null end,
    'source_reel', case when v_attributed then v_reel else null end,
    'source_actionable', case when v_attributed then v_actionable else null end
  ));
end;
$$;

revoke all on function public.join_action_mission_origin(uuid,uuid,text,text,text)
  from public, anon;
grant execute on function public.join_action_mission_origin(uuid,uuid,text,text,text)
  to authenticated, service_role;

comment on function public.join_action_mission_origin(uuid,uuid,text,text,text) is
  'Authenticated member command. Persists first-touch content/channel/reel/actionable attribution when a mission assignment is created, or when an unattributed withdrawn assignment is reactivated.';

create or replace function public.action_record_verified_mission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign text;
begin
  if new.status <> 'verified' or old.status = 'verified' then
    return new;
  end if;

  select m.campaign_id into v_campaign
  from public.action_missions m
  where m.id = new.mission_id;

  if v_campaign is null then return new; end if;

  insert into public.action_events(campaign_id,user_id,kind,detail,at)
  values(
    v_campaign,
    new.user_id,
    'mission',
    jsonb_strip_nulls(jsonb_build_object(
      'assignment_id',new.id,
      'mission_id',new.mission_id,
      'source_content_id',new.source_content_id,
      'source_channel',new.source_channel,
      'source_reel',new.source_reel,
      'source_actionable',new.source_actionable,
      'source_live_session_id',new.source_live_session_id
    )),
    coalesce(new.verified_at,now())
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.action_record_verified_mission()
  from public, anon, authenticated;

create or replace function public.action_origin_stats(p_campaign text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if (select auth.uid()) is null or not (select public.eu_is_admin()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'source_channel', x.source_channel,
      'source_reel', x.source_reel,
      'source_actionable', x.source_actionable,
      'source_content_id', x.source_content_id,
      'joined', x.joined,
      'in_progress', x.in_progress,
      'submitted', x.submitted,
      'verified', x.verified,
      'rejected', x.rejected
    )
    order by x.verified desc, x.joined desc, x.source_reel nulls last, x.source_actionable nulls last
  ), '[]'::jsonb)
  into v_out
  from (
    select
      a.source_channel,
      a.source_reel,
      a.source_actionable,
      a.source_content_id,
      count(*)::int as joined,
      count(*) filter (where a.status in ('joined','in_progress'))::int as in_progress,
      count(*) filter (where a.submitted_at is not null)::int as submitted,
      count(*) filter (where a.status='verified')::int as verified,
      count(*) filter (where a.status='rejected')::int as rejected
    from public.action_mission_assignments a
    join public.action_missions m on m.id=a.mission_id
    where m.campaign_id=p_campaign
      and a.status<>'withdrawn'
    group by a.source_channel,a.source_reel,a.source_actionable,a.source_content_id
  ) x;

  return v_out;
end;
$$;

revoke all on function public.action_origin_stats(text) from public, anon;
grant execute on function public.action_origin_stats(text) to authenticated, service_role;

comment on function public.action_origin_stats(text) is
  'Owner-only aggregate mission conversion funnel by first-touch channel, reel, actionable and content item. Returns counts only; no participant identity.';
