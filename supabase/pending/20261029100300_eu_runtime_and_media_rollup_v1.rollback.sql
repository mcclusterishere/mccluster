-- Rollback of supabase/migrations/20261029011534_eu_runtime_and_media_rollup_v1.sql. Drops what
-- it created. private.eu_runtime and private.eu_oauth_states hold only Vault ids and
-- short-lived OAuth state; the Vault secrets themselves are left in place. If
-- eu_cron_install_service() was called after the apply, unschedule its six jobs first
-- (select cron.unschedule(j) from unnest(array['eu-core-worker','eu-external-worker',
-- 'eu-ddex-worker','eu-monitor','eu-google-watch-renew','eu-google-history-safety-sync']) j
-- where exists (select 1 from cron.job where jobname = j)).

set local lock_timeout = '5s';

drop function if exists public.media_usage_rollup(uuid, timestamptz, timestamptz, text);
drop function if exists private.eu_out_event_communication_bridge();
drop function if exists private.eu_event_dispatch();
drop function if exists public.eu_claim_external_jobs_service(text, integer, integer);
drop function if exists public.eu_claim_ddex_jobs_service(text, integer, integer);
drop function if exists private.eu_claim_ddex_jobs(text, integer, integer);
drop function if exists private.eu_claim_external_jobs(text, integer, integer);
drop function if exists public.eu_claim_monitors_service(integer);
drop function if exists private.eu_claim_monitors(integer);
drop function if exists private.eu_monitor_interval(text);
drop index if exists public.eu_monitors_identity_idx;
drop function if exists public.eu_cron_install_service();
drop function if exists private.eu_cron_google(text);
drop function if exists private.eu_cron_worker(text, integer);
drop function if exists private.eu_runtime_secret(uuid);
drop function if exists public.eu_runtime_configure_service(uuid, text, text, text);
drop table if exists private.eu_runtime;
drop function if exists public.eu_oauth_state_gc_service();
drop function if exists public.eu_vault_store_service(text, text, text);
drop function if exists public.eu_oauth_state_consume_service(text, text);
drop function if exists public.eu_oauth_state_create_service(text, uuid, uuid, text, text, integer);
drop table if exists private.eu_oauth_states;
