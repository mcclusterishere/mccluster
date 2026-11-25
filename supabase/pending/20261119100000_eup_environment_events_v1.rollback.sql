-- Recovery artifact for 20261119100000_eup_environment_events_v1_01.sql to _05.sql: never a forward migration.
--
-- Owner approval required, like the forward parts. Run it as postgres, as the parts are applied (the Supabase MCP
-- `apply_migration` runs as postgres), under the name `eup_environment_events_v1_rollback`.
--
-- What it does, in one transaction: drops every object the five parts create, whichever of them ran (0 to 5 parts),
-- functions that depend on others first and the tables before the helpers their CHECK constraints call. Nothing outside
-- the store is touched: the module policy, its rows and its command log stay as they are. Safe to run twice.
-- The store's rows are LOST with it: the events, their revisions, aliases, provider rules, the health log, the owner's
-- decision log and the coverage. Export them first after real use. Roll back the Worker routes that call these
-- functions first (later slices), or they answer 503 once it has run.
begin;
set local lock_timeout = '5s';

-- part 05
drop function if exists public.eup_environment_coverage_propose(jsonb);
drop function if exists public.eup_environment_coverage_input(jsonb);
-- part 04
drop function if exists public.eup_environment_owner_command(uuid, text, text, bigint, text, text, jsonb);
drop function if exists public.eup_environment_owner_read(uuid, text, integer);
-- part 03
drop function if exists public.eup_environment_ingest_state(text, timestamptz, integer);
drop function if exists public.eup_environment_ingest(text, text, timestamptz, jsonb, jsonb);
drop function if exists public.eup_environment_usgs_input(jsonb);
-- part 02
drop function if exists public.eup_environment_owner_preview(uuid, timestamptz, timestamptz, text, integer);
drop function if exists public.eup_environment_public_event(text);
drop function if exists public.eup_environment_public_events(timestamptz, timestamptz, text, integer);
drop function if exists public.eup_environment_usgs_changes(jsonb, jsonb);
drop function if exists public.eup_environment_coverage_follow(text, bigint, boolean, bigint);
drop function if exists public.eup_environment_owner_summary(text);
drop function if exists public.eup_environment_page(timestamptz, timestamptz, text, integer);
drop function if exists public.eup_environment_project(text);
drop function if exists public.eup_environment_public_coverage(text);
drop function if exists public.eup_environment_gate();
drop function if exists public.eup_environment_root(text);
drop function if exists public.eup_environment_house_owner(uuid);
-- part 01: the tables (their triggers and indexes go with them), then the helpers
drop table if exists public.eup_environment_coverage;
drop table if exists public.eup_environment_decisions;
drop table if exists public.eup_environment_source_health;
drop table if exists public.eup_environment_event_aliases;
drop table if exists public.eup_environment_event_revisions;
drop table if exists public.eup_environment_events;
drop table if exists public.eup_environment_providers;
drop function if exists public.eup_environment_event_consistent();
drop function if exists public.eup_environment_guard();
drop function if exists public.eup_environment_qualifies(text, jsonb, jsonb, integer);
drop function if exists public.eup_environment_rule_valid(text, jsonb);
drop function if exists public.eup_environment_default_rule(text);
drop function if exists public.eup_environment_inc(jsonb, text);
drop function if exists public.eup_environment_km(numeric, numeric, numeric, numeric);
drop function if exists public.eup_environment_iso(jsonb);
drop function if exists public.eup_environment_iso_text(timestamptz);
drop function if exists public.eup_environment_state_of(text, timestamptz, timestamptz, timestamptz, timestamptz);
commit;
