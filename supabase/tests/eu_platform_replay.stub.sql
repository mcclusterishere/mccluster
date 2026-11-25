-- The tables the Equity Uprise platform registry and music workspace (supabase/migrations/
-- 20261114015120_equity_uprise_platform_registry.sql and 20261114060150_equity_uprise_music_workspace.sql) read or
-- reference, as the CI rebuild (scripts/supabase-local-reset-with-replay.sh) holds them just before ledger row 365,
-- for scripts/test/eu-platform-replay.native.integration.mjs. Test-only. Never applied to a real project.
--
-- Applied after scripts/test/support/native-postgres.mjs supabaseShapedDatabase() (the three API roles,
-- auth.users, Supabase's default privileges), supabase/tests/action_mission_catalog.stub.sql (production's
-- public.action_missions, auth.uid(), public.current_m_uid(), m_people and m_auth_user_links) and the four applied
-- globe migrations. The helper's two-column public.orgs and public.org_members give way to the real ones.
--
-- Column for column from the migrations that create them (names, types, defaults and order), so the two views the
-- registry creates over public.action_missions and public.music_catalog_objects come out as production's:
--   public.orgs, public.org_members     supabase/replay_migrations/0026_tenancy.sql, with orgs_kind_check as
--                                       supabase/migrations/20261006170955_action_clipping_marketplace_v1.sql left it
--   public.platform_apps                supabase/replay_migrations/0034_mccluster_platform_core.sql
--   public.music_creator_profiles       supabase/migrations/20260920041011_music_creator_platform_v1.sql
--   public.music_catalog_objects        supabase/migrations/20261003233747_action_network_live_governance_v1.sql and
--                                       its three columns from 20261006233518_here_album_commerce_v1_reconcile.sql
-- Stand-in: public.creator_tracks, its key only (the catalog's foreign key points at it). Of their policies only
-- platform_apps_public_read is here (the registry's public read API goes through it); triggers, the other policies
-- and the rest of production's tables are left out: the files under test do not read them.
--
-- Rows: only what a rebuild holds at that point (the test adds production's preconditions where it needs them).

drop table if exists public.org_members;
drop table if exists public.orgs;

-- The schema the registry puts its two private tables and functions in (usage as production and the rebuild grant it).
create schema if not exists private;
grant usage on schema private to anon, authenticated;

create table public.orgs (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  kind       text not null default 'business'
             check (kind in ('studio', 'business', 'building')),
  settings   jsonb not null default '{}'::jsonb,
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.orgs drop constraint if exists orgs_kind_check;
alter table public.orgs add constraint orgs_kind_check
  check (kind in ('studio', 'business', 'building', 'client', 'network'));

create table public.org_members (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  profile_id uuid not null,
  role       text not null default 'staff' check (role in ('owner', 'staff', 'viewer')),
  added_at   timestamptz not null default now(),
  primary key (org_id, profile_id)
);
create index if not exists org_members_profile on public.org_members (profile_id);
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;

create table public.platform_apps (
  id uuid primary key default gen_random_uuid(),
  app_key text not null unique,
  name text not null,
  product_family text not null,
  kind text not null default 'web'
    check (kind in ('web','ios','android','desktop','service','game')),
  bundle_id text,
  public_url text,
  oauth_client_id text,
  oauth_redirect_uris jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform_apps enable row level security;
-- 0034's public read rule, which the registry's public read API (eu_platform_context) goes through
create policy platform_apps_public_read on public.platform_apps
  for select using (enabled = true);

create table public.music_creator_profiles (
  m_uid uuid primary key references public.m_people(id) on delete cascade default public.current_m_uid(),
  handle text not null unique,
  artist_name text not null,
  bio text not null default '',
  avatar_url text not null default '',
  banner_url text not null default '',
  website_url text not null default '',
  status text not null default 'active' check (status in ('active','paused','suspended')),
  verification_state text not null default 'unverified' check (verification_state in ('unverified','identity_checked','rights_ready','verified')),
  terms_version text not null default 'music-creator-v1',
  terms_accepted_at timestamptz not null default now(),
  rights_warranty_accepted_at timestamptz,
  payout_state text not null default 'not_started' check (payout_state in ('not_started','pending','ready','restricted')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (handle ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  check (char_length(artist_name) between 1 and 160),
  check (char_length(bio) <= 2000)
);
alter table public.music_creator_profiles enable row level security;

create table public.creator_tracks (id uuid primary key default gen_random_uuid());
alter table public.creator_tracks enable row level security;

create table public.music_catalog_objects(
 id uuid primary key default gen_random_uuid(),
 catalog_key text not null unique check(catalog_key~'^[a-z0-9-]+:[a-z0-9-]+$'),
 album_slug text not null check(album_slug~'^[a-z0-9][a-z0-9-]{0,119}$'),
 album_title text not null check(char_length(album_title) between 1 and 200),
 track_title text not null check(char_length(track_title) between 1 and 200),
 artist_name text not null check(char_length(artist_name) between 1 and 200),
 credit_line text not null default '' check(char_length(credit_line)<=500),
 audio_path text not null default '' check(char_length(audio_path)<=1000),
 artwork_path text not null default '' check(char_length(artwork_path)<=1000),
 canonical_url text not null check(canonical_url~'^https://'),
 source_kind text not null default 'site_catalog' check(source_kind in('site_catalog','creator_track')),
 creator_track_id uuid references public.creator_tracks(id) on delete set null,
 status text not null default 'active' check(status in('active','archived')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
alter table public.music_catalog_objects
  add column if not exists music_video_url text not null default '',
  add column if not exists lyrics_url text not null default '',
  add column if not exists experience jsonb not null default '{}'::jsonb;
alter table public.music_catalog_objects enable row level security;
revoke all on public.music_catalog_objects from public,anon,authenticated;
grant select on public.music_catalog_objects to anon,authenticated;

-- The house organisation (0026_tenancy.sql). auth.users and org_members stay empty, as in a rebuild: no
-- migration, replay file or seed writes auth.users, and 0026 copies owners only from inbox_staff, which none fills.
insert into public.orgs (slug, name, kind) values ('mccluster', 'McCluster', 'studio');

-- The canonical apps a rebuild registers: mccluster-web (0034_mccluster_platform_core.sql), equity-uprise-web
-- (replay 20260908213000_equity_uprise_policy_graph.sql) and music-web (20260920041011_music_creator_platform_v1.sql).
-- No file registers mnet-web.
insert into public.platform_apps (app_key, name, product_family, kind, public_url) values
  ('mccluster-web', 'McCluster', 'mccluster', 'web', 'https://matthew.mccluster.org'),
  ('equity-uprise-web', 'Equity Uprise', 'equity-uprise', 'web', 'https://matthew.mccluster.org/equity-uprise.html');
insert into public.platform_apps (app_key, name, product_family, kind, public_url, enabled, settings)
values ('music-web', 'McCluster Music', 'music', 'web', 'https://matthew.mccluster.org/listen.html', true, '{"surface":"listen.html","identity":"m-account","network":"mnet"}'::jsonb);

-- The one creator profile a rebuild holds: the platform's own fictional performer, provisioned by
-- 20261021011443_royce_platform_actor.sql with no sign-in linked to it (its persona settings left out here).
insert into public.m_people (id) values ('20000000-0000-4000-8000-0000000000e1');
insert into public.music_creator_profiles (m_uid, handle, artist_name, bio)
values ('20000000-0000-4000-8000-0000000000e1', 'royce.r01', 'Royce', 'Fictional performer.');
