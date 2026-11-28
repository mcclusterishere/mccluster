-- Public bucket listing, v1 (Supabase security review of 2026-11-28,
-- docs/control-plane/SUPABASE-HARDENING-2026-11-28.md, finding S1).
--
-- PENDING. Not applied to production. Apply only with the owner's approval, per
-- supabase/pending/README.md ("To promote one").
--
-- Purpose: stop anyone, signed out or in, from LISTING every object in four public
-- buckets, without changing who can READ, upload, replace or delete a file.
--
-- Production on 2026-11-28 (read-only check of pg_policies) has one SELECT policy per
-- bucket whose only test is the bucket id:
--   "creator artwork is public"        to anon, authenticated  (creator-artwork)
--   "creator previews are public"      to anon, authenticated  (creator-previews)
--   "cuts are public to read"          to anon, authenticated  (cuts)
--   "mnet avatars are world readable"  to public               (mnet-avatars)
-- A SELECT policy on storage.objects is what POST /storage/v1/object/list/<bucket>
-- answers from, so the anon key alone enumerates every path in those buckets,
-- including the listener previews and artwork of releases still in review (uploaded
-- before the release row is approved) and every member's avatar folder by user id.
--
-- Reading is unaffected. These four buckets are public (storage.buckets.public), and
-- Storage serves /storage/v1/object/public/<bucket>/<path> and
-- /storage/v1/render/image/public/... without consulting RLS. Every reader in the repo
-- uses those URLs (js/music-creator-page.js, js/music-community.js, js/mnet.js,
-- getPublicUrl in js/music-creator-studio.js); the Worker and edge functions use the
-- service key. Nothing in js/, workers/ or supabase/functions/ lists these buckets.
--
-- Owners keep a SELECT policy over their own objects, because Storage needs one to
-- answer an owner's remove() (DELETE ... RETURNING), an upsert (x-upsert: true, used by
-- js/mnet.js for avatars) and an owner's own listing. Each new policy uses exactly the
-- predicate that bucket's existing DELETE/UPDATE policy already uses, so an owner can see
-- precisely the objects they could already delete:
--   creator-artwork, creator-previews: public.music_asset_is_mine(bucket_id, name)
--     (as "creator reads own private masters" does for creator-masters)
--   cuts, mnet-avatars: (storage.foldername(name))[1] = auth.uid()::text
--
-- Dependency order: none; applies to production as it is today.
-- Rollback: supabase/pending/20261128090000_storage_public_bucket_listing_v1.rollback.sql
-- Test: bash scripts/test-storage-listing-db.sh (scratch Postgres, never production).

set local lock_timeout = '5s';

drop policy if exists "creator artwork is public" on storage.objects;
drop policy if exists "creator previews are public" on storage.objects;
drop policy if exists "cuts are public to read" on storage.objects;
drop policy if exists "mnet avatars are world readable" on storage.objects;

drop policy if exists "creator reads own public music objects" on storage.objects;
create policy "creator reads own public music objects" on storage.objects
  for select to authenticated
  using (bucket_id = any (array['creator-previews'::text, 'creator-artwork'::text])
         and public.music_asset_is_mine(bucket_id, name));

drop policy if exists "creators read their own folder" on storage.objects;
create policy "creators read their own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'cuts'::text
         and (storage.foldername(name))[1] = ((select auth.uid()))::text);

drop policy if exists "mnet avatars are read by their owner" on storage.objects;
create policy "mnet avatars are read by their owner" on storage.objects
  for select to authenticated
  using (bucket_id = 'mnet-avatars'::text
         and (storage.foldername(name))[1] = ((select auth.uid()))::text);
