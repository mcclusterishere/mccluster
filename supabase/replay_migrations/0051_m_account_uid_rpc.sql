-- Return the canonical M person id for the current authenticated credential.
-- This does not expose any other person's mapping.
create or replace function public.m_my_uid()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select l.m_uid
  from public.m_auth_user_links l
  where l.auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.m_my_uid() from public, anon;
grant execute on function public.m_my_uid() to authenticated;

-- Compatibility helper used by network/Mnet RLS policies. This mirrors the
-- production definition so a clean migration replay has the same identity
-- primitive before later commercial/network policies are created.
create or replace function public.current_m_uid()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m_uid
  from public.m_auth_user_links
  where auth_user_id = auth.uid()
    and is_primary = true
  limit 1;
$$;

grant execute on function public.current_m_uid() to anon, authenticated, service_role;
