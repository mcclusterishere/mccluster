-- Native telemetry hardening applied to production on 2026-10-05.
-- Retention remains intentionally UNSCHEDULED: this migration creates the
-- service-role purge lever but does not delete historical analytics data.

alter table public.events force row level security;

alter table public.events drop constraint if exists events_props_size;
alter table public.events add constraint events_props_size
  check (pg_column_size(props) <= 16384) not valid;
alter table public.events drop constraint if exists events_device_size;
alter table public.events add constraint events_device_size
  check (pg_column_size(device) <= 4096) not valid;

revoke all on table public.events from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.events from authenticated;
grant select on table public.events to authenticated;

create or replace function public.events_purge(older_than interval default interval '400 days')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare n bigint;
begin
  delete from public.events where at < now() - older_than;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.events_purge(interval) from public, anon, authenticated;
grant execute on function public.events_purge(interval) to service_role;

comment on function public.events_purge(interval) is
  'Deletes telemetry older than the supplied window and returns the row count. Unscheduled by design.';
