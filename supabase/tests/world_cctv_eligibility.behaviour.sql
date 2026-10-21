-- Behaviour tests for the CCTV "completed a mission" definition the Worker
-- queries (workers/mccluster/src/world-cctv.js MISSION_COMPLETED_QUERY), on a
-- scratch database (scripts/test-world-cctv-db.sh). It is THE predicate of
-- PR #444 (action_member_verified_mission_count): a verified assignment on a
-- mission whose kind is not 'clip'. Location consent is the Privacy Policy
-- acknowledgement on the member's auth record (no table; nothing here).
-- Every check raises on failure.
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
begin perform set_config('request.jwt.claims', '{"role":"service_role"}', false); execute 'reset role'; end $$;
create or replace function pg_temp.must_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm not ilike p_like then raise exception 'expected error like % from [%], got: %', p_like, p_sql, sqlerrm; end if;
    return;
  end;
  raise exception 'expected failure (%), but it succeeded: %', p_like, p_sql;
end $$;
-- the Worker's read, as one boolean (service role): the WHERE clause copied from PR #444's
-- supabase/pending/mission_admin_approval_v1.sql action_member_verified_mission_count()
create or replace function pg_temp.mission_completed(p_user uuid) returns boolean language sql as $$
  select exists (select 1
    from public.action_mission_assignments a
    join public.action_missions m on m.id = a.mission_id
   where p_user is not null and a.user_id = p_user and a.status = 'verified'
     and coalesce(m.kind, 'civic') <> 'clip')
$$;

select pg_temp.as_service();
insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'ana@test'),
  ('00000000-0000-4000-8000-0000000000b2', 'ben@test'),
  ('00000000-0000-4000-8000-0000000000c3', 'matthew@mccluster.org');
insert into public.m_people(id) values ('00000000-0000-4000-8000-00000000aa01'), ('00000000-0000-4000-8000-00000000bb02'), ('00000000-0000-4000-8000-00000000cc03');
insert into public.m_links(user_id, m_uid) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000aa01'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-00000000bb02'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-00000000cc03');
insert into public.action_missions(id, title, status, kind) values
  ('00000000-0000-4000-8000-00000000f001', 'Civic mission', 'open', 'civic'),
  ('00000000-0000-4000-8000-00000000f002', 'Clip job', 'open', 'clip');
-- Ana: a proof, then reviewed verified; Ben: a proof still pending, then rejected
insert into public.action_mission_assignments(id, mission_id, user_id, m_uid, status) values
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000aa01', 'submitted'),
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-00000000bb02', 'submitted'),
  ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000f001', '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-00000000bb02', 'submitted');
insert into public.action_proofs(id, assignment_id, user_id, proof_type, proof_url, statement) values
  ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000000a1', 'link', 'https://example.org/ana', 'did it'),
  ('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-0000000000b2', 'link', 'https://example.org/ben-clip', 'clip'),
  ('00000000-0000-4000-8000-00000000d003', '00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-0000000000b2', 'link', 'https://example.org/ben-civic', 'pending');

do $$ begin
  if pg_temp.mission_completed('00000000-0000-4000-8000-0000000000a1') then raise exception 'a pending proof must not count'; end if;
end $$;

-- the owner reviews through the one writer
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3', 'matthew@mccluster.org');
select public.review_action_proof('00000000-0000-4000-8000-00000000d001', 'verified', 'good');
select pg_temp.as_service();

do $$ begin
  if not pg_temp.mission_completed('00000000-0000-4000-8000-0000000000a1') then raise exception 'a proof reviewed verified makes its assignment verified, and that counts'; end if;
  if (select status from public.action_mission_assignments where id = '00000000-0000-4000-8000-00000000e001') <> 'verified' then raise exception 'review_action_proof must verify the assignment'; end if;
  if pg_temp.mission_completed('00000000-0000-4000-8000-0000000000b2') then raise exception 'pending proofs must not count'; end if;
end $$;

-- a rejected proof never counts (its assignment becomes rejected)
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c3', 'matthew@mccluster.org');
select public.review_action_proof('00000000-0000-4000-8000-00000000d002', 'rejected', 'no');
select public.review_action_proof('00000000-0000-4000-8000-00000000d003', 'rejected', 'no');
select pg_temp.as_service();
do $$ begin
  if pg_temp.mission_completed('00000000-0000-4000-8000-0000000000b2') then raise exception 'a rejected proof must not count'; end if;
end $$;

-- a verified CLIP mission never counts (PR #444: clips are paid distribution work, not a completed mission)
insert into public.action_mission_assignments(id, mission_id, user_id, m_uid, status) values
  ('00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-00000000f002', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000aa01', 'verified');
update public.action_mission_assignments set status = 'verified' where id = '00000000-0000-4000-8000-00000000e002';
do $$ begin
  if pg_temp.mission_completed('00000000-0000-4000-8000-0000000000b2') then raise exception 'a verified clip assignment must not count'; end if;
  if not pg_temp.mission_completed('00000000-0000-4000-8000-0000000000a1') then raise exception 'Ana still has her civic mission'; end if;
end $$;
-- no location-consent table exists any more: location consent is the privacy acknowledgement
do $$ begin
  if to_regclass('public.world_location_consents') is not null then raise exception 'world_location_consents must not exist'; end if;
end $$;
select 'world cctv eligibility: ok';
