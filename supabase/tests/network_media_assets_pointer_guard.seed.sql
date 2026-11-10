-- The rows production could hold the day the guard is applied, written BEFORE
-- it: three people, their logins, uploads recorded the way the media function
-- records them (service role), the things that name those uploads, and two
-- rows that pass the canonical shape but name somebody else's upload, which a
-- member could write while the table was theirs. (Rows that are not canonical
-- at all are in network_media_assets_pointer_guard.legacy.sql: the guard
-- refuses to apply while one exists.)
-- Applied by scripts/test-network-media-pointer-guard-db.sh and
-- scripts/test-network-media-storage-flow.sh. Scratch database only.
--
-- Logins (auth.users.id) and people (m_people.id):
--   A  aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa  ->  a0000000-0000-4000-8000-00000000000a
--   B  bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb  ->  b0000000-0000-4000-8000-00000000000b
--   C  cccccccc-cccc-4ccc-8ccc-cccccccccccc  ->  c0000000-0000-4000-8000-00000000000c
--      (C is a second account of A's owner; the behaviour test merges C into A)
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@example.test');
insert into public.m_people (id) values
  ('a0000000-0000-4000-8000-00000000000a'),
  ('b0000000-0000-4000-8000-00000000000b'),
  ('c0000000-0000-4000-8000-00000000000c');
insert into public.m_auth_user_links (auth_user_id, m_uid, link_method, is_primary) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-00000000000a', 'signup', true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-00000000000b', 'signup', true),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c0000000-0000-4000-8000-00000000000c', 'signup', true);
grant select on public.m_auth_user_links, public.m_people to authenticated;
grant all on public.m_auth_user_links, public.m_people, public.m_devices, public.m_person_apps to service_role;

insert into public.network_posts (id, author_m_uid, body) values
  ('d0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-00000000000a', 'A''s post with a photo'),
  ('d0000000-0000-4000-8000-0000000000a3', 'a0000000-0000-4000-8000-00000000000a', 'A''s second post');

-- Uploads as upload-url and finalize write them: mnet-media/<login>/<uuid>-<name>.
insert into public.network_media_assets (id, owner_m_uid, bucket_id, object_path, media_type, mime_type, byte_size, status, post_id) values
  -- A: evidence reserved for an FBI case (attached, no post)
  ('e0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000f1-kicks.jpg', 'image', 'image/jpeg', 1000, 'attached', null),
  -- A: a mission proof the desk reviews (ready, not attached)
  ('e0000000-0000-4000-8000-0000000000f2', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000f2-proof.mp4', 'video', 'video/mp4', 2000, 'ready', null),
  -- A: a clipping campaign's source file (ready, not attached)
  ('e0000000-0000-4000-8000-0000000000f3', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000f3-hook.mp3', 'audio', 'audio/mpeg', 3000, 'ready', null),
  -- A: an Anti-Social level clip
  ('e0000000-0000-4000-8000-0000000000f4', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000f4-level.mp4', 'video', 'video/mp4', 4000, 'ready', null),
  -- A: a photo on A's post
  ('e0000000-0000-4000-8000-0000000000f5', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000f5-post.png', 'image', 'image/png', 5000, 'attached', 'd0000000-0000-4000-8000-0000000000a1'),
  -- A: a slot that was never uploaded to, one the desk blocked, one marked deleted
  ('e0000000-0000-4000-8000-0000000000f6', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000f6-never.png', 'image', 'image/png', 6000, 'staged', null),
  ('e0000000-0000-4000-8000-0000000000f7', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000f7-blocked.png', 'image', 'image/png', 7000, 'blocked', null),
  ('e0000000-0000-4000-8000-0000000000f8', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000f8-gone.png', 'image', 'image/png', 8000, 'deleted', null),
  -- A: an ordinary finished upload nothing names yet
  ('e0000000-0000-4000-8000-0000000000f9', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000f9-spare.png', 'image', 'image/png', 9000, 'ready', null),
  -- B: B's own finished upload
  ('e0000000-0000-4000-8000-0000000000b1', 'b0000000-0000-4000-8000-00000000000b', 'mnet-media', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/10000000-0000-4000-8000-0000000000b1-mine.png', 'image', 'image/png', 1100, 'ready', null),
  -- C: two uploads made with C's login
  ('e0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-4000-8000-00000000000c', 'mnet-media', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/10000000-0000-4000-8000-0000000000c1-one.png', 'image', 'image/png', 1200, 'ready', null),
  ('e0000000-0000-4000-8000-0000000000c2', 'c0000000-0000-4000-8000-00000000000c', 'mnet-media', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc/10000000-0000-4000-8000-0000000000c2-two.mp4', 'video', 'video/mp4', 1300, 'ready', null);

-- LEGACY, canonical in shape: rows a member could write while the table was
-- theirs, each naming B's upload. Nothing signs them. They pass the CHECK.
insert into public.network_media_assets (id, owner_m_uid, bucket_id, object_path, media_type, mime_type, status, post_id) values
  -- A's row pointing into B's uploads, named by a proof
  ('e0000000-0000-4000-8000-00000000001c', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/10000000-0000-4000-8000-00000000001c-theirs.png', 'image', 'image/png', 'ready', null),
  -- C's row pointing into B's uploads: it must never follow a merge
  ('e0000000-0000-4000-8000-00000000001e', 'c0000000-0000-4000-8000-00000000000c', 'mnet-media', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/10000000-0000-4000-8000-00000000001e-c-points-at-b.png', 'image', 'image/png', 'ready', null);

-- What names them.
insert into public.fbi_cases (id, reporter_m_uid, media_asset_ids, status) values
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', array['e0000000-0000-4000-8000-0000000000f1']::uuid[], 'public');
insert into public.action_proofs (id, user_id, metadata, status) values
  ('f0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"asset_id":"e0000000-0000-4000-8000-0000000000f2","media_type":"video"}', 'verified'),
  ('f0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"asset_id":"E0000000-0000-4000-8000-00000000001C","media_type":"image"}', 'pending');
insert into public.action_clip_assets (id, network_media_asset_id) values
  ('f0000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-0000000000f3');
insert into public.action_antisocial_levels (assignment_id, level, media_asset_id, status) values
  ('f0000000-0000-4000-8000-000000000006', 1, 'e0000000-0000-4000-8000-0000000000f4', 'verified');

------------------------------------------------------------------------------
-- What a member can try with their own token, each written once and run
-- twice by network_media_assets_pointer_guard.attacks.sql: before the guard
-- (it must work: that is the finding) and after it (it must be refused).
-- min_rows is what the last statement changes before the guard.
------------------------------------------------------------------------------
create table t.attacks (
  key text primary key,
  what text not null,
  as_user uuid not null,
  statements text[] not null,
  min_rows integer not null
);
insert into t.attacks values
('a_repoint_reviewed_photo',
 '(a) the photo on a public FBI case: point the row at another upload under the same prefix',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 array[$$update public.network_media_assets
            set object_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000ff-swapped.jpg'
          where id = 'e0000000-0000-4000-8000-0000000000f1'$$], 1),
('a_repoint_to_other_bucket',
 '(a) point the row into another private bucket',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 array[$$update public.network_media_assets
            set bucket_id = 'mcc-gated-audio', object_path = 'direct-sales/somebody-elses-master.wav'
          where id = 'e0000000-0000-4000-8000-0000000000f9'$$], 1),
('b_delete_and_reinsert_same_id',
 '(b) the proof the desk reviewed: delete the row and insert another upload under the same id',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 array[$$delete from public.network_media_assets where id = 'e0000000-0000-4000-8000-0000000000f2'$$,
       $$insert into public.network_media_assets (id, owner_m_uid, bucket_id, object_path, media_type, mime_type, status)
         values ('e0000000-0000-4000-8000-0000000000f2', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media',
                 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-0000000000fe-different.mp4', 'video', 'video/mp4', 'ready')$$], 1),
('b_delete_level_clip',
 '(b) delete the row an Anti-Social level names (the level silently loses its clip: ON DELETE SET NULL)',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 array[$$delete from public.network_media_assets where id = 'e0000000-0000-4000-8000-0000000000f4'$$], 1),
('b_insert_pointer_into_another_members_prefix',
 '(b) insert a row of your own that names somebody else''s upload',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 array[$$insert into public.network_media_assets (owner_m_uid, bucket_id, object_path, media_type, mime_type, status)
         values ('a0000000-0000-4000-8000-00000000000a', 'mnet-media',
                 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/10000000-0000-4000-8000-0000000000b1-mine.png.copy', 'image', 'image/png', 'ready')$$], 1),
('s_blocked_back_to_ready',
 '(s) what the desk blocked, back to ready',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 array[$$update public.network_media_assets set status = 'ready' where id = 'e0000000-0000-4000-8000-0000000000f7'$$], 1),
('s_deleted_back_to_ready',
 '(s) what was marked deleted, back to ready',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 array[$$update public.network_media_assets set status = 'ready' where id = 'e0000000-0000-4000-8000-0000000000f8'$$], 1),
('s_unreserve_fbi_evidence',
 '(s) evidence reserved for an FBI case, back to ready so it can be discarded',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 array[$$update public.network_media_assets set status = 'ready' where id = 'e0000000-0000-4000-8000-0000000000f1'$$], 1),
('s_ready_without_an_upload',
 '(s) a slot nothing was uploaded to, marked ready',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 array[$$update public.network_media_assets set status = 'ready' where id = 'e0000000-0000-4000-8000-0000000000f6'$$], 1),
('x_another_members_row_update',
 'another member''s row: B tries to repoint A''s case photo (never worked: RLS hides it)',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 array[$$update public.network_media_assets
            set object_path = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/10000000-0000-4000-8000-0000000000fd-b-swap.jpg'
          where id = 'e0000000-0000-4000-8000-0000000000f1'$$], 0),
('x_another_members_row_delete',
 'another member''s row: B tries to delete A''s proof upload (never worked: RLS hides it)',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 array[$$delete from public.network_media_assets where id = 'e0000000-0000-4000-8000-0000000000f2'$$], 0);

-- Run the statements as that member, report what happened, and undo it: the
-- attempt runs in a sub-transaction that is always rolled back, so the same
-- statements can be run again on the same rows.
create function t.attempt(p_user uuid, p_statements text[]) returns text language plpgsql as $$
declare v_sql text; v_n bigint := 0; v_state text; v_msg text;
begin
  begin
    perform t.as_member(p_user);
    foreach v_sql in array p_statements loop
      execute v_sql;
      get diagnostics v_n = row_count;
    end loop;
    raise exception using errcode = 'T0000', message = v_n::text;
  exception
    when sqlstate 'T0000' then return 'ok ' || sqlerrm;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
      return v_state || ' ' || v_msg;
  end;
end $$;

-- What the rows under test look like, to prove an attempt left them alone.
create function t.rows_digest() returns text language sql stable as $$
  select md5(coalesce(string_agg(a.id::text || '|' || a.owner_m_uid::text || '|' || a.bucket_id || '|' || a.object_path || '|' || a.status
                                 || '|' || coalesce(a.post_id::text, ''), ',' order by a.id), ''))
    from public.network_media_assets a
$$;
