-- Reconstruct org/house/crew helpers that exist in production but were absent
-- from source history before the security-definer hardening wave.

create schema if not exists private;

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org
      and m.profile_id = auth.uid()
  );
$$;

create or replace function public.is_org_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org
      and m.profile_id = auth.uid()
      and m.role = 'owner'
  );
$$;

create or replace function private.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.eu_is_admin()
      or exists (
        select 1 from public.org_members m
        where m.org_id = p_org and m.profile_id = auth.uid()
      );
$$;

create or replace function private.is_org_owner(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.eu_is_admin()
      or exists (
        select 1 from public.org_members m
        where m.org_id = p_org and m.profile_id = auth.uid() and m.role = 'owner'
      );
$$;

create or replace function public.mccluster_is_house_owner()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.org_members m
       join public.orgs o on o.id = m.org_id
       where o.slug = 'mccluster'
         and m.profile_id = auth.uid()
         and m.role = 'owner'
     );
$$;

create or replace function public.shake_is_crew()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.eu_is_admin()
      or exists (select 1 from public.shake_crew c where c.profile_id = auth.uid());
$$;

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.is_org_owner(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.is_org_owner(uuid) to authenticated, service_role;

grant execute on function private.is_org_member(uuid) to anon, authenticated, service_role;
grant execute on function private.is_org_owner(uuid) to anon, authenticated, service_role;

-- Later historical hardening migrations refine these grants. Start from the
-- production-era helper availability needed for clean replay.
grant execute on function public.mccluster_is_house_owner() to anon, authenticated, service_role;
grant execute on function public.shake_is_crew() to anon, authenticated, service_role;
