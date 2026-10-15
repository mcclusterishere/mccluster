-- World location consent v1: a server-side record of a member's explicit
-- precise-location opt-in, the second of the three CCTV checks (owner,
-- 2026-10-15: members see CCTV "ONLY after they are logged in, have given
-- location consent, AND have completed a mission").
--
-- WHY THIS EXISTS. Before it, no consent was recorded anywhere: the
-- browser's geolocation permission was only observed as an analytics event
-- (js/analytics.js "location_permission"), which is a measurement, not a
-- member's agreement to anything. The Worker (workers/mccluster/src/
-- world-cctv.js) treats a missing table as "no consent" for everyone and
-- says so (consent_store: "pending"); nothing is pretended.
--
-- WHAT IT HOLDS. The decision, never a position: who, which scope, when it
-- was granted, when (if) it was withdrawn, where it was asked, and which
-- wording. No latitude, longitude, accuracy or address column exists.
--
-- WHO WRITES. Only the service role, through POST/DELETE
-- /v1/world/location-consent, which accepts a grant only after the member's
-- own tap produced a granted browser permission, and records a withdrawal
-- at any time. A member may read their own row; nobody else may.
--
-- NOT APPLIED IN PRODUCTION. Promote with the steps in supabase/pending/README.md.
--
-- ROLLBACK: drop table if exists public.world_location_consents;
--   (the Worker then answers location_consent=false for everyone, i.e. no
--   member is CCTV-eligible; nothing else reads this table).

set local lock_timeout = '5s';

create table if not exists public.world_location_consents (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  scope           text not null default 'precise_gps' check (scope in ('precise_gps')),
  granted_at      timestamptz,
  revoked_at      timestamptz,
  source          text not null default 'world_cctv' check (char_length(source) between 1 and 40),
  consent_version text not null default 'world-cctv-2026-10-15' check (char_length(consent_version) between 1 and 60),
  updated_at      timestamptz not null default now(),
  check (granted_at is not null or revoked_at is not null)
);

comment on table public.world_location_consents is
  'Explicit precise-location opt-in per member (decision only, never coordinates). Written only by the mccluster Worker as the service role.';

alter table public.world_location_consents enable row level security;
revoke all on public.world_location_consents from public, anon, authenticated;
grant all on public.world_location_consents to service_role;
grant select on public.world_location_consents to authenticated;

drop policy if exists "members read own location consent" on public.world_location_consents;
create policy "members read own location consent" on public.world_location_consents
  for select to authenticated using (user_id = (select auth.uid()));
