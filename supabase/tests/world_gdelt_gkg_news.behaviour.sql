-- Behaviour tests for supabase/migrations/20261016151123_world_gdelt_gkg_news_v1.sql on top of
-- ChatGPT's #432 media namespace, as the real API roles with the JWT claims
-- Supabase would set. Runs against a scratch database
-- (scripts/test-world-news-db.sh). Every check raises on failure.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create or replace function pg_temp.as_role(p_role text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, false);
  if p_role = 'service_role' then execute 'reset role'; else execute format('set role %I', p_role); end if;
end $$;
create or replace function pg_temp.must_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm not ilike p_like then raise exception 'expected error like % from [%], got: %', p_like, p_sql, sqlerrm; end if;
    return;
  end;
  raise exception 'expected failure (%), but it succeeded: %', p_like, p_sql;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'check failed: %', p_what; end if; end $$;
/* one GKG article as the Worker sends it (workers/mccluster/src/world-news.js toPayload) */
create or replace function pg_temp.art(p_url text, p_title text, p_seen timestamptz, p_story text,
  p_place text default null, p_lat double precision default null, p_lon double precision default null,
  p_type integer default null, p_fips text default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('url', p_url, 'title', p_title, 'domain', 'gkg.example',
    'seen_at', to_char(p_seen at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'story_key', p_story,
    'place', p_place, 'lat', p_lat, 'lon', p_lon, 'location_type', p_type, 'country_fips', p_fips, 'tone', -1.5,
    'image', 'https://gkg.example/i.jpg'))
$$;

select pg_temp.as_role('service_role');

-- 1. #432's headline-country rule still runs for its own rows, on both tables
insert into public.media_news_sources(domain) values ('doc.example');
insert into public.media_news_articles(source_id, canonical_url, title, published_at, ingestion_provider, topic_keys)
  select id, 'https://doc.example/1', 'Floods in Kenya displace thousands', now() - interval '3 hours', 'gdelt_doc_v2', '{world}'
    from public.media_news_sources where domain = 'doc.example';
select pg_temp.ok((select location_basis = 'headline_country_mention' and headline_location_label = 'Kenya'
  from public.media_news_articles where canonical_url = 'https://doc.example/1'), 'a DOC row still gets its headline country');
insert into public.media_entities(name, entity_type) values ('Doc Outlet', 'publisher');
insert into public.media_outlets(entity_id, domain) select id, 'outlet.example' from public.media_entities where name = 'Doc Outlet';
insert into public.media_articles(outlet_id, canonical_url, title, ingestion_provider)
  select id, 'https://outlet.example/1', 'Elections in Nigeria', 'gdelt_doc_v2' from public.media_outlets where domain = 'outlet.example';
select pg_temp.ok((select location_basis = 'headline_country_mention' and headline_location_label = 'Nigeria'
  from public.media_articles where canonical_url = 'https://outlet.example/1'), 'media_articles keeps the headline rule');

-- 2. a file is claimed once; GKG rows keep their own place, and bad rows are refused
select pg_temp.ok(public.media_gdelt_file_claim('20261016000000.gkg.csv.zip'), 'first claim');
select pg_temp.ok(not public.media_gdelt_file_claim('20261016000000.gkg.csv.zip'), 'an open claim is not claimed twice');
select pg_temp.must_fail($$select public.media_gdelt_file_claim('../etc/passwd')$$, '%invalid_file%');
select pg_temp.ok((public.media_ingest_gdelt_gkg('20261016000000.gkg.csv.zip', 1200, jsonb_build_array(
  pg_temp.art('https://gkg.example/a', 'Nairobi council approves new transit plan', now() - interval '1 hour', 'nairobi council approves new transit plan', 'Nairobi, Nairobi Area, Kenya', -1.28333, 36.8167, 4, 'KE'),
  pg_temp.art('https://gkg.example/b', 'Kenya talks resume', now() - interval '1 hour', 'kenya talks resume', null, -1, 38, 1, 'KE'),
  pg_temp.art('javascript:alert(1)', 'bad', now() - interval '1 hour', 'bad'),
  pg_temp.art('https://gkg.example/c', 'Out of range', now() - interval '1 hour', 'out of range', 'Nowhere', 95, 10, 4, 'XX')
))->>'saved')::int = 3, 'three valid rows saved, the javascript: url refused');
select pg_temp.ok((select headline_location_label = 'Nairobi, Nairobi Area, Kenya' and headline_latitude = -1.28333 and headline_longitude = 36.8167
  and location_basis = 'gkg_article_mention' and location_type = 4 and location_country_fips = 'KE' and gdelt_file = '20261016000000.gkg.csv.zip'
  and image_url = 'https://gkg.example/i.jpg' and topic_keys = '{}' and ingestion_provider = 'gdelt_gkg_v2'
  from public.media_news_articles where canonical_url = 'https://gkg.example/a'), 'a GKG row keeps its city, its FIPS country and no topic');
select pg_temp.ok((select headline_location_label is null and headline_latitude = -1 and location_basis = 'gkg_article_mention'
  from public.media_news_articles where canonical_url = 'https://gkg.example/b'), 'the headline rule does not overwrite a GKG place (the title names Kenya)');
select pg_temp.ok((select headline_latitude is null and headline_longitude is null and headline_location_label is null and location_basis = 'none'
  from public.media_news_articles where canonical_url = 'https://gkg.example/c'), 'out-of-range coordinates are dropped, not stored');
select pg_temp.ok(not public.media_gdelt_file_claim('20261016000000.gkg.csv.zip'), 'a finished file is never claimed again');
select pg_temp.ok((select finished_at is not null and rows_seen = 1200 and articles_saved = 3 from public.media_gdelt_files
  where file_name = '20261016000000.gkg.csv.zip'), 'the file records what it gave');

-- 3. one copy of a syndicated story: the same headline from another station within 72 hours is skipped; older does not block
select public.media_gdelt_file_claim('20261016001500.gkg.csv.zip');
select pg_temp.ok((public.media_ingest_gdelt_gkg('20261016001500.gkg.csv.zip', 900, jsonb_build_array(
  pg_temp.art('https://other-station.example/a', 'Nairobi council approves new transit plan', now() - interval '45 minutes', 'nairobi council approves new transit plan')
))->>'saved')::int = 0, 'the syndicated copy in the next file is skipped');
select public.media_gdelt_file_claim('20261012000000.gkg.csv.zip');
select public.media_ingest_gdelt_gkg('20261012000000.gkg.csv.zip', 10, jsonb_build_array(
  pg_temp.art('https://gkg.example/old', 'A storm hits the coast', now() - interval '4 days', 'a storm hits the coast')));
select public.media_gdelt_file_claim('20261016003000.gkg.csv.zip');
select pg_temp.ok((public.media_ingest_gdelt_gkg('20261016003000.gkg.csv.zip', 10, jsonb_build_array(
  pg_temp.art('https://gkg.example/new', 'A storm hits the coast', now() - interval '30 minutes', 'a storm hits the coast')
))->>'saved')::int = 1, 'a story older than 72 hours does not block a new one');

-- 4. a failed file is released and claimed again on a later tick
select public.media_gdelt_file_claim('20261016004500.gkg.csv.zip');
select public.media_gdelt_file_release('20261016004500.gkg.csv.zip', 'data.gdeltproject.org 404');
select pg_temp.ok(public.media_gdelt_file_claim('20261016004500.gkg.csv.zip'), 'a released file is claimed again');

-- 5. the World's news: GKG rows only, newest first, every row once through the (time, id) cursor
create temp table paged(id uuid, n int);
do $$
declare r record; at timestamptz := null; bid uuid := null; n int := 0;
begin
  loop
    select * into r from public.media_world_news(at, bid, 1);
    exit when not found;
    n := n + 1; insert into paged values (r.id, n); at := r.seen_at; bid := r.id;
    exit when n > 50;
  end loop;
end $$;
select pg_temp.ok((select count(*) = count(distinct id) and count(*) = (select count(*) from public.media_news_articles where ingestion_provider = 'gdelt_gkg_v2') from paged),
  'one page at a time reaches every GKG row exactly once');
select pg_temp.ok(not exists (select 1 from public.media_world_news(null, null, 50) w join public.media_news_articles a on a.id = w.id where a.ingestion_provider <> 'gdelt_gkg_v2'),
  'the World news never returns #432 DOC rows');
select pg_temp.ok((select count(*) from public.media_world_news(null, null, 500)) <= 50, 'a page is at most 50');
-- places: cities and states only, counted
select pg_temp.ok((select count(*) = 1 and min(place) = 'Nairobi, Nairobi Area, Kenya' from public.media_world_news_places(24, 150)),
  'the globe gets the city, not the country centroid or the dropped point');

-- 6. nothing reaches anon or a signed-in member, and #432's anon function still shows only its own topic rows
select pg_temp.as_role('anon');
select pg_temp.must_fail($$select public.media_world_news()$$, '%permission denied%');
select pg_temp.must_fail($$select public.media_world_news_places()$$, '%permission denied%');
select pg_temp.must_fail($$select public.media_ingest_gdelt_gkg('20261016010000.gkg.csv.zip', 1, '[]'::jsonb)$$, '%permission denied%');
select pg_temp.must_fail($$select public.media_gdelt_file_claim('20261016010000.gkg.csv.zip')$$, '%permission denied%');
select pg_temp.must_fail($$select public.media_gdelt_file_release('20261016010000.gkg.csv.zip', 'x')$$, '%permission denied%');
select pg_temp.must_fail($$select public.media_news_prune(7)$$, '%permission denied%');
select pg_temp.must_fail($$select * from public.media_gdelt_files$$, '%permission denied%');
select pg_temp.ok((select count(*) = 1 from public.media_public_cached_news('world', 40)), 'anon sees only the DOC row through #432''s function');
select pg_temp.as_role('authenticated');
select pg_temp.must_fail($$select public.media_world_news()$$, '%permission denied%');
select pg_temp.must_fail($$select public.media_ingest_gdelt_gkg('20261016010000.gkg.csv.zip', 1, '[]'::jsonb)$$, '%permission denied%');
-- the functions check the caller themselves too
select pg_temp.as_role('service_role');
select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
select pg_temp.must_fail($$select public.media_gdelt_file_claim('20261016010000.gkg.csv.zip')$$, '%service_role_required%');
select pg_temp.must_fail($$select public.media_news_prune(7)$$, '%service_role_required%');
select pg_temp.as_role('service_role');

-- 7. a week is kept, and only GKG rows are pruned
update public.media_news_articles set imported_at = now() - interval '8 days' where canonical_url in ('https://gkg.example/old', 'https://doc.example/1');
select pg_temp.ok(public.media_news_prune(7) = 1, 'one GKG row past a week is pruned');
select pg_temp.ok(exists (select 1 from public.media_news_articles where canonical_url = 'https://doc.example/1'), '#432''s DOC row is never pruned here');
select pg_temp.ok(not exists (select 1 from public.media_news_articles where canonical_url = 'https://gkg.example/old'), 'the old GKG row is gone');

\echo 'world news behaviour: ok'
