-- The Worker (workers/mccluster/src/member-fronts.js) against the schema production actually has
-- (20261124164026_member_fronts_shared_revision_directory.sql): its service-role write shape, the revision columns it
-- now keeps, the database's own public read, and the browser's media uploads (js/front-media.js, x-upsert false).
\set ON_ERROR_STOP 1
insert into auth.users(id,email) values ('22222222-2222-4222-8222-222222222222','new@example.com'),('11111111-1111-4111-8111-111111111111','other@example.com');
insert into public.m_people(id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.platform_profiles values ('22222222-2222-4222-8222-222222222222','new.member','New Member',''),('11111111-1111-4111-8111-111111111111','other.member','Other','');
insert into public.m_auth_user_links values ('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true),('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
insert into public.network_profiles(m_uid,display_name,visibility) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','New Member','public'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Other','network');

-- 1. the browser cannot touch the table directly, as anon or as an account
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
  begin
    insert into public.member_fronts(m_uid,auth_user_id,handle) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','new.member');
    raise exception 'FAIL: an account wrote member_fronts directly';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- 2. the Worker's write shape (service role; PostgREST upsert on m_uid) is accepted, with the revision columns it keeps
set role service_role;
insert into public.member_fronts(m_uid,auth_user_id,handle,draft,updated_at,revision)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','new.member','{"schema":"mccluster-front/v1","words":{"title1":"NEW"}}',now(),1)
  on conflict (m_uid) do update set draft=excluded.draft,updated_at=excluded.updated_at,revision=excluded.revision;
insert into public.member_fronts(m_uid,auth_user_id,handle,draft,published,published_at,published_revision,updated_at,revision)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','new.member','{"schema":"mccluster-front/v1","words":{"title1":"NEW"}}','{"schema":"mccluster-front/v1","words":{"title1":"NEW"}}',now(),2,now(),2)
  on conflict (m_uid) do update set draft=excluded.draft,published=excluded.published,published_at=excluded.published_at,published_revision=excluded.published_revision,updated_at=excluded.updated_at,revision=excluded.revision;
do $$ declare r public.member_fronts%rowtype; begin
  select * into r from public.member_fronts where handle='new.member';
  if r.revision<>2 or r.published_revision<>2 or r.published is null then raise exception 'FAIL: worker write shape not stored: %', row_to_json(r); end if;
end $$;
reset role;

-- 3. the database's own public read agrees with the Worker: public profile served, network-only not
do $$ declare j jsonb; begin
  set local role anon;
  j:=public.member_front_public('new.member');
  if not (j->>'ok')::boolean then raise exception 'FAIL: public page of a public profile hidden: %', j; end if;
  reset role;
end $$;
set role service_role;
insert into public.member_fronts(m_uid,auth_user_id,handle,draft,published,published_at,published_revision,updated_at,revision)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-111111111111','other.member','{"schema":"mccluster-front/v1"}','{"schema":"mccluster-front/v1"}',now(),1,now(),1);
reset role;
do $$ declare j jsonb; begin
  set local role anon;
  j:=public.member_front_public('other.member');
  if (j->>'ok')::boolean then raise exception 'FAIL: a network-only profile was served publicly: %', j; end if;
  reset role;
end $$;

-- 4. uploads: a new object in the account's own folder is accepted; nothing overwrites; nobody writes another folder
do $$ begin
  set local role authenticated;
  perform set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222"}',true);
  insert into storage.objects(bucket_id,name,metadata) values ('front-media','22222222-2222-4222-8222-222222222222/still-abc.jpg','{"size":1000}');
  /* js/front-media.js before this change sent x-upsert: true; Storage turns that into ON CONFLICT DO UPDATE.
     A fresh name still inserts; a reused name is refused by the restrictive update boundary. */
  insert into storage.objects(bucket_id,name,metadata) values ('front-media','22222222-2222-4222-8222-222222222222/still-new.jpg','{"size":1000}')
    on conflict (bucket_id,name) do update set metadata=excluded.metadata;
  begin
    insert into storage.objects(bucket_id,name,metadata) values ('front-media','22222222-2222-4222-8222-222222222222/still-abc.jpg','{"size":2000}')
      on conflict (bucket_id,name) do update set metadata=excluded.metadata;
    raise exception 'FAIL: an upload overwrote a stored file';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id,name,metadata) values ('front-media','11111111-1111-4111-8111-111111111111/x.jpg','{"size":1}');
    raise exception 'FAIL: wrote another account''s folder';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;
select 'member fronts (applied schema): table Worker-only; worker write shape and revisions stored; public read matches; uploads own-folder and immutable' as ok;
