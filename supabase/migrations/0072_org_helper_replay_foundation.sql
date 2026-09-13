-- Reconstruct public/private org-membership helpers that exist in production
-- but were absent from source history before security-definer hardening.

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

revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.is_org_owner(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.is_org_owner(uuid) to authenticated, service_role;

grant execute on function private.is_org_member(uuid) to anon, authenticated, service_role;
grant execute on function private.is_org_owner(uuid) to anon, authenticated, service_role;
