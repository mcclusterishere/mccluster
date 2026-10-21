-- Behaviour tests for supabase/pending/20261015230000_identity_verification_levels_v1.sql.
-- Run by scripts/test-identity-verification-db.sh on a scratch Postgres. Test
-- fixtures only: every person, video object and Persona id here is invented
-- and lives only in the throwaway database.
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
-- what the Storage API would write for an uploaded video, as the signed-in caller
create or replace function pg_temp.upload(p_path text, p_size bigint default 2000000, p_mime text default 'video/webm') returns void language sql as $$
  insert into storage.objects(bucket_id, name, metadata) values ('identity-verification-videos', p_path, jsonb_build_object('size', p_size, 'mimetype', p_mime)) $$;
grant execute on function pg_temp.upload(text, bigint, text) to authenticated, anon, service_role;

-- fixtures: M (member, joined through a referral), N (another member, also
-- listed as a reviewer but NOT an admin), P (M's referrer), the owner
insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-0000000000a1','m@test'), ('00000000-0000-4000-8000-0000000000a2','n@test'),
 ('00000000-0000-4000-8000-0000000000a3','p@test'), ('00000000-0000-4000-8000-0000000000ad','matthew@mccluster.org');
insert into public.m_people(id) values
 ('10000000-0000-4000-8000-0000000000a1'), ('10000000-0000-4000-8000-0000000000a2'), ('10000000-0000-4000-8000-0000000000ad');
insert into public.m_links(user_id, m_uid) values
 ('00000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000a1'),
 ('00000000-0000-4000-8000-0000000000a2','10000000-0000-4000-8000-0000000000a2'),
 ('00000000-0000-4000-8000-0000000000ad','10000000-0000-4000-8000-0000000000ad');
insert into public.action_globe_regions(region_key, country_code, subdivision_code, region_label, centroid_lat, centroid_lon)
values ('test-region', 'US', 'US-ZZ', 'Test State', 41.6, -72.7);
insert into public.identity_reviewers(user_id, added_by, note) values ('00000000-0000-4000-8000-0000000000a2', 'test', 'listed but not an admin');
insert into public.action_participants(campaign_id, user_id, referral_code, referred_by) values
 ('c1', '00000000-0000-4000-8000-0000000000a3', 'REFP', null),
 ('c1', '00000000-0000-4000-8000-0000000000a1', 'REFM', 'REFP');

-- the bucket is private, size-capped, video only
do $$ begin
  perform pg_temp.ok((select not public and file_size_limit = 52428800 and allowed_mime_types = array['video/webm','video/mp4']
    from storage.buckets where id = 'identity-verification-videos'), 'private bucket with limits');
  perform pg_temp.ok((select not enabled and requires_counsel_signoff and requirement_kind = 'identity_verified'
    from public.action_unlock_rules where rule_key = 'halo_full'), 'halo_full rule ships disabled, awaiting counsel');
end $$;

-- CONSENT REQUIRED: drafts only, so nothing can be captured yet
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.must_fail($q$select public.identity_start_submission('v1_live_intro','v1-live-intro-2026-10-draft1','Em Member',null,true,'test-region')$q$, '%not open yet%');
reset role;
-- a consent cannot go live without approval, N and a counsel review date
select pg_temp.must_fail($q$update public.identity_consent_versions set status = 'active', approved_at = now(), approved_by = 'owner' where version = 'v1-live-intro-2026-10-draft1'$q$, '%check constraint%');
update public.identity_consent_versions set status = 'active', approved_at = now(), approved_by = 'owner', retention_days = 30,
  counsel_reviewed_at = now(), counsel_ref = 'test' where version in ('v1-live-intro-2026-10-draft1', 'v2-halo-full-2026-10-draft1');
-- and once live its words are frozen
select pg_temp.must_fail($q$update public.identity_consent_versions set body = body || ' changed' where version = 'v1-live-intro-2026-10-draft1'$q$, '%frozen%');
select pg_temp.must_fail($q$delete from public.identity_consent_versions where version = 'v1-live-intro-2026-10-draft1'$q$, '%cannot be deleted%');

-- anyone can read the consent text; anon cannot read submissions
select pg_temp.as_anon();
do $$ declare s jsonb := public.identity_verification_status(); begin
  perform pg_temp.ok(not (s->>'signed_in')::boolean and s->'levels'->0->'consent'->>'version' = 'v1-live-intro-2026-10-draft1', 'anon status: ' || s::text);
end $$;
select pg_temp.must_fail($q$select * from public.identity_submissions$q$, '%permission denied%');
select pg_temp.must_fail($q$select public.identity_start_submission('v1_live_intro','v1-live-intro-2026-10-draft1','X Y',null,true,null)$q$, '%permission denied%');
reset role;

-- M: consent, location and name are each required; then a fresh challenge
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.must_fail($q$select public.identity_start_submission('v1_live_intro', null, 'Em Member', null, true, 'test-region')$q$, '%consent required%');
select pg_temp.must_fail($q$select public.identity_start_submission('v1_live_intro','v1-old','Em Member',null,true,'test-region')$q$, '%consent required%');
select pg_temp.must_fail($q$select public.identity_start_submission('v1_live_intro','v1-live-intro-2026-10-draft1','Em Member',null,false,null)$q$, '%location consent%');
select pg_temp.must_fail($q$select public.identity_start_submission('v1_live_intro','v1-live-intro-2026-10-draft1',' ',null,true,null)$q$, '%name%');
select pg_temp.must_fail($q$select public.identity_start_submission('v2_halo_full','v2-halo-full-2026-10-draft1','Em Member','the analyst globe',false,null)$q$, '%introduction must be approved first%');
insert into ids select 's1', public.identity_start_submission('v1_live_intro','v1-live-intro-2026-10-draft1','Em Member',null,true,'test-region')::text;
do $$ declare r jsonb := pg_temp.id('s1')::jsonb; begin
  perform pg_temp.ok(r->>'challenge_phrase' ~ '^[a-z]{3,12} [0-9]{4}$', 'server-issued challenge: ' || r::text);
  perform pg_temp.ok(r->>'object_path' = '00000000-0000-4000-8000-0000000000a1/' || (r->>'submission_id'), 'issued path is mine/submission');
  perform pg_temp.ok((r->>'max_seconds')::int = 60, 'v1 is at most 60 s');
  perform pg_temp.ok(exists (select 1 from public.identity_consent_acceptances where version = 'v1-live-intro-2026-10-draft1'), 'acceptance stored with time');
end $$;
-- nobody writes the tables directly (the challenge cannot be chosen by the client)
select pg_temp.must_fail($q$insert into public.identity_submissions(user_id, level, consent_version, consent_accepted_at, stated_name, challenge_phrase, challenge_expires_at, object_path) values ('00000000-0000-4000-8000-0000000000a1','v1_live_intro','v1-live-intro-2026-10-draft1',now(),'Em','apple 1234',now()+interval '1 hour','x')$q$, '%permission denied%');
select pg_temp.must_fail($q$update public.identity_submissions set status = 'approved'$q$, '%permission denied%');
-- finishing before the upload is refused
select pg_temp.must_fail(format($q$select public.identity_finish_submission(%L, 20000, now(), '{"source":"getUserMedia","track_state":"live"}')$q$, pg_temp.id('s1')::jsonb->>'submission_id'), '%has not been uploaded%');
-- UPLOAD: only the issued path, only in my folder, only once
select pg_temp.must_fail($q$select pg_temp.upload('00000000-0000-4000-8000-0000000000a2/whatever')$q$, '%row-level security%');
select pg_temp.must_fail($q$select pg_temp.upload('00000000-0000-4000-8000-0000000000a1/not-the-issued-path')$q$, '%row-level security%');
select pg_temp.upload(pg_temp.id('s1')::jsonb->>'object_path');
select pg_temp.must_fail(format($q$select pg_temp.upload(%L)$q$, pg_temp.id('s1')::jsonb->>'object_path'), '%duplicate key%');
-- members cannot read any video, not even their own
do $$ begin perform pg_temp.ok((select count(*) from storage.objects where bucket_id = 'identity-verification-videos') = 0, 'member reads no videos'); end $$;
-- NO FILE PATH: a recording that does not claim a live getUserMedia track is refused
select pg_temp.must_fail(format($q$select public.identity_finish_submission(%L, 20000, now(), '{"source":"file","track_state":"live"}')$q$, pg_temp.id('s1')::jsonb->>'submission_id'), '%only a live camera recording%');
select pg_temp.must_fail(format($q$select public.identity_finish_submission(%L, 20000, now(), '{"source":"getUserMedia","track_state":"ended"}')$q$, pg_temp.id('s1')::jsonb->>'submission_id'), '%only a live camera recording%');
select pg_temp.must_fail(format($q$select public.identity_finish_submission(%L, 200000, now(), '{"source":"getUserMedia","track_state":"live"}')$q$, pg_temp.id('s1')::jsonb->>'submission_id'), '%between 3 and 60 seconds%');
select pg_temp.must_fail(format($q$select public.identity_finish_submission(%L, 20000, now() - interval '1 hour', '{"source":"getUserMedia","track_state":"live"}')$q$, pg_temp.id('s1')::jsonb->>'submission_id'), '%after the challenge was shown%');
select public.identity_finish_submission((pg_temp.id('s1')::jsonb->>'submission_id')::uuid, 20000, now(), '{"source":"getUserMedia","track_state":"live","challenge_shown":true,"recorder_mime":"video/webm;codecs=vp8,opus"}');
do $$ begin
  perform pg_temp.ok(not public.identity_can_upload(pg_temp.id('s1')::jsonb->>'object_path'), 'no upload once submitted');
  perform pg_temp.ok((select status = 'submitted' and size_bytes = 2000000 and mime_type = 'video/webm' from public.identity_submissions), 'submitted with the stored object''s real size and type');
end $$;
select pg_temp.must_fail($q$select public.identity_start_submission('v1_live_intro','v1-live-intro-2026-10-draft1','Em Member',null,true,'test-region')$q$, '%already with the owner%');
select pg_temp.must_fail($q$select public.identity_review_queue()$q$, '%not authorized%');
reset role;

-- N: cannot see M's submission; being LISTED as a reviewer without being an admin is not enough
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
do $$ begin perform pg_temp.ok((select count(*) from public.identity_submissions) = 0, 'N sees no one else''s submission'); end $$;
select pg_temp.must_fail($q$select public.identity_review_queue()$q$, '%not authorized%');
select pg_temp.must_fail(format($q$select public.identity_review_decide(%L, 'approve', null)$q$, pg_temp.id('s1')::jsonb->>'submission_id'), '%not authorized%');
do $$ begin perform pg_temp.ok((select count(*) from storage.objects where bucket_id = 'identity-verification-videos') = 0, 'N reads no videos'); end $$;
reset role;

-- OWNER reviews: the queue shows age and the 24 h target; opening is logged
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
do $$ declare q jsonb := public.identity_review_queue(); p jsonb := q->'pending'->0; begin
  perform pg_temp.ok(jsonb_array_length(q->'pending') = 1 and p->>'stated_name' = 'Em Member' and p ? 'age_hours' and p ? 'sla_due_at'
    and p->>'challenge_phrase' = pg_temp.id('s1')::jsonb->>'challenge_phrase', 'queue: ' || q::text);
end $$;
do $$ declare o jsonb := public.identity_review_open((pg_temp.id('s1')::jsonb->>'submission_id')::uuid); begin
  perform pg_temp.ok(o->>'object_path' = pg_temp.id('s1')::jsonb->>'object_path' and (o->>'signed_url_seconds')::int <= 300, 'open: ' || o::text);
  perform pg_temp.ok((select count(*) from storage.objects where bucket_id = 'identity-verification-videos') = 1, 'the owner can read (sign) the video');
end $$;
select pg_temp.must_fail(format($q$select public.identity_review_decide(%L, 'reject', null)$q$, pg_temp.id('s1')::jsonb->>'submission_id'), '%note%required%');
select pg_temp.must_fail(format($q$select public.identity_review_decide(%L, 'request_retake', '  ')$q$, pg_temp.id('s1')::jsonb->>'submission_id'), '%note%required%');
select public.identity_review_decide((pg_temp.id('s1')::jsonb->>'submission_id')::uuid, 'request_retake', 'I could not hear the phrase. Please record again somewhere quieter.');
reset role;
do $$ begin
  perform pg_temp.ok((select status = 'retake_requested' and delete_video_after > now() + interval '29 days' from public.identity_submissions), 'retake requested; video due for deletion after N days');
  perform pg_temp.ok(not exists (select 1 from public.action_member_verifications), 'NO verification row before an approval');
  perform pg_temp.ok((select count(*) = 1 from public.network_notifications where type = 'identity_verification_review'
    and recipient_m_uid = '10000000-0000-4000-8000-0000000000a1' and body like 'Please record%'), 'member notified with the note');
  perform pg_temp.ok((select array_agg(action order by id) = array['consent_accepted','start','submit','viewed','request_retake']
    from public.identity_review_log), 'log: ' || (select string_agg(action, ',' order by id) from public.identity_review_log));
end $$;
-- the log is append-only, even for the superuser
select pg_temp.must_fail($q$update public.identity_review_log set note = 'x'$q$, '%append-only%');
select pg_temp.must_fail($q$delete from public.identity_review_log$q$, '%append-only%');

-- M retakes with a NEW challenge; the owner approves; the verification row appears
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
do $$ declare s jsonb := public.identity_verification_status(); begin
  perform pg_temp.ok(s->'levels'->0->'latest'->>'status' = 'retake_requested' and s->'levels'->0->'latest'->>'decision_note' like 'I could not hear%', 'member sees the retake note: ' || s::text);
end $$;
insert into ids select 's2', public.identity_start_submission('v1_live_intro','v1-live-intro-2026-10-draft1','Em Member',null,true,'test-region')::text;
select pg_temp.ok(pg_temp.id('s2')::jsonb->>'submission_id' <> pg_temp.id('s1')::jsonb->>'submission_id', 'a new submission, a new challenge');
select pg_temp.upload(pg_temp.id('s2')::jsonb->>'object_path', 3500000, 'video/mp4');
select public.identity_finish_submission((pg_temp.id('s2')::jsonb->>'submission_id')::uuid, 25000, now(), '{"source":"getUserMedia","track_state":"live"}');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.identity_review_decide((pg_temp.id('s2')::jsonb->>'submission_id')::uuid, 'approve', null);
-- a decided submission cannot be decided again
select pg_temp.must_fail(format($q$select public.identity_review_decide(%L, 'reject', 'changed my mind')$q$, pg_temp.id('s2')::jsonb->>'submission_id'), '%only a submitted video%');
reset role;
do $$ begin
  perform pg_temp.ok((select status = 'verified' and provider = 'owner_live_video' and location_consent_at is not null
    and location_precision = 'region' and attestation_version = 'v1-live-intro-2026-10-draft1'
    from public.action_member_verifications where user_id = '00000000-0000-4000-8000-0000000000a1' and purpose = 'referral_signup'),
    'V1 approval writes the referral_signup verification');
  -- E=Up: P's referral now counts as a verified join (the rule itself stays disabled pending counsel)
  perform pg_temp.ok((public.action_unlock_progress('00000000-0000-4000-8000-0000000000a3', 'equity_uprise_activation')->>'have')::int = 1, 'one verified join for P');
end $$;

-- the owner cannot decide their own submission
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
insert into ids select 'o1', public.identity_start_submission('v1_live_intro','v1-live-intro-2026-10-draft1','Matthew McCluster',null,true,null)::text;
select pg_temp.upload(pg_temp.id('o1')::jsonb->>'object_path');
select public.identity_finish_submission((pg_temp.id('o1')::jsonb->>'submission_id')::uuid, 10000, now(), '{"source":"getUserMedia","track_state":"live"}');
select pg_temp.must_fail(format($q$select public.identity_review_decide(%L, 'approve', null)$q$, pg_temp.id('o1')::jsonb->>'submission_id'), '%your own submission%');
reset role;

-- V2: second live video + Persona; approval needs both
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
select pg_temp.must_fail($q$select public.identity_start_submission('v2_halo_full','v2-halo-full-2026-10-draft1','Em Member',null,false,null)$q$, '%what you want access to%');
insert into ids select 'v2', public.identity_start_submission('v2_halo_full','v2-halo-full-2026-10-draft1','Em Member','the analyst globe, because I run neighbourhood safety research',false,null)::text;
select pg_temp.ok((pg_temp.id('v2')::jsonb->>'max_seconds')::int = 120, 'v2 allows 120 s');
select pg_temp.upload(pg_temp.id('v2')::jsonb->>'object_path');
select public.identity_finish_submission((pg_temp.id('v2')::jsonb->>'submission_id')::uuid, 45000, now(), '{"source":"getUserMedia","track_state":"live"}');
-- members cannot touch Persona state
select pg_temp.must_fail(format($q$select public.identity_record_persona_inquiry('00000000-0000-4000-8000-0000000000a1', %L, 'inq_fakefake1', 'approved')$q$, pg_temp.id('v2')::jsonb->>'submission_id'), '%permission denied%');
select pg_temp.must_fail($q$select public.identity_apply_persona_event('evt_forged01','inquiry.approved','inq_fakefake1','approved',now())$q$, '%permission denied%');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select pg_temp.must_fail(format($q$select public.identity_review_decide(%L, 'approve', null)$q$, pg_temp.id('v2')::jsonb->>'submission_id'), '%government-ID check is not approved%');
do $$ declare p jsonb := (select x from jsonb_array_elements(public.identity_review_queue()->'pending') x where x->>'level' = 'v2_halo_full'); begin
  perform pg_temp.ok(p->'v1'->>'id' = pg_temp.id('s2')::jsonb->>'submission_id', 'V2 is shown next to the approved V1: ' || p::text);
end $$;
reset role;
-- the Worker (service role) links the inquiry and applies webhook events
select pg_temp.as_service();
select public.identity_record_persona_inquiry('00000000-0000-4000-8000-0000000000a1', (pg_temp.id('v2')::jsonb->>'submission_id')::uuid, 'inq_TestInquiry1', 'created');
do $$ begin perform pg_temp.ok((public.identity_record_persona_inquiry('00000000-0000-4000-8000-0000000000a1', (pg_temp.id('v2')::jsonb->>'submission_id')::uuid, 'inq_TestInquiry1', 'created')->>'idempotent')::boolean, 'linking twice is idempotent'); end $$;
do $$ declare r jsonb; begin
  r := public.identity_apply_persona_event('evt_Completed01', 'inquiry.completed', 'inq_TestInquiry1', 'completed', now() - interval '10 minutes');
  perform pg_temp.ok((r->>'applied')::boolean, 'first event applied');
  r := public.identity_apply_persona_event('evt_Completed01', 'inquiry.completed', 'inq_TestInquiry1', 'completed', now() - interval '10 minutes');
  perform pg_temp.ok((r->>'duplicate')::boolean, 'replayed event id is a duplicate');
  r := public.identity_apply_persona_event('evt_OlderEvent1', 'inquiry.created', 'inq_TestInquiry1', 'created', now() - interval '1 hour');
  perform pg_temp.ok(not (r->>'applied')::boolean, 'an older event does not overwrite a newer status');
  r := public.identity_apply_persona_event('evt_Approved001', 'inquiry.approved', 'inq_TestInquiry1', 'approved', now(), 'EM MEMBER', 1990);
  perform pg_temp.ok((r->>'applied')::boolean, 'approval applied');
end $$;
reset role;
do $$ begin perform pg_temp.ok((select persona_status = 'approved' and persona_verified_name = 'EM MEMBER' and persona_birth_year = 1990
  from public.identity_submissions where persona_inquiry_id = 'inq_TestInquiry1'), 'Persona result stored as status + (opt-in) name + birth year only'); end $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select public.identity_review_decide((pg_temp.id('v2')::jsonb->>'submission_id')::uuid, 'approve', 'Same person as the introduction; ID name matches.');
reset role;

-- ENTITLEMENT only after owner approval AND the rule is signed off and enabled
do $$ begin
  perform pg_temp.ok((select status = 'verified' and provider = 'persona' and provider_reference = 'inq_TestInquiry1'
    from public.action_member_verifications where user_id = '00000000-0000-4000-8000-0000000000a1' and purpose = 'halo_full'), 'halo_full row');
  perform pg_temp.ok(not (public.identity_entitlement_for('00000000-0000-4000-8000-0000000000a1', 'halo_full')->>'entitled')::boolean, 'rule disabled: not entitled yet');
end $$;
select pg_temp.must_fail($q$update public.action_unlock_rules set enabled = true where rule_key = 'halo_full'$q$, '%check constraint%');
update public.action_unlock_rules set counsel_signoff_at = now(), counsel_signoff_ref = 'test', enabled = true where rule_key = 'halo_full';
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
do $$ begin
  perform pg_temp.ok((public.identity_my_entitlement('halo_full')->>'entitled')::boolean, 'M is entitled after approval + sign-off');
  perform pg_temp.ok((public.identity_verification_status()->>'halo_full')::boolean, 'status says halo_full');
end $$;
select pg_temp.must_fail($q$select public.identity_entitlement_for('00000000-0000-4000-8000-0000000000a2', 'halo_full')$q$, '%permission denied%');
reset role;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a2');
do $$ begin perform pg_temp.ok(not (public.identity_my_entitlement('halo_full')->>'entitled')::boolean, 'N is not entitled'); end $$;
reset role;
-- revoking takes it away
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
select pg_temp.must_fail($q$select public.identity_revoke_verification('00000000-0000-4000-8000-0000000000a1', 'halo_full', null)$q$, '%note is required%');
select public.identity_revoke_verification('00000000-0000-4000-8000-0000000000a1', 'halo_full', 'Test revocation.');
reset role;
do $$ begin perform pg_temp.ok(not (public.identity_entitlement_for('00000000-0000-4000-8000-0000000000a1', 'halo_full')->>'entitled')::boolean, 'revoked: not entitled'); end $$;

-- DELETION: the member asks; the owner deletes through Storage, then marks
select pg_temp.as_user('00000000-0000-4000-8000-0000000000a1');
do $$ begin perform pg_temp.ok((public.identity_request_deletion('please delete my videos')->>'videos_marked_for_deletion')::int = 3, 'three of M''s videos marked'); end $$;
delete from storage.objects where bucket_id = 'identity-verification-videos'; -- RLS: a member deletes nothing
reset role;
do $$ begin perform pg_temp.ok((select count(*) from storage.objects where name like '00000000-0000-4000-8000-0000000000a1/%') = 3, 'member could not delete objects'); end $$;
select pg_temp.as_user('00000000-0000-4000-8000-0000000000ad', 'matthew@mccluster.org');
do $$ declare due jsonb := public.identity_videos_due_for_deletion(); begin
  perform pg_temp.ok(jsonb_array_length(due) = 3, 'three due: ' || due::text);
end $$;
select pg_temp.must_fail(format($q$select public.identity_mark_video_deleted(%L)$q$, pg_temp.id('s2')::jsonb->>'submission_id'), '%still in storage%');
delete from storage.objects where bucket_id = 'identity-verification-videos' and name like '00000000-0000-4000-8000-0000000000a1/%';
select public.identity_mark_video_deleted((pg_temp.id('s2')::jsonb->>'submission_id')::uuid);
reset role;
do $$ begin
  perform pg_temp.ok((select video_deleted_at is not null and status = 'approved' from public.identity_submissions where id = (pg_temp.id('s2')::jsonb->>'submission_id')::uuid), 'video gone, decision kept');
end $$;
select 'identity verification levels behaviour: all assertions passed' as result;
