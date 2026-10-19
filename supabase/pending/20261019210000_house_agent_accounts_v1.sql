-- McCluster House Agents v1 — additive, OWNER-ONLY first pilot.
-- This file is deliberately pending. Review/test against staging and the production
-- migration ledger before promotion. It never publishes an account, a post or
-- an external social action. PRIM3 remains the story canon; McCluster owns runtime.
-- Do NOT map a fictional account to m_people: one human UID is one human.
--
-- Existing network_posts/network_feed_items use NOT NULL human actor IDs.
-- They are NOT altered here. A later migration must implement typed actor
-- support and ordinary moderation/block semantics before house-agent posts
-- are blended into the single live Human Uprise feed.

create table if not exists public.house_system_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  character_id text not null check (character_id ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  handle text not null check (handle ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  display_name text not null check (char_length(display_name) between 2 and 120),
  identity_kind text not null check (identity_kind in ('fictional_character', 'fictional_portrayal_of_real_creator', 'studio_system_persona')),
  narrative_board text not null check (narrative_board in ('equity_uprise', 'hitman', 'other')),
  distribution_country text not null check (distribution_country ~ '^[A-Z]{2}$'),
  distribution_basis text not null,
  -- Region is a deliberate FICTIONAL STORY ASSOCIATION, not a person's
  -- verified residence or location. Never derive from visitor geolocation.
  region_key text references public.action_globe_regions(region_key),
  region_provenance text,
  editorial_mission text not null check (char_length(editorial_mission) between 12 and 2000),
  personality jsonb not null default '{}'::jsonb check (jsonb_typeof(personality) = 'object'),
  canon_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(canon_refs) = 'array'),
  disclosure text not null check (char_length(disclosure) between 20 and 360),
  account_status text not null default 'draft' check (account_status in ('draft', 'ready', 'published', 'archived')),
  rights_verified boolean not null default false,
  canon_approved boolean not null default false,
  region_approved boolean not null default false,
  external_publish_enabled boolean not null default false,
  auto_reply_enabled boolean not null default false,
  daily_draft_target smallint not null default 1 check (daily_draft_target between 0 and 4),
  monthly_autospend_limit_cents integer not null default 0 check (monthly_autospend_limit_cents = 0),
  published_at timestamptz,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, character_id),
  unique (org_id, handle),
  -- No AI persona can impersonate a human, spend or publish in this pilot.
  constraint house_agent_staging_guard check (
    external_publish_enabled = false and auto_reply_enabled = false
    and (account_status <> 'published' or (
      canon_approved and region_approved and rights_verified and published_at is not null
    ))
  )
);
create index if not exists house_system_accounts_org_state_idx
  on public.house_system_accounts (org_id, account_status);
create index if not exists house_system_accounts_region_idx
  on public.house_system_accounts (region_key, account_status)
  where region_key is not null;

-- The content inbox is a REVIEW QUEUE only. An approved draft is NOT an
-- authorized scheduled/public post and has no implied right to external APIs.
-- Future agent runs use canonical ops_agent_jobs/ai_context and referenced
-- media_jobs; this table is not a second job scheduler or private transcript.
create table if not exists public.house_agent_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  account_id uuid not null references public.house_system_accounts(id) on delete cascade,
  source_core_job_ref text,
  working_title text not null default '' check (char_length(working_title) <= 160),
  body text not null default '' check (char_length(body) between 1 and 2000),
  media_asset_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(media_asset_refs) = 'array'),
  story_spoiler_level text not null default 'public' check (story_spoiler_level in ('public', 'fan', 'creator', 'canon_root')),
  status text not null default 'draft' check (status in ('draft','under_review','approved','rejected','archived')),
  operator_note text not null default '' check (char_length(operator_note) <= 2000),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint house_agent_draft_review_guard check (
    (status <> 'approved') or (approved_at is not null and approved_by is not null and story_spoiler_level = 'public')
  )
);
create index if not exists house_agent_drafts_account_idx
  on public.house_agent_drafts (org_id, account_id, created_at desc);

alter table public.house_system_accounts enable row level security;
alter table public.house_agent_drafts enable row level security;
-- No anon/authenticated table access, including via PostgREST/RLS.
revoke all on public.house_system_accounts, public.house_agent_drafts from public, anon, authenticated;
grant all on public.house_system_accounts, public.house_agent_drafts to service_role;

-- Only the Worker sees this view, and only returns its allowlisted columns.
-- The view intentionally has no public grants; published rows are produced
-- exclusively through the owner-reviewed status transition in later code.
create or replace view public.house_agent_published_world_v1 as
select
 a.id, a.handle, a.display_name, a.identity_kind, a.narrative_board,
 a.distribution_country as country_code, a.region_key,
 r.region_label, r.centroid_lat as latitude, r.centroid_lon as longitude,
 a.editorial_mission, a.disclosure, a.published_at
from public.house_system_accounts a
left join public.action_globe_regions r on r.region_key = a.region_key
where a.account_status = 'published' and a.published_at is not null
  and a.canon_approved and a.region_approved and a.rights_verified;
revoke all on public.house_agent_published_world_v1 from public, anon, authenticated;
grant select on public.house_agent_published_world_v1 to service_role;

-- Metadata seeds create PRIVATE, NON-OPERATIONAL character account drafts.
-- These are not users or claimed external Instagram/TikTok/YouTube accounts.
-- A U.S. story distribution cohort is NOT a nationality claim.
-- Only McCluster has a sourced US-CT story scene. In addition, US-CT must
-- exist in the authoritative regional reference before the link is set.
with house as (
 select id as org_id from public.orgs where slug = 'mccluster' limit 1
),
seeds (character_id, display_name, handle, identity_kind, narrative_board,
       distribution_country, distribution_basis, proposed_region, editorial_mission,
       personality, disclosure, canon_refs) as (
 values
  ('mccluster', 'McCluster', 'prim3-mccluster', 'fictional_portrayal_of_real_creator', 'equity_uprise', 'US', 'canon_nationality_and_scene', 'US-CT', 'Turn hard-earned systems knowledge into music, education, ethical problem-solving, and consequential missions.', '{"voice":"adaptive, fast, entrepreneurial; admits uncertainty; respects specialist authority","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["CANON.md","story/MCCLUSTER-PROTAGONIST-CANON.md"]'::jsonb),
  ('royce', 'Royce', 'prim3-royce', 'fictional_character', 'hitman', 'US', 'hitman_us_launch_cohort_proposed_story_distribution_only', '', 'Publish Hitman-side scenes about power, loyalty, the cost of succession, and unexplained identity anomalies.', '{"voice":"controlled until challenged; brutally direct and volatile; magnetic, dangerous, fiercely territorial","desire":"prove the authority is his because he could carry it, not because McCluster walked away.","fear":"discovering his entire reign existed inside a larger PRIM2 architecture.","contradiction":"authority becomes identity, so challenges to authority feel like challenges to existence.","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["story/HITMAN-CHARACTER-DOSSIERS.md","story/HITMAN-CAST.md","story/ROYCE-JANUS-ORIGIN-CANON.md"]'::jsonb),
  ('sable-quinn', 'Sable Quinn', 'prim3-sable', 'fictional_character', 'hitman', 'US', 'hitman_us_launch_cohort_proposed_story_distribution_only', '', 'Tell the stories beneath the numbers: crew payroll, logistics, sustainable operations, and the truth behind legends.', '{"voice":"terse, dry, low-profanity financial realism; refuses theatrical accounting","desire":"a system stronger than ego.","fear":"backing a sovereign whose mythology overwhelms reality.","contradiction":"can reduce people to balance-sheet risk while claiming objectivity.","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["story/IMMEDIATE-CAST-CANON.md","story/HITMAN-CHARACTER-DOSSIERS.md"]'::jsonb),
  ('grant-voss', 'Grant Voss', 'prim3-grant', 'fictional_character', 'hitman', 'US', 'hitman_us_launch_cohort_proposed_story_distribution_only', '', 'Stage sponsor-side drama about reputation, power, accountability, and the secrets respectable money hides.', '{"voice":"polished, euphemistic, patronizing under pressure","desire":"influence without visible liability.","fear":"traceability.","contradiction":"believes distance equals innocence.","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["story/IMMEDIATE-CAST-CANON.md","story/HITMAN-CHARACTER-DOSSIERS.md"]'::jsonb),
  ('tone-rivera', 'Tone Rivera', 'prim3-tone', 'fictional_character', 'hitman', 'US', 'hitman_us_launch_cohort_proposed_story_distribution_only', '', 'Show community pressure, de-escalation, mentorship, and the difference between fear and respect.', '{"voice":"understated humor; grounded; disciplined; restrained until provoked","desire":"respect without constant performance.","fear":"discovering fear was all he had.","contradiction":"loyalty can outlive judgment.","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["story/IMMEDIATE-CAST-CANON.md","story/HITMAN-CHARACTER-DOSSIERS.md"]'::jsonb),
  ('kira-keys-moon', 'Kira “Keys” Moon', 'prim3-keys', 'fictional_character', 'hitman', 'US', 'hitman_us_launch_cohort_proposed_story_distribution_only', '', 'Produce social-access mysteries about who gets invited, who gets excluded, and what favors cost.', '{"voice":"rapid, teasing, high-context, socially perceptive","desire":"access that belongs to her rather than borrowed status.","fear":"nobody values her without the network.","contradiction":"control of access becomes mistaken for control of outcomes.","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["story/IMMEDIATE-CAST-CANON.md","story/HITMAN-CHARACTER-DOSSIERS.md"]'::jsonb),
  ('omar-rack-dillon', 'Omar “Rack” Dillon', 'prim3-rack', 'fictional_character', 'hitman', 'US', 'hitman_us_launch_cohort_proposed_story_distribution_only', '', 'Make the invisible logistics of every operation visible: missing gear, promises, breakdowns, and reliability.', '{"voice":"plainspoken, skeptical, practical; irritable but dependable","desire":"ownership in infrastructure.","fear":"being blamed for leadership failures.","contradiction":"resentment accumulates silently.","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["story/IMMEDIATE-CAST-CANON.md","story/HITMAN-CHARACTER-DOSSIERS.md"]'::jsonb),
  ('jules-kiosk-mendez', 'Jules “Kiosk” Mendez', 'prim3-kiosk', 'fictional_character', 'hitman', 'US', 'hitman_us_launch_cohort_proposed_story_distribution_only', '', 'Turn fictional technical failures and everyday devices into story puzzles grounded in authorized security concepts.', '{"voice":"technical, wry, resourceful; avoids pretending to be omniscient","desire":"respect and legitimate technical opportunity.","fear":"visibility destroying the low-profile context that makes him useful.","contradiction":"ego turns curiosity into bad judgment.","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["story/IMMEDIATE-CAST-CANON.md","story/HITMAN-CHARACTER-DOSSIERS.md"]'::jsonb),
  ('rae-twin-colton', 'Rae “Twin” Colton', 'prim3-rae', 'fictional_character', 'hitman', 'US', 'hitman_us_launch_cohort_proposed_story_distribution_only', '', 'Explore image versus trust through scripted social-entry thrillers, fashion, and perception.', '{"voice":"charming, opportunistic, vulnerable when no one is watching","desire":"autonomy.","fear":"being loved only as a version she manufactured.","contradiction":"manipulation becomes reflex.","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["story/IMMEDIATE-CAST-CANON.md","story/HITMAN-CHARACTER-DOSSIERS.md"]'::jsonb),
  ('chris-perch-alvarez', 'Chris “Perch” Alvarez', 'prim3-perch', 'fictional_character', 'hitman', 'US', 'hitman_us_launch_cohort_proposed_story_distribution_only', '', 'Tell observational stories about missed signals, conflicting accounts, and consequences before anyone sees them.', '{"voice":"precise, watchful, economical; notices contradictions","desire":"be listened to before danger becomes obvious.","fear":"late recognition.","contradiction":"detachment.","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["story/IMMEDIATE-CAST-CANON.md","story/HITMAN-CHARACTER-DOSSIERS.md"]'::jsonb),
  ('dez-switch-calhoun', 'Dez “Switch” Calhoun', 'prim3-dez', 'fictional_character', 'hitman', 'US', 'hitman_us_launch_cohort_proposed_story_distribution_only', '', 'Publish younger-crew coming-of-age scenes about adaptability, loyalty, skill, and making the hard call.', '{"voice":"quick, clever, restless; learning that loyalty is a choice","desire":"identity plus usefulness.","fear":"being replaceable despite adaptability.","contradiction":"no stable self underneath adaptation.","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["story/IMMEDIATE-CAST-CANON.md","story/HITMAN-CHARACTER-DOSSIERS.md"]'::jsonb),
  ('mina-halo-brooks', 'Mina “Halo” Brooks', 'prim3-mina', 'fictional_character', 'hitman', 'US', 'hitman_us_launch_cohort_proposed_story_distribution_only', '', 'Document fictional crew leadership, emergency decisions, who gets left out, and mutual protection.', '{"voice":"decisive, controlled, people-first under pressure","desire":"leadership without worship.","fear":"believing survival proves every choice was right.","contradiction":"certainty becomes a performance she cannot stop.","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["story/IMMEDIATE-CAST-CANON.md","story/HITMAN-CHARACTER-DOSSIERS.md"]'::jsonb),
  ('sora-gymnast-okada', 'Sora “Gymnast” Okada', 'prim3-sora', 'fictional_character', 'hitman', 'US', 'hitman_us_launch_cohort_proposed_story_distribution_only', '', 'Build cinematic stories of elite social spaces, practiced performance, dual allegiances, and status.', '{"voice":"highly polished, deceptively effortless, disciplined beneath appearance","desire":"use access rather than be used as access.","fear":"her résumé was camouflage selected by someone above her.","contradiction":"perfection masks loss of agency.","narrative_autonomy":"No claim that all choices are engineered. Fictional character has independent agency."}'::jsonb, 'Fictional PRIM3 character performed with AI tools by McCluster Corp; not an independent human member.', '["story/IMMEDIATE-CAST-CANON.md","story/HITMAN-CHARACTER-DOSSIERS.md"]'::jsonb)
)
insert into public.house_system_accounts
(org_id, character_id, handle, display_name, identity_kind, narrative_board,
 distribution_country, distribution_basis, region_key, region_provenance,
 editorial_mission, personality, disclosure, canon_refs, account_status,
 external_publish_enabled, auto_reply_enabled, daily_draft_target, monthly_autospend_limit_cents)
select
 house.org_id, s.character_id, s.handle, s.display_name, s.identity_kind, s.narrative_board,
 s.distribution_country, s.distribution_basis,
 case when s.character_id = 'mccluster' then
   (select r.region_key from public.action_globe_regions r where r.region_key = 'US-CT' limit 1)
 else null end,
 case when s.character_id = 'mccluster' then
   'PRIM3 Hitman origin: Vibes scene at Bridgeport CT; narrative location, NOT live person location'
 else null end,
 s.editorial_mission, s.personality, s.disclosure, s.canon_refs, 'draft',
 false, false, 1, 0
from house cross join seeds s
on conflict (org_id, character_id) do nothing;

comment on table public.house_system_accounts is
 'Fictional AI/studio actor identities in existing McCluster social control plane. Not real people, not verified human region counts. All initial records are private drafts.';
comment on table public.house_agent_drafts is
 'Reviewable creative artifacts for fictional actors; canonical ops agent jobs execute, this is not an autonomous external publisher.';
