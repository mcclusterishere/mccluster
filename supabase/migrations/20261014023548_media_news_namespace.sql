create table if not exists public.media_news_sources(
 id uuid primary key default gen_random_uuid(),domain text not null unique,
 language_code text,created_at timestamptz not null default now()
);
create table if not exists public.media_news_articles(
 id uuid primary key default gen_random_uuid(),
 source_id uuid not null references public.media_news_sources(id),
 canonical_url text not null unique,title text not null,
 published_at timestamptz,language_code text,topic_keys text[] not null default '{}',
 ingestion_provider text not null default 'gdelt_doc_v2',
 headline_location_label text,headline_latitude float8,headline_longitude float8,
 location_rule_id uuid,location_basis text not null default 'none',
 imported_at timestamptz not null default now()
);
create index if not exists media_news_articles_geo_idx on public.media_news_articles(location_basis,published_at desc);
drop trigger if exists media_news_auto_geo_pin on public.media_news_articles;
create trigger media_news_auto_geo_pin before insert or update of title on public.media_news_articles for each row execute function public.media_apply_geo_rule();
alter table public.media_news_sources enable row level security;
alter table public.media_news_articles enable row level security;
revoke all on public.media_news_sources,public.media_news_articles from anon,authenticated;
grant all on public.media_news_sources,public.media_news_articles to service_role;
create or replace view public.media_public_world_feed as
 select a.id,a.title,a.canonical_url,a.published_at,a.language_code,a.topic_keys,
 a.headline_location_label,a.headline_latitude,a.headline_longitude,a.location_basis,
 o.domain as publisher_domain
 from public.media_news_articles a join public.media_news_sources o on o.id=a.source_id
 where a.ingestion_provider='gdelt_doc_v2';
grant select on public.media_public_world_feed to anon,authenticated;
create or replace function public.media_ingest_gdelt_batch(p_topic text,p_articles jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb; domain_name text; article_url text; title_text text; oid uuid; saved integer:=0; received integer:=0; parsed_at timestamptz; raw_time text;
begin
 if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
 if p_topic not in ('world','policy','climate','health','technology') then raise exception 'invalid_topic'; end if;
 if jsonb_typeof(p_articles)<>'array' or jsonb_array_length(p_articles)>100 then raise exception 'invalid_batch'; end if;
 for item in select value from jsonb_array_elements(p_articles) loop
  received:=received+1;article_url:=item->>'url';title_text:=left(coalesce(item->>'title',''),250);
  domain_name:=lower(left(coalesce(item->>'domain',''),150));
  if article_url is null or article_url !~* '^https?://' or length(article_url)>2000 or title_text='' or domain_name !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then continue; end if;
  insert into public.media_news_sources(domain,language_code) values(domain_name,left(item->>'language',40))
  on conflict(domain) do update set domain=excluded.domain returning id into oid;
  parsed_at:=null;raw_time:=item->>'published_at';
  begin if raw_time is not null then parsed_at:=raw_time::timestamptz; end if; exception when others then parsed_at:=null; end;
  insert into public.media_news_articles(source_id,canonical_url,title,published_at,language_code,topic_keys,ingestion_provider)
  values(oid,article_url,title_text,parsed_at,left(item->>'language',40),array[p_topic],'gdelt_doc_v2')
  on conflict(canonical_url) do update set
   title=excluded.title,
   topic_keys=(select array(select distinct unnest(public.media_news_articles.topic_keys || excluded.topic_keys))),
   published_at=coalesce(public.media_news_articles.published_at,excluded.published_at)
  where public.media_news_articles.ingestion_provider='gdelt_doc_v2';
  saved:=saved+1;
 end loop;
 insert into public.media_ingestion_runs(provider,topic,finished_at,articles_received,articles_saved)
 values('gdelt_doc_v2',p_topic,now(),received,saved);
 return jsonb_build_object('received',received,'processed',saved);
end $$;
revoke all on function public.media_ingest_gdelt_batch(text,jsonb) from public,anon,authenticated;
grant execute on function public.media_ingest_gdelt_batch(text,jsonb) to service_role;