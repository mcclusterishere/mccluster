-- Run outside a transaction before analytics_long_range_v4.
create index concurrently if not exists media_news_geo_window_v4_idx on public.media_news_articles (ingestion_provider, published_at, id) where location_country_fips is not null;

