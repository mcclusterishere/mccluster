-- The 2026-08 Equity Uprise surface granted browser write privileges more
-- broadly than the public product needs.
--
-- Base tables have RLS, but privileges should still be least-authority. More
-- importantly, projection views may be auto-updatable and can execute with
-- their owner's rights, so leaving INSERT/UPDATE/DELETE on an EU view is not
-- merely redundant: it can become an RLS bypass.
--
-- The invariant for the anonymous role is therefore simple and stronger than
-- the original hand-maintained table list: every public eu_* relation is
-- read-only to anon. SELECT is untouched.
--
-- authenticated is handled separately by the following view-hardening
-- migration because legacy authenticated base-table writes are still used by
-- older UI paths. This migration only strips anon mutation privileges.

do $$
declare
  r record;
begin
  for r in
    select distinct c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join information_schema.role_table_grants g
        on g.table_schema = n.nspname and g.table_name = c.relname
     where n.nspname = 'public'
       and c.relname like 'eu\_%'
       and c.relkind in ('r','p','v','m')
       and g.grantee = 'anon'
       and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on public.%I from anon',
      r.relname
    );
  end loop;
end $$;

-- Prove no anonymous write privilege survives on any public eu_* relation,
-- including views. Keeping this assertion broad is deliberate: if a future EU
-- object becomes writable to anon, the migration chain should stop here.
do $$
declare
  leftover text;
begin
  select string_agg(distinct table_name || ':' || privilege_type, ', ' order by table_name || ':' || privilege_type)
    into leftover
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name like 'eu\_%'
     and grantee = 'anon'
     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');

  if leftover is not null then
    raise exception 'anon still holds write privileges on: %', leftover;
  end if;
end $$;
