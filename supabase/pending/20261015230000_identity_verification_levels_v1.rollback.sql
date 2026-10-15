-- ROLLBACK for supabase/pending/20261015230000_identity_verification_levels_v1.sql
-- (PENDING: neither file is applied in production). Run as the service role.
--
-- BEFORE running: delete (or, with the owner's written decision, export) every
-- object in the storage bucket `identity-verification-videos` through the
-- Storage API. Dropping the tables below does NOT delete stored videos, and a
-- bucket with objects cannot be removed. Approved verifications are kept in
-- action_member_verifications only until step 4: export them first if the
-- owner wants the record.

-- 1. the bucket's policies and the bucket (empty it first, see above)
drop policy if exists "identity videos: member inserts own issued path once" on storage.objects;
drop policy if exists "identity videos: reviewers read" on storage.objects;
drop policy if exists "identity videos: reviewers delete" on storage.objects;
delete from storage.buckets where id = 'identity-verification-videos';

-- 2. functions
drop function if exists public.identity_apply_persona_event(text, text, text, text, timestamptz, text, integer);
drop function if exists public.identity_record_persona_inquiry(uuid, uuid, text, text);
drop function if exists public.identity_submission_for_persona(uuid, uuid);
drop function if exists public.identity_mark_video_deleted(uuid);
drop function if exists public.identity_videos_due_for_deletion();
drop function if exists public.identity_revoke_verification(uuid, text, text);
drop function if exists public.identity_review_decide(uuid, text, text);
drop function if exists public.identity_review_open(uuid);
drop function if exists public.identity_review_queue();
drop function if exists public.identity_request_deletion(text);
drop function if exists public.identity_finish_submission(uuid, integer, timestamptz, jsonb);
drop function if exists public.identity_start_submission(text, text, text, text, boolean, text);
drop function if exists public.identity_verification_status();
drop function if exists public.identity_challenge_phrase();
drop function if exists public.identity_can_upload(text);
drop function if exists public.identity_my_entitlement(text);
drop function if exists public.identity_entitlement_for(uuid, text);

-- 3. the unlock rule and the requirement kind
delete from public.action_unlock_rules where rule_key = 'halo_full';
alter table public.action_unlock_rules drop constraint if exists action_unlock_rules_identity_purpose_check;
alter table public.action_unlock_rules drop constraint if exists action_unlock_rules_requirement_kind_check;
alter table public.action_unlock_rules add constraint action_unlock_rules_requirement_kind_check check (requirement_kind in
 ('none','signed_in','creator_account','fellow','starter_kinds','verified_referrals'));

-- 4. action_member_verifications back to one row per user (referral_signup only)
delete from public.action_member_verifications where purpose <> 'referral_signup';
alter table public.action_member_verifications drop constraint if exists action_member_verifications_pkey;
alter table public.action_member_verifications add constraint action_member_verifications_pkey primary key (user_id);
alter table public.action_member_verifications drop constraint if exists action_member_verifications_purpose_check;
alter table public.action_member_verifications add constraint action_member_verifications_purpose_check check (purpose in ('referral_signup'));
alter table public.action_member_verifications drop constraint if exists action_member_verifications_verified_check;
alter table public.action_member_verifications add constraint action_member_verifications_check
 check (status <> 'verified' or (provider is not null and provider_reference is not null and verified_at is not null
   and location_consent_at is not null and attestation_signed_at is not null and biometric_consent_at is not null));
alter table public.action_member_verifications drop column if exists review_submission_id;

-- 5. tables (the log's append-only trigger allows only cascade deletes, so
--    drop the trigger before the table)
drop trigger if exists identity_review_log_immutable on public.identity_review_log;
drop table if exists public.identity_persona_events, public.identity_review_log, public.identity_submissions,
 public.identity_consent_acceptances cascade;
drop trigger if exists identity_consent_versions_freeze on public.identity_consent_versions;
drop table if exists public.identity_consent_versions, public.identity_reviewers cascade;
drop function if exists public.identity_log(uuid, uuid, uuid, text, text, text, text, text);
drop function if exists public.identity_log_immutable();
drop function if exists public.identity_consent_freeze();
drop function if exists public.identity_is_reviewer();

-- 6. restore action_unlock_progress() exactly as policy_fellowship_ladder_v1.sql
--    defines it: re-run that file's section "action_unlock_progress" (the file
--    is idempotent; re-running the whole file is also safe).
