create or replace function public.analytics_content(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null)
returns table (
  track text,
  album text,
  starts bigint,
  listeners bigint,
  sessions bigint,
  repeat_listeners bigint,
  plays_per_listener numeric,
  full_plays bigint,
  preview_plays bigint,
  completions bigint,
  preview_completions bigint,
  track_views bigint,
  shares bigint,
  avg_listened_seconds numeric,
  first_heard timestamptz,
  last_heard timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  with media as materialized (
    select
      e.at,
      e.name,
      e.device_id,
      e.session_id,
      case
        when lower(coalesce(e.props->>'song','')) = 'whodidtheshoot' then 'who did the shoot'
        else nullif(trim(regexp_replace(lower(coalesce(e.props->>'track', e.props->>'song')), '[-_]+', ' ', 'g')), '')
      end as track,
      nullif(trim(coalesce(e.props->>'album', e.props->>'album_slug')), '') as album,
      case
        when jsonb_typeof(e.props->'listened_seconds') = 'number'
          then (e.props->>'listened_seconds')::numeric
        else null
      end as listened_seconds
    from public.events e
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and coalesce(e.is_bot, false) = false
      and e.name in (
        'album_play','song_start','track_start','music_play',
        'music_full_play','music_preview_play','music_complete','music_preview_complete',
        'track_view','track_share'
      )
  ),
  starts_by_listener as (
    select m.track, m.device_id, count(*) as n
    from media m
    where m.track is not null
      and m.device_id is not null
      and m.name in ('album_play','song_start','track_start','music_play')
    group by m.track, m.device_id
  )
  select
    m.track,
    coalesce(max(m.album), '—') as album,
    count(*) filter (where m.name in ('album_play','song_start','track_start','music_play'))::bigint as starts,
    count(distinct m.device_id) filter (where m.name in ('album_play','song_start','track_start','music_play'))::bigint as listeners,
    count(distinct m.session_id) filter (where m.name in ('album_play','song_start','track_start','music_play'))::bigint as sessions,
    count(distinct s.device_id) filter (where s.n > 1)::bigint as repeat_listeners,
    round(
      count(*) filter (where m.name in ('album_play','song_start','track_start','music_play'))::numeric /
      nullif(count(distinct m.device_id) filter (where m.name in ('album_play','song_start','track_start','music_play')), 0)::numeric,
      2
    ) as plays_per_listener,
    count(*) filter (where m.name = 'music_full_play')::bigint as full_plays,
    count(*) filter (where m.name = 'music_preview_play')::bigint as preview_plays,
    count(*) filter (where m.name = 'music_complete')::bigint as completions,
    count(*) filter (where m.name = 'music_preview_complete')::bigint as preview_completions,
    count(*) filter (where m.name = 'track_view')::bigint as track_views,
    count(*) filter (where m.name = 'track_share')::bigint as shares,
    round(avg(m.listened_seconds) filter (where m.listened_seconds is not null), 1) as avg_listened_seconds,
    min(m.at) as first_heard,
    max(m.at) as last_heard
  from media m
  left join starts_by_listener s on s.track = m.track and s.device_id = m.device_id
  where m.track is not null
  group by m.track
  order by listeners desc nulls last, starts desc, m.track;
$$;

create or replace function public.analytics_content_events(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null)
returns table (event_name text, events bigint, people bigint, sessions bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.name,
    count(*)::bigint,
    count(distinct e.device_id)::bigint,
    count(distinct e.session_id)::bigint
  from public.events e
  where e.at >= p_since and e.at < p_until
    and e.site_id is not distinct from p_site
    and coalesce(e.is_bot, false) = false
    and e.name in (
      'album_play','song_start','track_start','music_play','music_full_play',
      'music_preview_play','music_complete','music_preview_complete',
      'track_view','track_share','shelf_preview','catalogue_view','listen_view',
      'film_view','films_view','listen_search','music_seek','music_now_open'
    )
  group by e.name
  order by count(*) desc, e.name;
$$;

create or replace function public.analytics_acquisition(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null)
returns table (
  source text,
  sessions bigint,
  people bigint,
  engagement_rate numeric,
  avg_seconds numeric,
  avg_pages numeric,
  conversions bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (
    select e.session_id,
      min(e.at) as started,
      max(e.at) as ended,
      max(e.device_id) as device_id,
      count(*) filter (where e.name = 'page_view') as pages,
      count(*) filter (where coalesce(t.stage, 'engage') in ('lead','checkout','purchase')) as conversions,
      coalesce(
        max(nullif(e.props->>'src','')) filter (where e.name = 'acquired'),
        max(nullif(e.props->>'source','')) filter (where e.name = 'acquired'),
        max(nullif(e.referrer,'')) filter (where e.name = 'page_view'),
        'direct'
      ) as source
    from public.events e
    left join public.event_taxonomy t on t.event_name = e.name
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and coalesce(e.is_bot, false) = false
      and e.session_id is not null
    group by e.session_id
  )
  select s.source,
    count(*)::bigint,
    count(distinct s.device_id)::bigint,
    round(100.0 * count(*) filter (
      where s.conversions > 0 or s.pages >= 2 or extract(epoch from (s.ended-s.started)) >= 10
    )::numeric / nullif(count(*),0)::numeric, 1),
    round(avg(extract(epoch from (s.ended-s.started)))::numeric, 1),
    round(avg(s.pages)::numeric, 2),
    sum(s.conversions)::bigint
  from s
  group by s.source
  having count(*) >= 2
  order by count(*) desc, s.source;
$$;

create or replace function public.analytics_paths(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null,
  p_limit int default 20)
returns table (from_page text, to_page text, moves bigint, sessions bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with steps as (
    select e.session_id, e.path, e.at,
      lead(e.path) over (partition by e.session_id order by e.at) as next_path
    from public.events e
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and coalesce(e.is_bot, false) = false
      and e.name in ('page_view','view')
      and e.path is not null
      and e.session_id is not null
  )
  select s.path, s.next_path, count(*)::bigint, count(distinct s.session_id)::bigint
  from steps s
  where s.next_path is not null and s.next_path <> s.path
  group by s.path, s.next_path
  having count(*) >= 2
  order by count(*) desc, s.path, s.next_path
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.analytics_content(timestamptz,timestamptz,uuid) from public, anon;
revoke all on function public.analytics_content_events(timestamptz,timestamptz,uuid) from public, anon;
revoke all on function public.analytics_acquisition(timestamptz,timestamptz,uuid) from public, anon;
revoke all on function public.analytics_paths(timestamptz,timestamptz,uuid,int) from public, anon;
grant execute on function public.analytics_content(timestamptz,timestamptz,uuid) to authenticated;
grant execute on function public.analytics_content_events(timestamptz,timestamptz,uuid) to authenticated;
grant execute on function public.analytics_acquisition(timestamptz,timestamptz,uuid) to authenticated;
grant execute on function public.analytics_paths(timestamptz,timestamptz,uuid,int) to authenticated;
