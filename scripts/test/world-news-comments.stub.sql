-- Isolated GitHub Actions database fixture. NEVER run on production.
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.media_news_articles (
  id uuid primary key,
  canonical_url text not null,
  imported_at timestamptz not null default now()
);
create table public.m_people (
  id uuid primary key,
  status text not null default 'active'
);
grant usage on schema public to anon,authenticated,service_role;
grant all on public.media_news_articles, public.m_people to service_role;

-- Foreign-key targets of supabase/migrations/20261021011443_royce_platform_actor.sql,
-- which created the news-discussion objects in production. Its Royce provisioning
-- block returns early because no enabled 'mccluster' org exists here; nothing is seeded.
create table public.orgs (
  id uuid primary key,
  slug text not null unique,
  enabled boolean not null default false
);
create table public.ops_agent_jobs (
  id uuid primary key,
  org_id uuid references public.orgs(id),
  job_type text,
  target_id text,
  status text
);
create table public.platform_profiles (mccluster_id text);
create table public.music_creator_profiles (
  m_uid uuid references public.m_people(id),
  handle text unique,
  artist_name text,
  bio text,
  settings jsonb
);
create table public.network_profiles (
  m_uid uuid references public.m_people(id),
  display_name text,
  headline text,
  bio text,
  visibility text,
  categories text[],
  allow_messages_from text
);
grant all on public.orgs, public.ops_agent_jobs, public.platform_profiles,
  public.music_creator_profiles, public.network_profiles to service_role;
