-- Rollback of 20261128090000_storage_public_bucket_listing_v1.sql: restores the four
-- bucket-wide SELECT policies exactly as production had them on 2026-11-28 (names,
-- roles and expressions read from pg_policies) and drops the three owner-only ones.
set local lock_timeout = '5s';

drop policy if exists "creator reads own public music objects" on storage.objects;
drop policy if exists "creators read their own folder" on storage.objects;
drop policy if exists "mnet avatars are read by their owner" on storage.objects;

drop policy if exists "creator artwork is public" on storage.objects;
create policy "creator artwork is public" on storage.objects
  for select to anon, authenticated using (bucket_id = 'creator-artwork'::text);
drop policy if exists "creator previews are public" on storage.objects;
create policy "creator previews are public" on storage.objects
  for select to anon, authenticated using (bucket_id = 'creator-previews'::text);
drop policy if exists "cuts are public to read" on storage.objects;
create policy "cuts are public to read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'cuts'::text);
drop policy if exists "mnet avatars are world readable" on storage.objects;
create policy "mnet avatars are world readable" on storage.objects
  for select to public using (bucket_id = 'mnet-avatars'::text);
