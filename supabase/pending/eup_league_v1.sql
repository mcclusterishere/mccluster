-- Environmental Justice League: private campaign, mission, application, assignment, proof, review, credit and
-- consent records for the E=Up workspace, with the first member mission loop ("Write a song for a healthier
-- world"). Pending, unapplied, reviewed LOCAL schema (owner direction 2026-11-09: the first deeper E=Up release
-- is admin-only at every data, API and storage boundary).
--
-- The wire contract is workers/mccluster/src/eup/league-contract.js. Where this file and the contract differ the
-- contract wins and this file is the defect. The values this file needs from it (document specs, patterns, the
-- action table, limits, the media table) are embedded once, in public.eup_league_contract(), and
-- scripts/test/eup-league.integration.mjs asserts that copy is equal to the contract.
--
-- Boundaries:
--   * Three service-only SECURITY INVOKER entry points. The actor is the Worker-verified session user; no
--     document can name another account (every document is closed). anon and authenticated hold nothing.
--   * Every table is private: RLS on, no policy, service_role grants only. Nothing here reads or writes a public
--     projection or storage, and no storage path is stored or returned: the Worker derives it from row ids.
--   * Module state (enabled, draining, disabled) is NOT here. It lives in eup_module_policy_v1.sql; every
--     mutation takes that guard in its own transaction and every League domain table carries the statement
--     trigger backstop. The League policy row below is configuration only and has no on/off field.
--   * No points, payment, commission, live broadcast, or publication wider than a campaign's released audience.
--
-- Order inside every mutation (one rule, both command functions and the seal):
--   1. actor (42501)            2. idempotency key lock, then exact replay (EU003 on a changed payload)
--   3. module guard, or the reduce guard for an action that only stops work or removes exposure
--   4. row locks in the single order campaign, mission, application, assignment, proof, upload
--   5. member gates, first failure wins: the row exists (P0002), released audience (EU011), the row is the
--      actor's (42501), a valid League policy (EU010), entitlement (EU012), media enabled (EU010)
--   6. the document (22023), revision and state (40001), then the action's own rules.
-- Reads take no key, write nothing and are never guarded: they answer in every module state, and so does an
-- exact replay. A failed command leaves no receipt. No guard is ever called under an EXCEPTION handler: this file
-- has none.
--
-- FIRST PASS (core loop). The owner-control set is added by the second pass and until then answers 0A000
-- "not implemented in this pass": owner publications.list, publications.decide, appeals.list, appeals.resolve,
-- proofs.moderate, media.due, media.purged, outbox.list, outbox.ack, credits.list,
-- applications.accommodation.get; member appeals.open, appeals.withdraw. The outbox table, the audit record of
-- an accommodation read and the EU017 rate bounds come with it.
--
-- Apply AFTER eup_module_policy_v1.sql. Rollback: eup_league_v1.rollback.sql.
begin;
set local lock_timeout = '5s';

-- League configuration: one row per house. Entitlement rule, media settings, retention and notices. No state.
create table public.eup_league_policy (
  tenant uuid primary key references public.orgs(id),
  revision integer not null check (revision between 1 and 2147483646),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.eup_league_policy_revisions (
  tenant uuid not null references public.eup_league_policy(tenant),
  revision integer not null check (revision between 1 and 2147483646),
  document jsonb not null,
  reason text not null check (length(reason) between 1 and 500),
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (tenant, revision)
);

create table public.eup_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant uuid not null references public.orgs(id),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title text not null check (length(title) between 1 and 180),
  state text not null default 'draft' check (state in ('draft','released','paused','withdrawn')),
  -- Anything wider than the house owners plus explicitly invited accounts is impossible by constraint.
  audience text not null default 'admin_preview' check (audience in ('admin_preview','invited')),
  revision integer not null default 1 check (revision between 1 and 2147483646),
  document jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant, slug),
  unique (tenant, id)
);
create table public.eup_campaign_revisions (
  campaign_id uuid not null references public.eup_campaigns(id),
  revision integer not null,
  tenant uuid not null,
  state text not null,
  audience text not null,
  document jsonb not null,
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (campaign_id, revision)
);
-- Invited testers. A grant has effect only while its campaign's audience is 'invited'.
create table public.eup_campaign_audience_grants (
  id uuid primary key default gen_random_uuid(),
  tenant uuid not null,
  campaign_id uuid not null,
  account uuid not null references auth.users(id),
  state text not null default 'open' check (state in ('open','revoked')),
  note text check (note is null or length(note) between 1 and 500),
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason is null or length(revoked_reason) between 1 and 500),
  foreign key (tenant, campaign_id) references public.eup_campaigns(tenant, id),
  check ((state = 'revoked') = (revoked_at is not null)),
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index eup_campaign_audience_grants_one_open on public.eup_campaign_audience_grants (campaign_id, account) where state = 'open';

create table public.eup_missions (
  id uuid primary key default gen_random_uuid(),
  tenant uuid not null,
  campaign_id uuid not null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  title text not null check (length(title) between 1 and 180),
  template text not null check (template in ('write-a-song','explain-a-source','map-a-community-resource','understand-a-policy','community-action-session')),
  state text not null default 'draft' check (state in ('draft','released','paused','withdrawn')),
  -- revision is the compare-and-swap token (it moves on every change). requirements_revision is what a
  -- participant agrees to: it moves only when title, requirements, acceptance, proof modes or rubric change.
  revision integer not null default 1 check (revision between 1 and 2147483646),
  requirements_revision integer not null default 1 check (requirements_revision between 1 and 2147483646),
  capacity integer check (capacity is null or capacity between 1 and 100000),
  proof_modes text[] not null,
  document jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant, campaign_id) references public.eup_campaigns(tenant, id),
  unique (campaign_id, slug),
  unique (tenant, id)
);
create table public.eup_mission_revisions (
  mission_id uuid not null references public.eup_missions(id),
  revision integer not null,
  tenant uuid not null,
  state text not null,
  requirements_revision integer not null,
  capacity integer,
  proof_modes text[] not null,
  document jsonb not null,
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (mission_id, revision)
);

create table public.eup_applications (
  id uuid primary key default gen_random_uuid(),
  tenant uuid not null,
  mission_id uuid not null,
  requirements_revision integer not null check (requirements_revision between 1 and 2147483646),
  applicant uuid not null references auth.users(id),
  recorded_by uuid references auth.users(id),
  status text not null check (status in ('draft','submitted','changes_requested','approved','declined','withdrawn')),
  revision integer not null default 1 check (revision between 1 and 2147483646),
  document jsonb not null default '{"statement":""}'::jsonb,
  -- The accommodation request is restricted: owner lists show only that one exists.
  accommodation jsonb,
  decided_by uuid references auth.users(id),
  decision_reason text check (decision_reason is null or length(decision_reason) <= 2000),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant, mission_id) references public.eup_missions(tenant, id),
  unique (mission_id, applicant),
  unique (tenant, id)
);
create index eup_applications_applicant on public.eup_applications (tenant, applicant);
-- Every decision is appended; none is overwritten.
create table public.eup_application_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant uuid not null,
  application_id uuid not null,
  decision text not null check (decision in ('approved','declined','changes_requested')),
  reason text check (reason is null or length(reason) <= 2000),
  rubric jsonb not null default '[]'::jsonb,
  requirements_revision integer not null,
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  foreign key (tenant, application_id) references public.eup_applications(tenant, id)
);
create index eup_application_decisions_application on public.eup_application_decisions (application_id, decided_at);

create table public.eup_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant uuid not null,
  application_id uuid not null unique,
  mission_id uuid not null,
  participant uuid not null references auth.users(id),
  -- No stored 'paused': pause is a property of the campaign and the mission, so a paused seat stays a taken seat.
  status text not null default 'offered' check (status in ('offered','accepted','completed','withdrawn')),
  revision integer not null default 1 check (revision between 1 and 2147483646),
  offered_requirements_revision integer not null check (offered_requirements_revision between 1 and 2147483646),
  accepted_requirements_revision integer,
  accepted_notice_revision text,
  accepted_at timestamptz,
  completed_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant, application_id) references public.eup_applications(tenant, id),
  foreign key (tenant, mission_id) references public.eup_missions(tenant, id),
  unique (tenant, id),
  check (status <> 'accepted' or (accepted_requirements_revision is not null and accepted_notice_revision is not null and accepted_at is not null))
);
create index eup_assignments_mission_status on public.eup_assignments (mission_id, status);
create index eup_assignments_participant on public.eup_assignments (tenant, participant);
-- What was accepted, and when: the requirements revision and the participation notice revision. Appended.
create table public.eup_assignment_acceptances (
  id uuid primary key default gen_random_uuid(),
  tenant uuid not null,
  assignment_id uuid not null,
  requirements_revision integer not null,
  notice_revision text not null check (notice_revision ~ '^[A-Za-z0-9._:-]{1,64}$'),
  actor uuid not null references auth.users(id),
  accepted_at timestamptz not null default now(),
  foreign key (tenant, assignment_id) references public.eup_assignments(tenant, id)
);
create index eup_assignment_acceptances_assignment on public.eup_assignment_acceptances (assignment_id, accepted_at);

-- The working copy of a proof. Nothing here is evidence until proofs.submit.
create table public.eup_proof_drafts (
  assignment_id uuid primary key,
  tenant uuid not null,
  participant uuid not null references auth.users(id),
  revision integer not null default 1 check (revision between 1 and 2147483646),
  document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant, assignment_id) references public.eup_assignments(tenant, id)
);

-- One row per file a participant uploads. The object lives in the private bucket at a path the Worker derives
-- from (tenant, assignment_id, id, ext); no path is stored. The digest, byte count, family and storage identity
-- are what the Worker measured when it sealed the object, never what the client claimed.
create table public.eup_media_uploads (
  id uuid primary key default gen_random_uuid(),
  tenant uuid not null,
  assignment_id uuid not null,
  participant uuid not null references auth.users(id),
  kind text not null check (kind in ('audio','video')),
  mime text not null check (mime in ('audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/webm','audio/ogg','video/mp4','video/webm','video/quicktime')),
  ext text not null check (ext in ('mp3','m4a','wav','webm','ogg','mp4','mov')),
  declared_bytes integer not null check (declared_bytes between 1 and 104857600),
  max_bytes integer not null check (max_bytes between 1 and 104857600),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 3600),
  state text not null default 'staged' check (state in ('staged','sealed','rejected','discarded','expired','purged')),
  -- Inspection is not malware scanning, and every surface says so.
  scan_state text not null default 'not_scanned' check (scan_state in ('not_scanned')),
  expires_at timestamptz not null,
  bytes integer check (bytes is null or bytes between 1 and 104857600),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  family text check (family is null or family in ('mpeg','iso_bmff','riff_wave','ebml','ogg')),
  rejected_reason text check (rejected_reason is null or rejected_reason in ('empty','too_large','size_mismatch','unrecognised','family_mismatch')),
  storage_object_id uuid,
  storage_etag text check (storage_etag is null or length(storage_etag) between 1 and 200),
  storage_size integer check (storage_size is null or storage_size between 1 and 104857600),
  sealed_at timestamptz,
  discarded_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant, assignment_id) references public.eup_assignments(tenant, id),
  unique (tenant, id),
  check (state <> 'sealed' or (bytes is not null and sha256 is not null and family is not null and storage_object_id is not null
    and storage_etag is not null and storage_size is not null and sealed_at is not null)),
  check (state <> 'rejected' or rejected_reason is not null)
);
create index eup_media_uploads_assignment on public.eup_media_uploads (assignment_id, state);

create table public.eup_proofs (
  id uuid primary key default gen_random_uuid(),
  tenant uuid not null,
  assignment_id uuid not null unique,
  participant uuid not null references auth.users(id),
  revision integer not null default 1 check (revision between 1 and 2147483646),
  state text not null default 'submitted' check (state in ('submitted','accepted','needs_changes','rejected')),
  reviewed_revision integer,
  -- SHA-256 of the canonical manifest of the current revision: words, credits, rights, sealed media, requirements.
  asset_revision text not null check (asset_revision ~ '^[0-9a-f]{64}$'),
  moderation_state text not null default 'clear' check (moderation_state in ('clear','held')),
  publication_state text not null default 'private' check (publication_state in ('private','published_released_audience','withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant, assignment_id) references public.eup_assignments(tenant, id),
  unique (tenant, id)
);
create table public.eup_proof_revisions (
  proof_id uuid not null,
  revision integer not null,
  tenant uuid not null,
  requirements_revision integer not null,
  asset_revision text not null check (asset_revision ~ '^[0-9a-f]{64}$'),
  document jsonb not null,
  actor uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (proof_id, revision),
  foreign key (tenant, proof_id) references public.eup_proofs(tenant, id)
);
-- The sealed files one proof revision lists, in submitted order, with the values copied from the sealed row.
create table public.eup_proof_media (
  proof_id uuid not null,
  proof_revision integer not null,
  ordinal integer not null check (ordinal between 1 and 3),
  tenant uuid not null,
  upload_id uuid not null,
  kind text not null check (kind in ('audio','video')),
  mime text not null,
  bytes integer not null check (bytes between 1 and 104857600),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  primary key (proof_id, proof_revision, ordinal),
  unique (proof_id, proof_revision, upload_id),
  foreign key (proof_id, proof_revision) references public.eup_proof_revisions(proof_id, revision),
  foreign key (tenant, upload_id) references public.eup_media_uploads(tenant, id)
);
create index eup_proof_media_upload on public.eup_proof_media (upload_id);
-- Three decisions and one derived outcome. The outcome cannot contradict them: the CHECK is the derivation.
create table public.eup_proof_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant uuid not null,
  proof_id uuid not null,
  proof_revision integer not null,
  asset_revision text not null check (asset_revision ~ '^[0-9a-f]{64}$'),
  reviewer uuid not null references auth.users(id),
  mission_decision text not null check (mission_decision in ('pass','changes','fail')),
  rights_decision text not null check (rights_decision in ('pass','changes','fail')),
  safety_decision text not null check (safety_decision in ('pass','changes','fail')),
  decision text not null check (decision in ('accepted','needs_changes','rejected')),
  rubric jsonb not null default '[]'::jsonb,
  reason text check (reason is null or length(reason) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (proof_id, proof_revision) references public.eup_proof_revisions(proof_id, revision),
  check (decision = case when 'fail' in (mission_decision, rights_decision, safety_decision) then 'rejected'
    when mission_decision = 'pass' and rights_decision = 'pass' and safety_decision = 'pass' then 'accepted' else 'needs_changes' end)
);
create index eup_proof_reviews_proof on public.eup_proof_reviews (proof_id, created_at);

-- One row per completed assignment. Deliberately no column for points, publication, consent, media or
-- accommodation: a private proof and an accommodation proof earn the identical credit.
create table public.eup_mission_credits (
  id uuid primary key default gen_random_uuid(),
  tenant uuid not null,
  campaign_id uuid not null,
  mission_id uuid not null,
  assignment_id uuid not null unique,
  participant uuid not null references auth.users(id),
  proof_id uuid not null,
  proof_revision integer not null,
  asset_revision text not null check (asset_revision ~ '^[0-9a-f]{64}$'),
  review_id uuid not null references public.eup_proof_reviews(id),
  kind text not null default 'mission_completion' check (kind = 'mission_completion'),
  created_at timestamptz not null default now(),
  foreign key (tenant, campaign_id) references public.eup_campaigns(tenant, id),
  foreign key (tenant, mission_id) references public.eup_missions(tenant, id),
  foreign key (tenant, assignment_id) references public.eup_assignments(tenant, id),
  foreign key (proof_id, proof_revision) references public.eup_proof_revisions(proof_id, revision)
);
create index eup_mission_credits_mission on public.eup_mission_credits (mission_id, created_at);

-- A consent names its exact scope: tenant, mission, assignment, proof, proof revision, asset revision, purpose,
-- audience and notice revision. Only two (purpose, audience) pairs exist. State is derived, never stored:
-- revoked, superseded, expired (open and past expires_at), open.
create table public.eup_consents (
  id uuid primary key default gen_random_uuid(),
  tenant uuid not null,
  mission_id uuid not null,
  assignment_id uuid not null,
  proof_id uuid not null,
  proof_revision integer not null,
  asset_revision text not null check (asset_revision ~ '^[0-9a-f]{64}$'),
  actor uuid not null references auth.users(id),
  purpose text not null check (purpose in ('private_review','publish_proof')),
  audience text not null check (audience in ('reviewers','released_audience')),
  notice_revision text not null check (notice_revision ~ '^[A-Za-z0-9._:-]{1,64}$'),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  superseded_at timestamptz,
  foreign key (tenant, mission_id) references public.eup_missions(tenant, id),
  foreign key (tenant, assignment_id) references public.eup_assignments(tenant, id),
  foreign key (tenant, proof_id) references public.eup_proofs(tenant, id),
  foreign key (proof_id, proof_revision) references public.eup_proof_revisions(proof_id, revision),
  check ((purpose = 'private_review' and audience = 'reviewers') or (purpose = 'publish_proof' and audience = 'released_audience')),
  check (purpose <> 'publish_proof' or expires_at is not null),
  check ((revoked_at is null) = (revoked_by is null)),
  check (revoked_at is null or superseded_at is null)
);
create unique index eup_consents_one_open_publish on public.eup_consents (proof_id) where purpose = 'publish_proof' and revoked_at is null and superseded_at is null;
create index eup_consents_proof on public.eup_consents (proof_id, proof_revision);
create index eup_consents_assignment on public.eup_consents (assignment_id);

-- Idempotency receipts, keyed (tenant, actor, operation, idempotency_key); operation is the action name.
-- NOT behind the module guard trigger: an exact replay answers in every module state, and a receipt is only
-- ever written by a command that already passed its guard.
create table public.eup_command_receipts (
  tenant uuid not null references public.orgs(id),
  actor uuid not null references auth.users(id),
  surface text not null check (surface in ('owner','member','media')),
  operation text not null check (operation ~ '^[a-z][a-z0-9_.]{2,63}$'),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant, actor, operation, idempotency_key)
);

-- Private tables: RLS on with no policy, nothing for anon or authenticated, and for service_role only what the
-- functions below use (they are SECURITY INVOKER). History tables are append-only by privilege. Every League
-- domain table takes the module guard as a statement trigger, so a direct table write obeys the module state too.
do $$
declare
  v_mutable text[] := array['eup_league_policy','eup_campaigns','eup_campaign_audience_grants','eup_missions','eup_applications',
    'eup_assignments','eup_proof_drafts','eup_media_uploads','eup_proofs','eup_consents'];
  v_append_only text[] := array['eup_league_policy_revisions','eup_campaign_revisions','eup_mission_revisions','eup_application_decisions',
    'eup_assignment_acceptances','eup_proof_revisions','eup_proof_media','eup_proof_reviews','eup_mission_credits'];
  v_table text;
begin
  foreach v_table in array v_mutable || v_append_only || array['eup_command_receipts'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_table);
    execute format('grant select, insert on public.%I to service_role', v_table);
  end loop;
  foreach v_table in array v_mutable loop
    execute format('grant update on public.%I to service_role', v_table);
  end loop;
  foreach v_table in array v_mutable || v_append_only loop
    execute format('create trigger %I before insert or update or delete on public.%I for each statement execute function public.eup_module_guard_trigger(%L)',
      v_table || '_module_policy', v_table, 'league');
  end loop;
end $$;

-- The contract values this file needs, embedded once: document specs, patterns, text rules, limits, the media
-- table, template rules and the action table (kind, guard class, document, revision floor, gates).
-- GENERATED from workers/mccluster/src/eup/league-contract.js by leagueContractSql() in
-- scripts/test/support/eup-league-database.mjs; do not edit by hand. The integration test compares it with the
-- contract, so the two cannot drift silently. p_path selects a part ('{}' is everything).
create function public.eup_league_contract(p_path text[] default '{}') returns jsonb
language plpgsql immutable security invoker set search_path = '' as $contract$
begin
  return ('{
"contract":"eup.league.contract/v1",
"module":"league",
"manifest_schema":"eup.league.proof-manifest/v1",
"patterns":{"uuid":"^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$","idempotency_key":"^[A-Za-z0-9._:-]{8,128}$","slug":"^[a-z0-9][a-z0-9-]{1,79}$","sha256":"^[0-9a-f]{64}$","notice_revision":"^[A-Za-z0-9._:-]{1,64}$","rubric_id":"^[a-z0-9][a-z0-9_-]{0,39}$","consumer":"^[a-z0-9][a-z0-9_-]{0,63}$","operation":"^[a-z][a-z0-9_.]{2,63}$","outbox_seq":"^[1-9][0-9]{0,17}$","query_integer":"^(0|[1-9][0-9]{0,9})$","timestamp":"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?Z$"},
"text_rules":{"text":"[\\u0000-\\u001f\\u007f]","multiline":"[\\u0000-\\u0008\\u000b-\\u001f\\u007f]"},
"limits":{"body_max_bytes":65536,"document_max_bytes":49152,"revision_max":2147483646,"idempotency_key":"^[A-Za-z0-9._:-]{8,128}$","text":{"title":180,"purpose":2000,"requirements":4000,"acceptance":4000,"rubric_label":200,"statement":4000,"reason":2000,"note":500,"policy_reason":500,"notice_text":8000,"lyrics":10000,"credit_name":120,"credit_role":80,"derivative_permissions":2000,"etag":200},"count":{"proof_modes":5,"rubric_criteria":12,"credits":24,"proof_media":3,"capacity":100000},"list":{"campaigns":200,"rows":500,"outbox":200,"purge_batch":50},"rate":{"applications_open_per_actor":10,"application_saves_per_application":200,"draft_saves_per_assignment":5000,"uploads_staged_per_assignment":3,"uploads_total_per_assignment":30,"proof_revisions_per_assignment":20,"appeals_per_subject":2},"policy":{"bytes":[1,104857600],"duration_seconds":[1,3600],"retention_days":[1,3650]},"consent_max_days":366},
"requirements_fields":["title","requirements","acceptance","proof_modes","rubric"],
"releasable_templates":["write-a-song"],
"template_rules":{"write-a-song":{"modes_allowed":["audio","video","lyrics"],"modes_required":["lyrics"],"modes_any_of":["audio","video"]}},
"media":{"types":{"audio/mpeg":{"kind":"audio","ext":"mp3","families":["mpeg"]},"audio/mp4":{"kind":"audio","ext":"m4a","families":["iso_bmff"]},"audio/x-m4a":{"kind":"audio","ext":"m4a","families":["iso_bmff"]},"audio/wav":{"kind":"audio","ext":"wav","families":["riff_wave"]},"audio/webm":{"kind":"audio","ext":"webm","families":["ebml"]},"audio/ogg":{"kind":"audio","ext":"ogg","families":["ogg"]},"video/mp4":{"kind":"video","ext":"mp4","families":["iso_bmff"]},"video/webm":{"kind":"video","ext":"webm","families":["ebml"]},"video/quicktime":{"kind":"video","ext":"mov","families":["iso_bmff"]}},"hard_max_bytes":104857600,"staged_ttl_seconds":86400},
"actions":{
 "owner":{
  "overview":{"kind":"read","guard":"none"},
  "policy.get":{"kind":"read","guard":"none"},
  "campaigns.list":{"kind":"read","guard":"none"},
  "audience.grants.list":{"kind":"read","guard":"none","id":"campaign"},
  "missions.list":{"kind":"read","guard":"none","id":"campaign","id_optional":true},
  "missions.preview":{"kind":"read","guard":"none","id":"mission"},
  "applications.list":{"kind":"read","guard":"none","id":"mission","id_optional":true,"document":"applications_filter"},
  "applications.accommodation.get":{"kind":"read","guard":"none","id":"application"},
  "assignments.list":{"kind":"read","guard":"none","id":"mission","id_optional":true},
  "proofs.list":{"kind":"read","guard":"none","id":"assignment","id_optional":true,"document":"proofs_filter"},
  "proofs.get":{"kind":"read","guard":"none","id":"proof","document":"proof_get"},
  "consents.list":{"kind":"read","guard":"none","id":"proof","id_optional":true},
  "publications.list":{"kind":"read","guard":"none","id":"campaign","id_optional":true,"document":"publications_filter"},
  "appeals.list":{"kind":"read","guard":"none","document":"appeals_filter"},
  "credits.list":{"kind":"read","guard":"none","id":"mission","id_optional":true},
  "media.due":{"kind":"read","guard":"none","document":"media_due"},
  "outbox.list":{"kind":"read","guard":"none","document":"outbox_list"},
  "receipts.get":{"kind":"read","guard":"none","document":"receipt_get"},
  "policy.set":{"kind":"mutation","guard":"enabled","document":"policy_set","revision":"policy","revision_min":0},
  "campaigns.create":{"kind":"mutation","guard":"enabled","document":"campaign_create"},
  "campaigns.transition":{"kind":"mutation","guard":"enabled","id":"campaign","document":"transition","revision":"campaign","reduce_when":{"field":"to","values":["paused","withdrawn"]}},
  "campaigns.audience.set":{"kind":"mutation","guard":"enabled","id":"campaign","document":"audience_set","revision":"campaign"},
  "audience.grants.grant":{"kind":"mutation","guard":"enabled","id":"campaign","document":"grant"},
  "audience.grants.revoke":{"kind":"mutation","guard":"reduce","id":"grant","document":"grant_revoke"},
  "missions.create":{"kind":"mutation","guard":"enabled","id":"campaign","document":"mission_create"},
  "missions.update":{"kind":"mutation","guard":"enabled","id":"mission","document":"mission_update","revision":"mission"},
  "missions.transition":{"kind":"mutation","guard":"enabled","id":"mission","document":"transition","revision":"mission","reduce_when":{"field":"to","values":["paused","withdrawn"]}},
  "applications.create":{"kind":"mutation","guard":"enabled","id":"mission","document":"application_create"},
  "applications.decide":{"kind":"mutation","guard":"enabled","id":"application","document":"application_decide","revision":"application"},
  "proofs.review":{"kind":"mutation","guard":"enabled","id":"proof","document":"proof_review","revision":"proof"},
  "proofs.moderate":{"kind":"mutation","guard":"enabled","id":"proof","document":"proof_moderate","revision":"proof","reduce_when":{"field":"hold","values":[true]}},
  "publications.decide":{"kind":"mutation","guard":"enabled","id":"proof","document":"publication_decide","revision":"proof","reduce_when":{"field":"decision","values":["withdrawn"]}},
  "appeals.resolve":{"kind":"mutation","guard":"enabled","id":"appeal","document":"appeal_resolve"},
  "media.purged":{"kind":"mutation","guard":"reduce","document":"media_purged"},
  "outbox.ack":{"kind":"mutation","guard":"enabled","id":"outbox_seq","document":"outbox_ack"}
 },
 "member":{
  "me.get":{"kind":"read","guard":"none","gates":[]},
  "uploads.get":{"kind":"read","guard":"none","id":"upload","document":"upload_get","gates":["ownership"]},
  "receipts.get":{"kind":"read","guard":"none","document":"receipt_get","gates":[]},
  "applications.save":{"kind":"mutation","guard":"enabled","id":"mission","document":"application_save","revision":"application","revision_min":0,"gates":["audience","ownership","readiness","entitlement"]},
  "applications.withdraw":{"kind":"mutation","guard":"reduce","id":"application","document":"empty","gates":["ownership"]},
  "assignments.accept":{"kind":"mutation","guard":"enabled","id":"assignment","document":"assignment_accept","revision":"assignment","gates":["audience","ownership","readiness","entitlement"]},
  "assignments.withdraw":{"kind":"mutation","guard":"reduce","id":"assignment","document":"empty","gates":["ownership"]},
  "drafts.save":{"kind":"mutation","guard":"enabled","id":"assignment","document":"draft_save","revision":"draft","revision_min":0,"gates":["audience","ownership","readiness","entitlement"]},
  "uploads.begin":{"kind":"mutation","guard":"enabled","id":"assignment","document":"upload_begin","gates":["audience","ownership","readiness","entitlement","media"]},
  "uploads.discard":{"kind":"mutation","guard":"reduce","id":"upload","document":"empty","gates":["ownership"]},
  "proofs.submit":{"kind":"mutation","guard":"enabled","id":"assignment","document":"proof_submit","revision":"proof","revision_min":0,"gates":["audience","ownership","readiness","entitlement"]},
  "consents.grant":{"kind":"mutation","guard":"enabled","id":"proof","document":"consent_grant","revision":"proof","gates":["audience","ownership","readiness","entitlement"]},
  "consents.revoke":{"kind":"mutation","guard":"reduce","id":"consent","document":"empty","gates":["ownership"]},
  "appeals.open":{"kind":"mutation","guard":"enabled","id":"subject","document":"appeal_open","gates":["audience","ownership","readiness","entitlement"]},
  "appeals.withdraw":{"kind":"mutation","guard":"reduce","id":"appeal","document":"empty","gates":["ownership"]}
 },
 "media":{
  "media.seal":{"kind":"mutation","guard":"enabled","id":"upload","document":"seal_result","keyed":false,"gates":["audience","ownership","readiness","entitlement","media"]}
 }
},
"documents":{
  "policy":{"type":"object","fields":{"entitlement":{"type":"enum","values":["none_required","not_decided"],"required":true},"media":{"type":"object","fields":{"enabled":{"type":"boolean","required":true},"kinds":{"type":"list","of":{"type":"enum","values":["audio","video"]},"min":1,"max":2,"unique":true,"required":false},"audio_max_bytes":{"type":"integer","min":1,"max":104857600,"required":false},"video_max_bytes":{"type":"integer","min":1,"max":104857600,"required":false},"max_duration_seconds":{"type":"integer","min":1,"max":3600,"required":false}},"rules":["media_enabled_complete"],"required":true},"retention":{"type":"object","fields":{"completed_days":{"type":"integer","min":1,"max":3650,"required":true},"withdrawn_days":{"type":"integer","min":1,"max":3650,"required":true}},"rules":[],"required":true},"notices":{"type":"object","fields":{"participation":{"type":"object","fields":{"revision":{"type":"pattern","pattern":"notice_revision","required":true},"text":{"type":"multiline","min":1,"max":8000,"required":true}},"rules":[],"required":true},"private_review":{"type":"object","fields":{"revision":{"type":"pattern","pattern":"notice_revision","required":true},"text":{"type":"multiline","min":1,"max":8000,"required":true}},"rules":[],"required":true},"publication":{"type":"object","fields":{"revision":{"type":"pattern","pattern":"notice_revision","required":true},"text":{"type":"multiline","min":1,"max":8000,"required":true}},"rules":[],"required":true}},"rules":[],"required":true}},"rules":[]},
  "policy_set":{"type":"object","fields":{"policy":{"type":"object","fields":{"entitlement":{"type":"enum","values":["none_required","not_decided"],"required":true},"media":{"type":"object","fields":{"enabled":{"type":"boolean","required":true},"kinds":{"type":"list","of":{"type":"enum","values":["audio","video"]},"min":1,"max":2,"unique":true,"required":false},"audio_max_bytes":{"type":"integer","min":1,"max":104857600,"required":false},"video_max_bytes":{"type":"integer","min":1,"max":104857600,"required":false},"max_duration_seconds":{"type":"integer","min":1,"max":3600,"required":false}},"rules":["media_enabled_complete"],"required":true},"retention":{"type":"object","fields":{"completed_days":{"type":"integer","min":1,"max":3650,"required":true},"withdrawn_days":{"type":"integer","min":1,"max":3650,"required":true}},"rules":[],"required":true},"notices":{"type":"object","fields":{"participation":{"type":"object","fields":{"revision":{"type":"pattern","pattern":"notice_revision","required":true},"text":{"type":"multiline","min":1,"max":8000,"required":true}},"rules":[],"required":true},"private_review":{"type":"object","fields":{"revision":{"type":"pattern","pattern":"notice_revision","required":true},"text":{"type":"multiline","min":1,"max":8000,"required":true}},"rules":[],"required":true},"publication":{"type":"object","fields":{"revision":{"type":"pattern","pattern":"notice_revision","required":true},"text":{"type":"multiline","min":1,"max":8000,"required":true}},"rules":[],"required":true}},"rules":[],"required":true}},"rules":[],"required":true},"reason":{"type":"text","min":1,"max":500,"required":true}},"rules":[]},
  "campaign_create":{"type":"object","fields":{"slug":{"type":"pattern","pattern":"slug","required":true},"title":{"type":"text","min":1,"max":180,"required":true},"purpose":{"type":"multiline","min":1,"max":2000,"required":true},"audience":{"type":"enum","values":["admin_preview"],"required":false}},"rules":[]},
  "transition":{"type":"object","fields":{"to":{"type":"enum","values":["released","paused","withdrawn"],"required":true}},"rules":[]},
  "audience_set":{"type":"object","fields":{"audience":{"type":"enum","values":["admin_preview","invited"],"required":true}},"rules":[]},
  "grant":{"type":"object","fields":{"account":{"type":"uuid","required":true},"note":{"type":"text","min":1,"max":500,"required":false}},"rules":[]},
  "grant_revoke":{"type":"object","fields":{"reason":{"type":"text","min":1,"max":500,"required":false}},"rules":[]},
  "mission_create":{"type":"object","fields":{"slug":{"type":"pattern","pattern":"slug","required":true},"title":{"type":"text","min":1,"max":180,"required":true},"template":{"type":"enum","values":["write-a-song","explain-a-source","map-a-community-resource","understand-a-policy","community-action-session"],"required":true},"proof_modes":{"type":"list","of":{"type":"enum","values":["audio","video","lyrics","text","link"]},"min":1,"max":5,"unique":true,"required":true},"capacity":{"type":"integer","min":1,"max":100000,"nullable":true,"required":false},"requirements":{"type":"multiline","min":1,"max":4000,"required":true},"acceptance":{"type":"multiline","min":1,"max":4000,"required":false},"rubric":{"type":"object","fields":{"application":{"type":"list","of":{"type":"object","fields":{"id":{"type":"pattern","pattern":"rubric_id","required":true},"label":{"type":"text","min":1,"max":200,"required":true}},"rules":[]},"min":0,"max":12,"unique":false,"required":false},"proof":{"type":"list","of":{"type":"object","fields":{"id":{"type":"pattern","pattern":"rubric_id","required":true},"label":{"type":"text","min":1,"max":200,"required":true}},"rules":[]},"min":0,"max":12,"unique":false,"required":false}},"rules":["rubric_ids_unique"],"required":false}},"rules":["template_modes"]},
  "mission_update":{"type":"object","fields":{"title":{"type":"text","min":1,"max":180,"required":false},"proof_modes":{"type":"list","of":{"type":"enum","values":["audio","video","lyrics","text","link"]},"min":1,"max":5,"unique":true,"required":false},"capacity":{"type":"integer","min":1,"max":100000,"nullable":true,"required":false},"requirements":{"type":"multiline","min":1,"max":4000,"required":false},"acceptance":{"type":"multiline","min":1,"max":4000,"required":false},"rubric":{"type":"object","fields":{"application":{"type":"list","of":{"type":"object","fields":{"id":{"type":"pattern","pattern":"rubric_id","required":true},"label":{"type":"text","min":1,"max":200,"required":true}},"rules":[]},"min":0,"max":12,"unique":false,"required":false},"proof":{"type":"list","of":{"type":"object","fields":{"id":{"type":"pattern","pattern":"rubric_id","required":true},"label":{"type":"text","min":1,"max":200,"required":true}},"rules":[]},"min":0,"max":12,"unique":false,"required":false}},"rules":["rubric_ids_unique"],"required":false}},"rules":["at_least_one_field"]},
  "application_create":{"type":"object","fields":{"applicant":{"type":"uuid","required":true},"requirements_revision":{"type":"integer","min":1,"max":2147483646,"required":true},"statement":{"type":"multiline","min":1,"max":4000,"required":true},"accommodation":{"type":"object","fields":{"statement":{"type":"multiline","min":1,"max":4000,"required":true}},"rules":[],"required":false}},"rules":[]},
  "application_save":{"type":"object","fields":{"submit":{"type":"boolean","required":true},"requirements_revision":{"type":"integer","min":1,"max":2147483646,"required":true},"statement":{"type":"multiline","min":0,"max":4000,"required":false},"accommodation":{"type":"object","fields":{"statement":{"type":"multiline","min":1,"max":4000,"required":true}},"rules":[],"nullable":true,"required":false}},"rules":["submit_complete"]},
  "application_decide":{"type":"object","fields":{"decision":{"type":"enum","values":["approved","declined","changes_requested"],"required":true},"reason":{"type":"multiline","min":1,"max":2000,"required":false},"rubric":{"type":"list","of":{"type":"object","fields":{"id":{"type":"pattern","pattern":"rubric_id","required":true},"met":{"type":"boolean","required":true},"note":{"type":"text","min":1,"max":500,"required":false}},"rules":[]},"min":0,"max":12,"unique":false,"required":false}},"rules":["reason_unless_approved","answers_unique"]},
  "applications_filter":{"type":"object","fields":{"status":{"type":"enum","values":["draft","submitted","changes_requested","approved","declined","withdrawn"],"required":false}},"rules":[]},
  "assignment_accept":{"type":"object","fields":{"requirements_revision":{"type":"integer","min":1,"max":2147483646,"required":true},"notice_revision":{"type":"pattern","pattern":"notice_revision","required":true}},"rules":[]},
  "draft_save":{"type":"object","fields":{"title":{"type":"text","min":0,"max":180,"required":false},"lyrics":{"type":"multiline","min":0,"max":10000,"required":false},"credits":{"type":"list","of":{"type":"object","fields":{"name":{"type":"text","min":0,"max":120,"required":true},"role":{"type":"text","min":0,"max":80,"required":true}},"rules":[]},"min":0,"max":24,"unique":false,"required":false},"rights":{"type":"object","fields":{"version":{"type":"enum","values":["music-rights-v1"],"required":false},"owns_master":{"type":"boolean","required":false},"controls_composition":{"type":"boolean","required":false},"samples_cleared":{"type":"boolean","required":false},"collaborators_cleared":{"type":"boolean","required":false},"parody_or_derivative":{"type":"boolean","required":false},"derivative_permissions":{"type":"multiline","min":0,"max":2000,"required":false}},"rules":[],"required":false},"media":{"type":"list","of":{"type":"uuid"},"min":0,"max":3,"unique":true,"required":false},"accommodation":{"type":"object","fields":{"statement":{"type":"multiline","min":0,"max":4000,"required":true}},"rules":[],"nullable":true,"required":false}},"rules":[]},
  "upload_begin":{"type":"object","fields":{"kind":{"type":"enum","values":["audio","video"],"required":true},"mime":{"type":"enum","values":["audio/mpeg","audio/mp4","audio/x-m4a","audio/wav","audio/webm","audio/ogg","video/mp4","video/webm","video/quicktime"],"required":true},"bytes":{"type":"integer","min":1,"max":104857600,"required":true},"duration_seconds":{"type":"integer","min":1,"max":3600,"required":false}},"rules":["mime_matches_kind"]},
  "upload_get":{"type":"object","fields":{"sign":{"type":"boolean","required":false}},"rules":[]},
  "seal_result":{"type":"union","on":"outcome","variants":{"sealed":{"type":"object","fields":{"outcome":{"type":"enum","values":["sealed"],"required":true},"bytes":{"type":"integer","min":1,"max":104857600,"required":true},"sha256":{"type":"sha256","required":true},"family":{"type":"enum","values":["mpeg","iso_bmff","riff_wave","ebml","ogg"],"required":true},"storage":{"type":"object","fields":{"object_id":{"type":"uuid","required":true},"etag":{"type":"text","min":1,"max":200,"required":true},"size":{"type":"integer","min":1,"max":104857600,"required":true}},"rules":[],"required":true}},"rules":["sealed_size_agrees"]},"rejected":{"type":"object","fields":{"outcome":{"type":"enum","values":["rejected"],"required":true},"reason":{"type":"enum","values":["empty","too_large","size_mismatch","unrecognised","family_mismatch"],"required":true}},"rules":[]}}},
  "proof_submit":{"type":"object","fields":{"title":{"type":"text","min":1,"max":180,"required":true},"lyrics":{"type":"multiline","min":1,"max":10000,"required":true},"credits":{"type":"list","of":{"type":"object","fields":{"name":{"type":"text","min":1,"max":120,"required":true},"role":{"type":"text","min":1,"max":80,"required":true}},"rules":[]},"min":1,"max":24,"unique":false,"required":true},"rights":{"type":"object","fields":{"version":{"type":"enum","values":["music-rights-v1"],"required":true},"owns_master":{"type":"boolean","required":true},"controls_composition":{"type":"boolean","required":true},"samples_cleared":{"type":"boolean","required":true},"collaborators_cleared":{"type":"boolean","required":true},"parody_or_derivative":{"type":"boolean","required":true},"derivative_permissions":{"type":"multiline","min":0,"max":2000,"required":true}},"rules":["derivative_permissions"],"required":true},"media":{"type":"list","of":{"type":"object","fields":{"upload_id":{"type":"uuid","required":true},"sha256":{"type":"sha256","required":true}},"rules":[]},"min":1,"max":3,"unique":false,"required":false},"accommodation":{"type":"object","fields":{"statement":{"type":"multiline","min":1,"max":4000,"required":true}},"rules":[],"required":false},"review_notice_revision":{"type":"pattern","pattern":"notice_revision","required":true}},"rules":["media_xor_accommodation","uploads_unique"]},
  "proofs_filter":{"type":"object","fields":{"state":{"type":"enum","values":["submitted","accepted","needs_changes","rejected"],"required":false}},"rules":[]},
  "proof_get":{"type":"object","fields":{"revision":{"type":"integer","min":1,"max":2147483646,"required":true},"media":{"type":"boolean","required":false}},"rules":[]},
  "proof_review":{"type":"object","fields":{"asset_revision":{"type":"sha256","required":true},"mission_decision":{"type":"enum","values":["pass","changes","fail"],"required":true},"rights_decision":{"type":"enum","values":["pass","changes","fail"],"required":true},"safety_decision":{"type":"enum","values":["pass","changes","fail"],"required":true},"rubric":{"type":"list","of":{"type":"object","fields":{"id":{"type":"pattern","pattern":"rubric_id","required":true},"met":{"type":"boolean","required":true},"note":{"type":"text","min":1,"max":500,"required":false}},"rules":[]},"min":0,"max":12,"unique":false,"required":false},"reason":{"type":"multiline","min":1,"max":2000,"required":false}},"rules":["reason_unless_all_pass","answers_unique"]},
  "proof_moderate":{"type":"object","fields":{"hold":{"type":"boolean","required":true},"reason":{"type":"multiline","min":1,"max":2000,"required":true}},"rules":[]},
  "consent_grant":{"type":"object","fields":{"purpose":{"type":"enum","values":["publish_proof"],"required":true},"audience":{"type":"enum","values":["released_audience"],"required":true},"asset_revision":{"type":"sha256","required":true},"notice_revision":{"type":"pattern","pattern":"notice_revision","required":true},"expires_at":{"type":"timestamp","required":true}},"rules":[]},
  "publications_filter":{"type":"object","fields":{"state":{"type":"enum","values":["published","withdrawn"],"required":false}},"rules":[]},
  "publication_decide":{"type":"object","fields":{"decision":{"type":"enum","values":["published","withdrawn"],"required":true},"consent_id":{"type":"uuid","required":false},"reason":{"type":"text","min":1,"max":500,"required":false}},"rules":["consent_when_published"]},
  "appeal_open":{"type":"object","fields":{"subject":{"type":"enum","values":["application","proof"],"required":true},"statement":{"type":"multiline","min":1,"max":4000,"required":true}},"rules":[]},
  "appeals_filter":{"type":"object","fields":{"state":{"type":"enum","values":["open","withdrawn","upheld","overturned"],"required":false}},"rules":[]},
  "appeal_resolve":{"type":"object","fields":{"outcome":{"type":"enum","values":["upheld","overturned"],"required":true},"reason":{"type":"multiline","min":1,"max":2000,"required":true}},"rules":[]},
  "media_due":{"type":"object","fields":{"uploads":{"type":"list","of":{"type":"uuid"},"min":1,"max":50,"unique":true,"required":false},"limit":{"type":"integer","min":1,"max":50,"required":false}},"rules":[]},
  "media_purged":{"type":"object","fields":{"uploads":{"type":"list","of":{"type":"uuid"},"min":1,"max":50,"unique":true,"required":true}},"rules":[]},
  "outbox_list":{"type":"object","fields":{"after":{"type":"integer","min":0,"max":9007199254740991,"required":false},"limit":{"type":"integer","min":1,"max":200,"required":false},"consumer":{"type":"pattern","pattern":"consumer","required":false}},"rules":[]},
  "outbox_ack":{"type":"object","fields":{"consumer":{"type":"pattern","pattern":"consumer","required":true}},"rules":[]},
  "receipt_get":{"type":"object","fields":{"operation":{"type":"pattern","pattern":"operation","required":true},"key":{"type":"pattern","pattern":"idempotency_key","required":true}},"rules":[]},
  "empty":{"type":"object","fields":{},"rules":[]}
}
}'::jsonb) #> p_path;
end $contract$;

-- A UTC instant in the contract's wire form (RFC 3339, Z only) that is also a real calendar instant. Stricter
-- than a permissive date parser on purpose: day 30 of February, hour 24 and second 60 are refused.
create function public.eup_league_timestamp_ok(p_text text) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare v_year integer; v_month integer; v_day integer;
begin
  if p_text is null or not coalesce(p_text ~ (public.eup_league_contract('{patterns,timestamp}') #>> '{}'), false) then return false; end if;
  v_year := substr(p_text, 1, 4)::integer; v_month := substr(p_text, 6, 2)::integer; v_day := substr(p_text, 9, 2)::integer;
  if v_year < 1 or v_month not between 1 and 12 or v_day < 1 or substr(p_text, 12, 2)::integer > 23
     or substr(p_text, 15, 2)::integer > 59 or substr(p_text, 18, 2)::integer > 59 then return false; end if;
  return v_day <= case when v_month in (4, 6, 9, 11) then 30 when v_month <> 2 then 31
    when (v_year % 4 = 0 and v_year % 100 <> 0) or v_year % 400 = 0 then 29 else 28 end;
end $$;

-- One line of text: a string of minlen..maxlen code points with no control character (U+0000..U+001F, U+007F).
create function public.eup_league_text_ok(v jsonb, minlen integer, maxlen integer) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select coalesce(jsonb_typeof(v) = 'string' and length(v #>> '{}') between minlen and maxlen
    and not ((v #>> '{}') ~ (public.eup_league_contract('{text_rules,text}') #>> '{}')), false)
$$;
-- Several lines: the same, except LINE FEED and TAB are allowed. Carriage return is refused, so one lyric has one
-- byte form and one digest. Text is stored exactly as sent: no trimming, no Unicode normalisation.
create function public.eup_league_multiline_ok(v jsonb, minlen integer, maxlen integer) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select coalesce(jsonb_typeof(v) = 'string' and length(v #>> '{}') between minlen and maxlen
    and not ((v #>> '{}') ~ (public.eup_league_contract('{text_rules,multiline}') #>> '{}')), false)
$$;

-- The cross-field rules of the contract (RULES), by name. An unknown rule refuses.
create function public.eup_league_rule(p_rule text, v jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare v_row jsonb; v_name text;
begin
  case p_rule
    when 'media_enabled_complete' then
      if (v -> 'enabled') is distinct from 'true'::jsonb then return true; end if;
      if jsonb_typeof(v -> 'kinds') is distinct from 'array' or not (v ? 'max_duration_seconds') then return false; end if;
      return not exists (select 1 from jsonb_array_elements_text(v -> 'kinds') e where not (v ? (e || '_max_bytes')));
    when 'template_modes' then
      v_row := public.eup_league_contract(array['template_rules', coalesce(v ->> 'template', '')]);
      if v_row is null or jsonb_typeof(v -> 'proof_modes') is distinct from 'array' then return true; end if;
      return not exists (select 1 from jsonb_array_elements_text(v -> 'proof_modes') e where not ((v_row -> 'modes_allowed') ? e))
        and not exists (select 1 from jsonb_array_elements_text(v_row -> 'modes_required') e where not ((v -> 'proof_modes') ? e))
        and exists (select 1 from jsonb_array_elements_text(v_row -> 'modes_any_of') e where (v -> 'proof_modes') ? e);
    when 'rubric_ids_unique' then
      foreach v_name in array array['application', 'proof'] loop
        if jsonb_typeof(v -> v_name) = 'array' then
          if (select count(*) <> count(distinct coalesce(e ->> 'id', '')) from jsonb_array_elements(v -> v_name) e) then return false; end if;
        end if;
      end loop;
      return true;
    when 'answers_unique' then
      if jsonb_typeof(v -> 'rubric') is distinct from 'array' then return true; end if;
      return (select count(*) = count(distinct coalesce(e ->> 'id', '')) from jsonb_array_elements(v -> 'rubric') e);
    when 'at_least_one_field' then
      return coalesce(jsonb_typeof(v) = 'object' and v <> '{}'::jsonb, false);
    when 'submit_complete' then
      if (v -> 'submit') is distinct from 'true'::jsonb then return true; end if;
      return coalesce(jsonb_typeof(v -> 'statement') = 'string' and length(v ->> 'statement') > 0, false);
    when 'reason_unless_approved' then
      return coalesce(jsonb_typeof(v -> 'decision') = 'string' and (v ->> 'decision') = 'approved', false) or coalesce(jsonb_typeof(v -> 'reason') = 'string', false);
    when 'reason_unless_all_pass' then
      return coalesce((v ->> 'mission_decision') = 'pass' and (v ->> 'rights_decision') = 'pass' and (v ->> 'safety_decision') = 'pass', false)
        or coalesce(jsonb_typeof(v -> 'reason') = 'string', false);
    when 'media_xor_accommodation' then
      return coalesce((v ? 'media') <> (v ? 'accommodation'), false);
    when 'uploads_unique' then
      if jsonb_typeof(v -> 'media') is distinct from 'array' then return true; end if;
      return (select count(*) = count(distinct lower(coalesce(e ->> 'upload_id', ''))) from jsonb_array_elements(v -> 'media') e);
    when 'derivative_permissions' then
      if (v -> 'parody_or_derivative') is distinct from 'true'::jsonb then return true; end if;
      return coalesce(jsonb_typeof(v -> 'derivative_permissions') = 'string' and length(v ->> 'derivative_permissions') > 0, false);
    when 'mime_matches_kind' then
      if jsonb_typeof(v -> 'mime') is distinct from 'string' then return true; end if;
      v_row := public.eup_league_contract(array['media', 'types', v ->> 'mime']);
      if v_row is null then return true; end if;
      return coalesce(jsonb_typeof(v -> 'kind') = 'string' and (v_row ->> 'kind') = (v ->> 'kind'), false);
    when 'consent_when_published' then
      if coalesce(jsonb_typeof(v -> 'decision') = 'string' and (v ->> 'decision') = 'published', false) then return v ? 'consent_id'; end if;
      return coalesce(jsonb_typeof(v -> 'reason') = 'string', false);
    when 'sealed_size_agrees' then
      if jsonb_typeof(v -> 'bytes') is distinct from 'number' or jsonb_typeof(v #> '{storage,size}') is distinct from 'number' then return false; end if;
      return (v ->> 'bytes')::numeric = (v #>> '{storage,size}')::numeric;
    else
      return false;
  end case;
end $$;

-- The document checker of the contract (checkDocument), driven by the embedded spec: null when p_value satisfies
-- p_spec, otherwise 'path: problem'. Objects are CLOSED: a key the spec does not list is refused. That one rule is
-- what keeps account-naming, location, points and payment keys out of every document. Every branch is written
-- "valid only when proven": a missing bound or pattern refuses instead of letting a value through.
create function public.eup_league_check(p_spec jsonb, p_value jsonb, p_path text default '$') returns text
language plpgsql immutable security invoker set search_path = '' as $$
declare
  v_type text := p_spec ->> 'type';
  v_kind text := jsonb_typeof(p_value);
  v_text text; v_num numeric; v_key text; v_item jsonb; v_problem text; v_index integer := 0;
begin
  if p_spec is null or v_type is null then return format('%s: unknown spec', p_path); end if;
  if p_value is null then return format('%s: required', p_path); end if;
  if v_kind = 'null' then
    if (p_spec -> 'nullable') is not distinct from 'true'::jsonb then return null; end if;
    return format('%s: null not allowed', p_path);
  end if;
  if v_kind = 'string' then v_text := p_value #>> '{}'; end if;
  case v_type
    when 'uuid' then
      if v_kind = 'string' and coalesce(v_text ~* (public.eup_league_contract('{patterns,uuid}') #>> '{}'), false) then return null; end if;
      return format('%s: uuid expected', p_path);
    when 'boolean' then
      if v_kind = 'boolean' then return null; end if;
      return format('%s: boolean expected', p_path);
    when 'sha256' then
      if v_kind = 'string' and coalesce(v_text ~ (public.eup_league_contract('{patterns,sha256}') #>> '{}'), false) then return null; end if;
      return format('%s: lower-case sha256 hex expected', p_path);
    when 'timestamp' then
      if v_kind = 'string' and public.eup_league_timestamp_ok(v_text) then return null; end if;
      return format('%s: UTC timestamp expected', p_path);
    when 'pattern' then
      if v_kind = 'string' and coalesce(v_text ~ (public.eup_league_contract(array['patterns', p_spec ->> 'pattern']) #>> '{}'), false) then return null; end if;
      return format('%s: %s expected', p_path, p_spec ->> 'pattern');
    when 'enum' then
      if v_kind = 'string' and coalesce((p_spec -> 'values') ? v_text, false) then return null; end if;
      return format('%s: one of %s expected', p_path, (select string_agg(t.e, ', ' order by t.ord) from jsonb_array_elements_text(p_spec -> 'values') with ordinality t(e, ord)));
    when 'integer' then
      if v_kind = 'number' then
        v_num := (p_value #>> '{}')::numeric;
        if coalesce(v_num = trunc(v_num) and abs(v_num) <= 9007199254740991 and v_num >= (p_spec ->> 'min')::numeric and v_num <= (p_spec ->> 'max')::numeric, false) then return null; end if;
      end if;
      return format('%s: integer %s..%s expected', p_path, p_spec ->> 'min', p_spec ->> 'max');
    when 'text', 'multiline' then
      if v_kind <> 'string' or coalesce(v_text ~ (public.eup_league_contract(array['text_rules', v_type]) #>> '{}'), true) then
        return format('%s: %s expected', p_path, v_type); end if;
      if coalesce(length(v_text) between (p_spec ->> 'min')::integer and (p_spec ->> 'max')::integer, false) then return null; end if;
      return format('%s: length %s..%s expected', p_path, p_spec ->> 'min', p_spec ->> 'max');
    when 'list' then
      if v_kind <> 'array' or not coalesce(jsonb_array_length(p_value) between (p_spec ->> 'min')::integer and (p_spec ->> 'max')::integer, false) then
        return format('%s: list of %s..%s expected', p_path, p_spec ->> 'min', p_spec ->> 'max'); end if;
      for v_item in select t.e from jsonb_array_elements(p_value) with ordinality t(e, ord) order by t.ord loop
        v_problem := public.eup_league_check(p_spec -> 'of', v_item, format('%s[%s]', p_path, v_index));
        if v_problem is not null then return v_problem; end if;
        v_index := v_index + 1;
      end loop;
      if (p_spec -> 'unique') is not distinct from 'true'::jsonb
         and exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) = 'string' group by lower(e #>> '{}') having count(*) > 1) then
        return format('%s: duplicate entry', p_path); end if;
      return null;
    when 'union' then
      if v_kind = 'object' and jsonb_typeof(p_value -> (p_spec ->> 'on')) = 'string' then
        v_item := p_spec -> 'variants' -> (p_value ->> (p_spec ->> 'on'));
        if v_item is not null then return public.eup_league_check(v_item, p_value, p_path); end if;
      end if;
      return format('%s.%s: one of %s expected', p_path, p_spec ->> 'on', (select string_agg(k, ', ') from jsonb_object_keys(p_spec -> 'variants') k));
    when 'object' then
      if v_kind <> 'object' then return format('%s: object expected', p_path); end if;
      if jsonb_typeof(p_spec -> 'fields') is distinct from 'object' then return format('%s: unknown spec', p_path); end if;
      select k into v_key from jsonb_object_keys(p_value) k where not ((p_spec -> 'fields') ? k) order by k limit 1;
      if v_key is not null then return format('%s.%s: unknown field', p_path, v_key); end if;
      for v_key, v_item in select f.key, f.value from jsonb_each(p_spec -> 'fields') f order by f.key loop
        if p_value ? v_key then
          v_problem := public.eup_league_check(v_item, p_value -> v_key, format('%s.%s', p_path, v_key));
          if v_problem is not null then return v_problem; end if;
        elsif (v_item -> 'required') is not distinct from 'true'::jsonb then
          return format('%s.%s: required', p_path, v_key);
        end if;
      end loop;
      if p_spec ? 'rules' then
        for v_key in select t.e from jsonb_array_elements_text(p_spec -> 'rules') with ordinality t(e, ord) order by t.ord loop
          if not coalesce(public.eup_league_rule(v_key, p_value), false) then return format('%s: %s', p_path, v_key); end if;
        end loop;
      end if;
      return null;
    else
      return format('%s: unknown spec', p_path);
  end case;
end $$;

-- A League policy is VALID when it satisfies the contract's policy document. Missing or invalid fails closed.
create function public.eup_league_policy_valid(p_document jsonb) returns boolean
language sql immutable security invoker set search_path = '' as $$
  select p_document is not null and public.eup_league_check(public.eup_league_contract('{documents,policy}'), p_document) is null
$$;

-- Refuses a malformed document (22023) with the path of the first problem. The message never carries a value.
create function public.eup_league_require_document(p_name text, p_document jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_problem text := public.eup_league_check(public.eup_league_contract(array['documents', p_name]), p_document);
begin
  if v_problem is not null then raise exception 'Invalid document: %', v_problem using errcode = '22023'; end if;
end $$;

-- Canonical JSON for the proof manifest, exactly as the contract (section 12) writes it: object members sorted by
-- key in byte order, arrays in order, no whitespace, strings as jsonb prints them. The manifest carries integers
-- only, so numbers print plainly. asset_revision is the SHA-256 of this text in UTF-8.
create function public.eup_league_canonical_json(v jsonb) returns text
language sql immutable security invoker set search_path = '' as $$
  select case jsonb_typeof(v)
    when 'object' then '{' || coalesce((select string_agg(to_json(e.key)::text || ':' || public.eup_league_canonical_json(e.value), ','
           order by e.key collate "C") from jsonb_each(v) e), '') || '}'
    when 'array' then '[' || coalesce((select string_agg(public.eup_league_canonical_json(e.value), ',' order by e.ordinality)
           from jsonb_array_elements(v) with ordinality e), '') || ']'
    else v::text end
$$;
create function public.eup_league_asset_revision(p_manifest jsonb) returns text
language sql immutable security invoker set search_path = '' as $$
  select encode(sha256(convert_to(public.eup_league_canonical_json(p_manifest), 'UTF8')), 'hex')
$$;

-- Whether an account exists. The ONE definer function in this file: the API role cannot read auth.users, and
-- "unknown actor" must be a clean 42501 rather than a foreign-key failure. It answers a boolean and nothing else.
create function public.eup_league_actor_known(p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_actor is not null and exists (select 1 from auth.users uu where uu.id = p_actor)
$$;
create function public.eup_league_is_owner(p_tenant uuid, p_actor uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.org_members mm where mm.org_id = p_tenant and mm.profile_id = p_actor and mm.role = 'owner')
$$;
-- Audience MEMBERSHIP of a campaign: a house owner, or an open grant on a campaign whose audience is 'invited'.
-- Whether the campaign and the mission are released is the other half of the audience gate (eup_league_gate).
create function public.eup_league_in_audience(p_tenant uuid, p_actor uuid, p_campaign uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.eup_campaigns cc where cc.id = p_campaign and cc.tenant = p_tenant
    and (public.eup_league_is_owner(p_tenant, p_actor)
      or (cc.audience = 'invited' and exists (select 1 from public.eup_campaign_audience_grants gg
            where gg.campaign_id = cc.id and gg.account = p_actor and gg.state = 'open'))))
$$;

-- The member gates after "the row exists", in the contract's order, each with its own code:
--   released audience EU011, the row is the actor's 42501, readiness EU010, entitlement EU012, media EU010.
-- p_holder is the row's applicant or participant (null when the action creates the row). Returns the policy.
create function public.eup_league_gate(p_tenant uuid, p_actor uuid, p_mission uuid, p_holder uuid, p_media boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_campaign uuid; v_campaign_state text; v_mission_state text; pol public.eup_league_policy%rowtype;
begin
  select cc.id, cc.state, mm.state into v_campaign, v_campaign_state, v_mission_state
    from public.eup_missions mm join public.eup_campaigns cc on cc.id = mm.campaign_id and cc.tenant = mm.tenant
   where mm.id = p_mission and mm.tenant = p_tenant;
  if not found or v_campaign_state <> 'released' or v_mission_state <> 'released'
     or not public.eup_league_in_audience(p_tenant, p_actor, v_campaign) then
    raise exception 'Not released to this account' using errcode = 'EU011'; end if;
  if p_holder is not null and p_holder <> p_actor then raise exception 'Not the record of this account' using errcode = '42501'; end if;
  select * into pol from public.eup_league_policy pp where pp.tenant = p_tenant;
  if not found or not public.eup_league_policy_valid(pol.document) then
    raise exception 'League policy is missing or invalid' using errcode = 'EU010'; end if;
  if (pol.document ->> 'entitlement') is distinct from 'none_required' then raise exception 'Entitlement required' using errcode = 'EU012'; end if;
  if p_media and (pol.document #> '{media,enabled}') is distinct from 'true'::jsonb then
    raise exception 'Media is not enabled' using errcode = 'EU010'; end if;
  return jsonb_build_object('revision', pol.revision, 'document', pol.document);
end $$;

-- A rubric decision answers every criterion of the mission exactly once (the document rule already refuses a
-- criterion answered twice). Returns 'incomplete', 'unmet' (complete, at least one not met) or 'met'.
create function public.eup_league_rubric_state(p_criteria jsonb, p_answers jsonb) returns text
language sql immutable security invoker set search_path = '' as $$
  with wanted as (select e ->> 'id' as id from jsonb_array_elements(case when jsonb_typeof(p_criteria) = 'array' then p_criteria else '[]'::jsonb end) e),
       given as (select e ->> 'id' as id, coalesce((e -> 'met') = 'true'::jsonb, false) as met from jsonb_array_elements(case when jsonb_typeof(p_answers) = 'array' then p_answers else '[]'::jsonb end) e)
  select case
    when (select count(*) from wanted) <> (select count(*) from given)
      or exists (select 1 from wanted w where not exists (select 1 from given g where g.id = w.id)) then 'incomplete'
    when exists (select 1 from given g where not g.met) then 'unmet'
    else 'met' end
$$;

-- ---------------------------------------------------------------- result shapes (the contract's SHAPES, by name)
create function public.eup_league_policy_json(p_tenant uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce((select jsonb_build_object('revision', pp.revision, 'document', pp.document, 'valid', public.eup_league_policy_valid(pp.document),
      'updated_by', pp.updated_by, 'updated_at', pp.updated_at) from public.eup_league_policy pp where pp.tenant = p_tenant),
    jsonb_build_object('revision', 0, 'document', null, 'valid', false, 'updated_by', null, 'updated_at', null))
$$;
create function public.eup_league_campaign_json(c public.eup_campaigns) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (c).id, 'tenant', (c).tenant, 'created_at', (c).created_at, 'updated_at', (c).updated_at, 'slug', (c).slug,
    'title', (c).title, 'state', (c).state, 'audience', (c).audience, 'revision', (c).revision, 'document', (c).document, 'created_by', (c).created_by)
$$;
create function public.eup_league_grant_json(g public.eup_campaign_audience_grants) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (g).id, 'tenant', (g).tenant, 'campaign_id', (g).campaign_id, 'account', (g).account, 'state', (g).state,
    'note', (g).note, 'granted_by', (g).granted_by, 'granted_at', (g).granted_at, 'revoked_by', (g).revoked_by, 'revoked_at', (g).revoked_at)
$$;
create function public.eup_league_seats(p_mission uuid) returns integer
language sql stable security invoker set search_path = '' as $$
  select count(*)::integer from public.eup_assignments ss where ss.mission_id = p_mission and ss.status in ('offered', 'accepted', 'completed')
$$;
create function public.eup_league_mission_json(m public.eup_missions) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (m).id, 'tenant', (m).tenant, 'created_at', (m).created_at, 'updated_at', (m).updated_at, 'campaign_id', (m).campaign_id,
    'slug', (m).slug, 'title', (m).title, 'template', (m).template, 'state', (m).state, 'revision', (m).revision,
    'requirements_revision', (m).requirements_revision, 'capacity', (m).capacity, 'proof_modes', to_jsonb((m).proof_modes), 'document', (m).document,
    'created_by', (m).created_by, 'assigned', public.eup_league_seats((m).id))
$$;
-- The member projection of a mission. missions.preview returns exactly this, so the owner preview IS the member view.
create function public.eup_league_mission_card(m public.eup_missions, p_campaign_state text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (m).id, 'campaign_id', (m).campaign_id, 'slug', (m).slug, 'title', (m).title, 'template', (m).template,
    'state', (m).state, 'open', coalesce((m).state = 'released' and p_campaign_state = 'released', false),
    'requirements_revision', (m).requirements_revision, 'requirements', (m).document ->> 'requirements', 'acceptance', (m).document ->> 'acceptance',
    'proof_modes', to_jsonb((m).proof_modes), 'rubric', coalesce((m).document -> 'rubric', '{}'::jsonb), 'capacity', (m).capacity,
    'seats_taken', public.eup_league_seats((m).id))
$$;
create function public.eup_league_application_row_json(a public.eup_applications) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (a).id, 'tenant', (a).tenant, 'created_at', (a).created_at, 'updated_at', (a).updated_at, 'mission_id', (a).mission_id,
    'requirements_revision', (a).requirements_revision, 'applicant', (a).applicant, 'recorded_by', (a).recorded_by, 'status', (a).status,
    'revision', (a).revision, 'accommodation_requested', (a).accommodation is not null, 'decided_by', (a).decided_by,
    'decision_reason', (a).decision_reason, 'decided_at', (a).decided_at)
$$;
create function public.eup_league_member_application_json(a public.eup_applications) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (a).id, 'mission_id', (a).mission_id, 'requirements_revision', (a).requirements_revision, 'status', (a).status,
    'revision', (a).revision, 'accommodation_requested', (a).accommodation is not null, 'recorded', (a).recorded_by is not null,
    'created_at', (a).created_at, 'updated_at', (a).updated_at)
$$;
create function public.eup_league_assignment_json(s public.eup_assignments) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (s).id, 'tenant', (s).tenant, 'created_at', (s).created_at, 'updated_at', (s).updated_at,
    'application_id', (s).application_id, 'mission_id', (s).mission_id, 'participant', (s).participant, 'status', (s).status, 'revision', (s).revision,
    'offered_requirements_revision', (s).offered_requirements_revision, 'accepted_requirements_revision', (s).accepted_requirements_revision,
    'accepted_notice_revision', (s).accepted_notice_revision, 'accepted_at', (s).accepted_at, 'completed_at', (s).completed_at, 'withdrawn_at', (s).withdrawn_at)
$$;
-- storage (the object identity the Worker checks before it signs a read) is filled only where the contract says:
-- uploads.get with sign, proofs.get with media, and the seal. Nowhere is a path stored or returned.
create function public.eup_league_upload_json(u public.eup_media_uploads, p_storage boolean) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (u).id, 'tenant', (u).tenant, 'created_at', (u).created_at, 'updated_at', (u).updated_at,
    'assignment_id', (u).assignment_id, 'participant', (u).participant, 'kind', (u).kind, 'mime', (u).mime, 'ext', (u).ext,
    'declared_bytes', (u).declared_bytes, 'max_bytes', (u).max_bytes, 'duration_seconds', (u).duration_seconds, 'state', (u).state,
    'scan_state', (u).scan_state, 'expires_at', (u).expires_at, 'bytes', (u).bytes, 'sha256', (u).sha256, 'family', (u).family,
    'rejected_reason', (u).rejected_reason, 'sealed_at', (u).sealed_at, 'discarded_at', (u).discarded_at, 'purged_at', (u).purged_at,
    'storage', case when p_storage and (u).storage_object_id is not null then
      jsonb_build_object('object_id', (u).storage_object_id, 'etag', (u).storage_etag, 'size', (u).storage_size) end)
$$;
-- An upload row without tenant, participant, family and storage identity: what a member route answers.
create function public.eup_league_member_upload_json(u public.eup_media_uploads) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (u).id, 'assignment_id', (u).assignment_id, 'kind', (u).kind, 'mime', (u).mime, 'ext', (u).ext,
    'declared_bytes', (u).declared_bytes, 'max_bytes', (u).max_bytes, 'duration_seconds', (u).duration_seconds, 'state', (u).state,
    'scan_state', (u).scan_state, 'expires_at', (u).expires_at, 'bytes', (u).bytes, 'sha256', (u).sha256, 'rejected_reason', (u).rejected_reason,
    'created_at', (u).created_at, 'sealed_at', (u).sealed_at, 'discarded_at', (u).discarded_at, 'purged_at', (u).purged_at)
$$;
create function public.eup_league_proof_media_json(p_proof uuid, p_revision integer) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce((select jsonb_agg(jsonb_build_object('upload_id', pm.upload_id, 'kind', pm.kind, 'mime', pm.mime, 'bytes', pm.bytes, 'sha256', pm.sha256) order by pm.ordinal)
    from public.eup_proof_media pm where pm.proof_id = p_proof and pm.proof_revision = p_revision), '[]'::jsonb)
$$;
create function public.eup_league_proof_row_json(p public.eup_proofs) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (p).id, 'tenant', (p).tenant, 'created_at', (p).created_at, 'updated_at', (p).updated_at,
    'assignment_id', (p).assignment_id, 'participant', (p).participant, 'revision', (p).revision, 'state', (p).state,
    'reviewed_revision', (p).reviewed_revision, 'asset_revision', (p).asset_revision, 'moderation_state', (p).moderation_state,
    'publication_state', (p).publication_state)
$$;
create function public.eup_league_review_json(r public.eup_proof_reviews) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (r).id, 'proof_id', (r).proof_id, 'proof_revision', (r).proof_revision, 'asset_revision', (r).asset_revision,
    'reviewer', (r).reviewer, 'mission_decision', (r).mission_decision, 'rights_decision', (r).rights_decision, 'safety_decision', (r).safety_decision,
    'decision', (r).decision, 'rubric', (r).rubric, 'reason', (r).reason, 'created_at', (r).created_at)
$$;
-- The owner view of a proof: the row, the current revision's document, its media and every review.
create function public.eup_league_proof_json(p public.eup_proofs) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select public.eup_league_proof_row_json(p) || jsonb_build_object(
    'document', (select pr.document from public.eup_proof_revisions pr where pr.proof_id = (p).id and pr.revision = (p).revision),
    'media', public.eup_league_proof_media_json((p).id, (p).revision),
    'reviews', coalesce((select jsonb_agg(public.eup_league_review_json(rr) order by rr.created_at, rr.id) from public.eup_proof_reviews rr where rr.proof_id = (p).id), '[]'::jsonb))
$$;
create function public.eup_league_consent_state(k public.eup_consents) returns text
language sql stable security invoker set search_path = '' as $$
  select case when (k).revoked_at is not null then 'revoked' when (k).superseded_at is not null then 'superseded'
    when (k).expires_at is not null and (k).expires_at <= now() then 'expired' else 'open' end
$$;
create function public.eup_league_consent_json(k public.eup_consents) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (k).id, 'tenant', (k).tenant, 'mission_id', (k).mission_id, 'assignment_id', (k).assignment_id, 'proof_id', (k).proof_id,
    'proof_revision', (k).proof_revision, 'asset_revision', (k).asset_revision, 'actor', (k).actor, 'purpose', (k).purpose, 'audience', (k).audience,
    'notice_revision', (k).notice_revision, 'state', public.eup_league_consent_state(k), 'granted_at', (k).granted_at, 'expires_at', (k).expires_at,
    'revoked_at', (k).revoked_at, 'revoked_by', (k).revoked_by, 'superseded_at', (k).superseded_at)
$$;
create function public.eup_league_member_consent_json(k public.eup_consents) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (k).id, 'proof_id', (k).proof_id, 'proof_revision', (k).proof_revision, 'asset_revision', (k).asset_revision,
    'purpose', (k).purpose, 'audience', (k).audience, 'notice_revision', (k).notice_revision, 'state', public.eup_league_consent_state(k),
    'granted_at', (k).granted_at, 'expires_at', (k).expires_at, 'revoked_at', (k).revoked_at, 'superseded_at', (k).superseded_at)
$$;
-- A participant's own proof: no account id, no storage identity. Publication and appeals arrive with the second pass.
create function public.eup_league_own_proof_json(p public.eup_proofs) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (p).id, 'assignment_id', (p).assignment_id, 'revision', (p).revision, 'state', (p).state,
    'reviewed_revision', (p).reviewed_revision, 'asset_revision', (p).asset_revision, 'moderation_state', (p).moderation_state,
    'publication_state', (p).publication_state,
    'document', (select pr.document from public.eup_proof_revisions pr where pr.proof_id = (p).id and pr.revision = (p).revision),
    'media', public.eup_league_proof_media_json((p).id, (p).revision),
    'reviews', coalesce((select jsonb_agg(public.eup_league_review_json(rr) - 'id' - 'proof_id' - 'reviewer' order by rr.created_at, rr.id)
        from public.eup_proof_reviews rr where rr.proof_id = (p).id), '[]'::jsonb),
    'consents', coalesce((select jsonb_agg(public.eup_league_member_consent_json(kk) order by kk.granted_at, kk.id)
        from public.eup_consents kk where kk.proof_id = (p).id), '[]'::jsonb),
    'publication', null, 'appeals', '[]'::jsonb, 'created_at', (p).created_at, 'updated_at', (p).updated_at)
$$;
create function public.eup_league_credit_json(x public.eup_mission_credits) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', (x).id, 'tenant', (x).tenant, 'campaign_id', (x).campaign_id, 'mission_id', (x).mission_id,
    'assignment_id', (x).assignment_id, 'participant', (x).participant, 'proof_id', (x).proof_id, 'proof_revision', (x).proof_revision,
    'asset_revision', (x).asset_revision, 'review_id', (x).review_id, 'kind', (x).kind, 'created_at', (x).created_at)
$$;
-- Every decision on an application, oldest first. The member view carries no account id.
create function public.eup_league_decisions_json(p_application uuid, p_member boolean) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce((select jsonb_agg(jsonb_build_object('decision', dd.decision, 'reason', dd.reason, 'rubric', dd.rubric, 'decided_at', dd.decided_at)
      || case when p_member then '{}'::jsonb else jsonb_build_object('requirements_revision', dd.requirements_revision, 'decided_by', dd.decided_by) end
      order by dd.decided_at, dd.id)
    from public.eup_application_decisions dd where dd.application_id = p_application), '[]'::jsonb)
$$;
create function public.eup_league_receipt_json(p_tenant uuid, p_actor uuid, p_surface text, p_document jsonb) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('surface', rr.surface, 'operation', rr.operation, 'idempotency_key', rr.idempotency_key, 'result', rr.result, 'created_at', rr.created_at)
    from public.eup_command_receipts rr
   where rr.tenant = p_tenant and rr.actor = p_actor and rr.surface = p_surface and rr.operation = p_document ->> 'operation' and rr.idempotency_key = p_document ->> 'key'
$$;

-- What ends with an assignment (a member's withdrawal, a mission or campaign withdrawal): its open consents are
-- revoked. p_reason names why; the second pass withdraws the assignment's publication here with that reason.
create function public.eup_league_release_assignments(p_tenant uuid, p_assignments uuid[], p_actor uuid, p_reason text) returns void
language sql security invoker set search_path = '' as $$
  update public.eup_consents kk set revoked_at = now(), revoked_by = p_actor
   where kk.tenant = p_tenant and kk.assignment_id = any (p_assignments) and kk.revoked_at is null and kk.superseded_at is null
     and (kk.expires_at is null or kk.expires_at > now())
$$;
-- The mission-withdrawal cascade, under the mission row lock its caller holds: open applications are declined
-- (each with a decision row), open assignments are withdrawn with the assignment effects. Completed assignments
-- and credits stay. p_reason is mission_withdrawn or campaign_withdrawn.
create function public.eup_league_withdraw_mission(p_tenant uuid, p_mission uuid, p_actor uuid, p_reason text) returns void
language plpgsql security invoker set search_path = '' as $$
declare v_assignments uuid[];
begin
  with declined as (
    update public.eup_applications aa set status = 'declined', decided_by = p_actor, decision_reason = p_reason, decided_at = now(),
        revision = aa.revision + 1, updated_at = now()
     where aa.mission_id = p_mission and aa.tenant = p_tenant and aa.status in ('draft', 'submitted', 'changes_requested')
     returning aa.id, aa.tenant, aa.requirements_revision)
  insert into public.eup_application_decisions(tenant, application_id, decision, reason, rubric, requirements_revision, decided_by)
    select dd.tenant, dd.id, 'declined', p_reason, '[]'::jsonb, dd.requirements_revision, p_actor from declined dd;
  with withdrawn as (
    update public.eup_assignments ss set status = 'withdrawn', withdrawn_at = now(), revision = ss.revision + 1, updated_at = now()
     where ss.mission_id = p_mission and ss.tenant = p_tenant and ss.status in ('offered', 'accepted')
     returning ss.id)
  select coalesce(array_agg(ww.id), '{}'::uuid[]) into v_assignments from withdrawn ww;
  perform public.eup_league_release_assignments(p_tenant, v_assignments, p_actor, p_reason);
end $$;

-- ---------------------------------------------------------------- owner command
-- House owner only, rechecked on every call. Reads first (never guarded, no key); then mutations in the order
-- stated at the top of this file. The signature is the one the Worker has always called.
create function public.eup_league_command(p_action text, p_actor uuid, p_id text, p_document jsonb default null, p_revision integer default null, p_key text default null)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s' as $$
declare
  -- The owner-control set of the second pass. Named here so that nothing half-works until it lands.
  v_deferred constant text[] := array['publications.list','publications.decide','appeals.list','appeals.resolve','proofs.moderate',
    'media.due','media.purged','outbox.list','outbox.ack','credits.list','applications.accommodation.get'];
  v_house uuid; v_act jsonb; v_doc jsonb; v_id uuid; v_id_text text; v_digest text; v_result jsonb; v_guard text;
  v_rows integer; v_to text; v_other uuid; v_link uuid; v_changed boolean; v_capacity integer; v_merged jsonb; v_rubric text; v_outcome text; v_media boolean;
  receipt public.eup_command_receipts%rowtype;
  pol public.eup_league_policy%rowtype;
  c public.eup_campaigns%rowtype; m public.eup_missions%rowtype; a public.eup_applications%rowtype; s public.eup_assignments%rowtype;
  p public.eup_proofs%rowtype; r public.eup_proof_reviews%rowtype; g public.eup_campaign_audience_grants%rowtype; x public.eup_mission_credits%rowtype;
begin
  -- 1. Authorization: canonical house ownership.
  select oo.id into v_house from public.org_members mm join public.orgs oo on oo.id = mm.org_id
   where oo.slug = 'mccluster' and mm.profile_id = p_actor and mm.role = 'owner' limit 1;
  if p_actor is null or v_house is null then raise exception 'House owner required' using errcode = '42501'; end if;

  v_act := public.eup_league_contract(array['actions', 'owner', coalesce(p_action, '')]);
  if v_act is null then raise exception 'Unknown action' using errcode = '22023'; end if;
  if p_action = any (v_deferred) then raise exception 'not implemented in this pass: %', p_action using errcode = '0A000'; end if;
  v_doc := coalesce(p_document, '{}'::jsonb);
  if octet_length(v_doc::text) > (public.eup_league_contract('{limits,document_max_bytes}') #>> '{}')::integer then
    raise exception 'Document too large' using errcode = '22023'; end if;
  v_id_text := nullif(p_id, '');
  if v_id_text is not null then
    if not coalesce(v_id_text ~* (public.eup_league_contract('{patterns,uuid}') #>> '{}'), false) then raise exception 'Invalid id' using errcode = '22023'; end if;
    v_id := v_id_text::uuid;
  elsif v_act ? 'id' and (v_act -> 'id_optional') is distinct from 'true'::jsonb then
    raise exception 'An id is required' using errcode = '22023';
  end if;
  v_rows := (public.eup_league_contract('{limits,list,rows}') #>> '{}')::integer;

  -- Reads: bounded, private, this tenant only.
  if (v_act ->> 'kind') = 'read' then
    if v_act ? 'document' then perform public.eup_league_require_document(v_act ->> 'document', v_doc); end if;
    case p_action
      when 'overview' then
        select * into pol from public.eup_league_policy pp where pp.tenant = v_house;
        return jsonb_build_object(
          'campaigns', (select jsonb_build_object('drafts', count(*) filter (where cc.state = 'draft'), 'released', count(*) filter (where cc.state = 'released'),
              'paused', count(*) filter (where cc.state = 'paused'), 'withdrawn', count(*) filter (where cc.state = 'withdrawn'))
            from public.eup_campaigns cc where cc.tenant = v_house),
          'missions', (select jsonb_build_object('drafts', count(*) filter (where mm.state = 'draft'), 'released', count(*) filter (where mm.state = 'released'))
            from public.eup_missions mm where mm.tenant = v_house),
          -- appeals and media_due are counted by the second pass; null says "not computed", never zero.
          'queues', jsonb_build_object(
            'applications', (select count(*) from public.eup_applications aa where aa.tenant = v_house and aa.status = 'submitted'),
            'proofs', (select count(*) from public.eup_proofs pp where pp.tenant = v_house and pp.state = 'submitted'),
            'reviews', (select count(*) from public.eup_proofs pp where pp.tenant = v_house and pp.state = 'needs_changes'),
            'appeals', null, 'media_due', null),
          'policy', jsonb_build_object('present', pol.tenant is not null, 'valid', coalesce(public.eup_league_policy_valid(pol.document), false),
            'media_enabled', coalesce(public.eup_league_policy_valid(pol.document) and (pol.document #> '{media,enabled}') = 'true'::jsonb, false),
            'revision', coalesce(pol.revision, 0)),
          'audience', jsonb_build_object(
            'invited_campaigns', (select count(*) from public.eup_campaigns cc where cc.tenant = v_house and cc.audience = 'invited' and cc.state <> 'withdrawn'),
            'open_grants', (select count(*) from public.eup_campaign_audience_grants gg where gg.tenant = v_house and gg.state = 'open')),
          'latest_change', (select max(t.changed_at) from (
              select max(cc.updated_at) as changed_at from public.eup_campaigns cc where cc.tenant = v_house
              union all select max(mm.updated_at) from public.eup_missions mm where mm.tenant = v_house
              union all select max(aa.updated_at) from public.eup_applications aa where aa.tenant = v_house
              union all select max(ss.updated_at) from public.eup_assignments ss where ss.tenant = v_house
              union all select max(pp.updated_at) from public.eup_proofs pp where pp.tenant = v_house
              union all select max(pp.updated_at) from public.eup_league_policy pp where pp.tenant = v_house) t));
      when 'policy.get' then
        return public.eup_league_policy_json(v_house);
      when 'campaigns.list' then
        return coalesce((select jsonb_agg(q.j order by q.created_at, q.id) from (
          select cc.created_at, cc.id, public.eup_league_campaign_json(cc) || jsonb_build_object('missions', coalesce((
              select jsonb_agg(public.eup_league_mission_json(mm) order by mm.created_at, mm.id) from public.eup_missions mm
               where mm.campaign_id = cc.id and mm.tenant = v_house), '[]'::jsonb)) as j
            from public.eup_campaigns cc where cc.tenant = v_house order by cc.created_at, cc.id
           limit (public.eup_league_contract('{limits,list,campaigns}') #>> '{}')::integer) q), '[]'::jsonb);
      when 'audience.grants.list' then
        if not exists (select 1 from public.eup_campaigns cc where cc.id = v_id and cc.tenant = v_house) then raise exception 'Campaign not found' using errcode = 'P0002'; end if;
        return coalesce((select jsonb_agg(q.j order by q.granted_at, q.id) from (
          select gg.granted_at, gg.id, public.eup_league_grant_json(gg) as j from public.eup_campaign_audience_grants gg
           where gg.campaign_id = v_id and gg.tenant = v_house order by gg.granted_at, gg.id limit v_rows) q), '[]'::jsonb);
      when 'missions.list' then
        return coalesce((select jsonb_agg(q.j order by q.created_at, q.id) from (
          select mm.created_at, mm.id, public.eup_league_mission_json(mm) as j from public.eup_missions mm
           where mm.tenant = v_house and (v_id is null or mm.campaign_id = v_id) order by mm.created_at, mm.id limit v_rows) q), '[]'::jsonb);
      when 'missions.preview' then
        select * into m from public.eup_missions mm where mm.id = v_id and mm.tenant = v_house;
        if not found then raise exception 'Mission not found' using errcode = 'P0002'; end if;
        return public.eup_league_mission_card(m, (select cc.state from public.eup_campaigns cc where cc.id = m.campaign_id));
      when 'applications.list' then
        return coalesce((select jsonb_agg(q.j order by q.created_at, q.id) from (
          select aa.created_at, aa.id, public.eup_league_application_row_json(aa)
              || jsonb_build_object('document', aa.document, 'decisions', public.eup_league_decisions_json(aa.id, false)) as j
            from public.eup_applications aa
           where aa.tenant = v_house and (v_id is null or aa.mission_id = v_id) and (not (v_doc ? 'status') or aa.status = v_doc ->> 'status')
           order by aa.created_at, aa.id limit v_rows) q), '[]'::jsonb);
      when 'assignments.list' then
        return coalesce((select jsonb_agg(q.j order by q.created_at, q.id) from (
          select ss.created_at, ss.id, public.eup_league_assignment_json(ss) as j from public.eup_assignments ss
           where ss.tenant = v_house and (v_id is null or ss.mission_id = v_id) order by ss.created_at, ss.id limit v_rows) q), '[]'::jsonb);
      when 'proofs.list' then
        return coalesce((select jsonb_agg(q.j order by q.created_at, q.id) from (
          select pp.created_at, pp.id, public.eup_league_proof_json(pp) as j from public.eup_proofs pp
           where pp.tenant = v_house and (v_id is null or pp.assignment_id = v_id) and (not (v_doc ? 'state') or pp.state = v_doc ->> 'state')
           order by pp.created_at, pp.id limit v_rows) q), '[]'::jsonb);
      when 'proofs.get' then
        -- The reviewer's read of one proof at the revision asked for. media adds each upload's storage identity
        -- so the Worker can check the object before it signs a read; a held proof exposes none.
        select * into p from public.eup_proofs pp where pp.id = v_id and pp.tenant = v_house;
        if not found then raise exception 'Proof not found' using errcode = 'P0002'; end if;
        if (v_doc ->> 'revision')::numeric <> p.revision then raise exception 'Proof revision changed' using errcode = '40001'; end if;
        v_media := coalesce((v_doc -> 'media') = 'true'::jsonb, false);
        if v_media and p.moderation_state = 'held' then raise exception 'Proof is held' using errcode = 'EU016'; end if;
        return public.eup_league_proof_json(p) || jsonb_build_object('uploads', coalesce((
          select jsonb_agg(public.eup_league_upload_json(uu, v_media) order by pm.ordinal)
            from public.eup_proof_media pm join public.eup_media_uploads uu on uu.id = pm.upload_id and uu.tenant = pm.tenant
           where pm.proof_id = p.id and pm.proof_revision = p.revision), '[]'::jsonb));
      when 'consents.list' then
        return coalesce((select jsonb_agg(q.j order by q.granted_at, q.id) from (
          select kk.granted_at, kk.id, public.eup_league_consent_json(kk) as j from public.eup_consents kk
           where kk.tenant = v_house and (v_id is null or kk.proof_id = v_id) order by kk.granted_at, kk.id limit v_rows) q), '[]'::jsonb);
      when 'receipts.get' then
        v_result := public.eup_league_receipt_json(v_house, p_actor, 'owner', v_doc);
        if v_result is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
        return v_result;
      else
        raise exception 'Unknown action' using errcode = '22023';
    end case;
  end if;

  -- 2. Idempotency: the key is locked BEFORE the lookup, so a concurrent duplicate waits and then replays.
  if p_key is null or not coalesce(p_key ~ (public.eup_league_contract('{patterns,idempotency_key}') #>> '{}'), false) then
    raise exception 'Idempotency key required' using errcode = '22023'; end if;
  v_digest := encode(sha256(convert_to(coalesce(lower(v_id_text), '') || '|' || coalesce(p_revision::text, '') || '|' || v_doc::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('eup.league.receipt|' || v_house::text || '|' || p_actor::text || '|' || p_action || '|' || p_key, 0));
  select * into receipt from public.eup_command_receipts rr
   where rr.tenant = v_house and rr.actor = p_actor and rr.operation = p_action and rr.idempotency_key = p_key;
  if found then
    if receipt.payload_digest <> v_digest then raise exception 'Idempotency key reused with a different payload' using errcode = 'EU003'; end if;
    return receipt.result;
  end if;

  -- 3. Module state. A transition to paused or withdrawn, and a grant revocation, only reduce: they stay
  --    possible while the module drains or is disabled. Everything else needs the module enabled.
  v_guard := v_act ->> 'guard';
  if v_act ? 'reduce_when' and (v_act #> '{reduce_when,values}') @> jsonb_build_array(v_doc -> (v_act #>> '{reduce_when,field}')) then v_guard := 'reduce'; end if;
  if v_guard = 'reduce' then perform public.eup_module_guard_reduce('league'); else perform public.eup_module_guard('league'); end if;

  perform public.eup_league_require_document(v_act ->> 'document', v_doc);
  if v_act ? 'revision' and (p_revision is null or p_revision < coalesce((v_act ->> 'revision_min')::integer, 1)
      or p_revision > (public.eup_league_contract('{limits,revision_max}') #>> '{}')::integer) then
    raise exception 'Expected revision required' using errcode = '22023'; end if;

  case p_action
    when 'policy.set' then
      -- Configuration only. An invalid document was refused above, so a stored policy is always valid.
      select * into pol from public.eup_league_policy pp where pp.tenant = v_house for update;
      if found then
        if p_revision <> pol.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
        update public.eup_league_policy pp set revision = pp.revision + 1, document = v_doc -> 'policy', updated_by = p_actor, updated_at = now()
         where pp.tenant = v_house returning * into pol;
      else
        if p_revision <> 0 then raise exception 'Revision conflict' using errcode = '40001'; end if;
        insert into public.eup_league_policy(tenant, revision, document, updated_by) values (v_house, 1, v_doc -> 'policy', p_actor)
          on conflict (tenant) do nothing returning * into pol;
        if not found then raise exception 'Revision conflict' using errcode = '40001'; end if;
      end if;
      insert into public.eup_league_policy_revisions(tenant, revision, document, reason, actor) values (v_house, pol.revision, pol.document, v_doc ->> 'reason', p_actor);
      v_result := public.eup_league_policy_json(v_house);

    when 'campaigns.create' then
      -- Always created admin_preview; widening is campaigns.audience.set. The audience lives in its column only.
      insert into public.eup_campaigns(tenant, slug, title, document, created_by)
        values (v_house, v_doc ->> 'slug', v_doc ->> 'title', v_doc - 'audience', p_actor)
        on conflict (tenant, slug) do nothing returning * into c;
      if not found then raise exception 'Campaign slug exists' using errcode = '23505'; end if;
      insert into public.eup_campaign_revisions(campaign_id, revision, tenant, state, audience, document, actor)
        values (c.id, c.revision, c.tenant, c.state, c.audience, c.document, p_actor);
      v_result := public.eup_league_campaign_json(c);

    when 'campaigns.transition' then
      select * into c from public.eup_campaigns cc where cc.id = v_id and cc.tenant = v_house for update;
      if not found then raise exception 'Campaign not found' using errcode = 'P0002'; end if;
      if p_revision <> c.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
      v_to := v_doc ->> 'to';
      if not ((c.state = 'draft' and v_to in ('released', 'withdrawn')) or (c.state = 'released' and v_to in ('paused', 'withdrawn'))
          or (c.state = 'paused' and v_to in ('released', 'withdrawn'))) then
        raise exception 'Transition not allowed' using errcode = '22023'; end if;
      update public.eup_campaigns cc set state = v_to, revision = cc.revision + 1, updated_at = now() where cc.id = c.id returning * into c;
      insert into public.eup_campaign_revisions(campaign_id, revision, tenant, state, audience, document, actor)
        values (c.id, c.revision, c.tenant, c.state, c.audience, c.document, p_actor);
      -- paused: nothing else is rewritten; the audience gate closes every mission of the campaign for new work.
      -- withdrawn: every mission of the campaign is withdrawn with the mission cascade.
      if v_to = 'withdrawn' then
        for m in select * from public.eup_missions mm where mm.campaign_id = c.id and mm.tenant = v_house and mm.state <> 'withdrawn' order by mm.id for update loop
          update public.eup_missions mm set state = 'withdrawn', revision = mm.revision + 1, updated_at = now() where mm.id = m.id returning * into m;
          insert into public.eup_mission_revisions(mission_id, revision, tenant, state, requirements_revision, capacity, proof_modes, document, actor)
            values (m.id, m.revision, m.tenant, m.state, m.requirements_revision, m.capacity, m.proof_modes, m.document, p_actor);
          perform public.eup_league_withdraw_mission(v_house, m.id, p_actor, 'campaign_withdrawn');
        end loop;
      end if;
      v_result := public.eup_league_campaign_json(c);

    when 'campaigns.audience.set' then
      select * into c from public.eup_campaigns cc where cc.id = v_id and cc.tenant = v_house for update;
      if not found then raise exception 'Campaign not found' using errcode = 'P0002'; end if;
      if p_revision <> c.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
      update public.eup_campaigns cc set audience = v_doc ->> 'audience', revision = cc.revision + 1, updated_at = now() where cc.id = c.id returning * into c;
      insert into public.eup_campaign_revisions(campaign_id, revision, tenant, state, audience, document, actor)
        values (c.id, c.revision, c.tenant, c.state, c.audience, c.document, p_actor);
      v_result := public.eup_league_campaign_json(c);

    when 'audience.grants.grant' then
      select * into c from public.eup_campaigns cc where cc.id = v_id and cc.tenant = v_house for share;
      if not found then raise exception 'Campaign not found' using errcode = 'P0002'; end if;
      v_other := (v_doc ->> 'account')::uuid;
      if not public.eup_league_actor_known(v_other) then raise exception 'Account not found' using errcode = 'P0002'; end if;
      insert into public.eup_campaign_audience_grants(tenant, campaign_id, account, note, granted_by)
        values (v_house, c.id, v_other, v_doc ->> 'note', p_actor)
        on conflict (campaign_id, account) where state = 'open' do nothing returning * into g;
      if not found then raise exception 'An open grant exists for this account' using errcode = '23505'; end if;
      v_result := public.eup_league_grant_json(g);

    when 'audience.grants.revoke' then
      -- Reduce-only. The account keeps reading its own records and can still withdraw, discard and revoke.
      select * into g from public.eup_campaign_audience_grants gg where gg.id = v_id and gg.tenant = v_house for update;
      if not found then raise exception 'Grant not found' using errcode = 'P0002'; end if;
      if g.state <> 'open' then raise exception 'Grant is not open' using errcode = '40001'; end if;
      update public.eup_campaign_audience_grants gg set state = 'revoked', revoked_by = p_actor, revoked_at = now(), revoked_reason = v_doc ->> 'reason'
       where gg.id = g.id returning * into g;
      v_result := public.eup_league_grant_json(g);

    when 'missions.create' then
      -- The campaign is locked FOR SHARE: a mission cannot slip in beside a campaign withdrawal and miss its cascade.
      select * into c from public.eup_campaigns cc where cc.id = v_id and cc.tenant = v_house for share;
      if not found then raise exception 'Campaign not found' using errcode = 'P0002'; end if;
      if c.state = 'withdrawn' then raise exception 'Campaign is withdrawn' using errcode = '40001'; end if;
      insert into public.eup_missions(tenant, campaign_id, slug, title, template, capacity, proof_modes, document, created_by)
        values (v_house, c.id, v_doc ->> 'slug', v_doc ->> 'title', v_doc ->> 'template', (v_doc ->> 'capacity')::numeric::integer,
          array(select t.e from jsonb_array_elements_text(v_doc -> 'proof_modes') with ordinality t(e, ord) order by t.ord), v_doc, p_actor)
        on conflict (campaign_id, slug) do nothing returning * into m;
      if not found then raise exception 'Mission slug exists' using errcode = '23505'; end if;
      insert into public.eup_mission_revisions(mission_id, revision, tenant, state, requirements_revision, capacity, proof_modes, document, actor)
        values (m.id, m.revision, m.tenant, m.state, m.requirements_revision, m.capacity, m.proof_modes, m.document, p_actor);
      v_result := public.eup_league_mission_json(m);

    when 'missions.update' then
      -- PATCH: omitted fields keep their value, capacity included (an explicit null removes the limit).
      select * into m from public.eup_missions mm where mm.id = v_id and mm.tenant = v_house for update;
      if not found then raise exception 'Mission not found' using errcode = 'P0002'; end if;
      if p_revision <> m.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
      if m.state = 'withdrawn' then raise exception 'Mission is withdrawn' using errcode = '40001'; end if;
      v_merged := m.document || v_doc;
      if not coalesce(public.eup_league_rule('template_modes', v_merged), false) then
        raise exception 'Proof modes do not fit the template' using errcode = '22023'; end if;
      v_capacity := case when v_doc ? 'capacity' then (v_doc ->> 'capacity')::numeric::integer else m.capacity end;
      if v_capacity is not null and v_capacity < public.eup_league_seats(m.id) then
        raise exception 'Capacity below the seats taken' using errcode = 'EU001'; end if;
      -- What a participant agreed to changes only when one of these fields really changes value.
      v_changed := exists (select 1 from jsonb_array_elements_text(public.eup_league_contract('{requirements_fields}')) f
        where v_doc ? f and (v_doc -> f) is distinct from (m.document -> f));
      update public.eup_missions mm set title = v_merged ->> 'title', capacity = v_capacity,
          proof_modes = array(select t.e from jsonb_array_elements_text(v_merged -> 'proof_modes') with ordinality t(e, ord) order by t.ord), document = v_merged,
          revision = mm.revision + 1, requirements_revision = mm.requirements_revision + case when v_changed then 1 else 0 end, updated_at = now()
       where mm.id = m.id returning * into m;
      insert into public.eup_mission_revisions(mission_id, revision, tenant, state, requirements_revision, capacity, proof_modes, document, actor)
        values (m.id, m.revision, m.tenant, m.state, m.requirements_revision, m.capacity, m.proof_modes, m.document, p_actor);
      if v_changed then
        -- Every open assignment is offered the new requirements; an accepted one has to accept again.
        update public.eup_assignments ss set status = 'offered', offered_requirements_revision = m.requirements_revision,
            revision = ss.revision + 1, updated_at = now()
         where ss.mission_id = m.id and ss.tenant = v_house and ss.status in ('offered', 'accepted');
      end if;
      v_result := public.eup_league_mission_json(m);

    when 'missions.transition' then
      select mm.campaign_id into v_other from public.eup_missions mm where mm.id = v_id and mm.tenant = v_house;
      if not found then raise exception 'Mission not found' using errcode = 'P0002'; end if;
      select * into c from public.eup_campaigns cc where cc.id = v_other and cc.tenant = v_house for share;
      select * into m from public.eup_missions mm where mm.id = v_id and mm.tenant = v_house for update;
      if p_revision <> m.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
      v_to := v_doc ->> 'to';
      if not ((m.state = 'draft' and v_to in ('released', 'withdrawn')) or (m.state = 'released' and v_to in ('paused', 'withdrawn'))
          or (m.state = 'paused' and v_to in ('released', 'withdrawn'))) then
        raise exception 'Transition not allowed' using errcode = '22023'; end if;
      if v_to = 'released' and (c.state is distinct from 'released'
          or not (public.eup_league_contract('{releasable_templates}') ? m.template)) then
        raise exception 'Release needs a released campaign and a releasable template' using errcode = '22023'; end if;
      -- Pause and re-release never touch requirements_revision, so no participant is asked to accept again.
      update public.eup_missions mm set state = v_to, revision = mm.revision + 1, updated_at = now() where mm.id = m.id returning * into m;
      insert into public.eup_mission_revisions(mission_id, revision, tenant, state, requirements_revision, capacity, proof_modes, document, actor)
        values (m.id, m.revision, m.tenant, m.state, m.requirements_revision, m.capacity, m.proof_modes, m.document, p_actor);
      if v_to = 'withdrawn' then perform public.eup_league_withdraw_mission(v_house, m.id, p_actor, 'mission_withdrawn'); end if;
      v_result := public.eup_league_mission_json(m);

    when 'applications.create' then
      -- An owner records an application for an account; the row keeps recorded_by. The applicant must be in the
      -- released audience, or the account could never act on its own assignment.
      select mm.campaign_id into v_other from public.eup_missions mm where mm.id = v_id and mm.tenant = v_house;
      if not found then raise exception 'Mission not found' using errcode = 'P0002'; end if;
      select * into c from public.eup_campaigns cc where cc.id = v_other and cc.tenant = v_house for share;
      select * into m from public.eup_missions mm where mm.id = v_id and mm.tenant = v_house for share;
      v_other := (v_doc ->> 'applicant')::uuid;
      if not public.eup_league_actor_known(v_other) then raise exception 'Account not found' using errcode = 'P0002'; end if;
      if c.state is distinct from 'released' or m.state <> 'released' or not public.eup_league_in_audience(v_house, v_other, c.id) then
        raise exception 'Not released to this account' using errcode = 'EU011'; end if;
      if (v_doc ->> 'requirements_revision')::numeric <> m.requirements_revision then
        raise exception 'Requirements changed' using errcode = 'EU013'; end if;
      insert into public.eup_applications(tenant, mission_id, requirements_revision, applicant, recorded_by, status, document, accommodation)
        values (v_house, m.id, m.requirements_revision, v_other, p_actor, 'submitted', jsonb_build_object('statement', v_doc ->> 'statement'), v_doc -> 'accommodation')
        on conflict (mission_id, applicant) do nothing returning * into a;
      if not found then raise exception 'This account already has an application' using errcode = '23505'; end if;
      v_result := public.eup_league_application_row_json(a);

    when 'applications.decide' then
      -- Lock order mission, then application: the same order every mission command uses.
      select aa.mission_id into v_other from public.eup_applications aa where aa.id = v_id and aa.tenant = v_house;
      if not found then raise exception 'Application not found' using errcode = 'P0002'; end if;
      select * into c from public.eup_campaigns cc where cc.tenant = v_house and cc.id = (select mm.campaign_id from public.eup_missions mm where mm.id = v_other) for share;
      select * into m from public.eup_missions mm where mm.id = v_other and mm.tenant = v_house for update;
      select * into a from public.eup_applications aa where aa.id = v_id and aa.tenant = v_house for update;
      if a.applicant = p_actor then raise exception 'An applicant cannot decide their own application' using errcode = 'EU002'; end if;
      if p_revision <> a.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
      if a.status <> 'submitted' then raise exception 'Application is not awaiting a decision' using errcode = '40001'; end if;
      v_rubric := public.eup_league_rubric_state(m.document #> '{rubric,application}', v_doc -> 'rubric');
      if v_rubric = 'incomplete' or (v_rubric = 'unmet' and v_doc ->> 'decision' = 'approved') then
        raise exception 'The rubric answers every criterion once, and approval needs every one met' using errcode = '22023'; end if;
      if v_doc ->> 'decision' = 'approved' then
        if c.state is distinct from 'released' or m.state <> 'released' then raise exception 'Campaign and mission must be released' using errcode = '40001'; end if;
        if a.requirements_revision <> m.requirements_revision then raise exception 'Requirements changed since the application' using errcode = 'EU013'; end if;
        -- Atomic capacity: the count is taken under the mission row lock.
        if m.capacity is not null and public.eup_league_seats(m.id) >= m.capacity then raise exception 'No seat is free' using errcode = 'EU001'; end if;
        insert into public.eup_assignments(tenant, application_id, mission_id, participant, offered_requirements_revision)
          values (v_house, a.id, m.id, a.applicant, m.requirements_revision) returning * into s;
      end if;
      update public.eup_applications aa set status = v_doc ->> 'decision', decided_by = p_actor, decision_reason = v_doc ->> 'reason', decided_at = now(),
          revision = aa.revision + 1, updated_at = now() where aa.id = a.id returning * into a;
      insert into public.eup_application_decisions(tenant, application_id, decision, reason, rubric, requirements_revision, decided_by)
        values (v_house, a.id, a.status, a.decision_reason, coalesce(v_doc -> 'rubric', '[]'::jsonb), a.requirements_revision, p_actor);
      v_result := public.eup_league_application_row_json(a)
        || jsonb_build_object('assignment', case when s.id is not null then public.eup_league_assignment_json(s) end);

    when 'proofs.review' then
      -- Bound to the exact proof revision (p_revision) AND the exact media digest (asset_revision) that was shown.
      select ss.mission_id, ss.id into v_other, v_link from public.eup_proofs pp join public.eup_assignments ss on ss.id = pp.assignment_id
       where pp.id = v_id and pp.tenant = v_house;
      if not found then raise exception 'Proof not found' using errcode = 'P0002'; end if;
      select * into m from public.eup_missions mm where mm.id = v_other and mm.tenant = v_house for share;
      select * into s from public.eup_assignments ss where ss.id = v_link and ss.tenant = v_house for update;
      select * into p from public.eup_proofs pp where pp.id = v_id and pp.tenant = v_house for update;
      if p.participant = p_actor then raise exception 'A participant cannot review their own proof' using errcode = 'EU002'; end if;
      if p_revision <> p.revision then raise exception 'Proof revision changed; reload before reviewing' using errcode = '40001'; end if;
      if p.state <> 'submitted' or s.status <> 'accepted' then raise exception 'Proof is not awaiting review' using errcode = '40001'; end if;
      if p.moderation_state = 'held' then raise exception 'Proof is held' using errcode = 'EU016'; end if;
      if v_doc ->> 'asset_revision' <> p.asset_revision then raise exception 'The asset revision reviewed is not the current one' using errcode = 'EU014'; end if;
      v_rubric := public.eup_league_rubric_state(m.document #> '{rubric,proof}', v_doc -> 'rubric');
      if v_rubric = 'incomplete' or (v_rubric = 'unmet' and v_doc ->> 'mission_decision' = 'pass') then
        raise exception 'The rubric answers every criterion once, and a mission pass needs every one met' using errcode = '22023'; end if;
      v_outcome := case when 'fail' in (v_doc ->> 'mission_decision', v_doc ->> 'rights_decision', v_doc ->> 'safety_decision') then 'rejected'
        when v_doc ->> 'mission_decision' = 'pass' and v_doc ->> 'rights_decision' = 'pass' and v_doc ->> 'safety_decision' = 'pass' then 'accepted'
        else 'needs_changes' end;
      insert into public.eup_proof_reviews(tenant, proof_id, proof_revision, asset_revision, reviewer, mission_decision, rights_decision, safety_decision, decision, rubric, reason)
        values (v_house, p.id, p.revision, p.asset_revision, p_actor, v_doc ->> 'mission_decision', v_doc ->> 'rights_decision', v_doc ->> 'safety_decision',
          v_outcome, coalesce(v_doc -> 'rubric', '[]'::jsonb), v_doc ->> 'reason') returning * into r;
      update public.eup_proofs pp set state = v_outcome, reviewed_revision = pp.revision, updated_at = now() where pp.id = p.id returning * into p;
      if v_outcome = 'accepted' then
        -- Completion writes exactly one credit. Nothing here reads a consent or a publication: a private proof
        -- and an accommodation proof earn the identical credit.
        update public.eup_assignments ss set status = 'completed', completed_at = now(), revision = ss.revision + 1, updated_at = now() where ss.id = s.id;
        insert into public.eup_mission_credits(tenant, campaign_id, mission_id, assignment_id, participant, proof_id, proof_revision, asset_revision, review_id)
          values (v_house, m.campaign_id, m.id, s.id, p.participant, p.id, p.revision, p.asset_revision, r.id) returning * into x;
      end if;
      v_result := public.eup_league_proof_row_json(p) || jsonb_build_object('review', public.eup_league_review_json(r),
        'credit', case when x.id is not null then public.eup_league_credit_json(x) end);

    else
      raise exception 'Unknown action' using errcode = '22023';
  end case;

  insert into public.eup_command_receipts(tenant, actor, surface, operation, idempotency_key, payload_digest, result)
    values (v_house, p_actor, 'owner', p_action, p_key, v_digest, v_result);
  return v_result;
end $$;

-- ---------------------------------------------------------------- member command
-- Any signed-in account the Worker verified. What the account may do is decided here, per call, by the gates.
-- Reduce-only actions (withdraw, discard, revoke) check only that the row is the actor's, so a participant can
-- always leave, whatever happened to the campaign, the grant, the League policy or the module state.
create function public.eup_league_member_command(p_action text, p_actor uuid, p_id text, p_document jsonb default null, p_revision integer default null, p_key text default null)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s' as $$
declare
  v_deferred constant text[] := array['appeals.open','appeals.withdraw'];
  v_house uuid; v_act jsonb; v_doc jsonb; v_id uuid; v_id_text text; v_digest text; v_result jsonb; v_policy jsonb;
  v_rows integer; v_owner boolean; v_mission uuid; v_campaign uuid; v_link uuid; v_holder uuid; v_types jsonb; v_kind text; v_cap integer; v_status text;
  v_statement text; v_accommodation jsonb; v_entry jsonb; v_media jsonb := '[]'::jsonb; v_manifest jsonb; v_asset text;
  v_expires timestamptz; v_catalogue jsonb; v_applications jsonb; v_assignments jsonb; v_sign boolean;
  receipt public.eup_command_receipts%rowtype;
  c public.eup_campaigns%rowtype; m public.eup_missions%rowtype; a public.eup_applications%rowtype; s public.eup_assignments%rowtype;
  d public.eup_proof_drafts%rowtype; u public.eup_media_uploads%rowtype; p public.eup_proofs%rowtype; k public.eup_consents%rowtype;
begin
  -- 1. The actor: a known account. Nothing in a document can name another one.
  select oo.id into v_house from public.orgs oo where oo.slug = 'mccluster' limit 1;
  if p_actor is null or v_house is null or not public.eup_league_actor_known(p_actor) then
    raise exception 'A signed-in account is required' using errcode = '42501'; end if;

  v_act := public.eup_league_contract(array['actions', 'member', coalesce(p_action, '')]);
  if v_act is null then raise exception 'Unknown action' using errcode = '22023'; end if;
  if p_action = any (v_deferred) then raise exception 'not implemented in this pass: %', p_action using errcode = '0A000'; end if;
  v_doc := coalesce(p_document, '{}'::jsonb);
  if octet_length(v_doc::text) > (public.eup_league_contract('{limits,document_max_bytes}') #>> '{}')::integer then
    raise exception 'Document too large' using errcode = '22023'; end if;
  v_id_text := nullif(p_id, '');
  if v_id_text is not null then
    if not coalesce(v_id_text ~* (public.eup_league_contract('{patterns,uuid}') #>> '{}'), false) then raise exception 'Invalid id' using errcode = '22023'; end if;
    v_id := v_id_text::uuid;
  elsif v_act ? 'id' then
    raise exception 'An id is required' using errcode = '22023';
  end if;
  v_rows := (public.eup_league_contract('{limits,list,rows}') #>> '{}')::integer;

  -- Reads: never guarded. A participant reads their own records in every campaign, grant and module state.
  if (v_act ->> 'kind') = 'read' then
    case p_action
      when 'me.get' then
        v_owner := public.eup_league_is_owner(v_house, p_actor);
        -- The catalogue: released campaigns the actor is in the audience of, with their released missions.
        select coalesce(jsonb_agg(q.j order by q.created_at, q.id), '[]'::jsonb) into v_catalogue from (
          select cc.created_at, cc.id, jsonb_build_object('id', cc.id, 'slug', cc.slug, 'title', cc.title, 'purpose', cc.document ->> 'purpose',
              'state', cc.state, 'audience', cc.audience, 'missions', coalesce((
                select jsonb_agg(public.eup_league_mission_card(mm, cc.state) order by mm.created_at, mm.id) from public.eup_missions mm
                 where mm.campaign_id = cc.id and mm.tenant = v_house and mm.state = 'released'), '[]'::jsonb)) as j
            from public.eup_campaigns cc
           where cc.tenant = v_house and cc.state = 'released' and (v_owner or (cc.audience = 'invited' and exists (
                 select 1 from public.eup_campaign_audience_grants gg where gg.campaign_id = cc.id and gg.account = p_actor and gg.state = 'open')))
           order by cc.created_at, cc.id limit (public.eup_league_contract('{limits,list,campaigns}') #>> '{}')::integer) q;
        select coalesce(jsonb_agg(q.j order by q.created_at, q.id), '[]'::jsonb) into v_applications from (
          select aa.created_at, aa.id, public.eup_league_member_application_json(aa) || jsonb_build_object(
              'mission', public.eup_league_mission_card(mm, cc.state), 'document', aa.document, 'accommodation', aa.accommodation,
              'decisions', public.eup_league_decisions_json(aa.id, true), 'appeals', '[]'::jsonb) as j
            from public.eup_applications aa join public.eup_missions mm on mm.id = aa.mission_id join public.eup_campaigns cc on cc.id = mm.campaign_id
           where aa.tenant = v_house and aa.applicant = p_actor order by aa.created_at, aa.id limit v_rows) q;
        select coalesce(jsonb_agg(q.j order by q.created_at, q.id), '[]'::jsonb) into v_assignments from (
          select ss.created_at, ss.id, public.eup_league_assignment_json(ss) || jsonb_build_object(
              'mission', public.eup_league_mission_card(mm, cc.state),
              'draft', (select jsonb_build_object('assignment_id', dd.assignment_id, 'revision', dd.revision, 'updated_at', dd.updated_at, 'document', dd.document)
                  from public.eup_proof_drafts dd where dd.assignment_id = ss.id),
              'uploads', coalesce((select jsonb_agg(public.eup_league_member_upload_json(uu) order by uu.created_at, uu.id)
                  from public.eup_media_uploads uu where uu.assignment_id = ss.id and uu.tenant = v_house), '[]'::jsonb),
              'proof', (select public.eup_league_own_proof_json(pp) from public.eup_proofs pp where pp.assignment_id = ss.id),
              'credit', (select public.eup_league_credit_json(xx) from public.eup_mission_credits xx where xx.assignment_id = ss.id)) as j
            from public.eup_assignments ss join public.eup_missions mm on mm.id = ss.mission_id join public.eup_campaigns cc on cc.id = mm.campaign_id
           where ss.tenant = v_house and ss.participant = p_actor order by ss.created_at, ss.id limit v_rows) q;
        -- Not available only when the actor is in no released audience AND has no record of their own.
        if v_catalogue = '[]'::jsonb and v_applications = '[]'::jsonb and v_assignments = '[]'::jsonb then
          raise exception 'Not released to this account' using errcode = 'EU011'; end if;
        return jsonb_build_object('actor', p_actor,
          'policy', (select jsonb_build_object('revision', pp.revision, 'entitlement', pp.document -> 'entitlement', 'media', pp.document -> 'media',
                'retention', pp.document -> 'retention', 'notices', pp.document -> 'notices')
              from public.eup_league_policy pp where pp.tenant = v_house and public.eup_league_policy_valid(pp.document)),
          'catalogue', v_catalogue, 'applications', v_applications, 'assignments', v_assignments,
          -- Effective publications of the released audience: none exist before the second pass.
          'published', '[]'::jsonb);
      when 'uploads.get' then
        select * into u from public.eup_media_uploads uu where uu.id = v_id and uu.tenant = v_house;
        if not found then raise exception 'Upload not found' using errcode = 'P0002'; end if;
        -- The row's participant always reads it. (Second pass: also the released audience of an effective publication.)
        if u.participant <> p_actor then raise exception 'Not the record of this account' using errcode = '42501'; end if;
        perform public.eup_league_require_document(v_act ->> 'document', v_doc);
        v_sign := coalesce((v_doc -> 'sign') = 'true'::jsonb, false);
        if v_sign then
          if u.state <> 'sealed' then raise exception 'Upload is not sealed' using errcode = 'EU014'; end if;
          if exists (select 1 from public.eup_proofs pp where pp.assignment_id = u.assignment_id and pp.moderation_state = 'held') then
            raise exception 'Proof is held' using errcode = 'EU016'; end if;
        end if;
        return public.eup_league_upload_json(u, v_sign);
      when 'receipts.get' then
        perform public.eup_league_require_document(v_act ->> 'document', v_doc);
        v_result := public.eup_league_receipt_json(v_house, p_actor, 'member', v_doc);
        if v_result is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
        return v_result;
      else
        raise exception 'Unknown action' using errcode = '22023';
    end case;
  end if;

  -- 2. Idempotency: lock the key, then look. A concurrent duplicate waits here and replays.
  if p_key is null or not coalesce(p_key ~ (public.eup_league_contract('{patterns,idempotency_key}') #>> '{}'), false) then
    raise exception 'Idempotency key required' using errcode = '22023'; end if;
  v_digest := encode(sha256(convert_to(coalesce(lower(v_id_text), '') || '|' || coalesce(p_revision::text, '') || '|' || v_doc::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended('eup.league.receipt|' || v_house::text || '|' || p_actor::text || '|' || p_action || '|' || p_key, 0));
  select * into receipt from public.eup_command_receipts rr
   where rr.tenant = v_house and rr.actor = p_actor and rr.operation = p_action and rr.idempotency_key = p_key;
  if found then
    if receipt.payload_digest <> v_digest then raise exception 'Idempotency key reused with a different payload' using errcode = 'EU003'; end if;
    return receipt.result;
  end if;

  -- 3. Module state.
  if (v_act ->> 'guard') = 'reduce' then perform public.eup_module_guard_reduce('league'); else perform public.eup_module_guard('league'); end if;

  -- 4. Rows, in the single lock order (campaign, mission, application, assignment, proof, upload), then
  -- 5. the gates. The id of the parent rows is read first without a lock: those columns never change.
  if (v_act ->> 'guard') <> 'reduce' then
    if (v_act ->> 'id') = 'mission' then
      v_mission := v_id;
    elsif (v_act ->> 'id') = 'assignment' then
      select ss.mission_id into v_mission from public.eup_assignments ss where ss.id = v_id and ss.tenant = v_house;
    elsif (v_act ->> 'id') = 'proof' then
      select ss.mission_id, ss.id into v_mission, v_link from public.eup_proofs pp join public.eup_assignments ss on ss.id = pp.assignment_id
       where pp.id = v_id and pp.tenant = v_house;
    end if;
    select mm.campaign_id into v_campaign from public.eup_missions mm where mm.id = v_mission and mm.tenant = v_house;
    if v_campaign is null then raise exception 'Not found' using errcode = 'P0002'; end if;
    select * into c from public.eup_campaigns cc where cc.id = v_campaign and cc.tenant = v_house for share;
    select * into m from public.eup_missions mm where mm.id = v_mission and mm.tenant = v_house for share;
    if (v_act ->> 'id') = 'assignment' then
      select * into s from public.eup_assignments ss where ss.id = v_id and ss.tenant = v_house for update;
    elsif (v_act ->> 'id') = 'proof' then
      select * into s from public.eup_assignments ss where ss.id = v_link and ss.tenant = v_house for share;
      select * into p from public.eup_proofs pp where pp.id = v_id and pp.tenant = v_house for update;
    end if;
    v_policy := public.eup_league_gate(v_house, p_actor, m.id,
      case v_act ->> 'id' when 'assignment' then s.participant when 'proof' then p.participant end,
      (v_act -> 'gates') ? 'media');
    -- uploads.begin answers the two refusals a client can act on with a hint (415, 413), before the generic check.
    if p_action = 'uploads.begin' and jsonb_typeof(v_doc) = 'object' then
      v_types := public.eup_league_contract('{media,types}');
      if jsonb_typeof(v_doc -> 'mime') = 'string' and (not (v_types ? (v_doc ->> 'mime'))
          or (jsonb_typeof(v_doc -> 'kind') = 'string' and (v_types -> (v_doc ->> 'mime') ->> 'kind') <> (v_doc ->> 'kind'))) then
        raise exception 'Media type not allowed' using errcode = '22023', hint = 'media_type_not_allowed'; end if;
      if jsonb_typeof(v_doc -> 'bytes') = 'number' and (v_doc ->> 'bytes')::numeric > (public.eup_league_contract('{media,hard_max_bytes}') #>> '{}')::numeric then
        raise exception 'Media too large' using errcode = '22023', hint = 'media_too_large'; end if;
    end if;
  end if;

  -- 6. The document and the expected revision, for the gated actions here and for the reduce-only ones after
  --    their own ownership check (so "not yours" never depends on what was sent).
  if (v_act ->> 'guard') <> 'reduce' then
    perform public.eup_league_require_document(v_act ->> 'document', v_doc);
    if v_act ? 'revision' and (p_revision is null or p_revision < coalesce((v_act ->> 'revision_min')::integer, 1)
        or p_revision > (public.eup_league_contract('{limits,revision_max}') #>> '{}')::integer) then
      raise exception 'Expected revision required' using errcode = '22023'; end if;
    -- Work on an assignment needs it accepted against the CURRENT requirements.
    if p_action in ('drafts.save', 'uploads.begin', 'proofs.submit') then
      if s.status in ('completed', 'withdrawn') then raise exception 'Assignment is closed' using errcode = '40001'; end if;
      if s.status <> 'accepted' or s.accepted_requirements_revision is distinct from m.requirements_revision then
        raise exception 'Accept the current requirements first' using errcode = 'EU013'; end if;
    end if;
  end if;

  case p_action
    when 'applications.save' then
      -- p_id is the MISSION. One document for save-as-draft and submit; p_revision 0 means "I have no application yet".
      select * into a from public.eup_applications aa where aa.mission_id = m.id and aa.applicant = p_actor and aa.tenant = v_house for update;
      if found then
        if p_revision <> a.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
        if a.status not in ('draft', 'changes_requested', 'submitted', 'withdrawn') or (a.status = 'submitted' and (v_doc -> 'submit') <> 'true'::jsonb) then
          raise exception 'Application cannot be changed now' using errcode = '40001'; end if;
      elsif p_revision <> 0 then
        raise exception 'Revision conflict' using errcode = '40001';
      end if;
      -- The applicant names the requirements they were shown; anything but the current revision means "look again".
      if (v_doc ->> 'requirements_revision')::numeric <> m.requirements_revision then raise exception 'Requirements changed' using errcode = 'EU013'; end if;
      v_status := case when (v_doc -> 'submit') = 'true'::jsonb then 'submitted' when a.status = 'changes_requested' then 'changes_requested' else 'draft' end;
      v_statement := case when v_doc ? 'statement' then v_doc ->> 'statement' else coalesce(a.document ->> 'statement', '') end;
      v_accommodation := case when v_doc ? 'accommodation' then nullif(v_doc -> 'accommodation', 'null'::jsonb) else a.accommodation end;
      if a.id is not null then
        -- The row's decision fields describe the decision behind its current status; the history keeps every one.
        update public.eup_applications aa set status = v_status, requirements_revision = m.requirements_revision,
            document = jsonb_build_object('statement', v_statement), accommodation = v_accommodation,
            decided_by = case when v_status = 'changes_requested' then aa.decided_by end,
            decision_reason = case when v_status = 'changes_requested' then aa.decision_reason end,
            decided_at = case when v_status = 'changes_requested' then aa.decided_at end,
            revision = aa.revision + 1, updated_at = now()
         where aa.id = a.id returning * into a;
      else
        insert into public.eup_applications(tenant, mission_id, requirements_revision, applicant, status, document, accommodation)
          values (v_house, m.id, m.requirements_revision, p_actor, v_status, jsonb_build_object('statement', v_statement), v_accommodation)
          on conflict (mission_id, applicant) do nothing returning * into a;
        if not found then raise exception 'Revision conflict' using errcode = '40001'; end if;
      end if;
      v_result := public.eup_league_member_application_json(a);

    when 'applications.withdraw' then
      select * into a from public.eup_applications aa where aa.id = v_id and aa.tenant = v_house for update;
      if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
      if a.applicant <> p_actor then raise exception 'Not the record of this account' using errcode = '42501'; end if;
      perform public.eup_league_require_document(v_act ->> 'document', v_doc);
      if a.status not in ('draft', 'submitted', 'changes_requested') then raise exception 'Application cannot be withdrawn now' using errcode = '40001'; end if;
      update public.eup_applications aa set status = 'withdrawn', revision = aa.revision + 1, updated_at = now() where aa.id = a.id returning * into a;
      v_result := public.eup_league_member_application_json(a);

    when 'assignments.accept' then
      if p_revision <> s.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
      if s.status <> 'offered' then raise exception 'Assignment is not offered' using errcode = '40001'; end if;
      -- What is accepted is exact: the current requirements revision and the current participation notice revision.
      if (v_doc ->> 'requirements_revision')::numeric <> m.requirements_revision
         or (v_doc ->> 'notice_revision') <> (v_policy #>> '{document,notices,participation,revision}') then
        raise exception 'Requirements or participation notice changed' using errcode = 'EU013'; end if;
      update public.eup_assignments ss set status = 'accepted', accepted_requirements_revision = m.requirements_revision,
          accepted_notice_revision = v_doc ->> 'notice_revision', accepted_at = now(), revision = ss.revision + 1, updated_at = now()
       where ss.id = s.id returning * into s;
      insert into public.eup_assignment_acceptances(tenant, assignment_id, requirements_revision, notice_revision, actor)
        values (v_house, s.id, s.accepted_requirements_revision, s.accepted_notice_revision, p_actor);
      v_result := public.eup_league_assignment_json(s);

    when 'assignments.withdraw' then
      select * into s from public.eup_assignments ss where ss.id = v_id and ss.tenant = v_house for update;
      if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
      if s.participant <> p_actor then raise exception 'Not the record of this account' using errcode = '42501'; end if;
      perform public.eup_league_require_document(v_act ->> 'document', v_doc);
      if s.status not in ('offered', 'accepted') then raise exception 'Assignment cannot be withdrawn now' using errcode = '40001'; end if;
      perform 1 from public.eup_proofs pp where pp.assignment_id = s.id and pp.tenant = v_house for update;
      -- The seat is freed. The uploads stay until the retention date for withdrawn work.
      update public.eup_assignments ss set status = 'withdrawn', withdrawn_at = now(), revision = ss.revision + 1, updated_at = now()
       where ss.id = s.id returning * into s;
      perform public.eup_league_release_assignments(v_house, array[s.id], p_actor, 'assignment_withdrawn');
      v_result := public.eup_league_assignment_json(s);

    when 'drafts.save' then
      -- p_id is the ASSIGNMENT. Full replace of the working copy; p_revision 0 means "no draft yet".
      select * into d from public.eup_proof_drafts dd where dd.assignment_id = s.id and dd.tenant = v_house for update;
      if found then
        if p_revision <> d.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
        update public.eup_proof_drafts dd set document = v_doc, revision = dd.revision + 1, updated_at = now() where dd.assignment_id = s.id returning * into d;
      else
        if p_revision <> 0 then raise exception 'Revision conflict' using errcode = '40001'; end if;
        insert into public.eup_proof_drafts(assignment_id, tenant, participant, document) values (s.id, v_house, p_actor, v_doc) returning * into d;
      end if;
      v_result := jsonb_build_object('assignment_id', d.assignment_id, 'revision', d.revision, 'updated_at', d.updated_at);

    when 'uploads.begin' then
      -- Creates the staged row only. The result carries no URL and no path: the Worker signs one upload for the
      -- path it derives from the row ids.
      v_kind := v_doc ->> 'kind';
      if not coalesce((v_policy #> '{document,media,kinds}') ? v_kind, false) or not (v_kind = any (m.proof_modes)) then
        raise exception 'Media type not allowed' using errcode = '22023', hint = 'media_type_not_allowed'; end if;
      v_cap := (v_policy #>> array['document', 'media', v_kind || '_max_bytes'])::numeric::integer;
      if v_cap is null or (v_doc ->> 'bytes')::numeric > v_cap then
        raise exception 'Media too large' using errcode = '22023', hint = 'media_too_large'; end if;
      insert into public.eup_media_uploads(tenant, assignment_id, participant, kind, mime, ext, declared_bytes, max_bytes, duration_seconds, expires_at)
        values (v_house, s.id, p_actor, v_kind, v_doc ->> 'mime', public.eup_league_contract(array['media', 'types', v_doc ->> 'mime', 'ext']) #>> '{}',
          (v_doc ->> 'bytes')::numeric::integer, v_cap, (v_doc ->> 'duration_seconds')::numeric::integer,
          now() + make_interval(secs => (public.eup_league_contract('{media,staged_ttl_seconds}') #>> '{}')::integer))
        returning * into u;
      v_result := public.eup_league_upload_json(u, false);

    when 'uploads.discard' then
      select * into u from public.eup_media_uploads uu where uu.id = v_id and uu.tenant = v_house for update;
      if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
      if u.participant <> p_actor then raise exception 'Not the record of this account' using errcode = '42501'; end if;
      perform public.eup_league_require_document(v_act ->> 'document', v_doc);
      if u.state not in ('staged', 'sealed', 'rejected') then raise exception 'Upload cannot be discarded now' using errcode = '40001'; end if;
      -- A file the current proof revision lists is evidence under review: withdraw the assignment instead.
      if exists (select 1 from public.eup_proofs pp join public.eup_proof_media pm on pm.proof_id = pp.id and pm.proof_revision = pp.revision
                  where pp.assignment_id = u.assignment_id and pm.upload_id = u.id) then
        raise exception 'Upload is listed by the current proof' using errcode = 'EU014'; end if;
      update public.eup_media_uploads uu set state = 'discarded', discarded_at = now(), updated_at = now() where uu.id = u.id returning * into u;
      v_result := public.eup_league_upload_json(u, false);

    when 'proofs.submit' then
      -- p_id is the ASSIGNMENT; p_revision is the proof revision being replaced, 0 for the first submission.
      -- The document is the whole proof: the receipt digest then covers exactly what was submitted.
      select * into p from public.eup_proofs pp where pp.assignment_id = s.id and pp.tenant = v_house for update;
      if found then
        if p_revision <> p.revision or p.state not in ('submitted', 'needs_changes') then raise exception 'Revision conflict' using errcode = '40001'; end if;
      elsif p_revision <> 0 then
        raise exception 'Revision conflict' using errcode = '40001';
      end if;
      if public.eup_league_contract(array['template_rules', m.template]) is null then
        raise exception 'This mission template has no proof rule' using errcode = '22023'; end if;
      -- Media: only files this participant uploaded for this assignment, sealed, and with the digest they were shown.
      for v_entry in select t.e from jsonb_array_elements(coalesce(v_doc -> 'media', '[]'::jsonb)) with ordinality t(e, ord) order by t.ord loop
        select * into u from public.eup_media_uploads uu where uu.id = (v_entry ->> 'upload_id')::uuid and uu.tenant = v_house for update;
        if not found or u.assignment_id <> s.id or u.participant <> p_actor or u.state <> 'sealed' or u.sha256 is distinct from (v_entry ->> 'sha256') then
          raise exception 'An upload is missing, unsealed, foreign, purged or changed' using errcode = 'EU014'; end if;
        if not (u.kind = any (m.proof_modes)) then raise exception 'This mission does not take that kind of media' using errcode = '22023'; end if;
        v_media := v_media || jsonb_build_object('upload_id', u.id, 'kind', u.kind, 'mime', u.mime, 'bytes', u.bytes, 'sha256', u.sha256);
      end loop;
      if (v_doc ->> 'review_notice_revision') <> (v_policy #>> '{document,notices,private_review,revision}') then
        raise exception 'The private review notice changed' using errcode = 'EU015'; end if;
      -- The manifest is built here from validated values and sealed rows, never taken from the caller.
      v_manifest := jsonb_build_object('schema', public.eup_league_contract('{manifest_schema}'), 'tenant', v_house::text, 'mission_id', m.id::text,
        'assignment_id', s.id::text, 'requirements_revision', s.accepted_requirements_revision, 'title', v_doc -> 'title', 'lyrics', v_doc -> 'lyrics',
        'credits', v_doc -> 'credits', 'rights', v_doc -> 'rights', 'media', v_media, 'accommodation', coalesce(v_doc -> 'accommodation', 'null'::jsonb));
      v_asset := public.eup_league_asset_revision(v_manifest);
      if p.id is not null then
        update public.eup_proofs pp set revision = pp.revision + 1, state = 'submitted', asset_revision = v_asset, updated_at = now() where pp.id = p.id returning * into p;
      else
        insert into public.eup_proofs(tenant, assignment_id, participant, asset_revision) values (v_house, s.id, p_actor, v_asset) returning * into p;
      end if;
      insert into public.eup_proof_revisions(proof_id, revision, tenant, requirements_revision, asset_revision, document, actor)
        values (p.id, p.revision, v_house, s.accepted_requirements_revision, v_asset, v_doc, p_actor);
      insert into public.eup_proof_media(proof_id, proof_revision, ordinal, tenant, upload_id, kind, mime, bytes, sha256)
        select p.id, p.revision, t.ord::integer, v_house, (t.e ->> 'upload_id')::uuid, t.e ->> 'kind', t.e ->> 'mime', (t.e ->> 'bytes')::integer, t.e ->> 'sha256'
          from jsonb_array_elements(v_media) with ordinality t(e, ord);
      -- A new revision supersedes the open consents of earlier ones, and submitting IS the private-review consent.
      update public.eup_consents kk set superseded_at = now()
       where kk.proof_id = p.id and kk.proof_revision < p.revision and kk.revoked_at is null and kk.superseded_at is null;
      insert into public.eup_consents(tenant, mission_id, assignment_id, proof_id, proof_revision, asset_revision, actor, purpose, audience, notice_revision)
        values (v_house, m.id, s.id, p.id, p.revision, v_asset, p_actor, 'private_review', 'reviewers', v_doc ->> 'review_notice_revision') returning * into k;
      v_result := jsonb_build_object('id', p.id, 'assignment_id', p.assignment_id, 'revision', p.revision, 'state', p.state, 'asset_revision', p.asset_revision,
        'moderation_state', p.moderation_state, 'publication_state', p.publication_state, 'media', public.eup_league_proof_media_json(p.id, p.revision),
        'consent', public.eup_league_member_consent_json(k), 'created_at', p.created_at, 'updated_at', p.updated_at);

    when 'consents.grant' then
      -- p_id is the PROOF; p_revision is the proof revision the consent is for. A consent publishes nothing:
      -- publication is a separate owner command.
      if p_revision <> p.revision then raise exception 'Revision conflict' using errcode = '40001'; end if;
      if p.moderation_state = 'held' then raise exception 'Proof is held' using errcode = 'EU016'; end if;
      v_expires := (v_doc ->> 'expires_at')::timestamptz;
      if p.state <> 'accepted' or (v_doc ->> 'asset_revision') <> p.asset_revision
         or (v_doc ->> 'notice_revision') <> (v_policy #>> '{document,notices,publication,revision}')
         or v_expires <= now() or v_expires > now() + make_interval(days => (public.eup_league_contract('{limits,consent_max_days}') #>> '{}')::integer) then
        raise exception 'The consent does not match its exact scope' using errcode = 'EU015'; end if;
      if exists (select 1 from public.eup_consents kk where kk.proof_id = p.id and kk.purpose = 'publish_proof' and kk.revoked_at is null and kk.superseded_at is null) then
        raise exception 'A publication consent is already open for this proof' using errcode = '23505'; end if;
      insert into public.eup_consents(tenant, mission_id, assignment_id, proof_id, proof_revision, asset_revision, actor, purpose, audience, notice_revision, expires_at)
        values (v_house, m.id, s.id, p.id, p.revision, p.asset_revision, p_actor, 'publish_proof', 'released_audience', v_doc ->> 'notice_revision', v_expires)
        returning * into k;
      v_result := public.eup_league_member_consent_json(k);

    when 'consents.revoke' then
      -- By consent id, at any proof revision, in every campaign, mission, grant and module state.
      select kk.proof_id, kk.actor into v_link, v_holder from public.eup_consents kk where kk.id = v_id and kk.tenant = v_house;
      if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
      if v_holder <> p_actor then raise exception 'Not the record of this account' using errcode = '42501'; end if;
      perform 1 from public.eup_proofs pp where pp.id = v_link and pp.tenant = v_house for update;
      select * into k from public.eup_consents kk where kk.id = v_id and kk.tenant = v_house for update;
      perform public.eup_league_require_document(v_act ->> 'document', v_doc);
      -- The private-review consent ends with the assignment or a newer revision, never by this command.
      if k.purpose <> 'publish_proof' then raise exception 'Only a publication consent is revoked by command' using errcode = '22023'; end if;
      if k.revoked_at is not null or k.superseded_at is not null then raise exception 'Consent is already closed' using errcode = '40001'; end if;
      update public.eup_consents kk set revoked_at = now(), revoked_by = p_actor where kk.id = k.id returning * into k;
      -- (Second pass: the publication bound to this consent is withdrawn here, in this transaction.)
      v_result := public.eup_league_member_consent_json(k) || jsonb_build_object('publication', null);

    else
      raise exception 'Unknown action' using errcode = '22023';
  end case;

  insert into public.eup_command_receipts(tenant, actor, surface, operation, idempotency_key, payload_digest, result)
    values (v_house, p_actor, 'member', p_action, p_key, v_digest, v_result);
  return v_result;
end $$;

-- ---------------------------------------------------------------- media seal
-- Called only by the Worker, after it read the stored object itself: p_result is what the Worker measured (byte
-- count, SHA-256, magic-byte family, storage identity), never what the client claimed. No idempotency key: the
-- seal is idempotent by state, and the digest and identity are written once.
create function public.eup_league_media_seal(p_upload uuid, p_actor uuid, p_result jsonb)
returns jsonb language plpgsql security invoker set search_path = '' set lock_timeout = '5s' as $$
declare
  v_house uuid; v_mission uuid; v_campaign uuid; v_doc jsonb := coalesce(p_result, '{}'::jsonb); v_bytes numeric;
  u public.eup_media_uploads%rowtype;
begin
  select oo.id into v_house from public.orgs oo where oo.slug = 'mccluster' limit 1;
  if p_actor is null or v_house is null or not public.eup_league_actor_known(p_actor) then
    raise exception 'A signed-in account is required' using errcode = '42501'; end if;
  if octet_length(v_doc::text) > (public.eup_league_contract('{limits,document_max_bytes}') #>> '{}')::integer then
    raise exception 'Document too large' using errcode = '22023'; end if;
  -- Sealing is new work: the normal guard for both outcomes. While the module drains a staged upload stays staged.
  perform public.eup_module_guard('league');
  select mm.id, mm.campaign_id into v_mission, v_campaign
    from public.eup_media_uploads uu join public.eup_assignments ss on ss.id = uu.assignment_id join public.eup_missions mm on mm.id = ss.mission_id
   where uu.id = p_upload and uu.tenant = v_house;
  if not found then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform 1 from public.eup_campaigns cc where cc.id = v_campaign and cc.tenant = v_house for share;
  perform 1 from public.eup_missions mm where mm.id = v_mission and mm.tenant = v_house for share;
  select * into u from public.eup_media_uploads uu where uu.id = p_upload and uu.tenant = v_house for update;
  perform public.eup_league_gate(v_house, p_actor, v_mission, u.participant, true);
  perform public.eup_league_require_document('seal_result', v_doc);

  if u.state = 'staged' then
    if now() > u.expires_at then
      -- Not an error: the state is committed, and the Worker deletes the object after this answer.
      update public.eup_media_uploads uu set state = 'expired', updated_at = now() where uu.id = u.id returning * into u;
    elsif v_doc ->> 'outcome' = 'sealed' then
      v_bytes := (v_doc ->> 'bytes')::numeric;
      -- A recorder knows its blob size, so a different size is a different file. (storage.size = bytes is a document rule.)
      if v_bytes <> u.declared_bytes or v_bytes > u.max_bytes or v_bytes > (public.eup_league_contract('{media,hard_max_bytes}') #>> '{}')::numeric
         or not coalesce(public.eup_league_contract(array['media', 'types', u.mime, 'families']) ? (v_doc ->> 'family'), false) then
        raise exception 'The stored object is not the declared upload' using errcode = 'EU014'; end if;
      update public.eup_media_uploads uu set state = 'sealed', bytes = v_bytes::integer, sha256 = v_doc ->> 'sha256', family = v_doc ->> 'family',
          storage_object_id = (v_doc #>> '{storage,object_id}')::uuid, storage_etag = v_doc #>> '{storage,etag}',
          storage_size = (v_doc #>> '{storage,size}')::numeric::integer, sealed_at = now(), updated_at = now()
       where uu.id = u.id returning * into u;
    else
      update public.eup_media_uploads uu set state = 'rejected', rejected_reason = v_doc ->> 'reason', updated_at = now() where uu.id = u.id returning * into u;
    end if;
  elsif u.state = 'sealed' and v_doc ->> 'outcome' = 'sealed' then
    -- Written once: the same measurement returns the row unchanged, a different one is refused.
    if u.sha256 <> (v_doc ->> 'sha256') or u.bytes <> (v_doc ->> 'bytes')::numeric or u.family <> (v_doc ->> 'family')
       or u.storage_object_id <> (v_doc #>> '{storage,object_id}')::uuid or u.storage_etag <> (v_doc #>> '{storage,etag}')
       or u.storage_size <> (v_doc #>> '{storage,size}')::numeric then
      raise exception 'The upload is sealed with a different digest or identity' using errcode = 'EU014'; end if;
  elsif u.state = 'rejected' and v_doc ->> 'outcome' = 'rejected' and u.rejected_reason = (v_doc ->> 'reason') then
    null;
  else
    raise exception 'Upload cannot be sealed now' using errcode = '40001';
  end if;
  return public.eup_league_upload_json(u, true);
end $$;

-- Functions: nothing for public, anon or authenticated; service_role executes them. The three entry points are
-- eup_league_command, eup_league_member_command and eup_league_media_seal; the rest are the helpers those
-- SECURITY INVOKER functions call (an invoker function can only call what its caller may execute).
do $$
declare v_function text;
begin
  for v_function in select format('public.%I(%s)', pp.proname, pg_catalog.pg_get_function_identity_arguments(pp.oid))
      from pg_catalog.pg_proc pp where pp.pronamespace = 'public'::regnamespace and pp.proname like 'eup\_league\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_function);
    execute format('grant execute on function %s to service_role', v_function);
  end loop;
end $$;
commit;
