-- Behaviour tests for supabase/pending/policy_fellowship_ladder_v1.sql.
-- Run by scripts/test-policy-fellowship-db.sh on a scratch Postgres. Test
-- fixtures only: every person, mission, cohort and memo here is invented and
-- lives only in the throwaway database.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.as_user(p_id uuid, p_email text default null) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', coalesce(p_email, p_id::text || '@test'), 'role', 'authenticated')::text, false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"anon"}', false); execute 'set role anon'; end $$;
create or replace function pg_temp.must_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then
  if sqlerrm not ilike p_like then raise exception 'expected % from [%], got: %', p_like, p_sql, sqlerrm; end if; return; end;
  raise exception 'expected failure (%) but it succeeded: %', p_like, p_sql; end $$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAILED: %', p_what; end if; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;
create temp table ids(k text primary key, v uuid); grant all on ids to anon, authenticated;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
grant execute on function pg_temp.id(text) to anon, authenticated;

-- fixtures (superuser): F the fellow, G a member, the desk, a region, three starter missions
insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-0000000000f1','f@test'), ('00000000-0000-4000-8000-0000000000f2','g@test'),
 ('00000000-0000-4000-8000-0000000000ad','matthew@mccluster.org');
insert into public.m_people(id) values
 ('10000000-0000-4000-8000-0000000000f1'), ('10000000-0000-4000-8000-0000000000f2'), ('10000000-0000-4000-8000-0000000000ad');
insert into public.m_links(user_id, m_uid) values
 ('00000000-0000-4000-8000-0000000000f1','10000000-0000-4000-8000-0000000000f1'),
 ('00000000-0000-4000-8000-0000000000f2','10000000-0000-4000-8000-0000000000f2'),
 ('00000000-0000-4000-8000-0000000000ad','10000000-0000-4000-8000-0000000000ad');
insert into public.action_globe_regions(region_key, country_code, subdivision_code, region_label, centroid_lat, centroid_lon)
values ('test-region', 'US', 'US-ZZ', 'Test State', 41.6, -72.7);
insert into public.action_missions(id, title, status, skills) values
 ('20000000-0000-4000-8000-0000000000e1','Fixture: help one person','open','{field}'),
 ('20000000-0000-4000-8000-0000000000e2','Fixture: write a song','open','{creative}'),
 ('20000000-0000-4000-8000-0000000000e3','Fixture: go to a rally','open','{civic}'),
 ('20000000-0000-4000-8000-0000000000e4','Fixture: any other mission','open','{civic}'),
 ('20000000-0000-4000-8000-0000000000e5','Fixture: one more mission','open','{civic}'),
 ('20000000-0000-4000-8000-0000000000e6','Fixture: a clip job','open','{creative}');
update public.action_missions set kind = 'clip' where id = '20000000-0000-4000-8000-0000000000e6';

-- the seeded rule is data (owner, 2026-10-15): ANY three verified missions, not specific kinds, not creator-exclusive
do $$ begin
  perform pg_temp.ok((select requirement_kind = 'verified_missions' and required_kinds is null and min_count = 3 and not creator_exclusive and enabled
    from public.action_unlock_rules where rule_key = 'policy_fellowship'), 'seeded rule');
  perform pg_temp.ok(not exists (select 1 from public.action_ladder_mission_kinds where mission_id = '51000000-0000-4000-8000-000000000003'), 'the closed mission is not mapped');
  perform pg_temp.ok((select count(*) = 3 from public.action_ladder_starter_kinds), 'three starter kinds');
end $$;

-- only the desk maps missions to kinds
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
select pg_temp.must_fail($q$insert into public.action_ladder_mission_kinds(mission_id, kind) values ('20000000-0000-4000-8000-0000000000e1','help_person')$q$, '%row-level security%');
update public.action_unlock_rules set min_count = 1; -- RLS: matches no row for a member
do $$ begin perform pg_temp.ok((select min_count from public.action_unlock_rules where rule_key='policy_fellowship') = 3, 'member cannot loosen the rule'); end $$;
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
insert into public.action_ladder_mission_kinds(mission_id, kind) values
 ('20000000-0000-4000-8000-0000000000e1','help_person'),
 ('20000000-0000-4000-8000-0000000000e2','write_song'),
 ('20000000-0000-4000-8000-0000000000e3','attend_rally');
reset role;

-- logged out: the ladder is public, nothing personal
select pg_temp.as_anon();
do $$ declare s jsonb := public.policy_ladder_status(); begin
  perform pg_temp.ok(not (s->>'signed_in')::boolean and s->>'next_step' = 'sign_in' and jsonb_array_length(s->'steps') = 3, 'anon status: ' || s::text);
end $$;
select pg_temp.must_fail($q$select * from public.action_policy_memos$q$, '%permission denied%');
reset role;

-- F: nothing done yet
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
do $$ declare s jsonb := public.policy_ladder_status(); begin
  perform pg_temp.ok((s->>'completed')::int = 0 and not (s->>'eligible')::boolean and s->>'next_step' = 'complete_starter_missions', 'F fresh: ' || s::text);
end $$;
insert into ids select 'a1', (public.join_action_mission('20000000-0000-4000-8000-0000000000e1')->>'assignment_id')::uuid;
insert into ids select 'a2', (public.join_action_mission('20000000-0000-4000-8000-0000000000e2')->>'assignment_id')::uuid;
insert into ids select 'a3', (public.join_action_mission('20000000-0000-4000-8000-0000000000e3')->>'assignment_id')::uuid;
insert into ids select 'p1', (public.submit_action_proof(pg_temp.id('a1'),'text',null,'Walked a neighbour through a benefits form.')->>'proof_id')::uuid;
insert into ids select 'p2', (public.submit_action_proof(pg_temp.id('a2'),'text',null,'Wrote and recorded an original song.')->>'proof_id')::uuid;
insert into ids select 'p3', (public.submit_action_proof(pg_temp.id('a3'),'text',null,'Attended the town-green rally on Saturday.')->>'proof_id')::uuid;
-- submitted is not completed
do $$ declare s jsonb := public.policy_ladder_status(); begin
  perform pg_temp.ok((s->>'completed')::int = 0, 'a submitted proof does not complete a kind: ' || s::text);
end $$;
reset role;

-- G: one mission only (more below)
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f2');
insert into ids select 'g1', (public.join_action_mission('20000000-0000-4000-8000-0000000000e1')->>'assignment_id')::uuid;
insert into ids select 'gp1', (public.submit_action_proof(pg_temp.id('g1'),'text',null,'Drove an elderly neighbour to a clinic.')->>'proof_id')::uuid;
reset role;

-- the desk verifies help + song for F (and G's help); a rejected proof never counts
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.review_action_proof(pg_temp.id('p1'),'verified',null);
select public.review_action_proof(pg_temp.id('p2'),'verified',null);
select public.review_action_proof(pg_temp.id('p3'),'rejected','Add a photo or link that shows you were there.');
select public.review_action_proof(pg_temp.id('gp1'),'verified',null);
reset role;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
do $$ declare s jsonb := public.policy_ladder_status(); begin
  perform pg_temp.ok((s->>'completed')::int = 2 and (s->>'needed')::int = 3 and not (s->>'eligible')::boolean, 'two of three, rejected rally does not count: ' || s::text);
  perform pg_temp.ok((select count(*) from jsonb_array_elements(s->'steps') x where (x->>'done')::boolean) = 2, 'steps done flags');
end $$;
insert into ids select 'p3b', (public.submit_action_proof(pg_temp.id('a3'),'link','https://example.org/rally-photo','Here is the photo from the rally.')->>'proof_id')::uuid;
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.review_action_proof(pg_temp.id('p3'),'verified',null);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
do $$ declare s jsonb := public.policy_ladder_status(); begin
  perform pg_temp.ok((s->>'completed')::int = 3 and (s->>'eligible')::boolean and s->>'next_step' = 'apply_for_fellowship', 'all three: ' || s::text);
end $$;
reset role;

-- ANY three: G's two unmapped missions plus help count; a verified CLIP never does
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f2');
do $$ begin perform pg_temp.ok(not (public.policy_ladder_status()->>'eligible')::boolean, 'G not eligible with one'); end $$;
insert into ids select 'g4', (public.join_action_mission('20000000-0000-4000-8000-0000000000e4')->>'assignment_id')::uuid;
insert into ids select 'g6', (public.join_action_mission('20000000-0000-4000-8000-0000000000e6')->>'assignment_id')::uuid;
insert into ids select 'gp4', (public.submit_action_proof(pg_temp.id('g4'),'text',null,'Cleaned up the park with neighbours.')->>'proof_id')::uuid;
insert into ids select 'gp6', (public.submit_action_proof(pg_temp.id('g6'),'link','https://example.org/clip','Posted the clip.')->>'proof_id')::uuid;
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.review_action_proof(pg_temp.id('gp4'),'verified',null);
select public.review_action_proof(pg_temp.id('gp6'),'verified',null);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f2');
do $$ declare s jsonb := public.policy_ladder_status(); begin
  perform pg_temp.ok((s->>'completed')::int = 2 and not (s->>'eligible')::boolean, 'two verified non-clip missions; the verified clip does not count: ' || s::text);
end $$;
insert into ids select 'g5', (public.join_action_mission('20000000-0000-4000-8000-0000000000e5')->>'assignment_id')::uuid;
insert into ids select 'gp5', (public.submit_action_proof(pg_temp.id('g5'),'text',null,'Ran the food drive table.')->>'proof_id')::uuid;
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.review_action_proof(pg_temp.id('gp5'),'verified',null);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f2');
do $$ declare s jsonb := public.policy_ladder_status(); begin
  perform pg_temp.ok((s->>'completed')::int = 3 and (s->>'eligible')::boolean, 'any three verified missions, only one of them a suggested kind: ' || s::text);
end $$;
reset role;
update public.action_unlock_rules set min_count = 4 where rule_key = 'policy_fellowship';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f2');
do $$ begin perform pg_temp.ok(not (public.policy_ladder_status()->>'eligible')::boolean, 'G not eligible under four'); end $$;
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
update public.action_unlock_rules set min_count = 1 where rule_key = 'policy_fellowship';
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f2');
do $$ begin perform pg_temp.ok((public.policy_ladder_status()->>'eligible')::boolean, 'G eligible under any-one'); end $$;
reset role;
update public.action_unlock_rules set min_count = 3 where rule_key = 'policy_fellowship';
select pg_temp.must_fail($q$update public.action_unlock_rules set min_count = null where rule_key = 'policy_fellowship'$q$, '%check constraint%');

-- creator exclusivity is a switch, off by default
insert into public.creator_billing_subscriptions values ('sub_test_f', '00000000-0000-4000-8000-0000000000f1', 'active', now() + interval '30 days');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
do $$ begin perform pg_temp.ok((public.policy_ladder_status()->>'eligible')::boolean, 'a creator account does not block by default'); end $$;
reset role;
update public.action_unlock_rules set creator_exclusive = true where rule_key = 'policy_fellowship';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
do $$ begin perform pg_temp.ok(not (public.policy_ladder_status()->>'eligible')::boolean, 'creator_exclusive=true blocks a creator'); end $$;
reset role;
update public.action_unlock_rules set creator_exclusive = false where rule_key = 'policy_fellowship';
delete from public.creator_billing_subscriptions;

-- F applies (existing fellowship path), the desk accepts
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
insert into ids select 'app', (public.apply_for_fellowship('I want to write state policy memos that answer what my neighbours told me.')->>'application_id')::uuid;
do $$ begin perform pg_temp.ok(public.policy_ladder_status()->>'next_step' = 'await_fellowship_review', 'await review'); end $$;
reset role;
-- G gets an accepted application by fixture (G could not apply with one verified action)
insert into public.action_fellowship_applications(id, user_id, m_uid, status, why, verified_actions_at_apply)
values ('30000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000f2', '10000000-0000-4000-8000-0000000000f2', 'accepted', repeat('g', 45), 1);
insert into ids values ('gapp', '30000000-0000-4000-8000-0000000000f2');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.review_fellowship_application(pg_temp.id('app'), 'accepted', 'Welcome in.');
-- a state Policy Fellowship cohort needs a state
select pg_temp.must_fail($q$insert into public.action_cohorts(name, program) values ('No state', 'policy_fellowship')$q$, '%action_cohorts_policy_region_check%');
insert into public.action_cohorts(id, name, program, region_key) values ('40000000-0000-4000-8000-0000000000c1', 'Test State policy fellows', 'policy_fellowship', 'test-region');
insert into public.action_cohorts(id, name, program, region_key, parent_cohort_id) values ('40000000-0000-4000-8000-0000000000c2', 'Test State housing team', 'policy_team', 'test-region', '40000000-0000-4000-8000-0000000000c1');
-- a plain (non-policy) cohort keeps the old behaviour
insert into public.action_cohorts(id, name) values ('40000000-0000-4000-8000-0000000000c0', 'Plain cohort');
select public.admit_fellow_to_cohort(pg_temp.id('gapp'), '40000000-0000-4000-8000-0000000000c0');
-- the ladder gates the policy seat; a team seat needs the state seat
-- G has three verified missions now, so the desk raises the bar to four for this check (data, not code), then puts it back
update public.action_unlock_rules set min_count = 4 where rule_key = 'policy_fellowship';
select pg_temp.must_fail($q$select public.admit_fellow_to_cohort(pg_temp.id('gapp'), '40000000-0000-4000-8000-0000000000c1')$q$, '%not completed the verified missions%');
update public.action_unlock_rules set min_count = 3 where rule_key = 'policy_fellowship';
select pg_temp.must_fail($q$select public.admit_fellow_to_cohort(pg_temp.id('app'), '40000000-0000-4000-8000-0000000000c2')$q$, '%needs a seat in its state cohort%');
select public.admit_fellow_to_cohort(pg_temp.id('app'), '40000000-0000-4000-8000-0000000000c1');
select public.admit_fellow_to_cohort(pg_temp.id('app'), '40000000-0000-4000-8000-0000000000c2');
reset role;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
do $$ declare s jsonb := public.policy_ladder_status(); begin
  perform pg_temp.ok(s->>'next_step' = 'write_memo' and jsonb_array_length(s->'policy_seats') = 2, 'seated: ' || s::text);
end $$;
reset role;

-- G (no seat) cannot open a memo in that cohort
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f2');
select pg_temp.must_fail($q$select public.create_policy_memo('40000000-0000-4000-8000-0000000000c1','Housing first in Test State')$q$, '%need a seat%');
select pg_temp.must_fail($q$select public.create_policy_memo('40000000-0000-4000-8000-0000000000c0','Not a policy cohort')$q$, '%policy cohort not found%');
reset role;

-- F writes memo 1; nothing is writable directly
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
insert into ids select 'm1', (public.create_policy_memo('40000000-0000-4000-8000-0000000000c1','Housing first in Test State')->>'memo_id')::uuid;
do $$ begin perform pg_temp.ok((select region_key = 'test-region' from public.action_policy_memos where id = pg_temp.id('m1')), 'memo inherits the cohort state'); end $$;
select pg_temp.must_fail($q$select public.submit_policy_memo(pg_temp.id('m1'))$q$, '%write the memo before submitting%');
select pg_temp.must_fail($q$insert into public.action_policy_memos(author_uid, author_m_uid, cohort_id, draft_title) values ('00000000-0000-4000-8000-0000000000f1','10000000-0000-4000-8000-0000000000f1','40000000-0000-4000-8000-0000000000c1','Direct')$q$, '%permission denied%');
select pg_temp.must_fail($q$update public.action_policy_memos set status = 'approved'$q$, '%permission denied%');
select public.save_policy_memo_draft(pg_temp.id('m1'), 'Housing first in Test State', E'Problem\nEvidence\nRecommendation');
select public.submit_policy_memo(pg_temp.id('m1'), 'First draft for review.');
select pg_temp.must_fail($q$select public.save_policy_memo_draft(pg_temp.id('m1'), 'Edit while submitted', 'x')$q$, '%cannot be edited now%');
select pg_temp.must_fail($q$select public.review_policy_memo(pg_temp.id('m1'), 'approve')$q$, '%not authorized%');
do $$ begin
  perform pg_temp.ok((select status = 'submitted' and current_version_id is not null from public.action_policy_memos where id = pg_temp.id('m1')), 'submitted with a version');
  perform pg_temp.ok((select count(*) = 1 from public.action_policy_memo_versions where memo_id = pg_temp.id('m1') and author_role = 'fellow' and body_sha256 = encode(sha256(convert_to(body, 'UTF8')), 'hex')), 'version 1 hashed');
end $$;
reset role;

-- the desk: illegal transitions are refused
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select pg_temp.must_fail($q$select public.review_policy_memo(pg_temp.id('m1'), 'approve')$q$, '%illegal transition: approve from submitted%');
select pg_temp.must_fail($q$select public.review_policy_memo(pg_temp.id('m1'), 'publish')$q$, '%illegal transition%');
select public.review_policy_memo(pg_temp.id('m1'), 'start_review');
select pg_temp.must_fail($q$select public.review_policy_memo(pg_temp.id('m1'), 'request_changes')$q$, '%needs a note%');
select public.review_policy_memo(pg_temp.id('m1'), 'request_changes', 'Cite the state statute and cost it.');
reset role;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
do $$ begin
  perform pg_temp.ok((select status = 'changes_requested' from public.action_policy_memos where id = pg_temp.id('m1')), 'changes requested');
end $$;
select public.save_policy_memo_draft(pg_temp.id('m1'), 'Housing first in Test State', E'Problem\nEvidence: statute 12-34\nRecommendation\nCost: $2M');
select public.submit_policy_memo(pg_temp.id('m1'), 'Added statute and cost.');
reset role;
do $$ begin
  perform pg_temp.ok((select count(*) = 1 from public.network_notifications where recipient_m_uid = '10000000-0000-4000-8000-0000000000f1' and type = 'action_policy_memo_review' and metadata->>'action' = 'request_changes' and metadata->>'note' = 'Cite the state statute and cost it.'), 'fellow notified with the note');
  perform pg_temp.ok((select diff_from_parent->>'added' = '2' and diff_from_parent->>'removed' = '1' from public.action_policy_memo_versions where memo_id = pg_temp.id('m1') and version_no = 2), 'resubmission diffed against v1');
end $$;

-- owner edit: needs a note and a real change; keeps an immutable version with a diff
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.review_policy_memo(pg_temp.id('m1'), 'start_review');
select pg_temp.must_fail($q$select public.review_policy_memo(pg_temp.id('m1'), 'owner_edit', null, null, 'changed')$q$, '%needs a note%');
select pg_temp.must_fail($q$select public.review_policy_memo(pg_temp.id('m1'), 'owner_edit', 'No change', null, E'Problem\nEvidence: statute 12-34\nRecommendation\nCost: $2M')$q$, '%must change the text%');
select pg_temp.must_fail($q$select public.review_policy_memo(pg_temp.id('m1'), 'owner_edit', 'Empty', null, '   ')$q$, '%needs the edited text%');
select public.review_policy_memo(pg_temp.id('m1'), 'owner_edit', 'Tightened the recommendation; kept your evidence.', null,
  E'Problem\nEvidence: statute 12-34\nRecommendation: fund 200 units\nCost: $2M');
reset role;
do $$ begin
  perform pg_temp.ok((select status = 'owner_edited' and draft_body like '%fund 200 units%' from public.action_policy_memos where id = pg_temp.id('m1')), 'owner_edited; fellow continues from the owner text');
  perform pg_temp.ok((select author_role = 'owner' and note = 'Tightened the recommendation; kept your evidence.'
      and diff_from_parent = '{"format":"lines","added":1,"removed":1,"ops":[{"op":"=","t":"Problem"},{"op":"=","t":"Evidence: statute 12-34"},{"op":"-","t":"Recommendation"},{"op":"+","t":"Recommendation: fund 200 units"},{"op":"=","t":"Cost: $2M"}]}'::jsonb
    from public.action_policy_memo_versions where memo_id = pg_temp.id('m1') and version_no = 3), 'owner version 3 with diff and note');
  perform pg_temp.ok((select count(*) = 1 from public.network_notifications where type = 'action_policy_memo_review' and metadata->>'action' = 'owner_edit'), 'fellow told about the edit');
end $$;
-- the diff fixture shared with scripts/test/policy-fellowship-ladder.test.mjs
do $$ begin
  perform pg_temp.ok(public.action_policy_memo_line_diff(E'a\nb\nc', E'a\nx\nc') =
    '{"format":"lines","added":1,"removed":1,"ops":[{"op":"=","t":"a"},{"op":"-","t":"b"},{"op":"+","t":"x"},{"op":"=","t":"c"}]}'::jsonb, 'line diff fixture');
  perform pg_temp.ok(public.action_policy_memo_line_diff('', 'x') =
    '{"format":"lines","added":1,"removed":1,"ops":[{"op":"-","t":""},{"op":"+","t":"x"}]}'::jsonb, 'line diff from empty');
end $$;

-- versions and the review log are immutable, even for the service role
select pg_temp.must_fail($q$update public.action_policy_memo_versions set body = 'rewritten'$q$, '%immutable%');
select pg_temp.must_fail($q$delete from public.action_policy_memo_versions$q$, '%immutable%');
select pg_temp.must_fail($q$update public.action_policy_memo_reviews set note = 'rewritten'$q$, '%immutable%');
select pg_temp.must_fail($q$delete from public.action_policy_memo_reviews$q$, '%immutable%');

select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.review_policy_memo(pg_temp.id('m1'), 'approve', 'Approved. Sending to the office.');
select pg_temp.must_fail($q$select public.review_policy_memo(pg_temp.id('m1'), 'decline', 'too late')$q$, '%illegal transition: decline from approved%');
reset role;
do $$ begin
  perform pg_temp.ok((select status = 'approved' and decided_at is not null from public.action_policy_memos where id = pg_temp.id('m1')), 'approved');
  perform pg_temp.ok((select string_agg(action, ',' order by created_at, id) from public.action_policy_memo_reviews where memo_id = pg_temp.id('m1'))
    is not null and (select count(*) from public.action_policy_memo_reviews where memo_id = pg_temp.id('m1')) = 7, 'seven audited transitions');
end $$;

-- F: approved memos are closed; history shows the whole chain
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
select pg_temp.must_fail($q$select public.withdraw_policy_memo(pg_temp.id('m1'))$q$, '%illegal transition: withdraw from approved%');
select pg_temp.must_fail($q$select public.add_policy_memo_research_item(pg_temp.id('m1'),'news','gdelt','Late source','https://example.org/a')$q$, '%memo is closed%');
do $$ declare h jsonb := public.policy_memo_history(pg_temp.id('m1')); begin
  perform pg_temp.ok(jsonb_array_length(h->'versions') = 3 and jsonb_array_length(h->'reviews') = 7 and not (h->'memo' ? 'author_uid'), 'history');
end $$;

-- memo 2: research collection, then the "pass" (decline) path
insert into ids select 'm2', (public.create_policy_memo('40000000-0000-4000-8000-0000000000c2','Tenant right to counsel')->>'memo_id')::uuid;
do $$ declare r jsonb; begin
  r := public.add_policy_memo_research_item(pg_temp.id('m2'),'scholarly','openalex','Eviction and health outcomes','https://openalex.org/W0000000001','OpenAlex','W0000000001',null,'CC0 metadata',null,'Lead for the evidence section');
  perform pg_temp.ok(r->>'evidence_status' = 'unverified_lead', 'a search result is a lead');
end $$;
select public.add_policy_memo_research_item(pg_temp.id('m2'),'manual_citation','manual','Smith (2021), cited from Google Scholar by hand');
select pg_temp.must_fail($q$select public.add_policy_memo_research_item(pg_temp.id('m2'),'news','gdelt','No link')$q$, '%check constraint%');
select pg_temp.must_fail($q$select public.add_policy_memo_research_item(pg_temp.id('m2'),'news','gdelt','Plain http','http://example.org/x')$q$, '%check constraint%');
select pg_temp.must_fail($q$select public.add_policy_memo_research_item(pg_temp.id('m2'),'news','google_scholar','Scraped','https://scholar.google.com/x')$q$, '%check constraint%');
do $$ begin
  perform pg_temp.ok((select count(*) = 2 from public.action_policy_memo_research_items where memo_id = pg_temp.id('m2')), 'two research items');
  perform pg_temp.ok((select retrieved_at is not null from public.action_policy_memo_research_items where provider = 'openalex'), 'retrieved_at recorded');
end $$;
select public.save_policy_memo_draft(pg_temp.id('m2'), 'Tenant right to counsel', 'Body');
select public.submit_policy_memo(pg_temp.id('m2'));
reset role;

-- G sees none of F's work
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f2');
do $$ begin
  perform pg_temp.ok((select count(*) from public.action_policy_memos) = 0, 'G sees no memos');
  perform pg_temp.ok((select count(*) from public.action_policy_memo_versions) = 0, 'G sees no versions');
  perform pg_temp.ok((select count(*) from public.action_policy_memo_reviews) = 0, 'G sees no reviews');
  perform pg_temp.ok((select count(*) from public.action_policy_memo_research_items) = 0, 'G sees no research');
end $$;
select pg_temp.must_fail($q$select public.policy_memo_history(pg_temp.id('m1'))$q$, '%memo not found%');
select pg_temp.must_fail($q$select public.add_policy_memo_research_item(pg_temp.id('m2'),'news','gdelt','Intrude','https://example.org/i')$q$, '%memo not found%');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
do $$ begin perform pg_temp.ok((select count(*) from public.action_policy_memos) = 2, 'F sees own two memos'); end $$;
reset role;

select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
do $$ begin perform pg_temp.ok((select count(*) from public.action_policy_memos) = 2, 'desk sees all memos'); end $$;
select public.review_policy_memo(pg_temp.id('m2'), 'start_review');
select pg_temp.must_fail($q$select public.review_policy_memo(pg_temp.id('m2'), 'decline')$q$, '%needs a note%');
select public.review_policy_memo(pg_temp.id('m2'), 'decline', 'Passing: another fellow owns this bill.');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
select pg_temp.must_fail($q$select public.submit_policy_memo(pg_temp.id('m2'))$q$, '%illegal transition: resubmit from declined%');
-- memo 3: withdrawn before review
insert into ids select 'm3', (public.create_policy_memo('40000000-0000-4000-8000-0000000000c1','Withdrawn idea')->>'memo_id')::uuid;
select public.withdraw_policy_memo(pg_temp.id('m3'));
reset role;

-- the desk cannot review its own memo
insert into public.action_policy_memos(id, author_uid, author_m_uid, cohort_id, draft_title, draft_body, status)
values ('50000000-0000-4000-8000-0000000000ad', '00000000-0000-4000-8000-0000000000ad', '10000000-0000-4000-8000-0000000000ad', '40000000-0000-4000-8000-0000000000c1', 'Desk memo', 'x', 'submitted');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select pg_temp.must_fail($q$select public.review_policy_memo('50000000-0000-4000-8000-0000000000ad', 'start_review')$q$, '%cannot review your own memo%');
reset role;

-- erasure path: deleting a memo (service role) cascades through its immutable rows
delete from public.action_policy_memos where id = pg_temp.id('m1');
do $$ begin
  perform pg_temp.ok((select count(*) from public.action_policy_memo_versions where memo_id = pg_temp.id('m1')) = 0, 'versions erased with the memo');
end $$;

-- internal helpers are not callable by members
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
select pg_temp.must_fail($q$select public.policy_ladder_eligible('00000000-0000-4000-8000-0000000000f2')$q$, '%permission denied%');
reset role;

-- ===================== THE UNLOCK RULES (every unlock is a row) =====================
create or replace function pg_temp.unlock(p_key text) returns jsonb language sql as $$
  select x from jsonb_array_elements(public.action_unlock_status()) x where x->>'rule_key' = p_key $$;
grant execute on function pg_temp.unlock(text) to anon, authenticated;

select pg_temp.as_anon();
do $$ begin
  perform pg_temp.ok((pg_temp.unlock('public_free_layer')->>'met')::boolean, 'the free public layer is open to anyone');
  perform pg_temp.ok(not (pg_temp.unlock('member_layers')->>'met')::boolean, 'member layers are locked when logged out');
  perform pg_temp.ok(pg_temp.unlock('policy_fellowship')->>'reason' = 'sign_in', 'anon is asked to sign in');
end $$;
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f2');
do $$ begin perform pg_temp.ok((pg_temp.unlock('member_layers')->>'met')::boolean, 'member layers open when signed in'); end $$;
reset role;

-- the counsel-gated rule ships disabled and cannot be enabled without sign-off
do $$ begin
  perform pg_temp.ok((select not enabled and requires_counsel_signoff and min_count = 3 from public.action_unlock_rules where rule_key = 'equity_uprise_activation'), 'E=Up activation ships disabled');
  -- Whip Equipped (owner, 2026-10-15): open to any signed-in member, no counsel gate, no voter rule
  perform pg_temp.ok((select enabled and not requires_counsel_signoff and min_count is null and requirement_kind = 'signed_in' and params = '{}'::jsonb
    from public.action_unlock_rules where rule_key = 'whip_transport_partner'), 'Whip rule: any signed-in member');
end $$;
select pg_temp.must_fail($q$update public.action_unlock_rules set enabled = true where rule_key = 'equity_uprise_activation'$q$, '%check constraint%');
-- the voter-registration requirement no longer exists, not even as a disabled option
select pg_temp.must_fail($q$update public.action_unlock_rules set requirement_kind = 'registration_assists', min_count = 10 where rule_key = 'whip_transport_partner'$q$, '%check constraint%');
do $$ begin
  perform pg_temp.ok(position('registration_assists' in pg_get_functiondef('public.action_unlock_progress(uuid,text)'::regprocedure)) = 0, 'no voter counting branch in the evaluator');
end $$;
-- Whip: a guest is asked to sign in; any signed-in member qualifies
select pg_temp.as_anon();
do $$ declare u jsonb := pg_temp.unlock('whip_transport_partner'); begin
  perform pg_temp.ok(not (u->>'met')::boolean, 'whip locked for a guest: ' || u::text);
end $$;
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f2');
do $$ declare u jsonb := pg_temp.unlock('whip_transport_partner'); begin
  perform pg_temp.ok((u->>'met')::boolean, 'whip open to a signed-in member with no missions: ' || u::text);
end $$;
reset role;

-- strict verification is status only, and server-written
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f2');
select pg_temp.must_fail($q$insert into public.action_member_verifications(user_id, status) values ('00000000-0000-4000-8000-0000000000f2','verified')$q$, '%permission denied%');
reset role;
select pg_temp.must_fail($q$insert into public.action_member_verifications(user_id, status, provider, provider_reference) values ('00000000-0000-4000-8000-0000000000f2','verified','vendor_x','ref_1')$q$, '%check constraint%');
do $$ begin
  perform pg_temp.ok(not exists (select 1 from information_schema.columns where table_name = 'action_member_verifications'
    and column_name ~ '(image|photo|selfie|face|template|document|dob|birth|ssn)'), 'no biometric or document columns');
end $$;

-- verified referrals: only referred people who passed strict verification count
insert into auth.users(id, email) values ('00000000-0000-4000-8000-0000000000f3','h@test');
insert into public.action_participants(campaign_id, user_id, referral_code, referred_by) values
 ('c', '00000000-0000-4000-8000-0000000000f1', 'FCODE', null),
 ('c', '00000000-0000-4000-8000-0000000000f2', 'GCODE', 'FCODE'),
 ('c', '00000000-0000-4000-8000-0000000000f3', 'HCODE', 'FCODE');
insert into public.action_member_verifications(user_id, status, provider, provider_reference, location_consent_at, location_precision,
  attestation_version, attestation_signed_at, biometric_consent_version, biometric_consent_at, verified_at)
values ('00000000-0000-4000-8000-0000000000f2', 'verified', 'vendor_x', 'ref_g', now(), 'region', 'v1', now(), 'v1', now(), now()),
       ('00000000-0000-4000-8000-0000000000f3', 'pending', null, null, now(), 'region', null, null, null, null, null);
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
do $$ declare u jsonb := pg_temp.unlock('equity_uprise_activation'); begin
  perform pg_temp.ok((u->>'have')::int = 1 and (u->>'need')::int = 3 and not (u->>'met')::boolean and u->>'reason' = 'requires_counsel_signoff', 'one verified referral of three; gated: ' || u::text);
end $$;
reset role;
-- after counsel signs off and the owner enables it with a lower test threshold, it is met
update public.action_unlock_rules set counsel_signoff_at = now(), counsel_signoff_ref = 'fixture', enabled = true, min_count = 1 where rule_key = 'equity_uprise_activation';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
do $$ begin perform pg_temp.ok((pg_temp.unlock('equity_uprise_activation')->>'met')::boolean, 'met after sign-off'); end $$;
reset role;
-- revoked verification stops counting
update public.action_member_verifications set status = 'revoked' where user_id = '00000000-0000-4000-8000-0000000000f2';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
do $$ begin perform pg_temp.ok(not (pg_temp.unlock('equity_uprise_activation')->>'met')::boolean, 'revoked verification does not count'); end $$;
reset role;
-- a disabled rule is never met, even the ladder
update public.action_unlock_rules set enabled = false where rule_key = 'policy_fellowship';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
do $$ begin perform pg_temp.ok(not (pg_temp.unlock('policy_fellowship')->>'met')::boolean and pg_temp.unlock('policy_fellowship')->>'reason' = 'disabled', 'disabled ladder'); end $$;
reset role;
update public.action_unlock_rules set enabled = true where rule_key = 'policy_fellowship';

select 'policy fellowship ladder behaviour: all assertions passed' as result;
