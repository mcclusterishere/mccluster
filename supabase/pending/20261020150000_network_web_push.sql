-- ALERTS ON MEMBERS' DEVICES (pending; not applied in production)
--
-- Owner, 2026-10-20: people come back when something happened for them. A member
-- turns alerts on for one browser; the Worker's five-minute cron
-- (workers/mccluster/src/web-push.js) pushes what the bell already shows.
--
--   network_push_subscriptions   one row per browser: the push service URL and the
--                                browser's two public keys. Service role only; the
--                                Worker writes it after checking the URL is a
--                                browser push service.
--   network_notifications.pushed_at
--                                when the cron claimed the alert. Every existing
--                                alert is marked claimed here, so turning push on
--                                never sends a backlog.
--
-- Turning it on also needs WEB_PUSH_ENABLED = "true" and the VAPID secrets (see
-- workers/mccluster/wrangler.toml). Rollback: 20261020150000_network_web_push.rollback.sql

create table if not exists public.network_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  m_uid uuid not null references public.m_people(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 86 and 88),
  auth text not null check (char_length(auth) between 21 and 24),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  failures integer not null default 0 check (failures >= 0),
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists network_push_subscriptions_member_idx on public.network_push_subscriptions (m_uid);
alter table public.network_push_subscriptions enable row level security;
revoke all on public.network_push_subscriptions from public, anon, authenticated;

alter table public.network_notifications add column if not exists pushed_at timestamptz;
update public.network_notifications set pushed_at = created_at where pushed_at is null;
create index if not exists network_notifications_unpushed_idx
  on public.network_notifications (created_at) where pushed_at is null;
