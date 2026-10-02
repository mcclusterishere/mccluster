-- Behaviour tests for supabase/migrations/20261002063754_action_network_fellowship_v1.sql,
-- run after action_mission_engine.behaviour.sql in the same scratch database.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.as_user(p_id uuid, p_email text default null) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', coalesce(p_email, p_id::text || '@test'), 'role', 'authenticated')::text, false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.must_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then
  if sqlerrm not ilike p_like then raise exception 'expected % from [%], got: %', p_like, p_sql, sqlerrm; end if; return; end;
  raise exception 'expected failure (%) but it succeeded: %', p_like, p_sql; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- A has 1 verified action from the mission engine tests: not eligible yet
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
do $$ declare s jsonb := public.action_fellowship_status(); begin
  if (s->>'eligible')::boolean or (s->>'verified_actions')::int <> 1 or (s->>'needed')::int <> 3 then raise exception 'status wrong: %', s; end if;
end $$;
select pg_temp.must_fail($q$select public.apply_for_fellowship('I want to organise my block and run registration drives every month.')$q$, '%after 3 verified actions; you have 1%');
select pg_temp.must_fail($q$insert into public.action_fellowship_applications(user_id,m_uid,why,verified_actions_at_apply) values ('00000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-00000000000a', repeat('x',50), 9)$q$, '%permission denied%');
reset role;

-- two more verified missions for A, through the real flow
insert into public.action_missions(id,title,status,skills) values
 ('20000000-0000-4000-8000-0000000000a5','Second mission','open','{civic}'),
 ('20000000-0000-4000-8000-0000000000a6','Third mission','open','{civic}');
create temp table f(k text primary key, v uuid); grant all on f to authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
insert into f select 'j5', (public.join_action_mission('20000000-0000-4000-8000-0000000000a5')->>'assignment_id')::uuid;
insert into f select 'j6', (public.join_action_mission('20000000-0000-4000-8000-0000000000a6')->>'assignment_id')::uuid;
insert into f select 'p5', (public.submit_action_proof((select v from f where k='j5'),'text',null,'Second piece of verified work done here.')->>'proof_id')::uuid;
insert into f select 'p6', (public.submit_action_proof((select v from f where k='j6'),'text',null,'Third piece of verified work done here.')->>'proof_id')::uuid;
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.review_action_proof((select v from f where k='p5'),'verified',null);
select public.review_action_proof((select v from f where k='p6'),'verified',null);
reset role;

-- now eligible: one application, then no second while it is open
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.must_fail($q$select public.apply_for_fellowship('too short')$q$, '%at least 40 characters%');
insert into f select 'app', (public.apply_for_fellowship('I want to organise my block and run registration drives every month.','A monthly table at the library.',6)->>'application_id')::uuid;
do $$ declare s jsonb := public.action_fellowship_status(); begin
  if not (s->>'eligible')::boolean or s->'application'->>'status' <> 'submitted' then raise exception 'status after apply wrong: %', s; end if;
  if (select verified_actions_at_apply from public.action_fellowship_applications where id=(select v from f where k='app')) <> 3 then raise exception 'server must record the real count'; end if;
end $$;
select pg_temp.must_fail($q$select public.apply_for_fellowship('Applying a second time while the first one is still open.')$q$, '%already have an application%');
select pg_temp.must_fail($q$select public.review_fellowship_application((select v from f where k='app'),'accepted',null)$q$, '%not authorized%');
reset role;

-- B cannot see A's application
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
do $$ begin if exists (select 1 from public.action_fellowship_applications) then raise exception 'B sees A''s application'; end if; end $$;
reset role;

-- the desk decides once
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select pg_temp.must_fail($q$select public.review_fellowship_application((select v from f where k='app'),'maybe',null)$q$, '%accepted or declined%');
do $$ declare r jsonb; begin
  r := public.review_fellowship_application((select v from f where k='app'),'accepted','Welcome in.');
  if r->>'status' <> 'accepted' then raise exception 'accept failed: %', r; end if;
  r := public.review_fellowship_application((select v from f where k='app'),'declined',null);
  if r->>'status' <> 'accepted' or not (r->>'idempotent')::boolean then raise exception 'second review must not change the decision: %', r; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.must_fail($q$select public.apply_for_fellowship('Trying to apply again after already being accepted as a fellow.')$q$, '%already a fellow%');
do $$ begin if (public.action_fellowship_status()->'application'->>'review_note') <> 'Welcome in.' then raise exception 'member should see the note'; end if; end $$;
reset role;

select 'ALL FELLOWSHIP BEHAVIOUR CHECKS PASSED' as result;
