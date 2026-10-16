-- Behaviour tests for supabase/pending/mission_admin_approval_v1.sql.
-- Run by scripts/test-mission-admin-approval-db.sh on a scratch Postgres,
-- after the full chain and both pending files. Every person, mission, proof,
-- bounty and clip here is invented and lives only in the throwaway database.
--
-- Each "former path" below is a way a mission could be marked complete, or
-- money/points could move, WITHOUT an admin's own review. Each one must now
-- fail, whoever runs it: the service role (a Worker / Edge Function key), a
-- direct database session (a cron job, a migration), the member themself, or
-- an admin reviewing their own work. The admin path must still work.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.as_user(p_id uuid, p_email text default null) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', coalesce(p_email, p_id::text || '@test'), 'role', 'authenticated')::text, false); execute 'set role authenticated'; end $$;
-- a Worker or Edge Function holding the service-role key: no auth.uid()
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"service_role"}', false); execute 'set role service_role'; end $$;
-- the body of a security-definer RPC running for this caller (writes as the table owner, auth.uid() = caller)
create or replace function pg_temp.as_rpc_for(p_id uuid, p_email text default null) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', coalesce(p_email, p_id::text || '@test'), 'role', 'authenticated')::text, false); execute 'set role service_role'; end $$;
-- a direct database session (pg_cron, a migration): no role, no token
create or replace function pg_temp.as_db() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{}', false); execute 'reset role'; end $$;
create or replace function pg_temp.must_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then
  if sqlerrm not ilike p_like then raise exception 'expected % from [%], got: %', p_like, p_sql, sqlerrm; end if; return; end;
  raise exception 'expected failure (%) but it succeeded: %', p_like, p_sql; end $$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAILED: %', p_what; end if; raise notice 'ok: %', p_what; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;
create temp table ids(k text primary key, v uuid); grant all on ids to anon, authenticated, service_role;
create or replace function pg_temp.id(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
grant execute on function pg_temp.id(text) to anon, authenticated, service_role;
set client_min_messages = notice;

-- fixtures (direct session): M a member, N another member, A the desk (eu_is_admin via the owner email)
insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-00000000aa01','m@test'), ('00000000-0000-4000-8000-00000000aa02','n@test'),
 ('00000000-0000-4000-8000-00000000aaad','matthew@mccluster.org');
insert into public.m_people(id) values
 ('10000000-0000-4000-8000-00000000aa01'), ('10000000-0000-4000-8000-00000000aa02'), ('10000000-0000-4000-8000-00000000aaad');
insert into public.m_links(user_id, m_uid) values
 ('00000000-0000-4000-8000-00000000aa01','10000000-0000-4000-8000-00000000aa01'),
 ('00000000-0000-4000-8000-00000000aa02','10000000-0000-4000-8000-00000000aa02'),
 ('00000000-0000-4000-8000-00000000aaad','10000000-0000-4000-8000-00000000aaad');
insert into ids values ('M','00000000-0000-4000-8000-00000000aa01'), ('N','00000000-0000-4000-8000-00000000aa02'),
 ('A','00000000-0000-4000-8000-00000000aaad'), ('Am','10000000-0000-4000-8000-00000000aaad'), ('Mm','10000000-0000-4000-8000-00000000aa01');
insert into public.action_missions(id, title, status, skills) values
 ('20000000-0000-4000-8000-00000000aa01','Fixture mission one','open','{field}'),
 ('20000000-0000-4000-8000-00000000aa02','Fixture mission two','open','{field}'),
 ('20000000-0000-4000-8000-00000000aa03','Fixture mission three','open','{field}');

-- M joins and files proofs through the real RPCs (the camera loop is submit_action_proof)
select pg_temp.as_user(pg_temp.id('M'));
insert into ids select 'a1', (public.join_action_mission('20000000-0000-4000-8000-00000000aa01')->>'assignment_id')::uuid;
insert into ids select 'a2', (public.join_action_mission('20000000-0000-4000-8000-00000000aa02')->>'assignment_id')::uuid;
insert into ids select 'p1', (public.submit_action_proof(pg_temp.id('a1'),'link','https://example.com/proof-1','Helped a neighbour reach a food bank today.')->>'proof_id')::uuid;
insert into ids select 'p2', (public.submit_action_proof(pg_temp.id('a2'),'link','https://example.com/proof-2','Helped a neighbour reach a shelter intake.')->>'proof_id')::uuid;
-- the admin joins mission three and files their own proof
select pg_temp.as_user(pg_temp.id('A'), 'matthew@mccluster.org');
insert into ids select 'aA', (public.join_action_mission('20000000-0000-4000-8000-00000000aa03')->>'assignment_id')::uuid;
insert into ids select 'pA', (public.submit_action_proof(pg_temp.id('aA'),'link','https://example.com/proof-a','The desk did a mission of its own as well.')->>'proof_id')::uuid;
select pg_temp.as_db();

do $$ begin
  perform pg_temp.ok((select status from public.action_proofs where id = pg_temp.id('p1')) = 'pending'
    and (select status from public.action_mission_assignments where id = pg_temp.id('a1')) = 'submitted',
    'P1 camera loop / submit_action_proof: the proof is pending review and the assignment only submitted');
end $$;

-- P2. A proof is born pending: nobody files a proof as already verified.
select pg_temp.as_service();
select pg_temp.must_fail($q$insert into public.action_proofs(assignment_id, user_id, proof_type, statement, status)
  values (pg_temp.id('a2'), pg_temp.id('M'), 'text', 'a proof that claims to be verified already', 'verified')$q$, '%filed as pending%');
select pg_temp.as_db();
select pg_temp.must_fail($q$insert into public.action_proofs(assignment_id, user_id, proof_type, statement, status)
  values (pg_temp.id('a2'), pg_temp.id('M'), 'text', 'a proof that claims to be verified already', 'verified')$q$, '%filed as pending%');
select pg_temp.ok(true, 'P2 insert of an already-verified proof refused (service role, direct session)');

-- P3. The service role / a cron job cannot verify a proof.
select pg_temp.as_service();
select pg_temp.must_fail($q$update public.action_proofs set status='verified', reviewer_uid=pg_temp.id('Am'), reviewed_at=now() where id=pg_temp.id('p1')$q$, '%only an admin can verify%');
select pg_temp.as_db();
select pg_temp.must_fail($q$update public.action_proofs set status='verified', reviewer_uid=pg_temp.id('Am'), reviewed_at=now() where id=pg_temp.id('p1')$q$, '%only an admin can verify%');
select pg_temp.ok(true, 'P3 proof verification without an admin token refused (service role, direct session)');

-- P4. The member cannot verify their own proof, by RPC or by table.
select pg_temp.as_user(pg_temp.id('M'));
select pg_temp.must_fail($q$select public.review_action_proof(pg_temp.id('p1'),'verified',null)$q$, '%not authorized%');
select pg_temp.must_fail($q$update public.action_proofs set status='verified' where id=pg_temp.id('p1')$q$, '%permission denied%');
select pg_temp.must_fail($q$update public.action_mission_assignments set status='verified' where id=pg_temp.id('a1')$q$, '%permission denied%');
select pg_temp.as_rpc_for(pg_temp.id('M'));
select pg_temp.must_fail($q$update public.action_proofs set status='verified', reviewer_uid=pg_temp.id('Mm'), reviewed_at=now() where id=pg_temp.id('p1')$q$, '%only an admin can verify%');
select pg_temp.ok(true, 'P4 member self-verification refused (RPC, table, and inside any definer body)');

-- P5. An admin cannot verify their OWN proof, even inside a definer body.
select pg_temp.as_user(pg_temp.id('A'), 'matthew@mccluster.org');
select pg_temp.must_fail($q$select public.review_action_proof(pg_temp.id('pA'),'verified',null)$q$, '%your own proof%');
select pg_temp.as_rpc_for(pg_temp.id('A'), 'matthew@mccluster.org');
select pg_temp.must_fail($q$update public.action_proofs set status='verified', reviewer_uid=pg_temp.id('Am'), reviewed_at=now() where id=pg_temp.id('pA')$q$, '%your own proof%');
select pg_temp.must_fail($q$update public.action_mission_assignments set status='verified' where id=pg_temp.id('aA')$q$, '%your own mission%');
select pg_temp.ok(true, 'P5 admin self-review refused');

-- P6. No path marks an assignment complete without an admin's recorded review.
select pg_temp.as_service();
select pg_temp.must_fail($q$update public.action_mission_assignments set status='verified', verified_at=now() where id=pg_temp.id('a1')$q$, '%only an admin can mark%');
select pg_temp.must_fail($q$insert into public.action_mission_assignments(mission_id, user_id, m_uid, status) values ('20000000-0000-4000-8000-00000000aa03', pg_temp.id('N'), '10000000-0000-4000-8000-00000000aa02', 'verified')$q$, '%only an admin review verifies%');
select pg_temp.as_db();
select pg_temp.must_fail($q$update public.action_mission_assignments set status='verified', verified_at=now() where id=pg_temp.id('a1')$q$, '%only an admin can mark%');
-- an admin token alone is not enough: there must be a review in this transaction
select pg_temp.as_rpc_for(pg_temp.id('A'), 'matthew@mccluster.org');
select pg_temp.must_fail($q$update public.action_mission_assignments set status='verified', verified_at=now() where id=pg_temp.id('a1')$q$, '%recorded admin review%');
select pg_temp.ok(true, 'P6 assignment verification without a recorded admin review refused (service, direct, admin token without review)');

-- P7. Points are minted only by an admin review, never to oneself.
select pg_temp.as_service();
select pg_temp.must_fail($q$insert into public.action_points_ledger(m_uid, assignment_id, kind, points, reason) values (pg_temp.id('Mm'), pg_temp.id('a1'), 'mission', 100, 'farm')$q$, '%only an admin review awards%');
select pg_temp.must_fail($q$insert into public.action_points_ledger(m_uid, kind, points, reason) values (pg_temp.id('Mm'), 'adjustment', 500, 'farm')$q$, '%only an admin review awards%');
select pg_temp.as_db();
select pg_temp.must_fail($q$insert into public.action_points_ledger(m_uid, kind, points, reason) values (pg_temp.id('Mm'), 'consistency', 500, 'cron')$q$, '%only an admin review awards%');
select pg_temp.as_rpc_for(pg_temp.id('A'), 'matthew@mccluster.org');
select pg_temp.must_fail($q$insert into public.action_points_ledger(m_uid, kind, points, reason) values (pg_temp.id('Am'), 'adjustment', 500, 'self')$q$, '%points to yourself%');
select pg_temp.must_fail($q$insert into public.action_points_ledger(m_uid, assignment_id, kind, points, reason) values (pg_temp.id('Mm'), pg_temp.id('a1'), 'mission', 100, 'no review')$q$, '%recorded admin review%');
select pg_temp.ok(true, 'P7 points without an admin review refused (service, direct, self-award, award without review)');

-- P8. A bounty is approved only behind a verified mission, paid only by an admin.
select pg_temp.as_db();
insert into public.action_bounty_claims(assignment_id, user_id, m_uid, status) values (pg_temp.id('a2'), pg_temp.id('M'), pg_temp.id('Mm'), 'submitted');
select pg_temp.must_fail($q$insert into public.action_bounty_claims(assignment_id, user_id, m_uid, status) values (pg_temp.id('aA'), pg_temp.id('A'), pg_temp.id('Am'), 'approved')$q$, '%starts reserved%');
select pg_temp.as_service();
select pg_temp.must_fail($q$update public.action_bounty_claims set status='approved' where assignment_id=pg_temp.id('a2')$q$, '%only after an admin verified%');
select pg_temp.ok(true, 'P8a bounty approval before mission verification refused');

-- THE ADMIN PATH STILL WORKS: review_action_proof as the desk.
select pg_temp.as_user(pg_temp.id('A'), 'matthew@mccluster.org');
select public.review_action_proof(pg_temp.id('p1'),'verified','seen');
select public.review_action_proof(pg_temp.id('p2'),'verified','seen');
select pg_temp.as_db();
do $$ begin
  perform pg_temp.ok((select status from public.action_mission_assignments where id = pg_temp.id('a1')) = 'verified',
    'ADMIN review_action_proof verifies the assignment');
  perform pg_temp.ok((select count(*) from public.action_proof_review_history h where h.assignment_id = pg_temp.id('a1')
      and h.decision = 'verified' and h.source = 'proof' and h.reviewer_uid = pg_temp.id('Am')) = 1,
    'ADMIN the verification wrote action_proof_review_history with the reviewer');
  perform pg_temp.ok((select count(*) from public.action_points_ledger where assignment_id = pg_temp.id('a1') and kind = 'mission') = 1,
    'ADMIN points minted once, after the review');
  perform pg_temp.ok((select status from public.action_bounty_claims where assignment_id = pg_temp.id('a2')) = 'approved',
    'P8b the bounty follows the verified mission to approved (sync trigger)');
end $$;

-- P9. An old review cannot be replayed later to re-verify.
select pg_temp.as_db();
alter table public.action_mission_assignments disable trigger action_assignment_verify_guard;
update public.action_mission_assignments set status = 'submitted' where id = pg_temp.id('a1');  -- fixture only
alter table public.action_mission_assignments enable trigger action_assignment_verify_guard;
select pg_temp.as_rpc_for(pg_temp.id('A'), 'matthew@mccluster.org');
select pg_temp.must_fail($q$update public.action_mission_assignments set status='verified' where id=pg_temp.id('a1')$q$, '%recorded admin review%');
select pg_temp.ok(true, 'P9 a review from an earlier transaction cannot verify again');

-- P8c. Payout: never the service role, never the claimant.
select pg_temp.as_service();
select pg_temp.must_fail($q$update public.action_bounty_claims set status='paid', paid_at=now() where assignment_id=pg_temp.id('a2')$q$, '%only an admin records%');
select pg_temp.as_rpc_for(pg_temp.id('M'));
select pg_temp.must_fail($q$update public.action_bounty_claims set status='paid', paid_at=now() where assignment_id=pg_temp.id('a2')$q$, '%only an admin records%');
select pg_temp.as_rpc_for(pg_temp.id('A'), 'matthew@mccluster.org');
update public.action_bounty_claims set status='paid', paid_at=now() where assignment_id=pg_temp.id('a2');
select pg_temp.as_db();
select pg_temp.ok((select status from public.action_bounty_claims where assignment_id = pg_temp.id('a2')) = 'paid', 'P8c bounty paid only by the admin');

-- P10. Anti-Social levels: verified only by an admin, and the review is archived.
select pg_temp.as_user(pg_temp.id('N'));
insert into ids select 'asN', (public.join_action_mission('a17050c1-a551-4c5c-80c1-5a1750c1a001')->>'assignment_id')::uuid;
select pg_temp.as_db();
insert into public.action_antisocial_levels(assignment_id, level, user_id, proof_url, statement)
  values (pg_temp.id('asN'), 1, pg_temp.id('N'), 'https://example.com/high-five', 'One high five, offered and taken.');
select pg_temp.must_fail($q$insert into public.action_antisocial_levels(assignment_id, level, user_id, statement, status) values (pg_temp.id('asN'), 2, pg_temp.id('N'), 'already done', 'verified')$q$, '%filed as pending%');
select pg_temp.as_service();
select pg_temp.must_fail($q$update public.action_antisocial_levels set status='verified' where assignment_id=pg_temp.id('asN') and level=1$q$, '%only an admin can verify a mission level%');
select pg_temp.as_rpc_for(pg_temp.id('N'));
select pg_temp.must_fail($q$update public.action_antisocial_levels set status='verified' where assignment_id=pg_temp.id('asN') and level=1$q$, '%only an admin can verify a mission level%');
select pg_temp.as_user(pg_temp.id('A'), 'matthew@mccluster.org');
select public.review_antisocial_level(pg_temp.id('asN'), 1::smallint, 'verified', 'seen');
select pg_temp.as_db();
select pg_temp.ok((select count(*) from public.action_proof_review_history where assignment_id = pg_temp.id('asN')
   and source = 'antisocial_level' and level = 1 and decision = 'verified' and proof_id is null and reviewer_uid = pg_temp.id('Am')) = 1,
  'P10 Anti-Social level: service/self refused; the admin review is archived in action_proof_review_history');

-- P11. Clips (paid): no automatic approval, no money without an approved clip.
select pg_temp.as_db();
insert into public.orgs(id, owner_uid) values ('30000000-0000-4000-8000-0000000000c1', pg_temp.id('N'));
insert into public.action_missions(id, title, status, kind) values ('20000000-0000-4000-8000-0000000000c1', 'Fixture clip campaign', 'draft', 'clip');
select pg_temp.as_service();
insert into public.action_clip_campaigns(mission_id, org_id, approval_mode) values ('20000000-0000-4000-8000-0000000000c1', '30000000-0000-4000-8000-0000000000c1', 'auto');
with x as (insert into public.action_clip_claims(mission_id) values ('20000000-0000-4000-8000-0000000000c1') returning id) insert into ids select 'k1', id from x;
with x as (insert into public.action_clip_submissions(mission_id, claim_id, user_id, review_state)
  values ('20000000-0000-4000-8000-0000000000c1', pg_temp.id('k1'), pg_temp.id('M'), 'not_required') returning id) insert into ids select 's1', id from x;
insert into public.action_clip_earnings(mission_id, claim_id, submission_id) values ('20000000-0000-4000-8000-0000000000c1', pg_temp.id('k1'), pg_temp.id('s1'));
insert into public.action_clip_earnings(mission_id, claim_id, submission_id) values ('20000000-0000-4000-8000-0000000000c1', pg_temp.id('k1'), null);
select pg_temp.ok((select approval_mode from public.action_clip_campaigns) = 'creator', 'P11a an auto-approval campaign is stored as creator review');
select pg_temp.ok((select review_state from public.action_clip_submissions where id = pg_temp.id('s1')) = 'pending', 'P11b a not_required clip is filed as pending review');
select pg_temp.ok((public.clip_release_due()->>'released')::int = 0, 'P11c the scheduled release moves nothing before approval');
select pg_temp.must_fail($q$update public.action_clip_earnings set state='payable' where submission_id=pg_temp.id('s1')$q$, '%approved clip%');
select pg_temp.must_fail($q$update public.action_clip_earnings set state='payable' where submission_id is null$q$, '%approved clip%');
select pg_temp.must_fail($q$update public.action_clip_submissions set review_state='approved' where id=pg_temp.id('s1')$q$, '%campaign owner or an admin%');
select pg_temp.as_rpc_for(pg_temp.id('M'));
select pg_temp.must_fail($q$update public.action_clip_submissions set review_state='approved' where id=pg_temp.id('s1')$q$, '%campaign owner or an admin%');
-- the campaign owner approves (clip_review_submission's path)
select pg_temp.as_rpc_for(pg_temp.id('N'));
update public.action_clip_submissions set review_state='approved' where id=pg_temp.id('s1');
select pg_temp.as_service();
select pg_temp.ok((public.clip_release_due()->>'released')::int = 2, 'P11d after the owner approved the clip, its earning and the bonus release');
-- the clipper cannot approve their own clip even as the campaign owner
select pg_temp.as_db();
with x as (insert into public.action_clip_submissions(mission_id, claim_id, user_id) values ('20000000-0000-4000-8000-0000000000c1', pg_temp.id('k1'), pg_temp.id('N')) returning id) insert into ids select 's2', id from x;
select pg_temp.as_rpc_for(pg_temp.id('N'));
select pg_temp.must_fail($q$update public.action_clip_submissions set review_state='approved' where id=pg_temp.id('s2')$q$, '%your own clip%');
select pg_temp.ok(true, 'P11e clip approval refused for the service role, the clipper, and an owner reviewing their own clip');

-- P12. A mission goes live only after an admin approved it.
select pg_temp.as_service();
select pg_temp.must_fail($q$insert into public.action_missions(title, status) values ('Fixture: straight to open', 'open')$q$, '%draft until an admin%');
with x as (insert into public.action_missions(title, status) values ('Fixture: from a decision', 'draft') returning id) insert into ids select 'dm', id from x;
select pg_temp.must_fail($q$update public.action_missions set status='open' where id=pg_temp.id('dm')$q$, '%draft until an admin%');
select pg_temp.must_fail($q$update public.action_missions set publish_approved_at=now() where id=pg_temp.id('dm')$q$, '%only an admin approves%');
select pg_temp.as_user(pg_temp.id('N'));
select pg_temp.must_fail($q$select public.approve_action_mission_publication(pg_temp.id('dm'))$q$, '%not authorized%');
-- the clip owner's path (clip_campaign_set_status 'live') needs the desk's approval first
select pg_temp.as_rpc_for(pg_temp.id('N'));
select pg_temp.must_fail($q$update public.action_missions set status='open' where id='20000000-0000-4000-8000-0000000000c1'$q$, '%draft until an admin%');
select pg_temp.as_user(pg_temp.id('A'), 'matthew@mccluster.org');
select public.approve_action_mission_publication('20000000-0000-4000-8000-0000000000c1');
select pg_temp.as_rpc_for(pg_temp.id('N'));
update public.action_missions set status='open' where id='20000000-0000-4000-8000-0000000000c1';
-- the desk publishes a decision's draft directly (control room PATCH under RLS)
select pg_temp.as_user(pg_temp.id('A'), 'matthew@mccluster.org');
update public.action_missions set status='open' where id=pg_temp.id('dm');
select pg_temp.as_db();
select pg_temp.ok((select status = 'open' and publish_approved_by = pg_temp.id('A') from public.action_missions where id = pg_temp.id('dm')),
  'P12 a draft opens only by the desk (stamped with the approver); service role, non-admin and the clip owner before approval refused');

-- the shared predicate
select pg_temp.ok(public.action_member_verified_mission_count(pg_temp.id('M')) = 1 and public.action_member_has_verified_mission(pg_temp.id('M'))
  and not public.action_member_has_verified_mission(pg_temp.id('N')),
  'shared predicate: M has one admin-verified mission (a1 was reset in P9), N none');

select 'mission admin approval behaviour: all assertions passed';
