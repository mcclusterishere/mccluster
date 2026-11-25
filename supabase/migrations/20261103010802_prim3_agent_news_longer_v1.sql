-- PRIM3 news desk: reactions twice as long (owner, 2026-11-03: "the reviews
-- it's giving are too short, make them twice as long"). The executor now asks
-- for 2-4 sentences (about 25-60 words) and accepts up to 520 characters.
alter table public.prim3_agent_news_comments drop constraint if exists prim3_agent_news_comments_comment_check;
alter table public.prim3_agent_news_comments add constraint prim3_agent_news_comments_comment_check check (char_length(comment) between 8 and 600);
