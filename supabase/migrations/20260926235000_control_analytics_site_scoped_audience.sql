-- Control Analytics: property-scoped audience primitives.
-- The old v_engagement_daily / analytics_funnel pair mixed every visible
-- property whenever the Control property picker selected a client site.
-- These RPCs make site_id part of the query contract so one selected
-- property can never silently inherit another property's audience.

create or replace function public.analytics_engagement_site(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null,
  p_tz text default 'America/New_York')
returns table (
  day date,
  sessions bigint,
  people bigint,
  engaged_sessions bigint,
  engagement_rate numeric,
  avg_seconds numeric,
  avg_pages numeric,
  avg_scroll_pct numeric,
  rage_clicks bigint,
  errors bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with session_rows as (
    select
      e.session_id,
      min(e.at) as started,
      max(e.at) as ended,
      max(e.device_id) as device_id,
      count(distinct e.path) as pages,
      count(*) filter (where e.name = 'conversion') as conversions,
      count(*) filter (where e.name = 'rage_click') as rage_clicks,
      count(*) filter (where e.name in ('js_error','js_rejection')) as errors,
      sum(case when coalesce(e.props->>'visible_s','') ~ '^[0-9]+$'
               then (e.props->>'visible_s')::int else 0 end) as visible_s,
      max(case when coalesce(e.props->>'depth','') ~ '^[0-9]+$'
               then (e.props->>'depth')::int else null end) as max_scroll_pct
    from public.events e
    where e.session_id is not null
      and e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and coalesce(e.is_bot, false) = false
    group by e.session_id
  ), scored as (
    select
      (started at time zone p_tz)::date as day,
      device_id,
      pages,
      conversions,
      rage_clicks,
      errors,
      max_scroll_pct,
      greatest(
        extract(epoch from (ended - started))::int,
        coalesce(visible_s, 0)
      ) as seconds_observed
    from session_rows
  )
  select
    s.day,
    count(*)::bigint as sessions,
    count(distinct s.device_id)::bigint as people,
    count(*) filter (
      where s.conversions > 0 or s.pages >= 2 or s.seconds_observed >= 10
    )::bigint as engaged_sessions,
    round(
      100.0 * count(*) filter (
        where s.conversions > 0 or s.pages >= 2 or s.seconds_observed >= 10
      ) / nullif(count(*), 0),
      1
    ) as engagement_rate,
    round(avg(s.seconds_observed)::numeric, 1) as avg_seconds,
    round(avg(s.pages)::numeric, 2) as avg_pages,
    round(avg(s.max_scroll_pct)::numeric, 1) as avg_scroll_pct,
    sum(s.rage_clicks)::bigint as rage_clicks,
    sum(s.errors)::bigint as errors
  from scored s
  group by s.day
  order by s.day asc;
$$;

revoke all on function public.analytics_engagement_site(timestamptz,timestamptz,uuid,text) from public, anon;
grant execute on function public.analytics_engagement_site(timestamptz,timestamptz,uuid,text) to authenticated;

create or replace function public.analytics_funnel_site(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null,
  p_tz text default 'America/New_York')
returns table (
  day date,
  arrived bigint,
  heard_something bigint,
  engaged bigint,
  searched bigint,
  asked_for_something bigint,
  made_an_account bigint,
  confirmed_the_email bigint,
  reached_checkout bigint,
  paid bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with behaviour as materialized (
    select
      (e.at at time zone p_tz)::date as day,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'view') as arrived,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'content') as heard_something,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'engage') as engaged,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'search') as searched,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'lead') as asked_for_something,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'checkout') as reached_checkout,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'engage') = 'purchase') as paid
    from public.events e
    left join public.event_taxonomy t on t.event_name = e.name
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and e.device_id is not null
      and coalesce(e.is_bot, false) = false
      and coalesce(t.stage, 'engage') <> 'ops'
    group by 1
  ), accounts as materialized (
    select a.day, a.made_an_account, a.confirmed_the_email
    from public.analytics_signups_daily() a
    where p_site is null
      and a.day >= (p_since at time zone p_tz)::date
      and a.day <= ((p_until - interval '1 microsecond') at time zone p_tz)::date
  )
  select
    coalesce(b.day, a.day) as day,
    coalesce(b.arrived, 0)::bigint,
    coalesce(b.heard_something, 0)::bigint,
    coalesce(b.engaged, 0)::bigint,
    coalesce(b.searched, 0)::bigint,
    coalesce(b.asked_for_something, 0)::bigint,
    coalesce(a.made_an_account, 0)::bigint,
    coalesce(a.confirmed_the_email, 0)::bigint,
    coalesce(b.reached_checkout, 0)::bigint,
    coalesce(b.paid, 0)::bigint
  from behaviour b
  full join accounts a on a.day = b.day
  order by 1 asc;
$$;

revoke all on function public.analytics_funnel_site(timestamptz,timestamptz,uuid,text) from public, anon;
grant execute on function public.analytics_funnel_site(timestamptz,timestamptz,uuid,text) to authenticated;
