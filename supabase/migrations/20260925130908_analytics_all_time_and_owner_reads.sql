set local lock_timeout = '5s';

alter policy "only the desk reads it" on public.events
  using ((select public.eu_is_admin()));

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
