-- NATIVE TELEMETRY, part one: the columns.
--
-- public.events has been written to by js/analytics.js since the site had
-- analytics at all, and it had no migration. Its definition lived in
-- docs/here-engine.sql — a loose file somebody ran by hand — so the table was
-- real and collecting (27,848 rows when this shipped) while the repo had no
-- record that it existed. This puts it under migration control and adds the
-- columns that make it a first-party replacement for Google Analytics rather
-- than a thinner copy of one.
--
-- ADDITIVE ONLY, AND THAT IS THE POINT. The live site still posts directly
-- with the anon key. Revoking that in the same breath as adding the columns
-- would have stopped roughly 2,300 events a day landing until the new client
-- deployed. The lockdown is a separate migration, applied after the site is
-- live: see 20260919999000_native_telemetry_lockdown.sql.
--
-- `create table if not exists` is a no-op against a table that already
-- exists, which is why every column below is added on its own line. Writing
-- them inside the table definition would have skipped all of them on the one
-- installation that needed them.

-- The base shape, so a replay onto an empty database produces the same
-- schema this one grew by hand. Against production every statement in this
-- block is already true and does nothing; against a fresh project it is the
-- difference between these columns having a table to attach to and the
-- migration failing outright.
create table if not exists public.events (
  id    uuid primary key default gen_random_uuid(),
  at    timestamptz not null default now(),
  name  text not null,
  path  text not null default '',
  props jsonb not null default '{}'::jsonb,
  uid   uuid
);
create index if not exists events_at_idx   on public.events (at desc);
create index if not exists events_name_idx on public.events (name, at desc);

alter table public.events enable row level security;

-- The open insert as it actually stands today. It is withdrawn by the
-- lockdown migration once the collector is the only writer; reproducing it
-- here keeps a fresh replay honest about what production currently allows.
drop policy if exists "anyone writes the exhaust" on public.events;
create policy "anyone writes the exhaust" on public.events
  for insert to anon, authenticated with check (true);

-- Behavioural data with addresses attached is owner-only.
drop policy if exists "only the desk reads it" on public.events;
create policy "only the desk reads it" on public.events
  for select using (public.eu_is_admin());

alter table public.events add column if not exists device_id  text;
alter table public.events add column if not exists session_id text;
alter table public.events add column if not exists ip         inet;
alter table public.events add column if not exists user_agent text;
alter table public.events add column if not exists referrer   text;
alter table public.events add column if not exists country    text;
alter table public.events add column if not exists region     text;
alter table public.events add column if not exists city       text;
alter table public.events add column if not exists postal     text;
alter table public.events add column if not exists latitude   double precision;
alter table public.events add column if not exists longitude  double precision;
alter table public.events add column if not exists timezone   text;
alter table public.events add column if not exists asn        integer;
alter table public.events add column if not exists asn_org    text;
alter table public.events add column if not exists is_bot     boolean;
alter table public.events add column if not exists device     jsonb not null default '{}'::jsonb;
-- Whatever the edge actually handed us, kept raw. This is how it was
-- discovered that a Supabase edge function receives `cf-ray` and nothing
-- else — no country, no ASN — which is why the Worker route exists.
alter table public.events add column if not exists edge       jsonb not null default '{}'::jsonb;

create index if not exists events_device_idx  on public.events (device_id, at desc) where device_id is not null;
create index if not exists events_session_idx on public.events (session_id, at desc) where session_id is not null;
create index if not exists events_uid_idx     on public.events (uid, at desc) where uid is not null;
create index if not exists events_path_idx    on public.events (path, at desc);
create index if not exists events_ip_idx      on public.events (ip, at desc) where ip is not null;

comment on column public.events.ip is
  'Observed at the edge. Never client-asserted. Personal data: see events_purge().';
comment on column public.events.device_id is
  'Stable per-browser id minted client-side. Distinguishes browsers, not people, and clearing the store genuinely clears it.';
