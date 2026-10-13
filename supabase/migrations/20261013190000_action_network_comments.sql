-- Action Network comments. Server APIs enforce parent visibility and member blocks.
create table if not exists public.network_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.network_posts(id) on delete cascade,
  author_m_uid uuid not null references public.m_people(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists network_post_comments_post_recent_idx
  on public.network_post_comments (post_id,created_at desc) where deleted_at is null;
create index if not exists network_post_comments_author_idx
  on public.network_post_comments (author_m_uid,created_at desc);
alter table public.network_post_comments enable row level security;
revoke all on public.network_post_comments from anon,authenticated;
-- No direct client access: only authenticated Worker API using service role.
