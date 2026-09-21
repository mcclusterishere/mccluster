-- MNET: SOMEWHERE TO PUT A FACE.
--
-- The profile form offered "AVATAR URL — https://…" and nothing else. There
-- was no upload, no bucket, and no policy: a member could only have a picture
-- if they already hosted one somewhere else, which for almost everybody means
-- they could not have one at all. That is why saving a profile photo did not
-- work — not a bug in the save, an absence of the feature.
--
-- Public bucket on purpose. An avatar is shown next to every post its owner
-- writes, to people who may not be signed in, so a private bucket would mean
-- minting a signed URL per avatar per render. The objects are public; WRITING
-- them is not.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mnet-avatars',
  'mnet-avatars',
  true,
  5242880,  -- 5 MB: a profile picture, not a master
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- EVERY MEMBER OWNS A FOLDER AND ONLY THEIR OWN. The first path segment is
-- the uploader's auth uid, so `storage.foldername(name)[1]` is the owner and
-- the policy is the whole of the access control: without it any signed-in
-- member could overwrite anybody's face.
drop policy if exists "mnet avatars are world readable" on storage.objects;
create policy "mnet avatars are world readable"
  on storage.objects for select
  using (bucket_id = 'mnet-avatars');

drop policy if exists "mnet avatars are written by their owner" on storage.objects;
create policy "mnet avatars are written by their owner"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'mnet-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "mnet avatars are replaced by their owner" on storage.objects;
create policy "mnet avatars are replaced by their owner"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'mnet-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "mnet avatars are removed by their owner" on storage.objects;
create policy "mnet avatars are removed by their owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'mnet-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
