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
