-- Production's storage.objects policies for the four public buckets as they were on
-- 2026-11-28 (pg_policies, read-only), plus a stand-in for public.music_asset_is_mine
-- (production's answers from release rows and the owner's folder; here, the folder).
-- Applied after supabase_api_roles.stub.sql, schema_test_helpers.sql and
-- supabase_storage.stub.sql. Test-only. Never applied to a real project.
create or replace function public.music_asset_is_mine(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select auth.uid() is not null and (string_to_array(p_name, '/'))[1] = auth.uid()::text
$$;
revoke all on function public.music_asset_is_mine(text, text) from public, anon;
grant execute on function public.music_asset_is_mine(text, text) to authenticated, service_role;

insert into storage.buckets(id, name, public) values
  ('creator-artwork', 'creator-artwork', true), ('creator-previews', 'creator-previews', true),
  ('cuts', 'cuts', true), ('mnet-avatars', 'mnet-avatars', true)
on conflict do nothing;

create policy "creator artwork is public" on storage.objects
  for select to anon, authenticated using (bucket_id = 'creator-artwork'::text);
create policy "creator previews are public" on storage.objects
  for select to anon, authenticated using (bucket_id = 'creator-previews'::text);
create policy "cuts are public to read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'cuts'::text);
create policy "mnet avatars are world readable" on storage.objects
  for select to public using (bucket_id = 'mnet-avatars'::text);
create policy "creator deletes uploaded music objects" on storage.objects
  for delete to authenticated
  using (bucket_id = any (array['creator-previews'::text, 'creator-masters'::text, 'creator-artwork'::text])
         and public.music_asset_is_mine(bucket_id, name));
create policy "creators clean their own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cuts'::text and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "mnet avatars are removed by their owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'mnet-avatars'::text and (storage.foldername(name))[1] = (auth.uid())::text);
create policy "mnet avatars are replaced by their owner" on storage.objects
  for update to authenticated
  using (bucket_id = 'mnet-avatars'::text and (storage.foldername(name))[1] = (auth.uid())::text);

-- Two members' files in each bucket, written as the service role.
insert into storage.objects(bucket_id, name, owner) values
  ('creator-artwork',  '11111111-1111-1111-1111-111111111111/a.png', '11111111-1111-1111-1111-111111111111'),
  ('creator-artwork',  '22222222-2222-2222-2222-222222222222/b.png', '22222222-2222-2222-2222-222222222222'),
  ('creator-previews', '11111111-1111-1111-1111-111111111111/a.mp3', '11111111-1111-1111-1111-111111111111'),
  ('creator-previews', '22222222-2222-2222-2222-222222222222/b.mp3', '22222222-2222-2222-2222-222222222222'),
  ('cuts',             '11111111-1111-1111-1111-111111111111/a.mp4', '11111111-1111-1111-1111-111111111111'),
  ('cuts',             '22222222-2222-2222-2222-222222222222/b.mp4', '22222222-2222-2222-2222-222222222222'),
  ('mnet-avatars',     '11111111-1111-1111-1111-111111111111/a.webp', '11111111-1111-1111-1111-111111111111'),
  ('mnet-avatars',     '22222222-2222-2222-2222-222222222222/b.webp', '22222222-2222-2222-2222-222222222222');
