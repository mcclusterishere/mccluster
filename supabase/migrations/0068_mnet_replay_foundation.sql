-- Reconstruct the canonical Mnet Phase 1 relational spine for clean migration replay.
-- These relations already exist in production from the original Mnet rollout;
-- this idempotent migration makes source-controlled resets reproduce that state.

create table if not exists public.network_profiles (
  m_uid uuid primary key references public.m_people(id) on delete cascade,
  display_name text not null default '',
  bio text not null default '',
  avatar_url text not null default '',
  banner_url text not null default '',
  website_url text not null default '',
  visibility text not null default 'public' check (visibility in ('public','network','private')),
  discoverable boolean not null default true,
  activity_sharing boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  headline text not null default '',
  location_text text not null default '',
  pronouns text not null default '',
  links jsonb not null default '[]'::jsonb,
  categories text[] not null default '{}'::text[],
  skills text[] not null default '{}'::text[],
  services text[] not null default '{}'::text[],
  featured jsonb not null default '[]'::jsonb,
  allow_messages_from text not null default 'network',
  allow_mentions_from text not null default 'network',
  allow_tagging_from text not null default 'network',
  verification_state text not null default 'unverified',
  profile_version integer not null default 1
);

create table if not exists public.network_posts (
  id uuid primary key default gen_random_uuid(),
  author_m_uid uuid not null references public.m_people(id) on delete cascade,
  body text not null default '',
  post_type text not null default 'post' check (post_type in ('post','update','share','announcement')),
  visibility text not null default 'public' check (visibility in ('public','network','private')),
  media jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  reply_to_id uuid references public.network_posts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  source_app_id uuid references public.platform_apps(id) on delete set null,
  source_org_id uuid references public.orgs(id) on delete set null
);

create table if not exists public.network_follows (
  follower_m_uid uuid not null references public.m_people(id) on delete cascade,
  followed_m_uid uuid not null references public.m_people(id) on delete cascade,
  status text not null default 'following' check (status in ('following','muted','blocked')),
  created_at timestamptz not null default now(),
  primary key (follower_m_uid, followed_m_uid),
  check (follower_m_uid <> followed_m_uid)
);

create table if not exists public.network_reactions (
  post_id uuid not null references public.network_posts(id) on delete cascade,
  actor_m_uid uuid not null references public.m_people(id) on delete cascade,
  reaction text not null default 'like',
  created_at timestamptz not null default now(),
  primary key (post_id, actor_m_uid, reaction)
);

alter table public.network_profiles enable row level security;
alter table public.network_posts enable row level security;
alter table public.network_follows enable row level security;
alter table public.network_reactions enable row level security;

grant all on table public.network_profiles, public.network_posts, public.network_follows, public.network_reactions to service_role;
