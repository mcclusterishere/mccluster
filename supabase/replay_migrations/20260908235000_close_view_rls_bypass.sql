-- RLS bypass through a writable projection view.
--
-- public.eu_profiles_public is a plain single-table SELECT over eu_profiles
-- with a WHERE clause, which makes it AUTO-UPDATABLE: Postgres will happily
-- route INSERT/UPDATE/DELETE through it to the base table. The view is owned
-- by `postgres` and does not set security_invoker, so it executes with the
-- OWNER's rights, and eu_profiles has RLS enabled but not FORCED — meaning
-- RLS is not applied to its owner. `anon` was granted INSERT, UPDATE, DELETE
-- and TRUNCATE on the view.
--
-- Chained together, an unauthenticated caller could write to eu_profiles
-- through the view with no policy ever consulted. Proven by running the same
-- statement as `anon` against both objects:
--
--   via table public.eu_profiles        -> 42501 new row violates
--                                          row-level security policy
--   via view  public.eu_profiles_public -> 23503 foreign key violation
--
-- Reaching the foreign key means RLS was skipped entirely; only the FK to
-- auth.users stopped the insert. UPDATE and DELETE have no such barrier, so
-- an anonymous caller could have edited or deleted any published profile.
-- eu_profiles is empty today, so nothing was lost.
--
-- The other three projection views are not auto-updatable, so writes through
-- them already failed — but they carry the same pointless grants, and
-- "not auto-updatable" is a property of the current SELECT list, not a
-- guarantee. Adding a column or simplifying a CASE could quietly make one
-- writable later.
--
-- Fix: these are read-only projections. They get SELECT and nothing else.
--
-- security_invoker is deliberately NOT enabled here. Running as owner is the
-- whole point of a `_public` view: it exposes the rows an anonymous visitor
-- is meant to see (visibility='public' and status='active') from a table
-- whose policies otherwise only address `authenticated`. Turning it on would
-- empty the public profile directory. Owner-rights SELECT is the design;
-- owner-rights WRITE was the bug.

-- Applied to every view in `public`, not the four found by hand: the bug is a
-- class, and the next projection view added would inherit it. Views that
-- accept writes through INSTEAD OF triggers are left alone — those are
-- deliberate write surfaces, and the catalog can tell them apart.

do $$
declare
  v record;
begin
  for v in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join information_schema.views iv
        on iv.table_schema = 'public' and iv.table_name = c.relname
     where c.relkind = 'v'
       and iv.is_trigger_insertable_into = 'NO'
       and iv.is_trigger_updatable = 'NO'
       and iv.is_trigger_deletable = 'NO'
       and exists (
         select 1 from information_schema.role_table_grants g
          where g.table_schema = 'public'
            and g.table_name = c.relname
            and g.grantee in ('anon','authenticated')
            and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
       )
  loop
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated',
      v.relname
    );
  end loop;
end $$;

-- The four views this started from must still be readable by the browser.
grant select on public.eu_profiles_public, public.eu_perspectives_public,
                public.eu_counts, public.shake_open_window to anon, authenticated;

-- A projection view must never again be writable by a browser role.
do $$
declare
  leftover text;
begin
  select string_agg(distinct g.table_name || ' (' || g.grantee || ':' || g.privilege_type || ')', ', ')
    into leftover
    from information_schema.role_table_grants g
    join pg_class c on c.relname = g.table_name
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   join information_schema.views iv
     on iv.table_schema = 'public' and iv.table_name = c.relname
   where g.table_schema = 'public'
     and c.relkind = 'v'
     and iv.is_trigger_insertable_into = 'NO'
     and iv.is_trigger_updatable = 'NO'
     and iv.is_trigger_deletable = 'NO'
     and g.grantee in ('anon','authenticated')
     and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  if leftover is not null then
    raise exception 'browser roles still hold write privileges on views: %', leftover;
  end if;
end $$;
