-- Behaviour tests for supabase/pending/20261016010000_profile_edit_gate_v1.sql.
-- Run by scripts/test-profile-edit-gate-db.sh on a scratch Postgres, as the
-- real API roles. Test fixtures only: every person, value, video object and
-- Persona id here is invented and lives only in the throwaway database.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create or replace function pg_temp.as_user(p_id uuid, p_email text default null) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'email', coalesce(p_email, p_id::text || '@test'), 'role', 'authenticated')::text, false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"anon"}', false); execute 'set role anon'; end $$;
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"service_role"}', false); execute 'set role service_role'; end $$;
create or replace function pg_temp.must_fail(p_sql text, p_like text) returns void language plpgsql as $$
begin begin execute p_sql; exception when others then
  if sqlerrm not ilike p_like then raise exception 'expected % from [%], got: %', p_like, p_sql, sqlerrm; end if; return; end;
  raise exception 'expected failure (%) but it succeeded: %', p_like, p_sql; end $$;
create or replace function pg_temp.ok(p_cond boolean, p_what text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FAILED: %', p_what; end if; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;
create temp table ids(k text primary key, v text); grant all on ids to anon, authenticated, service_role;
create or replace function pg_temp.id(p_k text) returns text language sql as $$ select v from ids where k = p_k $$;
grant execute on function pg_temp.id(text) to anon, authenticated, service_role;
create or replace function pg_temp.upload(p_path text, p_size bigint default 2000000, p_mime text default 'video/webm') returns void language sql as $$
  insert into storage.objects(bucket_id, name, metadata) values ('identity-verification-videos', p_path, jsonb_build_object('size', p_size, 'mimetype', p_mime)) $$;
grant execute on function pg_temp.upload(text, bigint, text) to authenticated, anon, service_role;
-- a security-definer RPC that writes a protected column the way set_mccluster_id does
create function public.test_definer_set_handle(p text) returns void language sql security definer set search_path = '' as $$
  update public.platform_profiles set mccluster_id = p where user_id = (select auth.uid()) $$;
grant execute on function public.test_definer_set_handle(text) to authenticated;

-- fixtures: M (onboarded member), N (member who has not filled in a legal name yet), the owner
insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-0000000000a1','m@test'), ('00000000-0000-4000-8000-0000000000a2','n@test'),
 ('00000000-0000-4000-8000-0000000000ad','matthew@mccluster.org');
insert into public.m_people(id) values
 ('10000000-0000-4000-8000-0000000000a1'), ('10000000-0000-4000-8000-0000000000a2'), ('10000000-0000-4000-8000-0000000000ad');
insert into public.m_links(user_id, m_uid) values
 ('00000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000a1'),
 ('00000000-0000-4000-8000-0000000000a2','10000000-0000-4000-8000-0000000000a2'),
 ('00000000-0000-4000-8000-0000000000ad','10000000-0000-4000-8000-0000000000ad');
insert into public.platform_profiles(user_id, mccluster_id, display_name) values
 ('00000000-0000-4000-8000-0000000000a1', 'em.member', 'Em'), ('00000000-0000-4000-8000-0000000000a2', 'en.member', 'En');
insert into public.network_profiles(m_uid, display_name) values ('10000000-0000-4000-8000-0000000000a1', 'Em');
insert into public.fan_profiles(user_id, legal_name, address_line1, city, region, postal_code, country) values
 ('00000000-0000-4000-8000-0000000000a1', 'Em Member', '1 Test Street', 'Testville', 'CT', '00000', 'United States'),
 ('00000000-0000-4000-8000-0000000000a2', '', '', '', '', '', '');
insert into public.music_creator_profiles(m_uid, handle, artist_name) values ('10000000-0000-4000-8000-0000000000a1', 'em-music', 'Em Music');
insert into public.action_globe_regions(region_key, country_code, subdivision_code, region_label, centroid_lat, centroid_lon)
values ('test-region', 'US', 'US-ZZ', 'Test State', 41.6, -72.7), ('test-region-2', 'US', 'US-ZY', 'Other State', 40.7, -74.0);
insert into public.action_globe_member_regions(m_uid, region_key) values ('10000000-0000-4000-8000-0000000000a1', 'test-region');

-- THE LIST DRIVES THE TRIGGERS: every listed table that exists is guarded; a missing one is skipped
do $$ begin
  perform pg_temp.ok((select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where t.tgname = 'zz_profile_edit_guard' and c.relname in ('fan_profiles','platform_profiles','music_creator_profiles','network_profiles','action_globe_member_regions')) = 5,
    'guard on the five listed tables that exist');
  perform pg_temp.ok(to_regclass('public.action_creator_connect_accounts') is null, 'payout table absent in this chain (skipped, not an error)');
  perform pg_temp.ok((select require_persona from public.profile_edit_settings), 'Persona required by default');
  perform pg_temp.ok((select not enabled from public.profile_protected_fields where field_key = 'display_name'), 'display name listed but off');
  perform pg_temp.ok((select not requestable from public.profile_protected_fields where field_key = 'payout_account'), 'payout account is never changed by request');
end $$;

-- SERVER-SIDE ENFORCEMENT: a member cannot change a protected field that is set
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.must_fail($q$update public.fan_profiles set legal_name = 'Someone Else' where user_id = '00000000-0000-4000-8000-0000000000a1'$q$, '%profile_field_locked: legal_name%');
select pg_temp.must_fail($q$update public.fan_profiles set region = 'NY' where user_id = '00000000-0000-4000-8000-0000000000a1'$q$, '%profile_field_locked: region%');
select pg_temp.must_fail($q$update public.platform_profiles set mccluster_id = 'taken.over' where user_id = '00000000-0000-4000-8000-0000000000a1'$q$, '%profile_field_locked: handle%');
select pg_temp.must_fail($q$update public.music_creator_profiles set artist_name = 'Fake Star' where m_uid = '10000000-0000-4000-8000-0000000000a1'$q$, '%profile_field_locked: artist_name%');
-- and not through a security-definer RPC called with a member's token either
select pg_temp.must_fail($q$select public.test_definer_set_handle('via.rpc')$q$, '%profile_field_locked: handle%');
-- deleting the row to start over is the same edit
select pg_temp.must_fail($q$delete from public.platform_profiles where user_id = '00000000-0000-4000-8000-0000000000a1'$q$, '%profile_field_locked%');
-- fields that are not on the list stay freely editable
update public.fan_profiles set address_line1 = '2 Test Street', city = 'Newtown' where user_id = '00000000-0000-4000-8000-0000000000a1';
update public.network_profiles set display_name = 'Em M' where m_uid = '10000000-0000-4000-8000-0000000000a1';
-- writing the same value is not a change
update public.fan_profiles set legal_name = 'Em Member' where user_id = '00000000-0000-4000-8000-0000000000a1';
select public.test_definer_set_handle('em.member');
do $$ begin perform pg_temp.ok((select address_line1 = '2 Test Street' and legal_name = 'Em Member' from public.fan_profiles
  where user_id = '00000000-0000-4000-8000-0000000000a1'), 'unprotected change saved, protected untouched'); end $$;
reset role;

-- ONBOARDING: an empty protected field may be filled once, then it locks
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
update public.fan_profiles set legal_name = 'En Member', region = 'MA' where user_id = '00000000-0000-4000-8000-0000000000a2';
select pg_temp.must_fail($q$update public.fan_profiles set legal_name = 'En Changed' where user_id = '00000000-0000-4000-8000-0000000000a2'$q$, '%profile_field_locked%');
reset role;

-- the owner turns a field on and off with data: display name
update public.profile_protected_fields set enabled = true where field_key = 'display_name';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.must_fail($q$update public.network_profiles set display_name = 'Somebody' where m_uid = '10000000-0000-4000-8000-0000000000a1'$q$, '%profile_field_locked: display_name%');
reset role;
update public.profile_protected_fields set enabled = false where field_key = 'display_name';

-- the service role and the SQL editor are not members (fixing a record by hand stays possible)
select pg_temp.as_service();
update public.fan_profiles set legal_name = 'Em Member' where user_id = '00000000-0000-4000-8000-0000000000a1';
reset role;
update public.fan_profiles set postal_code = '00001' where user_id = '00000000-0000-4000-8000-0000000000a1';

-- CONSENT: a draft cannot be used; the owner approves it (N, counsel date) first
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.must_fail($q$select public.profile_edit_start('profile-edit-2026-10-draft1', 'Em Member', '{"legal_name":"Em Q Member"}', 'I got married')$q$, '%not open yet%');
reset role;
update public.identity_consent_versions set status = 'active', approved_at = now(), approved_by = 'owner', retention_days = 30,
  counsel_reviewed_at = now(), counsel_ref = 'test' where version = 'profile-edit-2026-10-draft1';

-- anon: reads the list, cannot start
select pg_temp.as_anon();
do $$ declare s jsonb := public.profile_edit_status(); begin
  perform pg_temp.ok(not (s->>'signed_in')::boolean and s->'consent'->>'version' = 'profile-edit-2026-10-draft1'
    and not exists (select 1 from jsonb_array_elements(s->'fields') f where f->>'value' is not null), 'anon status carries no values: ' || s::text);
end $$;
select pg_temp.must_fail($q$select public.profile_edit_start('profile-edit-2026-10-draft1', 'X Y', '{"legal_name":"Z"}', 'why not')$q$, '%permission denied%');
reset role;

-- M: status shows what is locked; every start rule holds
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
do $$ declare s jsonb := public.profile_edit_status(); f jsonb; begin
  select x into f from jsonb_array_elements(s->'fields') x where x->>'key' = 'legal_name';
  perform pg_temp.ok((f->>'locked')::boolean and f->>'value' = 'Em Member', 'legal name is locked: ' || f::text);
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(s->'fields') x where x->>'key' = 'display_name'), 'a field that is off is not listed');
  perform pg_temp.ok(s->'latest' = 'null'::jsonb or s->'latest' is null, 'no request yet');
end $$;
select pg_temp.must_fail($q$select public.profile_edit_start('v-old', 'Em Member', '{"legal_name":"Em Q Member"}', 'I got married')$q$, '%consent required%');
select pg_temp.must_fail($q$select public.profile_edit_start('profile-edit-2026-10-draft1', 'Em Member', '{}', 'I got married')$q$, '%at least one%');
select pg_temp.must_fail($q$select public.profile_edit_start('profile-edit-2026-10-draft1', 'Em Member', '{"bio":"x"}', 'I got married')$q$, '%unknown or unlocked field%');
select pg_temp.must_fail($q$select public.profile_edit_start('profile-edit-2026-10-draft1', 'Em Member', '{"payout_account":"acct_123"}', 'new bank')$q$, '%own setup%');
select pg_temp.must_fail($q$select public.profile_edit_start('profile-edit-2026-10-draft1', 'Em Member', '{"legal_name":"Em Member"}', 'same')$q$, '%already has that value%');
select pg_temp.must_fail($q$select public.profile_edit_start('profile-edit-2026-10-draft1', 'Em Member', '{"handle":"Bad Handle!"}', 'new name')$q$, '%allowed format%');
select pg_temp.must_fail($q$select public.profile_edit_start('profile-edit-2026-10-draft1', 'Em Member', '{"legal_name":"Em Q Member"}', '')$q$, '%say why%');
select pg_temp.must_fail($q$select public.profile_edit_start('profile-edit-2026-10-draft1', ' ', '{"legal_name":"Em Q Member"}', 'I got married')$q$, '%first and last name%');
-- members never write the request tables directly
select pg_temp.must_fail($q$insert into public.profile_edit_requests(submission_id, user_id, changes, reason) values (gen_random_uuid(), '00000000-0000-4000-8000-0000000000a1', '{"legal_name":"x"}', 'xyz')$q$, '%permission denied%');
insert into ids values ('e1', public.profile_edit_start('profile-edit-2026-10-draft1', 'Em Member', '{"legal_name":"Em Q Member","handle":"em.q"}', 'I got married and changed my name')::text);
do $$ declare e jsonb := pg_temp.id('e1')::jsonb; begin
  perform pg_temp.ok(e->>'challenge_phrase' ~ '^[a-z]{3,12} [0-9]{4}$' and e->>'object_path' = '00000000-0000-4000-8000-0000000000a1/' || (e->>'submission_id')
    and (e->>'max_seconds')::int = 120 and e->'changes' = '{"legal_name":"Em Q Member","handle":"em.q"}'::jsonb, 'start: ' || e::text);
end $$;
-- the same live-only upload and finish as V1/V2
select pg_temp.upload(pg_temp.id('e1')::jsonb->>'object_path');
select pg_temp.must_fail(format($q$select public.identity_finish_submission(%L, 20000, now(), '{"source":"file","track_state":"live"}')$q$, pg_temp.id('e1')::jsonb->>'submission_id'), '%only a live camera recording%');
select public.identity_finish_submission((pg_temp.id('e1')::jsonb->>'submission_id')::uuid, 20000, now(), '{"source":"getUserMedia","track_state":"live","challenge_shown":true}');
select pg_temp.must_fail($q$select public.profile_edit_start('profile-edit-2026-10-draft1', 'Em Member', '{"region":"NY"}', 'I moved')$q$, '%still with the owner%');
-- still locked while the request waits
select pg_temp.must_fail($q$update public.fan_profiles set legal_name = 'Em Q Member' where user_id = '00000000-0000-4000-8000-0000000000a1'$q$, '%profile_field_locked%');
select pg_temp.must_fail(format($q$select public.profile_edit_review_decide(%L, 'approve', null)$q$, pg_temp.id('e1')::jsonb->>'submission_id'), '%not authorized%');
select pg_temp.must_fail($q$select public.profile_edit_review_queue()$q$, '%not authorized%');
do $$ declare s jsonb := public.profile_edit_status(); begin
  perform pg_temp.ok(s->'latest'->>'status' = 'submitted' and s->'latest'->'changes'->>'handle' = 'em.q', 'member sees the request waiting: ' || s::text);
end $$;
reset role;

-- OWNER: the V1/V2 decision function cannot decide a profile edit (it would grant a verification row)
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select pg_temp.must_fail(format($q$select public.identity_review_decide(%L, 'approve', null)$q$, pg_temp.id('e1')::jsonb->>'submission_id'), '%profile_edit_review_decide%');
do $$ declare q jsonb := public.identity_review_queue(); p jsonb; c jsonb := public.profile_edit_review_queue(); ch jsonb; begin
  select x into p from jsonb_array_elements(q->'pending') x where x->>'id' = pg_temp.id('e1')::jsonb->>'submission_id';
  perform pg_temp.ok(p->>'level' = 'profile_edit' and p->>'access_request' = 'I got married and changed my name', 'the identity queue lists the profile edit: ' || coalesce(p::text, 'null'));
  ch := c->(pg_temp.id('e1')::jsonb->>'submission_id');
  perform pg_temp.ok(jsonb_array_length(ch->'changes') = 2 and exists (select 1 from jsonb_array_elements(ch->'changes') x
    where x->>'key' = 'legal_name' and x->>'current' = 'Em Member' and x->>'requested' = 'Em Q Member'), 'changes beside current values: ' || coalesce(ch::text, 'null'));
end $$;
-- Persona must say approved first (require_persona)
select pg_temp.must_fail(format($q$select public.profile_edit_review_decide(%L, 'approve', null)$q$, pg_temp.id('e1')::jsonb->>'submission_id'), '%government-ID check is not approved%');
reset role;
-- the Worker links the inquiry (now allowed for a profile edit) and applies Persona's result
select pg_temp.as_service();
select public.identity_record_persona_inquiry('00000000-0000-4000-8000-0000000000a1', (pg_temp.id('e1')::jsonb->>'submission_id')::uuid, 'inq_ProfileEdit01', 'created');
do $$ begin perform pg_temp.ok((public.identity_apply_persona_event('evt_ProfileOk01', 'inquiry.approved', 'inq_ProfileEdit01', 'approved', now())->>'applied')::boolean, 'Persona approval applied'); end $$;
reset role;

-- APPROVE: the requested values are applied once, with an append-only audit
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
do $$ declare r jsonb := public.profile_edit_review_decide((pg_temp.id('e1')::jsonb->>'submission_id')::uuid, 'approve', null); begin
  perform pg_temp.ok(r->>'status' = 'approved' and jsonb_array_length(r->'applied') = 2, 'approve: ' || r::text);
end $$;
select pg_temp.must_fail(format($q$select public.profile_edit_review_decide(%L, 'approve', null)$q$, pg_temp.id('e1')::jsonb->>'submission_id'), '%only a submitted request%');
reset role;
do $$ begin
  perform pg_temp.ok((select legal_name = 'Em Q Member' from public.fan_profiles where user_id = '00000000-0000-4000-8000-0000000000a1'), 'legal name applied');
  perform pg_temp.ok((select mccluster_id = 'em.q' from public.platform_profiles where user_id = '00000000-0000-4000-8000-0000000000a1'), 'handle applied');
  perform pg_temp.ok((select count(*) from public.profile_edit_audit) = 2, 'one audit row per field, once');
  perform pg_temp.ok((select old_value = 'Em Member' and new_value = 'Em Q Member' and applied_by = '00000000-0000-4000-8000-0000000000ad'
    from public.profile_edit_audit where field_key = 'legal_name'), 'audit keeps old, new and who');
  perform pg_temp.ok((select applied_at is not null from public.profile_edit_requests), 'request marked applied');
  perform pg_temp.ok(not exists (select 1 from public.action_member_verifications where user_id = '00000000-0000-4000-8000-0000000000a1'), 'a profile edit grants no verification level');
  perform pg_temp.ok((select count(*) from public.network_notifications where type = 'profile_edit_review' and body like '%approved and made%') = 1, 'member notified');
end $$;
select pg_temp.must_fail($q$update public.profile_edit_audit set new_value = 'x'$q$, '%append-only%');
select pg_temp.must_fail($q$delete from public.profile_edit_audit$q$, '%append-only%');
-- after the approval the new value is locked again
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.must_fail($q$update public.fan_profiles set legal_name = 'Em Member' where user_id = '00000000-0000-4000-8000-0000000000a1'$q$, '%profile_field_locked%');
do $$ begin perform pg_temp.ok((select count(*) from public.profile_edit_audit) = 2, 'member reads own audit'); end $$;

-- REJECT: nothing changes
insert into ids values ('e2', public.profile_edit_start('profile-edit-2026-10-draft1', 'Em Q Member', '{"region":"NY","globe_region":"test-region-2"}', 'I moved to New York')::text);
select pg_temp.upload(pg_temp.id('e2')::jsonb->>'object_path');
select public.identity_finish_submission((pg_temp.id('e2')::jsonb->>'submission_id')::uuid, 15000, now(), '{"source":"getUserMedia","track_state":"live"}');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select pg_temp.must_fail(format($q$select public.profile_edit_review_decide(%L, 'reject', '  ')$q$, pg_temp.id('e2')::jsonb->>'submission_id'), '%note%required%');
select public.profile_edit_review_decide((pg_temp.id('e2')::jsonb->>'submission_id')::uuid, 'reject', 'The video did not show your face. Record again in good light.');
reset role;
do $$ begin
  perform pg_temp.ok((select region = 'CT' from public.fan_profiles where user_id = '00000000-0000-4000-8000-0000000000a1'), 'rejected: region unchanged');
  perform pg_temp.ok((select region_key = 'test-region' from public.action_globe_member_regions where m_uid = '10000000-0000-4000-8000-0000000000a1'), 'rejected: globe region unchanged');
  perform pg_temp.ok((select count(*) from public.profile_edit_audit) = 2, 'rejected: no audit rows');
  perform pg_temp.ok((select applied_at is null from public.profile_edit_requests r join public.identity_submissions s on s.id = r.submission_id
    where s.status = 'rejected'), 'rejected request never applied');
end $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
do $$ declare s jsonb := public.profile_edit_status(); begin
  perform pg_temp.ok(s->'latest'->>'status' = 'rejected' and s->'latest'->>'decision_note' like 'The video did not show%', 'member sees the reject note: ' || s::text);
end $$;
-- deleting my videos withdraws an open request and nothing applies
insert into ids values ('e3', public.profile_edit_start('profile-edit-2026-10-draft1', 'Em Q Member', '{"country":"Canada"}', 'I moved to Canada')::text);
select public.identity_request_deletion('test');
do $$ begin perform pg_temp.ok((select status = 'withdrawn' from public.identity_submissions where id = (pg_temp.id('e3')::jsonb->>'submission_id')::uuid), 'withdrawn by deletion request'); end $$;
reset role;
-- a withdrawn request can no longer be linked to an ID check
select pg_temp.as_service();
select pg_temp.must_fail(format($q$select public.identity_record_persona_inquiry('00000000-0000-4000-8000-0000000000a1', %L, 'inq_NotForThis1', 'created')$q$, pg_temp.id('e3')::jsonb->>'submission_id'), '%this submission is withdrawn%');
reset role;

-- the owner cannot decide their own request
insert into public.fan_profiles(user_id, legal_name) values ('00000000-0000-4000-8000-0000000000ad', 'Owner Person') on conflict (user_id) do nothing;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
insert into ids values ('o1', public.profile_edit_start('profile-edit-2026-10-draft1', 'Owner Person', '{"legal_name":"Owner P Person"}', 'testing my own request')::text);
select pg_temp.upload(pg_temp.id('o1')::jsonb->>'object_path');
select public.identity_finish_submission((pg_temp.id('o1')::jsonb->>'submission_id')::uuid, 9000, now(), '{"source":"getUserMedia","track_state":"live"}');
select pg_temp.must_fail(format($q$select public.profile_edit_review_decide(%L, 'reject', 'no')$q$, pg_temp.id('o1')::jsonb->>'submission_id'), '%your own request%');
reset role;

drop function public.test_definer_set_handle(text);
select 'profile edit gate behaviour: all assertions passed' as result;
