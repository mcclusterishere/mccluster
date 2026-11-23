-- Public presentation preference only; leaves news, pins and Analytics intact.
create table public.eup_world_display (
  singleton boolean primary key default true check (singleton),
  public_news_heat_map boolean not null default false
);
insert into public.eup_world_display default values;
alter table public.eup_world_display enable row level security;
revoke all on table public.eup_world_display from public, anon, authenticated, service_role;

create function public.eup_world_display_read()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select d.public_news_heat_map from public.eup_world_display d where d.singleton), false)
$$;

create function public.eup_world_display_set(p_actor uuid, p_public_news_heat_map boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.orgs o
    join public.org_members m on m.org_id = o.id
    where o.slug = 'mccluster' and m.profile_id = p_actor and m.role = 'owner'
  ) then
    raise exception using errcode = '42501', message = 'House owner required';
  end if;
  if p_public_news_heat_map is null then
    raise exception using errcode = '22023', message = 'Boolean required';
  end if;
  insert into public.eup_world_display (singleton, public_news_heat_map)
    values (true, p_public_news_heat_map)
    on conflict (singleton) do update set public_news_heat_map = excluded.public_news_heat_map;
  return p_public_news_heat_map;
end;
$$;

revoke all on function public.eup_world_display_read() from public, anon, authenticated;
revoke all on function public.eup_world_display_set(uuid, boolean) from public, anon, authenticated;
grant execute on function public.eup_world_display_read() to service_role;
grant execute on function public.eup_world_display_set(uuid, boolean) to service_role;
