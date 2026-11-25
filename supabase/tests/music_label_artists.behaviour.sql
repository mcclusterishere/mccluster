-- Behaviour tests for supabase/pending/music_label_artists_v1.sql (the label
-- model: one account, several artists), as the real API roles with the JWT
-- claims Supabase would set. Runs against a scratch database
-- (scripts/test-music-label-db.sh) after supabase/tests/music_label_artists.seed.sql
-- and the file. Every check raises on failure.
--
-- Owner, 2026-11-02: PRIM3 is "its own artist. Separate entity from Matthew
-- McCluster. But controlled by Matthew McCluster's account until it gets its
-- own login." / "being a label account type ... multiple artists on my account."
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  execute 'set role service_role';
end $$;
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
-- rows an UPDATE touched, as the caller (RLS hides what it may not change)
create or replace function pg_temp.touched(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on function pg_temp.check(boolean, text), pg_temp.must_fail(text, text), pg_temp.touched(text) to authenticated, service_role;

\set MATTHEW_AUTH '''00000000-0000-4000-8000-0000000000a1'''
\set MATTHEW '''10000000-0000-4000-8000-0000000000a1'''
\set STRANGER_AUTH '''00000000-0000-4000-8000-0000000000c1'''
\set STRANGER '''10000000-0000-4000-8000-0000000000c1'''
\set ANA_AUTH '''00000000-0000-4000-8000-0000000000d1'''
\set ANA '''10000000-0000-4000-8000-0000000000d1'''

------------------------------------------------------------------------------
-- The seed: PRIM3 and Equity Uprise are artists of their own, with no login,
-- on the house owner's label
------------------------------------------------------------------------------
select pg_temp.as_service();
select set_config('t.prim3', (select m_uid::text from public.music_creator_profiles where handle = 'prim3'), false);
select set_config('t.eu', (select m_uid::text from public.music_creator_profiles where handle = 'equity-uprise'), false);
select pg_temp.check(current_setting('t.prim3') <> '' and current_setting('t.eu') <> '', 'PRIM3 and Equity Uprise have artist profiles');
select pg_temp.check(current_setting('t.prim3')::uuid <> :MATTHEW::uuid, 'PRIM3 is its own identity, not Matthew''s');
select pg_temp.check((select artist_name = 'PRIM3' and status = 'active' and settings->>'provisioned_by' = 'music_label_artists_v1'
                        and settings->>'entity' = 'https://matthew.mccluster.org/prim3-artist.html#prim3-artist'
                       from public.music_creator_profiles where handle = 'prim3'), 'PRIM3''s profile names its entity');
select pg_temp.check(not exists (select 1 from public.m_auth_user_links where m_uid in (current_setting('t.prim3')::uuid, current_setting('t.eu')::uuid)),
                     'neither act has a login');
select pg_temp.check((select count(*) from public.music_creator_managers
                       where manager_m_uid = :MATTHEW::uuid and role = 'label_admin' and revoked_at is null) = 2,
                     'Matthew is label_admin of both, once each (the file ran twice)');
select pg_temp.check((select count(*) from public.music_creator_profiles where handle in ('prim3', 'equity-uprise')) = 2, 'one profile each after a re-run');

------------------------------------------------------------------------------
-- Matthew acts as PRIM3
------------------------------------------------------------------------------
select pg_temp.as_user(:MATTHEW_AUTH);
select pg_temp.check((select array_agg(coalesce(handle, '-') order by relation desc, handle) from public.music_my_artists())
                     = array['matthew', 'equity-uprise', 'prim3'], 'Acting as: Matthew himself, then the artists he manages');
select pg_temp.check((select relation = 'managed' and role = 'label_admin' and has_login = false
                       from public.music_my_artists() where handle = 'prim3'), 'PRIM3 is managed, label_admin, no login');
select pg_temp.check(pg_temp.touched(format('update public.music_creator_profiles set bio = %L where handle = %L', 'Study tapes.', 'prim3')) = 1,
                     'Matthew can edit PRIM3''s profile');
select pg_temp.must_fail(format('update public.music_creator_profiles set m_uid = %L where handle = %L', :MATTHEW, 'prim3'), '%creator_identity_mismatch%');
-- a release for PRIM3, by Matthew's account
insert into public.creator_tracks(id, m_uid, title, artist, status)
values ('20000000-0000-4000-8000-0000000000e1', current_setting('t.prim3')::uuid, 'Got WiFi?', 'PRIM3', 'draft');
-- and one of his own: no m_uid named means the caller's own identity
insert into public.creator_tracks(id, title, artist, status)
values ('20000000-0000-4000-8000-0000000000e2', 'Here', 'Matthew McCluster', 'draft');
select pg_temp.check((select m_uid = current_setting('t.prim3')::uuid and uid = :MATTHEW_AUTH::uuid
                       from public.creator_tracks where id = '20000000-0000-4000-8000-0000000000e1'),
                     'the release belongs to PRIM3, created by Matthew''s account');
select pg_temp.check((select m_uid from public.creator_tracks where id = '20000000-0000-4000-8000-0000000000e2') = :MATTHEW::uuid,
                     'his own release stays his');
select pg_temp.check(pg_temp.touched('update public.creator_tracks set title = ''Got WiFi? (v2)'' where id = ''20000000-0000-4000-8000-0000000000e1''') = 1,
                     'Matthew can edit PRIM3''s draft');
select pg_temp.check((select m_uid from public.creator_tracks where id = '20000000-0000-4000-8000-0000000000e1') = current_setting('t.prim3')::uuid,
                     'editing never moves the release to the editor');
-- a licence offer and a rights attestation, both PRIM3's
insert into public.music_license_offers(track_id, slug, title, license_type, price_cents, terms_text)
values ('20000000-0000-4000-8000-0000000000e1', 'personal', 'Personal', 'personal_download', 100, 'Personal use.');
select pg_temp.check((select creator_m_uid = current_setting('t.prim3')::uuid and active = false
                       from public.music_license_offers where track_id = '20000000-0000-4000-8000-0000000000e1'),
                     'the offer is PRIM3''s and starts off sale');
insert into public.music_rights_attestations(track_id, owns_master, controls_composition, samples_cleared, collaborators_cleared)
values ('20000000-0000-4000-8000-0000000000e1', true, true, true, true);
select pg_temp.check((select creator_m_uid = current_setting('t.prim3')::uuid and attested_by_m_uid = :MATTHEW::uuid
                       from public.music_rights_attestations where track_id = '20000000-0000-4000-8000-0000000000e1'),
                     'the attestation is PRIM3''s, made by Matthew''s account');

------------------------------------------------------------------------------
-- A stranger cannot
------------------------------------------------------------------------------
select pg_temp.as_user(:STRANGER_AUTH);
select pg_temp.check((select array_agg(relation) from public.music_my_artists()) = array['self'], 'a stranger manages nobody');
select pg_temp.check(not exists (select 1 from public.creator_tracks where id = '20000000-0000-4000-8000-0000000000e1'),
                     'a stranger cannot see PRIM3''s draft');
select pg_temp.check(pg_temp.touched(format('update public.music_creator_profiles set bio = %L where handle = %L', 'mine now', 'prim3')) = 0,
                     'a stranger cannot edit PRIM3''s profile');
select pg_temp.must_fail(format('insert into public.creator_tracks(m_uid, title, artist) values (%L, ''x'', ''PRIM3'')', current_setting('t.prim3')),
                         '%creator_track_forbidden%');
select pg_temp.must_fail('insert into public.music_license_offers(track_id, slug, title, license_type, terms_text) values (''20000000-0000-4000-8000-0000000000e1'', ''steal'', ''x'', ''personal_download'', ''x'')',
                         '%license_offer_forbidden%');
select pg_temp.must_fail('insert into public.music_rights_attestations(track_id, owns_master, controls_composition, samples_cleared, collaborators_cleared) values (''20000000-0000-4000-8000-0000000000e1'', true, true, true, true)',
                         '%row-level security%');
select pg_temp.must_fail(format('select public.music_label_grant(%L, %L, ''manager'')', current_setting('t.prim3'), :STRANGER), '%label_admin_required%');
select pg_temp.must_fail('select public.music_label_create_artist(''my-label'', ''Mine'')', '%label_admin_required%');
select pg_temp.must_fail(format('select public.music_label_revoke(%L, %L)', current_setting('t.prim3'), :MATTHEW), '%label_admin_required%');
select pg_temp.must_fail(format('select public.music_label_hand_over_login(%L, %L)', current_setting('t.prim3'), :STRANGER_AUTH), '%permission denied%');
select pg_temp.must_fail('insert into public.music_creator_managers(creator_m_uid, manager_m_uid) values (''' || current_setting('t.prim3') || ''', ''10000000-0000-4000-8000-0000000000c1'')',
                         '%permission denied%');
select pg_temp.check(not exists (select 1 from public.music_creator_managers), 'a stranger reads no grant that is not about them');

-- an ordinary creator is unchanged, and can no longer name someone else
select pg_temp.as_user(:ANA_AUTH);
insert into public.music_creator_profiles(m_uid, handle, artist_name) values (:ANA::uuid, 'ana', 'Ana');
insert into public.creator_tracks(id, title, artist) values ('20000000-0000-4000-8000-0000000000d2', 'Ana''s song', 'Ana');
select pg_temp.check((select m_uid = :ANA::uuid and uid = :ANA_AUTH::uuid from public.creator_tracks where id = '20000000-0000-4000-8000-0000000000d2'),
                     'a creator acting as herself works as before');
select pg_temp.must_fail(format('insert into public.creator_tracks(m_uid, title, artist) values (%L, ''x'', ''x'')', :MATTHEW), '%creator_track_forbidden%');
select pg_temp.must_fail(format('insert into public.music_creator_profiles(m_uid, handle, artist_name) values (%L, ''ana2'', ''x'')', :STRANGER),
                         '%creator_identity_mismatch%');

------------------------------------------------------------------------------
-- A revoked manager cannot
------------------------------------------------------------------------------
select pg_temp.as_user(:MATTHEW_AUTH);
select public.music_label_grant(current_setting('t.eu')::uuid, :STRANGER::uuid, 'manager');
select pg_temp.as_user(:STRANGER_AUTH);
select pg_temp.check(pg_temp.touched(format('update public.music_creator_profiles set bio = %L where handle = %L', 'Managed.', 'equity-uprise')) = 1,
                     'a granted manager can act for Equity Uprise');
select pg_temp.must_fail(format('select public.music_label_grant(%L, %L, ''label_admin'')', current_setting('t.eu'), :ANA), '%label_admin_required%');
select pg_temp.as_user(:MATTHEW_AUTH);
select pg_temp.check(public.music_label_revoke(current_setting('t.eu')::uuid, :STRANGER::uuid), 'the label admin revokes the manager');
select pg_temp.as_user(:STRANGER_AUTH);
select pg_temp.check(pg_temp.touched(format('update public.music_creator_profiles set bio = %L where handle = %L', 'Still mine?', 'equity-uprise')) = 0,
                     'a revoked manager cannot edit the artist');
select pg_temp.must_fail(format('insert into public.creator_tracks(m_uid, title, artist) values (%L, ''x'', ''Equity Uprise'')', current_setting('t.eu')),
                         '%creator_track_forbidden%');
select pg_temp.check((select array_agg(relation) from public.music_my_artists()) = array['self'], 'and no longer lists it');
-- Matthew himself, revoked from PRIM3, is locked out too, until the house grants it back
select pg_temp.as_user(:MATTHEW_AUTH);
select public.music_label_revoke(current_setting('t.prim3')::uuid, :MATTHEW::uuid);
select pg_temp.check(not exists (select 1 from public.creator_tracks where id = '20000000-0000-4000-8000-0000000000e1'),
                     'a revoked manager cannot see the artist''s draft');
select pg_temp.check(pg_temp.touched('update public.creator_tracks set title = ''x'' where id = ''20000000-0000-4000-8000-0000000000e1''') = 0,
                     'a revoked manager cannot edit the artist''s release');
select public.music_label_grant(current_setting('t.prim3')::uuid, :MATTHEW::uuid, 'label_admin');
select pg_temp.check(exists (select 1 from public.creator_tracks where id = '20000000-0000-4000-8000-0000000000e1'), 'granted back, he can again');

------------------------------------------------------------------------------
-- A new artist on the label, and later its own login: nothing moves
------------------------------------------------------------------------------
select set_config('t.new', public.music_label_create_artist('test-artist', 'Test Artist', 'A label test.')::text, false);
select pg_temp.check((select has_login = false and role = 'label_admin' from public.music_my_artists() where handle = 'test-artist'),
                     'the house owner adds an artist to the label');
insert into public.creator_tracks(id, m_uid, title, artist)
values ('20000000-0000-4000-8000-0000000000f1', current_setting('t.new')::uuid, 'First', 'Test Artist');

-- the artist signs up (a fresh auth record with its own empty M identity:
-- what the Auth sign-up and m_auth_user_after_insert do) ...
reset role;
insert into auth.users(id, email) values ('00000000-0000-4000-8000-0000000000f9', 'artist@example.test');
insert into public.m_people(id) values ('10000000-0000-4000-8000-0000000000f9');
insert into public.m_auth_user_links(auth_user_id, m_uid, is_primary, link_method)
values ('00000000-0000-4000-8000-0000000000f9', '10000000-0000-4000-8000-0000000000f9', true, 'signup');
select pg_temp.as_service();
select pg_temp.must_fail(format('select public.music_label_hand_over_login(%L, %L)', current_setting('t.new'), :ANA_AUTH),
                         '%auth_user_identity_not_empty%');
-- ... and the operator hands it the artist's identity
select pg_temp.check((public.music_label_hand_over_login(current_setting('t.new')::uuid, '00000000-0000-4000-8000-0000000000f9'))->>'released_identity'
                     = '10000000-0000-4000-8000-0000000000f9', 'the hand-over reports the empty identity it released');
select pg_temp.must_fail(format('select public.music_label_hand_over_login(%L, %L)', current_setting('t.new'), :STRANGER_AUTH),
                         '%artist_already_has_login%');
select pg_temp.as_user('00000000-0000-4000-8000-0000000000f9');
select pg_temp.check((select relation = 'self' and handle = 'test-artist' from public.music_my_artists() where relation = 'self'),
                     'signed in, the artist is itself');
select pg_temp.check((select m_uid = current_setting('t.new')::uuid and uid = :MATTHEW_AUTH::uuid
                       from public.creator_tracks where id = '20000000-0000-4000-8000-0000000000f1'),
                     'its release is where it was: the artist''s, created by the label''s account');
select pg_temp.check(pg_temp.touched('update public.creator_tracks set title = ''First (final)'' where id = ''20000000-0000-4000-8000-0000000000f1''') = 1,
                     'the artist edits its own release');
select pg_temp.check((select uid from public.creator_tracks where id = '20000000-0000-4000-8000-0000000000f1') = :MATTHEW_AUTH::uuid,
                     'the release keeps the account that created it (its files stay owned)');
select pg_temp.check(public.music_label_revoke(current_setting('t.new')::uuid, :MATTHEW::uuid), 'the artist can let its label go');
select pg_temp.as_user(:MATTHEW_AUTH);
select pg_temp.check(pg_temp.touched('update public.creator_tracks set title = ''x'' where id = ''20000000-0000-4000-8000-0000000000f1''') = 0,
                     'after that the label cannot touch it');
select pg_temp.check(not exists (select 1 from public.music_my_artists() where handle = 'test-artist'), 'and no longer lists it');

select pg_temp.as_service();
reset role;
