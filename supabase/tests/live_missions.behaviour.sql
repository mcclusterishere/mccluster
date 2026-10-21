-- Behaviour tests for supabase/pending/live_missions_v1.sql.
-- Runs on a scratch database (scripts/test-live-missions-db.sh) as the real
-- API roles with the JWT claims Supabase would set. Every check raises on
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
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"service_role"}', false); execute 'set role service_role'; end $$;
create or replace function pg_temp.must_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm not ilike p_like then raise exception 'expected error like % from [%], got: %', p_like, p_sql, sqlerrm; end if;
    return;
  end;
  raise exception 'expected failure (%), but it succeeded: %', p_like, p_sql;
end $$;
create or replace function pg_temp.ok(p_ok boolean, p_what text) returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FAILED: %', p_what; end if; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

create temp table ids(k text primary key, v uuid);
grant all on ids to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixtures (owner)
insert into auth.users values
 ('00000000-0000-4000-8000-00000000000a','a@test'),
 ('00000000-0000-4000-8000-00000000000b','b@test'),
 ('00000000-0000-4000-8000-0000000000ad','matthew@mccluster.org');
insert into public.m_people(id) values ('10000000-0000-4000-8000-00000000000a'),('10000000-0000-4000-8000-00000000000b'),('10000000-0000-4000-8000-0000000000ad');
insert into public.m_links values
 ('00000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-00000000000a'),
 ('00000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-00000000000b'),
 ('00000000-0000-4000-8000-0000000000ad','10000000-0000-4000-8000-0000000000ad');
insert into public.action_campaigns(id) values ('civic');
-- a mission that existed BEFORE the file: re-run the backfill the file does
insert into public.action_missions(id,campaign_id,title,status) values
 ('20000000-0000-4000-8000-000000000001','civic','Help a person','open'),
 ('20000000-0000-4000-8000-000000000002','civic','Cover the mayor''s speech','open'),
 ('20000000-0000-4000-8000-000000000003','civic','Show up to a rally','open');
insert into public.action_mission_assignments(id,mission_id,user_id,m_uid,status) values
 ('30000000-0000-4000-8000-00000000000a','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-00000000000a','joined'),
 ('30000000-0000-4000-8000-00000000000b','20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-00000000000b','joined'),
 ('30000000-0000-4000-8000-0000000000c1','20000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-00000000000b','joined'),
 ('30000000-0000-4000-8000-0000000000c2','20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-00000000000a','joined');

-- L1 owner decision: live REQUIRED on every mission, existing and new
select pg_temp.ok((select count(*) from public.action_mission_live_policies where live_mode = 'required') = 3, 'L1 every mission defaults to required');
select pg_temp.ok(not exists (select 1 from public.action_mission_live_policies where live_mode <> 'required'), 'L1 no mission ships allowed/not_allowed');
select pg_temp.ok((select max_single_gap_seconds = 60 and resume_window_minutes = 10 and min_duration_seconds = 300 and pin_delay_seconds = 120
                      from public.action_mission_live_policies where mission_id = '20000000-0000-4000-8000-000000000001'), 'L1 default tolerances');

-- ---------------------------------------------------------------- L2 anon
select pg_temp.as_anon();
select pg_temp.ok((public.action_live_now_public()->>'total_live')::int = 0, 'L2 anon reads live-now');
select pg_temp.must_fail($q$select count(*) from public.action_live_sessions$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.action_live_open('30000000-0000-4000-8000-00000000000a','v1','{"adult":true,"minors_rule":true,"recording_rules":true}')$q$, '%permission denied%');
reset role;

-- ---------------------------------------------------------------- L3 opening a run
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select pg_temp.must_fail($q$select public.action_live_open('30000000-0000-4000-8000-00000000000a','v1','{"adult":true,"minors_rule":true,"recording_rules":true}')$q$, '%assignment not found%');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.must_fail($q$select public.action_live_open('30000000-0000-4000-8000-00000000000a','v1','{"adult":true,"minors_rule":false,"recording_rules":true}')$q$, '%confirm the three live rules%');
insert into ids select 'sa', (public.action_live_open('30000000-0000-4000-8000-00000000000a','v1',
  '{"adult":true,"minors_rule":true,"recording_rules":true}','kept_off_camera','city_pin')->>'session_id')::uuid;
select pg_temp.must_fail($q$select public.action_live_open('30000000-0000-4000-8000-0000000000c2','v1','{"adult":true,"minors_rule":true,"recording_rules":true}')$q$, '%already have a live mission running%');
select pg_temp.ok((select status from public.action_mission_assignments where id = '30000000-0000-4000-8000-00000000000a') = 'in_progress', 'L3 assignment in progress');

-- L4 members never read the Stream columns
select pg_temp.ok((select status from public.action_live_sessions where id = (select v from ids where k='sa')) = 'starting', 'L4 owner reads own status');
select pg_temp.must_fail($q$select cf_input_uid from public.action_live_sessions$q$, '%permission denied%');
select pg_temp.must_fail($q$select whep_url from public.action_live_sessions$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.action_live_attach((select v from ids where k='sa'),'x','y','Hartford','CT','US',41.7637,-72.6851)$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.action_live_observe((select v from ids where k='sa'),'connected',now(),'webhook','evt-forged-1')$q$, '%permission denied%');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select pg_temp.ok((select count(*) from public.action_live_sessions) = 0, 'L4 B cannot see A''s run');
reset role;

-- L5 the Worker attaches the input and a coarse place (0.1 degree cell)
select pg_temp.as_service();
select public.action_live_attach((select v from ids where k='sa'),'inputA','https://customer-x.cloudflarestream.com/inputA/webRTC/play','Hartford','Connecticut','US',41.76371,-72.68509);
reset role;
select pg_temp.ok((select cell_lat = 41.8 and cell_lng = -72.7 from public.action_live_sessions where id = (select v from ids where k='sa')), 'L5 coordinates snapped to a 0.1-degree cell');

-- L6 webhook observations; replays count once
select pg_temp.as_service();
select pg_temp.ok((public.action_live_observe((select v from ids where k='sa'),'connected',now() - interval '20 minutes','webhook','inputA:connected:1')->>'status') = 'live', 'L6 connected -> live');
select pg_temp.ok((public.action_live_observe((select v from ids where k='sa'),'connected',now() - interval '20 minutes','webhook','inputA:connected:1')->>'duplicate') = 'true', 'L6 replayed event is a duplicate');
reset role;
select pg_temp.ok((select count(*) from public.action_live_segments where session_id = (select v from ids where k='sa')) = 1, 'L6 one segment after replay');
select pg_temp.ok((select evidence from public.action_live_sessions where id = (select v from ids where k='sa')) = 'webhook', 'L6 evidence switches to webhook');

-- L7 continuity: a 30 s blip is tolerated; a heartbeat cannot open a segment once webhooks speak
select pg_temp.as_service();
select public.action_live_observe((select v from ids where k='sa'),'disconnected',now() - interval '15 minutes','webhook','inputA:disconnected:1');
select pg_temp.ok((select status from public.action_live_sessions where id = (select v from ids where k='sa')) = 'interrupted', 'L7 disconnected -> interrupted');
select public.action_live_observe((select v from ids where k='sa'),'heartbeat',now() - interval '14 minutes 45 seconds','heartbeat',null);
select pg_temp.ok((select count(*) from public.action_live_segments where session_id = (select v from ids where k='sa') and disconnected_at is null) = 0, 'L7 heartbeat does not reopen a webhook-evidenced run');
select public.action_live_observe((select v from ids where k='sa'),'connected',now() - interval '14 minutes 30 seconds','webhook','inputA:connected:2');
reset role;
select pg_temp.ok((public.action_live_eval((select v from ids where k='sa'))->>'state') = 'continuous', 'L7 one 30 s blip stays continuous');

-- L8 the public globe: city cells only, after the pin delay, never hidden runs
select pg_temp.as_anon();
select pg_temp.ok((public.action_live_now_public()->>'total_live')::int = 1, 'L8 one live pin');
select pg_temp.ok((select array_agg(k order by k) from jsonb_object_keys(public.action_live_now_public()->'cells'->0) k)
  = array['city','country','lat','live_count','lng','missions','region'], 'L8 a cell carries only city fields');
select pg_temp.ok((public.action_live_now_public()->'cells'->0->>'lat')::numeric = 41.8, 'L8 cell centre, not the raw point');
select pg_temp.ok(public.action_live_now_public()::text not like '%inputA%' and public.action_live_now_public()::text not like '%00000000-0000-4000-8000-00000000000a%', 'L8 no input or member ids');
reset role;
update public.action_live_sessions set first_connected_at = now() - interval '30 seconds' where id = (select v from ids where k='sa');
select pg_temp.ok((public.action_live_now_public()->>'total_live')::int = 0, 'L8 pin waits for its delay');
update public.action_live_sessions set first_connected_at = now() - interval '20 minutes', globe_visibility = 'hidden' where id = (select v from ids where k='sa');
select pg_temp.ok((public.action_live_now_public()->>'total_live')::int = 0, 'L8 hidden run has no pin');
update public.action_live_sessions set globe_visibility = 'city_pin' where id = (select v from ids where k='sa');

-- L9 "Mission complete" files a PENDING proof; nothing is verified
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select pg_temp.must_fail($q$select public.action_live_complete((select v from ids where k='sa'))$q$, '%session not found%');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.ok((public.action_live_mark_third_party((select v from ids where k='sa'),'consented_on_camera')->>'third_party_mode') = 'consented_on_camera', 'L9 helped person agreed on camera');
select pg_temp.ok((public.action_live_complete((select v from ids where k='sa'), 'Walked Ms. R to the clinic')->>'proof_status') = 'pending', 'L9 completion files a pending proof');
reset role;
select pg_temp.ok((select status from public.action_proofs where assignment_id = '30000000-0000-4000-8000-00000000000a') = 'pending', 'L9 proof pending');
select pg_temp.ok((select status from public.action_mission_assignments where id = '30000000-0000-4000-8000-00000000000a') = 'submitted', 'L9 assignment submitted, not verified');
select pg_temp.ok((select status from public.action_live_sessions where id = (select v from ids where k='sa')) = 'completed', 'L9 run completed');
select pg_temp.ok((select jsonb_array_length(third_party_marks) from public.action_live_sessions where id = (select v from ids where k='sa')) = 1, 'L9 third-party mark kept');

-- L10 only an admin verifies; the member cannot
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.must_fail($q$select public.review_action_proof((select id from public.action_proofs where assignment_id='30000000-0000-4000-8000-00000000000a'),'verified',null)$q$, '%not authorized%');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad','matthew@mccluster.org');
select public.review_action_proof((select id from public.action_proofs where assignment_id='30000000-0000-4000-8000-00000000000a'),'verified','Watched the recording');
reset role;
select pg_temp.ok((select status from public.action_mission_assignments where id = '30000000-0000-4000-8000-00000000000a') = 'verified', 'L10 admin verified');

-- L11 too short: the run is still going but completion refuses
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
insert into ids select 'sshort', (public.action_live_open('30000000-0000-4000-8000-0000000000c2','v1','{"adult":true,"minors_rule":true,"recording_rules":true}')->>'session_id')::uuid;
reset role;
select pg_temp.as_service();
select public.action_live_attach((select v from ids where k='sshort'),'inputS','w','Atlanta','Georgia','US',33.749,-84.388);
select public.action_live_observe((select v from ids where k='sshort'),'connected',now() - interval '1 minute','webhook','inputS:connected:1');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.must_fail($q$select public.action_live_complete((select v from ids where k='sshort'))$q$, '%stay live a little longer%');
select pg_temp.ok((select status from public.action_live_sessions where id = (select v from ids where k='sshort')) = 'live', 'L11 run still live after refused completion');
select public.action_live_abandon((select v from ids where k='sshort'));
reset role;

-- L12 continuity rules (eval only; segments set directly)
create temp table cases(k text, sid uuid);
insert into public.action_mission_assignments(id,mission_id,user_id,m_uid,status) values
 ('30000000-0000-4000-8000-0000000000e1','20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-00000000000b','joined');
do $$
declare v uuid; i int;
begin
  for i in 1..4 loop
    insert into public.action_live_sessions(assignment_id,mission_id,user_id,status,consent_version,attest_adult,attest_minors_rule,attest_recording_rules,evidence)
    values ('30000000-0000-4000-8000-0000000000e1','20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-00000000000b','completed','v1',true,true,true,'webhook')
    returning id into v;
    insert into cases values ('c'||i, v);
  end loop;
end $$;
-- c1: one 2-minute gap (> 60 s, < 10 min) -> resumed
insert into public.action_live_segments(session_id,connected_at,disconnected_at,source)
select sid, t, t2, 'webhook' from cases, (values (timestamptz '2026-10-17 10:00Z', timestamptz '2026-10-17 10:20Z'),(timestamptz '2026-10-17 10:22Z', timestamptz '2026-10-17 10:40Z')) x(t,t2) where k='c1';
-- c2: two 2-minute gaps -> broken (too many resumes)
insert into public.action_live_segments(session_id,connected_at,disconnected_at,source)
select sid, t, t2, 'webhook' from cases, (values ('2026-10-17 10:00Z'::timestamptz,'2026-10-17 10:20Z'::timestamptz),('2026-10-17 10:22Z','2026-10-17 10:30Z'),('2026-10-17 10:32Z','2026-10-17 10:40Z')) x(t,t2) where k='c2';
-- c3: one 11-minute gap -> broken (resume window)
insert into public.action_live_segments(session_id,connected_at,disconnected_at,source)
select sid, t, t2, 'webhook' from cases, (values ('2026-10-17 10:00Z'::timestamptz,'2026-10-17 10:20Z'::timestamptz),('2026-10-17 10:31Z','2026-10-17 10:40Z')) x(t,t2) where k='c3';
-- c4: four 50 s blips = 200 s > 180 s total -> broken
insert into public.action_live_segments(session_id,connected_at,disconnected_at,source)
select sid, t, t + interval '5 minutes', 'webhook' from cases,
  (select timestamptz '2026-10-17 10:00Z' + (n * interval '350 seconds') t from generate_series(0,4) n) x where k='c4';
select pg_temp.ok((public.action_live_eval((select sid from cases where k='c1'))->>'state') = 'resumed', 'L12 one long gap = resumed');
select pg_temp.ok((public.action_live_eval((select sid from cases where k='c2'))->>'reason') = 'too_many_resumes', 'L12 two long gaps = broken');
select pg_temp.ok((public.action_live_eval((select sid from cases where k='c3'))->>'reason') = 'gap_longer_than_resume_window', 'L12 gap beyond resume window = broken');
select pg_temp.ok((public.action_live_eval((select sid from cases where k='c4'))->>'reason') = 'total_gap_over_tolerance', 'L12 total blips over tolerance = broken');

-- L13 coverage bounty: claim approved only with continuous coverage of the window
insert into public.action_bounties(id,campaign_id,mission_id,title,reward_cents,max_awards,eligibility,status) values
 ('40000000-0000-4000-8000-000000000001','civic','20000000-0000-4000-8000-000000000002','Mayor''s speech, start to finish',5000,1,'any_member','draft');
insert into public.action_bounty_live_coverage(bounty_id,event_title,event_kind,city_label,cell_lat,cell_lng,window_starts_at,window_ends_at)
values ('40000000-0000-4000-8000-000000000001','Mayor''s budget speech','speech','Hartford',41.8,-72.7, now() - interval '50 minutes', now() - interval '10 minutes');
update public.action_bounties set status='open' where id='40000000-0000-4000-8000-000000000001';
insert into public.action_bounty_claims(id,bounty_id,assignment_id,user_id,m_uid,reward_cents,status,expires_at) values
 ('50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-0000000000c1','00000000-0000-4000-8000-00000000000b','10000000-0000-4000-8000-00000000000b',5000,'reserved',now() + interval '1 day');
-- B goes live for the bounty but drops 5 minutes in the middle of the speech
update public.action_bounty_live_coverage set window_starts_at = now() - interval '20 minutes', window_ends_at = now() + interval '1 hour' where bounty_id='40000000-0000-4000-8000-000000000001';
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
insert into ids select 'sb', (public.action_live_open('30000000-0000-4000-8000-0000000000c1','v1','{"adult":true,"minors_rule":true,"recording_rules":true}','none_present','city_pin','40000000-0000-4000-8000-000000000001')->>'session_id')::uuid;
reset role;
select pg_temp.as_service();
select public.action_live_attach((select v from ids where k='sb'),'inputB','w','Hartford','Connecticut','US',41.76,-72.68);
reset role;
insert into public.action_live_segments(session_id,connected_at,disconnected_at,source) values
 ((select v from ids where k='sb'), now() - interval '50 minutes', now() - interval '32 minutes', 'webhook'),
 ((select v from ids where k='sb'), now() - interval '31 minutes', null, 'webhook');
update public.action_live_sessions set status='live', evidence='webhook', first_connected_at = now() - interval '50 minutes' where id=(select v from ids where k='sb');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select public.action_live_complete((select v from ids where k='sb'));
reset role;
select pg_temp.ok((select status from public.action_bounty_claims where id='50000000-0000-4000-8000-000000000001') = 'submitted', 'L13 claim submitted with the run');
-- the speech window is set to the real event: 45..15 min ago; the 60 s drop at 32..31 min is inside it
update public.action_bounty_live_coverage set window_starts_at = now() - interval '45 minutes', window_ends_at = now() - interval '15 minutes' where bounty_id='40000000-0000-4000-8000-000000000001';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad','matthew@mccluster.org');
select public.review_action_proof((select id from public.action_proofs where assignment_id='30000000-0000-4000-8000-0000000000c1'),'verified','Attended; but see the drop');
reset role;
select pg_temp.ok((select status from public.action_bounty_claims where id='50000000-0000-4000-8000-000000000001') = 'rejected', 'L13 a 60 s drop inside the window rejects the claim (30 s tolerance)');
select pg_temp.ok((select review_note from public.action_bounty_claims where id='50000000-0000-4000-8000-000000000001') like '%live_coverage_v1%', 'L13 rule named on the claim');
-- with a 90 s tolerance the same run covers the window: approve, then pay
update public.action_bounty_live_coverage set max_single_gap_seconds = 90, max_total_gap_seconds = 90 where bounty_id='40000000-0000-4000-8000-000000000001';
update public.action_bounty_claims set status='submitted', review_note=null where id='50000000-0000-4000-8000-000000000001';
update public.action_bounty_claims set status='approved', approved_at=now() where id='50000000-0000-4000-8000-000000000001';
select pg_temp.ok((select status from public.action_bounty_claims where id='50000000-0000-4000-8000-000000000001') = 'approved', 'L13 covered window approves');
-- a claim with no live run behind it can never be paid
insert into public.action_bounty_claims(id,bounty_id,assignment_id,user_id,m_uid,reward_cents,status,expires_at) values
 ('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-0000000000c2','00000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-00000000000a',5000,'submitted',now() + interval '1 day');
select pg_temp.must_fail($q$update public.action_bounty_claims set status='paid' where id='50000000-0000-4000-8000-000000000002'$q$, '%only behind continuous coverage%');
-- alone, rule live_coverage_v1 turns this approval into a rejection; with PR #444
-- applied too, its guard refuses the approval outright (the mission is not
-- verified). Either way the claim is never approved.
do $$
begin
  begin
    update public.action_bounty_claims set status='approved' where id='50000000-0000-4000-8000-000000000002';
  exception when others then
    if sqlerrm not ilike '%approved only after an admin verified%' then raise; end if;
  end;
  if (select status from public.action_bounty_claims where id='50000000-0000-4000-8000-000000000002') = 'approved' then
    raise exception 'FAILED: L13 approval without a run must never stand';
  end if;
end $$;

-- L14 political separation; candidate-related needs counsel
select pg_temp.must_fail($q$insert into public.action_bounty_live_coverage(bounty_id,event_title,city_label,cell_lat,cell_lng,window_starts_at,window_ends_at,political)
  values ('40000000-0000-4000-8000-000000000001','x','Hartford',41.8,-72.7,now(),now()+interval '1 hour',true)$q$, '%violates check constraint%');
insert into public.action_bounties(id,campaign_id,mission_id,title,reward_cents,max_awards,status) values
 ('40000000-0000-4000-8000-000000000002','civic','20000000-0000-4000-8000-000000000002','Candidate forum',2000,1,'draft');
insert into public.action_bounty_live_coverage(bounty_id,event_title,city_label,cell_lat,cell_lng,window_starts_at,window_ends_at,political,candidate_related,funding_account)
values ('40000000-0000-4000-8000-000000000002','Candidate forum','Hartford',41.8,-72.7,now(),now()+interval '2 hours',true,true,'separate_political_program');
select pg_temp.must_fail($q$update public.action_bounties set status='open' where id='40000000-0000-4000-8000-000000000002'$q$, '%needs counsel clearance%');
update public.action_bounty_live_coverage set counsel_cleared_at = now(), counsel_note = 'cleared (test)' where bounty_id='40000000-0000-4000-8000-000000000002';
update public.action_bounties set status='open' where id='40000000-0000-4000-8000-000000000002';

-- L15 enforcement switch: when on, a required mission takes proof only from a completed run
update public.action_live_controls set enforce_live_required = true;
insert into public.action_mission_assignments(id,mission_id,user_id,m_uid,status) values
 ('30000000-0000-4000-8000-0000000000f1','20000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-0000000000ad','10000000-0000-4000-8000-0000000000ad','joined');
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select pg_temp.must_fail($q$select public.submit_action_proof('30000000-0000-4000-8000-0000000000b0','text',null,'I did it without going live, honestly.')$q$, '%assignment not found%');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad','matthew@mccluster.org');
select pg_temp.must_fail($q$select public.submit_action_proof('30000000-0000-4000-8000-0000000000f1','text',null,'I did it without going live, honestly.')$q$, '%completed live%');
reset role;
update public.action_live_controls set enforce_live_required = false;

-- L16 kill switch: members cannot; the desk can, and the pin disappears
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
insert into ids select 'sk', (public.action_live_open('30000000-0000-4000-8000-0000000000c2','v1','{"adult":true,"minors_rule":true,"recording_rules":true}')->>'session_id')::uuid;
reset role;
select pg_temp.as_service();
select public.action_live_attach((select v from ids where k='sk'),'inputK','w','Lubumbashi','Haut-Katanga','CD',-11.66,27.48);
select public.action_live_observe((select v from ids where k='sk'),'connected',now() - interval '10 minutes','webhook','inputK:connected:1');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select public.action_live_report((select v from ids where k='sk'),'no_consent','filming a private conversation');
select pg_temp.must_fail($q$select public.action_live_kill((select v from ids where k='sk'),'test')$q$, '%only the desk%');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.ok((select count(*) from public.action_live_reports) = 0, 'L16 streamer cannot read reports about them');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad','matthew@mccluster.org');
select pg_temp.ok((public.action_live_kill((select v from ids where k='sk'),'report: no consent')->>'status') = 'killed', 'L16 desk kills');
reset role;
select pg_temp.ok((select globe_visibility = 'hidden' from public.action_live_sessions where id=(select v from ids where k='sk')), 'L16 killed run leaves the globe');
select pg_temp.ok((select status from public.action_live_reports where session_id=(select v from ids where k='sk')) = 'actioned', 'L16 report actioned');
select pg_temp.as_service();
select pg_temp.ok((public.action_live_observe((select v from ids where k='sk'),'connected',now(),'webhook','inputK:connected:2')->>'ignored') = 'true', 'L16 a killed run cannot come back');
reset role;

-- L17 sweep: heartbeat-only run goes quiet -> interrupted -> broken after the resume window
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
insert into ids select 'sh', (public.action_live_open('30000000-0000-4000-8000-0000000000c2','v1','{"adult":true,"minors_rule":true,"recording_rules":true}')->>'session_id')::uuid;
reset role;
select pg_temp.as_service();
select public.action_live_attach((select v from ids where k='sh'),'inputH','w','Atlanta','Georgia','US',33.75,-84.39);
select public.action_live_observe((select v from ids where k='sh'),'heartbeat',now() - interval '5 minutes','heartbeat',null);
select public.action_live_observe((select v from ids where k='sh'),'heartbeat',now() - interval '4 minutes','heartbeat',null);
select public.action_live_sweep(now());
reset role;
select pg_temp.ok((select status from public.action_live_sessions where id=(select v from ids where k='sh')) = 'interrupted', 'L17 stale heartbeats interrupt');
select pg_temp.as_service();
select pg_temp.ok((public.action_live_sweep(now() + interval '11 minutes')->0->>'input_uid') = 'inputH', 'L17 sweep returns the input to delete');
reset role;
select pg_temp.ok((select status from public.action_live_sessions where id=(select v from ids where k='sh')) = 'broken', 'L17 not resumed in time = broken');

-- L18 publishing opt-ins: most private by default, owner only, known keys only
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select public.action_live_set_publishing_consent((select v from ids where k='sa'),'pub-v1',repeat('a',64),'{"edit_clip":true}');
select pg_temp.ok((select face = 'blur' and voice = 'captions_only' and name_display = 'none' and location_display = 'none'
  and not clipper_share and not paid_ads and edit_clip from public.action_live_publishing_consents where session_id=(select v from ids where k='sa')), 'L18 defaults most private, one opt-in on');
select pg_temp.must_fail($q$select public.action_live_set_publishing_consent((select v from ids where k='sa'),'pub-v1',repeat('a',64),'{"exact_location":true}')$q$, '%unknown publishing choice%');
select pg_temp.must_fail($q$select public.action_live_set_publishing_consent((select v from ids where k='sa'),'pub-v1',repeat('a',64),'{"location_display":"exact"}')$q$, '%violates check constraint%');
select public.action_live_set_publishing_consent((select v from ids where k='sa'),'pub-v1',repeat('a',64),'{"revoke":true}');
select pg_temp.ok((select revoked_at is not null and not edit_clip from public.action_live_publishing_consents where session_id=(select v from ids where k='sa')), 'L18 revocation clears and stamps');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select pg_temp.must_fail($q$select public.action_live_set_publishing_consent((select v from ids where k='sa'),'pub-v1',repeat('a',64),'{}')$q$, '%session not found%');
reset role;

-- L19 paused: the owner stops new runs
update public.action_live_controls set accepting_sessions = false;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select pg_temp.must_fail($q$select public.action_live_open('30000000-0000-4000-8000-0000000000e1','v1','{"adult":true,"minors_rule":true,"recording_rules":true}')$q$, '%paused%');
reset role;
update public.action_live_controls set accepting_sessions = true;

-- L19b the event database: desk only; city cells, times, the bounty's event
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select pg_temp.must_fail($q$select * from public.action_live_event_log(now() - interval '1 day', now() + interval '1 day')$q$, '%desk only%');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad','matthew@mccluster.org');
select pg_temp.ok((select count(*) from public.action_live_event_log(now() - interval '1 day', now() + interval '1 day')
  where event_title = 'Mayor''s budget speech' and city = 'Hartford' and cell_lat = 41.8 and status = 'completed') = 1, 'L19b the covered speech is in the event log');
reset role;

-- L20 a new mission gets the required default
insert into public.action_missions(id,campaign_id,title,status) values ('20000000-0000-4000-8000-000000000009','civic','Brand new','draft');
select pg_temp.ok((select live_mode from public.action_mission_live_policies where mission_id='20000000-0000-4000-8000-000000000009') = 'required', 'L20 new missions default to required');

select 'live missions behaviour: ok' as result;
