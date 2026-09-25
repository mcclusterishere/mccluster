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
