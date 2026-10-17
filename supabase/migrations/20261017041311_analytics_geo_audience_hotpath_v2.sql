-- Keep geographic reads on the existing narrow analytics copy; join raw region metadata only for state selections.
-- Read-only, SECURITY INVOKER, admin gate plus existing events RLS. No raw IDs leave SQL.
-- State groups with fewer than five page views remain suppressed, matching region reads.
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
    left join public.events loc on (p_region_codes is not null or p_region_names is not null) and loc.id=e.id
    where e.at>=p_since and e.at<p_until and e.site_id is not distinct from p_site
      and not coalesce(e.is_bot,false) and upper(e.country)=p_country
      and ((p_region_codes is null and p_region_names is null)
        or upper(loc.edge->>'cf-region-code')=any(p_region_codes)
        or lower(btrim(loc.region))=any(p_region_names))
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
    select coalesce(t.stage,'engage') as stage,count(distinct w.device_id) as visitors
    from w left join public.event_taxonomy t on t.event_name=w.name
    where coalesce(t.stage,'engage')<>'ops' group by coalesce(t.stage,'engage')
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
