-- What every caller can read and write through the policies of
-- supabase/tests/rls_initplan_select_wrap_v1.stub.sql, recorded under phase :'phase' in
-- public.t_access. scripts/test-schema-hygiene-db.sh runs it with production's expressions
-- ('before'), after the select-wrap rewrite ('after') and after its rollback ('rollback'),
-- and requires the three to be identical. Every write is tried in a sub-transaction and
-- undone, so each probe sees the same data.
\set ON_ERROR_STOP 1
create table if not exists public.t_access(phase text, who text, probe text, outcome text);
grant insert, select on public.t_access to anon, authenticated;

-- 'ok:<rows>' or the SQLSTATE; the statement's effects are always rolled back.
create or replace function public.t_try(p_sql text) returns text language plpgsql as $$
declare n bigint;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
    raise exception using errcode = 'T0002', message = n::text;
  exception
    when sqlstate 'T0002' then return 'ok:' || sqlerrm;
    when others then return sqlstate;
  end;
end $$;
create or replace function public.t_seen(p_table text) returns text language plpgsql as $$
declare h text;
begin
  execute format('select count(*) || '':'' || md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')) from public.%I t', p_table) into h;
  return h;
end $$;
grant execute on function public.t_try(text), public.t_seen(text) to anon, authenticated;

create or replace function public.t_probe(p_phase text, p_who text) returns void language plpgsql as $$
declare
  t text;
  probes text[][] := array[
    ['prim3 insert own',      $q$insert into public.prim3_course_progress values ('11111111-1111-4111-8111-111111111111', 'x')$q$],
    ['prim3 insert other',    $q$insert into public.prim3_course_progress values ('33333333-3333-4333-8333-333333333333', 'x')$q$],
    ['prim3 update all',      $q$update public.prim3_course_progress set lesson = lesson || '!'$q$],
    ['prim3 delete all',      $q$delete from public.prim3_course_progress$q$],
    ['comment as A',          $q$insert into public.comments(uid, body) values ('11111111-1111-4111-8111-111111111111', 'hi')$q$],
    ['comment sweep',         $q$update public.comments set hidden = true$q$],
    ['comment take back',     $q$delete from public.comments$q$],
    ['campaign write',        $q$insert into public.campaigns(note) values ('x')$q$],
    ['campaign update',       $q$update public.campaigns set note = 'y'$q$],
    ['offer insert as A',     $q$insert into public.creator_service_offers(m_uid, status, title) values ('a0000000-0000-4000-8000-00000000000a', 'draft', 'x')$q$],
    ['offer insert as B',     $q$insert into public.creator_service_offers(m_uid, status, title) values ('b0000000-0000-4000-8000-00000000000b', 'draft', 'x')$q$],
    ['offer update all',      $q$update public.creator_service_offers set title = title || '!'$q$],
    ['offer delete all',      $q$delete from public.creator_service_offers$q$],
    ['fellowship host add',   $q$insert into public.eu_fellowships(status, created_by, source) values ('pending', '11111111-1111-4111-8111-111111111111', 'host')$q$],
    ['fellowship edit all',   $q$update public.eu_fellowships set source = source$q$]
  ];
begin
  foreach t in array array['prim3_course_progress','comments','campaigns','creator_service_offers','eu_fellowships','events','network_activity'] loop
    insert into public.t_access values (p_phase, p_who, 'read ' || t, public.t_seen(t));
  end loop;
  for i in 1 .. array_length(probes, 1) loop
    insert into public.t_access values (p_phase, p_who, probes[i][1], public.t_try(probes[i][2]));
  end loop;
end $$;
grant execute on function public.t_probe(text, text) to anon, authenticated;

select t_as('anon');                                                             select t_probe(:'phase', 'anon');   reset role;
select t_as('authenticated', '11111111-1111-4111-8111-111111111111');            select t_probe(:'phase', 'A');      reset role;
select t_as('authenticated', '33333333-3333-4333-8333-333333333333');            select t_probe(:'phase', 'B');      reset role;
select t_as('authenticated', '44444444-4444-4444-8444-444444444444', 'matthew@mccluster.org'); select t_probe(:'phase', 'desk'); reset role;
