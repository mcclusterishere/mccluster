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

-- Production trigger that ensures every authenticated M identity can acquire a
-- corresponding network profile without granting client-side write authority.
create or replace function public.ensure_network_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_m_uid uuid;
  v_name text;
begin
  select l.m_uid into v_m_uid
  from public.m_auth_user_links l
  where l.auth_user_id = new.id
  order by l.is_primary desc, l.linked_at asc
  limit 1;

  if v_m_uid is null then
    return new;
  end if;

  v_name := coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', '');
  insert into public.network_profiles(m_uid, display_name, avatar_url)
  values(v_m_uid, v_name, coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture', ''))
  on conflict (m_uid) do update set
    display_name = case when public.network_profiles.display_name = '' then excluded.display_name else public.network_profiles.display_name end,
    avatar_url = case when public.network_profiles.avatar_url = '' then excluded.avatar_url else public.network_profiles.avatar_url end,
    updated_at = now();
  return new;
end;
$$;

revoke all on function public.ensure_network_profile_for_auth_user() from public, anon, authenticated;
grant execute on function public.ensure_network_profile_for_auth_user() to service_role;

drop trigger if exists zz_network_profile_after_auth on auth.users;
create trigger zz_network_profile_after_auth
after insert or update on auth.users
for each row execute function public.ensure_network_profile_for_auth_user();
