-- Hot-path repair for public.play_counts().
-- Preserve lifetime play semantics while allowing PostgreSQL to satisfy the
-- album_play + track grouping from a narrow expression index instead of
-- repeatedly scanning the historical analytics event heap.

create index if not exists events_album_play_track_idx
  on public.events ((props->>'track'))
  where name = 'album_play' and props ? 'track';

-- Keep the RPC deliberately aggregate-only and its execution surface explicit.
create or replace function public.play_counts()
returns table (track text, plays bigint)
language sql
security definer
set search_path = ''
stable
as $$
  select
    e.props->>'track' as track,
    count(*) as plays
  from public.events e
  where e.name = 'album_play'
    and e.props ? 'track'
  group by e.props->>'track'
$$;

revoke all on function public.play_counts() from public;
grant execute on function public.play_counts() to anon, authenticated, service_role;
