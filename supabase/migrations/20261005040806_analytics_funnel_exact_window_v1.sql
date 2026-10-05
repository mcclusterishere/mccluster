-- Reconcile the production fix for issue #264.
-- Account and confirmation stages must use the same exact [p_since, p_until)
-- semantics as behavioral analytics. Keep auth.users behind a narrow admin-gated
-- aggregate helper; analytics_funnel itself remains SECURITY INVOKER.

create or replace function public.analytics_signups_window(
  p_since timestamptz,
  p_until timestamptz default now())
returns table(day date, made_an_account bigint, confirmed_the_email bigint)
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
    where u.created_at >= p_since and u.created_at < p_until
    group by 1
  ),
  confirmed as (
    select date_trunc('day', u.email_confirmed_at)::date as day, count(*) as n
    from auth.users u
    where u.email_confirmed_at is not null
      and u.email_confirmed_at >= p_since and u.email_confirmed_at < p_until
    group by 1
  )
  select coalesce(s.day, c.day),
         coalesce(s.n, 0)::bigint,
         coalesce(c.n, 0)::bigint
  from signups s
  full join confirmed c on c.day = s.day
  where (select ok from gate);
$$;

revoke all on function public.analytics_signups_window(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.analytics_signups_window(timestamptz, timestamptz)
  to authenticated, service_role;

comment on function public.analytics_signups_window(timestamptz, timestamptz) is
  'Admin-gated per-day account and confirmation counts with exact p_since <= ts < p_until bounds. Returns counts only, never auth.users rows. Feeds analytics_funnel (issue #264).';

create or replace function public.analytics_funnel(
  p_since timestamptz,
  p_until timestamptz default now())
returns table(day date, arrived bigint, heard_something bigint, engaged bigint,
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
    from public.events_lean e
    left join public.event_taxonomy t on t.event_name = e.name
    where e.at >= p_since and e.at < p_until
      and e.device_id is not null
      and coalesce(t.stage, 'engage') <> 'ops'
    group by 1
  ), accounts as materialized (
    -- Same exact window as the behaviour stages: p_since <= ts < p_until.
    select a.day, a.made_an_account, a.confirmed_the_email
    from public.analytics_signups_window(p_since, p_until) a
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

revoke all on function public.analytics_funnel(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.analytics_funnel(timestamptz, timestamptz)
  to authenticated, service_role;
