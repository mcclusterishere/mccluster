-- ACTION MISSION COMPLETION AUTOMATION V1
-- Canonical production migration: 20261003035208.
-- Close the campaign -> mission -> proof -> verified-action accounting loop.
-- Mission completion events are written only by a database trigger when an
-- assignment becomes verified; action_act() deliberately cannot mint them.

alter table public.action_events
  drop constraint if exists action_events_kind_check;

alter table public.action_events
  add constraint action_events_kind_check
  check (kind in ('share','volunteer','research','organize','learn','resources','give_intent','mission'));

create unique index if not exists action_events_one_mission_completion
  on public.action_events ((detail->>'assignment_id'))
  where kind='mission' and detail ? 'assignment_id';

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

  if v_campaign is null then
    return new;
  end if;

  insert into public.action_events(campaign_id,user_id,kind,detail,at)
  values(
    v_campaign,
    new.user_id,
    'mission',
    jsonb_build_object('assignment_id',new.id,'mission_id',new.mission_id),
    coalesce(new.verified_at,now())
  )
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.action_record_verified_mission() from public,anon,authenticated;

drop trigger if exists action_record_verified_mission_trg on public.action_mission_assignments;
create trigger action_record_verified_mission_trg
  after update of status on public.action_mission_assignments
  for each row
  execute function public.action_record_verified_mission();

-- Reconcile any verified campaign missions that predate this trigger.
insert into public.action_events(campaign_id,user_id,kind,detail,at)
select
  m.campaign_id,
  a.user_id,
  'mission',
  jsonb_build_object('assignment_id',a.id,'mission_id',a.mission_id),
  coalesce(a.verified_at,a.submitted_at,a.joined_at,now())
from public.action_mission_assignments a
join public.action_missions m on m.id=a.mission_id
where a.status='verified'
  and m.campaign_id is not null
on conflict do nothing;

create or replace function public.action_mission_stats(p_campaign text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'mission_id',x.mission_id,
    'campaign_id',x.campaign_id,
    'capacity',x.capacity,
    'joined',x.joined,
    'in_progress',x.in_progress,
    'submitted',x.submitted,
    'verified',x.verified,
    'rejected',x.rejected,
    'slots_left',case when x.capacity is null then null else greatest(x.capacity-x.joined,0) end
  ) order by x.created_at desc),'[]'::jsonb)
  from (
    select
      m.id as mission_id,
      m.campaign_id,
      m.capacity,
      m.created_at,
      count(a.id) filter (where a.status <> 'withdrawn')::int as joined,
      count(a.id) filter (where a.status in ('joined','in_progress'))::int as in_progress,
      count(a.id) filter (where a.status='submitted')::int as submitted,
      count(a.id) filter (where a.status='verified')::int as verified,
      count(a.id) filter (where a.status='rejected')::int as rejected
    from public.action_missions m
    left join public.action_mission_assignments a on a.mission_id=m.id
    where (p_campaign is null or m.campaign_id=p_campaign)
      and (m.status in ('open','paused','closed') or (select public.eu_is_admin()))
    group by m.id,m.campaign_id,m.capacity,m.created_at
  ) x;
$$;

revoke all on function public.action_mission_stats(text) from public;
grant execute on function public.action_mission_stats(text) to anon,authenticated,service_role;
