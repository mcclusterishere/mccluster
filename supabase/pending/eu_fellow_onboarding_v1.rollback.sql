-- Rollback for eu_fellow_onboarding_v1.sql. Removes the onboarding tables and
-- functions and the 2026 cohort row IF nobody has been seated in it. A seated
-- roster is real membership: this refuses rather than delete it.
do $$ begin
 if exists (select 1 from public.action_cohort_members where cohort_id = 'a8813ab5-f066-47c2-976c-c19581b3cb71') then
  raise exception 'the 2026 cohort has seated fellows; roll back by hand after the owner decides';
 end if;
end $$;
drop function if exists public.eu_fellow_desk(uuid);
drop function if exists public.eu_fellow_set_requests_open(uuid, boolean);
drop function if exists public.eu_fellow_revoke_invite(text);
drop function if exists public.eu_fellow_issue_invite(uuid, text, integer);
drop function if exists public.eu_fellow_review(uuid, text, text);
drop function if exists public.eu_fellow_onboarding_step(text, text);
drop function if exists public.eu_fellow_withdraw();
drop function if exists public.eu_fellow_accept_invite(text, text, text, text, text[]);
drop function if exists public.eu_fellow_apply(uuid, text, text, text, text[]);
drop function if exists public.eu_fellow_invite_preview(text);
drop function if exists public.eu_fellow_status();
drop function if exists public.eu_fellow_cohort_json(uuid);
drop function if exists public.eu_fellow_enrollment_json(public.eu_fellow_enrollments);
drop function if exists public.eu_fellow_clean_links(text[]);
drop function if exists public.eu_fellow_token_hash(text);
drop table if exists public.eu_fellow_invites;
drop table if exists public.eu_fellow_enrollments;
drop table if exists public.eu_fellow_cohorts;
delete from public.action_cohorts where id = 'a8813ab5-f066-47c2-976c-c19581b3cb71';
