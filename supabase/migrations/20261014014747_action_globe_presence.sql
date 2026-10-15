create table if not exists public.action_globe_presence (
 m_uid uuid primary key references public.m_people(id) on delete cascade,
 region_key text not null references public.action_globe_regions(region_key),
 last_seen_at timestamptz not null default now()
);
create index if not exists action_globe_presence_expiry on public.action_globe_presence(last_seen_at);
alter table public.action_globe_presence enable row level security;
revoke all on public.action_globe_presence from public,anon,authenticated;
grant all on public.action_globe_presence to service_role;
create or replace function public.action_globe_public_presence()
returns table(region_key text,online_count bigint)
language sql stable security definer set search_path=''
as $$
 select p.region_key,count(*)::bigint from public.action_globe_presence p
 join public.action_globe_member_regions c on c.m_uid=p.m_uid and c.region_key=p.region_key
 where p.last_seen_at>=now()-interval '2 minutes'
 group by p.region_key having count(*)>=5
$$;
revoke all on function public.action_globe_public_presence() from public;
grant execute on function public.action_globe_public_presence() to anon,authenticated,service_role;
create or replace function public.action_globe_public_online_total()
returns bigint language sql stable security definer set search_path=''
as $$
 select case when count(*)>=5 then count(*)::bigint else null::bigint end
 from public.action_globe_presence p
 join public.action_globe_member_regions c on c.m_uid=p.m_uid and c.region_key=p.region_key
 where p.last_seen_at>=now()-interval '2 minutes'
$$;
revoke all on function public.action_globe_public_online_total() from public;
grant execute on function public.action_globe_public_online_total() to anon,authenticated,service_role;
