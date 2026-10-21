-- Behaviour tests for supabase/pending/music_creator_one_click_v1.sql, as the
-- real API roles with the JWT claims Supabase would set. Runs against a
-- scratch database (scripts/test-music-creator-db.sh). Every check raises on
-- failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"anon"}', false); execute 'set role anon'; end $$;
create or replace function pg_temp.as_owner() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', false); end $$;
create or replace function pg_temp.must_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm not ilike p_like then raise exception 'expected error like % from [%], got: %', p_like, p_sql, sqlerrm; end if;
    return;
  end;
  raise exception 'expected failure (%), but it succeeded: %', p_like, p_sql;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FAILED: %', p_what; end if; end $$;

-- Ana: a complete profile (name, M handle, bio, https site)
-- Dev: signed up, never filled anything in
-- Zed: M handle collides with an existing creator's handle
-- Kim: an existing creator (handle "zed"), presentation never linked (the Benji case)
-- Nia: an auth user with no M person (not signed in to an M Account)
select pg_temp.as_owner();
insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'ana@test'),
  ('00000000-0000-4000-8000-0000000000d1', 'dev@test'),
  ('00000000-0000-4000-8000-0000000000e1', 'zed@test'),
  ('00000000-0000-4000-8000-0000000000c1', 'kim@test'),
  ('00000000-0000-4000-8000-0000000000f1', 'nia@test');
insert into public.m_people(id) values
  ('10000000-0000-4000-8000-0000000000a1'), ('10000000-0000-4000-8000-0000000000d1'),
  ('10000000-0000-4000-8000-0000000000e1'), ('10000000-0000-4000-8000-0000000000c1');
insert into public.m_auth_user_links(auth_user_id, m_uid) values
  ('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000d1', '10000000-0000-4000-8000-0000000000d1'),
  ('00000000-0000-4000-8000-0000000000e1', '10000000-0000-4000-8000-0000000000e1'),
  ('00000000-0000-4000-8000-0000000000c1', '10000000-0000-4000-8000-0000000000c1');
insert into public.platform_profiles(user_id, mccluster_id, display_name) values
  ('00000000-0000-4000-8000-0000000000a1', 'Ana.Sings', 'Ana'),
  ('00000000-0000-4000-8000-0000000000d1', null, null),
  ('00000000-0000-4000-8000-0000000000e1', 'zed', 'Zed'),
  ('00000000-0000-4000-8000-0000000000c1', 'kimk', 'Kim');
insert into public.network_profiles(m_uid, display_name, bio, website_url, avatar_url) values
  ('10000000-0000-4000-8000-0000000000a1', 'Ana Rivers', 'Songs from the river.', 'https://ana.example', 'https://cdn.example/ana.jpg'),
  ('10000000-0000-4000-8000-0000000000d1', '', '', 'http://insecure.example', 'http://insecure.example/dev.jpg'),
  ('10000000-0000-4000-8000-0000000000e1', 'Zed Lane', '', '', ''),
  ('10000000-0000-4000-8000-0000000000c1', 'Kim K', 'Old bio', '', '');
-- Kim is already a creator; her presentation row says music is off
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
insert into public.music_creator_profiles(m_uid, handle, artist_name, bio) values
  ('10000000-0000-4000-8000-0000000000c1', 'zed', 'Kim Artist', 'Kim bio');
select pg_temp.as_owner();
update public.identity_presentations set music_enabled = false where m_uid = '10000000-0000-4000-8000-0000000000c1';
insert into public.identity_presentations(m_uid, music_enabled) values ('10000000-0000-4000-8000-0000000000c1', false)
  on conflict (m_uid) do nothing;

-- ---------- grants: the API surface ----------
select pg_temp.as_anon();
select pg_temp.must_fail($q$select public.music_creator_state()$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.music_become_creator(null, null, true)$q$, '%permission denied%');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.must_fail($q$select public.music_creator_onboarding_core('10000000-0000-4000-8000-0000000000a1', null, null, true, true)$q$, '%permission denied%');

-- ---------- not signed in to an M Account ----------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f1');
select pg_temp.check(public.music_creator_state()->>'error' = 'not_signed_in', 'no M person: not_signed_in');
select pg_temp.check(public.music_become_creator('nia', 'Nia', true)->>'error' = 'not_signed_in', 'no M person: nothing written');

-- ---------- complete profile: one click ----------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
do $$ declare s jsonb := public.music_creator_state(); begin
  perform pg_temp.check((s->>'creator')::boolean = false, 'ana: not yet a creator');
  perform pg_temp.check(s->'missing' = '[]'::jsonb, 'ana: nothing missing, got ' || (s->'missing')::text);
  perform pg_temp.check((s->>'ok')::boolean, 'ana: ready');
  perform pg_temp.check(s->'prefill'->>'handle' = 'ana.sings', 'ana: handle is her M handle, lower-cased');
  perform pg_temp.check(s->'prefill'->>'artist_name' = 'Ana Rivers', 'ana: artist name is her public name');
  perform pg_temp.check(s->'prefill'->>'avatar_url' = 'https://cdn.example/ana.jpg', 'ana: her picture comes along');
end $$;
-- the state call writes nothing
select pg_temp.check(not exists (select 1 from public.music_creator_profiles where m_uid = '10000000-0000-4000-8000-0000000000a1'), 'state wrote nothing');
-- the button without the terms writes nothing
do $$ declare s jsonb := public.music_become_creator(null, null, false); begin
  perform pg_temp.check(s->>'error' = 'terms_required', 'ana: terms required, got ' || s::text);
  perform pg_temp.check((s->>'creator')::boolean = false, 'ana: still not a creator');
end $$;
select pg_temp.check(not exists (select 1 from public.music_creator_profiles where m_uid = '10000000-0000-4000-8000-0000000000a1'), 'no terms, no row');
-- one click
do $$ declare s jsonb := public.music_become_creator(null, null, true); begin
  perform pg_temp.check((s->>'creator')::boolean and (s->>'created')::boolean and (s->>'linked')::boolean, 'ana: created and linked, got ' || s::text);
  perform pg_temp.check(s->'profile'->>'handle' = 'ana.sings' and s->'profile'->>'artist_name' = 'Ana Rivers', 'ana: profile from her data');
end $$;
select pg_temp.check((select bio = 'Songs from the river.' and website_url = 'https://ana.example' and terms_version = 'music-creator-v1' and status = 'active'
  from public.music_creator_profiles where m_uid = '10000000-0000-4000-8000-0000000000a1'), 'ana: bio, https site, terms, active');
select pg_temp.check((select avatar_url = 'https://cdn.example/ana.jpg'
  from public.music_creator_profiles where m_uid = '10000000-0000-4000-8000-0000000000a1'), 'ana: her profile picture is her artist picture (owner, 2026-10-20)');
select pg_temp.check((select music_enabled from public.identity_presentations where m_uid = '10000000-0000-4000-8000-0000000000a1'), 'ana: presentation linked');
-- idempotent: again, and after an edit, nothing is overwritten and the state is the same
update public.music_creator_profiles set artist_name = 'Ana R.' where m_uid = '10000000-0000-4000-8000-0000000000a1';
do $$ declare s jsonb := public.music_become_creator('other-handle', 'Other', true); begin
  perform pg_temp.check((s->>'creator')::boolean and not (s->>'created')::boolean, 'ana: second click creates nothing');
  perform pg_temp.check(s->'profile'->>'handle' = 'ana.sings' and s->'profile'->>'artist_name' = 'Ana R.', 'ana: second click overwrites nothing');
end $$;
select pg_temp.check((select count(*) from public.music_creator_profiles where m_uid = '10000000-0000-4000-8000-0000000000a1') = 1, 'ana: one row');
select pg_temp.check((public.music_creator_state()->>'creator')::boolean, 'ana: the onboarding never shows again');

-- ---------- missing data: only what is missing is asked ----------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000d1');
do $$ declare s jsonb := public.music_creator_state(); begin
  perform pg_temp.check(s->'missing' = '["artist_name", "handle"]'::jsonb, 'dev: name and handle missing, got ' || (s->'missing')::text);
  perform pg_temp.check(not (s->>'ok')::boolean, 'dev: not ready');
end $$;
do $$ declare s jsonb := public.music_become_creator(null, null, true); begin
  perform pg_temp.check(not (s->>'creator')::boolean and s->'missing' = '["artist_name", "handle"]'::jsonb, 'dev: nothing written while missing');
end $$;
do $$ declare s jsonb := public.music_become_creator(null, 'Dev Beats', true); begin
  perform pg_temp.check(s->'missing' = '["handle"]'::jsonb, 'dev: only the handle is still missing');
  perform pg_temp.check(s->'prefill'->>'handle_suggestion' = 'dev-beats', 'dev: a handle is offered from the name, got ' || s::text);
end $$;
do $$ declare s jsonb := public.music_become_creator('Bad Handle!', 'Dev Beats', true); begin
  perform pg_temp.check(s->'problems'->>'handle' = 'invalid', 'dev: an invalid handle is named, got ' || s::text);
end $$;
do $$ declare s jsonb := public.music_become_creator('@Dev-Beats', 'Dev Beats', true); begin
  perform pg_temp.check((s->>'created')::boolean and s->'profile'->>'handle' = 'dev-beats', 'dev: created with the handle he typed, got ' || s::text);
end $$;
select pg_temp.check((select website_url = '' from public.music_creator_profiles where m_uid = '10000000-0000-4000-8000-0000000000d1'), 'dev: an http site is not copied');
select pg_temp.check((select avatar_url = '' from public.music_creator_profiles where m_uid = '10000000-0000-4000-8000-0000000000d1'), 'dev: an http picture is not copied');

-- ---------- a taken handle ----------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000e1');
do $$ declare s jsonb := public.music_creator_state(); begin
  perform pg_temp.check(s->'missing' = '["handle"]'::jsonb and s->'problems'->>'handle' = 'taken', 'zed: M handle held by another creator, got ' || s::text);
  perform pg_temp.check(s->'prefill'->>'handle' is null and s->'prefill'->>'handle_suggestion' = 'zed-lane', 'zed: a free handle is offered');
end $$;
do $$ declare s jsonb := public.music_become_creator('dev-beats', null, true); begin
  perform pg_temp.check(s->'problems'->>'handle' = 'taken' and not (s->>'creator')::boolean, 'zed: cannot take dev''s handle');
end $$;
do $$ declare s jsonb := public.music_become_creator('zed-lane', null, true); begin
  perform pg_temp.check((s->>'created')::boolean and s->'profile'->>'artist_name' = 'Zed Lane', 'zed: created with the offered handle');
end $$;

-- ---------- an existing creator whose presentation was never linked ----------
select pg_temp.as_user('00000000-0000-4000-8000-0000000000c1');
do $$ declare s jsonb := public.music_creator_state(); begin
  perform pg_temp.check((s->>'creator')::boolean and not (s->>'linked')::boolean, 'kim: a creator, not yet linked, got ' || s::text);
end $$;
select pg_temp.check((select music_enabled = false from public.identity_presentations where m_uid = '10000000-0000-4000-8000-0000000000c1'), 'kim: state did not link');
do $$ declare s jsonb := public.music_become_creator(null, null, false); begin
  perform pg_temp.check((s->>'creator')::boolean and (s->>'linked')::boolean and not (s->>'created')::boolean, 'kim: the click links, creates nothing');
  perform pg_temp.check(s->'profile'->>'artist_name' = 'Kim Artist', 'kim: nothing overwritten');
end $$;

-- ---------- the owner's repair, as the service side ----------
select pg_temp.as_owner();
update public.identity_presentations set music_enabled = false where m_uid = '10000000-0000-4000-8000-0000000000c1';
select pg_temp.check((public.music_creator_onboarding_core('10000000-0000-4000-8000-0000000000c1', null, null, true, true)->>'linked')::boolean, 'repair links');
select pg_temp.check((public.music_creator_onboarding_core('10000000-0000-4000-8000-0000000000c1', null, null, true, true)->>'linked')::boolean, 'repair is idempotent');
select pg_temp.check((select count(*) from public.music_creator_profiles where m_uid = '10000000-0000-4000-8000-0000000000c1') = 1
  and (select bio from public.music_creator_profiles where m_uid = '10000000-0000-4000-8000-0000000000c1') = 'Kim bio', 'repair overwrites nothing');

\echo 'music creator one-click: all checks passed'
