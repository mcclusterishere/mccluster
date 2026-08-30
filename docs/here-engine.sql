-- ============================================================
-- THE HERE ENGINE — one paste, the whole backend.
--
-- For the dedicated "Here" Supabase project. Four pieces:
--  1. events      — the first-party analytics mirror
--  2. play_counts — the public per-track play counter
--  3. music_pulse — the creator desk's numbers
--  4. feed        — the daily record desk
--
-- PASTE: Supabase → SQL Editor → run this whole file once.
-- Idempotent — safe to run again.
-- ============================================================

-- ---------- 1. EVENTS — the platform's own eyes ----------
-- Every MCC_TRACK event lands here as well as GA4. Write-only
-- for the world; only the desk's sign-in can read rows back.
create table if not exists public.events (
  id    uuid primary key default gen_random_uuid(),
  at    timestamptz default now(),
  name  text not null,
  path  text default '',
  props jsonb default '{}'::jsonb,
  uid   uuid
);
create index if not exists events_at_idx on public.events (at desc);
create index if not exists events_name_idx on public.events (name, at desc);

alter table public.events enable row level security;

drop policy if exists "anyone writes the exhaust" on public.events;
create policy "anyone writes the exhaust"
  on public.events for insert
  to anon, authenticated
  with check (true);

drop policy if exists "only the desk reads it" on public.events;
create policy "only the desk reads it"
  on public.events for select
  using (auth.jwt() ->> 'email' = 'matthew@mccluster.org');

-- ---------- 2. PLAY COUNTS — public, totals only ----------
create or replace function public.play_counts()
returns table (track text, plays bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    props->>'track' as track,
    count(*)        as plays
  from public.events
  where name = 'album_play'
    and props ? 'track'
  group by props->>'track'
$$;

revoke all on function public.play_counts() from public;
grant execute on function public.play_counts() to anon, authenticated;

-- ---------- 3. THE PULSE — the creator desk ----------
create or replace function public.music_pulse()
returns json
language sql
security definer
set search_path = public
stable
as $$
  select json_build_object(
    'streams_total', (select count(*) from public.events where name = 'album_play'),
    'streams_7d',    (select count(*) from public.events where name = 'album_play'
                        and at > now() - interval '7 days'),
    'streams_prev7d',(select count(*) from public.events where name = 'album_play'
                        and at <= now() - interval '7 days'
                        and at >  now() - interval '14 days'),
    'saves_total',   (select count(*) from public.events where name = 'rotation_add'),
    'top_track',     (select props->>'track' from public.events
                       where name = 'album_play' and props ? 'track'
                       group by 1 order by count(*) desc limit 1)
  );
$$;

revoke all on function public.music_pulse() from public;
grant execute on function public.music_pulse() to anon, authenticated;

-- ---------- 4. FEED — the daily record desk ----------
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

drop policy if exists feed_read on public.feed;
create policy feed_read on public.feed
  for select to anon, authenticated using (true);

drop policy if exists feed_file on public.feed;
create policy feed_file on public.feed
  for insert to authenticated
  with check ((auth.jwt()->>'email') = 'matthew@mccluster.org');

drop policy if exists feed_pull on public.feed;
create policy feed_pull on public.feed
  for delete to authenticated
  using ((auth.jwt()->>'email') = 'matthew@mccluster.org');

grant select on public.feed to anon, authenticated;
grant insert, delete on public.feed to authenticated;

-- ---------- self-check: expect events=1, feed=1, and two functions ----------
select
  (select count(*) from information_schema.tables  where table_schema='public' and table_name='events') as events_ready,
  (select count(*) from information_schema.tables  where table_schema='public' and table_name='feed')   as feed_ready,
  (select count(*) from information_schema.routines where routine_schema='public' and routine_name in ('play_counts','music_pulse')) as functions_ready;
