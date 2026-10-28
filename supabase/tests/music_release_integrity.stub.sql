-- Extra stand-ins for supabase/pending/music_release_payment_integrity_v1.sql,
-- applied by scripts/test-music-release-integrity-db.sh after
-- supabase_api_roles.stub.sql and music_creator_onboarding.stub.sql. Scratch
-- database only, never a real project.
--
-- creator_tracks' older columns (supabase/replay_migrations/0003_creator_cuts.sql
-- and 20261006233518_here_album_commerce_v1_reconcile.sql) and the owner
-- columns Supabase Storage keeps on storage.objects. As in production, the
-- Storage API stamps owner/owner_id from the uploader's token on a direct
-- upload; an upload through a service-role signed URL leaves them null.
alter table public.creator_tracks
  add column if not exists audio_url text not null default '',
  add column if not exists poster_url text default '',
  add column if not exists lyrics jsonb,
  add column if not exists reel jsonb,
  add column if not exists public boolean not null default true,
  add column if not exists music_video_url text not null default '',
  add column if not exists lyrics_url text not null default '',
  add column if not exists experience jsonb not null default '{}'::jsonb;

alter table storage.objects
  add column if not exists owner uuid default nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '')::uuid,
  add column if not exists owner_id text default nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'sub', '');
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
