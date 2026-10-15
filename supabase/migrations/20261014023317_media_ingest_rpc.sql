create or replace function public.media_ingest_gdelt_batch(p_topic text,p_articles jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare item jsonb; domain_name text; article_url text; title_text text; oid uuid; eid uuid; saved integer:=0; received integer:=0; parsed_at timestamptz; raw_time text;
begin
 if auth.role() <> 'service_role' then raise exception 'service_role_required'; end if;
 if p_topic not in ('world','policy','climate','health','technology') then raise exception 'invalid_topic'; end if;
 if jsonb_typeof(p_articles)<>'array' or jsonb_array_length(p_articles)>100 then raise exception 'invalid_batch'; end if;
 for item in select value from jsonb_array_elements(p_articles) loop
  received:=received+1;article_url:=item->>'url';title_text:=left(coalesce(item->>'title',''),250);
  domain_name:=lower(left(coalesce(item->>'domain',''),150));
  if article_url is null or article_url !~* '^https?://' or length(article_url)>2000 or title_text='' or domain_name !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then continue; end if;
  select id into oid from public.media_outlets where domain=domain_name;
  if oid is null then
   insert into public.media_entities(name,entity_type,official_url) values(domain_name,'publisher','https://'||domain_name) returning id into eid;
   insert into public.media_outlets(entity_id,domain,language_code,country_code,source_url)
   values(eid,domain_name,left(item->>'language',40),null,'https://www.gdeltproject.org/')
   on conflict(domain) do update set domain=excluded.domain returning id into oid;
  end if;
  parsed_at:=null;raw_time:=item->>'published_at';
  begin if raw_time is not null then parsed_at:=raw_time::timestamptz; end if; exception when others then parsed_at:=null; end;
  insert into public.media_articles(outlet_id,canonical_url,title,published_at,language_code,topic_keys,ingestion_provider)
  values(oid,article_url,title_text,parsed_at,left(item->>'language',40),array[p_topic],'gdelt_doc_v2')
  on conflict(canonical_url) do update set
   title=excluded.title,
   topic_keys=(select array(select distinct unnest(public.media_articles.topic_keys || excluded.topic_keys))),
   published_at=coalesce(public.media_articles.published_at,excluded.published_at)
  where public.media_articles.ingestion_provider='gdelt_doc_v2';
  saved:=saved+1;
 end loop;
 insert into public.media_ingestion_runs(provider,topic,finished_at,articles_received,articles_saved)
 values('gdelt_doc_v2',p_topic,now(),received,saved);
 return jsonb_build_object('received',received,'processed',saved);
end $$;
revoke all on function public.media_ingest_gdelt_batch(text,jsonb) from public,anon,authenticated;
grant execute on function public.media_ingest_gdelt_batch(text,jsonb) to service_role;
