-- ANALYTICS PAGE PERFORMANCE + SCORING v1
-- Promote actual visible attention, depth, return behavior and action quality
-- into the canonical analytics data plane. Raw views remain reach, not quality.

alter table public.events_lean
  add column if not exists visible_s numeric,
  add column if not exists hidden_s numeric,
  add column if not exists depth numeric,
  add column if not exists exit_intent boolean;

create or replace function private.events_lean_row(e public.events)
returns public.events_lean
language sql immutable
set search_path = ''
as $$
  select row(
    e.id, e.at, e.site_id, e.name, e.path, e.device_id, e.session_id,
    coalesce(e.is_bot, false), e.country, e.referrer,
    coalesce(e.device->'network'->>'effective', e.asn_org),
    nullif(e.props->>'src', ''),
    nullif(e.props->>'source', ''),
    case
      when lower(coalesce(e.props->>'song', '')) = 'whodidtheshoot' then 'who did the shoot'
      else nullif(trim(regexp_replace(lower(coalesce(e.props->>'track', e.props->>'song')), '[-_]+', ' ', 'g')), '')
    end,
    nullif(trim(coalesce(e.props->>'album', e.props->>'album_slug')), ''),
    case when jsonb_typeof(e.props->'listened_seconds') = 'number' then (e.props->>'listened_seconds')::numeric end,
    case when e.name = 'dwell' and jsonb_typeof(e.props->'s') = 'number' then (e.props->>'s')::numeric end,
    case when e.name = 'page_leave' and jsonb_typeof(e.props->'visible_s') = 'number' then (e.props->>'visible_s')::numeric end,
    case when e.name = 'page_leave' and jsonb_typeof(e.props->'hidden_s') = 'number' then (e.props->>'hidden_s')::numeric end,
    case when e.name = 'page_leave' and jsonb_typeof(e.props->'depth') = 'number' then least(100, greatest(0, (e.props->>'depth')::numeric)) end,
    case when e.name = 'page_leave' and jsonb_typeof(e.props->'exit_intent') = 'boolean' then (e.props->>'exit_intent')::boolean end
  )::public.events_lean
$$;

create or replace function private.events_lean_sync()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.events_lean
  select (private.events_lean_row(new)).*
  on conflict (id) do update set
    at = excluded.at, site_id = excluded.site_id, name = excluded.name, path = excluded.path,
    device_id = excluded.device_id, session_id = excluded.session_id, is_bot = excluded.is_bot,
    country = excluded.country, referrer = excluded.referrer, network = excluded.network,
    src = excluded.src, source = excluded.source, track = excluded.track, album = excluded.album,
    listened_seconds = excluded.listened_seconds, dwell_s = excluded.dwell_s,
    visible_s = excluded.visible_s, hidden_s = excluded.hidden_s, depth = excluded.depth,
    exit_intent = excluded.exit_intent;
  return null;
exception when others then
  raise warning 'events_lean_sync skipped %: %', new.id, sqlerrm;
  return null;
end;
$$;

-- Backfill the richer attention projection once from the canonical raw event.
update public.events_lean l
set visible_s = case when jsonb_typeof(e.props->'visible_s')='number' then (e.props->>'visible_s')::numeric end,
    hidden_s = case when jsonb_typeof(e.props->'hidden_s')='number' then (e.props->>'hidden_s')::numeric end,
    depth = case when jsonb_typeof(e.props->'depth')='number' then least(100,greatest(0,(e.props->>'depth')::numeric)) end,
    exit_intent = case when jsonb_typeof(e.props->'exit_intent')='boolean' then (e.props->>'exit_intent')::boolean end
from public.events e
where e.id=l.id and e.name='page_leave'
  and (l.visible_s is null or l.depth is null);

create index if not exists events_lean_page_perf_idx
  on public.events_lean (site_id, path, at desc)
  where path is not null and name in ('page_view','page_leave');

create or replace function public.analytics_page_performance(
  p_since timestamptz,
  p_until timestamptz default now(),
  p_site uuid default null,
  p_limit integer default 25
)
returns table(
  path text,
  views bigint,
  prior_views bigint,
  view_change_pct numeric,
  visitors bigint,
  sessions bigint,
  measured_exits bigint,
  avg_visible_s numeric,
  median_visible_s numeric,
  p75_visible_s numeric,
  avg_depth numeric,
  engaged_30_pct numeric,
  deep_read_pct numeric,
  short_exit_pct numeric,
  return_pct numeric,
  action_events bigint,
  action_rate_pct numeric,
  reach_score numeric,
  attention_score numeric,
  depth_score numeric,
  action_score numeric,
  return_score numeric,
  friction_score numeric,
  confidence numeric,
  quality_score numeric,
  overall_score numeric
)
language sql stable
set search_path = ''
as $$
with bounds as (
  select greatest(interval '1 second', p_until-p_since) as span
),
current_events as materialized (
  select e.*
  from public.events_lean e
  where e.at>=p_since and e.at<p_until
    and e.site_id is not distinct from p_site
    and not e.is_bot and e.path is not null
),
prior as (
  select e.path, count(*) filter(where e.name='page_view')::bigint prior_views
  from public.events_lean e, bounds b
  where e.at>=p_since-b.span and e.at<p_since
    and e.site_id is not distinct from p_site
    and not e.is_bot and e.path is not null
  group by e.path
),
pages as (
  select
    e.path,
    count(*) filter(where e.name='page_view')::bigint views,
    count(distinct e.device_id) filter(where e.name='page_view')::bigint visitors,
    count(distinct e.session_id) filter(where e.name='page_view')::bigint sessions,
    count(*) filter(where e.name='page_leave')::bigint measured_exits,
    round(avg(least(greatest(e.visible_s,0),1800)) filter(where e.name='page_leave' and e.visible_s is not null),1) avg_visible_s,
    round(percentile_cont(.5) within group(order by least(greatest(e.visible_s,0),1800))
      filter(where e.name='page_leave' and e.visible_s is not null)::numeric,1) median_visible_s,
    round(percentile_cont(.75) within group(order by least(greatest(e.visible_s,0),1800))
      filter(where e.name='page_leave' and e.visible_s is not null)::numeric,1) p75_visible_s,
    round(avg(e.depth) filter(where e.name='page_leave' and e.depth is not null),1) avg_depth,
    count(*) filter(where e.name='page_leave' and e.visible_s>=30)::numeric as engaged_30,
    count(*) filter(where e.name='page_leave' and e.visible_s>=20 and e.depth>=50)::numeric as deep_read,
    count(*) filter(where e.name='page_leave' and coalesce(e.visible_s,0)<5)::numeric as short_exit,
    sum(case
      when e.name in ('mission_join','action_mission_handoff') then 5
      when e.name in ('account_created','form_submit','conversion') then 4
      when e.name='cta_click' then 1
      else 0 end)::bigint as action_events,
    count(*) filter(where e.name='dead_click')::numeric as dead_clicks
  from current_events e
  group by e.path
),
base as (
  select p.*, coalesce(pr.prior_views,0)::bigint prior_views,
    case when coalesce(pr.prior_views,0)>0 then round(100.0*(p.views-pr.prior_views)/pr.prior_views,1)
         when p.views>0 then 100.0 else 0 end as view_change_pct,
    case when p.measured_exits>0 then 100.0*p.engaged_30/p.measured_exits else 0 end as engaged_30_pct,
    case when p.measured_exits>0 then 100.0*p.deep_read/p.measured_exits else 0 end as deep_read_pct,
    case when p.measured_exits>0 then 100.0*p.short_exit/p.measured_exits else 0 end as short_exit_pct,
    case when p.sessions>0 then 100.0*greatest(p.sessions-p.visitors,0)/p.sessions else 0 end as return_pct,
    case when p.views>0 then 100.0*p.action_events/p.views else 0 end as action_rate_pct,
    max(p.views) over() as max_views
  from pages p left join prior pr using(path)
  where p.views>0
),
components as (
  select b.*,
    least(100,100*ln(1+b.views)/nullif(ln(1+greatest(b.max_views,1)),0)) as reach_score,
    least(100,
      45*least(coalesce(b.median_visible_s,0)/45.0,1)
      +30*least(b.engaged_30_pct/100.0,1)
      +25*least(coalesce(b.p75_visible_s,0)/90.0,1)) as attention_score,
    least(100, .7*coalesce(b.avg_depth,0)+.3*b.deep_read_pct) as depth_score,
    least(100, b.action_rate_pct*4) as action_score,
    least(100, b.return_pct*2) as return_score,
    greatest(0,100-b.short_exit_pct-least(35,case when b.views>0 then 100.0*b.dead_clicks/b.views else 0 end)) as friction_score,
    (1-exp(-b.views/30.0)) as confidence
  from base b
),
scored as (
  select c.*,
    (.30*c.attention_score+.20*c.depth_score+.25*c.action_score+.15*c.return_score+.10*c.friction_score) as quality_score
  from components c
)
select
  s.path,s.views,s.prior_views,round(s.view_change_pct,1),s.visitors,s.sessions,s.measured_exits,
  s.avg_visible_s,s.median_visible_s,s.p75_visible_s,s.avg_depth,
  round(s.engaged_30_pct,1),round(s.deep_read_pct,1),round(s.short_exit_pct,1),round(s.return_pct,1),
  s.action_events,round(s.action_rate_pct,1),
  round(s.reach_score,1),round(s.attention_score,1),round(s.depth_score,1),round(s.action_score,1),
  round(s.return_score,1),round(s.friction_score,1),round(s.confidence,3),
  round(s.quality_score,1),
  round((s.confidence*(.75*s.quality_score+.25*s.reach_score)+(1-s.confidence)*45),1) overall_score
from scored s
order by overall_score desc, s.views desc, s.path
limit greatest(1,least(p_limit,100));
$$;

revoke all on function public.analytics_page_performance(timestamptz,timestamptz,uuid,integer) from public, anon;
grant execute on function public.analytics_page_performance(timestamptz,timestamptz,uuid,integer) to authenticated, service_role;

comment on function public.analytics_page_performance(timestamptz,timestamptz,uuid,integer) is
  'Confidence-weighted page ranking. Reach is separate from quality; quality combines visible attention, reading depth, action events, return behavior and friction.';
