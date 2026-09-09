-- Historical replay compatibility only.
--
-- 0031 deliberately moved org membership helpers out of the PostgREST-exposed
-- public schema. Several later historical migrations were authored against
-- the old public function names, however, so a database built from zero needs
-- a compatibility bridge while those migrations replay.
--
-- This file is NOT the desired final security posture. The terminal hardening
-- migration rewrites every dependent policy to private.is_org_* and drops
-- these public wrappers without CASCADE.

create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select private.is_org_member(p_org);
$$;

create or replace function public.is_org_owner(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select private.is_org_owner(p_org);
$$;

-- RLS policies can execute under anon/authenticated roles, so those callers
-- need EXECUTE while historical policy definitions still reference these
-- wrappers. Remove PUBLIC's implicit grant and grant only the roles required
-- for replay/runtime policy evaluation. The terminal hardening migration
-- removes the wrappers entirely.
revoke execute on function public.is_org_member(uuid) from public;
revoke execute on function public.is_org_owner(uuid) from public;
grant execute on function public.is_org_member(uuid) to anon, authenticated, service_role;
grant execute on function public.is_org_owner(uuid) to anon, authenticated, service_role;
