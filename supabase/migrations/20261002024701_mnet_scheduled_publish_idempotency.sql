-- Make scheduled publication crash-safe and idempotent.
-- A Worker may die after inserting network_posts but before acknowledging
-- network_scheduled_posts. This durable key lets the next run find the
-- already-created post, while the unique index makes duplicate publication
-- impossible even if recovery attempts race.
alter table public.network_posts
  add column if not exists scheduled_post_id uuid
  references public.network_scheduled_posts(id) on delete set null;

create unique index if not exists network_posts_scheduled_post_id_uidx
  on public.network_posts (scheduled_post_id)
  where scheduled_post_id is not null;

comment on column public.network_posts.scheduled_post_id is
  'Idempotency key for posts emitted from network_scheduled_posts.';
