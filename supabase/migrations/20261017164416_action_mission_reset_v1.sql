-- Owner-directed mission reset, 2026-10-17. Pending until applied and promoted.
-- Reuse the three existing mission IDs. Paused missions retain proof access;
-- no assignment, proof, point, bounty, or completion history is deleted.
-- Discovery categories describe the browsing experience, not mission domains.
begin;

alter table public.action_missions
  add column if not exists discovery_category text
  check (discovery_category in ('create','help','explore','earn'));

-- Development ideas do not need an invented funding opportunity. The existing
-- private draft catalog can hold them until a real partner need is confirmed.
alter table public.action_partner_mission_drafts
  alter column opportunity_id drop not null;
alter table public.action_partner_mission_drafts
  drop constraint if exists action_partner_mission_drafts_relationship_status_check;
alter table public.action_partner_mission_drafts
  add constraint action_partner_mission_drafts_relationship_status_check
  check (relationship_status in ('prospective_lead','potential_subgrantee','existing_partner','confirmed_authorized'));
comment on column public.action_partner_mission_drafts.relationship_status is
  'Relationship context only. Existing partner does not authorize a specific mission, funding, publication, or claims.';

-- The old general help mission has no assignments at the reviewed snapshot.
-- If someone joined before this migration, preserve it and stop for review
-- instead of changing what that participant agreed to do.
do $$ begin
  perform 1 from public.action_missions
    where id in ('302dcb4e-ca21-4289-b633-9c397985fb9d','49d654e1-dfc8-42aa-a26e-22912ebf8dc6')
    order by id for update;
  if exists (select 1 from public.action_mission_assignments
    where mission_id='302dcb4e-ca21-4289-b633-9c397985fb9d')
    and exists (select 1 from public.action_missions
      where id='302dcb4e-ca21-4289-b633-9c397985fb9d' and title='Help a person') then
    raise exception 'The general help mission gained an assignment; preserve it and create a separate free-ride mission.';
  end if;
  if exists (select 1 from public.action_mission_assignments
    where mission_id='49d654e1-dfc8-42aa-a26e-22912ebf8dc6')
    and exists (select 1 from public.action_missions
      where id='49d654e1-dfc8-42aa-a26e-22912ebf8dc6' and title='Recycle one dead device the right way') then
    raise exception 'The recycling mission gained an assignment; preserve it and keep the CfAL idea in the private arsenal.';
  end if;
end $$;

update public.action_missions set
  title='Give someone a free ride',
  description='Help someone you know or a trusted community connection get somewhere they need to go, at no charge. Agree on the trip privately and offer only a ride you are able to provide safely. Proof: a short account of the completed trip and the rider''s confirmation, with names, contact details and exact addresses removed. A photo of the rider is not required.',
  campaign_id='equity-uprise-003', domain='mutual_aid', discovery_category='help',
  difficulty=1, skills=array['community','mutual_aid'],
  proof_required=true, verification_mode='review', status='open', updated_at=now()
where id='302dcb4e-ca21-4289-b633-9c397985fb9d';

update public.action_missions set
  title='Write a policy memo',
  description='Choose one issue in your neighborhood and write a one- or two-page memo to someone who can act on it. Explain the problem, cite the evidence, propose one concrete change, and name the first step needed to make it happen. Proof: your memo and its sources. You can complete this mission without sending it; submission is a separate choice.',
  campaign_id='equity-uprise-003', domain='research', discovery_category='create',
  difficulty=2, skills=array['policy-analysis','research','writing'],
  proof_required=true, verification_mode='review', status='open', updated_at=now()
where id='368fd75a-77d2-4de0-9722-17020674a914';

update public.action_missions set
  title='Write the Change',
  description='Record an original song about an issue in your neighborhood or something you want to change. A phone recording or a simple demo counts. Give the song a title, add a sentence about the issue, and credit everyone who contributed. Proof: the recording and credits. A music video, studio session and release campaign are optional.',
  campaign_id='equity-uprise-003', domain='music', discovery_category='create',
  difficulty=1, skills=array['songwriting','music','creative'],
  proof_required=true, verification_mode='review', status='open', updated_at=now()
where id='053cbd0d-6bdb-49c6-bd80-8c5b8be36068';

-- Retire the reviewed old discovery selection without changing completed or
-- assigned work. submit_action_proof accepts both open and paused missions.
update public.action_missions set status='paused', updated_at=now()
where status='open' and id in (
  '9144bd42-f94a-494e-a17a-a45f9e155f86', -- Trace the minerals in your phone
  '7cfac26a-d757-42b9-803b-970f9d5030a8', -- File a public comment
  'd7fc0ca4-1e9a-58c7-b6ca-11e04617fb7c', -- Spend with intention
  'a17050c1-a551-4c5c-80c1-5a1750c1a001', -- Anti-Social
  'ba803367-057b-4664-902d-58a0cfd62068'  -- Show up to a rally
);

-- Old-tech donation is held for CfAL's intake guidance. It is not a universal
-- electronics recycling service and no partner approval is asserted.
update public.action_missions m set
  title='Give your old tech a second life',
  description='Development draft: donate an eligible used computer through an approved partner''s intake process. CfAL for Digital Inclusion is the proposed partner. Confirm accepted devices, data-removal instructions, appointments or drop-off logistics, capacity and receipt confirmation before opening this mission.',
  discovery_category='help',
  status=case when exists(select 1 from public.action_mission_assignments a where a.mission_id=m.id) then 'paused' else 'draft' end,
  updated_at=now()
where id='49d654e1-dfc8-42aa-a26e-22912ebf8dc6';

-- Faith CDC is an existing relationship, attested by the owner. Its specific
-- proposed city/funding programs remain unapproved, private drafts.
update public.action_partner_mission_drafts
set presenting_to='Faith Community Development Corporation',
    relationship_status='existing_partner'
where draft_id in ('faith-bridgeport-311-pilot','faith-city-benefits-navigation');

insert into public.action_partner_mission_drafts
  (draft_id,opportunity_id,presenting_to,title,mission_category,instruction,metric_keys,proof_policy,relationship_status)
values
  ('arsenal-one-song-one-scene',null,'Arts Council of Greater New Haven','One Song, One Scene','create',
   'Hold in development. Add a short filmed scene to an existing song only when the participant, collaborator roles, space, equipment and a useful outlet are confirmed. The simple recording mission launches first. No venue booking or partner approval is implied.',
   '["completed_songs","completed_scenes"]','Completed recording, scene and agreed contributor credits.','prospective_lead'),
  ('arsenal-business-look',null,'Faith Community Development Corporation','Make This Business Look Expensive','create',
   'Hold in development. Find a real local business through an agreed program that wants a small visual refresh, then agree on the exact deliverable and usage. Do not assign unsolicited marketing work or imply a paid production budget.',
   '["business_approved_assets"]','Business acceptance of the agreed asset; contributor credits.','existing_partner'),
  ('arsenal-job-ready-kit',null,'Faith Community Development Corporation','Build a Job-Ready Kit','help',
   'Hold in development. Work with the existing Faith CDC relationship to identify an actual workforce-program need and a consenting participant. Agree on a bounded resume, application or interview-preparation task before opening it.',
   '["participant_approved_kits"]','Private participant or program confirmation. No public resume, employment documents or personal contact data.','existing_partner'),
  ('arsenal-free-new-haven',null,'Arts Council of Greater New Haven','Find the Free Side of New Haven','explore',
   'Hold in development. Clarify the concept with the owner: a short, dated guide to genuinely free local activities or useful places. Confirm hours, access conditions and accuracy with source organizations before proposing a public mission.',
   '["verified_free_resources"]','Source URLs, date checked and clear access conditions.','prospective_lead'),
  ('arsenal-event-crew',null,'Faith Community Development Corporation','Be the Event Crew','help',
   'Hold in development. There is no active event platform for this mission. Start only from a real partner event with a named organizer, a specific shift, supervision and a confirmation process. No speculative event signup.',
   '["organizer_confirmed_shifts"]','Named organizer confirms the agreed shift was completed.','existing_partner'),
  ('arsenal-build-from-waste',null,'Partner to be identified','Build It From Waste','create',
   'Hold in development. Identify an organization with a concrete reuse need, suitable materials and a receiver for the finished item. Define the item and tools only after that need is confirmed. MakeHaven is excluded from partner consideration.',
   '["accepted_reused_items"]','Receiver accepts the agreed item; record materials reused without invented environmental-impact estimates.','prospective_lead'),
  ('arsenal-kits-out-the-door',null,'Downtown Evening Soup Kitchen','Kits Out the Door','help',
   'Hold in development; low priority. Ask whether DESK actually needs a specific set of supplies before defining contents or inviting participation. Follow the organization''s current quantity, delivery and receiving process. No partner agreement is asserted.',
   '["partner_accepted_supply_deliveries"]','Staff confirmation of accepted items. No recipient photos or invented people-served multiplier.','prospective_lead'),
  ('arsenal-used-tech-cfal',null,'CfAL for Digital Inclusion','Give Your Old Tech a Second Life','help',
   'Partner discussion; do not open yet. A used-computer donation pilot inquiry was sent to the existing CfAL contact on 2026-10-17. Confirm eligible equipment, condition, donor data-removal instructions, intake capacity, drop-off or appointments, and a lightweight receipt confirmation. Publish only the process CfAL approves.',
   '["accepted_devices"]','CfAL receipt or approved handoff confirmation; device serials and donor personal information stay private.','prospective_lead'),
  ('arsenal-uri-stewardship',null,'Urban Resources Initiative','Join an Existing Neighborhood Stewardship Shift','help',
   'Hold for partner development. Ask URI for a current, suitable volunteer need and site contact. Build a small task around its actual season, location and instructions; do not invent a planting event or available slot.',
   '["partner_confirmed_shifts"]','Site organizer confirms completion; any public images follow participant consent.','prospective_lead')
on conflict (draft_id) do nothing;

-- Publication, claims, partner authorization and compensation stay disabled
-- by the pre-existing table constraints and admin-only read policy.
commit;
