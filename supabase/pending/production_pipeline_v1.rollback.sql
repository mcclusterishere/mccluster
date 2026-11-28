-- Rollback for production_pipeline_v1.sql. Drops the production records
-- and the cancel RPC; ops_compute_tasks and its rows are not touched.
begin;
drop function if exists public.production_request_compute_cancel(uuid, uuid, text);
drop table if exists public.production_artifacts;
drop table if exists public.production_jobs;
drop table if exists public.production_shots;
drop table if exists public.production_consents;
drop table if exists public.production_assets;
drop table if exists public.production_members;
drop table if exists public.production_projects;
commit;
