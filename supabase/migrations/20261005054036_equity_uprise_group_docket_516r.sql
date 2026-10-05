-- EQUITY UPRISE ON THE ACTION NETWORK: the group, its front page, and its loop.
--
-- Applied to production on 2026-10-05 after a rolled-back schema/data dry run.
-- Data-only and idempotent: the Equity Uprise organization, cohort group,
-- campaign, four fixed-id missions and cohort row are now canonical network state.
--
-- The shape follows 20261002173558_action_network_organizations_authenticity_v1
-- exactly: organization -> group (with its front page) -> campaign -> missions.
--
--   organization  Equity Uprise, the civic fellowship of McCluster Corp
--   group         equity-uprise, open, group_type 'program': the cohort group
--                 for people who want to become Equity Uprise cohort policy
--                 writers (owner, 2026-10-03). Its front page is the Docket
--                 516R record, https://matthew.mccluster.org/docket-516.html
--   campaign      equity-uprise-003, rendered at /action/?c=equity-uprise
--   missions      the loop: read the record, write a memo, co-write a reform
--                 paper, file a public comment. Fixed ids, because
--                 docket-516.html deep-links each one (mnet.html?mission=<id>).
--   cohort        the next cohort of Equity Uprise policy writers. Membership
--                 is not self-serve: three verified missions open the existing
--                 fellowship application (action_fellowship_v1), and the desk
--                 admits accepted fellows with admit_fellow_to_cohort()
--                 (20261003160000_action_cohort_admission_v1). Apply that
--                 one with this one; without it nobody can be admitted.
--
-- Every fact below was checked on 2026-10-03 against the linked source: the
-- Connecticut Siting Council's Docket 516R page (status closed; remand
-- decision documents 10/17/25; final reconsideration decision 02/09/26) and
-- CT Mirror's reporting of the October 16, 2025 vote and the February 5, 2026
-- rejection of UI's appeal. No claim is made that any one group caused the
-- outcome. Money is off.

with org as (
  insert into public.network_organizations (slug, name, organization_type, description, website_url, verification_state)
  values (
    'equity-uprise', 'Equity Uprise', 'project',
    'The civic program of McCluster Corp. On the Uprise Action Network it is the cohort group for people who want to become Equity Uprise cohort policy writers.',
    'https://matthew.mccluster.org/docket-516.html', 'verified')
  on conflict (lower(slug)) do update
    set description = excluded.description, website_url = excluded.website_url, updated_at = now()
  returning id
),
oid as (
  select id from org
  union all select id from public.network_organizations where lower(slug) = 'equity-uprise'
  limit 1
),
grp as (
  insert into public.network_groups (slug, name, purpose, visibility, organization_id, group_type, front_page_url)
  select 'equity-uprise', 'Equity Uprise',
         'The cohort group for people who want to become Equity Uprise cohort policy writers. Read the public record, write policy that answers it, and earn a seat in the next cohort. Front page: the Docket 516R record.',
         'open', id, 'program', 'https://matthew.mccluster.org/docket-516.html'
  from oid
  on conflict (lower(slug)) do update
    set organization_id = excluded.organization_id, group_type = excluded.group_type,
        purpose = excluded.purpose, front_page_url = excluded.front_page_url
  returning id, organization_id
),
gid as (
  select id, organization_id from grp
  union all select g.id, g.organization_id from public.network_groups g where lower(g.slug) = 'equity-uprise'
  limit 1
)
insert into public.action_campaigns
  (id, slug, status, title, kicker, headline, body, facts, sources, phases, current_phase,
   people_goal, money_goal_cents, money_enabled, allocation_note, chapter, sort, organization_id, group_id)
select
  'equity-uprise-003', 'equity-uprise', 'live',
  'Equity Uprise: from the Docket 516R record to the next cohort',
  'Campaign 003 · Policy · Connecticut',
  'A community answered a utility with paper. Learn to do it on purpose.',
  'Docket 516R is the public record of United Illuminating''s plan to move two 115-kV lines onto steel monopoles through Fairfield and Bridgeport, and of the residents, businesses, churches and towns who answered it with interrogatories, testimony, briefs and public comment. Equity Uprise turns that into practice: read the record, write a policy memo, co-write a reform paper, file a public comment. Every step is a mission a reviewer verifies, and three verified missions open the application for the next cohort.',
  '[
    {"text": "On October 16, 2025 the Connecticut Siting Council voted 5-3 to reject United Illuminating''s Fairfield to Congress Railroad Transmission Line, which would have run about 7.3 miles through Fairfield and Bridgeport on steel monopoles up to 195 feet tall.", "source": "CT Mirror, October 16, 2025", "url": "https://ctmirror.org/2025/10/16/monopoles-denied-ct-siting-council-united-illuminating/"},
    {"text": "Residents, businesses and churches in Fairfield and Bridgeport opposed the project.", "source": "CT Mirror, October 16, 2025", "url": "https://ctmirror.org/2025/10/16/monopoles-denied-ct-siting-council-united-illuminating/"},
    {"text": "The Council rejected UI''s petition for reconsideration on February 5, 2026. Its final reconsideration decision, a denial, is dated February 9, 2026, and the Council lists Docket 516R as closed.", "source": "Connecticut Siting Council, Docket No. 516R", "url": "https://portal.ct.gov/csc/1_applications-and-other-pending-matters/applications/4_docketnos500s/docket-no-516r"}
  ]'::jsonb,
  '[
    {"label": "Docket No. 516R", "publisher": "Connecticut Siting Council", "url": "https://portal.ct.gov/csc/1_applications-and-other-pending-matters/applications/4_docketnos500s/docket-no-516r"},
    {"label": "Docket No. 516", "publisher": "Connecticut Siting Council", "url": "https://portal.ct.gov/csc/1_applications-and-other-pending-matters/applications/4_docketnos500s/docket-no-516?archived=true"},
    {"label": "CT rejects controversial UI monopoles plan", "publisher": "CT Mirror", "url": "https://ctmirror.org/2025/10/16/monopoles-denied-ct-siting-council-united-illuminating/"},
    {"label": "CT Siting Council rejects UI''s monopole appeal", "publisher": "CT Mirror", "url": "https://ctmirror.org/2026/02/05/ct-siting-council-rejects-united-illuminatings-monopole-appeal/"},
    {"label": "Docket 516R explained", "publisher": "Equity Uprise", "url": "https://matthew.mccluster.org/docket-516.html"}
  ]'::jsonb,
  '[
    {"key": "read", "title": "Read", "detail": "Learn how a contested proceeding moves, from the Docket 516R record."},
    {"key": "write", "title": "Write", "detail": "A policy memo to a named decision-maker."},
    {"key": "reform", "title": "Reform", "detail": "A costed, sourced reform paper, written as a group."},
    {"key": "file", "title": "File", "detail": "A public comment on an open proceeding."},
    {"key": "cohort", "title": "Cohort", "detail": "Three verified actions open the fellowship application; the desk admits accepted fellows to the next cohort of policy writers."}
  ]'::jsonb,
  'read', null, null, false,
  'No money is being collected for this campaign.',
  '{"region": "Connecticut", "title": "Docket 516R", "line": "A community answered a utility with paper.", "front_page": "https://matthew.mccluster.org/docket-516.html"}'::jsonb,
  3, gid.organization_id, gid.id
from gid
on conflict (id) do update
  set organization_id = excluded.organization_id, group_id = excluded.group_id, updated_at = now();

insert into public.action_missions
  (id, campaign_id, title, description, domain, difficulty, base_points, proof_required, verification_mode, skills, status)
values
  ('58eeb75d-a5b6-4280-9cd7-3b0cabf02264', 'equity-uprise-003',
   'Read the Docket 516R record',
   'Read the Docket 516R explainer at matthew.mccluster.org/docket-516.html and open at least three filings in its Evidence Room. Proof: in a few sentences, say what you think turned the case and link the filing that shows it.',
   'education', 1, 75, true, 'review', array['public-records', 'policy-analysis']::text[], 'open'),
  ('368fd75a-77d2-4de0-9722-17020674a914', 'equity-uprise-003',
   'Write a policy memo',
   'Two pages to a named decision-maker on one issue you can document: the problem, the evidence, the recommendation and what it costs. Proof: a link to your memo in a document or post you control.',
   'research', 3, 150, true, 'review', array['policy-analysis', 'research', 'writing']::text[], 'open'),
  ('df26314d-d4e1-47e3-b980-1b60b1a682ea', 'equity-uprise-003',
   'Co-write a policy reform paper',
   'With a working group, write a costed, sourced reform proposal and own a named section of it. Proof: a link to the paper and the name of your section.',
   'research', 4, 250, true, 'review', array['policy-analysis', 'research', 'writing', 'collaboration']::text[], 'open'),
  ('7cfac26a-d757-42b9-803b-970f9d5030a8', 'equity-uprise-003',
   'File a public comment',
   'Find an open proceeding near you, such as a siting docket, a zoning hearing or an agency comment period, and file a written comment on the record. Keep it factual and keep other people''s private information out of it. Proof: the filing confirmation or a link to the comment on the public record.',
   'advocacy', 2, 120, true, 'review', array['public-comment', 'advocacy', 'writing']::text[], 'open')
on conflict (id) do nothing;

insert into public.action_cohorts (id, campaign_id, name, description, status)
values (
  'd68908b7-1665-4d83-9895-6adeb2204896', 'equity-uprise-003',
  'Equity Uprise · policy writers, next cohort',
  'Forming now: the next cohort of Equity Uprise policy writers. Three verified missions open the fellowship application, and the desk admits accepted fellows to this cohort.',
  'active')
on conflict (id) do nothing;
