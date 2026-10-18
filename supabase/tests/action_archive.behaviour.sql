-- Behavioral regression gate for historical archive publication and page claims.
-- All people, account IDs, hashes, titles and URLs below are invented test fixtures.
-- Run only through scripts/test-action-archive-db.sh or its isolated PGlite runner.
-- Assertions execute under real anon/authenticated/service_role database roles.
set client_min_messages = warning;

create or replace function pg_temp.ok(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition,false) then raise exception 'FAILED: %',p_label; end if;
end $$;
create or replace function pg_temp.must_fail(p_sql text,p_state text,p_message text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate<>p_state or (p_message is not null and sqlerrm not ilike p_message) then
      raise exception 'Expected SQLSTATE % / %, got % / %',p_state,p_message,sqlstate,sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected failure but statement succeeded: %',p_sql;
end $$;
grant execute on all functions in schema pg_temp to anon,authenticated,service_role;

create temp table archive_fixture(payload jsonb not null);
grant select on archive_fixture to anon,authenticated,service_role;
insert into archive_fixture values ($json${
  "project":{"slug":"archive-test-project","title":"Test archive","year":2025},
  "participants":[
    {"slug":"test-organizer","display_name":"Test Organizer","project_roles":["Organizer"]},
    {"slug":"test-artist","display_name":"Test Artist","project_roles":["Artist"]},
    {"slug":"test-contributor","display_name":"Test Contributor","project_roles":["Engineer"]}
  ],
  "works":[
    {"slug":"test-song-one","title":"Test Song One","status":"completed","year":2025,
     "recordings":[{"id":"test-original","title":"Original"},{"id":"test-mix","title":"Alternate mix"}]},
    {"slug":"test-song-two","title":"Test Song Two","status":"completed","year":2025,
     "recordings":[{"id":"test-second","title":"Second song"}]}
  ],
  "event":{"slug":"test-capstone","title":"Test Capstone","status":"completed"},
  "media":[]
}$json$::jsonb);

insert into auth.users(id,email) values
  ('00000000-0000-4000-8000-000000000001','organizer@example.invalid'),
  ('00000000-0000-4000-8000-000000000002','artist@example.invalid'),
  ('00000000-0000-4000-8000-000000000003','contributor@example.invalid'),
  ('00000000-0000-4000-8000-000000000004','old-credential@example.invalid');
insert into public.m_people(id) values
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002'),
  ('10000000-0000-4000-8000-000000000003');
insert into public.m_auth_user_links(auth_user_id,m_uid,is_primary) values
  ('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',true),
  ('00000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',true),
  ('00000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000003',true),
  ('00000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000003',false);

-- Seed uses explicit existing identity links; mix variants stay inside one work.
set role service_role;
do $$ declare v jsonb; begin
  select public.action_archive_seed(payload,
    '{"test-organizer":"10000000-0000-4000-8000-000000000001"}') into v from archive_fixture;
  perform pg_temp.ok(v->>'participants'='3' and v->>'provider_pages'='3'
    and v->>'completed_works'='2' and v->>'events'='1','seed counts songs, not mixes');
  perform pg_temp.ok((select count(*) from public.m_people)=3,'seed creates no M identities');
  perform pg_temp.ok((select count(*) from public.action_archive_participants where owner_m_uid is null)=2,
    'only explicitly linked organizer has an owner');
end $$;

-- The importer rejects incomplete or private payloads before publishing changes.
select pg_temp.must_fail($q$select public.action_archive_seed('{"project":{"slug":"missing-arrays"}}')$q$,
  'P0001','%invalid archive payload%');
select pg_temp.must_fail($q$select public.action_archive_seed('{"project":{"slug":"null-arrays"},"participants":null,"works":null}')$q$,
  'P0001','%invalid archive payload%');
select pg_temp.must_fail($q$select public.action_archive_seed(payload,'null') from archive_fixture$q$,
  'P0001','%invalid archive payload%');
select pg_temp.must_fail($q$select public.action_archive_seed(jsonb_set(payload,'{participants,0,email}','"private@example.invalid"')) from archive_fixture$q$,
  'P0001','%private fields%');
select pg_temp.must_fail($q$select public.action_archive_seed(jsonb_set(payload,'{participants,0,metadata}','{"nested":[{"token":"FAKE_TEST_ONLY"}]}')) from archive_fixture$q$,
  'P0001','%private fields%');
select pg_temp.must_fail($q$select public.action_archive_seed(jsonb_set(payload,'{works,0,metadata}','{"private_evidence":["FAKE_TEST_ONLY"]}')) from archive_fixture$q$,
  'P0001','%private fields%');

-- Public readers can see published work, but cannot claim, seed, or read credentials.
reset role;
set role anon;
select pg_temp.ok(jsonb_array_length(public.action_archive_get('archive-test-project')->'works')=2,
  'anonymous getter works through narrow column grants');
select pg_temp.must_fail('select token_hash from public.action_archive_invites','42501');
select pg_temp.must_fail('select claimed_at from public.action_archive_participants','42501');
select pg_temp.must_fail('select created_at from public.action_archive_participants','42501');
select pg_temp.must_fail($q$select public.action_archive_seed(payload) from archive_fixture$q$,'42501');
select pg_temp.must_fail($q$select public.action_archive_claim(repeat('a',64),'00000000-0000-4000-8000-000000000002')$q$,'42501');
select pg_temp.must_fail($q$select public.action_archive_invite_preview(repeat('a',64))$q$,'42501');
select pg_temp.must_fail($q$update public.action_archive_participants set owner_m_uid='10000000-0000-4000-8000-000000000003' where slug='test-artist'$q$,'42501');
reset role;
set role authenticated;
select pg_temp.must_fail('select token_hash from public.action_archive_invites','42501');
select pg_temp.must_fail('select claimed_at from public.action_archive_participants','42501');
select pg_temp.must_fail($q$select public.action_archive_claim(repeat('a',64),'00000000-0000-4000-8000-000000000002')$q$,'42501');
select pg_temp.must_fail($q$select public.action_archive_issue_invite('archive-test-project','test-artist',repeat('a',64),now()+interval '1 day')$q$,'42501');
select pg_temp.must_fail($q$select public.action_archive_update_provider('archive-test-project','test-artist','00000000-0000-4000-8000-000000000002','Injected','Injected','')$q$,'42501');

-- Replacement, expiry and claim replay must never transfer ownership.
reset role;
set role service_role;
select pg_temp.must_fail($q$select public.action_archive_issue_invite('archive-test-project','test-artist',repeat('a',64),now()-interval '1 day')$q$,
  'P0001','%expiry%');
select pg_temp.must_fail($q$select public.action_archive_issue_invite('archive-test-project','test-artist',repeat('a',64),now()+interval '31 days')$q$,
  'P0001','%expiry%');
select public.action_archive_issue_invite('archive-test-project','test-artist',repeat('a',64),now()+interval '1 day');
select public.action_archive_issue_invite('archive-test-project','test-artist',repeat('b',64),now()+interval '1 day');
select pg_temp.must_fail($q$select public.action_archive_claim(repeat('a',64),'00000000-0000-4000-8000-000000000002')$q$,
  'P0001','INVITATION_UNAVAILABLE');
do $$ declare v jsonb; begin
  v:=public.action_archive_invite_preview(repeat('b',64));
  perform pg_temp.ok(v->>'display_name'='Test Artist' and v->>'participant_slug'='test-artist'
    and (select count(*) from jsonb_object_keys(v))=5
    and not v ?| array['token','token_hash','owner_m_uid','consumed_by_m_uid'],
    'preview exposes only public target, project and expiry');
end $$;
select public.action_archive_claim(repeat('b',64),'00000000-0000-4000-8000-000000000002');
select pg_temp.ok(public.action_archive_invite_preview(repeat('b',64)) is null,'consumed invitation has no preview');
select pg_temp.must_fail($q$select public.action_archive_claim(repeat('b',64),'00000000-0000-4000-8000-000000000002')$q$,
  'P0001','INVITATION_UNAVAILABLE');
select pg_temp.must_fail($q$select public.action_archive_claim(repeat('b',64),'00000000-0000-4000-8000-000000000003')$q$,
  'P0001','INVITATION_UNAVAILABLE');
select pg_temp.must_fail($q$select public.action_archive_issue_invite('archive-test-project','test-artist',repeat('c',64),now()+interval '1 day')$q$,
  'P0001','%already claimed%');

-- Only the owner may edit. Reseeding preserves the owner, claim date and their page.
select pg_temp.must_fail($q$select public.action_archive_update_provider('archive-test-project','test-artist','00000000-0000-4000-8000-000000000003','Wrong owner','Wrong owner','https://example.invalid')$q$,
  '42501','PROVIDER_PAGE_FORBIDDEN');
select public.action_archive_update_provider('archive-test-project','test-artist',
  '00000000-0000-4000-8000-000000000002','Owner headline','Owner biography','https://example.invalid/artist');
-- A fixed historic timestamp makes this assertion meaningful even when a runner
-- executes the file in one transaction, where repeated now() values are identical.
update public.action_archive_participants set claimed_at='2001-01-01T00:00:00Z'
  where project_slug='archive-test-project' and slug='test-artist';
select public.action_archive_seed(payload) from archive_fixture;
do $$ begin
  perform pg_temp.ok((select owner_m_uid='10000000-0000-4000-8000-000000000002'
    and claimed_at='2001-01-01T00:00:00Z' from public.action_archive_participants
    where project_slug='archive-test-project' and slug='test-artist'),'reseed preserves owner and original claim time');
  perform pg_temp.ok((select headline='Owner headline' and bio='Owner biography'
    and website_url='https://example.invalid/artist' from public.action_archive_provider_pages
    where project_slug='archive-test-project' and participant_slug='test-artist'),'reseed preserves owner webpage edits');
end $$;
select pg_temp.must_fail($q$select public.action_archive_seed(payload,'{"test-artist":"10000000-0000-4000-8000-000000000003"}') from archive_fixture$q$,
  'P0001','%identity cannot be reassigned%');

-- One account cannot claim two cohort people. Preserve current_m_uid authority.
select public.action_archive_issue_invite('archive-test-project','test-contributor',repeat('d',64),now()+interval '1 day');
select pg_temp.must_fail($q$select public.action_archive_claim(repeat('d',64),'00000000-0000-4000-8000-000000000002')$q$,
  'P0001','ACCOUNT_ALREADY_LINKED_TO_COHORT');
select pg_temp.must_fail($q$select public.action_archive_claim(repeat('d',64),'00000000-0000-4000-8000-000000000004')$q$,
  'P0001','M_ACCOUNT_PROFILE_REQUIRED');
update public.m_people set status='disabled' where id='10000000-0000-4000-8000-000000000003';
select pg_temp.must_fail($q$select public.action_archive_claim(repeat('d',64),'00000000-0000-4000-8000-000000000003')$q$,
  'P0001','M_ACCOUNT_PROFILE_REQUIRED');
update public.m_people set status='active' where id='10000000-0000-4000-8000-000000000003';
update public.action_archive_invites set created_at=now()-interval '2 days',expires_at=now()-interval '1 day'
  where token_hash=repeat('d',64);
select pg_temp.must_fail($q$select public.action_archive_claim(repeat('d',64),'00000000-0000-4000-8000-000000000003')$q$,
  'P0001','INVITATION_UNAVAILABLE');
select public.action_archive_issue_invite('archive-test-project','test-contributor',repeat('e',64),now()+interval '1 day');
select public.action_archive_claim(repeat('e',64),'00000000-0000-4000-8000-000000000003');
update public.m_people set status='disabled' where id='10000000-0000-4000-8000-000000000002';
select pg_temp.must_fail($q$select public.action_archive_update_provider('archive-test-project','test-artist','00000000-0000-4000-8000-000000000002','Disabled owner','Disabled owner','')$q$,
  '42501','PROVIDER_PAGE_FORBIDDEN');
update public.m_people set status='active' where id='10000000-0000-4000-8000-000000000002';

-- A corrected snapshot retires omitted works/events without deleting claimed people.
select public.action_archive_seed(jsonb_set(jsonb_set(payload,'{works}',jsonb_build_array(payload#>'{works,0}')),
  '{event,slug}','"replacement-capstone"')) from archive_fixture;
do $$ declare v jsonb:=public.action_archive_get('archive-test-project'); begin
  perform pg_temp.ok(jsonb_array_length(v->'works')=1 and v#>>'{event,slug}'='replacement-capstone',
    'getter reflects replacement works and event');
  perform pg_temp.ok((select count(*) from public.action_archive_works where project_slug='archive-test-project')=2,
    'omitted work retained privately for history');
  perform pg_temp.ok((select count(*) from public.action_archive_participants where owner_m_uid is not null)=3,
    'snapshot reconciliation preserves claimed people');
end $$;
reset role;
set role anon;
select pg_temp.ok((select count(*) from public.action_archive_works)=1,'direct public work reads hide omitted records');
select pg_temp.ok((select count(*) from public.action_archive_events)=1,'direct public event reads hide replaced records');
reset role;
set role service_role;
update public.action_archive_projects set published=false where slug='archive-test-project';
select pg_temp.ok(public.action_archive_get('archive-test-project') is null,'service getter honors project publication');
reset role;
set role anon;
select pg_temp.ok((select count(project_slug) from public.action_archive_participants)=0,'unpublished parent hides participants');
select pg_temp.ok((select count(*) from public.action_archive_provider_pages)=0,'unpublished parent hides provider pages');
select pg_temp.ok((select count(*) from public.action_archive_works)=0,'unpublished parent hides works');
select pg_temp.ok((select count(*) from public.action_archive_events)=0,'unpublished parent hides events');
reset role;

