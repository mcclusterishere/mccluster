-- supabase/migrations/20261029011001_definer_views_invoker_v1.sql keeps every public row:
-- what anon and a signed-in member read from v_track_signals, v_track_affinity and
-- media_public_world_feed is hashed before the file, the file is applied (psql variable
-- :pending), and the same reads must hash the same after, with the views now
-- security_invoker. Then the rollback (:rollback) must restore production's definer views
-- with the same rows again. One psql session (scripts/test-schema-hygiene-db.sh).
\set ON_ERROR_STOP 1
create or replace function public.t_rows(p_view text) returns text language plpgsql as $$
declare h text; n bigint;
begin
  execute format('select md5(coalesce(string_agg(t::text, ''|'' order by t::text), '''')), count(*) from public.%I t', p_view) into h, n;
  return n || ':' || h;
end $$;
grant execute on function public.t_rows(text) to anon, authenticated;

create table public.t_seen(phase text, who text, view text, rows text);
grant insert, select on public.t_seen to anon, authenticated;

create or replace function public.t_look(p_phase text, p_who text) returns void language plpgsql as $$
begin
  insert into public.t_seen select p_phase, p_who, v, public.t_rows(v)
    from unnest(array['v_track_signals', 'v_track_affinity', 'media_public_world_feed']) v;
end $$;
grant execute on function public.t_look(text, text) to anon, authenticated;

select t_as('anon');                                   select t_look('before', 'anon');      reset role;
select t_as('authenticated', '11111111-1111-4111-8111-111111111111'); select t_look('before', 'member'); reset role;

begin;
\i :pending
commit;

select t_eq(coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), ''), 'true', c.relname || ' is security_invoker')
  from pg_class c where c.oid in ('public.v_track_signals'::regclass, 'public.v_track_affinity'::regclass, 'public.media_public_world_feed'::regclass);
select t_eq(p.prosecdef and p.proconfig = array['search_path=""'], true, p.proname || ' is SECURITY DEFINER with an empty search_path')
  from pg_proc p where p.oid in ('private.track_signals_rows()'::regprocedure, 'private.track_affinity_rows()'::regprocedure, 'private.media_public_world_feed_rows()'::regprocedure);
select t_eq(has_table_privilege('anon', 'public.media_public_world_feed', 'DELETE') or has_table_privilege('authenticated', 'public.media_public_world_feed', 'INSERT'), false, 'nobody writes the news view');
select t_eq(obj_description('public.v_track_signals'::regclass, 'pg_class') is not null, true, 'the view keeps its comment');

select t_as('anon');                                   select t_look('after', 'anon');      reset role;
select t_as('authenticated', '11111111-1111-4111-8111-111111111111'); select t_look('after', 'member'); reset role;
-- anon still cannot read the owner-only table directly
select t_as('anon');
select t_denied('select 1 from public.events', 'permission denied for table events');
reset role;

begin;
\i :rollback
commit;
select t_eq(coalesce((select option_value from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), ''), '', c.relname || ' is a definer view again')
  from pg_class c where c.oid in ('public.v_track_signals'::regclass, 'public.v_track_affinity'::regclass, 'public.media_public_world_feed'::regclass);
select t_eq(to_regprocedure('private.track_signals_rows()') is null, true, 'rollback drops the functions');
select t_as('anon');                                   select t_look('rollback', 'anon');      reset role;
select t_as('authenticated', '11111111-1111-4111-8111-111111111111'); select t_look('rollback', 'member'); reset role;

-- every phase saw the same rows, and the public rows are really there
select t_eq(count(distinct rows), 1::bigint, who || ' ' || view || ' rows are the same before, after and after rollback')
  from public.t_seen group by who, view;
select t_eq(split_part(rows, ':', 1)::int > 0, true, who || ' ' || view || ' has rows') from public.t_seen where phase = 'after';
drop table public.t_seen;
select 'definer_views_invoker_v1: ok' as result;
