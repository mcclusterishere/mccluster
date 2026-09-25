-- Analytics: every day the site has recorded, and reads the owner can
-- actually complete.
--
-- WHY HISTORY STOPPED AT 19 SEP. public.events runs back to 17 Jul 2026,
-- but the pixel only began writing device_id, session_id and page_view on
-- 19 Sep 2026 09:58 UTC. Every view that counts people, sessions or
-- page_view therefore started that day and the 26k events before it were
-- invisible. The old pixel's own names carry the same facts: `bar_boot`
-- fires on every page load (it tracks page_view within 1-3% on every day
-- both exist), `acquired` fires once per visit with its source, and
-- album_play / song_start are plays. The functions below count page views
-- as page_view, plus bar_boot BEFORE the first page_view, so the series is
-- continuous with no double counting.
--
-- What cannot come back: unique people. Nothing before 19 Sep recorded a
-- visitor id, so `visitors` and `sessions` are zero before then and the
-- page says so rather than implying there was no traffic.
--
-- WHY PANELS TIMED OUT. The desk policy on events was `using
-- (eu_is_admin())`, evaluated once per row. Measured as the owner under
-- the 8s authenticated statement_timeout: v_stickiness 18.3s, v_page_health
-- 13.8s. As `(select eu_is_admin())` it is an InitPlan evaluated once per
-- query; same predicate, same answer for every caller. Tested in a
-- rolled-back transaction on production: 1.6s and 0.13s.
--
-- WHY THE FUNNEL WAS REFUSED. v_funnel_daily is security_invoker and read
-- auth.users, which `authenticated` cannot select. The two sign-up counts
-- move behind a SECURITY DEFINER function that returns per-day counts only
-- and returns nothing unless the caller is the desk.
--
-- The three read functions are SECURITY INVOKER: they see exactly the rows
-- public.events' RLS gives the caller (the desk for first-party rows, a
-- site's owner for that site's rows) and aggregate them in the database, so
-- the browser never downloads raw rows and no API row cap can shorten a
-- chart.

-- 1. Speed ---------------------------------------------------------------
alter policy "only the desk reads it" on public.events
  using ((select public.eu_is_admin()));

-- 2. Funnel --------------------------------------------------------------
create or replace function public.analytics_signups_daily()
returns table (day date, made_an_account bigint, confirmed_the_email bigint)
language sql
stable
security definer
rows 120
set search_path = ''
as $$
  with gate as (select public.eu_is_admin() as ok),
  signups as (
    select date_trunc('day', u.created_at)::date as day, count(*) as n
    from auth.users u
    group by 1
  ),
  confirmed as (
    select date_trunc('day', u.email_confirmed_at)::date as day, count(*) as n
    from auth.users u
    where u.email_confirmed_at is not null
    group by 1
  )
  select coalesce(s.day, c.day),
         coalesce(s.n, 0)::bigint,
         coalesce(c.n, 0)::bigint
  from signups s
  full join confirmed c on c.day = s.day
  where (select ok from gate);
$$;

revoke all on function public.analytics_signups_daily() from public, anon;
grant execute on function public.analytics_signups_daily() to authenticated;

-- MATERIALIZED: each computed once. Inlined, the planner re-ran the
-- behaviour aggregate inside the full joins and the owner's read took 9.4s
-- for under a second of work.
create or replace view public.v_funnel_daily
with (security_invoker = true) as
with behaviour as materialized (
  select date_trunc('day', s_1.at)::date as day,
    count(distinct s_1.device_id) filter (where s_1.stage = 'view') as arrived,
    count(distinct s_1.device_id) filter (where s_1.stage = 'content') as heard_something,
    count(distinct s_1.device_id) filter (where s_1.stage = 'engage') as engaged,
    count(distinct s_1.device_id) filter (where s_1.stage = 'search') as searched,
    count(distinct s_1.device_id) filter (where s_1.stage = 'lead') as asked_for_something,
    count(distinct s_1.device_id) filter (where s_1.stage = 'checkout') as reached_checkout,
    count(distinct s_1.device_id) filter (where s_1.stage = 'purchase') as paid
  from public.v_events_staged s_1
  where s_1.device_id is not null and s_1.stage <> 'ops'
  group by (date_trunc('day', s_1.at)::date)
), accounts as materialized (
  select a.day, a.made_an_account, a.confirmed_the_email
  from public.analytics_signups_daily() a
), signups as (
  select day, made_an_account from accounts where made_an_account > 0
), confirmed as (
  select day, confirmed_the_email from accounts where confirmed_the_email > 0
)
select coalesce(b.day, s.day, c.day) as day,
  coalesce(b.arrived, 0::bigint) as arrived,
  coalesce(b.heard_something, 0::bigint) as heard_something,
  coalesce(b.engaged, 0::bigint) as engaged,
  coalesce(b.searched, 0::bigint) as searched,
  coalesce(b.asked_for_something, 0::bigint) as asked_for_something,
  coalesce(s.made_an_account, 0::bigint) as made_an_account,
  coalesce(c.confirmed_the_email, 0::bigint) as confirmed_the_email,
  coalesce(b.reached_checkout, 0::bigint) as reached_checkout,
  coalesce(b.paid, 0::bigint) as paid
from behaviour b
  full join signups s on s.day = b.day
  full join confirmed c on c.day = coalesce(b.day, s.day)
order by (coalesce(b.day, s.day, c.day)) desc;

-- 3. All-time reads --------------------------------------------------------
-- Each function reads public.events directly: this property's human
-- events in the window (p_site null = first-party, site_id is null; the
-- old pixel wrote no is_bot, so null counts as human). A page view is a
-- page_view, or a bar_boot from before this property's first page_view.
-- The cut-over is a scalar subquery, evaluated once per call.
--
-- Deliberately NOT built on a shared set-returning helper: routing the
-- rows through one (returning every column, jsonb included) took the
-- all-time daily read from 0.18s to 5.0s in a rolled-back test.

create or replace function public.analytics_daily(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null,
  p_tz text default 'UTC')
returns table (day date, page_views bigint, visits bigint, visitors bigint,
               sessions bigint, plays bigint, events bigint, avg_dwell_s numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select (e.at at time zone p_tz)::date,
    count(*) filter (where e.name = 'page_view' or (e.name = 'bar_boot' and e.at < (
      select coalesce(min(p.at), 'infinity'::timestamptz) from public.events p
      where p.name = 'page_view' and p.site_id is not distinct from p_site))),
    count(*) filter (where e.name = 'acquired'),
    count(distinct e.device_id),
    count(distinct e.session_id),
    count(*) filter (where e.name in ('album_play', 'song_start')),
    count(*),
    round(avg(case when e.name = 'dwell' and jsonb_typeof(e.props->'s') = 'number'
                   then (e.props->>'s')::numeric end), 1)
  from public.events e
  where e.at >= p_since and e.at < p_until
    and e.site_id is not distinct from p_site
    and coalesce(e.is_bot, false) = false
  group by 1
  order by 1;
$$;

create or replace function public.analytics_totals(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null)
returns table (page_views bigint, visits bigint, visitors bigint,
               sessions bigint, plays bigint, events bigint,
               first_event timestamptz, identity_since timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where e.name = 'page_view' or (e.name = 'bar_boot' and e.at < (
      select coalesce(min(p.at), 'infinity'::timestamptz) from public.events p
      where p.name = 'page_view' and p.site_id is not distinct from p_site))),
    count(*) filter (where e.name = 'acquired'),
    count(distinct e.device_id),
    count(distinct e.session_id),
    count(*) filter (where e.name in ('album_play', 'song_start')),
    count(*),
    min(e.at),
    min(e.at) filter (where e.device_id is not null)
  from public.events e
  where e.at >= p_since and e.at < p_until
    and e.site_id is not distinct from p_site
    and coalesce(e.is_bot, false) = false;
$$;

-- Ranked lists for the window. p_dim is one of page, source, country,
-- network; anything else returns nothing.
create or replace function public.analytics_top(
  p_dim text,
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null,
  p_limit int default 12)
returns table (key text, n bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.key, count(*)::bigint
  from (
    select case p_dim
             when 'page' then nullif(e.path, '')
             when 'source' then coalesce(nullif(e.props->>'src', ''), 'direct')
             when 'country' then e.country
             when 'network' then coalesce(e.device->'network'->>'effective', e.asn_org)
           end as key
    from public.events e
    where e.at >= p_since and e.at < p_until
      and e.site_id is not distinct from p_site
      and coalesce(e.is_bot, false) = false
      and case p_dim
            when 'source' then e.name = 'acquired'
            else e.name = 'page_view' or (e.name = 'bar_boot' and e.at < (
              select coalesce(min(p.at), 'infinity'::timestamptz) from public.events p
              where p.name = 'page_view' and p.site_id is not distinct from p_site))
          end
  ) r
  where r.key is not null
  group by r.key
  order by 2 desc, 1
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.analytics_daily(timestamptz, timestamptz, uuid, text) from public, anon;
revoke all on function public.analytics_totals(timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.analytics_top(text, timestamptz, timestamptz, uuid, int) from public, anon;
grant execute on function public.analytics_daily(timestamptz, timestamptz, uuid, text) to authenticated;
grant execute on function public.analytics_totals(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.analytics_top(text, timestamptz, timestamptz, uuid, int) to authenticated;
