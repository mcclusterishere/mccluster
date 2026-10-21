-- PROFILE EDIT GATE v1 (PENDING: not applied in production).
--
-- Owner direction, 2026-10-15 (BRIEF addendum 7): "Editing your profile after
-- onboarding should require a video recording literally asking to edit, then
-- identity verification through Persona." The owner reviews each request.
-- Design: docs/control-plane/MEMBER-DESK-AND-PROFILE-EDIT-GATE.md
--
-- APPLY ORDER: after supabase/pending/policy_fellowship_ladder_v1.sql and
-- supabase/pending/20261015230000_identity_verification_levels_v1.sql. This
-- file REUSES the identity levels' consent table, submissions table, private
-- bucket, upload policy, finish function, review log and Persona inquiry flow;
-- it adds one submission level, 'profile_edit', and nothing parallel to them.
--
-- What this adds:
--   1. profile_protected_fields: the DATA-DRIVEN list of profile fields that
--      lock once set (table, column, owner key, label, validation). The owner
--      changes the list with an UPDATE/INSERT; triggers follow the list.
--      Default (conservative, documented): legal name, handle, artist or
--      business name, creator page address, mailing state/region and country,
--      region on the globe, payout account (not requestable: payouts change
--      only through payout setup). Display name is listed but OFF.
--      Never protected: avatar, bio, headline, website, phone, street
--      address, notification and privacy preferences, password.
--   2. profile_edit_settings: one row; require_persona (default true: an
--      approval needs Persona "approved", as the owner asked).
--   3. profile_edit_guard(): a BEFORE UPDATE OR DELETE trigger on every table
--      in the list. When the writer is a signed-in member (the API role
--      'authenticated', directly or through any security-definer RPC called
--      with a member's token) and a protected column that ALREADY HAS A VALUE
--      would change, the write is refused ('profile_field_locked'). An empty
--      field may still be filled (that is onboarding). The service role, the
--      SQL editor and the approved-edit path are not members.
--   4. identity_submissions gains level 'profile_edit' (consent level too);
--      a decision on a profile edit can only be made by
--      profile_edit_review_decide() (trigger), so identity_review_decide()
--      can never treat one as a V1/V2 and grant a verification row.
--   5. profile_edit_requests (the requested values and the reason, one per
--      submission) and profile_edit_audit (append-only: every applied
--      change with old and new value, who approved, when).
--   6. RPCs: profile_edit_status, profile_edit_start (member);
--      profile_edit_review_queue, profile_edit_review_decide (reviewer);
--      profile_edit_attach_guards (service role / owner).
--   7. identity_record_persona_inquiry() replaced with the identical function
--      that also accepts a 'profile_edit' submission (the Worker route
--      /v1/identity/persona/inquiry accepts both levels).
--
-- Status of a request is DERIVED, never copied: the submission's status
-- (awaiting_capture, submitted, approved, rejected, retake_requested,
-- expired, withdrawn) plus profile_edit_requests.applied_at.
--
-- ROLLBACK: supabase/pending/20261016010000_profile_edit_gate_v1.rollback.sql
-- (delete the stored profile-edit videos through the Storage API first).

do $pre$ begin
 if to_regclass('public.identity_submissions') is null or to_regclass('public.identity_consent_versions') is null then
   raise exception 'apply supabase/pending/20261015230000_identity_verification_levels_v1.sql first';
 end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1. THE PROTECTED FIELDS (data, not code)
-- ---------------------------------------------------------------------------
create table if not exists public.profile_protected_fields (
 field_key text primary key check (field_key ~ '^[a-z][a-z0-9_]{1,40}$'),
 label text not null check (char_length(label) between 2 and 80),
 table_name text not null check (table_name ~ '^[a-z][a-z0-9_]{1,62}$'),
 column_name text not null check (column_name ~ '^[a-z][a-z0-9_]{1,62}$'),
 -- the column that says whose row it is, and what kind of id it holds
 owner_column text not null check (owner_column ~ '^[a-z][a-z0-9_]{1,62}$'),
 owner_kind text not null check (owner_kind in ('user','m_uid')),
 -- false: the lock applies but the value never changes through a request
 -- (it has its own verified flow, e.g. payout setup)
 enabled boolean not null default true,
 requestable boolean not null default true,
 value_pattern text,
 max_length integer not null default 160 check (max_length between 1 and 2000),
 note text check (note is null or char_length(note) <= 400),
 sort smallint not null default 100,
 updated_at timestamptz not null default now(),
 unique (table_name, column_name)
);
comment on table public.profile_protected_fields is
 'Profile fields that lock once set; a change needs an approved profile edit request '
 '(live video + Persona + owner review). The owner edits this list; triggers follow it.';

insert into public.profile_protected_fields(field_key, label, table_name, column_name, owner_column, owner_kind, enabled, requestable, value_pattern, max_length, note, sort) values
 ('legal_name',     'Legal name',                'fan_profiles',                    'legal_name',        'user_id',       'user',  true,  true,  null, 160, null, 10),
 ('handle',         'Username (@handle)',        'platform_profiles',               'mccluster_id',      'user_id',       'user',  true,  true,  '^[a-z0-9][a-z0-9._-]{2,31}$', 32, null, 20),
 ('artist_name',    'Artist or business name',   'music_creator_profiles',          'artist_name',       'm_uid',         'm_uid', true,  true,  null, 160, null, 30),
 ('creator_handle', 'Creator page address',      'music_creator_profiles',          'handle',            'm_uid',         'm_uid', true,  true,  '^[a-z0-9][a-z0-9._-]{2,39}$', 40, null, 40),
 ('region',         'State or region',           'fan_profiles',                    'region',            'user_id',       'user',  true,  true,  null, 80, null, 50),
 ('country',        'Country',                   'fan_profiles',                    'country',           'user_id',       'user',  true,  true,  null, 80, null, 60),
 ('globe_region',   'Region on the globe',       'action_globe_member_regions',     'region_key',        'm_uid',         'm_uid', true,  true,  '^[A-Za-z0-9][A-Za-z0-9_-]{1,40}$', 41, null, 70),
 ('payout_account', 'Payout account',            'action_creator_connect_accounts', 'stripe_account_id', 'creator_m_uid', 'm_uid', true,  false, null, 80,
   'Changes only through payout setup with Stripe; the table is already server-only.', 80),
 ('display_name',   'Display name',              'network_profiles',                'display_name',      'm_uid',         'm_uid', false, true,  null, 120,
   'Listed but off: turn on (enabled = true) to lock the public display name too.', 90)
on conflict (field_key) do nothing;

alter table public.profile_protected_fields enable row level security;
revoke all on public.profile_protected_fields from public, anon, authenticated;
grant select on public.profile_protected_fields to anon, authenticated;
grant all on public.profile_protected_fields to service_role;
drop policy if exists "anyone reads the protected field list" on public.profile_protected_fields;
create policy "anyone reads the protected field list" on public.profile_protected_fields for select to anon, authenticated using (true);

create table if not exists public.profile_edit_settings (
 id boolean primary key default true check (id),
 require_persona boolean not null default true,
 updated_at timestamptz not null default now()
);
insert into public.profile_edit_settings(id, require_persona) values (true, true) on conflict (id) do nothing;
alter table public.profile_edit_settings enable row level security;
revoke all on public.profile_edit_settings from public, anon, authenticated;
grant select on public.profile_edit_settings to anon, authenticated;
grant all on public.profile_edit_settings to service_role;
drop policy if exists "anyone reads profile edit settings" on public.profile_edit_settings;
create policy "anyone reads profile edit settings" on public.profile_edit_settings for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. A NEW SUBMISSION LEVEL ON THE IDENTITY TABLES (no parallel tables)
-- ---------------------------------------------------------------------------
do $lv$
declare c record;
begin
 for c in select conname from pg_constraint where conrelid = 'public.identity_consent_versions'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) like '%level%v1_live_intro%v2_halo_full%' and pg_get_constraintdef(oid) not like '%profile_edit%' loop
   execute format('alter table public.identity_consent_versions drop constraint %I', c.conname);
 end loop;
 for c in select conname from pg_constraint where conrelid = 'public.identity_submissions'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) like '%level = ANY%v1_live_intro%v2_halo_full%' and pg_get_constraintdef(oid) not like '%profile_edit%' loop
   execute format('alter table public.identity_submissions drop constraint %I', c.conname);
 end loop;
 -- the Persona columns were V2-only; a profile edit uses the same ID check
 for c in select conname from pg_constraint where conrelid = 'public.identity_submissions'::regclass and contype = 'c'
   and pg_get_constraintdef(oid) like '%persona_inquiry_id IS NULL%persona_status IS NULL%' and conname <> 'identity_submissions_persona_levels_check' loop
   execute format('alter table public.identity_submissions drop constraint %I', c.conname);
 end loop;
end $lv$;
alter table public.identity_consent_versions drop constraint if exists identity_consent_versions_level_levels_check;
alter table public.identity_consent_versions add constraint identity_consent_versions_level_levels_check
 check (level in ('v1_live_intro','v2_halo_full','profile_edit'));
alter table public.identity_submissions drop constraint if exists identity_submissions_level_levels_check;
alter table public.identity_submissions add constraint identity_submissions_level_levels_check
 check (level in ('v1_live_intro','v2_halo_full','profile_edit'));
alter table public.identity_submissions drop constraint if exists identity_submissions_persona_levels_check;
alter table public.identity_submissions add constraint identity_submissions_persona_levels_check
 check (level in ('v2_halo_full','profile_edit') or (persona_inquiry_id is null and persona_status is null));
-- a profile edit always says why (kept in access_request, which the owner's queue already shows)
alter table public.identity_submissions drop constraint if exists identity_submissions_profile_edit_reason_check;
alter table public.identity_submissions add constraint identity_submissions_profile_edit_reason_check
 check (level <> 'profile_edit' or access_request is not null);

-- DRAFT consent (owner and counsel approve before it goes live; N is the owner's).
insert into public.identity_consent_versions(version, level, title, body) values
('profile-edit-2026-10-draft1', 'profile_edit', 'Changing a locked profile detail: what you are agreeing to',
$c$Before you record, please read this. You can stop at any time before you send.

What we record: a short live video from your camera and microphone, recorded on this page. You cannot upload a file. On screen we show you a short phrase; you say it out loud along with your first and last name, which details you want to change, and why. We also keep the name you type, the new values you ask for, the reason you give, the time you recorded and the phrase we showed you.

Government ID check: you also complete an identity check with Persona, an outside identity-verification company. Persona collects and holds your ID images and any selfie it asks for under its own privacy terms; we never receive or store your ID images. We receive the result (for example approved or declined) and a reference number.

Why: some details (such as your legal name, your username, your artist or business name and your region) lock once you set them, so nobody can take over or impersonate an account by changing them. A change needs a person to confirm it is really you asking.

Who sees it: Matthew McCluster (the owner) personally reviews it. The only other people who can see it are admins the owner names in writing for this job. It is never public.

How we review: a person watches your video. We review your submissions together, including comparing them with each other (for example with an earlier introduction video, if you made one) and with the ID check result, to confirm you are the same person. No computer program measures or matches your face.

What happens next: if the owner approves, the change is made for you and recorded (the old value, the new value, who approved it and when). If not, nothing changes and you are told why.

Not used for AI: your video is never used to train any AI or machine-learning model, and never sold.

How long we keep it: we delete the video [N] days after the owner's decision. The decision, its date, the reviewer's note and the record of what changed are kept for as long as your account exists.

Your choices: you can ask us to delete your videos at any time from the verification page or by writing to the owner. If you ask before a decision, your request is withdrawn and nothing changes. You can ask Persona to delete what it holds under its own terms.$c$)
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- 3. REQUESTS AND THE APPEND-ONLY AUDIT
-- ---------------------------------------------------------------------------
create table if not exists public.profile_edit_requests (
 id uuid primary key default gen_random_uuid(),
 submission_id uuid not null unique references public.identity_submissions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 m_uid uuid,
 -- {"field_key": "new value", ...}; validated against profile_protected_fields at start and again at apply
 changes jsonb not null check (jsonb_typeof(changes) = 'object' and changes <> '{}'::jsonb),
 reason text not null check (char_length(btrim(reason)) between 3 and 600),
 applying_at timestamptz,
 applied_at timestamptz,
 applied_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 check (applied_at is null or (applying_at is not null and applied_by is not null))
);
create index if not exists profile_edit_requests_user_idx on public.profile_edit_requests(user_id, created_at desc);

create table if not exists public.profile_edit_audit (
 id bigint generated always as identity primary key,
 request_id uuid references public.profile_edit_requests(id) on delete cascade,
 user_id uuid not null,
 field_key text not null,
 table_name text not null,
 column_name text not null,
 old_value text,
 new_value text,
 applied_by uuid,
 applied_at timestamptz not null default now()
);
create index if not exists profile_edit_audit_user_idx on public.profile_edit_audit(user_id, applied_at);
drop trigger if exists profile_edit_audit_immutable on public.profile_edit_audit;
create trigger profile_edit_audit_immutable before update or delete on public.profile_edit_audit
 for each row execute function public.identity_log_immutable();

alter table public.profile_edit_requests enable row level security;
alter table public.profile_edit_requests force row level security;
alter table public.profile_edit_audit enable row level security;
alter table public.profile_edit_audit force row level security;
revoke all on public.profile_edit_requests, public.profile_edit_audit from public, anon, authenticated;
grant all on public.profile_edit_requests, public.profile_edit_audit to service_role;
grant select on public.profile_edit_requests, public.profile_edit_audit to authenticated;
drop policy if exists "member or reviewer reads profile edit requests" on public.profile_edit_requests;
create policy "member or reviewer reads profile edit requests" on public.profile_edit_requests for select to authenticated
 using (user_id = (select auth.uid()) or (select public.identity_is_reviewer()));
drop policy if exists "member or reviewer reads profile edit audit" on public.profile_edit_audit;
create policy "member or reviewer reads profile edit audit" on public.profile_edit_audit for select to authenticated
 using (user_id = (select auth.uid()) or (select public.identity_is_reviewer()));

-- ---------------------------------------------------------------------------
-- 4. THE GUARD (server-side enforcement; the UI lock is only a courtesy)
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: current_user is 'authenticated' for a direct
-- PostgREST write, and the function owner inside a security-definer RPC; the
-- request's JWT role is 'authenticated' in both cases for a member.
create or replace function public.profile_edit_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
 v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
 v_member boolean := current_user::text = 'authenticated' or coalesce(v_claims->>'role', '') = 'authenticated';
 v_apply text := coalesce(current_setting('mcc.profile_edit_apply', true), '');
 v_old jsonb;
 v_new jsonb;
 f record;
begin
 if not v_member then return coalesce(new, old); end if;
 -- a cascade from erasing a whole account is not an edit
 if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
 v_old := to_jsonb(old);
 if tg_op = 'UPDATE' then v_new := to_jsonb(new); end if;
 for f in select p.field_key, p.column_name from public.profile_protected_fields p
   where p.enabled and p.table_name = tg_table_name order by p.sort loop
   -- not set yet: filling it in is onboarding, not an edit
   continue when nullif(btrim(coalesce(v_old->>f.column_name, '')), '') is null;
   continue when tg_op = 'UPDATE' and (v_new->>f.column_name) is not distinct from (v_old->>f.column_name);
   -- the approved request being applied by profile_edit_review_decide() in
   -- this transaction (never reachable from a member's own session: the
   -- setting is transaction-local and only that function sets it)
   if v_apply <> '' and current_user::text <> 'authenticated' then
     if exists (select 1 from public.profile_edit_requests r
                where r.id::text = v_apply and r.applying_at is not null and r.applied_at is null) then
       continue;
     end if;
   end if;
   raise exception 'profile_field_locked: % cannot be changed directly once it is set', f.field_key
     using errcode = '42501',
           hint = 'Ask for the change from your desk: a short live video and an ID check, reviewed by the owner.';
 end loop;
 return coalesce(new, old);
end;
$$;
revoke all on function public.profile_edit_guard() from public, anon, authenticated;

-- Attach the guard to every table on the list that exists here. Runs now and
-- again whenever the list changes, so the list is the whole configuration.
create or replace function public.profile_edit_attach_guards()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare t text; n integer := 0;
begin
 for t in select distinct table_name from public.profile_protected_fields loop
   if to_regclass('public.' || quote_ident(t)) is null then continue; end if;
   execute format('drop trigger if exists zz_profile_edit_guard on public.%I', t);
   execute format('create trigger zz_profile_edit_guard before update or delete on public.%I for each row execute function public.profile_edit_guard()', t);
   n := n + 1;
 end loop;
 return n;
end;
$$;
revoke all on function public.profile_edit_attach_guards() from public, anon, authenticated;
grant execute on function public.profile_edit_attach_guards() to service_role;

create or replace function public.profile_protected_fields_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 perform public.profile_edit_attach_guards();
 return null;
end;
$$;
revoke all on function public.profile_protected_fields_changed() from public, anon, authenticated;
drop trigger if exists profile_protected_fields_attach on public.profile_protected_fields;
create trigger profile_protected_fields_attach after insert or update of table_name on public.profile_protected_fields
 for each statement execute function public.profile_protected_fields_changed();

do $att$ begin perform public.profile_edit_attach_guards(); end $att$;

-- A profile edit is decided only by profile_edit_review_decide(): the V1/V2
-- decision function would otherwise write a verification row for it.
create or replace function public.identity_profile_edit_decision_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
 if new.level = 'profile_edit' and old.status = 'submitted' and new.status in ('approved','rejected','retake_requested')
    and coalesce(current_setting('mcc.profile_edit_decide', true), '') is distinct from new.id::text then
   raise exception 'profile edit requests are decided with profile_edit_review_decide()';
 end if;
 return new;
end;
$$;
revoke all on function public.identity_profile_edit_decision_guard() from public, anon, authenticated;
drop trigger if exists identity_profile_edit_decision_guard on public.identity_submissions;
create trigger identity_profile_edit_decision_guard before update on public.identity_submissions
 for each row execute function public.identity_profile_edit_decision_guard();

-- ---------------------------------------------------------------------------
-- 5. HELPERS
-- ---------------------------------------------------------------------------
-- The current value of one protected field for one person (text), or null.
create or replace function public.profile_edit_current_value(p_field_key text, p_user uuid, p_m_uid uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare f public.profile_protected_fields%rowtype; v text; v_owner uuid;
begin
 select * into f from public.profile_protected_fields where field_key = p_field_key;
 if not found or to_regclass('public.' || quote_ident(f.table_name)) is null then return null; end if;
 v_owner := case f.owner_kind when 'user' then p_user else p_m_uid end;
 if v_owner is null then return null; end if;
 execute format('select %I::text from public.%I where %I = $1 limit 1', f.column_name, f.table_name, f.owner_column) into v using v_owner;
 return v;
end;
$$;
revoke all on function public.profile_edit_current_value(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.profile_edit_current_value(text, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. MEMBER RPCs
-- ---------------------------------------------------------------------------
-- What is locked for me, the consent, my latest request.
create or replace function public.profile_edit_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_user uuid := (select auth.uid()); v_m uuid := public.current_m_uid(); v_fields jsonb; v_latest jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('key', f.field_key, 'label', f.label, 'requestable', f.requestable,
     'max_length', f.max_length, 'pattern', f.value_pattern, 'note', f.note,
     'value', case when v_user is null then null else public.profile_edit_current_value(f.field_key, v_user, v_m) end,
     'locked', v_user is not null and nullif(btrim(coalesce(public.profile_edit_current_value(f.field_key, v_user, v_m), '')), '') is not null)
   order by f.sort), '[]'::jsonb)
 into v_fields from public.profile_protected_fields f where f.enabled;
 if v_user is not null then
   select jsonb_build_object('request_id', r.id, 'submission_id', s.id, 'status', s.status, 'changes', r.changes, 'reason', r.reason,
       'created_at', s.created_at, 'submitted_at', s.submitted_at, 'decided_at', s.decided_at,
       'decision_note', case when s.status in ('rejected','retake_requested') then s.decision_note end,
       'persona_status', s.persona_status, 'persona_inquiry', s.persona_inquiry_id is not null, 'applied_at', r.applied_at)
   into v_latest
   from public.profile_edit_requests r join public.identity_submissions s on s.id = r.submission_id
   where r.user_id = v_user order by s.created_at desc limit 1;
 end if;
 return jsonb_build_object('signed_in', v_user is not null, 'fields', v_fields,
   'consent', (select jsonb_build_object('version', c.version, 'title', c.title, 'body', c.body, 'body_sha256', c.body_sha256,
       'retention_days', c.retention_days)
     from public.identity_consent_versions c where c.level = 'profile_edit' and c.status = 'active'),
   'latest', v_latest,
   'require_persona', coalesce((select require_persona from public.profile_edit_settings where id), true),
   'limits', jsonb_build_object('max_seconds', 120, 'min_seconds', 3, 'max_bytes', 52428800, 'challenge_minutes', 10));
end;
$$;
revoke all on function public.profile_edit_status() from public;
grant execute on function public.profile_edit_status() to anon, authenticated, service_role;

-- Ask to change locked fields: accept the active consent, name the changes
-- and the reason, get a fresh challenge and the one private upload path.
-- The video is then uploaded and finished exactly like a V1/V2
-- (identity_finish_submission), and the ID check uses the same Worker route.
create or replace function public.profile_edit_start(
 p_consent_version text,
 p_stated_name text,
 p_changes jsonb,
 p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_m uuid := public.current_m_uid();
 v_consent public.identity_consent_versions%rowtype;
 v_id uuid := gen_random_uuid();
 v_req uuid := gen_random_uuid();
 v_now timestamptz := now();
 v_phrase text;
 v_old record;
 k text;
 v text;
 f public.profile_protected_fields%rowtype;
 v_clean jsonb := '{}'::jsonb;
begin
 if v_user is null then raise exception 'sign in first'; end if;
 select * into v_consent from public.identity_consent_versions where level = 'profile_edit' and status = 'active';
 if not found then raise exception 'profile edit requests are not open yet: their consent has not been approved'; end if;
 if p_consent_version is null or p_consent_version <> v_consent.version then
   raise exception 'consent required: accept the current consent text (%) first', v_consent.version;
 end if;
 if char_length(btrim(coalesce(p_stated_name, ''))) < 2 then raise exception 'type your first and last name'; end if;
 if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'say why you want the change'; end if;
 if char_length(btrim(p_reason)) > 600 then raise exception 'keep the reason under 600 characters'; end if;
 if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then raise exception 'pick at least one detail to change'; end if;
 for k, v in select * from jsonb_each_text(p_changes) loop
   select * into f from public.profile_protected_fields where field_key = k and enabled;
   if not found then raise exception 'unknown or unlocked field: %', k; end if;
   if not f.requestable then raise exception '% changes only through its own setup, not by request', f.label; end if;
   v := btrim(coalesce(v, ''));
   if v = '' then raise exception 'type the new %', lower(f.label); end if;
   if char_length(v) > f.max_length then raise exception '% is too long (at most % characters)', f.label, f.max_length; end if;
   if f.value_pattern is not null and v !~ f.value_pattern then raise exception '% is not in the allowed format', f.label; end if;
   if nullif(btrim(coalesce(public.profile_edit_current_value(k, v_user, v_m), '')), '') is null then
     raise exception '% is not set yet: fill it in directly, no request needed', f.label;
   end if;
   if public.profile_edit_current_value(k, v_user, v_m) = v then raise exception '% already has that value', f.label; end if;
   v_clean := v_clean || jsonb_build_object(k, v);
 end loop;
 if exists (select 1 from public.identity_submissions s where s.user_id = v_user and s.level = 'profile_edit' and s.status = 'submitted') then
   raise exception 'your last profile edit request is still with the owner';
 end if;
 if (select count(*) from public.identity_submissions s where s.user_id = v_user and s.created_at > v_now - interval '24 hours') >= 6 then
   raise exception 'too many attempts today; try again tomorrow';
 end if;
 for v_old in select id from public.identity_submissions s where s.user_id = v_user and s.level = 'profile_edit' and s.status = 'awaiting_capture' loop
   update public.identity_submissions set status = 'expired', updated_at = v_now where id = v_old.id;
   perform public.identity_log(v_old.id, v_user, v_user, 'member', 'expire', 'awaiting_capture', 'expired', 'replaced by a new attempt');
 end loop;

 insert into public.identity_consent_acceptances(user_id, version, accepted_at) values (v_user, v_consent.version, v_now)
 on conflict (user_id, version) do update set accepted_at = excluded.accepted_at;
 v_phrase := public.identity_challenge_phrase();
 insert into public.identity_submissions(id, user_id, m_uid, level, consent_version, consent_accepted_at, stated_name, access_request,
   challenge_phrase, challenge_issued_at, challenge_expires_at, object_path)
 values (v_id, v_user, v_m, 'profile_edit', v_consent.version, v_now, btrim(p_stated_name), btrim(p_reason),
   v_phrase, v_now, v_now + interval '10 minutes', v_user::text || '/' || v_id::text);
 insert into public.profile_edit_requests(id, submission_id, user_id, m_uid, changes, reason)
 values (v_req, v_id, v_user, v_m, v_clean, btrim(p_reason));
 perform public.identity_log(v_id, v_user, v_user, 'member', 'consent_accepted', null, null, v_consent.version);
 perform public.identity_log(v_id, v_user, v_user, 'member', 'start', null, 'awaiting_capture', 'profile edit: ' || (select string_agg(x, ', ' order by x) from jsonb_object_keys(v_clean) x));
 return jsonb_build_object('request_id', v_req, 'submission_id', v_id, 'bucket', 'identity-verification-videos',
   'object_path', v_user::text || '/' || v_id::text, 'challenge_phrase', v_phrase,
   'challenge_expires_at', v_now + interval '10 minutes', 'max_seconds', 120, 'min_seconds', 3,
   'max_bytes', 52428800, 'mime', jsonb_build_array('video/webm','video/mp4'), 'changes', v_clean);
end;
$$;
revoke all on function public.profile_edit_start(text, text, jsonb, text) from public, anon;
grant execute on function public.profile_edit_start(text, text, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. REVIEWER RPCs
-- ---------------------------------------------------------------------------
-- The requested changes for every submitted profile edit, beside the current
-- values, keyed by submission id (the queue itself is identity_review_queue()).
create or replace function public.profile_edit_review_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
 if not (select public.identity_is_reviewer()) then raise exception 'not authorized'; end if;
 return coalesce((select jsonb_object_agg(s.id::text, jsonb_build_object(
     'request_id', r.id, 'reason', r.reason,
     'require_persona', coalesce((select require_persona from public.profile_edit_settings where id), true),
     'changes', (select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'label', coalesce(f.label, c.key),
         'current', public.profile_edit_current_value(c.key, r.user_id, r.m_uid), 'requested', c.value) order by f.sort), '[]'::jsonb)
       from jsonb_each_text(r.changes) c left join public.profile_protected_fields f on f.field_key = c.key)))
   from public.profile_edit_requests r join public.identity_submissions s on s.id = r.submission_id
   where s.status = 'submitted'), '{}'::jsonb);
end;
$$;
revoke all on function public.profile_edit_review_queue() from public, anon;
grant execute on function public.profile_edit_review_queue() to authenticated, service_role;

-- approve / reject / request_retake. Approve applies the requested values,
-- once, and writes one audit row per field. A reject or retake changes nothing.
create or replace function public.profile_edit_review_decide(p_submission_id uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_me uuid := (select auth.uid());
 s public.identity_submissions%rowtype;
 r public.profile_edit_requests%rowtype;
 f public.profile_protected_fields%rowtype;
 v_consent public.identity_consent_versions%rowtype;
 v_note text := nullif(btrim(coalesce(p_note, '')), '');
 v_to text;
 v_owner uuid;
 v_old text;
 v_applied jsonb := '[]'::jsonb;
 v_rows integer;
 k text;
 v text;
begin
 if not (select public.identity_is_reviewer()) then raise exception 'not authorized'; end if;
 if p_decision not in ('approve','reject','request_retake') then raise exception 'decision must be approve, reject or request_retake'; end if;
 select * into s from public.identity_submissions where id = p_submission_id for update;
 if not found or s.level <> 'profile_edit' then raise exception 'profile edit request not found'; end if;
 select * into r from public.profile_edit_requests where submission_id = s.id for update;
 if not found then raise exception 'profile edit request not found'; end if;
 if s.user_id = v_me then raise exception 'you cannot review your own request'; end if;
 if s.status <> 'submitted' then raise exception 'only a submitted request can be decided (this one is %)', s.status; end if;
 if r.applied_at is not null then raise exception 'this request was already applied'; end if;
 if p_decision <> 'approve' and v_note is null then raise exception 'a note to the person is required to reject or ask for a retake'; end if;
 if p_decision = 'approve' and s.video_deleted_at is not null then raise exception 'the video was deleted; ask for a retake'; end if;
 if p_decision = 'approve' and coalesce((select require_persona from public.profile_edit_settings where id), true)
    and coalesce(s.persona_status, '') <> 'approved' then
   raise exception 'the government-ID check is not approved yet (Persona status: %)', coalesce(s.persona_status, 'none');
 end if;

 select * into v_consent from public.identity_consent_versions where version = s.consent_version;
 v_to := case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'retake_requested' end;
 perform set_config('mcc.profile_edit_decide', s.id::text, true);
 update public.identity_submissions set status = v_to, decision = p_decision, decision_note = v_note, reviewer_id = v_me,
   decided_at = now(), delete_video_after = now() + make_interval(days => coalesce(v_consent.retention_days, 30)), updated_at = now()
 where id = s.id;
 perform set_config('mcc.profile_edit_decide', '', true);
 perform public.identity_log(s.id, s.user_id, v_me, 'reviewer', p_decision, 'submitted', v_to, v_note);

 if p_decision = 'approve' then
   update public.profile_edit_requests set applying_at = now() where id = r.id;
   perform set_config('mcc.profile_edit_apply', r.id::text, true);
   for k, v in select * from jsonb_each_text(r.changes) loop
     select * into f from public.profile_protected_fields where field_key = k;
     if not found or not f.requestable then raise exception '% can no longer be changed by request', k; end if;
     if to_regclass('public.' || quote_ident(f.table_name)) is null then raise exception 'the table for % is not here', k; end if;
     if f.value_pattern is not null and v !~ f.value_pattern then raise exception '% is not in the allowed format', f.label; end if;
     v_owner := case f.owner_kind when 'user' then r.user_id else r.m_uid end;
     if v_owner is null then raise exception 'no account id to change % on', f.label; end if;
     execute format('select %I::text from public.%I where %I = $1 limit 1 for update', f.column_name, f.table_name, f.owner_column)
       into v_old using v_owner;
     execute format('update public.%I set %I = $1 where %I = $2', f.table_name, f.column_name, f.owner_column) using v, v_owner;
     get diagnostics v_rows = row_count;
     if v_rows = 0 then raise exception 'nothing to change: % has no row for this person', f.label; end if;
     insert into public.profile_edit_audit(request_id, user_id, field_key, table_name, column_name, old_value, new_value, applied_by)
     values (r.id, r.user_id, k, f.table_name, f.column_name, v_old, v, v_me);
     v_applied := v_applied || jsonb_build_array(k);
   end loop;
   update public.profile_edit_requests set applied_at = now(), applied_by = v_me where id = r.id;
   perform set_config('mcc.profile_edit_apply', '', true);
 end if;

 if s.m_uid is not null then
   insert into public.network_notifications(recipient_m_uid, actor_m_uid, type, object_type, object_id, body, metadata)
   values (s.m_uid, null, 'profile_edit_review', 'profile_edit_request', r.id::text,
     case p_decision
       when 'approve' then 'Your profile change was approved and made.'
       when 'reject' then 'Your profile change was not approved: ' || v_note
       else 'Please record your profile change request again: ' || v_note end,
     jsonb_build_object('decision', p_decision, 'fields', (select jsonb_agg(x) from jsonb_object_keys(r.changes) x)));
 end if;
 return jsonb_build_object('submission_id', s.id, 'request_id', r.id, 'status', v_to, 'decision', p_decision, 'applied', v_applied);
end;
$$;
revoke all on function public.profile_edit_review_decide(uuid, text, text) from public, anon;
grant execute on function public.profile_edit_review_decide(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. PERSONA: the same inquiry flow for a profile edit
-- ---------------------------------------------------------------------------
-- Identical to the identity levels' function except the level check, which
-- now also accepts 'profile_edit'. If the identity file's version changes
-- before this is applied, merge (compare pg_get_functiondef first).
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
 if s.level not in ('v2_halo_full','profile_edit') then raise exception 'only a full-access or profile edit request uses the ID check'; end if;
 if s.status not in ('awaiting_capture','submitted') then raise exception 'this submission is %', s.status; end if;
 if s.persona_inquiry_id is not null then
   if s.persona_inquiry_id = p_inquiry_id then return jsonb_build_object('submission_id', s.id, 'idempotent', true); end if;
   raise exception 'an ID check is already linked to this submission';
 end if;
 update public.identity_submissions set persona_inquiry_id = p_inquiry_id, persona_status = coalesce(p_status, 'created'),
   persona_status_at = null, updated_at = now() where id = s.id;
 perform public.identity_log(s.id, s.user_id, null, 'service', 'persona_inquiry', s.status, s.status, p_inquiry_id);
 return jsonb_build_object('submission_id', s.id, 'persona_inquiry_id', p_inquiry_id);
end;
$$;
revoke all on function public.identity_record_persona_inquiry(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.identity_record_persona_inquiry(uuid, uuid, text, text) to service_role;
