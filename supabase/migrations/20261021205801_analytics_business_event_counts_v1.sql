-- Event totals for owner-only business analytics; one consistent snapshot
-- instead of eighteen separate PostgREST exact count queries. INVOKER +
-- explicit grants: browser roles cannot call this service-to-service RPC.
-- Distinct from the audience RPC: page views here mean name='page_view' only.
create or replace function public.analytics_business_event_counts(
  p_since timestamptz default null,
  p_until timestamptz default null
)
returns table (
  events_total bigint,
  events_window bigint,
  page_views_total bigint,
  page_views_window bigint,
  clicks_total bigint,
  clicks_window bigint,
  acquired_total bigint,
  acquired_window bigint,
  legacy_plays_total bigint,
  legacy_plays_window bigint,
  music_plays_total bigint,
  music_plays_window bigint,
  preview_plays_total bigint,
  preview_plays_window bigint,
  full_plays_total bigint,
  full_plays_window bigint,
  completes_total bigint,
  completes_window bigint
)
language sql stable security invoker
set search_path = ''
as $$
  select
    count(*) filter (where true)::bigint as events_total,
    case when p_since is null or p_until is null then null::bigint else count(*) filter (where true and e.at >= p_since and e.at < p_until)::bigint end as events_window,
    count(*) filter (where e.name = 'page_view')::bigint as page_views_total,
    case when p_since is null or p_until is null then null::bigint else count(*) filter (where e.name = 'page_view' and e.at >= p_since and e.at < p_until)::bigint end as page_views_window,
    count(*) filter (where e.name = 'click')::bigint as clicks_total,
    case when p_since is null or p_until is null then null::bigint else count(*) filter (where e.name = 'click' and e.at >= p_since and e.at < p_until)::bigint end as clicks_window,
    count(*) filter (where e.name = 'acquired')::bigint as acquired_total,
    case when p_since is null or p_until is null then null::bigint else count(*) filter (where e.name = 'acquired' and e.at >= p_since and e.at < p_until)::bigint end as acquired_window,
    count(*) filter (where e.name = 'album_play')::bigint as legacy_plays_total,
    case when p_since is null or p_until is null then null::bigint else count(*) filter (where e.name = 'album_play' and e.at >= p_since and e.at < p_until)::bigint end as legacy_plays_window,
    count(*) filter (where e.name = 'music_play')::bigint as music_plays_total,
    case when p_since is null or p_until is null then null::bigint else count(*) filter (where e.name = 'music_play' and e.at >= p_since and e.at < p_until)::bigint end as music_plays_window,
    count(*) filter (where e.name = 'music_preview_play')::bigint as preview_plays_total,
    case when p_since is null or p_until is null then null::bigint else count(*) filter (where e.name = 'music_preview_play' and e.at >= p_since and e.at < p_until)::bigint end as preview_plays_window,
    count(*) filter (where e.name = 'music_full_play')::bigint as full_plays_total,
    case when p_since is null or p_until is null then null::bigint else count(*) filter (where e.name = 'music_full_play' and e.at >= p_since and e.at < p_until)::bigint end as full_plays_window,
    count(*) filter (where e.name = 'music_complete')::bigint as completes_total,
    case when p_since is null or p_until is null then null::bigint else count(*) filter (where e.name = 'music_complete' and e.at >= p_since and e.at < p_until)::bigint end as completes_window
  from public.events_lean e
  where e.site_id is null and e.is_bot is not true;
$$;

revoke all on function public.analytics_business_event_counts(timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.analytics_business_event_counts(timestamptz,timestamptz)
  to service_role;
