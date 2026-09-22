-- THE FIVE THINGS EVERY SERIOUS ANALYTICS PLATFORM HAS.
--
-- Amplitude, Mixpanel and PostHog differ in polish and price and agree
-- completely on the primitives: TRENDS, FUNNELS, RETENTION, PATHS,
-- STICKINESS. Funnels and retention landed earlier today. This adds the
-- rest, plus the two GA4 ideas worth taking -- the engaged-session
-- definition, and judging an acquisition source by the QUALITY of who it
-- brings rather than the count.
--
-- And one thing none of them have, because it only matters here: on this
-- platform THE SITE IS THE MEDIA. A track is not a step toward a
-- conversion, it is the product. So content performance is a first-class
-- view rather than something reconstructed from event names later.
--
-- v_stickiness is defined in its corrected form below. The first cut
-- computed days_observed from an unfiltered min(at), which reached back
-- to 2026-07-17 -- where 26,147 events exist with NO device_id, from
-- before device identity shipped. It reported 68 days of history for a
-- metric with 3 days of input, which is worse than no window at all: it
-- asserts the number is trustworthy exactly when it is not.

create or replace view public.v_engagement_daily
with (security_invoker = true) as
  select date_trunc('day', s.started)::date as day,
         count(*) as sessions,
         count(distinct s.device_id) as people,
         count(*) filter (
           where s.conversions > 0 or s.pages >= 2 or coalesce(s.visible_s, s.span_s) >= 10
         ) as engaged_sessions,
         round(100.0 * count(*) filter (
           where s.conversions > 0 or s.pages >= 2 or coalesce(s.visible_s, s.span_s) >= 10
         ) / nullif(count(*), 0), 1) as engagement_rate,
         round(avg(coalesce(s.visible_s, s.span_s))::numeric, 1) as avg_seconds,
         round(avg(s.pages)::numeric, 2) as avg_pages,
         round(avg(s.max_scroll_pct)::numeric, 1) as avg_scroll_pct,
         sum(s.rage_clicks) as rage_clicks,
         sum(s.errors) as errors
    from public.v_sessions s
   where s.is_bot is not true
   group by 1
   order by 1 desc;

comment on view public.v_engagement_daily is
  'GA4 engaged-session rule: a key event, 2+ pages, or 10+ seconds. Separates traffic from audience.';

create or replace view public.v_stickiness
with (security_invoker = true) as
  with d as (select distinct date_trunc('day', at)::date as day, device_id
               from public.events where device_id is not null and is_bot is not true),
       span as (select min(day) as first_day from d)
  select g.day,
         count(distinct case when d.day = g.day then d.device_id end) as dau,
         count(distinct case when d.day >  g.day - 7  then d.device_id end) as wau,
         count(distinct case when d.day >  g.day - 30 then d.device_id end) as mau,
         round(100.0 * count(distinct case when d.day = g.day then d.device_id end)
               / nullif(count(distinct case when d.day > g.day - 30 then d.device_id end), 0), 1) as dau_over_mau,
         (g.day - (select first_day from span)) + 1 as days_observed,
         ((g.day - (select first_day from span)) + 1) >= 30 as window_is_full
    from (select distinct date_trunc('day', at)::date as day
            from public.events where device_id is not null and is_bot is not true) g
    join d on d.day <= g.day and d.day > g.day - 30
   group by g.day
   order by g.day desc;

comment on view public.v_stickiness is
  'DAU/WAU/MAU over device-identified traffic only. days_observed and window_is_full exist because below 30 days MAU is not monthly and dau_over_mau must not be read as churn.';

-- Pairs, not journeys: a full path explodes combinatorially and answers
-- less than the single question "from here, where next?".
create or replace view public.v_paths
with (security_invoker = true) as
  with steps as (
    select session_id, path, at,
           lead(path) over (partition by session_id order by at) as next_path
      from public.events
     where name in ('page_view','view') and path is not null and is_bot is not true
  )
  select path as from_page, next_path as to_page, count(*) as moves,
         count(distinct session_id) as sessions
    from steps
   where next_path is not null and next_path <> path
   group by 1, 2
  having count(*) >= 3          -- below this it is noise, not a path
   order by count(*) desc;

comment on view public.v_paths is
  'From here, where next? Pairs not journeys: full paths explode combinatorially and answer less.';

create or replace view public.v_content_performance
with (security_invoker = true) as
  with plays as (
    select lower(trim(props->>'track')) as track,
           device_id, session_id, at
      from public.events
     where name in ('album_play','song_start') and props->>'track' is not null
       and is_bot is not true
  )
  select track,
         count(*) as plays,
         count(distinct device_id) as listeners,
         count(distinct session_id) as sessions,
         round(count(*)::numeric / nullif(count(distinct device_id), 0), 2) as plays_per_listener,
         count(distinct device_id) filter (where device_id in (
           select device_id from plays p2 where p2.track = plays.track
            group by device_id having count(*) > 1)) as repeat_listeners,
         min(at)::date as first_heard,
         max(at)::date as last_heard
    from plays
   group by track
   order by count(distinct device_id) desc;

comment on view public.v_content_performance is
  'The site is the media, so tracks are measured as product: reach, repeat listeners, plays per listener.';

create or replace view public.v_acquisition_quality
with (security_invoker = true) as
  select coalesce(nullif(s.referrer, ''), 'direct') as source,
         count(*) as sessions,
         count(distinct s.device_id) as people,
         round(100.0 * count(*) filter (
           where s.conversions > 0 or s.pages >= 2 or coalesce(s.visible_s, s.span_s) >= 10
         ) / nullif(count(*), 0), 1) as engagement_rate,
         round(avg(coalesce(s.visible_s, s.span_s))::numeric, 1) as avg_seconds,
         round(avg(s.pages)::numeric, 2) as avg_pages,
         sum(s.conversions) as conversions
    from public.v_sessions s
   where s.is_bot is not true
   group by 1
  having count(*) >= 2
   order by count(*) desc;

comment on view public.v_acquisition_quality is
  'Where they came from AND whether they were any good. A thousand bouncers beat forty who stay on no metric that matters.';
