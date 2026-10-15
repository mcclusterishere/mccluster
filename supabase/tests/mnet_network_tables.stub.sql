-- Minimal stand-ins for the member-network tables the Anti-Social mission and
-- the connection RPCs touch, for a scratch database only (never applied to a
-- real project). Columns mirror the real DDL in supabase/replay_migrations/
-- 0068_mnet_replay_foundation.sql and supabase/migrations/20260920071811_
-- mnet_real_network_v1.sql where the functions under test read them; the
-- rest is left out. Applied after supabase_api_roles.stub.sql.
create table public.m_auth_user_links(
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  m_uid uuid not null references public.m_people(id) on delete cascade,
  is_primary boolean not null default true
);
create table public.platform_profiles(
  user_id uuid primary key references auth.users(id) on delete cascade,
  mccluster_id text, display_name text, avatar_url text
);
create table public.platform_apps(id uuid primary key default gen_random_uuid(), app_key text, enabled boolean default true);
create table public.network_profiles(
  m_uid uuid primary key references public.m_people(id) on delete cascade,
  display_name text, visibility text not null default 'public', discoverable boolean not null default true,
  allow_messages_from text not null default 'network'
);
create table public.network_follows(
  follower_m_uid uuid not null, followed_m_uid uuid not null, status text not null default 'following',
  primary key(follower_m_uid, followed_m_uid)
);
create table public.network_blocks(
  blocker_m_uid uuid not null, blocked_m_uid uuid not null, created_at timestamptz not null default now(),
  primary key(blocker_m_uid, blocked_m_uid)
);
create table public.network_connections(
  requester_m_uid uuid not null references public.m_people(id) on delete cascade,
  addressee_m_uid uuid not null references public.m_people(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (requester_m_uid, addressee_m_uid),
  check (requester_m_uid <> addressee_m_uid)
);
create unique index network_connections_pair_idx on public.network_connections(least(requester_m_uid, addressee_m_uid), greatest(requester_m_uid, addressee_m_uid));
alter table public.network_connections enable row level security;
revoke all on public.network_connections from public, anon, authenticated;
grant select on public.network_connections to authenticated;
grant all on public.network_connections to service_role;
create policy network_connections_member_read on public.network_connections for select to authenticated
  using (requester_m_uid = public.current_m_uid() or addressee_m_uid = public.current_m_uid());
create table public.network_notifications(
  id uuid primary key default gen_random_uuid(),
  recipient_m_uid uuid not null references public.m_people(id) on delete cascade,
  actor_m_uid uuid references public.m_people(id) on delete set null,
  type text not null, object_type text, object_id text,
  body text not null default '', metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz, created_at timestamptz not null default now()
);
create table public.network_posts(
  id uuid primary key default gen_random_uuid(),
  author_m_uid uuid not null references public.m_people(id) on delete cascade,
  body text not null default '',
  post_type text not null default 'post' check (post_type in ('post','update','share','announcement')),
  visibility text not null default 'public' check (visibility in ('public','network','private')),
  media jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  reply_to_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz, removed_at timestamptz,
  source_app_id uuid
);
create table public.action_globe_song_missions(mission_id uuid primary key, song_title text, album_slug text);
create function public.mnet_is_blocked_pair(a uuid, b uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.network_blocks x where (x.blocker_m_uid = a and x.blocked_m_uid = b) or (x.blocker_m_uid = b and x.blocked_m_uid = a))
$$;
grant execute on function public.mnet_is_blocked_pair(uuid, uuid) to anon, authenticated, service_role;
-- the upload columns the joint post reads (the roles stub creates the table)
alter table public.network_media_assets
  add column if not exists mime_type text not null default 'application/octet-stream',
  add column if not exists width integer, add column if not exists height integer, add column if not exists duration_ms integer,
  add column if not exists alt_text text not null default '',
  add column if not exists post_id uuid, add column if not exists updated_at timestamptz not null default now();
