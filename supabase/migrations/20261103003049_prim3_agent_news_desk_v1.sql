-- PRIM3 regional agents' news desk (owner, 2026-11-03: "each agent of 24 ...
-- read the news and make a general statement about what the headline was
-- about as a brief to their region and comment on every single piece of news
-- in their region").
--
-- Written only by McCluster Core on the OVH box (service role, executor
-- prim3_agent_news:v1, local model). Read only through the service role
-- (the owner-only PRIM3 World). RLS is on with no policies: anon and
-- authenticated clients read nothing. Comments are fiction voiced by
-- McCluster about real headlines and are never published to the public feed
-- by this table.
create table if not exists public.prim3_agent_news_comments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  agent_key text not null check (agent_key ~ '^[a-z][a-z-]{2,39}$'),
  country_iso text not null check (country_iso ~ '^[A-Z]{2}$'),
  article_id uuid not null,
  headline text not null check (char_length(headline) between 1 and 400),
  comment text not null check (char_length(comment) between 8 and 280),
  model text not null,
  job_id uuid,
  created_at timestamptz not null default now(),
  unique (agent_key, article_id)
);
create index if not exists prim3_agent_news_comments_agent_recent on public.prim3_agent_news_comments (agent_key, created_at desc);
create index if not exists prim3_agent_news_comments_country_recent on public.prim3_agent_news_comments (country_iso, created_at desc);

create table if not exists public.prim3_agent_news_briefs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  agent_key text not null check (agent_key ~ '^[a-z][a-z-]{2,39}$'),
  country_iso text not null check (country_iso ~ '^[A-Z]{2}$'),
  brief text not null check (char_length(brief) between 20 and 900),
  headline_count integer not null check (headline_count >= 0),
  window_start timestamptz not null,
  window_end timestamptz not null,
  model text not null,
  job_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists prim3_agent_news_briefs_agent_recent on public.prim3_agent_news_briefs (agent_key, created_at desc);

alter table public.prim3_agent_news_comments enable row level security;
alter table public.prim3_agent_news_briefs enable row level security;
revoke all on public.prim3_agent_news_comments from anon, authenticated;
revoke all on public.prim3_agent_news_briefs from anon, authenticated;

-- Seven days are kept, like media_news_articles.
create or replace function public.prim3_agent_news_prune() returns void
language sql security definer set search_path = public as $$
  delete from public.prim3_agent_news_comments where created_at < now() - interval '7 days';
  delete from public.prim3_agent_news_briefs where created_at < now() - interval '7 days';
$$;
revoke all on function public.prim3_agent_news_prune() from public, anon, authenticated;
grant execute on function public.prim3_agent_news_prune() to service_role;
