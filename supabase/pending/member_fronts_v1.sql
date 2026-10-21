-- MEMBER FRONT PAGES V1 (pending; NOT applied in production)
--
-- What it fixes: only the house owner's front page (index.html) has the
-- experience: the scroll films, the 360 cabin, the night descent. Owner,
-- 2026-10-21: "all the accounts need to be able to recreate with their own
-- media this exact same experience ... my front page with a VR, with the
-- scroll dependent video, all this."
--
-- What it adds:
--   * public.member_fronts: one front page per account. `draft` is what the
--     account is building; `published` is what visitors get at
--     front.html?u=<handle>. Both are the same JSON the house's own page
--     reads (js/main.js frontConfig; packages/front-config validates it
--     again in the Worker). removed_at is the house's takedown.
--   * storage bucket front-media: the account's own films (cut into frames
--     in their browser), 360 cabin, posters and soundtrack. Public on
--     purpose: a front page is a public page, and a film is hundreds of
--     frame requests a signed URL could not serve. Writing is not public:
--     every account owns one folder, named by its auth uid, and only that,
--     up to 2,500 files and 1 GiB (public.front_media_has_room).
--
-- Who reads and writes member_fronts: the Worker `mccluster`, with the
-- service role, after it has checked the session (GET/POST /v1/fronts/me) or
-- for anyone (GET /v1/fronts/:handle, published and not removed only).
-- Nobody reaches the table through PostgREST.
--
-- Rollback:
--   drop table if exists public.member_fronts;
--   delete from storage.buckets where id = 'front-media';  -- after emptying it
--   (and the four "front media" policies on storage.objects: listed, written,
--   replaced and removed by their owner)
--   drop function if exists public.front_media_has_room();
--
-- Promote with supabase/pending/README.md.

create table if not exists public.member_fronts (
  m_uid         uuid primary key,
  auth_user_id  uuid not null,
  handle        text not null,
  draft         jsonb not null default '{}'::jsonb,
  published     jsonb,
  published_at  timestamptz,
  updated_at    timestamptz not null default now(),
  removed_at    timestamptz,
  removed_reason text,
  constraint member_fronts_handle_ck check (handle ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  constraint member_fronts_draft_ck check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 65536),
  constraint member_fronts_published_ck check (published is null or (jsonb_typeof(published) = 'object' and pg_column_size(published) <= 65536))
);
create unique index if not exists member_fronts_handle_key on public.member_fronts (handle);
create index if not exists member_fronts_auth_user_idx on public.member_fronts (auth_user_id);

comment on table public.member_fronts is
  'One front page per account (front.html?u=<handle>): the same JSON the house page reads. Written only by the Worker after a session check; read publicly only through the Worker, published and not removed.';

alter table public.member_fronts enable row level security;
alter table public.member_fronts force row level security;
revoke all on table public.member_fronts from public, anon, authenticated;
grant select, insert, update, delete on table public.member_fronts to service_role;

-- THE MEDIA. 300 MB covers a 360 film; a scroll film never arrives as
-- video at all (its frames are cut in the account's browser, a few tens of
-- KB each).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'front-media',
  'front-media',
  true,
  314572800,
  array['image/webp', 'image/jpeg', 'image/png', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- EVERY ACCOUNT OWNS ONE FOLDER: the first path segment is the uploader's
-- auth uid (as mnet-avatars). Anyone reads a file by its public URL (the
-- bucket is public; that needs no policy). Through the API an account sees
-- only its own folder: enough to replace its own files (an upsert reads
-- first), never a listing of everyone's uploads, drafts included.
drop policy if exists "front media is world readable" on storage.objects;
drop policy if exists "front media is listed to its owner" on storage.objects;
create policy "front media is listed to its owner"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'front-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- EVERY ACCOUNT HAS ROOM FOR ONE PAGE, NOT A WAREHOUSE (Codex #595). The
-- bucket's 300 MB is per file; this is per account: at most 2,500 files and
-- 1 GiB in its folder. A full page is four films (up to 320 frames each, a
-- few tens of MB), a 360 of up to 300 MB, a still and a track, with room to
-- replace one before the editor removes what the page no longer uses
-- (js/front-studio.js). A write that would start past either line is refused.
create or replace function public.front_media_has_room()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) < 2500
     and coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]{1,18}$' then (o.metadata->>'size')::bigint else 0 end), 0) < 1073741824
  from storage.objects o
  where o.bucket_id = 'front-media'
    and o.name like (select auth.uid())::text || '/%'
$$;
comment on function public.front_media_has_room() is
  'Whether the signed-in account''s front-media folder is under 2,500 files and 1 GiB: the storage policies refuse an upload past either.';
revoke all on function public.front_media_has_room() from public, anon;
grant execute on function public.front_media_has_room() to authenticated, service_role;

drop policy if exists "front media is written by its owner" on storage.objects;
create policy "front media is written by its owner"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'front-media' and (storage.foldername(name))[1] = auth.uid()::text and public.front_media_has_room());

drop policy if exists "front media is replaced by its owner" on storage.objects;
create policy "front media is replaced by its owner"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'front-media' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'front-media' and (storage.foldername(name))[1] = auth.uid()::text and public.front_media_has_room());

drop policy if exists "front media is removed by its owner" on storage.objects;
create policy "front media is removed by its owner"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'front-media' and (storage.foldername(name))[1] = auth.uid()::text);
