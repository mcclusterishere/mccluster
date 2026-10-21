begin;
-- Keep bounded keyword retrieval and retention pruning indexed as news grows.
set local lock_timeout = '5s';
create index if not exists media_news_articles_title_fts_idx on public.media_news_articles using gin(to_tsvector('english',title));
create index if not exists media_news_articles_gkg_retention_idx on public.media_news_articles(imported_at) where ingestion_provider='gdelt_gkg_v2';
commit;
