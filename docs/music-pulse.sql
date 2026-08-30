-- ============================================================
-- THE PULSE — the desk's numbers, aggregate-only.
--
-- The creator desk (album.html, Creator mode) asks one RPC for
-- the career pulse: total streams, this week vs last week,
-- saves, and the top record. Same first-party events table the
-- play counter reads — totals only, nothing else readable.
--
-- Requires the events table (docs/here-engine.sql paste 1) and
-- docs/play-counts.sql.
--
-- PASTE: Supabase → SQL Editor → run this whole file once.
-- ============================================================

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

-- self-check: one json blob with five keys
select public.music_pulse();
