-- World news from GDELT's 15-minute GKG files (owner, 2026-10-15: "I want you to ingest the GDELT immediately ...
-- we need a database change"). PENDING: written and tested, not applied in production. Promote with the steps in
-- supabase/pending/README.md, then set WORLD_NEWS_INGEST_ENABLED = "true" (workers/mccluster/wrangler.toml).
--
-- Whose store: ChatGPT's #432 raw-discovery namespace (20261014023548: media_news_articles, media_news_sources,
-- media_ingestion_runs, the headline-country trigger), which has never held a row because its DOC 2.0 path has no
-- authenticated scheduler. This adds beside it and changes nothing of #432's except one guard line in the trigger
-- function. The Worker's cron (workers/mccluster/src/world-news.js) reads each GKG 2.1 file once, keeps about 100
-- articles with the place each one mentions most, and writes them through media_ingest_gdelt_gkg as rows marked
-- ingestion_provider 'gdelt_gkg_v2'; the World reads them only through the Worker (media_world_news, and
-- media_world_news_places for the globe layer that joins world-layers.js later). Coordinates are where an article
-- mentions a place (GDELT's extraction), never a verified event location; location_country_fips is GDELT's FIPS 10-4
-- code (UK, GM, AS), not ISO 3166. GDELT data is free to rehost with a citation and a link.
--
-- Two rules for later work: topic_keys stays '{}' on gdelt_gkg_v2 rows, because media_public_cached_news (#432) is
-- granted to anon and keyed on topic_keys alone, so a tagged row would be published to anon; and media_gdelt_files is
-- the GKG counterpart of #432's media_gdelt_state (which tracks DOC topics, one cooldown row each), not a copy of it.
-- Tested by supabase/tests/world_gdelt_gkg_news.behaviour.sql (scripts/test-world-news-db.sh).

set local lock_timeout = '5s';

alter table public.media_news_articles
  add column if not exists gdelt_file text,
  add column if not exists location_type smallint,
  add column if not exists location_country_fips text,
  add column if not exists tone real,
  add column if not exists image_url text,
  add column if not exists story_key text;

create index if not exists media_news_articles_gkg_feed_idx
  on public.media_news_articles (published_at desc, id desc)
  where ingestion_provider = 'gdelt_gkg_v2';

-- One copy of a syndicated story: the same headline on another station's URL within 72 hours is the same story.
create index if not exists media_news_articles_gkg_story_idx
  on public.media_news_articles (story_key, published_at desc)
  where ingestion_provider = 'gdelt_gkg_v2';

-- The headline-country rule clears every location before it looks at the title; GKG rows carry their own.
create or replace function public.media_apply_geo_rule()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare matches integer; rule record;
begin
 if new.ingestion_provider = 'gdelt_gkg_v2' then return new; end if;
 new.headline_location_label:=null;new.headline_latitude:=null;new.headline_longitude:=null;new.location_rule_id:=null;new.location_basis:='none';
 select count(*) into matches from public.media_geo_rules g where g.enabled and new.title ~* ('\m'||g.country_name||'\M');
 if matches=1 then
  select g.* into rule from public.media_geo_rules g where g.enabled and new.title ~* ('\m'||g.country_name||'\M') limit 1;
  new.headline_location_label:=rule.country_name;new.headline_latitude:=rule.latitude;new.headline_longitude:=rule.longitude;new.location_rule_id:=rule.id;new.location_basis:='headline_country_mention';
 end if;
 return new;
end $function$;

-- Each 15-minute file is read once (the GKG counterpart of media_gdelt_state). A claim that never finished frees itself
-- after 10 minutes.
create table if not exists public.media_gdelt_files (
  file_name text primary key check (file_name ~ '^[0-9]{14}\.gkg\.csv\.zip$'),
  claimed_at timestamptz not null default now(),
  finished_at timestamptz,
  rows_seen integer,
  articles_saved integer,
  error_text text
);
alter table public.media_gdelt_files enable row level security;
revoke all on table public.media_gdelt_files from public, anon, authenticated;
grant all on table public.media_gdelt_files to service_role;

create or replace function public.media_gdelt_file_claim(p_file text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare claimed boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_file is null or p_file !~ '^[0-9]{14}\.gkg\.csv\.zip$' then raise exception 'invalid_file'; end if;
  insert into public.media_gdelt_files as f (file_name) values (p_file)
  on conflict (file_name) do update set claimed_at = now(), error_text = null
    where f.finished_at is null and f.claimed_at < now() - interval '10 minutes'
  returning true into claimed;
  return coalesce(claimed, false);
end $function$;

create or replace function public.media_gdelt_file_release(p_file text, p_error text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  update public.media_gdelt_files
     set error_text = left(coalesce(p_error, 'failed'), 500), claimed_at = now() - interval '1 hour'
   where file_name = p_file and finished_at is null;
end $function$;

create or replace function public.media_ingest_gdelt_gkg(p_file text, p_rows_seen integer, p_articles jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a jsonb; src uuid; saved integer := 0; n integer; lat double precision; lon double precision; received integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  if p_file is null or p_file !~ '^[0-9]{14}\.gkg\.csv\.zip$' then raise exception 'invalid_file'; end if;
  if jsonb_typeof(p_articles) <> 'array' or jsonb_array_length(p_articles) > 150 then raise exception 'invalid_batch'; end if;
  received := jsonb_array_length(p_articles);
  for a in select value from jsonb_array_elements(p_articles) loop
    if coalesce(a->>'url', '') !~ '^https?://' or length(a->>'url') > 2000
       or btrim(coalesce(a->>'title', '')) = ''
       or coalesce(a->>'domain', '') !~ '^[a-z0-9.-]+\.[a-z]{2,}$'
       or coalesce(a->>'seen_at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then
      continue;
    end if;
    if nullif(a->>'story_key', '') is not null and exists (
         select 1 from public.media_news_articles x
          where x.ingestion_provider = 'gdelt_gkg_v2'
            and x.story_key = left(a->>'story_key', 300)
            and x.published_at > (a->>'seen_at')::timestamptz - interval '72 hours') then
      continue;
    end if;
    lat := case when coalesce(a->>'lat', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (a->>'lat')::double precision end;
    lon := case when coalesce(a->>'lon', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (a->>'lon')::double precision end;
    if lat is null or lon is null or abs(lat) > 90 or abs(lon) > 180 then lat := null; lon := null; end if;
    insert into public.media_news_sources (domain, language_code) values (lower(a->>'domain'), 'English')
    on conflict (domain) do update set domain = excluded.domain
    returning id into src;
    insert into public.media_news_articles (
      source_id, canonical_url, title, published_at, language_code, topic_keys, ingestion_provider,
      headline_location_label, headline_latitude, headline_longitude, location_basis,
      gdelt_file, location_type, location_country_fips, tone, image_url, story_key)
    values (
      src, a->>'url', left(btrim(a->>'title'), 250), (a->>'seen_at')::timestamptz, 'English', '{}', 'gdelt_gkg_v2',
      case when lat is not null then nullif(left(btrim(coalesce(a->>'place', '')), 200), '') end, lat, lon,
      case when lat is not null then 'gkg_article_mention' else 'none' end,
      p_file,
      case when coalesce(a->>'location_type', '') ~ '^[1-5]$' then (a->>'location_type')::smallint end,
      nullif(left(coalesce(a->>'country_fips', ''), 8), ''),
      case when coalesce(a->>'tone', '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (a->>'tone')::real end,
      case when coalesce(a->>'image', '') ~ '^https://' and length(a->>'image') <= 2000 then a->>'image' end,
      nullif(left(coalesce(a->>'story_key', ''), 300), ''))
    on conflict (canonical_url) do nothing;
    get diagnostics n = row_count;
    saved := saved + n;
  end loop;
  update public.media_gdelt_files
     set finished_at = now(), rows_seen = greatest(coalesce(rows_seen, 0), coalesce(p_rows_seen, 0)),
         articles_saved = coalesce(articles_saved, 0) + saved, error_text = null
   where file_name = p_file;
  insert into public.media_ingestion_runs (provider, topic, started_at, finished_at, articles_received, articles_saved)
  values ('gdelt_gkg_v2', 'world', now(), now(), received, saved);
  return jsonb_build_object('file', p_file, 'received', received, 'saved', saved);
end $function$;

-- The World's news, newest first; the cursor is (seen_at, id) because a whole file shares one seen_at.
create or replace function public.media_world_news(p_before_at timestamptz default null, p_before_id uuid default null, p_limit integer default 20)
 returns table (id uuid, title text, url text, domain text, seen_at timestamptz, place text, lat double precision, lon double precision)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select a.id, a.title, a.canonical_url, s.domain, a.published_at, a.headline_location_label, a.headline_latitude, a.headline_longitude
    from public.media_news_articles a
    join public.media_news_sources s on s.id = a.source_id
   where a.ingestion_provider = 'gdelt_gkg_v2'
     and a.published_at is not null
     and (p_before_at is null
          or (a.published_at, a.id) < (p_before_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
   order by a.published_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$function$;

-- Places in the news for the globe: cities and states only (a country's centroid says little), counted, with the latest headline.
create or replace function public.media_world_news_places(p_hours integer default 24, p_limit integer default 150)
 returns table (place text, lat double precision, lon double precision, count bigint, title text, url text, seen_at timestamptz)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with recent as (
    select a.headline_location_label as place,
           round(a.headline_latitude::numeric, 2)::double precision as lat,
           round(a.headline_longitude::numeric, 2)::double precision as lon,
           a.title, a.canonical_url, a.published_at, a.id
      from public.media_news_articles a
     where a.ingestion_provider = 'gdelt_gkg_v2'
       and a.headline_latitude is not null
       and a.location_type in (2, 3, 4, 5)
       and a.published_at > now() - make_interval(hours => least(greatest(coalesce(p_hours, 24), 1), 72))
  )
  select place, lat, lon, count(*),
         (array_agg(title order by published_at desc, id desc))[1],
         (array_agg(canonical_url order by published_at desc, id desc))[1],
         max(published_at)
    from recent
   group by place, lat, lon
   order by count(*) desc, max(published_at) desc
   limit least(greatest(coalesce(p_limit, 150), 1), 300);
$function$;

-- A week of news is kept; file claims a month.
create or replace function public.media_news_prune(p_keep_days integer default 7)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
  delete from public.media_news_articles
   where ingestion_provider = 'gdelt_gkg_v2'
     and imported_at < now() - make_interval(days => least(greatest(coalesce(p_keep_days, 7), 1), 90));
  get diagnostics n = row_count;
  delete from public.media_gdelt_files where claimed_at < now() - interval '30 days';
  return n;
end $function$;

revoke all on function public.media_gdelt_file_claim(text) from public, anon, authenticated;
revoke all on function public.media_gdelt_file_release(text, text) from public, anon, authenticated;
revoke all on function public.media_ingest_gdelt_gkg(text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.media_world_news(timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.media_world_news_places(integer, integer) from public, anon, authenticated;
revoke all on function public.media_news_prune(integer) from public, anon, authenticated;
grant execute on function public.media_gdelt_file_claim(text) to service_role;
grant execute on function public.media_gdelt_file_release(text, text) to service_role;
grant execute on function public.media_ingest_gdelt_gkg(text, integer, jsonb) to service_role;
grant execute on function public.media_world_news(timestamptz, uuid, integer) to service_role;
grant execute on function public.media_world_news_places(integer, integer) to service_role;
grant execute on function public.media_news_prune(integer) to service_role;
