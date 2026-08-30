-- ============================================================
-- THE PLAY COUNTER — public, aggregate, first-party.
--
-- Every play already lands twice: GA4 (G-38KDY01Z2V) keeps
-- Google's copy behind Google's login, and js/analytics.js
-- mirrors the same event into the platform's own events table.
-- Google's Data API can't be queried from a public page without
-- exposing credentials, so the public counter reads the mirror:
-- one RPC that returns totals only — no rows, no visitors,
-- no paths. The anon key can call it and learn nothing else.
--
-- PASTE: Supabase → SQL Editor → run this whole file once.
-- The player lights up its play counts on the next page load.
-- ============================================================

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

-- self-check: should return one row per track that has ever played
select * from public.play_counts() order by plays desc;
