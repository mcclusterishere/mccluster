-- News <-> Halo map pairing (owner, 2026-11-03: "The headline about a
-- satellite and other headlines about specific items, events or data that
-- exists on the Hitman's Halo map should be considered as paired data and a
-- lot of data needs pairing automatically").
--
-- Written only by McCluster Core on the OVH box (service role, executor
-- world_news_pairing:v1): deterministic name / place-and-time matches, and
-- weak ones confirmed by the box's local model. Read only through the service
-- role by Worker `mccluster` (GET /v1/world/news-pairs, house owner only).
-- RLS is on with no policies: anon and authenticated clients read nothing.
-- The map items themselves are not stored: entity_* is a snapshot of the item
-- as it was when the pair was made. See docs/control-plane/WORLD-NEWS-PAIRING.md.
set local lock_timeout = '5s';

create table if not exists public.world_news_pairs (
  id uuid primary key default gen_random_uuid(),
  -- Pairs go when the article goes (media_news_articles keeps about a week).
  article_id uuid not null references public.media_news_articles(id) on delete cascade,
  layer text not null check (layer in ('quakes','cyclones','natural','fires','perimeters','launches','satellites','vessels','weather')),
  entity_key text not null check (entity_key ~ '^[A-Za-z0-9:._{}-]{1,160}$'),
  entity_name text check (entity_name is null or char_length(entity_name) <= 200),
  entity_lat double precision check (entity_lat is null or entity_lat between -90 and 90),
  entity_lon double precision check (entity_lon is null or entity_lon between -180 and 180),
  entity_time timestamptz,
  score real not null check (score >= 0 and score <= 1),
  method text not null check (method in ('name','geo_time','model')),
  reason text check (reason is null or char_length(reason) <= 300),
  model text check (model is null or char_length(model) <= 120),
  job_id uuid,
  created_at timestamptz not null default now(),
  constraint world_news_pairs_model_named check (method <> 'model' or model is not null),
  unique (article_id, layer, entity_key)
);
-- "news about this item": the map asks by layer and item.
create index if not exists world_news_pairs_entity_recent on public.world_news_pairs (layer, entity_key, created_at desc);
-- retention
create index if not exists world_news_pairs_created on public.world_news_pairs (created_at);

alter table public.world_news_pairs enable row level security;
revoke all on public.world_news_pairs from anon, authenticated;
grant select, insert, update, delete on public.world_news_pairs to service_role;

-- Seven days are kept, like media_news_articles.
create or replace function public.world_news_pairs_prune() returns void
language sql security definer set search_path = public as $$
  delete from public.world_news_pairs where created_at < now() - interval '7 days';
$$;
revoke all on function public.world_news_pairs_prune() from public, anon, authenticated;
grant execute on function public.world_news_pairs_prune() to service_role;
