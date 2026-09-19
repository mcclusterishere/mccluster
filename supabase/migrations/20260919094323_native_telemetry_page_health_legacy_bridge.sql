-- The page view has to answer for the history as well as the future.
--
-- The client running until now reported attention as `dwell` with {s, depth};
-- the new sensor suite reports `page_leave` with the same two fields plus
-- visible time, per-section attention and the vitals. Reading only the new
-- name would have made two months of real traffic invisible on the day the
-- better instrument shipped, which is the wrong trade. Both are read; the
-- columns only the new one can fill stay null until it lands.
--
-- Dropped rather than replaced because a view cannot rename its own columns.

drop view if exists public.v_page_health;

create view public.v_page_health
with (security_invoker = true) as
select
  e.path,
  count(*) as events,
  count(*) filter (where e.name = 'page_view') as page_views,
  count(distinct e.session_id) as sessions,
  count(distinct e.device_id) as devices,
  round(avg((e.props->>'s')::numeric)
        filter (where e.name in ('dwell','page_leave')), 1) as avg_seconds,
  round(avg((e.props->>'depth')::numeric)
        filter (where e.name in ('dwell','page_leave')), 1) as avg_scroll_pct,
  round(avg((e.props->>'visible_s')::numeric)
        filter (where e.name = 'page_leave'), 1) as avg_visible_s,
  count(*) filter (where e.name = 'rage_click') as rage_clicks,
  count(*) filter (where e.name = 'dead_click') as dead_clicks,
  count(*) filter (where e.name = 'exit_intent') as exit_intents,
  count(*) filter (where e.name in ('js_error','js_rejection')) as errors,
  percentile_disc(0.75) within group (
    order by (e.props->'vitals'->>'lcp')::int
  ) filter (where e.props->'vitals' ? 'lcp') as lcp_p75_ms,
  percentile_disc(0.75) within group (
    order by (e.props->'vitals'->>'ttfb')::int
  ) filter (where e.props->'vitals' ? 'ttfb') as ttfb_p75_ms,
  max(e.at) as last_seen
from public.events e
where coalesce(e.is_bot, false) = false
  and e.path <> ''
group by e.path;

comment on view public.v_page_health is
  'Per page: attention, scroll, friction, errors and the speed visitors actually got. Reads both the legacy dwell sensor and the new page_leave one, so the history stays visible.';

grant select on public.v_page_health to authenticated;
