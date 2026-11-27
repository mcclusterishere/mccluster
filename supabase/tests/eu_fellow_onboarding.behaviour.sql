-- Behaviour tests for supabase/pending/eu_fellow_onboarding_v1.sql, run by
-- scripts/test-eu-fellow-onboarding-db.sh in a scratch database as the real
-- API roles. Every promise the onboarding makes is tried from the side that
-- would break it.
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
grant execute on all functions in schema pg_temp to anon, authenticated;

-- people: O the owner (admin by email), A asks for an invitation, B is invited, C is a stranger
insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org'),
 ('00000000-0000-4000-8000-00000000000a', 'a@test'),
 ('00000000-0000-4000-8000-00000000000b', 'b@test'),
 ('00000000-0000-4000-8000-00000000000c', 'c@test');
insert into public.m_people(id) values
 ('10000000-0000-4000-8000-0000000000ad'), ('10000000-0000-4000-8000-00000000000a'),
 ('10000000-0000-4000-8000-00000000000b'), ('10000000-0000-4000-8000-00000000000c');
insert into public.m_links(user_id, m_uid) values
 ('00000000-0000-4000-8000-0000000000ad', '10000000-0000-4000-8000-0000000000ad'),
 ('00000000-0000-4000-8000-00000000000a', '10000000-0000-4000-8000-00000000000a'),
 ('00000000-0000-4000-8000-00000000000b', '10000000-0000-4000-8000-00000000000b'),
 ('00000000-0000-4000-8000-00000000000c', '10000000-0000-4000-8000-00000000000c');
create temp table k(name text primary key, v text); grant all on k to anon, authenticated;

-- 1. the 2026 cohort exists, mirrors Cohort 1's campaign, has no members, and requests ship closed
do $$ begin
 if (select count(*) from public.eu_fellow_cohorts) <> 1 then raise exception 'expected exactly one fellowship cohort'; end if;
 if not exists (select 1 from public.action_cohorts where id = 'a8813ab5-f066-47c2-976c-c19581b3cb71'
   and campaign_id = 'equity-uprise-003' and status = 'active') then raise exception '2026 cohort row wrong'; end if;
 if (select requests_open from public.eu_fellow_cohorts) then raise exception 'requests must ship closed'; end if;
 if exists (select 1 from public.action_cohort_members) or exists (select 1 from public.eu_fellow_enrollments) then
   raise exception 'no members may be seeded'; end if;
 if (select forms_by from public.eu_fellow_cohorts) <> date '2026-12-31' then raise exception 'forms_by wrong'; end if;
end $$;
\echo '  ✓ 2026 cohort seeded under equity-uprise-003, empty, requests closed'

-- 2. a visitor sees the forming cohort and nothing private; cannot touch any table
select pg_temp.as_anon();
do $$ declare s jsonb := public.eu_fellow_status(); begin
 if (s->>'signed_in')::boolean or s->'enrollment' <> 'null'::jsonb or jsonb_array_length(s->'cohorts') <> 1 then raise exception 'anon status wrong: %', s; end if;
 if (s->'cohorts'->0->>'slug') <> 'equity-uprise-2026' then raise exception 'cohort slug wrong'; end if;
end $$;
select pg_temp.must_fail($q$select * from public.eu_fellow_invites$q$, '%permission denied%');
select pg_temp.must_fail($q$select * from public.eu_fellow_enrollments$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.eu_fellow_apply('a8813ab5-f066-47c2-976c-c19581b3cb71','Anon','', repeat('x', 60))$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.eu_fellow_issue_invite('a8813ab5-f066-47c2-976c-c19581b3cb71')$q$, '%permission denied%');
reset role;
\echo '  ✓ a visitor reads the cohort, never the queue or the invitations'

-- 3. invite only: while requests are closed, a member cannot ask, and cannot write a row by hand
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.must_fail($q$select public.eu_fellow_apply('a8813ab5-f066-47c2-976c-c19581b3cb71','Artist A','Songwriter','I want to write songs about housing in Bridgeport and take them to council.')$q$, '%invite only right now%');
select pg_temp.must_fail($q$insert into public.eu_fellow_enrollments(cohort_id,user_id,m_uid,path,status,display_name,statement) values ('a8813ab5-f066-47c2-976c-c19581b3cb71','00000000-0000-4000-8000-00000000000a','10000000-0000-4000-8000-00000000000a','invite','fellow','A',repeat('x',50))$q$, '%permission denied%');
select pg_temp.must_fail($q$update public.eu_fellow_cohorts set requests_open = true$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.eu_fellow_set_requests_open('a8813ab5-f066-47c2-976c-c19581b3cb71', true)$q$, '%not authorized%');
select pg_temp.must_fail($q$select public.eu_fellow_issue_invite('a8813ab5-f066-47c2-976c-c19581b3cb71')$q$, '%not authorized%');
select pg_temp.must_fail($q$select public.eu_fellow_desk()$q$, '%not authorized%');
reset role;
\echo '  ✓ closed requests refuse; members cannot write, open requests, invite or read the desk'

-- 4. the owner opens requests; A asks; validation holds; one request per cohort
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.eu_fellow_set_requests_open('a8813ab5-f066-47c2-976c-c19581b3cb71', true);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.must_fail($q$select public.eu_fellow_apply('a8813ab5-f066-47c2-976c-c19581b3cb71','Artist A','','too short')$q$, '%at least 40 characters%');
select pg_temp.must_fail($q$select public.eu_fellow_apply('a8813ab5-f066-47c2-976c-c19581b3cb71','Artist A','','I want to write songs about housing in Bridgeport and take them to council.', array['http://insecure.example'])$q$, '%https://%');
insert into k select 'a_id', public.eu_fellow_apply('a8813ab5-f066-47c2-976c-c19581b3cb71','Artist A','Songwriter',
  'I want to write songs about housing in Bridgeport and take them to council.', array['https://example.org/a'])->>'id';
select pg_temp.must_fail($q$select public.eu_fellow_apply('a8813ab5-f066-47c2-976c-c19581b3cb71','Artist A','','Asking a second time while the first request is still open.')$q$, '%already have a place%');
-- a requested person cannot onboard or seat themselves
select pg_temp.must_fail($q$select public.eu_fellow_onboarding_step('agreement','I agree')$q$, '%once you are accepted%');
select pg_temp.must_fail($q$select public.eu_fellow_review((select v::uuid from k where name='a_id'),'accepted')$q$, '%not authorized%');
do $$ declare s jsonb := public.eu_fellow_status(); begin
 if s->'enrollment'->>'status' <> 'requested' or s->'enrollment'->>'path' <> 'request' then raise exception 'A status wrong: %', s; end if;
end $$;
reset role;
\echo '  ✓ with requests open, a member asks once; a request cannot onboard or review itself'

-- 5. C cannot see A's request
select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
do $$ begin
 if exists (select 1 from public.eu_fellow_enrollments) then raise exception 'C can see someone else''s request'; end if;
 if public.eu_fellow_status()->'enrollment' <> 'null'::jsonb then raise exception 'C status leaks'; end if;
end $$;
reset role;
\echo '  ✓ requests are private to their owner and the desk'

-- 6. the owner reviews (and cannot review twice); an admin cannot accept themselves
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
do $$ declare r jsonb := public.eu_fellow_review((select v::uuid from k where name='a_id'), 'accepted', 'Welcome to the 2026 cohort.'); begin
 if r->>'status' <> 'accepted' then raise exception 'review wrong: %', r; end if;
 r := public.eu_fellow_review((select v::uuid from k where name='a_id'), 'declined');
 if r->>'status' <> 'accepted' or not (r->>'idempotent')::boolean then raise exception 'second review must be a no-op: %', r; end if;
 if jsonb_array_length(public.eu_fellow_desk()->'enrollments') <> 1 then raise exception 'desk must see the queue'; end if;
end $$;
insert into k select 'o_id', public.eu_fellow_apply('a8813ab5-f066-47c2-976c-c19581b3cb71','Owner','','The owner asking for a seat in his own cohort, to prove he cannot accept it.')->>'id';
select pg_temp.must_fail($q$select public.eu_fellow_review((select v::uuid from k where name='o_id'),'accepted')$q$, '%cannot review your own%');
reset role;
\echo '  ✓ the desk accepts once; nobody reviews their own request'

-- 7. A onboards: three steps, validated, and the third makes A a fellow seated in the roster
select pg_temp.as_user('00000000-0000-4000-8000-00000000000a');
select pg_temp.must_fail($q$select public.eu_fellow_onboarding_step('agreement','sure')$q$, '%type I agree%');
select pg_temp.must_fail($q$select public.eu_fellow_onboarding_step('intro','short')$q$, '%20 to 600%');
select pg_temp.must_fail($q$select public.eu_fellow_onboarding_step('payout','x')$q$, '%unknown onboarding step%');
select public.eu_fellow_onboarding_step('agreement', 'I agree');
select public.eu_fellow_onboarding_step('intro', 'Songwriter from the East End writing about housing.');
do $$ declare r jsonb; begin
 if exists (select 1 from public.action_cohort_members) then raise exception 'seated before onboarding finished'; end if;
 r := public.eu_fellow_onboarding_step('work_plan', 'Two songs on housing by March, a public comment at the April council meeting, and a live set at the capstone.');
 if r->>'status' <> 'fellow' or r->>'fellow_at' is null then raise exception 'not a fellow after the third step: %', r; end if;
 if not exists (select 1 from public.action_cohort_members where cohort_id='a8813ab5-f066-47c2-976c-c19581b3cb71' and m_uid='10000000-0000-4000-8000-00000000000a') then
   raise exception 'fellow must be seated in the 2026 roster'; end if;
end $$;
select pg_temp.must_fail($q$select public.eu_fellow_onboarding_step('intro','Trying to edit after becoming a fellow.')$q$, '%once you are accepted%');
select pg_temp.must_fail($q$select public.eu_fellow_withdraw()$q$, '%nothing to withdraw%');
reset role;
\echo '  ✓ three onboarding steps make an accepted person a fellow, seated in the cohort roster'

-- 8. invitations: issued by the desk only, token returned once, hash stored, single use, expiring
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select pg_temp.must_fail($q$select public.eu_fellow_issue_invite('a8813ab5-f066-47c2-976c-c19581b3cb71','B',45)$q$, '%1 to 30 days%');
insert into k select 'b_tok', public.eu_fellow_issue_invite('a8813ab5-f066-47c2-976c-c19581b3cb71', 'Invitation for B', 14)->>'token';
insert into k select 'x_tok', public.eu_fellow_issue_invite('a8813ab5-f066-47c2-976c-c19581b3cb71', 'Revoked one', 7)->>'token';
reset role;
do $$ begin
 if (select v from k where name='b_tok') !~ '^[a-f0-9]{64}$' then raise exception 'token shape wrong'; end if;
 if exists (select 1 from public.eu_fellow_invites where token_hash in (select v from k)) then raise exception 'raw token stored'; end if;
 if not exists (select 1 from public.eu_fellow_invites where token_hash = public.eu_fellow_token_hash((select v from k where name='b_tok'))) then raise exception 'hash not stored'; end if;
end $$;
insert into k select 'x_hash', public.eu_fellow_token_hash((select v from k where name='x_tok'));
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.eu_fellow_revoke_invite((select v from k where name='x_hash'));
select pg_temp.must_fail($q$select public.eu_fellow_revoke_invite((select v from k where name='x_hash'))$q$, '%no open invitation%');
reset role;
select pg_temp.as_anon();
do $$ begin
 if public.eu_fellow_invite_preview((select v from k where name='b_tok'))->'cohort'->>'slug' <> 'equity-uprise-2026' then raise exception 'preview wrong'; end if;
 if public.eu_fellow_invite_preview((select v from k where name='x_tok')) is not null then raise exception 'a revoked invitation previews'; end if;
 if public.eu_fellow_invite_preview(repeat('0', 64)) is not null then raise exception 'a made-up token previews'; end if;
end $$;
select pg_temp.must_fail($q$select public.eu_fellow_accept_invite((select v from k where name='b_tok'),'B','', repeat('x', 60))$q$, '%permission denied%');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select pg_temp.must_fail($q$select public.eu_fellow_accept_invite((select v from k where name='x_tok'),'B','Producer','I make beats about the river and the people who fish it every summer.')$q$, '%INVITATION_UNAVAILABLE%');
select pg_temp.must_fail($q$select public.eu_fellow_accept_invite('not-a-token','B','Producer','I make beats about the river and the people who fish it every summer.')$q$, '%INVITATION_UNAVAILABLE%');
do $$ declare r jsonb := public.eu_fellow_accept_invite((select v from k where name='b_tok'), 'Producer B', 'Producer',
   'I make beats about the river and the people who fish it every summer.'); begin
 if r->>'status' <> 'accepted' or r->>'path' <> 'invite' then raise exception 'invite acceptance wrong: %', r; end if;
end $$;
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000c');
select pg_temp.must_fail($q$select public.eu_fellow_accept_invite((select v from k where name='b_tok'),'C','','Reusing somebody else''s invitation link after they accepted it.')$q$, '%INVITATION_UNAVAILABLE%');
reset role;
-- an expired invitation is dead
update public.eu_fellow_invites set created_at = now() - interval '20 days', expires_at = now() - interval '1 day'
 where token_hash = public.eu_fellow_token_hash((select v from k where name='x_tok'));
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
do $$ declare d jsonb := public.eu_fellow_desk(); begin
 if jsonb_array_length(d->'invites') <> 2 then raise exception 'desk invites wrong: %', d; end if;
 if (select count(*) from jsonb_array_elements(d->'invites') x where x->>'state' = 'accepted') <> 1 then raise exception 'accepted invite state wrong'; end if;
 if d::text like '%' || (select v from k where name='b_tok') || '%' then raise exception 'desk leaks a raw token'; end if;
end $$;
reset role;
\echo '  ✓ invitations: desk only, hash stored, single use, revocable, never shown again'

-- 9. closing requests again does not strand an invited person
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.eu_fellow_set_requests_open('a8813ab5-f066-47c2-976c-c19581b3cb71', false);
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-00000000000b');
select public.eu_fellow_onboarding_step('agreement', 'I agree');
select public.eu_fellow_onboarding_step('intro', 'Producer who records by the Pequonnock River.');
do $$ begin
 if public.eu_fellow_onboarding_step('work_plan', 'Produce three tracks for the cohort, run two open studio nights, and mix the capstone set.')->>'status' <> 'fellow' then
  raise exception 'invited person did not become a fellow'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.action_cohort_members where cohort_id='a8813ab5-f066-47c2-976c-c19581b3cb71') <> 2 then raise exception 'roster count wrong'; end if;
end $$;
\echo '  ✓ an invited person onboards even with requests closed'

-- 10. the tables carry RLS, forced
do $$ begin
 if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'eu_fellow_%' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)) then
  raise exception 'an eu_fellow table is missing forced RLS'; end if;
end $$;
\echo '  ✓ every eu_fellow table has forced RLS'
