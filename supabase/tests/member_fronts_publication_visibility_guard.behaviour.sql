-- Run only on a disposable database with the concurrent shared-revision schema.
-- The identities below are fixtures. This proof rolls every fixture back.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('a1000000-0000-4000-8000-000000000001','front-private@example.test'),
 ('a1000000-0000-4000-8000-000000000002','front-network@example.test'),
 ('a1000000-0000-4000-8000-000000000003','front-missing@example.test');
-- A full reset has auth triggers that create canonical identities/profiles.
-- Reuse them without replacing base objects or disabling triggers. The small
-- native harness has no auth triggers, so create only whichever rows are absent.
do $$
declare who uuid; fallback_m_uid uuid; handle text; profile_state text; identity_m_uid uuid;
begin
 for who,fallback_m_uid,handle,profile_state in select * from (values
  ('a1000000-0000-4000-8000-000000000001'::uuid,'b1000000-0000-4000-8000-000000000001'::uuid,'guard.private','private'),
  ('a1000000-0000-4000-8000-000000000002'::uuid,'b1000000-0000-4000-8000-000000000002'::uuid,'guard.network','network'),
  ('a1000000-0000-4000-8000-000000000003'::uuid,'b1000000-0000-4000-8000-000000000003'::uuid,'guard.missing','missing')
 ) as cases(who,fallback_m_uid,handle,profile_state) loop
  select m_uid into identity_m_uid from public.m_auth_user_links where auth_user_id=who and is_primary=true limit 1;
  if not found then
   identity_m_uid:=fallback_m_uid;
   insert into public.m_people(id) values(identity_m_uid);
   insert into public.m_auth_user_links(auth_user_id,m_uid,is_primary) values(who,identity_m_uid,true);
  end if;
  insert into public.platform_profiles(user_id,mccluster_id,display_name) values(who,handle,'Publication guard fixture')
   on conflict(user_id) do update set mccluster_id=excluded.mccluster_id,display_name=excluded.display_name;
  if profile_state='missing' then delete from public.network_profiles where m_uid=identity_m_uid;
  else
   insert into public.network_profiles(m_uid,visibility) values(identity_m_uid,profile_state)
    on conflict(m_uid) do update set visibility=excluded.visibility;
  end if;
 end loop;
end $$;

do $$ begin
 assert not has_function_privilege('anon','public.member_front_save(jsonb,integer,boolean,boolean)','EXECUTE'), 'anon must not gain publication access';
 assert not has_table_privilege('authenticated','public.member_fronts','INSERT'), 'members must still use the fenced RPC';
 assert has_function_privilege('anon','public.member_front_public(text)','EXECUTE'), 'public reads must retain their established access';
end $$;

set local role authenticated;
do $$
declare who uuid; profile_state text; r jsonb; expected_code text;
begin
 for who,profile_state in select * from (values
  ('a1000000-0000-4000-8000-000000000001'::uuid,'private'),
  ('a1000000-0000-4000-8000-000000000002'::uuid,'network'),
  ('a1000000-0000-4000-8000-000000000003'::uuid,'missing')
 ) as cases(who,profile_state) loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',who,'role','authenticated')::text,true);
  r:=public.member_front_save('{"schema":"mccluster-front/v1","words":{"title1":"Fixture"}}',0,false,false);
  assert (r->>'ok')::boolean and (r->>'revision')::integer=1, 'a nonpublic or missing profile must still save its private draft';
  expected_code:=case when profile_state='missing' then 'profile_required' else 'profile_not_public' end;
  r:=public.member_front_save('{"schema":"mccluster-front/v1","words":{"title1":"Attempt"}}',1,true,true);
  assert r->>'ok'='false', 'nonpublic publication must be refused';
  assert r->>'code'=expected_code, 'publication refusal must explain the profile prerequisite';
  r:=public.member_front_get_self();
  assert (r->>'revision')::integer=1 and r->'published'='null'::jsonb, 'a refusal must not change page revision or publication';
  assert r#>>'{draft,words,title1}'='Fixture' and r->>'globe_opt_in'='false', 'a refused publish must not replace the draft or opt into the directory';
 end loop;
end $$;
reset role;

-- An intentional profile setting change makes the saved draft publishable.
update public.network_profiles set visibility='public' where m_uid=(select m_uid from public.m_auth_user_links where auth_user_id='a1000000-0000-4000-8000-000000000001' and is_primary=true limit 1);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$ declare r jsonb; begin
 r:=public.member_front_save('{"schema":"mccluster-front/v1","words":{"title1":"Recovered"}}',1,true,true);
 assert r->>'ok'='true' and (r->>'revision')::integer=2 and r->'published'<>'null'::jsonb, 'public profile must publish with the expected revision';
 r:=public.member_front_save('{"schema":"mccluster-front/v1"}',1,true,false);
 assert r->>'code'='revision_conflict', 'stale revisions must remain refused';
end $$;
reset role;
set local role anon;
do $$ declare r jsonb; begin
 r:=public.member_front_public('guard.private');
 assert r->>'ok'='true' and r#>>'{config,words,title1}'='Recovered', 'the public page must match the accepted publication';
 r:=public.member_front_directory(100,null);
 assert jsonb_array_length(r->'nodes')=1, 'explicit opt-in must be the only directory entry';
end $$;
reset role;

-- Recovery keeps the privacy correction and every saved byte, while pausing
-- both RPC save entry points. Read, owner state and unpublish stay executable.
create temp table member_front_recovery_before as select to_jsonb(f) as value from public.member_fronts f order by m_uid;
\ir ../pending/member_fronts_publication_visibility_guard_v1.rollback.sql
\ir ../pending/member_fronts_publication_visibility_guard_v1.rollback.sql
set local role authenticated;
do $$ declare r jsonb; begin
 begin perform public.member_front_save('{}',0,false,false); raise exception 'paused public save remained executable';
 exception when insufficient_privilege then null; end;
 begin perform member_fronts_private.save('{}',0,false,false); raise exception 'paused private save remained executable';
 exception when insufficient_privilege then null; end;
 r:=public.member_front_get_self();
 assert r->>'ok'='true', 'get-self must remain available during save recovery';
 r:=public.member_front_unpublish(0);
 assert r->>'code'='revision_conflict', 'unpublish must remain executable with its CAS fence';
end $$;
reset role;
set local role service_role;
do $$ begin
 begin perform public.member_front_save('{}',0,true,false); raise exception 'service public save bypassed recovery';
 exception when insufficient_privilege then null; end;
 begin perform member_fronts_private.save('{}',0,true,false); raise exception 'service private save bypassed recovery';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ declare r jsonb; begin
 r:=public.member_front_public('guard.private');
 assert r->>'ok'='true', 'existing public reads must remain available during save recovery';
end $$;
reset role;
do $$ begin
 assert (select jsonb_agg(value order by value->>'m_uid') from member_front_recovery_before)
   = (select jsonb_agg(to_jsonb(f) order by m_uid) from public.member_fronts f), 'save recovery must preserve every page byte';
end $$;
\ir ../pending/member_fronts_publication_visibility_guard_v1.sql
\ir ../pending/member_fronts_publication_visibility_guard_v1.sql

-- Revoking public visibility hides the existing publication immediately.
update public.network_profiles set visibility='network' where m_uid=(select m_uid from public.m_auth_user_links where auth_user_id='a1000000-0000-4000-8000-000000000001' and is_primary=true limit 1);
set local role anon;
do $$ declare r jsonb; begin
 r:=public.member_front_public('guard.private');
 assert r->>'code'='not_found', 'network-only visibility must hide the public page';
 r:=public.member_front_directory(100,null);
 assert jsonb_array_length(r->'nodes')=0, 'network-only visibility must hide the directory entry';
end $$;
reset role;
set local role authenticated;
do $$ declare r jsonb; begin
 r:=public.member_front_save('{"schema":"mccluster-front/v1","words":{"title1":"Still private"}}',2,false,false);
 assert r->>'ok'='true' and (r->>'revision')::integer=3, 'a privacy change must not prevent private draft work';
 r:=public.member_front_save('{"schema":"mccluster-front/v1"}',3,true,false);
 assert r->>'code'='profile_not_public', 'republishing a network-only page must be refused';
 r:=public.member_front_unpublish(3);
 assert r->>'ok'='true' and (r->>'revision')::integer=4 and r->'published'='null'::jsonb, 'unpublishing must remain available to a nonpublic profile';
end $$;
reset role;
rollback;
\echo 'Member-front visibility guard: missing, private, network, recovery, CAS, public read, consent, unpublish and privileges passed.'
