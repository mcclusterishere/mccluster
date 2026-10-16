-- ROLLBACK for supabase/pending/20261016010000_profile_edit_gate_v1.sql
--
-- BEFORE running this: export what you need from profile_edit_audit (it is the
-- record of every approved change) and delete the stored profile-edit videos
-- through the Storage API (bucket identity-verification-videos, the object
-- paths of identity_submissions where level = 'profile_edit'). Dropping rows
-- does not delete objects in the bucket.
--
-- Applied profile changes are NOT undone: the values approved stay as they are
-- now. Leaves the identity verification levels exactly as their own file made
-- them (constraints and identity_record_persona_inquiry restored).

-- 1. the guards and the triggers that follow the list
do $rb$
declare t text;
begin
 if to_regclass('public.profile_protected_fields') is not null then
   for t in select distinct table_name from public.profile_protected_fields loop
     if to_regclass('public.' || quote_ident(t)) is not null then
       execute format('drop trigger if exists zz_profile_edit_guard on public.%I', t);
     end if;
   end loop;
 end if;
end $rb$;
drop trigger if exists identity_profile_edit_decision_guard on public.identity_submissions;

-- 2. functions
drop function if exists public.profile_edit_review_decide(uuid, text, text);
drop function if exists public.profile_edit_review_queue();
drop function if exists public.profile_edit_start(text, text, jsonb, text);
drop function if exists public.profile_edit_status();
drop function if exists public.profile_edit_current_value(text, uuid, uuid);
drop trigger if exists profile_protected_fields_attach on public.profile_protected_fields;
drop function if exists public.profile_protected_fields_changed();
drop function if exists public.profile_edit_attach_guards();
drop function if exists public.profile_edit_guard();
drop function if exists public.identity_profile_edit_decision_guard();

-- 3. the profile-edit rows on the shared identity tables (the review log rows
--    go with their submissions by cascade), then the tables of this file
drop table if exists public.profile_edit_audit;
drop table if exists public.profile_edit_requests;
delete from public.identity_submissions where level = 'profile_edit';
delete from public.identity_consent_acceptances a using public.identity_consent_versions c
 where c.version = a.version and c.level = 'profile_edit';
alter table public.identity_consent_versions disable trigger identity_consent_versions_freeze;
delete from public.identity_consent_versions where level = 'profile_edit';
alter table public.identity_consent_versions enable trigger identity_consent_versions_freeze;
drop table if exists public.profile_edit_settings;
drop table if exists public.profile_protected_fields;

-- 4. constraints back to the identity levels' own
alter table public.identity_submissions drop constraint if exists identity_submissions_profile_edit_reason_check;
alter table public.identity_submissions drop constraint if exists identity_submissions_persona_levels_check;
alter table public.identity_submissions add constraint identity_submissions_persona_levels_check
 check (level = 'v2_halo_full' or (persona_inquiry_id is null and persona_status is null));
alter table public.identity_submissions drop constraint if exists identity_submissions_level_levels_check;
alter table public.identity_submissions add constraint identity_submissions_level_levels_check
 check (level in ('v1_live_intro','v2_halo_full'));
alter table public.identity_consent_versions drop constraint if exists identity_consent_versions_level_levels_check;
alter table public.identity_consent_versions add constraint identity_consent_versions_level_levels_check
 check (level in ('v1_live_intro','v2_halo_full'));

-- 5. the Persona inquiry function exactly as the identity levels file defines it
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
