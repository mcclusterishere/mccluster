-- Action Network mission curation: 2026-10-14 user decisions.
-- Forward-only data changes. Never delete mission/assignment/proof/bounty IDs.
-- The 5 existing in-progress assignments must retain proof submission.
-- Old seed migrations remain historical; this newer migration is authoritative.
--
-- Status semantics: open=discoverable, paused=not discoverable but proof allowed,
-- closed=not discoverable and not accepting proof, draft=unpublished.
--
-- A user who has joined a retiring mission can still finish it. All other
-- retiring missions close; paused/closed rows remain queryable for receipts.
-- Retire rejected/duplicate missions without destroying receipts or history.
-- If anyone has already started a mission, pause instead of closing it so
-- submit_action_proof() still accepts the participant's completion.
WITH retired(id) AS (
 VALUES
  ('a195dc51-5593-5640-b51c-836850c3babf'::uuid), -- Audit your own circle
  ('51000000-0000-4000-8000-000000000002'::uuid), -- Build and hand out two care kits
  ('3467cf5e-9b43-515c-a8bd-8f96c30f7421'::uuid), -- Correct it with sources
  ('e83aaa5e-2e44-53e4-9ffc-6eb92f457096'::uuid), -- Cross the room
  ('dd82194b-9f1d-482d-860d-8913f0094136'::uuid), -- Feed someone who's unhoused
  ('7cfac26a-d757-42b9-803b-970f9d5030a8'::uuid), -- File a public comment
  ('4872dbe5-bafe-5464-986c-622941927ba7'::uuid), -- Fix the resource list
  ('05d92dc9-e101-46c0-8cbb-1b53fc3503ea'::uuid), -- Hand out 10 care kits
  ('ed2e7ae0-32d7-5a8e-b70a-c0f7b7958265'::uuid), -- Listen, with permission
  ('8830ae39-4033-5131-98e6-d590a6481f25'::uuid), -- Make an introduction across communities
  ('5276f3b8-61fe-5363-8690-80d98a88878b'::uuid), -- Map who is represented
  ('bbcffaaf-f437-4355-a1c2-7bf2a36dfa62'::uuid), -- Pay off a kid's school lunch debt
  ('d7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c'::uuid), -- Spend with intention
  ('a4fbc309-3878-4db4-ba41-a0c4f1ddf0d7'::uuid), -- Stock a community fridge
  ('51587300-5442-5708-8ccb-13bb4145d7b0'::uuid), -- Teach what you verified
  ('9144bd42-f94a-494e-a17a-a45f9e155f86'::uuid), -- Trace the minerals in your phone
  ('4c57292e-7835-5d29-b1ac-7de53e5bbb81'::uuid), -- Trace your own community history
  ('df26314d-d4e1-47e3-b980-1b60b1a682ea'::uuid), -- Co-write policy paper (duplicate)
  ('df26314d-d4e1-47e3-b980-1b60b1a682ea'::uuid) -- duplicate paper
)
UPDATE public.action_missions m
SET status=CASE WHEN EXISTS (
  SELECT 1 FROM public.action_mission_assignments a
  WHERE a.mission_id=m.id AND a.status IN ('joined','in_progress','submitted','rejected')
) THEN 'paused' ELSE 'closed' END,
updated_at=now()
WHERE m.id IN (SELECT id FROM retired) AND m.status <> 'closed';

-- Move specialist/creator workflows out of public discovery. No deletion.
UPDATE public.action_missions
SET status='paused',updated_at=now()
WHERE id IN (
 'a4333d6f-52a6-511a-b957-fb4f21916b88', -- Build the shared resource
 '42a2b39a-831f-496b-83da-b4ef71cc2b43', -- Document a suspicious listing
 '51000000-0000-4000-8000-000000000005', -- Document one completed homelessness action
 '6ec6b7a5-5290-4ba1-9f05-8f3a82e1cc04', -- Freestyle Containment Protocol
 'e1da8234-cd83-485d-b4a9-4fb8cf14add3', -- Get my kicks legit checked
 '24b16f1a-0f76-4390-a755-eba24f641f71' -- Help legit check a pair
);

-- Keep the future campaigns unpublished until local partners are ready.
UPDATE public.action_missions
SET status='draft',updated_at=now()
WHERE id IN (
 'd207ca6b-a626-49c5-9fbb-fbc8204f02bb', -- Free cuts
 'b2ab3911-78ae-490c-bd95-21573c8c34e9', -- Get someone hired
 'a0a81625-9ac2-4167-a133-fa5d4f63ea75', -- Help three people check their voter registration
 'ebe8f4ee-bc56-4ed6-83f0-f501c68490cf' -- Laundry day's on you
) AND NOT EXISTS (
 SELECT 1 FROM public.action_mission_assignments a
 WHERE a.mission_id=action_missions.id
 AND a.status IN ('joined','in_progress','submitted','rejected')
);

-- Explicit keep: Black business spend; policy memo stays open.
UPDATE public.action_missions
SET status='open', updated_at=now()
WHERE id IN (
 'ba66d4a3-cb62-4403-9b56-7ee00af059d8'
);

-- Retire the institutional-change mission and docket-reading mission by title.
-- Preserve assignments by pausing missions that have started participants.
UPDATE public.action_missions m
SET status=CASE WHEN EXISTS (
 SELECT 1 FROM public.action_mission_assignments a
 WHERE a.mission_id=m.id AND a.status IN ('joined','in_progress','submitted','rejected')
) THEN 'paused' ELSE 'closed' END,updated_at=now()
WHERE m.title IN ('Change one institutional thing','Read the Docket 516R record','Read the Docket 516R','Read Docket 516R')
AND m.status='open';

-- Feed ONE person, rather than two; keep the existing mission ID and receipts.
UPDATE public.action_missions
SET title='Feed One Person',
 description='Provide one meal to a person who needs it, respectfully and without filming their vulnerability. Verification can use a redacted purchase receipt or a self-focused volunteer recap; no recipient identity or image is required.',
 updated_at=now()
WHERE title ILIKE 'Feed two people' OR title ILIKE 'Feed 2 people';

UPDATE public.action_missions
SET title='Spend $20 at a Black-owned business',
    description='Find a Black-owned business through a trusted directory, visit or purchase from it, and share an authentic review if you choose. Proof: a redacted receipt and the business name or directory link. Never publish personal payment details.',
    status='open', updated_at=now()
WHERE id='ba66d4a3-cb62-4403-9b56-7ee00af059d8';

-- Service navigation is for the person who needs help, too. The current
-- proof/points engine is NOT a safe way to process personal assistance.
-- Keep this mission paused until the private referral workflow ships.
UPDATE public.action_missions
SET title='Find services for yourself or someone you know',
    description='Find food, housing, benefits, healthcare, or other support for yourself or someone you know. Start with the official resource directories. You may share a referral with consent. No photos, names, case documents, or public proof of needing help are required. Referrals do not promise eligibility or placement.',
    status='paused', updated_at=now()
WHERE id='51000000-0000-4000-8000-000000000003';

-- Preserve the two existing open bounties as configured; pause the one
-- attached to the media-only mission until it is moved to a creator workflow.
UPDATE public.action_bounties
SET status='paused',updated_at=now()
WHERE mission_id IN (
 '51000000-0000-4000-8000-000000000005',
 '51000000-0000-4000-8000-000000000003'
) AND status='open';

-- Keep the original partner-only housing-navigation lane paused.
UPDATE public.action_missions
SET status='paused',updated_at=now()
WHERE id='51000000-0000-4000-8000-000000000004';

-- Add user-requested missions with stable identifiers. One Safe Night is
-- DRAFT until an authorized provider, funding and guest safeguards exist.
INSERT INTO public.action_missions
  (id,campaign_id,title,description,domain,difficulty,base_points,proof_required,verification_mode,skills,status)
VALUES
  ('51000000-0000-4000-8000-000000000006','homelessness-action-001',
   'One Safe Night',
   'Help fund and arrange one night of safe accommodation through an approved local hotel or service partner. Funding and provider acceptance must be confirmed before promising a room. Use a redacted receipt or partner confirmation as proof; no guest faces, identifying details, or filming of a vulnerable person are required.',
   'mutual_aid',3,200,true,'review',ARRAY['housing','coordination','fundraising']::text[],'draft'),
  ('51000000-0000-4000-8000-000000000007','equity-uprise-003',
   'Write a Song for Equity Uprise',
   'Create an original song that supports an Equity Uprise initiative. Submit a private demo or link for editorial review, with collaborator consent and original-rights confirmation. Participation does not transfer rights or promise release, payment or distribution.',
   'music',2,150,true,'review',ARRAY['songwriting','music','creative']::text[],'open')
ON CONFLICT(id) DO NOTHING;

INSERT INTO public.action_mission_policies
  (mission_id,category,risk_tier,requires_program_cohort,recipient_privacy_required,public_proof_guidance)
VALUES
  ('51000000-0000-4000-8000-000000000006','housing_navigation',3,true,true,
   'Partner and hotel confirmation only. Redact all guest information; do not require identifiable footage. No public reservation or promise until approved and funded.')
ON CONFLICT(mission_id) DO NOTHING;

-- Keep campaign copy aligned with the actual public mission catalog.
UPDATE public.action_campaigns
SET body=$copy$Choose an action that helps: provide meals, find services for yourself or someone you know, support approved housing navigation, or help fund One Safe Night when a verified hotel partner and funding are in place. No one needs to expose their identity or vulnerability to receive help. Volunteer documentation is optional and must protect recipients.$copy$,
    phases='[
      {"key":"mobilize","title":"Mobilize","detail":"Build a trusted local field and service partner network."},
      {"key":"serve","title":"Serve","detail":"Complete direct food assistance and connect people to services."},
      {"key":"navigate","title":"Find help","detail":"Find and share services privately; no proof of need."},
      {"key":"house","title":"One Safe Night","detail":"Fund and arrange accommodation only after provider, guest and payment checks."},
      {"key":"prove","title":"Verify","detail":"Verify volunteer outcomes without identifying service recipients."}
    ]'::jsonb,
    updated_at=now()
WHERE id='homelessness-action-001';

UPDATE public.action_campaigns
SET body=$copy$Equity Uprise turns the Docket 516R public record into practical policy and original creative work: write a policy memo to apply for the policy team, or write an original song for the initiative. A verified policy memo opens the existing fellowship application for the policy team; the original three-verified-action path also remains available. Applications are reviewed, not automatically accepted.$copy$,
    phases='[
      {"key":"write","title":"Write","detail":"Produce a sourced policy memo and qualify to apply."},
      {"key":"song","title":"Write a Song","detail":"Submit an original Equity Uprise song for editorial review."},
      {"key":"cohort","title":"Policy team","detail":"Apply after a verified memo or three verified actions; desk reviews applications."}
    ]'::jsonb,
    updated_at=now()
WHERE id='equity-uprise-003';

UPDATE public.action_cohorts
SET description='Forming now: Equity Uprise policy writers. A verified policy memo or three verified Action Network missions opens the existing fellowship application; acceptance and cohort admission are reviewed by the desk.'
WHERE id='d68908b7-1665-4d83-9895-6adeb2204896';

-- Resource registry is already deployed separately in migration 20261014185255_action_resource_sources_link_only.sql.
