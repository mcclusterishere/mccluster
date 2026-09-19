-- THE ORG HELPERS DO NOT BELONG IN THE PUBLIC API.
--
-- 0026 put is_org_member() and is_org_owner() in `public`, which is the
-- schema PostgREST exposes. That made them callable by anybody:
--
--     POST /rest/v1/rpc/is_org_member  {"p_org": "<uuid>"}
--
-- and the boolean that comes back answers "is that a real org, and am I
-- in it" for any id somebody wants to try. Small, but free to close.
--
-- REVOKING EXECUTE IS NOT THE FIX, and this was tested rather than
-- assumed: an RLS policy expression is evaluated with the CALLER's
-- privileges, so revoking EXECUTE from `authenticated` makes every policy
-- that uses these functions fail with "permission denied for function"
-- — which does not deny access, it denies the whole table to its own
-- staff.
--
-- Moving them to a schema PostgREST does not serve keeps the grant, keeps
-- the policies working, and takes the /rpc/ door away. The functions the
-- edge function genuinely calls over RPC — kb_search, memory_note,
-- mcp_decide, vault_secret — stay in public, where they are already
-- revoked from anon and authenticated and reachable only by the service
-- role.

create schema if not exists private;

create or replace function private.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.eu_is_admin()
      or exists (select 1 from public.org_members m
                  where m.org_id = p_org and m.profile_id = auth.uid());
$$;

create or replace function private.is_org_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.eu_is_admin()
      or exists (select 1 from public.org_members m
                  where m.org_id = p_org and m.profile_id = auth.uid() and m.role = 'owner');
$$;

grant usage on schema private to anon, authenticated, service_role;
grant execute on function private.is_org_member(uuid), private.is_org_owner(uuid)
  to anon, authenticated, service_role;

-- Rewrite every policy that named the public copy. Done by reading
-- pg_policies rather than by listing them here, because 0026 created some
-- of them in a loop and a hand-written list would go stale the first time
-- one is added.
do $$
declare r record; def text;
begin
  for r in
    select schemaname, tablename, policyname, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') like '%is_org_%' or coalesce(with_check, '') like '%is_org_%')
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    def := format('create policy %I on %I.%I for %s', r.policyname, r.schemaname, r.tablename, lower(r.cmd));
    if r.qual is not null then
      def := def || ' using (' || replace(r.qual, 'is_org_', 'private.is_org_') || ')';
    end if;
    if r.with_check is not null then
      def := def || ' with check (' || replace(r.with_check, 'is_org_', 'private.is_org_') || ')';
    end if;
    -- pg_policies renders the call already qualified, so guard the double
    def := replace(def, 'private.private.', 'private.');
    def := replace(def, 'public.private.', 'private.');
    execute def;
  end loop;
end $$;

drop function if exists public.is_org_member(uuid);
drop function if exists public.is_org_owner(uuid);
