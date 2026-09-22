-- CORRECTING THE TAXONOMY, and the funnel built on it.
--
-- The first pass produced confident numbers nobody should have trusted.
--
--   'acquired' was mapped to 'register'. It is not a registration: it
--   fires from js/analytics.js on FIRST VISIT to record where somebody
--   came from, for everybody. So the funnel reported 50 accounts made on
--   a day four people actually signed up. A wrong number in a dashboard
--   is worse than no number, because it gets acted on.
--
--   The eight highest-volume events in the system -- bar_boot, click,
--   scroll_depth, page_view, section_view, page_leave and the rest --
--   were unmapped, because the first pass classified the colourful
--   bespoke names and missed the plumbing carrying the actual traffic.
--
--   'bar_boot' was then mapped to 'content', which made "heard
--   something" equal "arrived" on every single day. It is the player
--   MOUNTING on a page, not a listen. Moved to 'ops'.
--
-- REGISTRATION IS NOT AN EVENT, and should not be: there is no honest
-- client signal for it. The truth is auth.users, so the funnel joins
-- that table rather than believing the browser.
--
-- Verified against ground truth after the fix: made_an_account reads
-- 7 / 9 / 7 / 18 for 22-19 Sept, which is exactly what auth.users holds.

alter table public.event_taxonomy drop constraint if exists event_taxonomy_stage_ck;
alter table public.event_taxonomy add constraint event_taxonomy_stage_ck check (stage in
  ('view','content','search','engage','lead','register','checkout','purchase','subscribe','support','ops'));

comment on constraint event_taxonomy_stage_ck on public.event_taxonomy is
  '"ops" is deliberately outside the funnel: device_power and network_change describe the machine, not the person.';

update public.event_taxonomy set stage = 'view',
  note = 'first-visit source marker from js/analytics.js — NOT a registration'
 where event_name = 'acquired';

insert into public.event_taxonomy (event_name, stage, note) values
  ('page_view','view',''), ('section_view','engage','scrolled a section into view'),
  ('scroll_depth','engage',''), ('click','engage',''), ('cta_click','engage',''),
  ('page_leave','engage',''), ('exit_intent','engage',''),
  ('bar_boot','ops','the player MOUNTED on the page — not a listen'),
  ('bar_transport','content',''),
  ('song_start','content',''), ('song_stop','content',''), ('bar_walk_start','content',''),
  ('sound_toggle','engage',''), ('freq_tune','engage',''),
  ('closet_view','content',''), ('closet_drop_view','content',''), ('merch_view','content',''),
  ('gallery_view','content',''), ('hire_view','content',''), ('sites_lane_view','content',''),
  ('equity_uprise_view','content',''), ('inner_room_open','content',''),
  ('inner_room_chapter','content',''), ('lockroom_open','content',''),
  ('vr_brief','content',''), ('work_scene','content',''),
  ('onboard_step','lead','moved through onboarding'),
  ('volume_call','support',''), ('volume_call_end','support',''),
  ('device_power','ops',''), ('network_change','ops',''),
  ('location_permission','ops','whether the prompt was shown — not a location'),
  ('dead_click','ops','a click that did nothing — a bug signal'),
  ('rage_click','ops',''), ('js_error','ops',''), ('js_rejection','ops',''),
  ('vr_gate','ops',''), ('vr_skip','ops',''), ('vr_gyro_on','ops',''), ('vr_gate_allow','ops','')
on conflict (event_name) do update
  set stage = excluded.stage, note = excluded.note;

drop view if exists public.v_funnel_daily;
create view public.v_funnel_daily
with (security_invoker = true) as
  with behaviour as (
    select date_trunc('day', s.at)::date as day,
           count(distinct s.device_id) filter (where s.stage = 'view')     as arrived,
           count(distinct s.device_id) filter (where s.stage = 'content')  as heard_something,
           count(distinct s.device_id) filter (where s.stage = 'engage')   as engaged,
           count(distinct s.device_id) filter (where s.stage = 'search')   as searched,
           count(distinct s.device_id) filter (where s.stage = 'lead')     as asked_for_something,
           count(distinct s.device_id) filter (where s.stage = 'checkout') as reached_checkout,
           count(distinct s.device_id) filter (where s.stage = 'purchase') as paid
      from public.v_events_staged s
     where s.device_id is not null and s.stage <> 'ops'
     group by 1
  ), signups as (
    select date_trunc('day', created_at)::date as day, count(*) as made_an_account
      from auth.users group by 1
  ), confirmed as (
    select date_trunc('day', email_confirmed_at)::date as day, count(*) as confirmed_the_email
      from auth.users where email_confirmed_at is not null group by 1
  )
  select coalesce(b.day, s.day, c.day) as day,
         coalesce(b.arrived,0) as arrived,
         coalesce(b.heard_something,0) as heard_something,
         coalesce(b.engaged,0) as engaged,
         coalesce(b.searched,0) as searched,
         coalesce(b.asked_for_something,0) as asked_for_something,
         coalesce(s.made_an_account,0) as made_an_account,
         coalesce(c.confirmed_the_email,0) as confirmed_the_email,
         coalesce(b.reached_checkout,0) as reached_checkout,
         coalesce(b.paid,0) as paid
    from behaviour b
    full join signups s on s.day = b.day
    full join confirmed c on c.day = coalesce(b.day, s.day)
   order by 1 desc;

comment on view public.v_funnel_daily is
  'Behavioural stages counted in distinct devices; registration read from auth.users, because there is no honest client-side signal for it.';
