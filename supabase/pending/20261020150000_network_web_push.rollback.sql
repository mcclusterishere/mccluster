-- Rollback for 20261020150000_network_web_push.sql. Set WEB_PUSH_ENABLED = "false" first.
drop index if exists public.network_notifications_unpushed_idx;
alter table public.network_notifications drop column if exists pushed_at;
drop table if exists public.network_push_subscriptions;
