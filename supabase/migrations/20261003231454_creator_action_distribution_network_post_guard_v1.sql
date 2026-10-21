-- One native Action Network post per canonical creator content item.
-- External platforms may have many publish jobs/posts for the same content,
-- but the house network gets one authoritative top-level post.
create unique index if not exists network_posts_one_creator_content
  on public.network_posts(content_id)
  where content_id is not null and reply_to_id is null;
