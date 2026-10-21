-- Every account's front page (supabase/pending/member_fronts_v1.sql), as the real API roles see it.
-- Scratch database only (supabase_api_roles.stub.sql + supabase_storage.stub.sql). No production rows.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('22222222-2222-4222-8222-222222222222','benji@example.test'),
 ('44444444-4444-4444-8444-444444444444','visitor@example.test');

-- THE TABLE IS THE WORKER'S: no API role but the service role reaches it.
set local role anon;
do $$ begin
  begin perform 1 from public.member_fronts; raise exception 'anon read member_fronts';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true); end $$;
do $$ begin
  begin perform 1 from public.member_fronts; raise exception 'an account read member_fronts directly';
  exception when insufficient_privilege then null; end;
  begin insert into public.member_fronts(m_uid,auth_user_id,handle) values (gen_random_uuid(),'22222222-2222-4222-8222-222222222222','benji.chase');
    raise exception 'an account wrote member_fronts directly';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
insert into public.member_fronts(m_uid,auth_user_id,handle,draft) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','benji.chase','{"words":{"title1":"HITMAN"}}');
-- the Worker's upsert (POST ?on_conflict=m_uid, merge-duplicates)
insert into public.member_fronts(m_uid,auth_user_id,handle,draft,published,published_at) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','benji.chase','{"words":{"title1":"BENJI"}}','{"words":{"title1":"BENJI"}}',now())
 on conflict (m_uid) do update set draft=excluded.draft, published=excluded.published, published_at=excluded.published_at;
do $$ begin
  if (select draft->'words'->>'title1' from public.member_fronts where handle='benji.chase') <> 'BENJI' then raise exception 'upsert failed'; end if;
  -- one page per handle, and a handle is a handle
  begin insert into public.member_fronts(m_uid,auth_user_id,handle) values (gen_random_uuid(),'44444444-4444-4444-8444-444444444444','benji.chase');
    raise exception 'two pages took one handle';
  exception when unique_violation then null; end;
  begin insert into public.member_fronts(m_uid,auth_user_id,handle) values (gen_random_uuid(),'44444444-4444-4444-8444-444444444444','No Spaces!');
    raise exception 'a bad handle was stored';
  exception when check_violation then null; end;
  begin insert into public.member_fronts(m_uid,auth_user_id,handle,draft) values (gen_random_uuid(),'44444444-4444-4444-8444-444444444444','visitor.one','[1,2]');
    raise exception 'a draft that is not an object was stored';
  exception when check_violation then null; end;
  begin insert into public.member_fronts(m_uid,auth_user_id,handle,draft) values (gen_random_uuid(),'44444444-4444-4444-8444-444444444444','visitor.one',jsonb_build_object('x',repeat(md5(random()::text),4000)));
    raise exception 'an oversized draft was stored';
  exception when check_violation then null; end;
end $$;
reset role;

-- THE BUCKET: public, bounded, its types only
do $$ declare b record; begin
  select * into b from storage.buckets where id='front-media';
  if not b.public or b.file_size_limit <> 314572800 or not ('image/webp' = any(b.allowed_mime_types)) or 'text/html' = any(b.allowed_mime_types) then raise exception 'bucket shape: %', row_to_json(b); end if;
end $$;

-- AN ACCOUNT WRITES ITS OWN FOLDER, AND NO ONE ELSE'S
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}',true); end $$;
insert into storage.objects(bucket_id,name) values
 ('front-media','22222222-2222-4222-8222-222222222222/films/a1/0001.webp'),
 ('front-media','22222222-2222-4222-8222-222222222222/films/a1/sm/0001.webp');
-- an upsert reads its own file first, then replaces it
update storage.objects set metadata='{"size":10}' where bucket_id='front-media' and name='22222222-2222-4222-8222-222222222222/films/a1/0001.webp';
do $$ begin
  if (select count(*) from storage.objects where bucket_id='front-media') <> 2 then raise exception 'an account does not see its own folder'; end if;
  begin insert into storage.objects(bucket_id,name) values ('front-media','44444444-4444-4444-8444-444444444444/films/x/0001.webp');
    raise exception 'an account wrote into another account''s folder';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects(bucket_id,name) values ('front-media','loose.webp');
    raise exception 'an account wrote outside any folder';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true); end $$;
do $$ declare n int; begin
  -- another account lists nothing of his, and cannot touch it
  if (select count(*) from storage.objects where bucket_id='front-media') <> 0 then raise exception 'another account listed his uploads'; end if;
  update storage.objects set metadata='{"size":1}' where bucket_id='front-media';
  get diagnostics n = row_count; if n <> 0 then raise exception 'another account replaced his files'; end if;
  delete from storage.objects where bucket_id='front-media';
  get diagnostics n = row_count; if n <> 0 then raise exception 'another account removed his files'; end if;
end $$;
reset role;
set local role anon;
do $$ begin perform set_config('request.jwt.claims','{"role":"anon"}',true); end $$;
do $$ begin
  if (select count(*) from storage.objects where bucket_id='front-media') <> 0 then raise exception 'anon listed the bucket'; end if;
  begin insert into storage.objects(bucket_id,name) values ('front-media','22222222-2222-4222-8222-222222222222/x.webp');
    raise exception 'anon uploaded';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
\echo 'member fronts: table locked to the Worker; bucket folders held to their owner; no listing'
