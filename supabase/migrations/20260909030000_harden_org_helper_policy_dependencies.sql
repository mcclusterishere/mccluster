-- Finalize the org-helper security boundary after historical replay.
--
-- Historical migrations after 0031 still referenced public/unqualified
-- is_org_member() and is_org_owner(). 0064 temporarily restores wrappers so
-- those files can replay from zero. This terminal migration moves every RLS
-- policy dependency back onto the private helpers, preserves each policy's
-- command/roles/permissiveness, verifies the rewrite, then drops the public
-- wrappers WITHOUT CASCADE.

create schema if not exists private;

do $$
declare
  r record;
  def text;
  role_sql text;
begin
  for r in
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (
         coalesce(qual, '') like '%is_org_member(%'
         or coalesce(with_check, '') like '%is_org_member(%'
         or coalesce(qual, '') like '%is_org_owner(%'
         or coalesce(with_check, '') like '%is_org_owner(%'
       )
     order by tablename, policyname
  loop
    select string_agg(quote_ident(x::text), ', ' order by x::text)
      into role_sql
      from unnest(r.roles) as x;

    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);

    def := format(
      'create policy %I on %I.%I as %s for %s to %s',
      r.policyname,
      r.schemaname,
      r.tablename,
      case when upper(coalesce(r.permissive, 'PERMISSIVE')) = 'RESTRICTIVE' then 'restrictive' else 'permissive' end,
      lower(r.cmd),
      coalesce(nullif(role_sql, ''), 'public')
    );

    if r.qual is not null then
      def := def || ' using (' || r.qual || ')';
    end if;
    if r.with_check is not null then
      def := def || ' with check (' || r.with_check || ')';
    end if;

    -- Normalize public, private and unqualified historical spellings through
    -- one pass, then repair the deliberate double-prefix produced for already
    -- qualified expressions.
    def := replace(def, 'is_org_member(', 'private.is_org_member(');
    def := replace(def, 'is_org_owner(',  'private.is_org_owner(');
    def := replace(def, 'public.private.is_org_member(', 'private.is_org_member(');
    def := replace(def, 'public.private.is_org_owner(',  'private.is_org_owner(');
    def := replace(def, 'private.private.is_org_member(', 'private.is_org_member(');
    def := replace(def, 'private.private.is_org_owner(',  'private.is_org_owner(');

    execute def;
  end loop;
end $$;

-- Refuse to remove the compatibility wrappers if any policy still names a
-- public/unqualified helper. This is intentionally a hard failure: CASCADE is
-- not acceptable here because it could silently delete authorization policy.
do $$
begin
  if exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and (
         replace(replace(coalesce(qual, ''), 'private.is_org_member(', ''), 'private.is_org_owner(', '') like '%is_org_member(%'
         or replace(replace(coalesce(with_check, ''), 'private.is_org_member(', ''), 'private.is_org_owner(', '') like '%is_org_member(%'
         or replace(replace(coalesce(qual, ''), 'private.is_org_member(', ''), 'private.is_org_owner(', '') like '%is_org_owner(%'
         or replace(replace(coalesce(with_check, ''), 'private.is_org_member(', ''), 'private.is_org_owner(', '') like '%is_org_owner(%'
       )
  ) then
    raise exception 'org helper policy rewrite incomplete; public wrappers will not be dropped';
  end if;
end $$;

-- No CASCADE. If a non-policy object still depends on a public wrapper the
-- migration must stop and surface that dependency explicitly.
drop function if exists public.is_org_member(uuid);
drop function if exists public.is_org_owner(uuid);

-- Assert the final API surface really is gone.
do $$
begin
  if to_regprocedure('public.is_org_member(uuid)') is not null
     or to_regprocedure('public.is_org_owner(uuid)') is not null then
    raise exception 'public org helper RPC surface still exists after hardening';
  end if;
end $$;
