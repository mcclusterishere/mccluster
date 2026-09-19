-- NATIVE TELEMETRY — the house keeps its own eyes.
--
-- public.events has been written to by js/analytics.js since the site had
-- analytics at all, and it has never had a migration. Its definition lived in
-- docs/here-engine.sql, which is a file, not a schema: nothing in the repo
-- guaranteed the table existed, and the client's insert was wrapped in a
-- .catch that threw the failure away. A collector that silently drops
-- everything looks exactly like a collector that works.
--
-- So this migration does two jobs. It puts the table under migration control
-- where it belongs, and it adds the columns that make this a first-party
-- replacement for Google Analytics rather than a thinner copy of it:
-- who the device is, which visit this was, and where the request came from.
--
-- WHY THE BROWSER MAY NO LONGER WRITE HERE DIRECTLY.
--
-- An IP address is not observable from inside a page. Any client-side
-- analytics that claims to know one is reading it back from a third party,
-- which is the dependency this is meant to remove. The only place the address
-- exists is on the request itself, so the writer has to be the server:
-- supabase/functions/collect reads it from the edge headers and inserts with
-- the service role. Anon insert is revoked accordingly — that also means a
-- row's ip, device and user agent are observed rather than asserted, and a
-- bored visitor cannot forge a million of them from a console.
--
-- THIS TABLE HOLDS PERSONAL DATA. An IP address plus a stable device id is
-- personal data under the Connecticut Data Privacy Act and its equivalents,
-- which is a reason to keep it read-restricted and to set a retention window,
-- not a reason to avoid collecting it. public.events_purge() at the bottom is
-- the retention lever; nothing schedules it yet, deliberately.

-- ---------------------------------------------------------------------------
-- the table
-- ---------------------------------------------------------------------------

-- Base shape matches what docs/here-engine.sql described and what the site has
-- been posting, so an installation that already ran that file by hand is
-- adopted here rather than duplicated.
create table if not exists public.events (
  id    uuid primary key default gen_random_uuid(),
  at    timestamptz not null default now(),
  name  text not null,
  path  text not null default '',
  props jsonb not null default '{}'::jsonb,
  uid   uuid
);

-- The native columns. Added separately because `create table if not exists` is
-- a no-op against an existing table and would otherwise skip every one of them
-- on the installation that needs them most.
alter table public.events add column if not exists device_id  text;
alter table public.events add column if not exists session_id text;
alter table public.events add column if not exists ip         inet;
alter table public.events add column if not exists user_agent text;
alter table public.events add column if not exists referrer   text;
alter table public.events add column if not exists country    text;
alter table public.events add column if not exists region     text;
alter table public.events add column if not exists city       text;
-- screen, timezone, platform, language, connection — whatever the client can
-- honestly observe about itself. Opaque so the client can learn to report more
-- without a migration each time.
alter table public.events add column if not exists device     jsonb not null default '{}'::jsonb;

-- A single event is small and there will be a great many of them. Anything
-- unbounded that a browser can influence gets a ceiling.
alter table public.events drop constraint if exists events_props_size;
alter table public.events add  constraint events_props_size  check (pg_column_size(props)  <= 8192);
alter table public.events drop constraint if exists events_device_size;
alter table public.events add  constraint events_device_size check (pg_column_size(device) <= 4096);
alter table public.events drop constraint if exists events_name_len;
alter table public.events add  constraint events_name_len    check (char_length(name) between 1 and 120);

comment on table public.events is
  'First-party behavioural telemetry. Written only by the collect edge function, which observes ip, device and user agent from the request rather than accepting them from the browser. Readable by the owner alone.';
comment on column public.events.ip is
  'Observed at the edge from cf-connecting-ip / x-forwarded-for. Never client-asserted. Personal data: see events_purge().';
comment on column public.events.device_id is
  'Stable per-browser identifier minted client-side. Distinguishes devices, not people, and survives neither a cleared store nor a different browser.';
comment on column public.events.session_id is
  'One visit. Rotates after a gap of inactivity, so a return visit is a new row set.';

-- ---------------------------------------------------------------------------
-- the indexes — one per question the desk actually asks
-- ---------------------------------------------------------------------------
create index if not exists events_at_idx      on public.events (at desc);
create index if not exists events_name_idx    on public.events (name, at desc);
create index if not exists events_device_idx  on public.events (device_id, at desc) where device_id is not null;
create index if not exists events_session_idx on public.events (session_id, at desc) where session_id is not null;
create index if not exists events_uid_idx     on public.events (uid, at desc) where uid is not null;
create index if not exists events_path_idx    on public.events (path, at desc);

-- ---------------------------------------------------------------------------
-- who may touch it
-- ---------------------------------------------------------------------------
alter table public.events enable row level security;
-- force, so a future view owned by a privileged role cannot read around the
-- policy. That has already gone wrong once on eu_profiles.
alter table public.events force row level security;

-- The old contract let anyone insert. That was the only option while the
-- browser was the writer; it is the wrong one now that the server is, because
-- an open insert on this table means forged addresses and unbounded volume.
drop policy if exists "anyone writes the exhaust" on public.events;
drop policy if exists events_insert_anon on public.events;

-- Reading behavioural data with addresses attached is an owner-only act.
-- eu_role() already treats the owner's email as admin unconditionally, so this
-- cannot lock the owner out of their own telemetry.
drop policy if exists "only the desk reads it" on public.events;
drop policy if exists events_select_owner on public.events;
create policy events_select_owner on public.events
  for select to authenticated
  using (public.eu_role() = 'admin');

revoke all on table public.events from anon;
revoke all on table public.events from authenticated;
grant select on table public.events to authenticated;  -- narrowed by the policy above
grant all on table public.events to service_role;

-- ---------------------------------------------------------------------------
-- retention
-- ---------------------------------------------------------------------------
-- Keeping an address forever is a choice, and it should be one somebody makes
-- on purpose. This is the lever. Nothing calls it yet: wiring it into
-- ops_maintenance_tick() is a decision about the house's retention policy, not
-- a detail of adding a column, and a migration should not quietly make it.
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
