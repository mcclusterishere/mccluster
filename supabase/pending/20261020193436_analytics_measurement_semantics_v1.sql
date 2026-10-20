-- W04: correct read semantics without rewriting historical events or migrations.
-- Pending review only; existing RLS/grants and owner gates remain in force.
set local lock_timeout = '5s';

create or replace view public.v_events_staged with (security_invoker = true) as
  select e.*, coalesce(t.stage, 'unclassified') as stage,
         (t.event_name is null) as unmapped
    from public.events e
    left join public.event_taxonomy t on t.event_name = e.name;

comment on view public.v_events_staged is
  'Taxonomy on read; unknown names remain unclassified. Browser purchase/register labels are reports, not verified outcomes.';

insert into public.event_taxonomy(event_name,stage,note) values
  ('checkout_view','checkout','Browser-reported checkout intent, not a purchase'),
  ('checkout_go','checkout','Browser-reported checkout navigation intent, not a purchase'),
  ('offer_buy_click','checkout','Browser-reported purchase intent, not a purchase'),
  ('account_created','register','Client-reported completion; verified account totals come from auth.users')
on conflict(event_name) do update set stage=excluded.stage,note=excluded.note;

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
    select (u.created_at at time zone 'UTC')::date as day, count(*) as n
    from auth.users u
    where u.created_at >= p_since and u.created_at < p_until
    group by 1
  ),
  confirmed as (
    select (u.email_confirmed_at at time zone 'UTC')::date as day, count(*) as n
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
    select (e.at at time zone 'UTC')::date as day,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'unclassified') = 'view') as arrived,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'unclassified') = 'content') as heard_something,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'unclassified') = 'engage') as engaged,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'unclassified') = 'search') as searched,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'unclassified') = 'lead') as asked_for_something,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'unclassified') = 'checkout') as reached_checkout,
      count(distinct e.device_id) filter (where coalesce(t.stage, 'unclassified') = 'purchase') as paid
    from public.events_lean e
    left join public.event_taxonomy t on t.event_name = e.name
    where e.at >= p_since and e.at < p_until
      and e.site_id is null
      and not coalesce(e.is_bot, false)
      and e.device_id is not null
      and coalesce(t.stage, 'unclassified') <> 'ops'
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

comment on function public.analytics_funnel(timestamptz,timestamptz) is 'Independent daily stage totals, not an ordered cohort. Behaviour is first-party non-bot distinct devices per UTC day; accounts are auth records. Summed devices are device-days. Legacy paid means browser purchase reports, never verified revenue.';

create or replace function public.analytics_geo_audience(
  p_country text, p_since timestamptz, p_until timestamptz default now(),
  p_site uuid default null, p_region_codes text[] default null,
  p_region_names text[] default null, p_tz text default 'UTC'
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if not coalesce(public.eu_is_admin(), false) then raise exception 'Admin required' using errcode='42501'; end if;
  if p_country !~ '^[A-Z]{2}$' or p_country is null or p_since is null or p_until is null or p_until <= p_since then
    raise exception 'Invalid geographic window' using errcode='22023';
  end if;
  with cutoff as (
    select coalesce(min(at),'infinity'::timestamptz) as first_view from public.events_lean
    where site_id is not distinct from p_site and name='page_view'
  ), w as materialized (
    select e.id,e.at,e.name,e.path,e.device_id,e.session_id,
      coalesce(nullif(e.src,''),nullif(e.source,''),nullif(e.referrer,''),'direct') as source,
      (e.name='page_view' or (e.name='bar_boot' and e.at<c.first_view)) as is_view,
      greatest(0,least(23,floor(24*extract(epoch from(e.at-p_since))/extract(epoch from(p_until-p_since)))::int)) as bucket_no
    from public.events_lean e cross join cutoff c
    where e.at>=p_since and e.at<p_until and e.site_id is not distinct from p_site
      and not coalesce(e.is_bot,false) and upper(e.country)=p_country
      and ((p_region_codes is null and p_region_names is null)
        or e.region_code=any(p_region_codes)
        or lower(e.region)=any(p_region_names))
  ), devices as (
    select device_id,count(distinct session_id) as sessions from w where device_id is not null group by device_id
  ), sessions as (
    select session_id,count(*) filter(where is_view) as views from w where session_id is not null group by session_id
  ), totals as (
    select count(distinct device_id) as visitors,count(distinct session_id) as sessions,
      count(*) filter(where is_view) as page_views,count(*) as events,
      count(*) filter(where name in ('album_play','song_start')) as plays,
      (select count(*) from devices where sessions>1) as returning,
      (select round(100.0*count(*) filter(where views=1)/nullif(count(*),0),1) from sessions) as bounce_rate from w
  ), series as (
    select g as bucket_no,p_since+g*((p_until-p_since)/24.0) as bucket,
      count(distinct w.device_id) as visitors,count(distinct w.session_id) as sessions,
      count(*) filter(where w.is_view) as page_views
    from generate_series(0,23) g left join w on w.bucket_no=g group by g
  ), sources as (
    select source,count(distinct device_id) as people from w group by source order by people desc,source limit 12
  ), steps as (
    select session_id,path,lead(path) over(partition by session_id order by at,id) as next_path
    from w where is_view and session_id is not null and path is not null
  ), paths as (
    select path as from_page,next_path as to_page,count(*) as moves from steps
    where next_path is not null and next_path<>path group by path,next_path order by moves desc,path,next_path limit 40
  ), pages as (
    select path,count(distinct device_id) as visitors,count(*) filter(where is_view) as views,
      count(distinct session_id) as sessions from w where path is not null group by path
    order by visitors desc,path limit 25
  ), stages as (
    select coalesce(t.stage,'unclassified') as stage,count(distinct w.device_id) as visitors
    from w left join public.event_taxonomy t on t.event_name=w.name
    where coalesce(t.stage,'unclassified')<>'ops' group by coalesce(t.stage,'unclassified')
  )
  select jsonb_build_object('schema','analytics-geo-audience/v1','country',p_country,
    'suppressed',(p_region_codes is not null or p_region_names is not null) and totals.page_views<5,
    'totals',to_jsonb(totals),
    'series',(select jsonb_agg(to_jsonb(s)||jsonb_build_object('bucket_label',to_char(s.bucket at time zone p_tz,'YYYY-MM-DD HH24:MI')) order by s.bucket) from series s),
    'sources',coalesce((select jsonb_agg(s) from sources s),'[]'::jsonb),
    'paths',coalesce((select jsonb_agg(s) from paths s),'[]'::jsonb),
    'pages',coalesce((select jsonb_agg(s) from pages s),'[]'::jsonb),
    'stages',coalesce((select jsonb_agg(s) from stages s),'[]'::jsonb)) into result from totals;
  if (result->>'suppressed')::boolean then
    return jsonb_build_object('schema','analytics-geo-audience/v1','country',p_country,'suppressed',true);
  end if;
  return result;
end;
$$;
revoke all on function public.analytics_geo_audience(text,timestamptz,timestamptz,uuid,text[],text[],text) from public,anon;
grant execute on function public.analytics_geo_audience(text,timestamptz,timestamptz,uuid,text[],text[],text) to authenticated;

-- Whole-window distinct stage counts. No summing daily devices and no
-- cross-population percentage presented as a conversion rate.
create or replace function public.analytics_stage_totals(
  p_since timestamptz, p_until timestamptz default now(), p_site uuid default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if not coalesce(public.eu_is_admin(), false) then
    raise exception 'Admin required' using errcode='42501';
  end if;
  if p_since is null or p_until is null or p_until <= p_since then
    raise exception 'Invalid analytics window' using errcode='22023';
  end if;
  with w as materialized (
    select e.device_id, coalesce(t.stage,'unclassified') as stage
    from public.events_lean e
    left join public.event_taxonomy t on t.event_name=e.name
    where e.at>=p_since and e.at<p_until
      and e.site_id is not distinct from p_site and not coalesce(e.is_bot,false)
  ), stages as (
    select stage, count(distinct device_id)::bigint as devices, count(*)::bigint as events
    from w where stage<>'ops' group by stage
  ), accounts as (
    select sum(made_an_account)::bigint as made_an_account,
      sum(confirmed_the_email)::bigint as confirmed_the_email
    from public.analytics_signups_window(p_since,p_until) where p_site is null
  )
  select jsonb_build_object(
    'version','analytics-stage-totals/v1',
    'population','independent_stage_totals',
    'scope',jsonb_build_object('kind',case when p_site is null then 'first_party' else 'tenant_site' end,'site_id',p_site),
    'window',jsonb_build_object('since',p_since,'until',p_until,'bounds','[since,until)','timezone','UTC'),
    'snapshot',jsonb_build_object('kind','database_statement','watermark',null),
    'completeness',jsonb_build_object('status','observed_complete','note','All matching stored lean rows; collection loss and projection lag are unmeasured.'),
    'stages',coalesce((select jsonb_agg(jsonb_build_object(
      'stage',s.stage,'value',s.devices,'numerator',s.devices,'denominator',null,
      'unit','distinct_device_ids','events',s.events,'authority','client_telemetry'
    ) order by s.stage) from stages s),'[]'::jsonb),
    'accounts',case when p_site is null then jsonb_build_object(
      'made_an_account',coalesce(accounts.made_an_account,0),
      'confirmed_the_email',coalesce(accounts.confirmed_the_email,0),
      'unit','accounts','authority','auth.users'
    ) else null end,
    'verified_payments',null,
    'note','Counts describe separate populations, not ordered conversion. Purchase-stage telemetry is client-reported; use canonical commerce for verified payments.'
  ) into result from accounts;
  return result;
end;
$$;
revoke all on function public.analytics_stage_totals(timestamptz,timestamptz,uuid) from public,anon;
grant execute on function public.analytics_stage_totals(timestamptz,timestamptz,uuid) to authenticated,service_role;
comment on function public.analytics_stage_totals(timestamptz,timestamptz,uuid) is
  'Whole-window distinct device IDs by declared event stage, auth account totals separately. No cross-stage conversion rate or verified-payment claim; existing RLS plus admin gate.';

