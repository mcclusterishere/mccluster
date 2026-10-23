-- Run alone, outside a transaction, before analytics_read_hotpaths_v2.
create index concurrently if not exists media_news_articles_imported_v2_idx
  on public.media_news_articles (imported_at desc nulls last);
