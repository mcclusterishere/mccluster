-- PENDING: not applied. Required by the coordinated Visitor evidence Worker update.
-- No historical backfill; do not deploy that Worker before approving these RPCs.
-- Dependency: current events/lean UUID parity, v5 visitor columns and profiles.
-- Partitions behavior by the raw uid on the SAME event, never latest device uid.
-- Anonymous periods remain device buckets; a session can span multiple buckets.
-- Counts are observed profiles/session memberships, not distinct people.
-- Before activation: deploy with analytics_session_evidence_v6 and validate
-- production EXPLAIN with representative bounded windows; then exact approval.
-- Rollback of this dormant proposal: DROP FUNCTION public.analytics_visitor_list_v6
-- (timestamptz,timestamptz,integer,integer,text,text,text). No row changes.
set local lock_timeout = '5s';

create or replace function public.analytics_visitor_list_v6(
  p_since timestamptz,
  p_until timestamptz,
  p_limit integer default 40,
  p_offset integer default 0,
  p_filter text default 'all',
  p_sort text default 'recent',
  p_q text default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_out jsonb;
begin
  -- EXECUTE ... USING plans each call with the real bounds. As a plain SQL
  -- function the window was an unknown parameter, the planner assumed it
  -- covered most of the table, and chose full scans of the wide events.
  execute $q$
with args as (
  select greatest(1, least(coalesce($3, 40), 200)) as lim,
         greatest(0, coalesce($4, 0)) as off,
         coalesce(nullif(btrim($5), ''), 'all') as f,
         coalesce(nullif(btrim($6), ''), 'recent') as srt,
         nullif(left(btrim(coalesce($7, '')), 120), '') as q,
         replace(replace(replace(nullif(left(btrim(coalesce($7, '')), 120), ''), '\', '\\'), '%', '\%'), '_', '\_') as ql
),
sess as (
  select l.session_id, l.device_id, e.uid,
         min(l.at) as started_at, max(l.at) as ended_at,
         count(*) as events,
         count(*) filter (where e.id is null) as identity_missing_events,
         count(*) filter (where l.name = 'page_view') as page_views,
         coalesce(sum(l.visible_s) filter (where l.name = 'page_leave'), 0) as engaged_s,
         count(*) filter (where l.name in ('album_play', 'music_play', 'song_start', 'track_start')) as plays,
         count(*) filter (where l.name in ('rage_click', 'dead_click', 'js_error', 'js_rejection')) as friction,
         bool_or(l.name = 'account_created') as signed_up,
         bool_or(coalesce(l.is_bot, false)) as is_bot,
         (array_agg(nullif(l.src, '') order by l.at) filter (where nullif(l.src, '') is not null))[1] as source,
         (array_agg(l.country order by l.at) filter (where l.country is not null))[1] as country,
         (array_agg(l.path order by l.at) filter (where l.name = 'page_view' and l.path is not null))[1:20] as pages
  from public.events_lean l
  left join public.events e on e.id = l.id and e.site_id is not distinct from l.site_id and e.device_id = l.device_id
  where l.site_id is null and l.session_id is not null and l.device_id is not null
    and l.at >= $1 and l.at < $2
  group by l.session_id, l.device_id, e.uid
),
vis as (
  select coalesce('u:' || s.uid::text, 'd:' || s.device_id) as visitor_key,
         s.uid,
         array_agg(distinct s.device_id) as devices,
         count(distinct s.session_id) as sessions,
         min(s.started_at) as first_seen,
         max(s.ended_at) as last_seen,
         count(distinct (s.started_at at time zone 'UTC')::date) as active_days,
         sum(s.events) as events,
         sum(s.identity_missing_events) as identity_missing_events,
         sum(s.page_views) as page_views,
         round(sum(s.engaged_s))::int as engaged_s,
         sum(s.plays) as plays,
         sum(s.friction) as friction,
         bool_or(s.signed_up) as signed_up,
         bool_and(s.is_bot) as is_bot,
         (array_agg(s.source order by s.started_at) filter (where s.source is not null))[1] as first_source,
         (array_agg(s.country order by s.started_at desc) filter (where s.country is not null))[1] as country,
         (array_agg(s.session_id order by s.started_at desc))[1] as last_session_id,
         (array_agg(s.pages[1] order by s.started_at) filter (where s.pages[1] is not null))[1] as first_page
  from sess s
  group by 1, 2
),
qmatch as materialized (
  select distinct e.device_id, e.uid
  from public.events e, args
  where (select a.q from args a) is not null and e.site_id is null and e.device_id is not null
    and e.name = 'page_view'
    and e.at >= $1 and e.at < $2
    and (host(e.ip) like args.ql || '%'
      or e.city ilike '%' || args.ql || '%'
      or e.region ilike '%' || args.ql || '%'
      or e.asn_org ilike '%' || args.ql || '%'
      or e.postal = args.q)
),
vmatch as materialized (
  select distinct v.visitor_key
  from vis v
  join qmatch qm on qm.device_id = any (v.devices) and qm.uid is not distinct from v.uid
),
searched as (
  select v.*
  from vis v
  left join public.platform_profiles pp on pp.user_id = v.uid
  left join vmatch vm on vm.visitor_key = v.visitor_key, args
  where (select a.q from args a) is null
     or v.visitor_key ilike '%' || args.ql || '%'
     or v.first_source ilike '%' || args.ql || '%'
     or v.country ilike args.ql
     or pp.primary_email ilike '%' || args.ql || '%'
     or pp.mccluster_id ilike '%' || args.ql || '%'
     or pp.display_name ilike '%' || args.ql || '%'
     or exists (select 1 from unnest(v.devices) as d(id) where d.id ilike args.ql || '%')
     or vm.visitor_key is not null
),
filtered as (
  select s.*
  from searched s, args
  where case args.f
    when 'any' then true
    when 'bots' then s.is_bot
    when 'identified' then not s.is_bot and s.uid is not null
    when 'returning' then not s.is_bot and s.sessions > 1
    when 'music' then not s.is_bot and s.plays > 0
    when 'signup' then not s.is_bot and s.signed_up
    when 'friction' then not s.is_bot and s.friction > 0
    when 'engaged' then not s.is_bot and s.engaged_s >= 120
    else not s.is_bot
  end
),
ranked as (
  select f.*,
         row_number() over (order by
           case when args.srt = 'sessions' then f.sessions end desc nulls last,
           case when args.srt = 'engaged' then f.engaged_s end desc nulls last,
           case when args.srt = 'first_seen' then f.first_seen end asc nulls last,
           f.last_seen desc, f.visitor_key) as rn
  from filtered f, args
),
page as (
  select r.* from ranked r, args where r.rn > args.off and r.rn <= args.off + args.lim
),
geo as (
  select pg.visitor_key, x.*
  from page pg
  cross join lateral (
    select host(e.ip) as ip, e.city, e.region, e.country as geo_country, e.timezone,
           e.asn_org, e.user_agent, e.device
    from public.events e
    where e.device_id = any(pg.devices) and e.site_id is null
      and e.uid is not distinct from pg.uid
      and e.at >= $1 and e.at < $2
    order by (e.city is null), (e.device is null), e.at desc
    limit 1
  ) x
)
select jsonb_build_object(
  'measurement_version', 'visitor-event-identity/v6',
  'identity_basis', 'event_bound_account_or_unattributed_device',
  'total', (select count(*) from filtered),
  'counts', (select jsonb_build_object(
      'all', count(*) filter (where not s.is_bot),
      'identified', count(*) filter (where not s.is_bot and s.uid is not null),
      'returning', count(*) filter (where not s.is_bot and s.sessions > 1),
      'music', count(*) filter (where not s.is_bot and s.plays > 0),
      'signup', count(*) filter (where not s.is_bot and s.signed_up),
      'friction', count(*) filter (where not s.is_bot and s.friction > 0),
      'engaged', count(*) filter (where not s.is_bot and s.engaged_s >= 120),
      'bots', count(*) filter (where s.is_bot)
    ) from searched s),
  'visitors', coalesce((select jsonb_agg(jsonb_build_object(
      'visitor_key', p.visitor_key,
      'uid', p.uid,
      'identity_status', case when p.identity_missing_events>0 then 'partial_identity' when p.uid is null then 'device_only' else 'event_bound_account' end,
      'identity_missing_events', p.identity_missing_events,
      'devices', to_jsonb(p.devices),
      'sessions', p.sessions,
      'first_seen', p.first_seen,
      'last_seen', p.last_seen,
      'active_days', p.active_days,
      'events', p.events,
      'page_views', p.page_views,
      'engaged_s', p.engaged_s,
      'plays', p.plays,
      'friction', p.friction,
      'signed_up', p.signed_up,
      'is_bot', p.is_bot,
      'first_source', p.first_source,
      'first_page', p.first_page,
      'last_session_id', p.last_session_id,
      'country', coalesce(g.geo_country, p.country),
      'region', g.region,
      'city', g.city,
      'timezone', g.timezone,
      'ip', g.ip,
      'network', g.asn_org,
      'user_agent', g.user_agent,
      'device', g.device,
      'email', pp.primary_email,
      'display_name', pp.display_name,
      'handle', pp.mccluster_id
    ) order by p.rn)
    from page p
    left join geo g on g.visitor_key = p.visitor_key
    left join public.platform_profiles pp on pp.user_id = p.uid), '[]'::jsonb)
)
  $q$ into v_out using p_since, p_until, p_limit, p_offset, p_filter, p_sort, p_q;
  return v_out;
end;
$function$;

revoke all on function public.analytics_visitor_list_v6(timestamptz,timestamptz,integer,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.analytics_visitor_list_v6(timestamptz,timestamptz,integer,integer,text,text,text) to service_role;
