-- Action Network private opportunity intelligence + partner-specific mission drafts.
-- PENDING REVIEW. Not applied to production. Never advertises compensation,
-- publishes a mission, or grants authority to act for named organizations.
-- Sources were checked 2026-10-15; partner names are PROSPECTS, not endorsements.
--
-- All non-service access denied except owner/admin SELECT. No public RPC,
-- no mission assignment or bounty funding rows. Promotion into the live
-- action_missions/action_bounties system requires separate, reviewed approval.
create table if not exists public.action_funding_opportunities (
  opportunity_id text primary key,
  funder_name text not null,
  program_title text not null,
  source_kind text not null check (source_kind in ('foundation_web','grants_gov','usaspending','municipal','manual')),
  availability text not null check (availability in ('open','closed','rolling','prospective')),
  source_url text not null check (source_url ~ '^https://'),
  eligibility_note text not null default '',
  reviewed_at date not null,
  created_at timestamptz not null default now()
);
create table if not exists public.action_partner_mission_drafts (
  draft_id text primary key,
  opportunity_id text not null references public.action_funding_opportunities(opportunity_id),
  presenting_to text not null,
  title text not null,
  mission_category text not null,
  instruction text not null,
  metric_keys jsonb not null default '[]'::jsonb check (jsonb_typeof(metric_keys)='array'),
  proof_policy text not null,
  relationship_status text not null check (relationship_status in ('prospective_lead','potential_subgrantee','confirmed_authorized')),
  status text not null default 'draft' check (status='draft'),
  visibility text not null default 'admin_only' check (visibility='admin_only'),
  claim_enabled boolean not null default false check (claim_enabled=false),
  compensation_cents integer,
  authorized_partner_id uuid,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (compensation_cents is null),
  check (authorized_partner_id is null),
  check (published_at is null)
);
alter table public.action_funding_opportunities enable row level security;
alter table public.action_partner_mission_drafts enable row level security;
revoke all on public.action_funding_opportunities,public.action_partner_mission_drafts from public,anon,authenticated;
grant select on public.action_funding_opportunities,public.action_partner_mission_drafts to authenticated;
grant all on public.action_funding_opportunities,public.action_partner_mission_drafts to service_role;
drop policy if exists "admin reads funding opportunities" on public.action_funding_opportunities;
create policy "admin reads funding opportunities" on public.action_funding_opportunities
for select to authenticated using ((select public.eu_is_admin()));
drop policy if exists "admin reads unpublished mission proposals" on public.action_partner_mission_drafts;
create policy "admin reads unpublished mission proposals" on public.action_partner_mission_drafts
for select to authenticated using ((select public.eu_is_admin()));

insert into public.action_funding_opportunities
 (opportunity_id,funder_name,program_title,source_kind,availability,source_url,eligibility_note,reviewed_at)
values
 ('cthealth-trusted-messengers-2026','Connecticut Health Foundation','Trusted Messengers to Support Health Care Coverage','foundation_web','closed','https://www.cthealth.org/latest-news/news-releases/grants-for-trusted-messengers-to-share-information-about-upcoming-changes-to-medicaid-and-snap/','Awarded in June 2026; this is a program precedent, not open funding or an endorsement.',date '2026-10-15'),
 ('cthealth-discretionary','Connecticut Health Foundation','President''s discretionary grants','foundation_web','rolling','https://www.cthealth.org/what-we-do/grantmaking/seeking-a-grant/','Prospective project; speak with foundation before preparing an application.',date '2026-10-15'),
 ('grassroots-seed','Grassroots Fund','Seed Grant','foundation_web','rolling','https://grassrootsfund.org/grant-programs/seed-grants','Volunteer-led grassroots pilot; not a micro-granting or bounty fund.',date '2026-10-15'),
 ('cities-deliver-2026','The Rockefeller Foundation / OpenAI Foundation','Cities Deliver: AI Solutions for Public Services','foundation_web','open','https://citiesdeliver.rockefellerfoundation.org/','Round 1 due 2026-11-29; eligible nonprofit lead and committed city partner required.',date '2026-10-15')
on conflict (opportunity_id) do nothing;

insert into public.action_partner_mission_drafts
 (draft_id,opportunity_id,presenting_to,title,mission_category,instruction,metric_keys,proof_policy,relationship_status)
values
 ('cthealth-print-resources','cthealth-trusted-messengers-2026','Connecticut Health Foundation','Distribute approved HUSKY and SNAP information','outreach','At an authorized partner venue, distribute current foundation/agency-approved health coverage and nutrition-benefits materials. Do not make enrollment decisions or collect benefit identifiers.','["printed_materials_distributed","outreach_shift_hours"]'::jsonb,'Partner sign-off; materials count; location authorized by service partner. Never photograph private benefits or recipients.','potential_subgrantee'),
 ('cthealth-one-to-one','cthealth-trusted-messengers-2026','Connecticut Health Foundation','One-to-one health coverage information conversation','outreach','Complete a trained, consent-based conversation about coverage renewal timelines and where to get qualified enrollment support. Direct questions outside approved scripts to the partner.','["one_to_one_interactions","people_reached"]'::jsonb,'Authorized outreach session ID, supervisor approval, de-identified aggregate tally. No named resident list.','potential_subgrantee'),
 ('cthealth-phone-outreach','cthealth-trusted-messengers-2026','Connecticut Health Foundation','Opt-in coverage update telephone outreach','outreach','Call only people who have given an eligible partner permission to be contacted; use the partner script to explain coverage-change resources.','["phone_calls","people_reached"]'::jsonb,'Partner-held opt-in call record with only aggregated call counts exported. No phone numbers in Action Network.','potential_subgrantee'),
 ('cthealth-community-event','cthealth-trusted-messengers-2026','Connecticut Health Foundation','Host an approved health benefits information table','outreach','Support a preapproved community event with a qualified resource navigator and distribute timely information about coverage and SNAP.','["event_people_reached","printed_materials_distributed"]'::jsonb,'Event attendance estimate; partner-staffed table; session start/end; no photographs of people without consent.','potential_subgrantee'),
 ('cthealth-navigation-referral','cthealth-trusted-messengers-2026','Connecticut Health Foundation','Consent-based referral to trained benefits navigator','referrals','Provide a partner-approved referral pathway to qualified HUSKY/Medicaid or SNAP benefits assistance. Do not determine eligibility, promise approval, or seek diagnoses.','["qualified_referrals","confirmed_service_connections"]'::jsonb,'Count referral handoffs after consent. Verification retained by authorized provider; Action Network receives only aggregated outcomes.','potential_subgrantee'),
 ('cthealth-community-language','cthealth-discretionary','Connecticut Health Foundation','Review accessible and multilingual outreach content','content','Have trained reviewers assess readability and language accessibility of current, approved resource guides before a qualified partner publishes them.','["approved_accessible_assets","languages_supported"]'::jsonb,'Versioned document, partner approval, accessibility checklist and licensing sign-off.','prospective_lead'),
 ('cthealth-evidence-report','cthealth-discretionary','Connecticut Health Foundation','Prepare outreach reporting and quality assurance','reporting','Reconcile approved mission logs into the foundation''s outcome categories without exposing protected health or individual benefits information.','["phone_calls","one_to_one_interactions","event_people_reached","printed_materials_distributed","confirmed_service_connections"]'::jsonb,'Approved deduplicated aggregates, provenance trail and independent review.','prospective_lead'),
 ('grassroots-neighborhood-greening','grassroots-seed','Grassroots Fund','Community-led neighborhood greening workday','environment','Organize a volunteer-led neighborhood stewardship action selected by at least two community organizers; spend a Seed Grant only on eligible direct project costs.','["volunteer_participants","site_improvements"]'::jsonb,'Volunteer sign-in by consent, community approval and project cost receipts. No prize or regranting.','prospective_lead'),
 ('faith-bridgeport-311-pilot','cities-deliver-2026','Faith Community Development Corporation (proposed lead)','Bridgeport non-emergency service request support pilot','city_services','With a signed city partnership, help residents describe and track non-emergency 311 issues via official municipal channels; AI may classify and triage inputs for municipal review, never auto-file false reports.','["approved_311_requests_assisted","resolution_status_checks","time_to_service_handoff"]'::jsonb,'City-provided authorization, consented case identifiers, manual review and privacy protections. No unauthorized access to city systems.','prospective_lead'),
 ('faith-city-benefits-navigation','cities-deliver-2026','Faith Community Development Corporation (proposed lead)','City benefits resource navigation pilot','city_services','With city and social-service agency approval, use AI assistance to route residents to verified public health and benefits resources and schedule qualified human follow-up.','["successful_resource_referrals","time_to_human_assistance"]'::jsonb,'Opt-in process, audited resource directory, verified provider handoff; no eligibility determinations by AI.','prospective_lead')
on conflict (draft_id) do nothing;

-- Acceptance expectations after applying to a scratch database:
-- SELECT count(*) FROM public.action_partner_mission_drafts; -- 10
-- SELECT count(*) FROM public.action_partner_mission_drafts
-- WHERE status<>'draft' OR visibility<>'admin_only'
-- OR claim_enabled OR compensation_cents IS NOT NULL; -- 0
-- Non-admin authenticated users and anon must see zero rows/receive no grant.
