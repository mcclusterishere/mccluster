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
