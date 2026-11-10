-- Rows that are NOT canonical uploads, as a member could have written them
-- while the table was theirs, and what names them. The guard refuses to apply
-- while one exists (its CHECK is NOT VALID, which would freeze them and block
-- the deletion of the post one is attached to), so the owner decides them
-- first. Applied by scripts/test-network-media-pointer-guard-db.sh BEFORE the
-- guard:
--   psql -v cleanup=false   write them
--   psql -v cleanup=true    the owner's decision, as the test takes it: delete them
-- Scratch database only.
\set ON_ERROR_STOP on
\if :cleanup

-- a clipping source's row is held by its foreign key until the campaign lets go
delete from public.action_clip_assets where network_media_asset_id = 'e0000000-0000-4000-8000-00000000001a';
delete from public.network_media_assets where id in
  ('e0000000-0000-4000-8000-00000000001a', 'e0000000-0000-4000-8000-00000000001b', 'e0000000-0000-4000-8000-00000000001d');
delete from public.network_posts where id = 'd0000000-0000-4000-8000-0000000000a2';

\else

insert into public.network_posts (id, author_m_uid, body) values
  ('d0000000-0000-4000-8000-0000000000a2', 'a0000000-0000-4000-8000-00000000000a', 'A''s post carrying a legacy row');
insert into public.network_media_assets (id, owner_m_uid, bucket_id, object_path, media_type, mime_type, status, post_id) values
  -- a hand-made path, named by a clipping source
  ('e0000000-0000-4000-8000-00000000001a', 'a0000000-0000-4000-8000-00000000000a', 'mnet-media', 'regress/clip-source.mp3', 'audio', 'audio/mpeg', 'ready', null),
  -- another private bucket (the pointer the signing fix refuses), attached to
  -- A's post. Its path would be canonical in mnet-media, under A's own login:
  -- only the bucket makes it not an upload, so the bucket must be part of the rule.
  ('e0000000-0000-4000-8000-00000000001b', 'a0000000-0000-4000-8000-00000000000a', 'mcc-gated-audio',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/10000000-0000-4000-8000-00000000001b-unreleased-master.wav', 'audio', 'audio/wav', 'attached', 'd0000000-0000-4000-8000-0000000000a2'),
  -- C's own hand-made path
  ('e0000000-0000-4000-8000-00000000001d', 'c0000000-0000-4000-8000-00000000000c', 'mnet-media', 'old/c-upload.png', 'image', 'image/png', 'ready', null);
insert into public.action_clip_assets (id, network_media_asset_id) values
  ('f0000000-0000-4000-8000-000000000005', 'e0000000-0000-4000-8000-00000000001a');

\endif
