-- THE EVENT TAXONOMY.
--
-- The site fires 85 distinct event names -- shake_shuffle, pocket_advance,
-- vr_gyro_on, listen_chip. Every one describes a MECHANISM. None describes
-- a STAGE. You cannot build a funnel out of them, which is why there has
-- never been a number for how many people who heard a track went on to
-- make an account.
--
-- This is the one thing Meta genuinely does better, and it is not the
-- pixel: every event they collect maps to a small standard vocabulary, so
-- any business using them gets funnels and cohorts for free.
--
-- So keep firing the specific names -- they carry detail nothing else does
-- -- and CLASSIFY them into stages on read. Mapping rather than renaming
-- means no front-end change, no lost history, and a mistake here is one
-- update statement rather than a redeploy. (It took two. See v2.)

create table if not exists public.event_taxonomy (
  event_name text primary key,
  stage      text not null,
  note       text not null default '',
  constraint event_taxonomy_stage_ck check (stage in
    ('view','content','search','engage','lead','register','checkout','purchase','subscribe','support'))
);

comment on table public.event_taxonomy is
  'Maps the site''s specific event names onto a standard funnel vocabulary. Events stay specific; analysis gets a stage.';

-- (seed rows applied in production; superseded and corrected by
--  20260922092006_event_taxonomy_correction_v2.sql)

create or replace view public.v_events_staged
with (security_invoker = true) as
  select e.*, coalesce(t.stage, 'engage') as stage,
         (t.event_name is null) as unmapped
    from public.events e
    left join public.event_taxonomy t on t.event_name = e.name;

-- Unmapped names are NAMED rather than silently folded in, so the gap is
-- visible instead of quietly miscounted.
create or replace view public.v_event_taxonomy_unmapped
with (security_invoker = true) as
  select e.name, count(*) as hits, max(e.at) as last_seen
    from public.events e
    left join public.event_taxonomy t on t.event_name = e.name
   where t.event_name is null
   group by e.name
   order by count(*) desc;

create or replace view public.v_cohort_retention
with (security_invoker = true) as
  with first_seen as (
    select device_id, date_trunc('week', min(at))::date as cohort_week
      from public.events where device_id is not null group by device_id
  ), activity as (
    select e.device_id, f.cohort_week, date_trunc('week', e.at)::date as active_week
      from public.events e join first_seen f on f.device_id = e.device_id
     where e.device_id is not null
     group by e.device_id, f.cohort_week, date_trunc('week', e.at)::date
  )
  select cohort_week,
         ((active_week - cohort_week) / 7)::int as weeks_later,
         count(distinct device_id) as devices
    from activity
   group by cohort_week, active_week
   order by cohort_week desc, weeks_later;

revoke all on public.event_taxonomy from anon, authenticated;
grant select on public.event_taxonomy to authenticated;
alter table public.event_taxonomy enable row level security;
drop policy if exists event_taxonomy_read on public.event_taxonomy;
create policy event_taxonomy_read on public.event_taxonomy for select to authenticated using (true);
