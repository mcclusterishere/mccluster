-- The catalogue as it could stand BEFORE
-- supabase/migrations/20261030001000_music_release_payment_integrity_v1.sql: written through the
-- v1 guards, including what those guards allowed and should not have. Applied
-- by scripts/test-music-release-integrity-db.sh before the migration file.
\set ON_ERROR_STOP 1
select set_config('request.jwt.claims', '{"role":"service_role"}', false);

insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'ana@test'),
  ('00000000-0000-4000-8000-0000000000b1', 'bo@test');
insert into public.m_people(id) values
  ('10000000-0000-4000-8000-0000000000a1'), ('10000000-0000-4000-8000-0000000000b1');
insert into public.m_auth_user_links(auth_user_id, m_uid) values
  ('00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-0000000000b1');

-- Uploaded through music-access grants (service-role signed URLs): Storage
-- stamped no owner. Each sits in its uploader's folder.
insert into storage.objects(bucket_id, name, owner, owner_id) values
  ('creator-masters',  '00000000-0000-4000-8000-0000000000a1/a-master.wav', null, null),
  ('creator-previews', '00000000-0000-4000-8000-0000000000a1/a-preview.mp3', null, null),
  ('creator-masters',  '00000000-0000-4000-8000-0000000000b1/b-master.wav', null, null),
  ('creator-previews', '00000000-0000-4000-8000-0000000000b1/b-preview.mp3', null, null),
  ('creator-artwork',  '00000000-0000-4000-8000-0000000000b1/b-cover.png', null, null);

-- Ana's honest, published release, and one whose master is Bo's (the v1
-- guard let a creator write any path).
insert into public.creator_tracks(id, uid, m_uid, title, artist, slug, status, rights_status, access_mode,
                                  preview_path, master_path, audio_url, published_at) values
  ('20000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
   'Honest', 'Ana', 'honest', 'published', 'cleared', 'purchase',
   '00000000-0000-4000-8000-0000000000a1/a-preview.mp3', '00000000-0000-4000-8000-0000000000a1/a-master.wav',
   'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/creator-previews/00000000-0000-4000-8000-0000000000a1/a-preview.mp3',
   now()),
  ('20000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
   'Borrowed', 'Ana', 'borrowed', 'published', 'cleared', 'purchase',
   '00000000-0000-4000-8000-0000000000a1/a-preview.mp3', '00000000-0000-4000-8000-0000000000b1/b-master.wav',
   'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/creator-previews/00000000-0000-4000-8000-0000000000a1/a-preview.mp3',
   now());

-- An offer whose commission the creator lowered to one basis point.
insert into public.music_license_offers(id, track_id, creator_m_uid, slug, title, license_type, price_cents, currency,
                                        terms_text, active, checkout_enabled, platform_fee_bps) values
  ('30000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-0000000000a1',
   'commercial-a', 'Commercial', 'commercial_basic', 1000, 'usd', 'Terms.', true, true, 1);
