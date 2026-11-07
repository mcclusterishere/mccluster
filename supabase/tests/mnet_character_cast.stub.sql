-- Stand-ins for the production tables supabase/pending/mnet_character_cast_v1.sql touches,
-- shaped like the columns it reads and writes. Applied after supabase_api_roles.stub.sql.
-- Test-only. Never applied to a real project.
alter table public.m_people add column if not exists status text not null default 'active';
create table public.orgs(id uuid primary key default gen_random_uuid(), slug text unique, enabled boolean not null default true);
create table public.platform_profiles(user_id uuid primary key default gen_random_uuid(), mccluster_id text);
create table public.music_creator_profiles(m_uid uuid primary key references public.m_people(id), handle text unique);
create table public.network_profiles(m_uid uuid primary key references public.m_people(id), display_name text, headline text, bio text,
  visibility text, categories text[], allow_messages_from text);
create table public.network_posts(id uuid primary key default gen_random_uuid(), author_m_uid uuid not null references public.m_people(id),
  body text not null default '', post_type text not null default 'post', visibility text not null default 'public', metadata jsonb not null default '{}',
  reply_to_id uuid, group_id uuid, created_at timestamptz not null default now(), deleted_at timestamptz, removed_at timestamptz, source_org_id uuid references public.orgs(id));
create table public.network_post_comments(id uuid primary key default gen_random_uuid(), post_id uuid not null references public.network_posts(id) on delete cascade,
  author_m_uid uuid not null references public.m_people(id), body text not null, created_at timestamptz not null default now(), deleted_at timestamptz);
create table public.media_news_articles(id uuid primary key default gen_random_uuid(), title text, canonical_url text, published_at timestamptz);
create table public.ops_agent_jobs(id uuid primary key default gen_random_uuid(), org_id uuid, job_type text, target_id text, status text, input jsonb not null default '{}');
create table public.ops_platform_actors (
  actor_key text primary key check(actor_key ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  org_id uuid not null references public.orgs(id),
  m_uid uuid not null unique references public.m_people(id),
  handle text not null unique,
  enabled boolean not null default false,
  daily_limit integer not null default 1 check(daily_limit between 1 and 3),
  persona jsonb not null check(jsonb_typeof(persona)='object'),
  authority text not null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
-- Supabase's service_role has full table rights in public (m_people predates the default grants above).
grant all on all tables in schema public to service_role;
