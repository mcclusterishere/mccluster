-- The funnel, filtered by date BEFORE it counts.
--
-- v_funnel_daily cannot take a date, so every read counted seven distinct
-- sets per day across all of history and dropped everything outside the
-- window afterwards. As the owner on production that ran past the 8s
-- authenticated statement_timeout even after the policy fix. This takes
-- the window as parameters and filters first: 0.26s warm for 90 days in a
-- rolled-back test, with the same numbers the view gives for the same days.
--
-- SECURITY INVOKER: it sees exactly the events RLS gives the caller. The
-- sign-up counts come from analytics_signups_daily(), which returns nothing
-- to anyone but the desk. The view stays for anything that still reads it.

create or replace function public.analytics_funnel(
  p_since timestamptz,
  p_until timestamptz default now())
returns table (day date, arrived bigint, heard_something bigint, engaged bigint,
               searched bigint, asked_for_something bigint, made_an_account bigint,
               confirmed_the_email bigint, reached_checkout bigint, paid bigint)
language sql
stable
security invoker
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
    from public.events e
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

revoke all on function public.analytics_funnel(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_funnel(timestamptz, timestamptz) to authenticated;
