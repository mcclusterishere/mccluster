-- NATIVE TELEMETRY, part three: closing the browser's write.
--
-- NOT YET APPLIED. This one waits for the new client to be live on
-- matthew.mccluster.org. Until then the site still posts directly to
-- public.events with the anon key, and running this would stop roughly 2,300
-- events a day from landing. Apply it once the deploy is confirmed and the
-- collector is the only thing writing.
--
-- WHY THE OPEN INSERT GOES. It was the only option while the browser was the
-- writer. Now that the server is, leaving it open means a bored visitor can
-- forge an address, a country and a device from a console, and can write as
-- many rows as they feel like. Everything observed becomes worthless the
-- moment anything can assert it.

-- force, so a future view owned by a privileged role cannot read around the
-- policy. That has already gone wrong once on eu_profiles.
alter table public.events force row level security;

drop policy if exists "anyone writes the exhaust" on public.events;
revoke insert on table public.events from anon, authenticated;
revoke all on table public.events from anon;

-- A browser can drive these without limit, so they get a ceiling. Applied
-- after the fact because the historical rows predate any such discipline.
alter table public.events drop constraint if exists events_props_size;
alter table public.events add  constraint events_props_size  check (pg_column_size(props)  <= 16384) not valid;
alter table public.events drop constraint if exists events_device_size;
alter table public.events add  constraint events_device_size check (pg_column_size(device) <= 4096)  not valid;

-- ---------------------------------------------------------------------------
-- retention
-- ---------------------------------------------------------------------------
-- Keeping an address forever is a choice, and it should be one somebody makes
-- on purpose. This is the lever. Nothing calls it: wiring it into
-- ops_maintenance_tick() is a decision about the house's retention policy, and
-- a migration should not quietly make it.
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
