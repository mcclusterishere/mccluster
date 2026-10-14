-- Regional activation requires two distinct consenting members, without publishing small counts.
create table if not exists public.action_globe_region_activation (
 region_key text primary key references public.action_globe_regions(region_key),
 minimum_members integer not null default 2 check (minimum_members between 2 and 100),
 enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
alter table public.action_globe_region_activation enable row level security;
revoke all on public.action_globe_region_activation from public,anon,authenticated;
grant all on public.action_globe_region_activation to service_role;

create or replace function public.action_globe_region_unlock_status(p_region_key text)
returns table(region_key text,unlocked boolean,invite_enabled boolean)
language sql stable security definer set search_path=''
as $$
 select r.region_key,
  (coalesce(a.enabled,true) and
   (select count(distinct m.m_uid) from public.action_globe_member_regions m
    where m.region_key=r.region_key)>=coalesce(a.minimum_members,2)) as unlocked,
  coalesce(a.enabled,true) as invite_enabled
 from public.action_globe_regions r
 left join public.action_globe_region_activation a on a.region_key=r.region_key
 where r.region_key=p_region_key
$$;
revoke all on function public.action_globe_region_unlock_status(text) from public;
grant execute on function public.action_globe_region_unlock_status(text) to anon,authenticated,service_role;

-- Trusted backend only: never accept the acting user ID from a public client.
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
comment on function public.action_globe_can_join_mission(uuid,uuid) is
 'Service-only prerequisite, not a complete authorization decision. Canonical mission join endpoint must also enforce identity, eligibility and assignment policy.';

-- The canonical mission join must enforce this predicate before assigning a mission.
-- Never expose the service-only predicate to untrusted clients.
