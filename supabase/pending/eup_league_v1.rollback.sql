-- Recovery artifact for pending/eup_league_v1.sql: never a forward migration.
-- Drops the private Environmental Justice League intake. Applications, proofs,
-- reviews and consents recorded here are lost; do not run after real
-- participation without an export and a coordinated recovery decision.
begin;
drop function if exists public.eup_league_command(text, uuid, text, jsonb, integer, text);
drop function if exists public.eup_league_text_ok(jsonb, integer);
drop table if exists public.eup_command_receipts;
drop table if exists public.eup_consents;
drop table if exists public.eup_proof_reviews;
drop table if exists public.eup_proof_revisions;
drop table if exists public.eup_proofs;
drop table if exists public.eup_assignments;
drop table if exists public.eup_applications;
drop table if exists public.eup_mission_revisions;
drop table if exists public.eup_missions;
drop table if exists public.eup_campaign_revisions;
drop table if exists public.eup_campaigns;
commit;
