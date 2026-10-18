\set ON_ERROR_STOP on
-- Seed only fictitious IDs and editorial stubs.
insert into public.media_news_articles(id,canonical_url)
 values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://publisher.invalid/article');
insert into public.m_people(id,status)
 values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','active'),
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','active');

-- An anonymous/public client must not see or write first-party discussions.
set role anon;
do $$ begin
  begin perform count(*) from public.media_news_comments;
    raise exception 'anon can read discussions'; exception when insufficient_privilege then null; end;
  begin insert into public.media_news_comments(article_id,author_m_uid,body)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','no');
    raise exception 'anon can write discussions'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ begin
  begin perform count(*) from public.media_news_comments;
    raise exception 'authenticated can read the private storage directly'; exception when insufficient_privilege then null; end;
  begin insert into public.media_news_comments(article_id,author_m_uid,body)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','no');
    raise exception 'authenticated can write discussion storage directly'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- The server may write bounded member comments and hide moderated rows.
set role service_role;
insert into public.media_news_comments(article_id,author_m_uid,body)
 values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Community context one');
do $$ begin
  begin insert into public.media_news_comments(article_id,author_m_uid,body)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc','   ');
    raise exception 'blank comment accepted'; exception when check_violation then null; end;
  begin insert into public.media_news_comments(article_id,author_m_uid,body)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','cccccccc-cccc-4ccc-8ccc-cccccccccccc',repeat('x',1001));
    raise exception 'oversized comment accepted'; exception when check_violation then null; end;
  begin insert into public.media_news_comments(article_id,author_m_uid,body)
    values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','orphan');
    raise exception 'missing article accepted'; exception when foreign_key_violation then null; end;
end $$;
do $$ declare n integer;begin
 for n in 1..4 loop
  insert into public.media_news_comments(article_id,author_m_uid,body)
   values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bounded reply '||n);
 end loop;
 begin
  insert into public.media_news_comments(article_id,author_m_uid,body)
   values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','the sixth reply');
  raise exception 'rate guard failed: sixth comment accepted';
 exception when SQLSTATE 'MN429' then null; end;
end $$;
update public.media_news_comments set state='hidden'
 where author_m_uid='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and body='Community context one';
do $$ begin
 if (select count(*) from public.media_news_comments where state='visible')<>4
   then raise exception 'moderation state failed'; end if;
end $$;
reset role;
select 'News comments PostgreSQL roles, length, article, rate and moderation gates passed' as result;
