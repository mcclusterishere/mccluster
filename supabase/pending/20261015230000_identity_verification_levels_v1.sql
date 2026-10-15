-- IDENTITY VERIFICATION LEVELS v1 (PENDING: not applied in production).
--
-- Owner direction, 2026-10-15 (BRIEF addendum 2), design in
-- docs/control-plane/IDENTITY-VERIFICATION-LEVELS.md:
--   V1 "Live introduction": a LIVE camera video (no uploads, no still photo)
--      in which the person says their first and last name, the on-screen
--      challenge phrase, and promises that is who they are. Required to make
--      an account through a referral link; feeds E=Up's three verified joins.
--      The owner reviews it: approve, reject, or ask for a retake, with a note.
--   V2 "Full Hitman's Halo access": a second live video ("I want access to …
--      because …"), reviewed by the owner side by side with V1 to confirm the
--      same person, PLUS a third-party government-ID check (Persona) whose
--      result the owner matches against the name the person gave. Approval
--      grants the `halo_full` entitlement.
--
-- APPLY ORDER: after supabase/pending/policy_fellowship_ladder_v1.sql (this
-- file EXTENDS its action_member_verifications, action_unlock_rules and
-- action_unlock_progress(); it does not duplicate them).
--
-- What this adds:
--   1. identity_reviewers (named admins besides the owner) and
--      identity_is_reviewer(): who may see and decide submissions.
--   2. identity_consent_versions (versioned, plain-language consent; a level
--      cannot be captured until its consent is ACTIVE, which needs owner
--      approval, a retention period N and a counsel review date) and
--      identity_consent_acceptances (who accepted which version, when).
--   3. identity_submissions (one live video each: level, status, private
--      storage object path, server-issued challenge phrase, capture times,
--      consent version, reviewer, decision, note, Persona inquiry id/status).
--   4. identity_review_log: append-only (update/delete refused by trigger).
--   5. identity_persona_events: webhook idempotency (event id primary key).
--   6. action_member_verifications extended to one row per (user, purpose),
--      purpose 'halo_full' added; action_unlock_rules gains requirement kind
--      'identity_verified' and the rule 'halo_full' (ships DISABLED with
--      requires_counsel_signoff, like the ladder's E=Up rule).
--   7. Private storage bucket identity-verification-videos and its policies:
--      a member may INSERT their own object once, only at the path the
--      server issued, only while the challenge is fresh; members cannot read
--      anything (not even their own); reviewers read (signed URLs) and delete.
--   8. RPCs: identity_verification_status, identity_start_submission,
--      identity_finish_submission, identity_request_deletion (member);
--      identity_review_queue, identity_review_open, identity_review_decide,
--      identity_revoke_verification, identity_videos_due_for_deletion,
--      identity_mark_video_deleted (reviewer); identity_record_persona_inquiry,
--      identity_apply_persona_event, identity_entitlement_for,
--      identity_submission_for_persona (service role, used by the Worker);
--      identity_my_entitlement (member).
--
-- NEVER stored here: ID document images, document numbers, full dates of
-- birth, face templates or any automated face-geometry data. Persona hosts
-- the ID check. Verified name / birth YEAR are stored only if the owner
-- turns on PERSONA_STORE_VERIFIED_NAME on the Worker (default off).
--
-- ROLLBACK: supabase/pending/20261015230000_identity_verification_levels_v1.rollback.sql
-- (export or delete the stored videos through the Storage API FIRST: dropping
-- the tables does not delete objects in the bucket).

-- ---------------------------------------------------------------------------
-- 1. WHO REVIEWS
-- ---------------------------------------------------------------------------
-- The owner always reviews. Anyone else must be named here by the service
-- role (owner decision: which admins, if any) AND be an admin.
create table if not exists public.identity_reviewers (
 user_id uuid primary key references auth.users(id) on delete cascade,
 added_at timestamptz not null default now(),
 added_by text not null check (char_length(added_by) between 1 and 120),
 note text
);
alter table public.identity_reviewers enable row level security;
alter table public.identity_reviewers force row level security;
revoke all on public.identity_reviewers from public, anon, authenticated;
grant all on public.identity_reviewers to service_role;

create or replace function public.identity_is_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
 select (select auth.uid()) is not null
   and coalesce((select public.eu_is_admin()), false)
   and (
     coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'email', '') = 'matthew@mccluster.org'
     or exists (select 1 from public.identity_reviewers r where r.user_id = (select auth.uid()))
   )
$$;
revoke all on function public.identity_is_reviewer() from public, anon;
grant execute on function public.identity_is_reviewer() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. CONSENT, VERSIONED
-- ---------------------------------------------------------------------------
create table if not exists public.identity_consent_versions (
 version text primary key check (version ~ '^[a-z0-9][a-z0-9._-]{2,60}$'),
 level text not null check (level in ('v1_live_intro','v2_halo_full')),
 title text not null check (char_length(title) between 3 and 160),
 body text not null check (char_length(body) between 200 and 20000),
 body_sha256 text, -- set by the trigger below from the exact text
 -- the owner's N: videos are deleted N days after the decision
 retention_days integer check (retention_days is null or retention_days between 1 and 3650),
 status text not null default 'draft' check (status in ('draft','active','retired')),
 approved_by text,
 approved_at timestamptz,
 counsel_reviewed_at timestamptz,
 counsel_ref text,
 created_at timestamptz not null default now(),
 -- a consent cannot go live without the owner's approval, the retention
 -- period filled in, and a counsel review recorded (biometric-law question)
 check (status <> 'active' or (approved_at is not null and approved_by is not null
   and retention_days is not null and counsel_reviewed_at is not null))
);
create unique index if not exists identity_consent_one_active_per_level
 on public.identity_consent_versions(level) where status = 'active';

-- The words people agreed to never change under them: once a version leaves
-- draft its text, level and retention are frozen. A new text is a new version.
create or replace function public.identity_consent_freeze()
returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op = 'INSERT' then
   new.body_sha256 := encode(sha256(convert_to(new.body, 'UTF8')), 'hex');
   return new;
 end if;
 if tg_op = 'DELETE' then
   if old.status <> 'draft' then raise exception 'a consent version that was used cannot be deleted'; end if;
   return old;
 end if;
 if old.status <> 'draft' and (new.body is distinct from old.body or new.title is distinct from old.title
     or new.level is distinct from old.level or new.retention_days is distinct from old.retention_days) then
   raise exception 'consent version % is frozen; publish a new version instead', old.version;
 end if;
 new.body_sha256 := encode(sha256(convert_to(new.body, 'UTF8')), 'hex');
 if old.status = 'retired' and new.status <> 'retired' then raise exception 'a retired consent version stays retired'; end if;
 return new;
end;
$$;
revoke all on function public.identity_consent_freeze() from public, anon, authenticated;
drop trigger if exists identity_consent_versions_freeze on public.identity_consent_versions;
create trigger identity_consent_versions_freeze before insert or update or delete on public.identity_consent_versions
 for each row execute function public.identity_consent_freeze();

-- DRAFT consent texts (owner and counsel approve before either goes live).
-- N is left blank on purpose: the owner chooses it.
insert into public.identity_consent_versions(version, level, title, body) values
('v1-live-intro-2026-10-draft1', 'v1_live_intro', 'Live introduction video: what you are agreeing to',
$c$Before you record, please read this. You can stop at any time before you send.

What we record: a short live video from your camera and microphone, recorded on this page. You cannot upload a file. On screen we show you a short phrase; you say it out loud along with your first and last name and a promise that this is who you are. We also keep the name you type, the time you recorded, the phrase we showed you, and the region you agree to share (a broad area such as a state, never your exact location).

Why: to confirm that a real person is joining, and that it is you. This is required for accounts made through a referral link.

Who sees it: Matthew McCluster (the owner) personally reviews it. The only other people who can see it are admins the owner names in writing for this job. It is never public, never shown on your profile, and never shared with the person who referred you. The person who referred you only learns whether your introduction was approved.

How we review: a person watches your video. We review your submissions together, including comparing them with each other, to confirm you are the same person. If you later ask for full Hitman's Halo access, we compare that second video with this one, and with the name from the ID check. No computer program measures or matches your face.

Not used for AI: your video is never used to train any AI or machine-learning model, and never sold.

How long we keep it: we delete the video [N] days after the owner's decision. The decision itself (approved, rejected, or retake requested), its date and the reviewer's note are kept for as long as your account exists, so the approval can be checked later.

Your choices: you can ask us to delete your video at any time from the verification page or by writing to the owner. If you ask before a decision, your submission is withdrawn. Without an approved introduction, an account made through a referral link cannot count as a verified join.$c$),
('v2-halo-full-2026-10-draft1', 'v2_halo_full', 'Full Hitman''s Halo access: what you are agreeing to',
$c$Before you record, please read this. You can stop at any time before you send.

What we record: a second short live video from your camera and microphone, recorded on this page. You cannot upload a file. You say the phrase shown on screen, your first and last name, what you want access to, and why. We also keep the name and the short access request you type, the time you recorded and the phrase we showed you.

Government ID check: you also complete an identity check with Persona, an outside identity-verification company. Persona collects and holds your ID images and any selfie it asks for under its own privacy terms; we never receive or store your ID images. We receive the result (for example approved or declined) and a reference number. If the owner has turned it on, we also keep the name on your ID and your birth year (never the full date of birth) so the owner can compare it with the name you gave.

Why: full Hitman's Halo access is only for people whose identity the owner has confirmed.

Who sees it: Matthew McCluster (the owner) personally reviews it. The only other people who can see it are admins the owner names in writing for this job. It is never public.

How we review: a person watches your video next to your first introduction video. We review your submissions together, including comparing them with each other and with the ID check result, to confirm you are the same person. No computer program measures or matches your face. We aim to decide within 24 hours.

Not used for AI: your videos are never used to train any AI or machine-learning model, and never sold.

How long we keep it: we delete the video [N] days after the owner's decision. The decision, its date, the reviewer's note and the ID check result are kept while your access lasts, so it can be checked later.

Your choices: you can ask us to delete your videos at any time from the verification page or by writing to the owner. Deleting them before a decision withdraws your request. You can ask Persona to delete what it holds under its own terms.$c$)
on conflict (version) do nothing;

create table if not exists public.identity_consent_acceptances (
 user_id uuid not null references auth.users(id) on delete cascade,
 version text not null references public.identity_consent_versions(version),
 accepted_at timestamptz not null default now(),
 primary key (user_id, version)
);

alter table public.identity_consent_versions enable row level security;
alter table public.identity_consent_acceptances enable row level security;
alter table public.identity_consent_acceptances force row level security;
revoke all on public.identity_consent_versions, public.identity_consent_acceptances from public, anon, authenticated;
grant all on public.identity_consent_versions, public.identity_consent_acceptances to service_role;
grant select on public.identity_consent_versions, public.identity_consent_acceptances to authenticated;
grant select on public.identity_consent_versions to anon;
drop policy if exists "anyone reads consent texts" on public.identity_consent_versions;
create policy "anyone reads consent texts" on public.identity_consent_versions for select to anon, authenticated using (true);
drop policy if exists "member reads own acceptances" on public.identity_consent_acceptances;
create policy "member reads own acceptances" on public.identity_consent_acceptances for select to authenticated
 using (user_id = (select auth.uid()) or (select public.identity_is_reviewer()));

-- ---------------------------------------------------------------------------
-- 3. SUBMISSIONS
-- ---------------------------------------------------------------------------
create table if not exists public.identity_submissions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 m_uid uuid,
 level text not null check (level in ('v1_live_intro','v2_halo_full')),
 status text not null default 'awaiting_capture' check (status in
   ('awaiting_capture','submitted','approved','rejected','retake_requested','expired','withdrawn')),
 consent_version text not null references public.identity_consent_versions(version),
 consent_accepted_at timestamptz not null,
 stated_name text not null check (char_length(btrim(stated_name)) between 2 and 120),
 access_request text check (access_request is null or char_length(btrim(access_request)) between 3 and 600),
 -- the server-issued challenge the person must say on camera
 challenge_phrase text not null check (challenge_phrase ~ '^[a-z]{3,12} [0-9]{4}$'),
 challenge_issued_at timestamptz not null default now(),
 challenge_expires_at timestamptz not null,
 storage_bucket text not null default 'identity-verification-videos' check (storage_bucket = 'identity-verification-videos'),
 object_path text not null unique,
 mime_type text check (mime_type is null or mime_type in ('video/webm','video/mp4')),
 size_bytes bigint check (size_bytes is null or size_bytes between 1 and 52428800),
 duration_ms integer check (duration_ms is null or duration_ms between 3000 and 120000),
 captured_at timestamptz,
 capture_meta jsonb not null default '{}'::jsonb check (jsonb_typeof(capture_meta) = 'object'),
 location_consent_at timestamptz,
 location_precision text check (location_precision is null or location_precision = 'region'),
 location_region_key text,
 submitted_at timestamptz,
 reviewer_id uuid references auth.users(id) on delete set null,
 decision text check (decision is null or decision in ('approve','reject','request_retake')),
 decision_note text check (decision_note is null or char_length(decision_note) <= 2000),
 decided_at timestamptz,
 persona_inquiry_id text unique check (persona_inquiry_id is null or persona_inquiry_id ~ '^inq_[A-Za-z0-9]{6,64}$'),
 persona_status text check (persona_status is null or persona_status in
   ('created','pending','completed','expired','failed','needs_review','approved','declined')),
 persona_status_at timestamptz,
 persona_verified_name text check (persona_verified_name is null or char_length(persona_verified_name) <= 200),
 persona_birth_year smallint check (persona_birth_year is null or persona_birth_year between 1900 and 2100),
 delete_video_after timestamptz,
 video_deleted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check (object_path = user_id::text || '/' || id::text),
 check (challenge_expires_at > challenge_issued_at),
 check (level <> 'v2_halo_full' or access_request is not null),
 check (level <> 'v1_live_intro' or (location_consent_at is not null and location_precision = 'region')),
 check (level = 'v2_halo_full' or (persona_inquiry_id is null and persona_status is null)),
 check (status = 'awaiting_capture' or status in ('expired','withdrawn')
   or (submitted_at is not null and captured_at is not null and mime_type is not null and size_bytes is not null and duration_ms is not null)),
 check (status not in ('approved','rejected','retake_requested') or (decided_at is not null and reviewer_id is not null and decision is not null)),
 check (decision is null or decision <> 'approve' or status = 'approved' or status = 'withdrawn'),
 check (decision is null or decision = 'approve' or decision_note is not null)
);
create index if not exists identity_submissions_queue_idx on public.identity_submissions(status, submitted_at);
create index if not exists identity_submissions_user_idx on public.identity_submissions(user_id, level, created_at desc);
-- one open submission per person per level
create unique index if not exists identity_submissions_one_open
 on public.identity_submissions(user_id, level) where status in ('awaiting_capture','submitted');

alter table public.identity_submissions enable row level security;
alter table public.identity_submissions force row level security;
revoke all on public.identity_submissions from public, anon, authenticated;
grant all on public.identity_submissions to service_role;
grant select on public.identity_submissions to authenticated;
drop policy if exists "member or reviewer reads submissions" on public.identity_submissions;
create policy "member or reviewer reads submissions" on public.identity_submissions for select to authenticated
 using (user_id = (select auth.uid()) or (select public.identity_is_reviewer()));

-- ---------------------------------------------------------------------------
-- 4. THE REVIEW LOG (append-only) AND PERSONA EVENTS
-- ---------------------------------------------------------------------------
create table if not exists public.identity_review_log (
 id bigint generated always as identity primary key,
 submission_id uuid references public.identity_submissions(id) on delete cascade,
 user_id uuid not null,
 actor_id uuid,
 actor_role text not null check (actor_role in ('member','reviewer','service')),
 action text not null check (action in ('consent_accepted','start','submit','expire','withdraw','viewed','approve','reject',
   'request_retake','revoke','persona_inquiry','persona_status','deletion_requested','video_deleted')),
 from_status text,
 to_status text,
 note text check (note is null or char_length(note) <= 2000),
 created_at timestamptz not null default now()
);
create index if not exists identity_review_log_submission_idx on public.identity_review_log(submission_id, created_at);
create index if not exists identity_review_log_user_idx on public.identity_review_log(user_id, created_at);

create or replace function public.identity_log_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
 -- a delete is allowed only as the cascade of erasing a whole account
 if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
 raise exception '% rows are append-only', tg_table_name;
end;
$$;
revoke all on function public.identity_log_immutable() from public, anon, authenticated;
drop trigger if exists identity_review_log_immutable on public.identity_review_log;
create trigger identity_review_log_immutable before update or delete on public.identity_review_log
 for each row execute function public.identity_log_immutable();

create table if not exists public.identity_persona_events (
 event_id text primary key check (event_id ~ '^evt_[A-Za-z0-9]{6,64}$'),
 event_name text not null check (char_length(event_name) <= 80),
 inquiry_id text check (inquiry_id is null or inquiry_id ~ '^inq_[A-Za-z0-9]{6,64}$'),
 inquiry_status text,
 event_created_at timestamptz,
 received_at timestamptz not null default now(),
 applied boolean not null default false
);

alter table public.identity_review_log enable row level security;
alter table public.identity_review_log force row level security;
alter table public.identity_persona_events enable row level security;
alter table public.identity_persona_events force row level security;
revoke all on public.identity_review_log, public.identity_persona_events from public, anon, authenticated;
grant all on public.identity_review_log, public.identity_persona_events to service_role;
grant select on public.identity_review_log to authenticated;
drop policy if exists "reviewer reads the log" on public.identity_review_log;
create policy "reviewer reads the log" on public.identity_review_log for select to authenticated
 using ((select public.identity_is_reviewer()));

create or replace function public.identity_log(p_submission uuid, p_user uuid, p_actor uuid, p_role text, p_action text,
 p_from text, p_to text, p_note text)
returns void language sql security definer set search_path = '' as $$
 insert into public.identity_review_log(submission_id, user_id, actor_id, actor_role, action, from_status, to_status, note)
 values (p_submission, p_user, p_actor, p_role, p_action, p_from, p_to, p_note)
$$;
revoke all on function public.identity_log(uuid,uuid,uuid,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.identity_log(uuid,uuid,uuid,text,text,text,text,text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. ENTITLEMENT ROWS: EXTEND THE LADDER'S TABLES, DO NOT DUPLICATE THEM
-- ---------------------------------------------------------------------------
-- One verification row per (user, purpose). 'referral_signup' = an approved
-- V1 live introduction (what E=Up's verified_referrals counts); 'halo_full' =
-- an approved V2 with an approved Persona inquiry.
alter table public.action_member_verifications
 add column if not exists review_submission_id uuid references public.identity_submissions(id) on delete set null;
alter table public.action_member_verifications drop constraint if exists action_member_verifications_purpose_check;
alter table public.action_member_verifications add constraint action_member_verifications_purpose_check
 check (purpose in ('referral_signup','halo_full'));
alter table public.action_member_verifications drop constraint if exists action_member_verifications_check;
alter table public.action_member_verifications drop constraint if exists action_member_verifications_verified_check;
alter table public.action_member_verifications add constraint action_member_verifications_verified_check
 check (status <> 'verified' or (provider is not null and provider_reference is not null and verified_at is not null
   and attestation_signed_at is not null and biometric_consent_at is not null
   and (purpose <> 'referral_signup' or location_consent_at is not null)));
alter table public.action_member_verifications drop constraint if exists action_member_verifications_pkey;
alter table public.action_member_verifications add constraint action_member_verifications_pkey primary key (user_id, purpose);

alter table public.action_unlock_rules drop constraint if exists action_unlock_rules_requirement_kind_check;
alter table public.action_unlock_rules add constraint action_unlock_rules_requirement_kind_check check (requirement_kind in
 ('none','signed_in','creator_account','fellow','starter_kinds','verified_referrals','registration_assists','identity_verified'));
alter table public.action_unlock_rules drop constraint if exists action_unlock_rules_identity_purpose_check;
alter table public.action_unlock_rules add constraint action_unlock_rules_identity_purpose_check
 check (requirement_kind <> 'identity_verified' or params->>'purpose' in ('referral_signup','halo_full'));

-- Full Hitman's Halo access. Ships DISABLED and awaiting counsel, like E=Up:
-- the owner enables it after the consent text, retention period and the
-- biometric-law question have been reviewed.
insert into public.action_unlock_rules(rule_key, label, unlock_keys, requirement_kind, required_kinds, min_count, params, creator_exclusive, enabled, requires_counsel_signoff) values
 ('halo_full', 'Full Hitman''s Halo access: identity confirmed by the owner', array['entitlement:halo_full'], 'identity_verified',
   null, null, '{"purpose": "halo_full", "sla_hours": 24}', false, false, true)
on conflict (rule_key) do nothing;

-- action_unlock_progress, as in policy_fellowship_ladder_v1.sql, plus:
-- verified_referrals counts only the 'referral_signup' purpose (rows are now
-- per purpose), and 'identity_verified' reads one purpose's verified row.
create or replace function public.action_unlock_progress(p_user uuid, p_rule_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
 r public.action_unlock_rules%rowtype;
 v_have integer := 0;
 v_need integer := 1;
 v_met boolean := false;
 v_reason text := null;
begin
 select * into r from public.action_unlock_rules where rule_key = p_rule_key;
 if not found then return jsonb_build_object('met', false, 'reason', 'no_rule'); end if;
 if r.requirement_kind = 'none' then
   v_have := 1; v_met := true;
 elsif r.requirement_kind = 'signed_in' then
   v_have := case when p_user is null then 0 else 1 end; v_met := p_user is not null;
 elsif p_user is null then
   v_reason := 'sign_in';
 elsif r.requirement_kind = 'creator_account' then
   v_met := exists (select 1 from public.creator_billing_subscriptions s
     where s.owner_user_id = p_user and s.status = 'active' and s.current_period_end > now());
   v_have := case when v_met then 1 else 0 end;
 elsif r.requirement_kind = 'fellow' then
   v_met := exists (select 1 from public.action_fellowship_applications f where f.user_id = p_user and f.status = 'accepted');
   v_have := case when v_met then 1 else 0 end;
 elsif r.requirement_kind = 'starter_kinds' then
   v_need := coalesce(r.min_count, cardinality(r.required_kinds));
   select count(distinct k.kind) into v_have
   from public.action_mission_assignments a
   join public.action_ladder_mission_kinds k on k.mission_id = a.mission_id
   where a.user_id = p_user and a.status = 'verified' and k.kind = any(r.required_kinds);
   v_met := v_have >= v_need;
 elsif r.requirement_kind = 'verified_referrals' then
   v_need := r.min_count;
   select count(distinct p.user_id) into v_have
   from public.action_participants p
   join public.action_member_verifications v on v.user_id = p.user_id and v.purpose = 'referral_signup'
   where p.referred_by in (select mine.referral_code from public.action_participants mine where mine.user_id = p_user)
     and p.user_id <> p_user
     and v.status = 'verified' and (v.expires_at is null or v.expires_at > now());
   v_met := v_have >= v_need;
 elsif r.requirement_kind = 'identity_verified' then
   v_met := exists (select 1 from public.action_member_verifications v
     where v.user_id = p_user and v.purpose = r.params->>'purpose' and v.status = 'verified'
       and (v.expires_at is null or v.expires_at > now()));
   v_have := case when v_met then 1 else 0 end;
   -- A rule may also need N admin-verified missions (params.min_verified_missions,
   -- e.g. the gated track in gated_track_mission_identity_v1). Kept here too so the
   -- result is the same whichever of those files is applied last.
   if r.params ? 'min_verified_missions' then
     v_need := (r.params->>'min_verified_missions')::integer;
     v_have := public.action_member_verified_mission_count(p_user);
     if v_have < v_need then v_met := false; v_reason := 'missions'; end if;
   end if;
 elsif r.requirement_kind = 'registration_assists' then
   v_need := r.min_count; v_reason := 'counting_source_pending_counsel';
 end if;
 if v_met and coalesce((r.params->>'requires_fellow')::boolean, false) and not exists (
   select 1 from public.action_fellowship_applications f where f.user_id = p_user and f.status = 'accepted') then
   v_met := false; v_reason := coalesce(v_reason, 'requires_fellow');
 end if;
 if v_met and r.creator_exclusive and exists (select 1 from public.creator_billing_subscriptions s
   where s.owner_user_id = p_user and s.status = 'active' and s.current_period_end > now()) then
   v_met := false; v_reason := 'creator_exclusive';
 end if;
 if r.requires_counsel_signoff and r.counsel_signoff_at is null then v_met := false; v_reason := 'requires_counsel_signoff';
 elsif not r.enabled then v_met := false; v_reason := coalesce(v_reason, 'disabled');
 end if;
 return jsonb_strip_nulls(jsonb_build_object('met', v_met, 'have', v_have, 'need', v_need, 'reason', v_reason));
end;
$$;
revoke all on function public.action_unlock_progress(uuid, text) from public, anon, authenticated;
grant execute on function public.action_unlock_progress(uuid, text) to service_role;

-- Is p_user entitled to p_key (e.g. 'halo_full')? Any enabled rule whose
-- unlock_keys carry 'entitlement:<key>' and is met. Service role only: the
-- Worker answers Halo with it (docs: the Halo contract).
create or replace function public.identity_entitlement_for(p_user uuid, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_rule text; v_met boolean := false;
begin
 if p_key !~ '^[a-z][a-z0-9_]{1,40}$' then raise exception 'bad entitlement key'; end if;
 for v_rule in select rule_key from public.action_unlock_rules where ('entitlement:' || p_key) = any(unlock_keys) loop
   if coalesce((public.action_unlock_progress(p_user, v_rule)->>'met')::boolean, false) then v_met := true; end if;
 end loop;
 return jsonb_build_object('key', p_key, 'entitled', v_met);
end;
$$;
revoke all on function public.identity_entitlement_for(uuid, text) from public, anon, authenticated;
grant execute on function public.identity_entitlement_for(uuid, text) to service_role;

create or replace function public.identity_my_entitlement(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
 select case when (select auth.uid()) is null then jsonb_build_object('key', p_key, 'entitled', false)
   else public.identity_entitlement_for((select auth.uid()), p_key) end
$$;
revoke all on function public.identity_my_entitlement(text) from public, anon;
grant execute on function public.identity_my_entitlement(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. THE PRIVATE BUCKET
-- ---------------------------------------------------------------------------
-- 50 MB per object; webm (Chrome, Firefox, Android) or mp4 (Safari/iOS).
-- No virus scanner exists on this storage path: the files are only ever
-- played back in the reviewer's browser <video> element, never executed or
-- transcoded server-side (see the design doc, "Security").
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identity-verification-videos', 'identity-verification-videos', false, 52428800, array['video/webm','video/mp4'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
 allowed_mime_types = excluded.allowed_mime_types;

-- May the caller put an object at this name right now? Only the path the
-- server issued to them, only while that submission is awaiting capture and
-- its challenge has not expired.
create or replace function public.identity_can_upload(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
 select (select auth.uid()) is not null and exists (
   select 1 from public.identity_submissions s
   where s.object_path = p_name and s.user_id = (select auth.uid())
     and s.status = 'awaiting_capture' and now() <= s.challenge_expires_at)
$$;
revoke all on function public.identity_can_upload(text) from public, anon;
grant execute on function public.identity_can_upload(text) to authenticated, service_role;

drop policy if exists "identity videos: member inserts own issued path once" on storage.objects;
create policy "identity videos: member inserts own issued path once" on storage.objects for insert to authenticated
 with check (bucket_id = 'identity-verification-videos'
   and (storage.foldername(name))[1] = (select auth.uid())::text
   and (select public.identity_can_upload(name)));
drop policy if exists "identity videos: reviewers read" on storage.objects;
create policy "identity videos: reviewers read" on storage.objects for select to authenticated
 using (bucket_id = 'identity-verification-videos' and (select public.identity_is_reviewer()));
drop policy if exists "identity videos: reviewers delete" on storage.objects;
create policy "identity videos: reviewers delete" on storage.objects for delete to authenticated
 using (bucket_id = 'identity-verification-videos' and (select public.identity_is_reviewer()));
-- No UPDATE policy: an uploaded video can never be replaced (no upsert).

-- ---------------------------------------------------------------------------
-- 7. MEMBER RPCs
-- ---------------------------------------------------------------------------
create or replace function public.identity_challenge_phrase()
returns text language plpgsql volatile set search_path = '' as $$
declare
 w text[] := array['harbor','maple','river','canyon','lantern','meadow','orbit','pepper','quarry','saddle',
   'timber','violet','willow','anchor','beacon','cobalt','falcon','garnet','island','juniper',
   'kettle','lagoon','marble','nectar','oyster','pebble','rocket','summit','tulip','velvet',
   'walnut','yonder','zephyr','bramble','copper','dragon','ember','fjord','glacier','hollow'];
 h text := md5(gen_random_uuid()::text);
 a bigint := ('x' || substr(h, 1, 8))::bit(32)::bigint;
 b bigint := ('x' || substr(h, 9, 8))::bit(32)::bigint;
begin
 return w[1 + (abs(a) % cardinality(w))] || ' ' || (1000 + abs(b) % 9000)::text;
end;
$$;
revoke all on function public.identity_challenge_phrase() from public, anon, authenticated;
grant execute on function public.identity_challenge_phrase() to service_role;

-- Where do I stand? Consent texts, my latest submission per level, my verified levels.
create or replace function public.identity_verification_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); v_levels jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object(
   'level', l.level,
   'consent', (select jsonb_build_object('version', c.version, 'title', c.title, 'body', c.body, 'body_sha256', c.body_sha256,
       'retention_days', c.retention_days)
     from public.identity_consent_versions c where c.level = l.level and c.status = 'active'),
   'latest', case when v_user is null then null else (select jsonb_build_object('id', s.id, 'status', s.status,
       'created_at', s.created_at, 'submitted_at', s.submitted_at, 'decided_at', s.decided_at,
       'decision_note', case when s.status in ('rejected','retake_requested') then s.decision_note end,
       'persona_status', s.persona_status, 'persona_inquiry', s.persona_inquiry_id is not null,
       'video_deleted', s.video_deleted_at is not null)
     from public.identity_submissions s where s.user_id = v_user and s.level = l.level
     order by s.created_at desc limit 1) end,
   'verified', v_user is not null and exists (select 1 from public.action_member_verifications v
     where v.user_id = v_user and v.status = 'verified'
       and v.purpose = case l.level when 'v1_live_intro' then 'referral_signup' else 'halo_full' end)
 ) order by l.level), '[]'::jsonb)
 into v_levels
 from (values ('v1_live_intro'), ('v2_halo_full')) as l(level);
 return jsonb_build_object('signed_in', v_user is not null, 'levels', v_levels,
   'halo_full', case when v_user is null then false
     else coalesce((public.identity_entitlement_for(v_user, 'halo_full')->>'entitled')::boolean, false) end,
   'limits', jsonb_build_object('max_bytes', 52428800, 'mime', jsonb_build_array('video/webm','video/mp4'),
     'max_seconds', jsonb_build_object('v1_live_intro', 60, 'v2_halo_full', 120), 'min_seconds', 3,
     'challenge_minutes', 10));
end;
$$;
revoke all on function public.identity_verification_status() from public;
grant execute on function public.identity_verification_status() to anon, authenticated, service_role;

-- Accept the active consent for a level and get a fresh challenge and the
-- one private path the video may be uploaded to.
create or replace function public.identity_start_submission(
 p_level text,
 p_consent_version text,
 p_stated_name text,
 p_access_request text default null,
 p_location_consent boolean default false,
 p_region_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_consent public.identity_consent_versions%rowtype;
 v_id uuid := gen_random_uuid();
 v_now timestamptz := now();
 v_phrase text;
 v_old record;
begin
 if v_user is null then raise exception 'sign in first'; end if;
 if p_level not in ('v1_live_intro','v2_halo_full') then raise exception 'unknown level'; end if;
 select * into v_consent from public.identity_consent_versions where level = p_level and status = 'active';
 if not found then raise exception 'this verification is not open yet: its consent has not been approved'; end if;
 if p_consent_version is null or p_consent_version <> v_consent.version then
   raise exception 'consent required: accept the current consent text (%) first', v_consent.version;
 end if;
 if char_length(btrim(coalesce(p_stated_name, ''))) < 2 then raise exception 'type your first and last name'; end if;
 if p_level = 'v1_live_intro' and not coalesce(p_location_consent, false) then
   raise exception 'location consent required: share your broad region (never an exact location)';
 end if;
 if p_region_key is not null and not exists (select 1 from public.action_globe_regions g where g.region_key = p_region_key) then
   raise exception 'unknown region';
 end if;
 if p_level = 'v2_halo_full' then
   if char_length(btrim(coalesce(p_access_request, ''))) < 3 then raise exception 'say what you want access to'; end if;
   if not exists (select 1 from public.identity_submissions s where s.user_id = v_user and s.level = 'v1_live_intro' and s.status = 'approved') then
     raise exception 'your live introduction must be approved first';
   end if;
 end if;
 if exists (select 1 from public.action_member_verifications v where v.user_id = v_user and v.status = 'verified'
     and v.purpose = case p_level when 'v1_live_intro' then 'referral_signup' else 'halo_full' end) then
   raise exception 'you are already verified at this level';
 end if;
 if exists (select 1 from public.identity_submissions s where s.user_id = v_user and s.level = p_level and s.status = 'submitted') then
   raise exception 'your video is already with the owner for review';
 end if;
 if (select count(*) from public.identity_submissions s where s.user_id = v_user and s.created_at > v_now - interval '24 hours') >= 6 then
   raise exception 'too many attempts today; try again tomorrow';
 end if;
 -- an unfinished earlier attempt expires; its challenge can never be used again
 for v_old in select id from public.identity_submissions s where s.user_id = v_user and s.level = p_level and s.status = 'awaiting_capture' loop
   update public.identity_submissions set status = 'expired', updated_at = v_now where id = v_old.id;
   perform public.identity_log(v_old.id, v_user, v_user, 'member', 'expire', 'awaiting_capture', 'expired', 'replaced by a new attempt');
 end loop;

 insert into public.identity_consent_acceptances(user_id, version, accepted_at) values (v_user, v_consent.version, v_now)
 on conflict (user_id, version) do update set accepted_at = excluded.accepted_at;
 v_phrase := public.identity_challenge_phrase();
 insert into public.identity_submissions(id, user_id, m_uid, level, consent_version, consent_accepted_at, stated_name, access_request,
   challenge_phrase, challenge_issued_at, challenge_expires_at, object_path,
   location_consent_at, location_precision, location_region_key)
 values (v_id, v_user, public.current_m_uid(), p_level, v_consent.version, v_now, btrim(p_stated_name),
   case when p_level = 'v2_halo_full' then btrim(p_access_request) end,
   v_phrase, v_now, v_now + interval '10 minutes', v_user::text || '/' || v_id::text,
   case when coalesce(p_location_consent, false) then v_now end,
   case when coalesce(p_location_consent, false) then 'region' end,
   case when coalesce(p_location_consent, false) then p_region_key end);
 perform public.identity_log(v_id, v_user, v_user, 'member', 'consent_accepted', null, null, v_consent.version);
 perform public.identity_log(v_id, v_user, v_user, 'member', 'start', null, 'awaiting_capture', null);
 return jsonb_build_object('submission_id', v_id, 'bucket', 'identity-verification-videos',
   'object_path', v_user::text || '/' || v_id::text, 'challenge_phrase', v_phrase,
   'challenge_expires_at', v_now + interval '10 minutes',
   'max_seconds', case p_level when 'v1_live_intro' then 60 else 120 end, 'min_seconds', 3,
   'max_bytes', 52428800, 'mime', jsonb_build_array('video/webm','video/mp4'));
end;
$$;
revoke all on function public.identity_start_submission(text,text,text,text,boolean,text) from public, anon;
grant execute on function public.identity_start_submission(text,text,text,text,boolean,text) to authenticated, service_role;

-- The video is in the bucket: check it is really there, at the issued path,
-- uploaded by this person, within the limits, then send it for review.
create or replace function public.identity_finish_submission(
 p_submission_id uuid,
 p_duration_ms integer,
 p_captured_at timestamptz,
 p_capture_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 s public.identity_submissions%rowtype;
 o record;
 v_size bigint;
 v_mime text;
 v_max integer;
begin
 if v_user is null then raise exception 'sign in first'; end if;
 select * into s from public.identity_submissions where id = p_submission_id for update;
 if not found or s.user_id <> v_user then raise exception 'submission not found'; end if;
 if s.status <> 'awaiting_capture' then raise exception 'this submission is %', s.status; end if;
 -- the upload itself is refused after expiry; a few minutes' grace covers a slow finish call
 if now() > s.challenge_expires_at + interval '5 minutes' then raise exception 'the challenge expired: start again for a new phrase'; end if;
 if p_captured_at is null or p_captured_at < s.challenge_issued_at - interval '5 seconds' or p_captured_at > now() + interval '1 minute' then
   raise exception 'the recording must be made after the challenge was shown';
 end if;
 if coalesce(p_capture_meta->>'source', '') <> 'getUserMedia' or coalesce(p_capture_meta->>'track_state', '') <> 'live' then
   raise exception 'only a live camera recording is accepted';
 end if;
 v_max := case s.level when 'v1_live_intro' then 60000 else 120000 end;
 if p_duration_ms is null or p_duration_ms < 3000 or p_duration_ms > v_max + 2000 then
   raise exception 'the video must be between 3 and % seconds', v_max / 1000;
 end if;
 select ob.name, ob.metadata, ob.owner, ob.owner_id into o from storage.objects ob
 where ob.bucket_id = s.storage_bucket and ob.name = s.object_path;
 if not found then raise exception 'the video has not been uploaded'; end if;
 if coalesce(o.owner::text, o.owner_id) is distinct from v_user::text then raise exception 'the video was not uploaded by you'; end if;
 v_size := nullif(o.metadata->>'size', '')::bigint;
 v_mime := split_part(coalesce(o.metadata->>'mimetype', ''), ';', 1);
 if v_size is null or v_size < 1 or v_size > 52428800 then raise exception 'the video is empty or too large'; end if;
 if v_mime not in ('video/webm','video/mp4') then raise exception 'unsupported video type'; end if;
 update public.identity_submissions set status = 'submitted', submitted_at = now(), captured_at = p_captured_at,
   duration_ms = least(p_duration_ms, v_max), size_bytes = v_size, mime_type = v_mime,
   capture_meta = jsonb_strip_nulls(jsonb_build_object('source', 'getUserMedia', 'track_state', 'live',
     'recorder_mime', left(p_capture_meta->>'recorder_mime', 80), 'challenge_shown', (p_capture_meta->>'challenge_shown')::boolean,
     'facing', left(p_capture_meta->>'facing', 20))),
   updated_at = now()
 where id = s.id;
 perform public.identity_log(s.id, v_user, v_user, 'member', 'submit', 'awaiting_capture', 'submitted', null);
 return jsonb_build_object('submission_id', s.id, 'status', 'submitted', 'review_target_hours', 24);
end;
$$;
revoke all on function public.identity_finish_submission(uuid,integer,timestamptz,jsonb) from public, anon;
grant execute on function public.identity_finish_submission(uuid,integer,timestamptz,jsonb) to authenticated, service_role;

-- "Delete my videos": every stored video of mine becomes due for deletion
-- now; anything still open is withdrawn. Decisions stay (they are the record).
create or replace function public.identity_request_deletion(p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); r record; v_n integer := 0;
begin
 if v_user is null then raise exception 'sign in first'; end if;
 for r in select id, status from public.identity_submissions where user_id = v_user and video_deleted_at is null for update loop
   update public.identity_submissions set delete_video_after = now(),
     status = case when status in ('awaiting_capture','submitted') then 'withdrawn' else status end,
     updated_at = now() where id = r.id;
   perform public.identity_log(r.id, v_user, v_user, 'member', 'deletion_requested', r.status,
     case when r.status in ('awaiting_capture','submitted') then 'withdrawn' else r.status end, left(p_note, 2000));
   v_n := v_n + 1;
 end loop;
 return jsonb_build_object('videos_marked_for_deletion', v_n);
end;
$$;
revoke all on function public.identity_request_deletion(text) from public, anon;
grant execute on function public.identity_request_deletion(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. REVIEWER RPCs
-- ---------------------------------------------------------------------------
create or replace function public.identity_review_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
 if not (select public.identity_is_reviewer()) then raise exception 'not authorized'; end if;
 return jsonb_build_object(
  'pending', coalesce((select jsonb_agg(jsonb_build_object(
     'id', s.id, 'user_id', s.user_id, 'level', s.level, 'stated_name', s.stated_name, 'access_request', s.access_request,
     'challenge_phrase', s.challenge_phrase, 'captured_at', s.captured_at, 'submitted_at', s.submitted_at,
     'age_hours', round(extract(epoch from (now() - s.submitted_at)) / 3600.0, 1),
     'sla_due_at', s.submitted_at + interval '24 hours', 'overdue', now() > s.submitted_at + interval '24 hours',
     'duration_ms', s.duration_ms, 'mime_type', s.mime_type, 'object_path', s.object_path,
     'location_region_key', s.location_region_key, 'consent_version', s.consent_version,
     'persona_inquiry_id', s.persona_inquiry_id, 'persona_status', s.persona_status, 'persona_status_at', s.persona_status_at,
     'persona_verified_name', s.persona_verified_name, 'persona_birth_year', s.persona_birth_year,
     'is_mine', s.user_id = (select auth.uid()),
     'v1', (select jsonb_build_object('id', p.id, 'stated_name', p.stated_name, 'challenge_phrase', p.challenge_phrase,
         'captured_at', p.captured_at, 'decided_at', p.decided_at, 'object_path', p.object_path, 'mime_type', p.mime_type,
         'video_deleted', p.video_deleted_at is not null)
       from public.identity_submissions p where p.user_id = s.user_id and p.level = 'v1_live_intro' and p.status = 'approved'
       order by p.decided_at desc limit 1),
     'previous_attempts', (select count(*) from public.identity_submissions q where q.user_id = s.user_id and q.level = s.level and q.id <> s.id
       and q.status in ('rejected','retake_requested'))
   ) order by s.submitted_at) from public.identity_submissions s where s.status = 'submitted'), '[]'::jsonb),
  'recent', coalesce((select jsonb_agg(x order by x->>'decided_at' desc) from (
     select jsonb_build_object('id', s.id, 'level', s.level, 'stated_name', s.stated_name, 'status', s.status,
       'decided_at', s.decided_at, 'decision_note', s.decision_note, 'persona_status', s.persona_status,
       'video_deleted', s.video_deleted_at is not null, 'delete_video_after', s.delete_video_after) as x
     from public.identity_submissions s where s.decided_at is not null order by s.decided_at desc limit 50) d), '[]'::jsonb),
  'due_for_deletion', (select count(*) from public.identity_submissions s
     where s.video_deleted_at is null and s.delete_video_after is not null and s.delete_video_after <= now()));
end;
$$;
revoke all on function public.identity_review_queue() from public, anon;
grant execute on function public.identity_review_queue() to authenticated, service_role;

-- Opening a submission is logged. Returns the object paths to sign (the
-- reviewer's browser asks Storage for a short-lived signed URL; the bucket
-- lets only reviewers read).
create or replace function public.identity_review_open(p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare s public.identity_submissions%rowtype; v_v1 text;
begin
 if not (select public.identity_is_reviewer()) then raise exception 'not authorized'; end if;
 select * into s from public.identity_submissions where id = p_submission_id;
 if not found then raise exception 'submission not found'; end if;
 select p.object_path into v_v1 from public.identity_submissions p
 where s.level = 'v2_halo_full' and p.user_id = s.user_id and p.level = 'v1_live_intro' and p.status = 'approved' and p.video_deleted_at is null
 order by p.decided_at desc limit 1;
 perform public.identity_log(s.id, s.user_id, (select auth.uid()), 'reviewer', 'viewed', s.status, s.status, null);
 return jsonb_build_object('bucket', s.storage_bucket,
   'object_path', case when s.video_deleted_at is null then s.object_path end,
   'v1_object_path', v_v1, 'signed_url_seconds', 300);
end;
$$;
revoke all on function public.identity_review_open(uuid) from public, anon;
grant execute on function public.identity_review_open(uuid) to authenticated, service_role;

-- approve / reject / request_retake, with a note (required unless approving).
-- The ONLY path that writes a verified action_member_verifications row.
create or replace function public.identity_review_decide(p_submission_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_me uuid := (select auth.uid());
 s public.identity_submissions%rowtype;
 v_consent public.identity_consent_versions%rowtype;
 v_to text;
 v_purpose text;
 v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
 if not (select public.identity_is_reviewer()) then raise exception 'not authorized'; end if;
 if p_decision not in ('approve','reject','request_retake') then raise exception 'decision must be approve, reject or request_retake'; end if;
 select * into s from public.identity_submissions where id = p_submission_id for update;
 if not found then raise exception 'submission not found'; end if;
 if s.user_id = v_me then raise exception 'you cannot review your own submission'; end if;
 if s.status <> 'submitted' then raise exception 'only a submitted video can be decided (this one is %)', s.status; end if;
 if p_decision <> 'approve' and v_note is null then raise exception 'a note to the person is required to reject or ask for a retake'; end if;
 if p_decision = 'approve' and s.video_deleted_at is not null then raise exception 'the video was deleted; ask for a retake'; end if;
 if p_decision = 'approve' and s.level = 'v2_halo_full' then
   if coalesce(s.persona_status, '') <> 'approved' then
     raise exception 'the government-ID check is not approved yet (Persona status: %)', coalesce(s.persona_status, 'none');
   end if;
   if not exists (select 1 from public.identity_submissions p where p.user_id = s.user_id and p.level = 'v1_live_intro' and p.status = 'approved') then
     raise exception 'their live introduction is not approved';
   end if;
 end if;
 select * into v_consent from public.identity_consent_versions where version = s.consent_version;
 v_to := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'retake_requested' end;
 update public.identity_submissions set status = v_to, decision = p_decision, decision_note = v_note, reviewer_id = v_me,
   decided_at = now(), delete_video_after = now() + make_interval(days => coalesce(v_consent.retention_days, 30)), updated_at = now()
 where id = s.id;
 perform public.identity_log(s.id, s.user_id, v_me, 'reviewer', p_decision, 'submitted', v_to, v_note);

 if p_decision = 'approve' then
   v_purpose := case s.level when 'v1_live_intro' then 'referral_signup' else 'halo_full' end;
   insert into public.action_member_verifications(user_id, purpose, status, provider, provider_reference,
     location_consent_at, location_precision, attestation_version, attestation_signed_at, biometric_consent_version,
     biometric_consent_at, verified_at, review_submission_id, updated_at)
   values (s.user_id, v_purpose, 'verified',
     case s.level when 'v1_live_intro' then 'owner_live_video' else 'persona' end,
     case s.level when 'v1_live_intro' then s.id::text else s.persona_inquiry_id end,
     s.location_consent_at, s.location_precision, s.consent_version, s.consent_accepted_at, s.consent_version,
     s.consent_accepted_at, now(), s.id, now())
   on conflict (user_id, purpose) do update set status = 'verified', provider = excluded.provider,
     provider_reference = excluded.provider_reference,
     location_consent_at = coalesce(excluded.location_consent_at, public.action_member_verifications.location_consent_at),
     location_precision = coalesce(excluded.location_precision, public.action_member_verifications.location_precision),
     attestation_version = excluded.attestation_version, attestation_signed_at = excluded.attestation_signed_at,
     biometric_consent_version = excluded.biometric_consent_version, biometric_consent_at = excluded.biometric_consent_at,
     verified_at = excluded.verified_at, review_submission_id = excluded.review_submission_id, updated_at = now();
 end if;

 if s.m_uid is not null then
   insert into public.network_notifications(recipient_m_uid, actor_m_uid, type, object_type, object_id, body, metadata)
   values (s.m_uid, null, 'identity_verification_review', 'identity_submission', s.id::text,
     case p_decision
       when 'approve' then case s.level when 'v1_live_intro' then 'Your live introduction was approved.' else 'Your full Hitman''s Halo access was approved.' end
       when 'reject' then 'Your verification video was not approved: ' || v_note
       else 'Please record your verification video again: ' || v_note end,
     jsonb_build_object('level', s.level, 'decision', p_decision));
 end if;
 return jsonb_build_object('submission_id', s.id, 'status', v_to, 'decision', p_decision);
end;
$$;
revoke all on function public.identity_review_decide(uuid, text, text) from public, anon;
grant execute on function public.identity_review_decide(uuid, text, text) to authenticated, service_role;

create or replace function public.identity_revoke_verification(p_user uuid, p_purpose text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_me uuid := (select auth.uid()); v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_sub uuid;
begin
 if not (select public.identity_is_reviewer()) then raise exception 'not authorized'; end if;
 if p_purpose not in ('referral_signup','halo_full') then raise exception 'unknown purpose'; end if;
 if v_note is null then raise exception 'a note is required to revoke'; end if;
 update public.action_member_verifications set status = 'revoked', updated_at = now()
 where user_id = p_user and purpose = p_purpose and status = 'verified' returning review_submission_id into v_sub;
 if not found then raise exception 'no verified row to revoke'; end if;
 perform public.identity_log(v_sub, p_user, v_me, 'reviewer', 'revoke', 'verified', 'revoked', v_note);
 return jsonb_build_object('user_id', p_user, 'purpose', p_purpose, 'status', 'revoked');
end;
$$;
revoke all on function public.identity_revoke_verification(uuid, text, text) from public, anon;
grant execute on function public.identity_revoke_verification(uuid, text, text) to authenticated, service_role;

-- Retention: which stored videos are past their delete date (N days after the
-- decision, or now if the person asked). The reviewer's desk deletes them
-- through the Storage API and then marks them.
create or replace function public.identity_videos_due_for_deletion()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
 if not (coalesce((select public.identity_is_reviewer()), false) or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role') then
   raise exception 'not authorized';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'bucket', s.storage_bucket, 'object_path', s.object_path,
     'delete_video_after', s.delete_video_after) order by s.delete_video_after)
   from public.identity_submissions s
   where s.video_deleted_at is null and s.delete_video_after is not null and s.delete_video_after <= now()), '[]'::jsonb);
end;
$$;
revoke all on function public.identity_videos_due_for_deletion() from public, anon;
grant execute on function public.identity_videos_due_for_deletion() to authenticated, service_role;

create or replace function public.identity_mark_video_deleted(p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare s public.identity_submissions%rowtype; v_reviewer boolean := coalesce((select public.identity_is_reviewer()), false);
begin
 if not (v_reviewer or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '') = 'service_role') then raise exception 'not authorized'; end if;
 select * into s from public.identity_submissions where id = p_submission_id for update;
 if not found then raise exception 'submission not found'; end if;
 if s.video_deleted_at is not null then return jsonb_build_object('submission_id', s.id, 'idempotent', true); end if;
 if exists (select 1 from storage.objects o where o.bucket_id = s.storage_bucket and o.name = s.object_path) then
   raise exception 'the video is still in storage: delete it through the Storage API first';
 end if;
 update public.identity_submissions set video_deleted_at = now(), updated_at = now() where id = s.id;
 perform public.identity_log(s.id, s.user_id, (select auth.uid()), case when v_reviewer then 'reviewer' else 'service' end,
   'video_deleted', s.status, s.status, null);
 return jsonb_build_object('submission_id', s.id, 'video_deleted', true);
end;
$$;
revoke all on function public.identity_mark_video_deleted(uuid) from public, anon;
grant execute on function public.identity_mark_video_deleted(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. SERVICE-ROLE RPCs FOR THE WORKER (Persona)
-- ---------------------------------------------------------------------------
-- What the Worker needs to decide whether to open a Persona inquiry.
create or replace function public.identity_submission_for_persona(p_user uuid, p_submission_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('id', s.id, 'level', s.level, 'status', s.status, 'persona_inquiry_id', s.persona_inquiry_id,
   'persona_status', s.persona_status)
 from public.identity_submissions s where s.id = p_submission_id and s.user_id = p_user
$$;
revoke all on function public.identity_submission_for_persona(uuid, uuid) from public, anon, authenticated;
grant execute on function public.identity_submission_for_persona(uuid, uuid) to service_role;

create or replace function public.identity_record_persona_inquiry(p_user uuid, p_submission_id uuid, p_inquiry_id text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare s public.identity_submissions%rowtype;
begin
 select * into s from public.identity_submissions where id = p_submission_id and user_id = p_user for update;
 if not found then raise exception 'submission not found'; end if;
 if s.level <> 'v2_halo_full' then raise exception 'only a full-access request uses the ID check'; end if;
 if s.status not in ('awaiting_capture','submitted') then raise exception 'this submission is %', s.status; end if;
 if s.persona_inquiry_id is not null then
   if s.persona_inquiry_id = p_inquiry_id then return jsonb_build_object('submission_id', s.id, 'idempotent', true); end if;
   raise exception 'an ID check is already linked to this submission';
 end if;
 update public.identity_submissions set persona_inquiry_id = p_inquiry_id, persona_status = coalesce(p_status, 'created'),
   -- the status time is the PROVIDER's event time; none yet, so the first webhook always applies
   persona_status_at = null, updated_at = now() where id = s.id;
 perform public.identity_log(s.id, s.user_id, null, 'service', 'persona_inquiry', s.status, s.status, p_inquiry_id);
 return jsonb_build_object('submission_id', s.id, 'persona_inquiry_id', p_inquiry_id);
end;
$$;
revoke all on function public.identity_record_persona_inquiry(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.identity_record_persona_inquiry(uuid, uuid, text, text) to service_role;

-- One webhook delivery. Idempotent by event id; an older event never
-- overwrites a newer status (Persona may deliver out of order).
create or replace function public.identity_apply_persona_event(
 p_event_id text, p_event_name text, p_inquiry_id text, p_status text, p_event_created_at timestamptz,
 p_verified_name text default null, p_birth_year integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare s public.identity_submissions%rowtype; v_applied boolean := false;
begin
 insert into public.identity_persona_events(event_id, event_name, inquiry_id, inquiry_status, event_created_at)
 values (p_event_id, left(p_event_name, 80), p_inquiry_id, p_status, p_event_created_at)
 on conflict (event_id) do nothing;
 if not found then return jsonb_build_object('event_id', p_event_id, 'duplicate', true); end if;
 if p_inquiry_id is null or p_status is null or p_status not in
   ('created','pending','completed','expired','failed','needs_review','approved','declined') then
   return jsonb_build_object('event_id', p_event_id, 'duplicate', false, 'applied', false, 'reason', 'not an inquiry status');
 end if;
 select * into s from public.identity_submissions where persona_inquiry_id = p_inquiry_id for update;
 if not found then return jsonb_build_object('event_id', p_event_id, 'duplicate', false, 'applied', false, 'reason', 'unknown inquiry'); end if;
 if s.persona_status_at is null or p_event_created_at is null or p_event_created_at >= s.persona_status_at then
   update public.identity_submissions set persona_status = p_status, persona_status_at = coalesce(p_event_created_at, now()),
     persona_verified_name = coalesce(left(nullif(btrim(p_verified_name), ''), 200), persona_verified_name),
     persona_birth_year = coalesce(case when p_birth_year between 1900 and 2100 then p_birth_year end, persona_birth_year),
     updated_at = now()
   where id = s.id;
   v_applied := true;
   update public.identity_persona_events set applied = true where event_id = p_event_id;
   perform public.identity_log(s.id, s.user_id, null, 'service', 'persona_status', s.persona_status, p_status, p_event_name);
 end if;
 return jsonb_build_object('event_id', p_event_id, 'duplicate', false, 'applied', v_applied, 'submission_id', s.id);
end;
$$;
revoke all on function public.identity_apply_persona_event(text, text, text, text, timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.identity_apply_persona_event(text, text, text, text, timestamptz, text, integer) to service_role;

-- Internal helpers are not callable by API roles.
revoke all on function public.identity_challenge_phrase() from public, anon, authenticated;
