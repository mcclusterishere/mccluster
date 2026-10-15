-- Behaviour tests for the connection RPCs in
-- supabase/pending/antisocial_get_social_completion_v1.sql, as the real API
-- roles with the JWT claims Supabase would set. Runs against a scratch
-- database (scripts/test-antisocial-db.sh). Every check raises on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.as_user(p_id uuid, p_email text default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', coalesce(p_email, p_id::text || '@test'), 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;
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

-- three members: Ana, Dev and Zed; Zed has blocked Dev
select pg_temp.as_service();
insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-000000000001', 'ana@test'),
  ('00000000-0000-4000-8000-000000000002', 'dev@test'),
  ('00000000-0000-4000-8000-000000000003', 'zed@test');
insert into public.m_people(id) values
  ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002'), ('10000000-0000-4000-8000-000000000003');
insert into public.m_links(user_id, m_uid) values
  ('00000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003');
insert into public.m_auth_user_links(auth_user_id, m_uid) select user_id, m_uid from public.m_links;
insert into public.platform_profiles(user_id, mccluster_id, display_name) values
  ('00000000-0000-4000-8000-000000000001', 'fixture.ana', 'Fixture Ana'),
  ('00000000-0000-4000-8000-000000000002', 'fixture.dev', 'Fixture Dev'),
  ('00000000-0000-4000-8000-000000000003', 'fixture.zed', 'Fixture Zed');
insert into public.network_profiles(m_uid, display_name) values
  ('10000000-0000-4000-8000-000000000001', 'Fixture Ana'),
  ('10000000-0000-4000-8000-000000000002', 'Fixture Dev'),
  ('10000000-0000-4000-8000-000000000003', 'Fixture Zed');
insert into public.network_blocks(blocker_m_uid, blocked_m_uid) values ('10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002');

-- a guest cannot ask
select pg_temp.must_fail($q$ select public.request_connection('10000000-0000-4000-8000-000000000002') $q$, '%sign in first%');

-- Ana asks Dev: pending, sent; Dev is told
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
do $$ declare r jsonb; begin
  r := public.request_connection('10000000-0000-4000-8000-000000000002');
  if r->>'status' <> 'pending' or r->>'direction' <> 'sent' then raise exception 'request: %', r; end if;
  if (select count(*) from public.network_notifications where recipient_m_uid = '10000000-0000-4000-8000-000000000002' and type = 'connection_request') <> 1 then raise exception 'Dev was not told'; end if;
  if (select metadata->>'handle' from public.network_notifications where type = 'connection_request' limit 1) <> 'fixture.ana' then raise exception 'the notice names the asker by handle'; end if;
  /* asking again changes nothing */
  r := public.request_connection('10000000-0000-4000-8000-000000000002');
  if r->>'status' <> 'pending' then raise exception 'repeat: %', r; end if;
  if (select count(*) from public.network_connections) <> 1 then raise exception 'one row per pair'; end if;
  if (select public.connection_with('10000000-0000-4000-8000-000000000002'))->>'direction' <> 'sent' then raise exception 'connection_with sent'; end if;
end $$;
select pg_temp.must_fail($q$ select public.request_connection('10000000-0000-4000-8000-000000000001') $q$, '%choose another member%');
select pg_temp.must_fail($q$ select public.request_connection('10000000-0000-4000-8000-00000000ffff') $q$, '%member not found%');

-- a stranger cannot answer Ana's request to Dev (the id is read as Ana, who may see her own row)
create temp table pair_ana_dev as select id from public.network_connections limit 1;
select pg_temp.as_user('00000000-0000-4000-8000-000000000003');
select pg_temp.must_fail(format($q$ select public.answer_connection('%s', true) $q$, (select id from pair_ana_dev)), '%request not found%');

-- Dev sees it as received, accepts; Ana is told; both see each other as connections
select pg_temp.as_user('00000000-0000-4000-8000-000000000002');
do $$ declare r jsonb; v_id uuid; begin
  r := public.connection_with('10000000-0000-4000-8000-000000000001');
  if r->>'direction' <> 'received' then raise exception 'received: %', r; end if;
  v_id := (r->>'id')::uuid;
  r := public.answer_connection(v_id, true);
  if r->>'status' <> 'accepted' or r->>'direction' <> 'both' then raise exception 'accept: %', r; end if;
  if (select count(*) from public.network_notifications where recipient_m_uid = '10000000-0000-4000-8000-000000000001' and type = 'connection_accepted') <> 1 then raise exception 'Ana was not told'; end if;
  if (select count(*) from public.my_connections()) <> 1 then raise exception 'Dev has one connection'; end if;
  if (select display_name from public.my_connections() limit 1) <> 'Fixture Ana' then raise exception 'named'; end if;
  if (select mccluster_id from public.my_connections() limit 1) <> 'fixture.ana' then raise exception 'handled'; end if;
  /* answering twice is idempotent */
  r := public.answer_connection(v_id, false);
  if r->>'status' <> 'accepted' then raise exception 'idempotent: %', r; end if;
end $$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
do $$ begin
  if (select public.connection_with('10000000-0000-4000-8000-000000000002'))->>'status' <> 'accepted' then raise exception 'Ana sees accepted'; end if;
  if (select count(*) from public.my_connections()) <> 1 then raise exception 'Ana has one connection'; end if;
end $$;

-- blocks read as not found, both ways
select pg_temp.as_user('00000000-0000-4000-8000-000000000002');
select pg_temp.must_fail($q$ select public.request_connection('10000000-0000-4000-8000-000000000003') $q$, '%member not found%');
select pg_temp.as_user('00000000-0000-4000-8000-000000000003');
select pg_temp.must_fail($q$ select public.request_connection('10000000-0000-4000-8000-000000000002') $q$, '%member not found%');

-- Zed asks Ana, Ana declines; Zed may ask again later; asking someone who asked you is accepting
do $$ declare r jsonb; v_id uuid; begin
  r := public.request_connection('10000000-0000-4000-8000-000000000001');
  v_id := (r->>'id')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000001', 'email', 'ana@test', 'role', 'authenticated')::text, false);
  r := public.answer_connection(v_id, false);
  if r->>'status' <> 'declined' then raise exception 'decline: %', r; end if;
  if (select count(*) from public.network_notifications where recipient_m_uid = '10000000-0000-4000-8000-000000000003') <> 0 then raise exception 'a decline is silent'; end if;
  if (select public.connection_with('10000000-0000-4000-8000-000000000003'))->>'status' <> 'none' then raise exception 'a declined pair reads as none'; end if;
  /* Ana changes her mind and asks Zed: since Zed asked first, the pair reopens as Ana's request */
  r := public.request_connection('10000000-0000-4000-8000-000000000003');
  if r->>'status' <> 'pending' or r->>'direction' <> 'sent' then raise exception 'reopen: %', r; end if;
  if (select count(*) from public.network_connections) <> 2 then raise exception 'still one row per pair'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-000000000003', 'email', 'zed@test', 'role', 'authenticated')::text, false);
  /* Zed asking back is accepting */
  r := public.request_connection('10000000-0000-4000-8000-000000000001');
  if r->>'status' <> 'accepted' then raise exception 'ask back = accept: %', r; end if;
end $$;

-- withdrawing: the sender of a pending request, or either side of a connection; the notice goes with it
select pg_temp.as_user('00000000-0000-4000-8000-000000000003');
do $$ declare r jsonb; v_id uuid; begin
  v_id := ((select public.connection_with('10000000-0000-4000-8000-000000000001'))->>'id')::uuid;
  r := public.withdraw_connection(v_id);
  if r->>'status' <> 'none' then raise exception 'withdraw: %', r; end if;
  if (select public.connection_with('10000000-0000-4000-8000-000000000001'))->>'status' <> 'none' then raise exception 'gone'; end if;
end $$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000001');
select pg_temp.must_fail($q$ select public.withdraw_connection('10000000-0000-4000-8000-00000000ffff') $q$, '%request not found%');

-- members read only their own rows
do $$ begin
  if (select count(*) from public.network_connections) <> 1 then raise exception 'Ana reads her one row'; end if;
end $$;
select pg_temp.as_user('00000000-0000-4000-8000-000000000003');
do $$ begin
  if (select count(*) from public.network_connections) <> 0 then raise exception 'Zed reads nothing now'; end if;
end $$;

select pg_temp.as_service();
select 'antisocial_connections.behaviour: ok' as result;
