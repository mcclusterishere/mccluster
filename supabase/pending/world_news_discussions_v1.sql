-- PENDING REVIEW ONLY: do not apply to production or auto-promote.
-- News comments are original member contributions, not copied publisher text.
-- A discussion follows the retained discovery record and is removed when
-- that source record is pruned. Long-term archives require a separate policy.
begin;
create table if not exists public.media_news_comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.media_news_articles(id) on delete cascade,
  author_m_uid uuid not null references public.m_people(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  state text not null default 'visible' check (state in ('visible','hidden')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists media_news_comments_article_recent_idx
  on public.media_news_comments(article_id, created_at, id)
  where state='visible' and deleted_at is null;
create index if not exists media_news_comments_author_recent_idx
  on public.media_news_comments(author_m_uid, created_at desc);

alter table public.media_news_comments enable row level security;
revoke all on public.media_news_comments from public, anon, authenticated;
grant select, insert, update, delete on public.media_news_comments to service_role;

-- Atomic per-actor ceiling; independent of the browser and safe under races.
create or replace function public.media_news_comment_rate_guard_v1()
returns trigger language plpgsql security invoker
set search_path = pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('media-news-comment:' || new.author_m_uid::text,0));
  if (select count(*) from public.media_news_comments
      where author_m_uid=new.author_m_uid
        and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Too many comments; try again shortly' using errcode='MN429';
  end if;
  return new;
end $$;
revoke all on function public.media_news_comment_rate_guard_v1()
  from public, anon, authenticated;
grant execute on function public.media_news_comment_rate_guard_v1() to service_role;
drop trigger if exists media_news_comments_rate_v1 on public.media_news_comments;
create trigger media_news_comments_rate_v1
before insert on public.media_news_comments
for each row execute function public.media_news_comment_rate_guard_v1();
commit;
