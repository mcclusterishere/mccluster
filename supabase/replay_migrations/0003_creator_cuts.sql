-- CREATOR CUTS — other people's records, same machine. One table +
-- one storage bucket. World reads public tracks; a creator writes
-- only their own; files land only in the creator's own folder.

create table if not exists public.creator_tracks (
  id         uuid primary key default gen_random_uuid(),
  uid        uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  title      text not null,
  artist     text not null default '',
  audio_url  text not null,
  poster_url text default '',
  lyrics     jsonb,
  reel       jsonb,
  public     boolean not null default true
);

alter table public.creator_tracks enable row level security;

drop policy if exists ct_read on public.creator_tracks;
create policy ct_read on public.creator_tracks
  for select to anon, authenticated
  using (public = true or uid = auth.uid());

drop policy if exists ct_write on public.creator_tracks;
create policy ct_write on public.creator_tracks
  for insert to authenticated with check (uid = auth.uid());

drop policy if exists ct_edit on public.creator_tracks;
create policy ct_edit on public.creator_tracks
  for update to authenticated using (uid = auth.uid());

drop policy if exists ct_pull on public.creator_tracks;
create policy ct_pull on public.creator_tracks
  for delete to authenticated using (uid = auth.uid());

grant select on public.creator_tracks to anon, authenticated;
grant insert, update, delete on public.creator_tracks to authenticated;

-- the vault: one public bucket, per-creator folders
insert into storage.buckets (id, name, public)
values ('cuts', 'cuts', true)
on conflict (id) do nothing;

drop policy if exists "cuts are public to read" on storage.objects;
create policy "cuts are public to read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'cuts');

drop policy if exists "creators fill their own folder" on storage.objects;
create policy "creators fill their own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cuts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "creators clean their own folder" on storage.objects;
create policy "creators clean their own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cuts' and (storage.foldername(name))[1] = auth.uid()::text);
