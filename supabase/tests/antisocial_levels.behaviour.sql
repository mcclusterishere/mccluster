-- Behaviour tests for the three-level Anti-Social mission as completed by
-- supabase/pending/antisocial_get_social_completion_v1.sql: levels 1 and 2
-- through the draft's own RPCs, then Connect → Collaborate → Publish for
-- level 3, one review settling both members, the awards, the record and the
-- public card. Runs after antisocial_connections.behaviour.sql in the same
-- scratch database (scripts/test-antisocial-db.sh); Ana, Dev and Zed exist
-- and Ana–Dev is an accepted connection (re-made below, in case).
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

select pg_temp.as_service();
-- the desk: an admin by the stub's rule (matthew@mccluster.org), with an Action identity
insert into auth.users(id, email) values ('00000000-0000-4000-8000-000000000009', 'matthew@mccluster.org') on conflict do nothing;
insert into public.m_people(id) values ('10000000-0000-4000-8000-000000000009') on conflict do nothing;
insert into public.m_links(user_id, m_uid) values ('00000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000009') on conflict do nothing;
insert into public.m_auth_user_links(auth_user_id, m_uid) values ('00000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000009') on conflict do nothing;
insert into public.platform_apps(app_key, enabled) values ('mccluster-web', true);
-- applying the completion file opened the mission
do $$ begin
  if (select status from public.action_missions where id = 'a17050c1-a551-4c5c-80c1-5a1750c1a001') <> 'open' then raise exception 'the mission is open after the completion file'; end if;
end $$;
-- Ana and Dev are connected (the connection test leaves them so; make sure)
insert into public.network_connections(requester_m_uid, addressee_m_uid, status)
values ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'accepted')
on conflict do nothing;
update public.network_connections set status = 'accepted'
 where least(requester_m_uid, addressee_m_uid) = '10000000-0000-4000-8000-000000000001' and greatest(requester_m_uid, addressee_m_uid) = '10000000-0000-4000-8000-000000000002';

-- both join the mission through the ordinary join
create temp table ids(k text primary key, v uuid);
grant all on ids to anon, authenticated;
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
insert into ids select 'ana', (public.join_action_mission('a17050c1-a551-4c5c-80c1-5a1750c1a001')->>'assignment_id')::uuid;
select pg_temp.as_user('00000000-0000-4000-8000-000000000002');
insert into ids select 'dev', (public.join_action_mission('a17050c1-a551-4c5c-80c1-5a1750c1a001')->>'assignment_id')::uuid;

-- the standard proof route is closed for this mission
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select pg_temp.must_fail(format($q$ select public.submit_action_proof('%s', 'link', 'https://example.org/clip', 'a high five, with permission', '{}'::jsonb) $q$, (select v from ids where k = 'ana')), '%level workflow%');

-- level 3 before levels 1 and 2 is refused, by the draft's rule and by publish
select pg_temp.must_fail(format($q$ select public.publish_antisocial_collaboration('%s', '10000000-0000-4000-8000-000000000002', 'North Bank', 'song', 'https://example.org/north-bank') $q$, (select v from ids where k = 'ana')), '%finish levels 1 and 2 first%');

-- levels 1 and 2 for both: a clip link each, verified by the desk
do $$ declare who text; lvl int; begin
  foreach who in array array['ana','dev'] loop
    for lvl in 1..2 loop
      perform set_config('request.jwt.claims', json_build_object('sub', case who when 'ana' then '00000000-0000-4000-8000-000000000001' else '00000000-0000-4000-8000-000000000002' end, 'role', 'authenticated')::text, false);
      perform public.submit_antisocial_level((select v from ids where k = who), lvl::smallint, 'high fives, with permission', 'https://example.org/' || who || '/level' || lvl, null, null, null);
      perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000009', 'email', 'matthew@mccluster.org', 'role', 'authenticated')::text, false);
      perform public.review_antisocial_level((select v from ids where k = who), lvl::smallint, 'verified', 'seen');
    end loop;
  end loop;
end $$;
do $$ begin
  if (select count(*) from public.action_antisocial_levels where status = 'verified') <> 4 then raise exception 'four verified levels'; end if;
  if (select count(*) from public.action_points_ledger) <> 0 then raise exception 'no points before 3/3'; end if;
end $$;

-- a stranger as partner is refused; so is a partner who is not a connection
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select pg_temp.must_fail(format($q$ select public.publish_antisocial_collaboration('%s', '10000000-0000-4000-8000-000000000003', 'North Bank', 'song', 'https://example.org/north-bank') $q$, (select v from ids where k = 'ana')), '%connect with your collaborator%');
select pg_temp.must_fail(format($q$ select public.publish_antisocial_collaboration('%s', '10000000-0000-4000-8000-000000000002', '', 'song', 'https://example.org/north-bank') $q$, (select v from ids where k = 'ana')), '%give the project a title%');
select pg_temp.must_fail(format($q$ select public.publish_antisocial_collaboration('%s', '10000000-0000-4000-8000-000000000002', 'North Bank', 'mixtape', 'https://example.org/north-bank') $q$, (select v from ids where k = 'ana')), '%what kind of work%');
select pg_temp.must_fail(format($q$ select public.publish_antisocial_collaboration('%s', '10000000-0000-4000-8000-000000000002', 'North Bank', 'song', null) $q$, (select v from ids where k = 'ana')), '%add the work%');

-- Ana publishes North Bank with Dev: one public post credited to both, vouched, her level 3 pending, Dev told
do $$ declare r jsonb; p public.network_posts%rowtype; begin
  r := public.publish_antisocial_collaboration((select v from ids where k = 'ana'), '10000000-0000-4000-8000-000000000002', 'North Bank', 'song', 'https://example.org/north-bank', null, 'Two voices, one river.');
  if r->>'status' <> 'pending' or r->>'level' <> '3' then raise exception 'publish: %', r; end if;
  insert into ids values ('post', (r->>'post_id')::uuid);
  select * into p from public.network_posts where id = (r->>'post_id')::uuid;
  if p.visibility <> 'public' or p.author_m_uid <> '10000000-0000-4000-8000-000000000001' then raise exception 'the post is Ana''s and public'; end if;
  if p.body not like 'North Bank — made together by Fixture Ana and Fixture Dev.%' then raise exception 'the body credits both: %', p.body; end if;
  if jsonb_array_length(p.metadata->'collaboration'->'credits') <> 2 then raise exception 'two credits'; end if;
  if (p.metadata->'collaboration'->'credits'->1->>'handle') <> 'fixture.dev' then raise exception 'the partner''s handle is on the post'; end if;
  if (select status from public.action_antisocial_levels where assignment_id = (select v from ids where k = 'ana') and level = 3) <> 'pending' then raise exception 'Ana''s level 3 is pending'; end if;
  if (select count(*) from public.network_notifications where recipient_m_uid = '10000000-0000-4000-8000-000000000002' and type = 'collaboration_published') <> 1 then raise exception 'Dev was told'; end if;
  if (select metadata->>'title' from public.network_notifications where type = 'collaboration_published') <> 'North Bank' then raise exception 'told the title'; end if;
end $$;
-- the vouch row is the server's: members cannot read it, the service can
select pg_temp.must_fail($q$ select count(*) from public.action_collaboration_posts $q$, '%permission denied%');
select pg_temp.as_service();
do $$ begin
  if (select count(*) from public.action_collaboration_posts where post_id = (select v from ids where k = 'post') and partner_m_uid = '10000000-0000-4000-8000-000000000002') <> 1 then raise exception 'vouched'; end if;
end $$;
-- the public card, as a guest: both names, not yet verified
select pg_temp.as_anon();
do $$ declare c jsonb; begin
  c := public.action_collaboration_cards(array[(select v from ids where k = 'post')]);
  if jsonb_array_length(c) <> 1 then raise exception 'one card'; end if;
  if (c->0->>'verified')::boolean then raise exception 'not verified yet'; end if;
  if (c->0->'credits'->0->>'name') <> 'Fixture Ana' or (c->0->'credits'->1->>'name') <> 'Fixture Dev' then raise exception 'credits: %', c; end if;
  if (c->0->>'kind') <> 'song' or (c->0->>'title') <> 'North Bank' then raise exception 'card: %', c; end if;
end $$;

-- the desk cannot settle level 3 until Dev confirms the same work
select pg_temp.as_user('00000000-0000-4000-8000-000000000009', 'matthew@mccluster.org');
select pg_temp.must_fail(format($q$ select public.review_antisocial_level('%s', 3::smallint, 'verified', null) $q$, (select v from ids where k = 'ana')), '%collaborator must join%');

-- Dev sees the project published with him, and confirms it as his level 3 with one call
select pg_temp.as_user('00000000-0000-4000-8000-000000000002');
do $$ declare r record; begin
  select * into r from public.antisocial_collaborations_for_me();
  if r.title <> 'North Bank' or r.initiator_handle <> 'fixture.ana' or r.mine_status is not null then raise exception 'for me: %', r; end if;
  perform public.submit_antisocial_level((select v from ids where k = 'dev'), 3::smallint, 'with Ana', 'https://example.org/north-bank', (select v from ids where k = 'post'), '10000000-0000-4000-8000-000000000001', null);
  select * into r from public.antisocial_collaborations_for_me();
  if r.mine_status <> 'pending' then raise exception 'confirmed: %', r; end if;
end $$;

-- Even when reviewing the OTHER submission, a contributing admin cannot settle themselves.
-- Give Dev the desk claim for this call; selecting Ana's submission must still fail.
select pg_temp.as_user('00000000-0000-4000-8000-000000000002', 'matthew@mccluster.org');
select pg_temp.must_fail(format($q$ select public.review_antisocial_level('%s', 3::smallint, 'verified', null) $q$, (select v from ids where k = 'ana')), '%cannot review own work%');
do $$ begin
  if exists (select 1 from public.action_antisocial_levels where level = 3 and status = 'verified') then raise exception 'self-review changed the pair'; end if;
  if exists (select 1 from public.action_points_ledger) then raise exception 'self-review awarded points'; end if;
end $$;

-- one verification settles both: levels, assignments, 150 + 100 each
select pg_temp.as_user('00000000-0000-4000-8000-000000000009', 'matthew@mccluster.org');
do $$ declare r jsonb; begin
  r := public.review_antisocial_level((select v from ids where k = 'ana'), 3::smallint, 'verified', 'a real song');
  if (r->>'partner_assignment_id')::uuid <> (select v from ids where k = 'dev') then raise exception 'settled the partner: %', r; end if;
  if (select count(*) from public.action_antisocial_levels where level = 3 and status = 'verified') <> 2 then raise exception 'both level 3 verified'; end if;
  if (select count(*) from public.action_mission_assignments where status = 'verified' and mission_id = 'a17050c1-a551-4c5c-80c1-5a1750c1a001') <> 2 then raise exception 'both assignments verified'; end if;
  if (select count(*) from public.action_points_ledger where kind = 'mission' and points = 150) <> 2 then raise exception 'mission points for each, once'; end if;
  if (select count(*) from public.action_points_ledger where kind = 'collaboration' and points = 100) <> 2 then raise exception 'a collaboration award for each'; end if;
  /* verifying again changes nothing */
  r := public.review_antisocial_level((select v from ids where k = 'dev'), 3::smallint, 'verified', null);
  if not (r->>'idempotent')::boolean then raise exception 'idempotent: %', r; end if;
  if (select count(*) from public.action_points_ledger) <> 4 then raise exception 'no double award'; end if;
end $$;

-- the record reads 3 / 3 with 250 points; the card reads verified; the draft's public credit lists the pair
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
do $$ declare r jsonb; m jsonb; begin
  r := public.action_record();
  if (r->>'points')::int <> 250 or (r->>'verified_actions')::int <> 1 then raise exception 'record: % %', r->>'points', r->>'verified_actions'; end if;
  m := r->'missions'->0;
  if (m->>'level_count')::int <> 3 or jsonb_array_length(m->'levels') <> 3 then raise exception 'levels on the record: %', m; end if;
  if (select count(*) from jsonb_array_elements(m->'levels') x where x->>'status' = 'verified') <> 3 then raise exception '3 / 3'; end if;
  if (select count(*) from public.antisocial_public_collaborations('10000000-0000-4000-8000-000000000001')) <> 1 then raise exception 'the draft''s public credit still lists the pair'; end if;
end $$;
select pg_temp.as_anon();
do $$ declare c jsonb; begin
  c := public.action_collaboration_cards(array[(select v from ids where k = 'post')]);
  if not (c->0->>'verified')::boolean then raise exception 'verified now'; end if;
end $$;

select pg_temp.as_service();
select 'antisocial_levels.behaviour: ok' as result;
