-- Analytics - session forensics v4: search by place / IP / network reads one
-- row per page view instead of every event.
--
-- A session's IP, place and network are the same on every one of its events,
-- so the search-only scans now read page_view rows (events_name_idx): on 30
-- days of production data that is ~5k rows instead of ~76k and 0.8 s instead
-- of 9.5 s. Everything else is v3 (EXECUTE ... USING, planned per call).

create or replace function public.analytics_session_list(
  p_since timestamptz,
  p_until timestamptz,
  p_limit integer default 40,
  p_offset integer default 0,
  p_filter text default 'all',
  p_sort text default 'recent',
  p_q text default null,
  p_devices text[] default null,
  p_sessions text[] default null
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
lean as (
  select l.session_id, l.at, l.name, l.path, l.device_id, l.is_bot, l.country, l.referrer,
         nullif(l.src, '') as src, l.track, l.visible_s, l.depth
  from public.events_lean l
  where l.site_id is null
    and l.session_id is not null
    and l.at >= $1 and l.at < $2
    and ($8 is null or l.device_id = any ($8))
    and ($9 is null or l.session_id = any ($9))
),
agg as (
  select
    l.session_id,
    min(l.at) as started_at,
    max(l.at) as ended_at,
    count(*) as events,
    count(*) filter (where l.name = 'page_view') as page_views,
    (array_agg(l.device_id order by l.at) filter (where l.device_id is not null))[1] as device_id,
    (array_agg(l.path order by l.at) filter (where l.name = 'page_view' and l.path is not null))[1:60] as pages,
    (array_agg(l.path order by l.at) filter (where l.path is not null))[1] as entry_path,
    (array_agg(l.path order by l.at desc) filter (where l.path is not null))[1] as exit_path,
    coalesce(sum(l.visible_s) filter (where l.name = 'page_leave'), 0) as engaged_s,
    count(*) filter (where l.name in ('click', 'cta_click')) as clicks,
    count(*) filter (where l.name in ('album_play', 'music_play', 'music_full_play', 'music_preview_play', 'song_start')) as plays,
    count(*) filter (where l.name = 'rage_click') as rage_clicks,
    count(*) filter (where l.name = 'dead_click') as dead_clicks,
    count(*) filter (where l.name in ('js_error', 'js_rejection')) as errors,
    max(l.depth) as max_depth,
    bool_or(l.name = 'account_created') as signed_up,
    bool_or(l.name in ('checkout_view', 'checkout_go', 'offer_buy_click')) as checkout,
    bool_or(l.name in ('form_submit', 'site_request', 'lockroom_sent', 'comment_post', 'mission_join', 'action_act')) as submitted,
    bool_or(coalesce(l.is_bot, false)) as is_bot,
    (array_agg(l.src order by l.at) filter (where l.src is not null))[1] as source,
    (array_agg(l.referrer order by l.at) filter (where nullif(l.referrer, '') is not null))[1] as referrer,
    (array_agg(l.country order by l.at) filter (where l.country is not null))[1] as country,
    (array_agg(distinct l.track) filter (where l.track is not null
      and l.name in ('album_play', 'music_play', 'music_full_play', 'music_preview_play', 'song_start')))[1:12] as tracks
  from lean l
  group by l.session_id
),
ident as (
  select e.session_id, (array_agg(e.uid order by e.at))[1] as uid
  from public.events e
  where e.site_id is null and e.session_id is not null and e.uid is not null
    and e.at >= $1 and e.at < $2
    and ($8 is null or e.device_id = any ($8))
    and ($9 is null or e.session_id = any ($9))
  group by e.session_id
),
dev as (
  select a.device_id, count(*) as device_sessions
  from agg a where a.device_id is not null group by a.device_id
),
rows as (
  select a.*, i.uid, coalesce(d.device_sessions, 1) as device_sessions,
         (a.rage_clicks + a.dead_clicks + a.errors) as friction
  from agg a
  left join ident i on i.session_id = a.session_id
  left join dev d on d.device_id = a.device_id
),
-- Search terms that only the wide table or a profile can answer: IP, place,
-- network, postal code, and the signed-in person's email / handle / name.
qmatch as (
  select distinct e.session_id
  from public.events e, args
  where (select a.q from args a) is not null and e.site_id is null and e.session_id is not null
    and e.name = 'page_view'
    and e.at >= $1 and e.at < $2
    and ($8 is null or e.device_id = any ($8))
    and (host(e.ip) like args.ql || '%'
      or e.city ilike '%' || args.ql || '%'
      or e.region ilike '%' || args.ql || '%'
      or e.asn_org ilike '%' || args.ql || '%'
      or e.postal = args.q)
  union
  select r.session_id
  from rows r
  join public.platform_profiles pp on pp.user_id = r.uid, args
  where (select a.q from args a) is not null
    and (pp.primary_email ilike '%' || args.ql || '%'
      or pp.mccluster_id ilike '%' || args.ql || '%'
      or pp.display_name ilike '%' || args.ql || '%')
),
searched as (
  select r.*
  from rows r, args
  where (select a.q from args a) is null
     or r.session_id ilike args.ql || '%'
     or r.device_id ilike args.ql || '%'
     or r.source ilike '%' || args.ql || '%'
     or r.referrer ilike '%' || args.ql || '%'
     or r.country ilike args.ql
     or exists (select 1 from unnest(r.pages) as pg(p) where pg.p ilike '%' || args.ql || '%')
     or exists (select 1 from unnest(r.tracks) as tk(t) where tk.t ilike '%' || args.ql || '%')
     or r.session_id in (select qm.session_id from qmatch qm)
),
filtered as (
  select s.*
  from searched s, args
  where case args.f
    when 'any' then true
    when 'bots' then s.is_bot
    when 'identified' then not s.is_bot and s.uid is not null
    when 'music' then not s.is_bot and s.plays > 0
    when 'signup' then not s.is_bot and s.signed_up
    when 'converted' then not s.is_bot and (s.signed_up or s.checkout or s.submitted)
    when 'friction' then not s.is_bot and s.friction > 0
    when 'returning' then not s.is_bot and s.device_sessions > 1
    when 'engaged' then not s.is_bot and s.engaged_s >= 60
    else not s.is_bot
  end
),
ranked as (
  select f.*,
         row_number() over (order by
           case when args.srt = 'engaged' then f.engaged_s end desc nulls last,
           case when args.srt = 'events' then f.events end desc nulls last,
           case when args.srt = 'friction' then f.friction end desc nulls last,
           case when args.srt = 'oldest' then f.started_at end asc nulls last,
           f.started_at desc, f.session_id) as rn
  from filtered f, args
),
page as (
  select r.* from ranked r, args where r.rn > args.off and r.rn <= args.off + args.lim
),
-- One index lookup per on-screen session (events_session_idx), then both the
-- place/device row and the visit number come from that single pass. Asking
-- events for name = 'page_view' first made the planner bitmap-scan every
-- page view ever recorded.
pe as (
  select pg.session_id, x.*
  from page pg
  cross join lateral (
    select e.at, e.name, e.props, host(e.ip) as ip, e.city, e.region, e.postal, e.country,
           e.timezone, e.asn, e.asn_org, e.user_agent, e.device, e.latitude, e.longitude
    from public.events e
    where e.session_id = pg.session_id and e.site_id is null
    order by e.at
    limit 800
  ) x
),
geo as (
  select distinct on (pe.session_id)
         pe.session_id, pe.ip, pe.city, pe.region, pe.postal, pe.country as geo_country,
         pe.timezone, pe.asn, pe.asn_org, pe.user_agent, pe.device, pe.latitude, pe.longitude
  from pe
  order by pe.session_id, (pe.city is null), (pe.device is null), pe.at
),
visits as (
  select pe.session_id,
         max(case when (pe.props #>> '{visitor,visits}') ~ '^[0-9]{1,6}$' then (pe.props #>> '{visitor,visits}')::int end) as visit_number,
         max(case when (pe.props #>> '{visitor,days_known}') ~ '^[0-9]{1,6}$' then (pe.props #>> '{visitor,days_known}')::int end) as days_known
  from pe
  where pe.name = 'page_view'
  group by pe.session_id
)
select jsonb_build_object(
  'total', (select count(*) from filtered),
  'counts', (select jsonb_build_object(
      'all', count(*) filter (where not s.is_bot),
      'identified', count(*) filter (where not s.is_bot and s.uid is not null),
      'music', count(*) filter (where not s.is_bot and s.plays > 0),
      'signup', count(*) filter (where not s.is_bot and s.signed_up),
      'converted', count(*) filter (where not s.is_bot and (s.signed_up or s.checkout or s.submitted)),
      'friction', count(*) filter (where not s.is_bot and s.friction > 0),
      'returning', count(*) filter (where not s.is_bot and s.device_sessions > 1),
      'engaged', count(*) filter (where not s.is_bot and s.engaged_s >= 60),
      'bots', count(*) filter (where s.is_bot),
      'visitors', count(distinct s.device_id) filter (where not s.is_bot)
    ) from searched s),
  'unsessioned_events', case when $8 is null and $9 is null then
      (select count(*) from public.events_lean u
        where u.site_id is null and u.session_id is null and u.at >= $1 and u.at < $2) end,
  'sessions', coalesce((select jsonb_agg(jsonb_build_object(
      'session_id', p.session_id,
      'device_id', p.device_id,
      'uid', p.uid,
      'started_at', p.started_at,
      'ended_at', p.ended_at,
      'duration_s', round(extract(epoch from (p.ended_at - p.started_at)))::int,
      'events', p.events,
      'page_views', p.page_views,
      'pages', to_jsonb(coalesce(p.pages, '{}'::text[])),
      'entry_path', p.entry_path,
      'exit_path', p.exit_path,
      'engaged_s', round(p.engaged_s)::int,
      'clicks', p.clicks,
      'plays', p.plays,
      'rage_clicks', p.rage_clicks,
      'dead_clicks', p.dead_clicks,
      'errors', p.errors,
      'friction', p.friction,
      'max_depth', p.max_depth,
      'signed_up', p.signed_up,
      'checkout', p.checkout,
      'submitted', p.submitted,
      'is_bot', p.is_bot,
      'source', p.source,
      'referrer', p.referrer,
      'tracks', to_jsonb(coalesce(p.tracks, '{}'::text[])),
      'device_sessions', p.device_sessions,
      'country', coalesce(g.geo_country, p.country),
      'region', g.region,
      'city', g.city,
      'postal', g.postal,
      'timezone', g.timezone,
      'latitude', g.latitude,
      'longitude', g.longitude,
      'ip', g.ip,
      'asn', g.asn,
      'network', g.asn_org,
      'user_agent', g.user_agent,
      'device', g.device,
      'visit_number', v.visit_number,
      'days_known', v.days_known,
      'email', pp.primary_email,
      'display_name', pp.display_name,
      'handle', pp.mccluster_id
    ) order by p.rn)
    from page p
    left join geo g on g.session_id = p.session_id
    left join visits v on v.session_id = p.session_id
    left join public.platform_profiles pp on pp.user_id = p.uid), '[]'::jsonb)
)
  $q$ into v_out using p_since, p_until, p_limit, p_offset, p_filter, p_sort, p_q, p_devices, p_sessions;
  return v_out;
end;
$function$;

create or replace function public.analytics_visitor_list(
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
  select l.session_id,
         (array_agg(l.device_id order by l.at) filter (where l.device_id is not null))[1] as device_id,
         min(l.at) as started_at, max(l.at) as ended_at,
         count(*) as events,
         count(*) filter (where l.name = 'page_view') as page_views,
         coalesce(sum(l.visible_s) filter (where l.name = 'page_leave'), 0) as engaged_s,
         count(*) filter (where l.name in ('album_play', 'music_play', 'music_full_play', 'music_preview_play', 'song_start')) as plays,
         count(*) filter (where l.name in ('rage_click', 'dead_click', 'js_error', 'js_rejection')) as friction,
         bool_or(l.name = 'account_created') as signed_up,
         bool_or(coalesce(l.is_bot, false)) as is_bot,
         (array_agg(nullif(l.src, '') order by l.at) filter (where nullif(l.src, '') is not null))[1] as source,
         (array_agg(l.country order by l.at) filter (where l.country is not null))[1] as country,
         (array_agg(l.path order by l.at) filter (where l.name = 'page_view' and l.path is not null))[1:20] as pages
  from public.events_lean l
  where l.site_id is null and l.session_id is not null and l.device_id is not null
    and l.at >= $1 and l.at < $2
  group by l.session_id
),
ident as (
  select e.device_id, (array_agg(e.uid order by e.at desc))[1] as uid
  from public.events e
  where e.site_id is null and e.device_id is not null and e.uid is not null
    and e.at >= $1 and e.at < $2
  group by e.device_id
),
vis as (
  select coalesce('u:' || i.uid::text, 'd:' || s.device_id) as visitor_key,
         i.uid,
         array_agg(distinct s.device_id) as devices,
         count(*) as sessions,
         min(s.started_at) as first_seen,
         max(s.ended_at) as last_seen,
         count(distinct (s.started_at at time zone 'UTC')::date) as active_days,
         sum(s.events) as events,
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
  left join ident i on i.device_id = s.device_id
  group by 1, 2
),
qmatch as (
  select distinct e.device_id
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
searched as (
  select v.*
  from vis v
  left join public.platform_profiles pp on pp.user_id = v.uid, args
  where (select a.q from args a) is null
     or v.visitor_key ilike '%' || args.ql || '%'
     or v.first_source ilike '%' || args.ql || '%'
     or v.country ilike args.ql
     or pp.primary_email ilike '%' || args.ql || '%'
     or pp.mccluster_id ilike '%' || args.ql || '%'
     or pp.display_name ilike '%' || args.ql || '%'
     or exists (select 1 from unnest(v.devices) as d(id) where d.id ilike args.ql || '%' or d.id in (select qm.device_id from qmatch qm))
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
  select pg.devices[1] as device_id, x.*
  from page pg
  cross join lateral (
    select host(e.ip) as ip, e.city, e.region, e.country as geo_country, e.timezone,
           e.asn_org, e.user_agent, e.device
    from public.events e
    where e.device_id = pg.devices[1] and e.site_id is null
      and e.at >= $1 and e.at < $2
    order by (e.city is null), (e.device is null), e.at desc
    limit 1
  ) x
)
select jsonb_build_object(
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
    left join geo g on g.device_id = p.devices[1]
    left join public.platform_profiles pp on pp.user_id = p.uid), '[]'::jsonb)
)
  $q$ into v_out using p_since, p_until, p_limit, p_offset, p_filter, p_sort, p_q;
  return v_out;
end;
$function$;

revoke all on function public.analytics_session_list(timestamptz, timestamptz, integer, integer, text, text, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.analytics_session_list(timestamptz, timestamptz, integer, integer, text, text, text, text[], text[]) to service_role;
revoke all on function public.analytics_visitor_list(timestamptz, timestamptz, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.analytics_visitor_list(timestamptz, timestamptz, integer, integer, text, text, text) to service_role;

comment on function public.analytics_session_list(timestamptz, timestamptz, integer, integer, text, text, text, text[], text[]) is
  'Control Forensics: one row per first-party session (journey shape, engagement, friction, place, device, signed-in person). Service role only; the Worker gates on the house owner.';
comment on function public.analytics_visitor_list(timestamptz, timestamptz, integer, integer, text, text, text) is
  'Control Forensics: one row per visitor (signed-in user, else device) with session count, first/last seen and activity. Service role only; the Worker gates on the house owner.';
