-- What a creator may do with a release they submitted (music slice M6, 2026-11-19; studio lane ST-10), as the
-- APPLIED SQL already decides it: the row policies of supabase/migrations/20260920041011_music_creator_platform_v1.sql
-- and public.music_track_guard of supabase/migrations/20261030001000_music_release_payment_integrity_v1.sql. This file
-- changes nothing: it proves the rules Creator Studio's "Your releases" builds on (js/music-creator-studio.js,
-- js/music-creator-page.js releaseActions) and the reason it offers nothing on a live release.
--
-- Runs in scripts/test-music-release-integrity-db.sh after music_release_payment_integrity.behaviour.sql, on a
-- scratch database, as the real API roles with the JWT claims Supabase would set. Every check raises on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- Row security is on for creator_tracks in production (it has been since supabase/replay_migrations/0003_creator_cuts.sql;
-- the platform migration replaced that file's policies with its own). The shared stub that stands in for the table here
-- (supabase/tests/music_creator_onboarding.stub.sql) leaves it off, so this file turns it on for its own run: without it
-- the policies below would prove nothing.
reset role;
alter table public.creator_tracks enable row level security;

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
create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FAILED: %', p_what; end if; end $$;
-- a statement that must be refused, with its deferred checks run inside the block (a foreign key the database
-- checks at commit would otherwise escape it)
create or replace function pg_temp.must_fail_now(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    set constraints all immediate;
    execute p_sql;
  exception when others then
    if sqlerrm not ilike p_like then raise exception 'expected error like % from [%], got: %', p_like, p_sql, sqlerrm; end if;
    return;
  end;
  raise exception 'expected failure (%), but it succeeded: %', p_like, p_sql;
end $$;
-- the review desk, as music-access runs it (operator-review-prepare, then the decision with the hash it showed)
create or replace function pg_temp.fake_sha(p_ident text) returns text language sql as $$
  select encode(sha256(convert_to(p_ident, 'UTF8')), 'hex') $$;
create or replace function pg_temp.verify_audio(p_track uuid) returns text language plpgsql as $$
declare r record;
begin
  select * into r from public.music_prepare_review(p_track);
  if r.content_sha256 is null then
    perform public.music_record_asset_sha256(r.version_id, pg_temp.fake_sha(r.object_name || '|' || coalesce(r.etag, '')), r.size_bytes);
  end if;
  return (select v.content_sha256 from public.music_asset_versions v where v.id = r.version_id);
end $$;
create or replace function pg_temp.track(p_id uuid) returns public.creator_tracks language sql as $$
  select * from public.creator_tracks where id = p_id $$;

-- ids
--   Ana auth 00..a1 / M 10..a1 (the creator)      Bo auth 00..b1 / M 10..b1 (another creator)
--   c1 "One": edited while pending                 c2 "Two": withdrawn after the reviewer verified it
--   c3 "Three": withdrawn, sent again, deleted     c4 "Four": published, the reason nothing is offered on it
\set A '''00000000-0000-4000-8000-0000000000a1'''
\set B '''00000000-0000-4000-8000-0000000000b1'''
\set C1 '''20000000-0000-4000-8000-0000000000c1'''
\set C2 '''20000000-0000-4000-8000-0000000000c2'''
\set C3 '''20000000-0000-4000-8000-0000000000c3'''
\set C4 '''20000000-0000-4000-8000-0000000000c4'''

-- Ana's uploads, granted by music-access (the server's record of who uploaded what) and held by Storage
select pg_temp.as_service();
insert into public.music_creator_assets(bucket_id, object_name, owner_user_id, owner_m_uid) values
  ('creator-masters', '00000000-0000-4000-8000-0000000000a1/m6-one.wav',   :A, '10000000-0000-4000-8000-0000000000a1'),
  ('creator-masters', '00000000-0000-4000-8000-0000000000a1/m6-two.wav',   :A, '10000000-0000-4000-8000-0000000000a1'),
  ('creator-masters', '00000000-0000-4000-8000-0000000000a1/m6-three.wav', :A, '10000000-0000-4000-8000-0000000000a1'),
  ('creator-masters', '00000000-0000-4000-8000-0000000000a1/m6-four.wav',  :A, '10000000-0000-4000-8000-0000000000a1');
insert into storage.objects(bucket_id, name, owner, owner_id) values
  ('creator-masters', '00000000-0000-4000-8000-0000000000a1/m6-one.wav', null, null),
  ('creator-masters', '00000000-0000-4000-8000-0000000000a1/m6-two.wav', null, null),
  ('creator-masters', '00000000-0000-4000-8000-0000000000a1/m6-three.wav', null, null),
  ('creator-masters', '00000000-0000-4000-8000-0000000000a1/m6-four.wav', null, null);

-- Ana submits four releases, as Creator Studio does (attested, waiting for review)
select pg_temp.as_user(:A);
insert into public.creator_tracks(id, title, artist, master_path, status, rights_status) values
  (:C1, 'One',   'Ana', '00000000-0000-4000-8000-0000000000a1/m6-one.wav',   'pending_review', 'attested'),
  (:C2, 'Two',   'Ana', '00000000-0000-4000-8000-0000000000a1/m6-two.wav',   'pending_review', 'attested'),
  (:C3, 'Three', 'Ana', '00000000-0000-4000-8000-0000000000a1/m6-three.wav', 'pending_review', 'attested'),
  (:C4, 'Four',  'Ana', '00000000-0000-4000-8000-0000000000a1/m6-four.wav',  'pending_review', 'attested');
select pg_temp.check((select count(*) from public.creator_tracks where id in (:C1, :C2, :C3, :C4) and status = 'pending_review') = 4,
                     'four releases wait for review');

------------------------------------------------------------------------------
-- Edit: the words and links of a pending release, on the version on screen
------------------------------------------------------------------------------
select set_config('m6.c1_seen', (pg_temp.track(:C1)).updated_at::text, false);
update public.creator_tracks set title = 'One (new words)', description = 'New notes', genre = 'Soul',
       music_video_url = 'https://video.example/one', lyrics_url = ''
 where id = :C1 and status = 'pending_review' and updated_at = current_setting('m6.c1_seen')::timestamptz;
select pg_temp.check((select t.title = 'One (new words)' and t.description = 'New notes' and t.status = 'pending_review'
                         and t.rights_status = 'attested' and t.updated_at > current_setting('m6.c1_seen')::timestamptz
                        from public.creator_tracks t where t.id = :C1),
                     'a creator edits a pending release: it stays in review, attested, and its version moves on');
-- a screen loaded before that edit changes nothing (Creator Studio then reloads and says so)
update public.creator_tracks set title = 'stale screen'
 where id = :C1 and status = 'pending_review' and updated_at = current_setting('m6.c1_seen')::timestamptz;
select pg_temp.check((pg_temp.track(:C1)).title = 'One (new words)', 'an edit made on an older version of the release changes nothing');
-- and the creator still cannot review their own release, whatever the request says
update public.creator_tracks set status = 'published', rights_status = 'cleared', published_at = now() where id = :C1;
select pg_temp.check((select status = 'pending_review' and rights_status = 'attested' and published_at is null
                        from public.creator_tracks where id = :C1), 'a creator cannot publish or clear their own release');
-- the reviewer's decision is about the version the reviewer loaded: an older look decides nothing
select pg_temp.as_service();
select pg_temp.check(public.music_operator_review(:C1, 'review', 'older look', current_setting('m6.c1_seen')::timestamptz, null) is null,
                     'a review made on the version before the creator''s edit is refused (the desk reloads)');
-- held for review on the version the reviewer loaded; the creator withdraws it and sends it back as it was
select pg_temp.check((public.music_operator_review(:C1, 'review', 'Check the credits', (pg_temp.track(:C1)).updated_at, null))->>'rights_status' = 'review',
                     'the reviewer holds release One for review');
select pg_temp.as_user(:A);
update public.creator_tracks set status = 'draft' where id = :C1 and status = 'pending_review';
select pg_temp.check((select status = 'draft' and rights_status = 'review' and moderation_note = 'Check the credits'
                        from public.creator_tracks where id = :C1), 'a release held for review can be withdrawn; the reviewer''s note stays');
update public.creator_tracks set status = 'pending_review' where id = :C1 and status = 'draft' and rights_status in ('attested', 'review');
select pg_temp.check((select status = 'pending_review' and rights_status = 'review' from public.creator_tracks where id = :C1),
                     'and submitted again, back in the rights state it left');

------------------------------------------------------------------------------
-- Withdraw, submit again, delete
------------------------------------------------------------------------------
select pg_temp.as_user(:A);
-- a pending release cannot be deleted outright (row policy: a creator deletes only draft, rejected and archived rows)
delete from public.creator_tracks where id = :C3;
select pg_temp.check(exists (select 1 from public.creator_tracks where id = :C3), 'a pending release is not deleted: withdraw it first');
update public.creator_tracks set status = 'draft' where id = :C3 and status = 'pending_review';
select pg_temp.check((select status = 'draft' and rights_status = 'attested' from public.creator_tracks where id = :C3),
                     'a creator withdraws a pending release: back to draft, still attested');
select pg_temp.as_service();
select pg_temp.check(not exists (select 1 from public.creator_tracks where id = :C3 and status in ('pending_review','approved','published','rejected')),
                     'a withdrawn release is out of the review desk''s queue (operator-dashboard''s statuses)');
select pg_temp.as_user(:A);
update public.creator_tracks set status = 'pending_review' where id = :C3 and status = 'draft' and rights_status = 'attested';
select pg_temp.check((pg_temp.track(:C3)).status = 'pending_review', 'a withdrawn, attested release can be submitted again');
update public.creator_tracks set status = 'draft' where id = :C3 and status = 'pending_review';
delete from public.creator_tracks where id = :C3 and status in ('draft', 'rejected');
select pg_temp.check(not exists (select 1 from public.creator_tracks where id = :C3), 'a withdrawn release can be deleted by its creator');

------------------------------------------------------------------------------
-- Once the reviewer has verified the audio, the record stays: withdrawn, never deleted
------------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.check(pg_temp.verify_audio(:C2) ~ '^[0-9a-f]{64}$', 'the reviewer verifies release Two (its master is pinned and hashed)');
select pg_temp.as_user(:A);
update public.creator_tracks set status = 'draft' where id = :C2 and status = 'pending_review';
select pg_temp.check((pg_temp.track(:C2)).status = 'draft', 'a verified release can still be withdrawn');
select pg_temp.must_fail_now($$delete from public.creator_tracks where id = '20000000-0000-4000-8000-0000000000c2' and status in ('draft','rejected')$$,
                             '%foreign key%');
select pg_temp.check(exists (select 1 from public.creator_tracks where id = :C2),
                     'but not deleted: the pinned version keeps its record (Creator Studio says so)');

------------------------------------------------------------------------------
-- Another creator can do none of it
------------------------------------------------------------------------------
select pg_temp.as_user(:B);
update public.creator_tracks set title = 'Bo was here' where id = :C1;
update public.creator_tracks set status = 'draft' where id = :C1;
delete from public.creator_tracks where id = :C2;
select pg_temp.as_service();
select pg_temp.check((select title = 'One (new words)' and status = 'pending_review' from public.creator_tracks where id = :C1),
                     'another creator cannot edit or withdraw Ana''s release');
select pg_temp.check(exists (select 1 from public.creator_tracks where id = :C2), 'nor delete it');

------------------------------------------------------------------------------
-- Why nothing is offered on a live release: any change takes it off the air (the guard, ST-6, decision D-14)
------------------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.check((public.music_operator_review(:C4, 'publish', '', (pg_temp.track(:C4)).updated_at, pg_temp.verify_audio(:C4)))->>'status' = 'published',
                     'release Four is published through the hash-checked review');
select pg_temp.as_user(:A);
update public.creator_tracks set title = 'Four (a typo fixed)' where id = :C4;
select pg_temp.check((select status = 'pending_review' and published_at is null from public.creator_tracks where id = :C4),
                     'a creator''s edit of a published release unpublishes it: Creator Studio offers no edit there');

select pg_temp.as_service();
reset role;
