-- Rollback for media_operation_claims_v2.sql. Recovery artifact, not a forward
-- migration. Drops ONLY what v2 added: media_operation_claims_v1 (applied
-- 20261109194957) with its three RPCs, 0053 and 0054 stay exactly as they are.
--
-- ORDER: roll the Worker back FIRST, then run this. A Worker that still calls
-- the v2 names answers 503 operation_claims_unavailable for every paid
-- generation that carries an operation id (nothing is reserved), 503
-- recovery_unavailable on the operator routes, and releases failed jobs
-- through media_release_cost_reservation (0054) until the forward file is
-- reapplied or the Worker is rolled back.
--
-- What is lost: the four columns hold takeover and repair evidence; the two
-- unique indexes are the one-job-per-operation and one-job-per-provider-request
-- guarantees. Operator decisions already recorded stay on the job rows
-- (media_jobs.routing operator_resolution, operator_resolution_history) and in
-- control_audit.
drop function if exists public.media_operation_recovery_candidates_v1(uuid, interval, integer);
drop function if exists public.media_resolve_operation_job_v1(uuid, uuid, text, uuid, text, jsonb, text);
drop function if exists public.media_release_cost_reservation_v2(uuid, text, text, jsonb, text[]);
drop function if exists public.media_fail_operation_v2(uuid, text, jsonb, integer);
drop function if exists public.media_claim_operation_v2(uuid, text, text, uuid, text, interval);
drop function if exists public.media_bind_operation_v2(uuid, text, uuid, jsonb);
drop index if exists public.media_jobs_fal_open_updated_idx;
drop index if exists public.media_jobs_provider_request_uidx;
drop index if exists public.media_jobs_org_operation_uidx;
drop index if exists public.media_operation_claims_claimed_idx;
alter table public.media_operation_claims
  drop column if exists resolution,
  drop column if exists resolved_at,
  drop column if exists history,
  drop column if exists attempt;
