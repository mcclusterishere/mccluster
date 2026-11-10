-- Recovery artifact for pending/eup_league_v1.sql: never a forward migration.
-- Drops the private Environmental Justice League records: policy, campaigns, missions, applications,
-- assignments, drafts, upload rows, proofs, reviews, moderation history, credits, consents, publications, appeals,
-- the outbox and its acknowledgements, the accommodation access record and the receipts recorded here are lost. The
-- stored media objects are NOT touched by this file: purge them first, or they stay in the private bucket with
-- no row that names them. Do not run after real participation without an export and a coordinated recovery
-- decision. The module policy (eup_module_policy_v1.sql) is a separate file and stays.
begin;
set local lock_timeout = '5s';
do $$
declare v_function text;
begin
  for v_function in select format('public.%I(%s)', pp.proname, pg_catalog.pg_get_function_identity_arguments(pp.oid))
      from pg_catalog.pg_proc pp where pp.pronamespace = 'public'::regnamespace and pp.proname like 'eup\_league\_%' loop
    execute format('drop function %s', v_function);
  end loop;
end $$;
drop table if exists public.eup_outbox_consumptions;
drop table if exists public.eup_outbox;
drop table if exists public.eup_accommodation_reads;
drop table if exists public.eup_appeals;
drop table if exists public.eup_publications;
drop table if exists public.eup_proof_moderations;
drop table if exists public.eup_command_receipts;
drop table if exists public.eup_consents;
drop table if exists public.eup_mission_credits;
drop table if exists public.eup_proof_reviews;
drop table if exists public.eup_proof_media;
drop table if exists public.eup_proof_revisions;
drop table if exists public.eup_proofs;
drop table if exists public.eup_media_uploads;
drop table if exists public.eup_proof_drafts;
drop table if exists public.eup_assignment_acceptances;
drop table if exists public.eup_assignments;
drop table if exists public.eup_application_decisions;
drop table if exists public.eup_applications;
drop table if exists public.eup_mission_revisions;
drop table if exists public.eup_missions;
drop table if exists public.eup_campaign_audience_grants;
drop table if exists public.eup_campaign_revisions;
drop table if exists public.eup_campaigns;
drop table if exists public.eup_league_policy_revisions;
drop table if exists public.eup_league_policy;
commit;
