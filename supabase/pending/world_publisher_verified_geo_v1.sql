-- Publisher identity and verified geography: never infer HQ from story mentions.
-- Kept in review until migration promotion; existing GDELT ingestion is unchanged.
begin;
alter table public.media_news_sources
  add column if not exists publisher_kind text
    check(publisher_kind in ('newsroom','broadcast','wire','magazine','journal','blog','government','nonprofit','other')),
  add column if not exists headquarters_label text,
  add column if not exists headquarters_latitude double precision
    check(headquarters_latitude between -90 and 90),
  add column if not exists headquarters_longitude double precision
    check(headquarters_longitude between -180 and 180),
  add column if not exists headquarters_basis text
    check(headquarters_basis in ('official_address','publisher_directory','manual_review')),
  add column if not exists headquarters_source_url text
    check(headquarters_source_url is null or headquarters_source_url ~ '^https://'),
  add column if not exists headquarters_verified_at timestamptz;
alter table public.media_news_sources add constraint media_publisher_headquarters_complete
  check ((headquarters_latitude is null and headquarters_longitude is null and headquarters_basis is null
          and headquarters_verified_at is null)
      or (headquarters_latitude is not null and headquarters_longitude is not null
          and headquarters_basis is not null and headquarters_verified_at is not null
          and headquarters_source_url is not null));
comment on column public.media_news_sources.headquarters_basis is 'Location of the publisher, never the place mentioned in a story. Only verified information may be promoted.';
-- Keep existing table RLS; do not grant direct browser writes/reads.
revoke insert,update,delete on public.media_news_sources from anon,authenticated;
commit;