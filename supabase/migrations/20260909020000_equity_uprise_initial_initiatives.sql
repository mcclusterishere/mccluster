-- Seed the active Equity Uprise docket so the institutional frontend has a
-- canonical source of truth as soon as Policy OS migrations are deployed.
-- Additive/idempotent: editorial text can be changed later without minting a
-- second initiative.

insert into public.eu_initiatives (
  org_id,
  slug,
  title,
  short_title,
  summary,
  objective,
  jurisdiction,
  topic_slugs,
  stage,
  status,
  visibility,
  current_ask,
  next_milestone,
  target_outcome,
  settings
)
select
  o.id,
  'dekalb-data-center-operating-standards',
  'DeKalb Data Center Operating Standards',
  'Data Center Standards',
  'A performance-based operating-standard framework for data-center growth: measurable water, acoustics, generator, utility-coordination, cumulative-impact and continuing-compliance requirements rather than a blanket ban.',
  'Develop an evidence-backed model that DeKalb County can use to evaluate, condition and continuously enforce data-center operations while preserving a credible path for responsible investment.',
  'DeKalb County, Georgia',
  array['data-centers','infrastructure','land-use','water','acoustics','energy','local-government']::text[],
  'research',
  'active',
  'public',
  'Technical review, stakeholder interviews and department-level validation of enforceable performance standards.',
  'Complete the comparative standards and interview record, then advance the working paper into stakeholder review.',
  'A usable operating-standard package with measurable thresholds, anti-segmentation rules, recertification and corrective-action mechanisms.',
  jsonb_build_object('series_key','DC','priority','active','source','reconciliation-seed')
from public.orgs o
where o.slug = 'mccluster'
on conflict (org_id, slug) do update set
  title = excluded.title,
  short_title = excluded.short_title,
  summary = excluded.summary,
  objective = excluded.objective,
  jurisdiction = excluded.jurisdiction,
  topic_slugs = excluded.topic_slugs,
  current_ask = excluded.current_ask,
  next_milestone = excluded.next_milestone,
  target_outcome = excluded.target_outcome,
  settings = public.eu_initiatives.settings || excluded.settings,
  updated_at = now();

insert into public.eu_initiatives (
  org_id,
  slug,
  title,
  short_title,
  summary,
  objective,
  jurisdiction,
  topic_slugs,
  stage,
  status,
  visibility,
  current_ask,
  next_milestone,
  target_outcome,
  settings
)
select
  o.id,
  'transportation-mobility-competitiveness',
  'Transportation & Mobility Competitiveness',
  'Mobility Competitiveness',
  'A policy research program on low-volume vehicle manufacturing, USMCA competitiveness, connected-vehicle privacy, mobility classification, e-titles, freight infrastructure, EV fee design and emerging delivery/automation systems.',
  'Identify policy changes that make small-scale American mobility manufacturing and deployment easier without weakening safety, consumer protection or public accountability.',
  'United States · Connecticut · Georgia',
  array['transportation','mobility','manufacturing','usmca','connected-vehicles','freight','ev-policy']::text[],
  'research',
  'active',
  'public',
  'Map the regulatory bottlenecks, agency owners and industry stakeholders that determine low-volume mobility competitiveness.',
  'Publish the initial regulatory map and convert it into a prioritized interview and policy-reform docket.',
  'A practical competitiveness agenda connecting manufacturing, registration, digital title, freight and emerging-mobility policy.',
  jsonb_build_object('series_key','MC','priority','active','source','reconciliation-seed')
from public.orgs o
where o.slug = 'mccluster'
on conflict (org_id, slug) do update set
  title = excluded.title,
  short_title = excluded.short_title,
  summary = excluded.summary,
  objective = excluded.objective,
  jurisdiction = excluded.jurisdiction,
  topic_slugs = excluded.topic_slugs,
  current_ask = excluded.current_ask,
  next_milestone = excluded.next_milestone,
  target_outcome = excluded.target_outcome,
  settings = public.eu_initiatives.settings || excluded.settings,
  updated_at = now();

-- Calendar defaults are explicit rather than implicit: the Google free/busy
-- adapter still blocks classes and existing meetings, while the default
-- interview event carries the user's requested 60- and 30-minute reminders.
insert into public.eu_calendar_settings (
  org_id,
  provider,
  calendar_external_id,
  timezone,
  interview_minutes,
  buffer_before_minutes,
  buffer_after_minutes,
  minimum_notice_minutes,
  booking_horizon_days,
  allowed_windows,
  blackout_rules,
  auto_confirm,
  reminder_minutes
)
select
  o.id,
  'google-calendar',
  'primary',
  'America/New_York',
  30,
  15,
  15,
  1440,
  30,
  '{"1":[["09:00","17:00"]],"2":[["09:00","17:00"]],"3":[["09:00","17:00"]],"4":[["09:00","17:00"]],"5":[["09:00","17:00"]]}'::jsonb,
  '{}'::jsonb,
  false,
  array[60,30]::integer[]
from public.orgs o
where o.slug = 'mccluster'
on conflict (org_id) do update set
  timezone = excluded.timezone,
  interview_minutes = excluded.interview_minutes,
  buffer_before_minutes = excluded.buffer_before_minutes,
  buffer_after_minutes = excluded.buffer_after_minutes,
  minimum_notice_minutes = excluded.minimum_notice_minutes,
  booking_horizon_days = excluded.booking_horizon_days,
  reminder_minutes = excluded.reminder_minutes,
  updated_at = now();
