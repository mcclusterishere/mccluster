-- supabase/pending/20261029100300_eu_runtime_and_media_rollup_v1.sql on its stub: the service
-- RPCs the edge functions and the Worker call work for service_role and are refused to anon
-- and authenticated; nothing is scheduled and no trigger is attached by the file.
-- Run by scripts/test-schema-hygiene-db.sh. Scratch database only.
\set ON_ERROR_STOP 1
reset role;
-- no trigger, no cron job
select t_eq(count(*), 0::bigint, 'triggers the file must not create')
  from pg_trigger where tgname in ('eu_events_dispatch', 'eu_out_events_communication_bridge');
select t_eq(count(*), 0::bigint, 'cron jobs the file must not schedule') from cron.job;

-- refused to the browser roles
select t_as('anon');
select t_denied($$select public.eu_claim_ddex_jobs_service('w', 1, 60)$$, 'permission denied for function eu_claim_ddex_jobs_service');
select t_denied($$select public.media_usage_rollup('aaaaaaaa-0000-4000-8000-000000000001')$$, 'permission denied for function media_usage_rollup');
reset role;
select t_as('authenticated', '11111111-1111-4111-8111-111111111111');
select t_denied($$select public.eu_oauth_state_create_service(repeat('h', 64), 'aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'orcid')$$,
  'permission denied for function eu_oauth_state_create_service');
select t_denied('select * from private.eu_oauth_states', 'permission denied for table eu_oauth_states');
select t_denied('select public.eu_vault_store_service(''s'')', 'permission denied for function eu_vault_store_service');
reset role;

-- what the callers do, as service_role
set role service_role;
begin;
select t_eq((select count(*) from public.eu_claim_ddex_jobs_service('eu-ddex-worker', 10, 300)), 1::bigint, 'eu-ddex-worker claims the ddex job');
select t_eq((select count(*) from public.eu_claim_external_jobs_service('eu-external-worker', 10, 180)), 1::bigint, 'eu-external-worker claims the non-internal, non-ddex job');
select t_eq((select count(*) from public.eu_claim_monitors_service(20)), 1::bigint, 'eu-monitor claims the due monitor');
select t_eq((select count(*) from public.eu_claim_monitors_service(20)), 0::bigint, 'a claimed monitor is not due again');
select public.eu_oauth_state_create_service(repeat('h', 64), 'aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'orcid', '/back');
select t_eq(public.eu_oauth_state_consume_service(repeat('h', 64), 'orcid') ->> 'redirect_after', '/back', 'eu-orcid-oauth consumes its state once');
select t_eq(public.eu_oauth_state_consume_service(repeat('h', 64), 'orcid'), null::jsonb, 'and never twice');
select t_eq(public.eu_vault_store_service('token-value', 'orcid-token') is not null, true, 'tokens go to Vault');
select t_eq((public.media_usage_rollup('aaaaaaaa-0000-4000-8000-000000000001', null, null, 'provider') -> 'totals' ->> 'committed_cents')::int, 157,
  'media_usage_rollup: settled 37 plus 120 still reserved');
rollback;
reset role;
select 'eu_runtime_and_media_rollup_v1: ok' as result;
