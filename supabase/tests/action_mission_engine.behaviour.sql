-- Behaviour tests for supabase/pending_migrations/action_network_gamification_v1.sql.
-- Runs against a scratch database (see scripts/test-mission-engine-db.sh), as the
-- real API roles, with the JWT claims Supabase would set. Every check raises on
-- failure, so ON_ERROR_STOP turns a broken rule into a failed run.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.as_user(p_id uuid, p_email text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', coalesce(p_email, p_id::text || '@test'), 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"anon"}', false); execute 'set role anon'; end $$;
create or replace function pg_temp.must_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm not ilike p_like then raise exception 'expected error like % from [%], got: %', p_like, p_sql, sqlerrm; end if;
    return;
  end;
  raise exception 'expected failure (%), but it succeeded: %', p_like, p_sql;
end $$;
create or replace function pg_temp.must_affect_none(p_sql text) returns void language plpgsql as $$
declare n integer;
begin
  begin execute p_sql; get diagnostics n = row_count;
  exception when insufficient_privilege then return; end;
  if n > 0 then raise exception 'write should have been blocked but changed % rows: %', n, p_sql; end if;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

-- fixtures (as the owner)
insert into auth.users values
 ('00000000-0000-4000-8000-00000000000a','a@test'),
 ('00000000-0000-4000-8000-00000000000b','b@test'),
 ('00000000-0000-4000-8000-0000000000ad','matthew@mccluster.org');
insert into public.m_people(id) values ('10000000-0000-4000-8000-00000000000a'),('10000000-0000-4000-8000-00000000000b'),('10000000-0000-4000-8000-0000000000ad');
insert into public.m_links values
 ('00000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-00000000000a'),
 ('00000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-00000000000b'),
 ('00000000-0000-4000-8000-0000000000ad','10000000-0000-4000-8000-0000000000ad');
insert into public.action_missions(id,title,difficulty,base_points,skills,status,capacity) values
 ('20000000-0000-4000-8000-000000000001','Register three neighbours',2,100,'{organizing,civic}','open',null),
 ('20000000-0000-4000-8000-000000000002','Draft mission',1,100,'{}','draft',null),
 ('20000000-0000-4000-8000-000000000003','One seat only',1,50,'{music}','open',1),
 ('20000000-0000-4000-8000-000000000004','Film the clean-up',1,100,'{creative}','open',null);
create temp table ids(k text primary key, v uuid);
grant all on ids to anon, authenticated;

-- ANON
select pg_temp.as_anon();
do $$ begin
  if (select count(*) from public.action_missions) <> 3 then raise exception 'anon should read exactly the 3 open missions'; end if;
end $$;
select pg_temp.must_fail($q$select public.join_action_mission('20000000-0000-4000-8000-000000000001')$q$, '%permission denied%');
select pg_temp.must_fail($q$select count(*) from public.action_mission_assignments$q$, '%permission denied%');
select pg_temp.must_fail($q$select count(*) from public.action_points_ledger$q$, '%permission denied%');
reset role;

-- PARTICIPANT A: can read, can join, cannot forge
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.must_fail($q$insert into public.action_mission_assignments(mission_id,user_id,m_uid,status) values ('20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-00000000000a','verified')$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.join_action_mission('20000000-0000-4000-8000-000000000002')$q$, '%not open%');
insert into ids select 'a1', (public.join_action_mission('20000000-0000-4000-8000-000000000001')->>'assignment_id')::uuid;
do $$ begin
  if (public.join_action_mission('20000000-0000-4000-8000-000000000001')->>'assignment_id')::uuid <> (select v from ids where k='a1') then raise exception 'joining twice must return the same assignment'; end if;
  if (select status from public.action_mission_assignments where id=(select v from ids where k='a1')) <> 'in_progress' then raise exception 'new assignment should be in_progress'; end if;
  if (select user_id from public.action_mission_assignments where id=(select v from ids where k='a1')) <> '00000000-0000-4000-8000-00000000000a' then raise exception 'server must set user_id'; end if;
end $$;
select pg_temp.must_affect_none($q$update public.action_mission_assignments set status='verified', verified_at=now()$q$);
select pg_temp.must_fail($q$insert into public.action_proofs(assignment_id,user_id,proof_type,statement,status) select v,'00000000-0000-4000-8000-00000000000a','text','I did it, trust me please','verified' from ids where k='a1'$q$, '%permission denied%');
select pg_temp.must_fail($q$insert into public.action_points_ledger(m_uid,kind,points,reason) values ('10000000-0000-4000-8000-00000000000a','mission',1000,'me')$q$, '%permission denied%');
select pg_temp.must_fail($q$insert into public.action_skill_progress(m_uid,skill,xp) values ('10000000-0000-4000-8000-00000000000a','organizing',9999)$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.review_action_proof(gen_random_uuid(),'verified',null)$q$, '%not authorized%');
-- proof rules
select pg_temp.must_fail($q$select public.submit_action_proof((select v from ids where k='a1'),'link','http://example.com/x','')$q$, '%https%');
select pg_temp.must_fail($q$select public.submit_action_proof((select v from ids where k='a1'),'text',null,'too short')$q$, '%20 characters%');
insert into ids select 'p1', (public.submit_action_proof((select v from ids where k='a1'),'link','https://example.com/proof-a','Knocked on doors and registered three neighbours.')->>'proof_id')::uuid;
do $$ begin
  if (select status from public.action_proofs where id=(select v from ids where k='p1')) <> 'pending' then raise exception 'proof must start pending'; end if;
  if (select status from public.action_mission_assignments where id=(select v from ids where k='a1')) <> 'submitted' then raise exception 'assignment must be submitted'; end if;
end $$;
select pg_temp.must_affect_none($q$update public.action_proofs set status='verified'$q$);
reset role;

-- PARTICIPANT B: cannot see or touch A's work, cannot reuse A's proof
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
do $$ begin
  if (select count(*) from public.action_mission_assignments) <> 0 then raise exception 'B must not see A''s assignment'; end if;
  if (select count(*) from public.action_proofs) <> 0 then raise exception 'B must not see A''s proof'; end if;
end $$;
select pg_temp.must_fail($q$select public.submit_action_proof((select v from ids where k='a1'),'text',null,'Submitting proof on someone else''s mission')$q$, '%assignment not found%');
select pg_temp.must_fail($q$select public.withdraw_action_mission((select v from ids where k='a1'))$q$, '%assignment not found%');
insert into ids select 'b1', (public.join_action_mission('20000000-0000-4000-8000-000000000001')->>'assignment_id')::uuid;
select pg_temp.must_fail($q$select public.submit_action_proof((select v from ids where k='b1'),'link','https://EXAMPLE.com/proof-a','Reusing the same link as someone else did')$q$, '%already been used%');
insert into ids select 'p2', (public.submit_action_proof((select v from ids where k='b1'),'text',null,'Ran a voter registration table for two hours.')->>'proof_id')::uuid;
-- uploads: only your own file counts, and once
reset role;
insert into public.network_media_assets(id,owner_m_uid,media_type) values
 ('30000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-00000000000a','video'),
 ('30000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-00000000000b','photo');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
insert into ids select 'b2', (public.join_action_mission('20000000-0000-4000-8000-000000000004')->>'assignment_id')::uuid;
select pg_temp.must_fail($q$select public.submit_action_proof((select v from ids where k='b2'),'video',null,'',jsonb_build_object('asset_id','30000000-0000-4000-8000-00000000000a'))$q$, '%not yours%');
do $$ declare r jsonb; begin
  r := public.submit_action_proof((select v from ids where k='b2'),'photo',null,'',jsonb_build_object('asset_id','30000000-0000-4000-8000-00000000000b','media_type','video','forged','x'));
  if (select metadata from public.action_proofs where id=(r->>'proof_id')::uuid) <> '{"asset_id": "30000000-0000-4000-8000-00000000000b", "media_type": "photo"}'::jsonb then raise exception 'server must record the upload''s real type and drop extra keys'; end if;
end $$;
-- capacity: B takes the only seat
select public.join_action_mission('20000000-0000-4000-8000-000000000003');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.must_fail($q$select public.join_action_mission('20000000-0000-4000-8000-000000000003')$q$, '%full%');
reset role;

-- ADMIN: verify once, reject awards nothing, retries do not double
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select pg_temp.must_fail($q$select public.review_action_proof((select v from ids where k='p1'),'approve',null)$q$, '%verified or rejected%');
do $$
declare r jsonb;
begin
  r := public.review_action_proof((select v from ids where k='p1'),'verified','Good work');
  if (r->>'awarded')::boolean is not true or (r->>'points')::int <> 115 then raise exception 'first verification should award 115, got %', r; end if;
  r := public.review_action_proof((select v from ids where k='p1'),'verified',null);
  if (r->>'idempotent')::boolean is not true or (r->>'awarded')::boolean then raise exception 'second verification must be a no-op, got %', r; end if;
  r := public.review_action_proof((select v from ids where k='p1'),'rejected',null);
  if (r->>'status') <> 'verified' then raise exception 'a verified proof must not flip to rejected, got %', r; end if;
  if (select count(*) from public.action_points_ledger where assignment_id=(select v from ids where k='a1')) <> 1 then raise exception 'exactly one award expected'; end if;
  if (select status from public.action_mission_assignments where id=(select v from ids where k='a1')) <> 'verified' then raise exception 'assignment should be verified'; end if;
  if (select xp from public.action_skill_progress where m_uid='10000000-0000-4000-8000-00000000000a' and skill='organizing') <> 58 then raise exception 'skill xp should be 58 (115 shared across 2 skills)'; end if;
  if (select verified_actions from public.action_skill_progress where m_uid='10000000-0000-4000-8000-00000000000a' and skill='civic') <> 1 then raise exception 'civic should count one verified action'; end if;
  r := public.review_action_proof((select v from ids where k='p2'),'rejected','No evidence attached');
  if (r->>'awarded')::boolean then raise exception 'rejection must not award'; end if;
  if (select count(*) from public.action_points_ledger where assignment_id=(select v from ids where k='b1')) <> 0 then raise exception 'rejected proof awarded points'; end if;
  if (select status from public.action_mission_assignments where id=(select v from ids where k='b1')) <> 'rejected' then raise exception 'assignment should be rejected'; end if;
end $$;
reset role;

-- Every review is immutable history and produces exactly one member notification.
do $$
begin
  if (select count(*) from public.action_proof_review_history where proof_id=(select v from ids where k='p1') and decision='verified') <> 1 then
    raise exception 'verified review should be archived exactly once';
  end if;
  if (select count(*) from public.action_proof_review_history where proof_id=(select v from ids where k='p2') and decision='rejected' and review_note='No evidence attached') <> 1 then
    raise exception 'rejected review and note should be archived exactly once';
  end if;
  if (select count(*) from public.network_notifications where recipient_m_uid='10000000-0000-4000-8000-00000000000a' and type='action_proof_review' and metadata->>'decision'='verified') <> 1 then
    raise exception 'verified member should receive one review notification';
  end if;
  if (select count(*) from public.network_notifications where recipient_m_uid='10000000-0000-4000-8000-00000000000b' and type='action_proof_review' and metadata->>'decision'='rejected') <> 1 then
    raise exception 'rejected member should receive one review notification';
  end if;
end $$;

-- A reads the Action Record; B can correct rejected proof without losing review history
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
do $$
declare r jsonb := public.action_record();
begin
  if (r->>'verified_actions')::int <> 1 or (r->>'points')::int <> 115 then raise exception 'record wrong: %', r; end if;
  if jsonb_array_length(r->'skills') <> 2 then raise exception 'record should list 2 skills: %', r; end if;
  if (select count(*) from public.action_proof_review_history) <> 1 then raise exception 'A should only see A review history'; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
do $$
declare r jsonb;
begin
  if (select count(*) from public.action_proof_review_history) <> 1 then raise exception 'B should only see B review history'; end if;
  if (select count(*) from public.network_notifications where type='action_proof_review' and metadata->>'decision'='rejected') <> 1 then raise exception 'B should see the rejection notification'; end if;
  r := public.submit_action_proof(
    (select v from ids where k='b1'),
    'text',
    null,
    'Corrected proof after the reviewer asked for stronger evidence.'
  );
  if coalesce((r->>'retry')::boolean,false) is not true then raise exception 'rejected resubmission should be marked as retry: %', r; end if;
  if (r->>'proof_id')::uuid <> (select v from ids where k='p2') then raise exception 'retry should reuse the active proof row while history preserves old evidence'; end if;
  if (select status from public.action_mission_assignments where id=(select v from ids where k='b1')) <> 'submitted' then raise exception 'retry assignment should return to submitted'; end if;
  if (select status from public.action_proofs where id=(select v from ids where k='p2')) <> 'pending' then raise exception 'retry proof should return to pending'; end if;
  if exists(select 1 from public.action_proofs where id=(select v from ids where k='p2') and (reviewer_uid is not null or review_note is not null or reviewed_at is not null)) then raise exception 'active retry proof must clear the previous review state'; end if;
  if (select count(*) from public.action_proof_review_history) <> 1 then raise exception 'retry must not erase or duplicate review history'; end if;
  if (select review_note from public.action_proof_review_history order by reviewed_at desc limit 1) <> 'No evidence attached' then raise exception 'retry must preserve the reviewer note in immutable history'; end if;
end $$;
reset role;

-- the receipt: verified only, no identity
select pg_temp.as_anon();
do $$
declare r jsonb := public.action_receipt((select v from ids where k='a1'));
begin
  if r->>'title' <> 'Register three neighbours' then raise exception 'receipt should name the mission: %', r; end if;
  if r ? 'user_id' or r ? 'm_uid' or r::text ilike '%example.com%' then raise exception 'receipt leaks identity or proof: %', r; end if;
  if public.action_receipt((select v from ids where k='b1')) is not null then raise exception 'unverified work must not have a receipt'; end if;
end $$;
reset role;

-- an admin cannot verify their own proof
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
insert into ids select 'ad1', (public.join_action_mission('20000000-0000-4000-8000-000000000001')->>'assignment_id')::uuid;
insert into ids select 'pad', (public.submit_action_proof((select v from ids where k='ad1'),'text',null,'The admin trying to approve their own work.')->>'proof_id')::uuid;
select pg_temp.must_fail($q$select public.review_action_proof((select v from ids where k='pad'),'verified',null)$q$, '%your own proof%');
reset role;

-- withdraw sets the pending proof aside; rejoining lets the member submit again
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
do $$ declare a uuid := (select v from ids where k='b2'); begin
  perform public.withdraw_action_mission(a);
  if (select status from public.action_proofs where assignment_id=a) <> 'rejected' then raise exception 'withdrawn proof should be set aside'; end if;
  if (select reviewed_at from public.action_proofs where assignment_id=a) is not null then raise exception 'withdrawal is not a review'; end if;
  perform public.join_action_mission('20000000-0000-4000-8000-000000000004');
  perform public.submit_action_proof(a,'text',null,'Back again with a clean write-up of the work.');
  if (select status from public.action_proofs where assignment_id=a) <> 'pending' then raise exception 'resubmitted proof should be pending'; end if;
end $$;
reset role;

select 'ALL MISSION ENGINE BEHAVIOUR CHECKS PASSED' as result;
