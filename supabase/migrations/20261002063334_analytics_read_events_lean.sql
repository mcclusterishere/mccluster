-- ANALYTICS READS A LEAN COPY OF THE EVENTS, step two: the function swap.
--
-- The trigger from the previous migration copies every new event. The past
-- was copied separately, in date batches through an inline projection
-- (91,045 of 91,045 rows on 2026-10-02): a single statement over all of
-- public.events restarted this instance, so the backfill is deliberately
-- not part of this migration. Every dashboard function keeps its name,
-- arguments and result shape; only the table it reads changes.
analyze public.events_lean;


-- ---------------------------------------------------------------------------
-- The dashboard functions, unchanged in name, arguments and result shape.
-- ---------------------------------------------------------------------------
create or replace function public.analytics_daily(p_since timestamptz, p_until timestamptz default now(), p_site uuid default null, p_tz text default 'UTC')
returns table(day date, page_views bigint, visits bigint, visitors bigint, sessions bigint, plays bigint, events bigint, avg_dwell_s numeric)
language sql stable
set search_path = ''
as $$
  select (e.at at time zone p_tz)::date,
    count(*) filter (where e.name = 'page_view' or (e.name = 'bar_boot' and e.at < (
      select coalesce(min(p.at), 'infinity'::timestamptz) from public.events_lean p
      where p.name = 'page_view' and p.site_id is not distinct from p_site))),
    count(*) filter (where e.name = 'acquired'),
    count(distinct e.device_id),
    count(distinct e.session_id),
    count(*) filter (where e.name in ('album_play', 'song_start')),
    count(*),
    round(avg(e.dwell_s), 1)
  from public.events_lean e
  where e.at >= p_since and e.at < p_until
    and e.site_id is not distinct from p_site
    and not e.is_bot
  group by 1
  order by 1;
$$;

create or replace function public.analytics_totals(p_since timestamptz, p_until timestamptz default now(), p_site uuid default null)
returns table(page_views bigint, visits bigint, visitors bigint, sessions bigint, plays bigint, events bigint, first_event timestamptz, identity_since timestamptz)
language sql stable
set search_path = ''
as $$
  select
    count(*) filter (where e.name = 'page_view' or (e.name = 'bar_boot' and e.at < (
      select coalesce(min(p.at), 'infinity'::timestamptz) from public.events_lean p
      where p.name = 'page_view' and p.site_id is not distinct from p_site))),
    count(*) filter (where e.name = 'acquired'),
    count(distinct e.device_id),
    count(distinct e.session_id),
    count(*) filter (where e.name in ('album_play', 'song_start')),
    count(*),
    min(e.at),
    min(e.at) filter (where e.device_id is not null)
  from public.events_lean e
  where e.at >= p_since and e.at < p_until
    and e.site_id is not distinct from p_site
    and not e.is_bot;
$$;

create or replace function public.analytics_top(p_dim text, p_since timestamptz, p_until timestamptz default now(), p_site uuid default null, p_limit integer default 12)
returns table(key text, n bigint)
language sql stable
set search_path = ''
as $$
  select r.key, count(*)::bigint
  from (
    select case p_dim
             when 'page' then nullif(e.path, '')
             when 'source' then coalesce(e.src, 'direct')
             when 'country' then e.country
             when 'network' then e.network
           end as key
    from public.events_lean e
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and not e.is_bot
      and case p_dim
            when 'source' then e.name = 'acquired'
            else e.name = 'page_view' or (e.name = 'bar_boot' and e.at < (
              select coalesce(min(p.at), 'infinity'::timestamptz) from public.events_lean p
              where p.name = 'page_view' and p.site_id is not distinct from p_site))
          end
  ) r
  where r.key is not null
  group by r.key
  order by 2 desc, 1
  limit greatest(1, least(p_limit, 100));
$$;

create or replace function public.analytics_content_events(p_since timestamptz, p_until timestamptz default now(), p_site uuid default null)
returns table(event_name text, events bigint, people bigint, sessions bigint)
language sql stable
set search_path = ''
as $$
  select e.name,
    count(*)::bigint,
    count(distinct e.device_id)::bigint,
    count(distinct e.session_id)::bigint
  from public.events_lean e
  where e.at >= p_since and e.at < p_until
    and e.site_id is not distinct from p_site
    and not e.is_bot
    and e.name in (
      'album_play','song_start','track_start','music_play','music_full_play',
      'music_preview_play','music_complete','music_preview_complete',
      'track_view','track_share','shelf_preview','catalogue_view','listen_view',
      'film_view','films_view','listen_search','music_seek','music_now_open'
    )
  group by e.name
  order by count(*) desc, e.name;
$$;

create or replace function public.analytics_content(p_since timestamptz, p_until timestamptz default now(), p_site uuid default null)
returns table(track text, album text, starts bigint, listeners bigint, sessions bigint, repeat_listeners bigint, plays_per_listener numeric, full_plays bigint, preview_plays bigint, completions bigint, preview_completions bigint, track_views bigint, shares bigint, avg_listened_seconds numeric, first_heard timestamptz, last_heard timestamptz)
language sql stable
set search_path = ''
as $$
  with media as materialized (
    select e.at, e.name, e.device_id, e.session_id, e.track, e.album, e.listened_seconds
    from public.events_lean e
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and not e.is_bot
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

create or replace function public.analytics_acquisition(p_since timestamptz, p_until timestamptz default now(), p_site uuid default null)
returns table(source text, sessions bigint, people bigint, engagement_rate numeric, avg_seconds numeric, avg_pages numeric, conversions bigint)
language sql stable
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
        max(e.src) filter (where e.name = 'acquired'),
        max(e.source) filter (where e.name = 'acquired'),
        max(nullif(e.referrer,'')) filter (where e.name = 'page_view'),
        'direct'
      ) as source
    from public.events_lean e
    left join public.event_taxonomy t on t.event_name = e.name
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and not e.is_bot
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

create or replace function public.analytics_paths(p_since timestamptz, p_until timestamptz default now(), p_site uuid default null, p_limit integer default 20)
returns table(from_page text, to_page text, moves bigint, sessions bigint)
language sql stable
set search_path = ''
as $$
  with steps as (
    select e.session_id, e.path, e.at,
      lead(e.path) over (partition by e.session_id order by e.at) as next_path
    from public.events_lean e
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and not e.is_bot
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

create or replace function public.analytics_funnel(p_since timestamptz, p_until timestamptz default now())
returns table(day date, arrived bigint, heard_something bigint, engaged bigint, searched bigint, asked_for_something bigint, made_an_account bigint, confirmed_the_email bigint, reached_checkout bigint, paid bigint)
language sql stable
set search_path = ''
as $$
  with behaviour as materialized (
    select date_trunc('day', e.at)::date as day,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'view') as arrived,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'content') as heard_something,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'engage') as engaged,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'search') as searched,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'lead') as asked_for_something,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'checkout') as reached_checkout,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'purchase') as paid
    from public.events_lean e
    left join public.event_taxonomy t on t.event_name = e.name
    where e.at >= p_since and e.at < p_until
      and e.device_id is not null
      and coalesce(t.stage, 'engage') <> 'ops'
    group by 1
  ), accounts as materialized (
    select a.day, a.made_an_account, a.confirmed_the_email
    from public.analytics_signups_daily() a
    where a.day >= p_since::date and a.day <= p_until::date
  )
  select coalesce(b.day, a.day),
    coalesce(b.arrived, 0), coalesce(b.heard_something, 0), coalesce(b.engaged, 0),
    coalesce(b.searched, 0), coalesce(b.asked_for_something, 0),
    coalesce(a.made_an_account, 0), coalesce(a.confirmed_the_email, 0),
    coalesce(b.reached_checkout, 0), coalesce(b.paid, 0)
  from behaviour b
  full join accounts a on a.day = b.day
  order by 1 desc;
$$;
