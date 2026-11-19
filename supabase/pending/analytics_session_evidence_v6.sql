-- PENDING; not applied. Requires #640's pending analytics_visitor_list_v6.
-- Reuses the v5 session aggregation, with raw identity joined on each lean event ID.
-- Account scope never inherits device history; device scope includes only unattributed
-- events. Shared sessions expose identity buckets, never a guessed account owner.
-- Geo/search/detail use the same bounded scope. Missing identity joins are explicit.
-- Full starts use #640's browser-start/v3 vocabulary; preview starts are separate.
-- Service-role invoker only. No data writes, permissions expansion or backfill.
-- Apply only after review of isolated fixtures and production query plans, then deploy
-- compatible Worker/UI together. Missing RPCs must fail visibly, never fall back to v5.
-- Rollback: restore compatible prior application, then drop this new function.
set local lock_timeout = '5s';

create or replace function public.analytics_session_evidence_v6(
  p_since timestamptz,
  p_until timestamptz,
  p_limit integer default 40,
  p_offset integer default 0,
  p_filter text default 'all',
  p_sort text default 'recent',
  p_q text default null,
  p_devices text[] default null,
  p_sessions text[] default null,
  p_visitor_key text default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_out jsonb;
begin
  if p_since is null or p_until is null or p_since >= p_until then
    raise exception 'Invalid analytics range' using errcode = '22023';
  end if;
  if p_visitor_key is not null and p_visitor_key !~ '^(u:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|d:[A-Za-z0-9._:-]{4,128})$' then
    raise exception 'Invalid visitor key' using errcode = '22023';
  end if;
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
  select l.id, e.uid, (e.id is null) as identity_missing, l.session_id, l.at, l.name, l.path, l.device_id, l.is_bot, l.country, l.referrer,
         nullif(l.src, '') as src, l.track, l.visible_s, l.depth
  from public.events_lean l
  left join public.events e on e.id=l.id and e.site_id is not distinct from l.site_id and e.device_id is not distinct from l.device_id
  where l.site_id is null
    and l.session_id is not null
    and l.at >= $1 and l.at < $2
    and ($8 is null or l.device_id = any ($8))
    and ($9 is null or l.session_id = any ($9))
    and ($10 is null or l.device_id is not null)
    and ($10 is null or
      (left($10,2)='u:' and e.uid::text=lower(substr($10,3))) or
      (left($10,2)='d:' and l.device_id=substr($10,3) and e.uid is null))
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
    count(*) filter (where l.name in ('album_play', 'music_play', 'song_start', 'track_start')) as plays,
    count(*) filter (where l.name='music_preview_play') as preview_starts,
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
      and l.name in ('album_play', 'music_play', 'song_start', 'track_start')))[1:12] as tracks
  from lean l
  group by l.session_id
),
buckets as (
  select l.session_id, coalesce('u:'||l.uid::text, 'd:'||l.device_id) as visitor_key,
         count(*) as events, count(*) filter (where l.identity_missing) as identity_missing_events
  from lean l group by l.session_id, 2
),
ident as (
  select l.session_id,
         case when count(distinct l.uid)=1 and count(l.uid)=count(*) then min(l.uid::text)::uuid end as uid,
         count(distinct l.uid) as account_count,
         count(*) filter (where l.uid is null) as unattributed_events,
         count(*) filter (where l.identity_missing) as identity_missing_events,
         (select jsonb_agg(jsonb_build_object('key',b.visitor_key,'events',b.events,
           'identity_missing_events',b.identity_missing_events) order by b.visitor_key)
          from buckets b where b.session_id=l.session_id) as identity_buckets
  from lean l group by l.session_id
),
dev as (
  select a.device_id, count(*) as device_sessions
  from agg a where a.device_id is not null group by a.device_id
),
rows as (
  select a.*, i.uid, i.account_count, i.unattributed_events, i.identity_missing_events, i.identity_buckets, coalesce(d.device_sessions, 1) as device_sessions,
         (a.rage_clicks + a.dead_clicks + a.errors) as friction
  from agg a
  left join ident i on i.session_id = a.session_id
  left join dev d on d.device_id = a.device_id
),
-- Search terms that only the wide table or a profile can answer: IP, place,
-- network, postal code, and the signed-in person's email / handle / name.
qmatch as materialized (
  select distinct e.session_id
  from public.events e join lean l on l.id=e.id, args
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
  join lean l on l.session_id=r.session_id
  join public.platform_profiles pp on pp.user_id=l.uid, args
  where (select a.q from args a) is not null
    and (pp.primary_email ilike '%' || args.ql || '%'
      or pp.mccluster_id ilike '%' || args.ql || '%'
      or pp.display_name ilike '%' || args.ql || '%')
),
searched as (
  select r.*
  from rows r
  left join qmatch qm on qm.session_id = r.session_id, args
  where (select a.q from args a) is null
     or r.session_id ilike args.ql || '%'
     or r.device_id ilike args.ql || '%'
     or r.source ilike '%' || args.ql || '%'
     or r.referrer ilike '%' || args.ql || '%'
     or r.country ilike args.ql
     or exists (select 1 from unnest(r.pages) as pg(p) where pg.p ilike '%' || args.ql || '%')
     or exists (select 1 from unnest(r.tracks) as tk(t) where tk.t ilike '%' || args.ql || '%')
     or qm.session_id is not null
),
filtered as (
  select s.*
  from searched s, args
  where case args.f
    when 'any' then true
    when 'bots' then s.is_bot
    when 'identified' then not s.is_bot and s.account_count > 0
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
    from public.events e join lean l on l.id=e.id
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
  'measurement_version', 'session-event-identity/v6',
  'identity_basis', 'event_bound_account_or_unattributed_device',
  'visitor_key', $10,
  'devices', (select to_jsonb(array_agg(distinct l.device_id) filter (where l.device_id is not null)) from lean l),
  'identity_missing_events', (select count(*) from lean where identity_missing),
  'total', (select count(*) from filtered),
  'counts', (select jsonb_build_object(
      'all', count(*) filter (where not s.is_bot),
      'identified', count(*) filter (where not s.is_bot and s.account_count > 0),
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
      'visitor_key', $10,
      'identity_status', case when p.identity_missing_events>0 then 'partial_identity'
        when jsonb_array_length(p.identity_buckets)>1 then 'mixed'
        when p.uid is not null then 'event_bound_account' else 'device_only' end,
      'identity_buckets', p.identity_buckets,
      'identity_missing_events', p.identity_missing_events,
      'account_count', p.account_count,
      'unattributed_events', p.unattributed_events
    ) || jsonb_build_object(
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
      'play_metric_version', 'browser-start/v3',
      'preview_starts', p.preview_starts,
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
  $q$ into v_out using p_since, p_until, p_limit, p_offset, p_filter, p_sort, p_q, p_devices, p_sessions, p_visitor_key;
  return v_out;
end;
$function$;

revoke all on function public.analytics_session_evidence_v6(timestamptz,timestamptz,integer,integer,text,text,text,text[],text[],text) from public,anon,authenticated;
grant execute on function public.analytics_session_evidence_v6(timestamptz,timestamptz,integer,integer,text,text,text,text[],text[],text) to service_role;
