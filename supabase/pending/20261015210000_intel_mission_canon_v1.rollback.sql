-- Rollback for 20261015210000_intel_mission_canon_v1.sql (PENDING; not applied).
--
-- Drops only what the canon added. It never touches the tables it reuses
-- (ops_ingest_connectors/runs/records, ai_context.decisions, action_missions,
-- action_proofs, orgs, org_members, control_audit).
--
-- DATA NOTE: missions created through intel_create_mission_from_decision stay
-- in action_missions (as 'draft' unless an admin published them); only their
-- private decision link is dropped. Source snapshots written by the collector
-- stay in ops_ingest_records/ops_ingest_runs under connector
-- 'usgs.earthquakes'; delete them deliberately if wanted:
--   delete from public.ops_ingest_connectors where connector_key = 'usgs.earthquakes';
--   (cascades to its runs and records)
-- Export anything worth keeping before running this file.

drop function if exists public.intel_prune_expired_evidence(uuid, integer);
drop function if exists public.intel_health(uuid, text);
drop function if exists public.intel_geo_projection(uuid, text, timestamptz, timestamptz, integer, text, integer);
drop function if exists public.intel_lineage(uuid, uuid);
drop function if exists public.intel_review_outcome(uuid, uuid, uuid, text, text, uuid, text);
drop function if exists public.intel_submit_outcome(uuid, uuid, uuid, text, text, timestamptz, jsonb, uuid[]);
drop function if exists public.intel_create_mission_from_decision(uuid, uuid, uuid, text, jsonb);
drop function if exists public.intel_record_decision_basis(uuid, uuid, uuid, uuid);
drop function if exists public.intel_create_briefing(uuid, uuid, text, text, jsonb, text);
drop function if exists public.intel_create_claim(uuid, uuid, text, text, text, jsonb, text);
drop function if exists public.intel_review(uuid, uuid, text, uuid, text, text, numeric, text);
drop function if exists public.intel_collector_commit(uuid, uuid, jsonb, jsonb, jsonb);
drop function if exists public.intel_collector_fail(uuid, uuid, text, jsonb);
drop function if exists public.intel_collector_begin(uuid, text, jsonb, integer);
drop function if exists public.intel_decision_state(uuid, uuid);

drop table if exists public.intel_outcome_proofs;
drop table if exists public.intel_decision_basis;
drop table if exists public.intel_briefing_citations;
drop table if exists public.intel_briefings;
drop table if exists public.intel_claim_evidence;
drop table if exists public.intel_reviews;
drop table if exists public.intel_claims;
drop table if exists public.intel_evidence;
drop table if exists public.intel_mission_decisions;
drop table if exists public.intel_outcomes;

drop function if exists public.intel_is_org_admin(uuid);
