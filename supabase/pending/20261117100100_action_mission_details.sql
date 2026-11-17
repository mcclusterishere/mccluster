-- MISSION DETAILS: A MISSION'S PROOF HINT, SAFETY LINE AND CREDIT (action_mission_details v1)
--
-- PENDING. Not applied to production. Owner approval required. Apply as the service role with the
-- Supabase MCP `apply_migration` under the name `action_mission_details`, then promote with the steps in
-- supabase/pending/README.md ("To promote one"). Order: supabase/pending/PROMOTION-ORDER.md, section 10.
-- Rollback: 20261117100100_action_mission_details.rollback.sql.
-- Proof before apply: scripts/test/mission-catalog.native.integration.mjs.
--
-- Why. public.action_missions has no column for a proof hint, a safety line or a credit: proof_required is
-- a boolean (its 18 columns read-only on 2026-11-17). A mission written from a source catalog, the first
-- being Project Drawdown's (data/missions/drawdown/), must carry its credit wherever it is shown, and 43 of
-- those cite records licensed CC BY 4.0, whose licence requires the attribution. This table holds one row
-- per mission beside public.action_missions, so that table and everything that reads it stay unchanged.
--
-- What it creates, and nothing else (no function, no trigger, no change to an existing object):
--   public.action_mission_details: mission_id (the primary key, deleted with its mission), catalog and
--   slug (unique together), proof_hint, safety_note, credit_line (required), about and about_credit (only
--   together: a quotation is never shown without its credit), source_url, license_name and license_url
--   (only together), doi, created_at, updated_at. Every text column is bounded; source_url, license_url
--   and doi must be https URLs.
-- Who may read and write it:
--   "public reads open mission details": anon and authenticated may SELECT a row exactly when its mission
--   is publicly readable, by the same test as production's policy "public reads open missions" on
--   public.action_missions (status open, paused or closed, or public.eu_is_admin()). A draft mission's
--   details stay hidden with the mission.
--   "admins manage mission details" mirrors production's "admins manage missions" (authenticated,
--   public.eu_is_admin()). anon and authenticated are granted SELECT only, so only the service role writes
--   (it bypasses RLS); the admin policy lets an admin read the details of a draft, and nothing more.
-- Production's default privileges hand every new public table to anon and authenticated (insert, update,
-- delete included), so this file revokes everything from them before granting SELECT.
--
-- Creates no row: 20261117100200_action_mission_drawdown_import.sql fills it. Idempotent: safe to run twice.
begin;
set local lock_timeout = '5s';

create table if not exists public.action_mission_details (
  mission_id uuid not null,
  catalog text not null,
  slug text not null,
  proof_hint text,
  safety_note text,
  credit_line text not null,
  about text,
  about_credit text,
  source_url text,
  license_name text,
  license_url text,
  doi text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint action_mission_details_pkey primary key (mission_id),
  constraint action_mission_details_mission_id_fkey foreign key (mission_id)
    references public.action_missions(id) on delete cascade,
  constraint action_mission_details_catalog_slug_key unique (catalog, slug),
  constraint action_mission_details_catalog_check check (catalog ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint action_mission_details_slug_check
    check (char_length(slug) between 3 and 120 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint action_mission_details_proof_hint_check
    check (proof_hint is null or char_length(proof_hint) between 1 and 500),
  constraint action_mission_details_safety_note_check
    check (safety_note is null or char_length(safety_note) between 1 and 500),
  constraint action_mission_details_credit_line_check check (char_length(credit_line) between 1 and 1000),
  constraint action_mission_details_about_check check (about is null or char_length(about) between 1 and 1200),
  constraint action_mission_details_about_credit_check
    check (about_credit is null or char_length(about_credit) between 1 and 300),
  constraint action_mission_details_about_pair_check check ((about is null) = (about_credit is null)),
  constraint action_mission_details_source_url_check
    check (source_url is null or (char_length(source_url) between 9 and 500 and source_url ~ '^https://[^[:space:]]+$')),
  constraint action_mission_details_license_name_check
    check (license_name is null or char_length(license_name) between 1 and 100),
  constraint action_mission_details_license_url_check
    check (license_url is null or (char_length(license_url) between 9 and 500 and license_url ~ '^https://[^[:space:]]+$')),
  constraint action_mission_details_license_pair_check check ((license_name is null) = (license_url is null)),
  constraint action_mission_details_doi_check
    check (doi is null or (char_length(doi) between 20 and 300 and doi ~ '^https://doi[.]org/10[.][0-9]{4,9}/[^[:space:]]+$'))
);
comment on table public.action_mission_details is
  'One row per mission: proof hint, safety note and the credit a sourced mission must carry. Readable exactly when its mission is (open, paused or closed, or an admin); written by the service role.';
comment on column public.action_mission_details.credit_line is
  'Shown in full in the mission''s detail view; a feed card shows a compact source line that opens it.';
comment on column public.action_mission_details.about is
  'A short excerpt shown only as a quotation, with about_credit directly beneath it.';

alter table public.action_mission_details enable row level security;
revoke all on table public.action_mission_details from public, anon, authenticated;
grant select on table public.action_mission_details to anon, authenticated;
grant all on table public.action_mission_details to service_role;

drop policy if exists "public reads open mission details" on public.action_mission_details;
create policy "public reads open mission details" on public.action_mission_details
  as permissive for select to anon, authenticated
  using (exists (
    select 1 from public.action_missions m
     where m.id = action_mission_details.mission_id
       and ((m.status = any (array['open'::text, 'paused'::text, 'closed'::text])) or (select public.eu_is_admin()))
  ));
drop policy if exists "admins manage mission details" on public.action_mission_details;
create policy "admins manage mission details" on public.action_mission_details
  as permissive for all to authenticated
  using ((select public.eu_is_admin()))
  with check ((select public.eu_is_admin()));

commit;
