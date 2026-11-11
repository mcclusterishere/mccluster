-- Assertion helpers for the scratch-database tests of the 2026-10-29 pending files
-- (scripts/test-schema-hygiene-db.sh). Test-only. They run as the calling role
-- (SECURITY INVOKER), so a statement is checked with that role's privileges and RLS.
create or replace function public.t_denied(p_sql text, p_message_like text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception using errcode = 'T0001', message = 'expected an error like "' || p_message_like || '" from: ' || p_sql;
exception
  when sqlstate 'T0001' then raise;
  when others then
    if sqlerrm not like p_message_like then
      raise exception 'expected "%" from: % ; got % %', p_message_like, p_sql, sqlstate, sqlerrm;
    end if;
end $$;

create or replace function public.t_count(p_sql text) returns bigint
language plpgsql as $$ declare n bigint; begin execute 'select count(*) from (' || p_sql || ') q' into n; return n; end $$;

create or replace function public.t_eq(p_actual anyelement, p_expected anyelement, p_what text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception '%: got %, expected %', p_what, p_actual, p_expected;
  end if;
end $$;

-- Act as a caller the way PostgREST does: the role, and the JWT claims auth.uid() reads.
create or replace function public.t_as(p_role text, p_sub text default null, p_email text default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('role', p_role, 'sub', p_sub, 'email', p_email)::text, false);
  execute format('set role %I', p_role);
end $$;

grant execute on function public.t_denied(text, text), public.t_count(text), public.t_eq(anyelement, anyelement, text),
  public.t_as(text, text, text) to public;

-- auth.jwt(), as Supabase defines it: the request's claims.
create or replace function auth.jwt() returns jsonb language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
grant execute on function auth.jwt() to anon, authenticated, service_role;

-- The verifier's ledger query (scripts/db/schema-queries.mjs) reads this; empty here.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations(version text primary key, name text, statements text[]);
