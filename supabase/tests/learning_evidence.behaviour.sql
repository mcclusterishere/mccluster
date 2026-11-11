-- Behaviour gate for supabase/migrations/20261103182544_learning_evidence_v1.sql.
-- Every person, ID and hash below is an invented fixture. Run only through
-- scripts/test-learning-evidence-db.sh. Assertions run as the real API roles.
set client_min_messages = warning;

create or replace function pg_temp.ok(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'FAILED: %', p_label; end if;
end $$;
create or replace function pg_temp.must_fail(p_sql text, p_state text, p_message text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_state or (p_message is not null and sqlerrm not ilike p_message) then
      raise exception 'Expected SQLSTATE % / %, got % / %', p_state, p_message, sqlstate, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected failure but statement succeeded: %', p_sql;
end $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- owner (house owner, also a learner), learner, outsider, outside reviewer
insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@example.invalid'),
  ('00000000-0000-4000-8000-0000000000b2', 'learner@example.invalid'),
  ('00000000-0000-4000-8000-0000000000c3', 'outsider@example.invalid'),
  ('00000000-0000-4000-8000-0000000000d4', 'reviewer@example.invalid');
insert into public.orgs(id, slug) values ('00000000-0000-4000-8000-00000000f000', 'mccluster');
insert into public.org_members(org_id, profile_id, role) values ('00000000-0000-4000-8000-00000000f000', '00000000-0000-4000-8000-0000000000a1', 'owner');
insert into public.learning_reviewers(user_id, role) values ('00000000-0000-4000-8000-0000000000d4', 'evaluator');

select pg_temp.ok(public.learning_user_is_reviewer('00000000-0000-4000-8000-0000000000a1'), 'house owner is a reviewer');
select pg_temp.ok(public.learning_user_is_reviewer('00000000-0000-4000-8000-0000000000d4'), 'listed reviewer is a reviewer');
select pg_temp.ok(not public.learning_user_is_reviewer('00000000-0000-4000-8000-0000000000b2'), 'learner is not a reviewer');

-- ---- a learner session with hash-chained evidence, as the learner ----
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2"}', false);
select pg_temp.must_fail($$select public.learning_user_is_reviewer('00000000-0000-4000-8000-0000000000a1')$$, '42501');
insert into public.learning_lab_sessions(id, user_id, pack_id, pack_version, scenario_id, seed)
  values ('00000000-0000-4000-8000-000000005001', '00000000-0000-4000-8000-0000000000b2', 'hseep-building-safety', '1.0.0', 'EU-HSEEP-FIRE-SMOKE-V1', 7);
select pg_temp.must_fail($$insert into public.learning_lab_sessions(user_id, pack_id, pack_version, scenario_id) values ('00000000-0000-4000-8000-0000000000c3', 'fema-building-ops', '1.0.0', 'EU-OPS-SURGE-V1')$$, '42501');
select pg_temp.must_fail($$insert into public.learning_lab_sessions(user_id, pack_id, pack_version, scenario_id, execution_target) values ('00000000-0000-4000-8000-0000000000b2', 'fema-building-ops', '1.0.0', 'EU-OPS-SURGE-V1', 'LIVE')$$, '23514');
insert into public.learning_evidence_events(session_id, user_id, seq, event_type, action_id, status, payload, event_hash)
  values ('00000000-0000-4000-8000-000000005001', '00000000-0000-4000-8000-0000000000b2', 99, 'action', 'fire-report', 'success', '{"input":{"response":"activate_alarm_and_call_emergency_services"}}', repeat('0', 64));
insert into public.learning_evidence_events(session_id, user_id, seq, event_type, action_id, status, payload, event_hash)
  values ('00000000-0000-4000-8000-000000005001', '00000000-0000-4000-8000-0000000000b2', 1, 'inspect', 'fire-inspect', 'success', '{}', repeat('0', 64));
select pg_temp.ok((select array_agg(seq order by seq) = array[1,2] from public.learning_evidence_events where session_id = '00000000-0000-4000-8000-000000005001'), 'database assigns the sequence');
select pg_temp.ok((select prev_hash is null and event_hash <> repeat('0', 64) from public.learning_evidence_events where session_id = '00000000-0000-4000-8000-000000005001' and seq = 1), 'database computes the first hash');
select pg_temp.ok((select e2.prev_hash = e1.event_hash from public.learning_evidence_events e1 join public.learning_evidence_events e2 on e2.session_id = e1.session_id and e2.seq = 2 where e1.seq = 1 and e1.session_id = '00000000-0000-4000-8000-000000005001'), 'events chain');
select pg_temp.ok((select e.event_hash = public.learning_event_digest(e.prev_hash, e.session_id, e.seq, e.event_type, e.action_id, e.status, e.actor_role, e.payload, e.occurred_at) from public.learning_evidence_events e where e.seq = 2 and e.session_id = '00000000-0000-4000-8000-000000005001'), 'hash is recomputable');
select pg_temp.must_fail($$update public.learning_evidence_events set status = 'incorrect'$$, '42501');
select pg_temp.must_fail($$delete from public.learning_evidence_events$$, '42501');
select pg_temp.must_fail($$update public.learning_lab_sessions set outcome = 'completed', ended_at = now()$$, '42501');
-- a learner may claim a credential, but not verify it
insert into public.learning_external_credentials(id, user_id, issuer, catalog_id, course_code, title, completion_date, certificate_path, certificate_sha256, mime_type, byte_size)
  values ('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-0000000000b2', 'FEMA', 'FEMA-IS-100-C', 'IS-100.C', 'Introduction to the Incident Command System, ICS 100', '2026-10-01',
          '00000000-0000-4000-8000-0000000000b2/00000000-0000-4000-8000-00000000e001.pdf', repeat('a', 64), 'application/pdf', 1024);
select pg_temp.must_fail($$insert into public.learning_external_credentials(user_id, issuer, catalog_id, title, completion_date, verification_status, verified_by, verified_at) values ('00000000-0000-4000-8000-0000000000b2', 'FEMA', 'FEMA-IS-700-B', 'NIMS', '2026-10-01', 'reviewer_verified', '00000000-0000-4000-8000-0000000000b2', now())$$, '42501');
select pg_temp.must_fail($$insert into public.learning_external_credentials(user_id, issuer, catalog_id, title, completion_date, certificate_path) values ('00000000-0000-4000-8000-0000000000b2', 'FEMA', 'FEMA-IS-700-B', 'NIMS', '2026-10-01', '00000000-0000-4000-8000-0000000000c3/00000000-0000-4000-8000-00000000e002.pdf')$$, '23514');
select pg_temp.ok((select count(*) = 0 from public.learning_external_credentials where verification_status <> 'self_reported'), 'nothing self-verified');
update public.learning_external_credentials set verification_status = 'reviewer_verified', verified_by = '00000000-0000-4000-8000-0000000000b2', verified_at = now();
select pg_temp.ok((select verification_status = 'self_reported' from public.learning_external_credentials where id = '00000000-0000-4000-8000-00000000c001'), 'a learner cannot verify their own credential (RLS hides the row from update)');
select pg_temp.must_fail($$insert into public.learning_competency_ratings(user_id, competency_id, state, source, reviewer_id) values ('00000000-0000-4000-8000-0000000000b2', 'CORE-08', 'Verified', 'reviewer', '00000000-0000-4000-8000-0000000000b2')$$, '42501');
-- the learner's own certificate folder only
insert into storage.objects(bucket_id, name) values ('learning-credentials', '00000000-0000-4000-8000-0000000000b2/00000000-0000-4000-8000-00000000e001.pdf');
select pg_temp.must_fail($$insert into storage.objects(bucket_id, name) values ('learning-credentials', '00000000-0000-4000-8000-0000000000c3/x.pdf')$$, '42501');
reset role;

-- ---- an outsider sees nothing ----
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3"}', false);
select pg_temp.ok((select count(*) = 0 from public.learning_lab_sessions), 'outsider sees no sessions');
select pg_temp.ok((select count(*) = 0 from public.learning_evidence_events), 'outsider sees no evidence');
select pg_temp.ok((select count(*) = 0 from public.learning_external_credentials), 'outsider sees no credentials');
select pg_temp.ok((select count(*) = 0 from storage.objects where bucket_id = 'learning-credentials'), 'outsider sees no certificate files');
reset role;
set role anon;
select pg_temp.must_fail($$select * from public.learning_lab_sessions$$, '42501');
reset role;

-- ---- a reviewer reviews ----
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000d4"}', false);
select pg_temp.ok((select count(*) = 2 from public.learning_evidence_events), 'reviewer reads evidence');
select pg_temp.ok((select count(*) = 1 from storage.objects where bucket_id = 'learning-credentials'), 'reviewer reads the certificate');
update public.learning_external_credentials set verification_status = 'reviewer_verified', verified_by = '00000000-0000-4000-8000-0000000000d4', verified_at = now(), verification_note = 'Matches the NDEMU transcript.';
select pg_temp.ok((select verification_status = 'reviewer_verified' from public.learning_external_credentials where id = '00000000-0000-4000-8000-00000000c001'), 'reviewer verifies');
insert into public.learning_competency_ratings(user_id, competency_id, state, source, reviewer_id, review_note)
  values ('00000000-0000-4000-8000-0000000000b2', 'CORE-08', 'Verified', 'reviewer', '00000000-0000-4000-8000-0000000000d4', 'Observed in the drill.');
select pg_temp.must_fail($$update public.learning_external_credentials set title = 'changed'$$, '42501');
reset role;

-- ---- the automated ceiling and the human-reviewer rule hold even for the service role ----
set role service_role;
insert into public.learning_competency_ratings(user_id, competency_id, state, source, session_id)
  values ('00000000-0000-4000-8000-0000000000b2', 'CORE-08', 'Demonstrated', 'automated', '00000000-0000-4000-8000-000000005001');
select pg_temp.must_fail($$insert into public.learning_competency_ratings(user_id, competency_id, state, source) values ('00000000-0000-4000-8000-0000000000b2', 'CORE-08', 'Verified', 'automated')$$, '23514');
select pg_temp.must_fail($$insert into public.learning_competency_ratings(user_id, competency_id, state, source, reviewer_id) values ('00000000-0000-4000-8000-0000000000b2', 'CORE-08', 'Applied', 'reviewer', '00000000-0000-4000-8000-0000000000c3')$$, '42501');
select pg_temp.must_fail($$insert into public.learning_competency_ratings(user_id, competency_id, state, source, reviewer_id) values ('00000000-0000-4000-8000-0000000000a1', 'CORE-08', 'Verified', 'reviewer', '00000000-0000-4000-8000-0000000000a1')$$, '23514');
-- closing a session freezes its evidence
update public.learning_lab_sessions set outcome = 'completed', ended_at = now(), evidence_bundle_sha256 = repeat('b', 64) where id = '00000000-0000-4000-8000-000000005001';
select pg_temp.must_fail($$insert into public.learning_evidence_events(session_id, user_id, seq, event_type, event_hash) values ('00000000-0000-4000-8000-000000005001', '00000000-0000-4000-8000-0000000000b2', 1, 'note', repeat('0', 64))$$, '55000');
-- HSEEP exercise, EEG, AAR/IP, improvement items, ICS-214
insert into public.learning_hseep_exercises(id, created_by, title, exercise_type, pack_id, pack_version, scenario_id, objectives)
  values ('00000000-0000-4000-8000-00000000e100', '00000000-0000-4000-8000-0000000000a1', 'Fire drill, Floor 1', 'drill', 'hseep-building-safety', '1.0.0', 'EU-HSEEP-FIRE-SMOKE-V1', '[{"objective_id":"FIRE-OBJ-1"}]');
select pg_temp.must_fail($$insert into public.learning_hseep_exercises(created_by, title, exercise_type) values ('00000000-0000-4000-8000-0000000000a1', 'Bad type', 'exercise')$$, '23514');
insert into public.learning_hseep_participants(exercise_id, user_id, exercise_role, ics_position) values
  ('00000000-0000-4000-8000-00000000e100', '00000000-0000-4000-8000-0000000000b2', 'player', 'incident_commander'),
  ('00000000-0000-4000-8000-00000000e100', '00000000-0000-4000-8000-0000000000d4', 'evaluator', null);
insert into public.learning_hseep_evaluations(exercise_id, evaluator_id, criterion_id, objective_id, rating, observation_type, observation)
  values ('00000000-0000-4000-8000-00000000e100', '00000000-0000-4000-8000-0000000000d4', 'FIRE-EEG-1', 'FIRE-OBJ-1', 'S', 'area_for_improvement', 'Alarm raised after a short delay.');
select pg_temp.must_fail($$insert into public.learning_hseep_evaluations(exercise_id, evaluator_id, criterion_id, rating, observation_type, observation) values ('00000000-0000-4000-8000-00000000e100', '00000000-0000-4000-8000-0000000000d4', 'FIRE-EEG-1', 'X', 'strength', 'bad rating')$$, '23514');
insert into public.learning_hseep_aar(exercise_id, status, summary) values ('00000000-0000-4000-8000-00000000e100', 'draft', 'Draft.');
select pg_temp.must_fail($$update public.learning_hseep_aar set status = 'final'$$, '23514');
insert into public.learning_hseep_improvement_items(exercise_id, item_code, issue, owner_label) values ('00000000-0000-4000-8000-00000000e100', 'FIRE-IP-01', 'Alarm delay', 'Building operations lead');
select pg_temp.must_fail($$update public.learning_hseep_improvement_items set status = 'closed', closed_at = now()$$, '23514');
update public.learning_hseep_improvement_items set status = 'closed', closed_at = now(), closure_evidence = 'Re-drilled 2026-11-10; alarm within 10 s.';
insert into public.learning_ics214_entries(exercise_id, user_id, ics_position, activity) values ('00000000-0000-4000-8000-00000000e100', '00000000-0000-4000-8000-0000000000b2', 'incident_commander', 'Command established at Assembly Area B.');
select pg_temp.must_fail($$update public.learning_ics214_entries set activity = 'x'$$, '42501');
reset role;

-- the player sees their exercise; the outsider does not
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000b2"}', false);
select pg_temp.ok((select count(*) = 1 from public.learning_hseep_exercises), 'player sees the exercise');
select pg_temp.ok((select count(*) = 1 from public.learning_hseep_evaluations), 'player sees the EEG observation');
select pg_temp.ok((select count(*) = 2 from public.learning_competency_ratings), 'learner sees both ratings');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c3"}', false);
select pg_temp.ok((select count(*) = 0 from public.learning_hseep_exercises), 'outsider sees no exercise');
select pg_temp.ok((select count(*) = 0 from public.learning_ics214_entries), 'outsider sees no ICS-214');
reset role;

-- account deletion purges, deliberately
begin;
set local learning.allow_purge = 'on';
delete from auth.users where id = '00000000-0000-4000-8000-0000000000b2';
select pg_temp.ok((select count(*) = 0 from public.learning_evidence_events), 'purge removes the learner''s evidence');
rollback;
select 'learning evidence behaviour: ok' as result;
