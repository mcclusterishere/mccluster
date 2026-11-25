-- ROLLBACK for ai_context_source_pipelines_v1 (20261125010000_ai_context_source_pipelines_v1.sql). Owner approval required.
-- Drops only what the forward file created. ops_ingest_runs and ops_ingest_records rows it wrote are kept as audit
-- history; the three connectors are disabled, not deleted, because those rows reference them.
begin;
set local lock_timeout = '5s';
drop function if exists public.ops_ai_source_prune(uuid, uuid);
drop function if exists public.ops_ai_source_query(uuid, uuid, text, integer);
drop function if exists public.ops_ai_source_cursor(uuid, uuid, text, text);
drop function if exists public.ops_ai_source_ingest(uuid, uuid, text, text, jsonb, jsonb, text);
drop function if exists ai_context.source_text_array(jsonb);
drop function if exists ai_context.source_allowed_keys(text);
drop function if exists ai_context.source_require_owner(uuid, uuid);
drop table if exists ai_context.source_payments;
drop table if exists ai_context.source_calendar_events;
drop table if exists ai_context.source_messages;
update public.ops_ingest_connectors set enabled = false, updated_at = now()
 where connector_key in ('google.gmail', 'google.calendar', 'stripe.api');
commit;
