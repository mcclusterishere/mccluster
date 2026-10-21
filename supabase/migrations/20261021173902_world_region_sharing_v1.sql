begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.world_region_sharing (
  m_uid uuid primary key references public.m_people(id) on delete cascade,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  subdivision_code text,
  consented_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint world_region_sharing_subdivision_valid check (
    subdivision_code is null or (
      subdivision_code ~ '^[A-Z]{2}-[A-Z0-9]{1,8}$'
      and left(subdivision_code, 2) = country_code
    )
  )
);

alter table public.world_region_sharing enable row level security;
alter table public.world_region_sharing force row level security;
revoke all on public.world_region_sharing from public, anon, authenticated;
grant all on public.world_region_sharing to service_role;

create or replace function public.world_region_sharing_get()
returns table(country_code text, subdivision_code text, consented_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.country_code, s.subdivision_code, s.consented_at
  from public.world_region_sharing s
  where s.m_uid = public.current_m_uid()
$$;

create or replace function public.world_region_sharing_set(
  p_country_code text,
  p_subdivision_code text default null
)
returns table(country_code text, subdivision_code text, consented_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m_uid uuid := public.current_m_uid();
  v_country text := upper(trim(coalesce(p_country_code, '')));
  v_subdivision text := nullif(upper(trim(coalesce(p_subdivision_code, ''))), '');
begin
  if auth.uid() is null or v_m_uid is null then
    raise exception 'McCluster identity required' using errcode = '42501';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    raise exception 'country_code must be ISO 3166-1 alpha-2' using errcode = '22023';
  end if;
  if v_subdivision is not null and (
    v_subdivision !~ '^[A-Z]{2}-[A-Z0-9]{1,8}$'
    or left(v_subdivision, 2) <> v_country
  ) then
    raise exception 'subdivision_code must belong to country_code' using errcode = '22023';
  end if;

  insert into public.world_region_sharing(m_uid, country_code, subdivision_code, consented_at, updated_at)
  values (v_m_uid, v_country, v_subdivision, now(), now())
  on conflict (m_uid) do update
    set country_code = excluded.country_code,
        subdivision_code = excluded.subdivision_code,
        consented_at = now(),
        updated_at = now();

  return query
  select s.country_code, s.subdivision_code, s.consented_at
  from public.world_region_sharing s
  where s.m_uid = v_m_uid;
end
$$;

create or replace function public.world_region_sharing_clear()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m_uid uuid := public.current_m_uid();
  v_deleted bigint;
begin
  if auth.uid() is null or v_m_uid is null then
    raise exception 'McCluster identity required' using errcode = '42501';
  end if;
  delete from public.world_region_sharing where m_uid = v_m_uid;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end
$$;

create or replace function public.world_public_member_counts()
returns table(scope_key text, country_code text, subdivision_code text, member_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.country_code as scope_key,
         s.country_code,
         null::text as subdivision_code,
         count(*)::bigint as member_count
  from public.world_region_sharing s
  group by s.country_code
  having count(*) >= 5
  union all
  select s.subdivision_code as scope_key,
         s.country_code,
         s.subdivision_code,
         count(*)::bigint as member_count
  from public.world_region_sharing s
  where s.subdivision_code is not null
  group by s.country_code, s.subdivision_code
  having count(*) >= 5
$$;

revoke all on function public.world_region_sharing_get() from public, anon;
revoke all on function public.world_region_sharing_set(text,text) from public, anon;
revoke all on function public.world_region_sharing_clear() from public, anon;
revoke all on function public.world_public_member_counts() from public;

grant execute on function public.world_region_sharing_get() to authenticated, service_role;
grant execute on function public.world_region_sharing_set(text,text) to authenticated, service_role;
grant execute on function public.world_region_sharing_clear() to authenticated, service_role;
grant execute on function public.world_public_member_counts() to anon, authenticated, service_role;

comment on table public.world_region_sharing is
  'Explicit, revocable coarse World-region sharing. Separate from mission eligibility and private contact/address data.';
comment on function public.world_public_member_counts() is
  'Public coarse region counts for members who explicitly opted in; every scope is suppressed below five members.';

commit;
