-- ============================================================
-- FEED — the daily record desk.
--
-- One table: the claim going around, the context that corrects
-- it, and the sources that back it. The world can read; only
-- the desk can file. Feeds feed.html — and every entry is the
-- citable link a reel points back to.
--
-- PASTE: Supabase → SQL Editor → run this whole file once.
-- (If you already ran the earlier wire.sql, uncomment the drop
--  line below to clear the old empty table first.)
-- ============================================================

-- drop table if exists public.wire;

create table if not exists public.feed (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  claim      text not null,
  context    text not null,
  sources    jsonb not null default '[]'::jsonb,
  tag        text not null default '',
  uid        uuid default auth.uid()
);

alter table public.feed enable row level security;

-- the world reads the record
drop policy if exists feed_read on public.feed;
create policy feed_read on public.feed
  for select to anon, authenticated using (true);

-- only the desk files reports
drop policy if exists feed_file on public.feed;
create policy feed_file on public.feed
  for insert to authenticated
  with check ((auth.jwt()->>'email') = 'matthew@mccluster.org');

-- and only the desk can pull one
drop policy if exists feed_pull on public.feed;
create policy feed_pull on public.feed
  for delete to authenticated
  using ((auth.jwt()->>'email') = 'matthew@mccluster.org');

grant select on public.feed to anon, authenticated;
grant insert, delete on public.feed to authenticated;

-- self-check: an empty (or growing) feed, newest first
select id, created_at, claim, tag from public.feed order by created_at desc limit 5;
