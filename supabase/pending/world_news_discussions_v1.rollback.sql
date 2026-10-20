-- Rollback for world_news_discussions_v1.sql. Replies disappear from the World at once:
-- the capability check fails closed when the table is gone.
begin;
drop trigger if exists media_news_comments_rate_v1 on public.media_news_comments;
drop function if exists public.media_news_comment_rate_guard_v1();
drop table if exists public.media_news_comments;
commit;
