-- Scheduled Action Network posts.
-- The create page can post now or pick a time. A scheduled post is held
-- here, validated, and the Worker's five-minute cron publishes it into
-- network_posts when its time comes. Only the Worker (service role) reads
-- or writes this table; members reach their own rows through the API.
create table if not exists public.network_scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  author_m_uid uuid not null references public.m_people(id) on delete cascade,
  publish_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled','publishing','published','failed','cancelled')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  post_id uuid references public.network_posts(id) on delete set null,
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists network_scheduled_posts_due_idx
  on public.network_scheduled_posts (publish_at) where status = 'scheduled';
create index if not exists network_scheduled_posts_author_idx
  on public.network_scheduled_posts (author_m_uid, publish_at desc);

alter table public.network_scheduled_posts enable row level security;
revoke all on table public.network_scheduled_posts from public, anon, authenticated;
grant all on table public.network_scheduled_posts to service_role;

comment on table public.network_scheduled_posts is
  'Action Network posts waiting for their time. Written and published only by the mccluster Worker.';
