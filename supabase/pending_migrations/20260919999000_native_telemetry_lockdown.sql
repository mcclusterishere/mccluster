-- NATIVE TELEMETRY HARDENING — REMAINDER ONLY.
--
-- Browser writes are already closed in production by
-- 20260919133905_analytics_platform_multitenant_v1:
--   * "anyone writes the exhaust" was dropped
--   * INSERT was revoked from anon/authenticated
--   * the server collector is the only event writer
--
-- DO NOT APPLY THIS FILE AS-IS THROUGH THE PRODUCTION LEDGER. It is retained
-- under pending_migrations because the remaining controls are separate owner
-- decisions: FORCE RLS, payload-size validation of historical rows, and the
-- retention window/schedule.
--
-- force, so a future privileged view cannot read around the table policy.
alter table public.events force row level security;

-- A browser can drive these fields without limit, so they get a ceiling.
-- NOT VALID avoids retroactively rejecting historical rows during rollout.
alter table public.events drop constraint if exists events_props_size;
alter table public.events add constraint events_props_size
  check (pg_column_size(props) <= 16384) not valid;
alter table public.events drop constraint if exists events_device_size;
alter table public.events add constraint events_device_size
  check (pg_column_size(device) <= 4096) not valid;

-- Remove any residual anonymous table privileges once the owner chooses to
-- apply the remainder. The collector writes with the service role.
revoke all on table public.events from anon;

-- ---------------------------------------------------------------------------
-- retention
-- ---------------------------------------------------------------------------
-- Keeping an address forever is a choice, and it should be one somebody makes
-- on purpose. This is the lever. Nothing calls it: wiring it into
-- ops_maintenance_tick() is a decision about the house's retention policy.
create or replace function public.events_purge(older_than interval default interval '400 days')
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n bigint;
begin
  delete from public.events where at < now() - older_than;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.events_purge(interval) from public;
grant execute on function public.events_purge(interval) to service_role;

comment on function public.events_purge(interval) is
  'Deletes telemetry older than the window and returns the row count. Unscheduled by design — the retention period is an owner decision.';
