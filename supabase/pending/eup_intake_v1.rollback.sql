-- Rollback for supabase/pending/eup_intake_v1.sql: removes the E=Up private
-- intake store (functions first, then tables in dependency order). Every row of
-- admin intake, snapshot history, review items and corrections is LOST; the
-- public civic_* and action_policy_* tables were never touched by the forward
-- file and are untouched here. Recovery artifact, not a forward migration.
--
-- Module policy: this file removes only what eup_intake_v1.sql created. The
-- *_module_policy statement triggers go with their tables; the policy objects
-- of eup_module_policy_v1.sql (the guard functions, the 'intake' policy row and
-- the command log) are NOT touched, so the module keeps its state and its
-- history. Run this BEFORE eup_module_policy_v1.rollback.sql. It is DDL, so the
-- module state does not gate it. Both the current and the earlier signatures of
-- eup_intake_apply and eup_import_run_finish are dropped. Safe to run twice.
set local lock_timeout = '5s';

drop function if exists public.eup_import_run_claim(text, text, integer);
drop function if exists public.eup_import_run_release(uuid, text, text);
drop function if exists public.eup_import_run_finish(uuid, text, integer, text, jsonb, text);
drop function if exists public.eup_import_run_finish(uuid, text, integer, text, jsonb);
drop function if exists public.eup_intake_apply(text, text, jsonb, bigint);
drop function if exists public.eup_intake_apply(text, text, jsonb);
drop function if exists public.eup_company_read(text, jsonb);
drop function if exists public.eup_civic_read(text, jsonb);
drop function if exists public.eup_sources_read(text, jsonb);
drop function if exists public.eup_sources_command(text, jsonb, uuid);
drop function if exists public.eup_record_snapshot(text, text, text, jsonb, jsonb);
drop function if exists public.eup_check_provenance(jsonb);
drop trigger if exists eup_record_snapshots_immutable on public.eup_record_snapshots;
drop function if exists public.eup_snapshot_immutable();

drop table if exists public.eup_corrections;
drop table if exists public.eup_review_items;
drop table if exists public.eup_company_awards;
drop table if exists public.eup_company_facts;
drop table if exists public.eup_company_locations;
drop table if exists public.eup_company_identifiers;
drop table if exists public.eup_company_entities;
drop table if exists public.eup_civic_election_results;
drop table if exists public.eup_civic_candidacies;
drop table if exists public.eup_civic_election_contests;
drop table if exists public.eup_civic_roll_calls;
drop table if exists public.eup_civic_bill_amendments;
drop table if exists public.eup_civic_bill_actions;
drop table if exists public.eup_civic_bill_versions;
drop table if exists public.eup_civic_bills;
drop table if exists public.eup_civic_committees;
drop table if exists public.eup_civic_terms;
drop table if exists public.eup_civic_persons;
drop table if exists public.eup_civic_offices;
drop table if exists public.eup_civic_boundary_versions;
drop table if exists public.eup_civic_jurisdiction_relations;
drop table if exists public.eup_civic_jurisdictions;
drop table if exists public.eup_record_snapshots;
drop table if exists public.eup_import_runs;
drop table if exists public.eup_source_registry_state;
