-- Rollback of supabase/migrations/20261124164529_ai_context_workstreams_v1.sql (migration name ai_context_workstreams_v1_rollback).
-- PENDING ONLY. Never applied. Never a forward migration. Owner approval required; applied as postgres.
-- All or nothing. It refuses (55000), changing nothing, while either table holds a row: the checkpoint log is the
-- record of where the work stood, and dropping it is a data deletion, not a schema change. To delete that record
-- on purpose, the owner exports it first and then runs this file with
--   set local mccluster.workstreams_drop_data = 'on';
-- as the first statement after begin. It drops the four public functions, the two tables (with their triggers and
-- indexes) and the private helpers. It does not touch ai_context.decisions: a decision proposed through a
-- checkpoint (metadata.ingress = 'workstream-checkpoint') stays where every decision lives.
-- Roll Core back first, or leave it: core.resume reports the source as missing and keeps working either way.
begin;
set local lock_timeout = '5s';
do $refuse$
declare
  n_streams bigint := 0;
  n_events bigint := 0;
begin
  if to_regclass('ai_context.workstreams') is not null then
    execute 'select count(*) from ai_context.workstreams' into n_streams;
  end if;
  if to_regclass('ai_context.workstream_events') is not null then
    execute 'select count(*) from ai_context.workstream_events' into n_events;
  end if;
  if n_streams + n_events > 0 and coalesce(current_setting('mccluster.workstreams_drop_data', true), '') <> 'on' then
    raise exception 'ai_context_workstreams_v1 rollback refused: % workstream(s) and % event(s) would be deleted; nothing changed', n_streams, n_events using errcode = '55000';
  end if;
end $refuse$;

drop function if exists public.ops_ai_workstream_resume(uuid, integer, text, text, uuid);
drop function if exists public.ops_ai_workstream_checkpoint(uuid, jsonb, text, jsonb, jsonb);
drop function if exists public.ops_ai_workstream_event_append(uuid, text, text, jsonb, jsonb);
drop function if exists public.ops_ai_workstream_upsert(uuid, jsonb, jsonb);
drop function if exists ai_context.workstream_resume_events(uuid, text, integer);
do $shapes$
begin
  if to_regclass('ai_context.workstream_events') is not null then
    execute 'drop function if exists ai_context.workstream_event_json(ai_context.workstream_events, integer)';
  end if;
  if to_regclass('ai_context.workstreams') is not null then
    execute 'drop function if exists ai_context.workstream_json(ai_context.workstreams)';
  end if;
end $shapes$;
drop table if exists ai_context.workstream_events;
drop table if exists ai_context.workstreams;
drop function if exists ai_context.workstream_events_append_only();
drop function if exists ai_context.workstream_limit(text);
drop function if exists ai_context.workstream_ceiling(jsonb);
drop function if exists ai_context.workstream_provenance(uuid, jsonb);
drop function if exists ai_context.workstream_time(text, text);
drop function if exists ai_context.workstream_uuid(text, text);
drop function if exists ai_context.workstream_require_house(uuid);
drop function if exists ai_context.workstream_sensitivity_rank(text);
drop function if exists ai_context.workstream_text(text, text, integer, boolean);
drop function if exists ai_context.workstream_looks_transcript(text);
drop function if exists ai_context.workstream_looks_secret(text);
commit;
