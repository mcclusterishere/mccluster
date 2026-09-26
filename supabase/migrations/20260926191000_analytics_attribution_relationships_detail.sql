-- Deeper analytics without inventing a second data plane.
--
-- Three missing questions become first-class reads:
--   1. which real listening touch preceded an account creation;
--   2. how sources, pages and tracks relate as a journey graph;
--   3. what an individual permitted analytics session actually looked like.
--
-- raw_user_meta_data is NOT authorization. The browser-provided attribution
-- IDs are only join hints; account attribution is accepted only when a real
-- public.events row matches the captured session/device and precedes signup.

set local lock_timeout = '5s';

create or replace function public.analytics_signup_attribution(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_limit int default 500)
returns table (
  account_created_at timestamptz,
  confirmed_at timestamptz,
  source text,
  medium text,
  campaign text,
  landing_path text,
  attribution_mode text,
  track text,
  album text,
  music_event_at timestamptz,
  seconds_before_signup integer)
language sql
stable
security definer
rows 500
set search_path = ''
as $$
  with gate as (
    select public.eu_is_admin() as ok
  ),
  signups as (
    select
      u.id,
      u.created_at,
      u.email_confirmed_at,
      nullif(u.raw_user_meta_data->'analytics_attribution'->>'session_id','') as session_id,
      nullif(u.raw_user_meta_data->'analytics_attribution'->>'device_id','') as device_id,
      nullif(u.raw_user_meta_data->'analytics_attribution'->>'source','') as source,
      nullif(u.raw_user_meta_data->'analytics_attribution'->>'medium','') as medium,
      nullif(u.raw_user_meta_data->'analytics_attribution'->>'campaign','') as campaign,
      nullif(u.raw_user_meta_data->'analytics_attribution'->>'landing_path','') as landing_path
    from auth.users u
    where (select ok from gate)
      and u.created_at >= p_since
      and u.created_at < p_until
  )
  select
    s.created_at,
    s.email_confirmed_at,
    coalesce(s.source, 'direct'),
    coalesce(s.medium, 'none'),
    s.campaign,
    s.landing_path,
    case
      when touch.at is null then 'unattributed'
      when touch.session_id = s.session_id and s.session_id is not null then 'same_session_last_music'
      else 'same_device_24h_last_music'
    end,
    touch.track,
    touch.album,
    touch.at,
    case when touch.at is null then null
         else greatest(0, floor(extract(epoch from (s.created_at-touch.at))))::integer end
  from signups s
  left join lateral (
    select
      e.at,
      e.session_id,
      case
        when lower(coalesce(e.props->>'song','')) = 'whodidtheshoot' then 'who did the shoot'
        else nullif(trim(regexp_replace(
          lower(coalesce(e.props->>'track', e.props->>'song')),
          '[-_]+', ' ', 'g'
        )), '')
      end as track,
      nullif(trim(coalesce(e.props->>'album', e.props->>'album_slug')), '') as album
    from public.events e
    where e.site_id is null
      and coalesce(e.is_bot,false) = false
      and e.at <= s.created_at
      and e.at >= s.created_at - interval '24 hours'
      and e.name in ('album_play','song_start','track_start','music_play','music_full_play','music_preview_play')
      and (
        (s.session_id is not null and e.session_id = s.session_id)
        or
        (s.device_id is not null and e.device_id = s.device_id)
      )
      and nullif(trim(coalesce(e.props->>'track', e.props->>'song')), '') is not null
    order by
      case when s.session_id is not null and e.session_id = s.session_id then 0 else 1 end,
      e.at desc
    limit 1
  ) touch on true
  order by s.created_at desc
  limit greatest(1, least(p_limit, 5000));
$$;

revoke all on function public.analytics_signup_attribution(timestamptz,timestamptz,int) from public, anon;
grant execute on function public.analytics_signup_attribution(timestamptz,timestamptz,int) to authenticated;

comment on function public.analytics_signup_attribution(timestamptz,timestamptz,int) is
  'Desk-only last-touch account attribution. Browser metadata supplies join hints only; a real pre-signup event must match. Same-session music wins, then same-device music within 24h. Not a causal claim.';

create or replace function public.analytics_relationship_edges(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null,
  p_limit int default 40)
returns table (
  from_type text,
  from_key text,
  to_type text,
  to_key text,
  people bigint,
  sessions bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as materialized (
    select e.*
    from public.events e
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and coalesce(e.is_bot,false) = false
      and e.session_id is not null
  ),
  session_entry as (
    select
      e.session_id,
      max(e.device_id) as device_id,
      coalesce(
        max(nullif(e.props->>'src','')) filter (where e.name='acquired'),
        max(split_part(nullif(e.props->>'acq',''),'/',1)) filter (where nullif(e.props->>'acq','') is not null),
        max(nullif(e.referrer,'')) filter (where e.name in ('page_view','view')),
        'direct'
      ) as source,
      (array_agg(nullif(e.path,'') order by e.at)
        filter (where e.name in ('page_view','view') and nullif(e.path,'') is not null))[1] as entry_page
    from scoped e
    group by e.session_id
  ),
  source_page as (
    select
      'source'::text as from_type,
      s.source::text as from_key,
      'page'::text as to_type,
      s.entry_page::text as to_key,
      count(distinct s.device_id)::bigint as people,
      count(*)::bigint as sessions
    from session_entry s
    where s.entry_page is not null
    group by s.source, s.entry_page
  ),
  music as (
    select
      e.session_id,
      e.device_id,
      e.at,
      case
        when lower(coalesce(e.props->>'song','')) = 'whodidtheshoot' then 'who did the shoot'
        else nullif(trim(regexp_replace(
          lower(coalesce(e.props->>'track', e.props->>'song')),
          '[-_]+', ' ', 'g'
        )), '')
      end as track,
      (
        select p.path
        from scoped p
        where p.session_id=e.session_id
          and p.at <= e.at
          and p.name in ('page_view','view')
          and nullif(p.path,'') is not null
        order by p.at desc
        limit 1
      ) as from_page
    from scoped e
    where e.name in ('album_play','song_start','track_start','music_play')
  ),
  page_track as (
    select
      'page'::text as from_type,
      m.from_page::text as from_key,
      'track'::text as to_type,
      m.track::text as to_key,
      count(distinct m.device_id)::bigint as people,
      count(distinct m.session_id)::bigint as sessions
    from music m
    where m.from_page is not null and m.track is not null
    group by m.from_page, m.track
  ),
  combined as (
    select * from source_page
    union all
    select * from page_track
  )
  select c.*
  from combined c
  order by c.sessions desc, c.people desc, c.from_key, c.to_key
  limit greatest(1, least(p_limit, 200));
$$;

revoke all on function public.analytics_relationship_edges(timestamptz,timestamptz,uuid,int) from public, anon;
grant execute on function public.analytics_relationship_edges(timestamptz,timestamptz,uuid,int) to authenticated;

comment on function public.analytics_relationship_edges(timestamptz,timestamptz,uuid,int) is
  'Weighted source-to-entry-page and page-to-track relationships for the selected property. SECURITY INVOKER keeps event RLS authoritative.';

create or replace function public.analytics_session_detail(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null,
  p_limit int default 50)
returns table (
  session_id text,
  started_at timestamptz,
  ended_at timestamptz,
  device_id text,
  ip text,
  country text,
  region text,
  city text,
  postal text,
  latitude double precision,
  longitude double precision,
  timezone text,
  asn integer,
  network text,
  user_agent text,
  entry_page text,
  exit_page text,
  referrer text,
  events bigint,
  pages bigint,
  clicks bigint,
  errors bigint,
  conversions bigint,
  signed_in boolean,
  device jsonb,
  edge jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with scoped as materialized (
    select e.*
    from public.events e
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and coalesce(e.is_bot,false) = false
      and e.session_id is not null
  )
  select
    e.session_id,
    min(e.at),
    max(e.at),
    max(e.device_id),
    (array_agg(e.ip::text order by e.at desc) filter (where e.ip is not null))[1],
    (array_agg(e.country order by e.at desc) filter (where e.country is not null))[1],
    (array_agg(e.region order by e.at desc) filter (where e.region is not null))[1],
    (array_agg(e.city order by e.at desc) filter (where e.city is not null))[1],
    (array_agg(e.postal order by e.at desc) filter (where e.postal is not null))[1],
    (array_agg(e.latitude order by e.at desc) filter (where e.latitude is not null))[1],
    (array_agg(e.longitude order by e.at desc) filter (where e.longitude is not null))[1],
    (array_agg(e.timezone order by e.at desc) filter (where e.timezone is not null))[1],
    (array_agg(e.asn order by e.at desc) filter (where e.asn is not null))[1],
    (array_agg(e.asn_org order by e.at desc) filter (where e.asn_org is not null))[1],
    (array_agg(e.user_agent order by e.at desc) filter (where e.user_agent is not null))[1],
    (array_agg(e.path order by e.at)
      filter (where e.name in ('page_view','view') and nullif(e.path,'') is not null))[1],
    (array_agg(e.path order by e.at desc)
      filter (where e.name in ('page_view','view') and nullif(e.path,'') is not null))[1],
    (array_agg(e.referrer order by e.at)
      filter (where nullif(e.referrer,'') is not null))[1],
    count(*)::bigint,
    count(*) filter (where e.name in ('page_view','view'))::bigint,
    count(*) filter (where e.name in ('click','cta_click'))::bigint,
    count(*) filter (where e.name in ('js_error','js_rejection'))::bigint,
    count(*) filter (where e.name in ('conversion','form_submit','checkout','purchase'))::bigint,
    bool_or(e.uid is not null),
    (array_agg(e.device order by e.at desc) filter (where e.device <> '{}'::jsonb))[1],
    (array_agg(e.edge order by e.at desc) filter (where e.edge <> '{}'::jsonb))[1]
  from scoped e
  group by e.session_id
  order by max(e.at) desc
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.analytics_session_detail(timestamptz,timestamptz,uuid,int) from public, anon;
grant execute on function public.analytics_session_detail(timestamptz,timestamptz,uuid,int) to authenticated;

comment on function public.analytics_session_detail(timestamptz,timestamptz,uuid,int) is
  'Owner/site-owner session inspector over raw analytics fields, including IP-derived location and network data. SECURITY INVOKER preserves events RLS.';
