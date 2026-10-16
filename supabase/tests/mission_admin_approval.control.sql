-- CONTROL for supabase/tests/mission_admin_approval.behaviour.sql: the same
-- chain WITHOUT supabase/pending/mission_admin_approval_v1.sql. Each write
-- below is one of the former paths; here they all SUCCEED, which is the gap
-- the pending file closes. Run by scripts/test-mission-admin-approval-db.sh.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'CONTROL FAILED: %', p_what; end if; raise notice 'gap (before): %', p_what; end $$;
grant execute on all functions in schema pg_temp to service_role;
insert into auth.users(id, email) values ('00000000-0000-4000-8000-00000000cc01','c@test');
insert into public.m_people(id) values ('10000000-0000-4000-8000-00000000cc01');
insert into public.m_links(user_id, m_uid) values ('00000000-0000-4000-8000-00000000cc01','10000000-0000-4000-8000-00000000cc01');
insert into public.action_missions(id, title, status, skills) values ('20000000-0000-4000-8000-00000000cc01','Control mission','open','{field}');
select set_config('request.jwt.claims', json_build_object('sub','00000000-0000-4000-8000-00000000cc01','role','authenticated')::text, false);
create temp table cids(a uuid); grant all on cids to authenticated, service_role;
set role authenticated;
insert into cids select (public.join_action_mission('20000000-0000-4000-8000-00000000cc01')->>'assignment_id')::uuid;
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
insert into public.action_proofs(assignment_id, user_id, proof_type, statement, status)
  select a, '00000000-0000-4000-8000-00000000cc01', 'text', 'filed as verified by a service key', 'verified' from cids;
select pg_temp.ok(true, 'a service-role key files a proof already verified');
update public.action_mission_assignments set status = 'verified', verified_at = now() where id = (select a from cids);
select pg_temp.ok((select status from public.action_mission_assignments where id = (select a from cids)) = 'verified',
  'a service-role key marks a mission complete with no admin review and no review history');
insert into public.action_points_ledger(m_uid, assignment_id, kind, points, reason)
  select '10000000-0000-4000-8000-00000000cc01', a, 'mission', 100, 'minted by a key' from cids;
select pg_temp.ok(true, 'a service-role key mints mission points');
select pg_temp.ok((select count(*) from public.action_proof_review_history where assignment_id = (select a from cids)) = 0,
  'that completion left no action_proof_review_history row');
insert into public.action_missions(title, status) values ('Control: opened by a key', 'open');
select pg_temp.ok(true, 'a service-role key publishes a mission straight to open');
reset role;
insert into public.orgs(id, owner_uid) values ('30000000-0000-4000-8000-0000000000cc', null);
insert into public.action_missions(id, title, status, kind) values ('20000000-0000-4000-8000-0000000000cc', 'Control clip', 'draft', 'clip');
insert into public.action_clip_campaigns(mission_id, org_id, approval_mode) values ('20000000-0000-4000-8000-0000000000cc', '30000000-0000-4000-8000-0000000000cc', 'auto');
with k as (insert into public.action_clip_claims(mission_id) values ('20000000-0000-4000-8000-0000000000cc') returning id),
     s as (insert into public.action_clip_submissions(mission_id, claim_id, user_id, review_state)
           select '20000000-0000-4000-8000-0000000000cc', k.id, '00000000-0000-4000-8000-00000000cc01', 'not_required' from k returning id, claim_id)
insert into public.action_clip_earnings(mission_id, claim_id, submission_id) select '20000000-0000-4000-8000-0000000000cc', s.claim_id, s.id from s;
select pg_temp.ok((public.clip_release_due()->>'released')::int = 1, 'an auto-approval clip campaign releases clip money with no human review');
select 'control: the gap is real before the pending file';
