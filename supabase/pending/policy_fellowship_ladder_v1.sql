-- POLICY FELLOWSHIP LADDER v1 (PENDING: not applied in production).
--
-- Owner direction, 2026-10-15: a member starts with three starter missions
-- (help a person, write a song, attend a rally), then can join the cohort
-- that writes policy memorandums for STATE-level officials. Fellows write a
-- memo and submit it up the line; the owner approves, passes (declines),
-- asks for changes, or edits it and tells the fellow what changed.
--
-- What this adds, and only this (everything else is reused):
--   1. action_ladder_starter_kinds / action_ladder_mission_kinds /
--      action_unlock_rules: the ladder, and every other unlock, as DATA. A starter kind is complete
--      when a mission mapped to it has a VERIFIED assignment (the proof was
--      reviewed and approved by review_action_proof: the same "completed a
--      mission" definition the World's CCTV gate uses). The rule says which
--      kinds, how many (null = all), and whether a creator account excludes
--      a member (default false: roles are capabilities, not tracks).
--   2. action_cohorts gains program / region_key / parent_cohort_id, so a
--      state Policy Fellowship cohort and its policy teams are ordinary
--      cohorts admitted by the existing admit_fellow_to_cohort(), which now
--      also checks the ladder rule for policy cohorts.
--   3. action_policy_memos (working draft + status), immutable
--      action_policy_memo_versions (every submission and every owner edit,
--      with a line diff against its parent and a sha256), immutable
--      action_policy_memo_reviews (the audit log of every transition), and
--      action_policy_memo_research_items (a per-memo research collection of
--      LEADS with provenance; never verified evidence; a thin link to the
--      canon's intel_evidence / ops_ingest_records ids, pending its apply, see
--      docs/control-plane/POLICY-FELLOWSHIP-LADDER.md).
--   1b. action_member_verifications: STATUS-ONLY strict verification for
--      referral signups (vendor reference, consent and attestation dates; never
--      images or biometric templates), and the generic evaluator
--      action_unlock_progress() / action_unlock_status(). The Equity Uprise
--      activation rule ships DISABLED and needs counsel sign-off before it
--      can be enabled (CHECK). The Whip Equipped rule is open to every
--      signed-in member (owner, 2026-10-15: no voter rule, quick sign-up).
--   4. RPCs: action_unlock_status, policy_ladder_status, create_policy_memo, save_policy_memo_draft,
--      submit_policy_memo, withdraw_policy_memo, review_policy_memo,
--      policy_memo_history, add/remove_policy_memo_research_item.
--
-- Access: a fellow reads only their own memos, versions, reviews and
-- research; the desk (eu_is_admin) reads all; anon reads nothing here.
-- Nobody writes these tables directly: every write is a security definer
-- function that decides who you are and what state the memo is in.
--
-- Seeds: three starter kinds, one rule (all three kinds), and ONE mission
-- mapping that already exists in production ("Help someone reach a real
-- service" -> help_person). No mission exists yet for write_song or
-- attend_rally: the owner creates and maps those (see the doc). No
-- politicians, memos or people are seeded.
--
-- ROLLBACK (run as the service role, in this order; export memos first):
--   1. drop table if exists public.action_policy_memo_research_items, public.action_policy_memo_reviews,
--        public.action_policy_memo_versions, public.action_policy_memos cascade;
--   2. drop function if exists public.policy_ladder_status(), public.policy_ladder_eligible(uuid),
--        public.action_unlock_status(), public.action_unlock_progress(uuid,text),
--        public.create_policy_memo(uuid,text,text,uuid,uuid), public.save_policy_memo_draft(uuid,text,text),
--        public.submit_policy_memo(uuid,text), public.withdraw_policy_memo(uuid,text),
--        public.review_policy_memo(uuid,text,text,text,text), public.policy_memo_history(uuid),
--        public.add_policy_memo_research_item(uuid,text,text,text,text,text,text,timestamptz,text,text,text),
--        public.remove_policy_memo_research_item(uuid), public.action_policy_memo_next_status(text,text,text),
--        public.action_policy_memo_line_diff(text,text), public.action_policy_memo_immutable();
--      (action_policy_memo_write_version goes with the memos table in step 1, via cascade.)
--   3. re-run supabase/migrations/20261005054040_action_cohort_admission_v1.sql to restore
--      admit_fellow_to_cohort() without the ladder check.
--   4. drop table if exists public.action_member_verifications, public.action_unlock_rules, public.action_ladder_mission_kinds,
--        public.action_ladder_starter_kinds;
--   5. alter table public.action_cohorts drop constraint if exists action_cohorts_policy_region_check,
--        drop column if exists parent_cohort_id, drop column if exists region_key, drop column if exists program;
-- Dropping the memo tables destroys fellows' memos: export them first.

-- ---------------------------------------------------------------------------
-- 1. THE LADDER AS DATA
-- ---------------------------------------------------------------------------
create table if not exists public.action_ladder_starter_kinds (
 kind text primary key check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
 label text not null check (char_length(label) between 1 and 80),
 description text not null default '',
 sort smallint not null default 0
);

create table if not exists public.action_ladder_mission_kinds (
 mission_id uuid primary key references public.action_missions(id) on delete cascade,
 kind text not null references public.action_ladder_starter_kinds(kind) on update cascade,
 mapped_at timestamptz not null default now(),
 mapped_by uuid
);
create index if not exists action_ladder_mission_kinds_kind_idx on public.action_ladder_mission_kinds(kind);

-- EVERY UNLOCK IS A ROW (owner, 2026-10-15). One table says what each
-- level unlocks and what it takes: the free public layer, the member layers,
-- the policy fellowship, Equity Uprise activation, the Whip Equipped
-- hand-off. A rule that needs counsel cannot be enabled until
-- counsel has signed off (CHECK below). A disabled rule is never met.
create table if not exists public.action_unlock_rules (
 rule_key text primary key check (rule_key ~ '^[a-z][a-z0-9_]{1,60}$'),
 label text not null,
 -- what it unlocks, e.g. 'globe_layer:flights', 'cohort_program:policy_fellowship',
 -- 'program:equity_uprise_activation', 'partner_eligibility:whip_driver_application'
 unlock_keys text[] not null check (cardinality(unlock_keys) between 1 and 12),
 requirement_kind text not null check (requirement_kind in
   ('none','signed_in','creator_account','fellow','starter_kinds','verified_referrals')),
 -- starter_kinds: which kinds count
 required_kinds text[] check (required_kinds is null or cardinality(required_kinds) between 1 and 12),
 -- starter_kinds: null = every required kind, n = any n of them;
 -- verified_referrals: how many
 min_count integer check (min_count is null or min_count >= 1),
 params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
 -- OPEN QUESTION for the owner. false = a creator/business account does not
 -- stop anyone from meeting this rule.
 creator_exclusive boolean not null default false,
 enabled boolean not null default true,
 requires_counsel_signoff boolean not null default false,
 counsel_signoff_at timestamptz,
 counsel_signoff_ref text,
 updated_at timestamptz not null default now(),
 check (requirement_kind <> 'starter_kinds' or required_kinds is not null),
 check (requirement_kind <> 'starter_kinds' or min_count is null or min_count <= cardinality(required_kinds)),
 check (requirement_kind <> 'verified_referrals' or min_count is not null),
 check (not enabled or not requires_counsel_signoff or counsel_signoff_at is not null)
);

insert into public.action_ladder_starter_kinds(kind, label, description, sort) values
 ('help_person', 'Help a person', 'Directly help one person, with proof a reviewer can check.', 1),
 ('write_song', 'Write a song', 'Write and share an original song.', 2),
 ('attend_rally', 'Go to a rally', 'Attend a lawful public rally or gathering, with proof you were there.', 3)
on conflict (kind) do nothing;

insert into public.action_unlock_rules(rule_key, label, unlock_keys, requirement_kind, required_kinds, min_count, params, creator_exclusive, enabled, requires_counsel_signoff) values
 -- what the World already does (workers/mccluster/src/world-layers.js): flights are public,
 -- satellites and launches are for signed-in members. The Worker still enforces these
 -- in code; reading them from here is a follow-up.
 ('public_free_layer', 'Public: the globe and one free layer', array['globe_layer:flights'], 'none', null, null, '{}', false, true, false),
 ('member_layers', 'Signed in: member layers', array['globe_layer:satellites','globe_layer:launches'], 'signed_in', null, null, '{}', false, true, false),
 -- the ladder: three starter missions open the state Policy Fellowship seat
 ('policy_fellowship', 'Policy Fellowship: starter missions', array['cohort_program:policy_fellowship'], 'starter_kinds',
   array['help_person','write_song','attend_rally'], null, '{}', false, true, false),
 -- Equity Uprise activation: three VERIFIED joins through my referral link. Disabled until the
 -- identity vendor is chosen and counsel approves the biometric consent and retention schedule.
 ('equity_uprise_activation', 'Equity Uprise activation: three verified referrals', array['program:equity_uprise_activation'], 'verified_referrals',
   null, 3, '{"shares_required": null, "note": "shares requirement is an open owner question"}', false, false, true),
 -- Whip Equipped (Matthew's separate company, Whip Equipped LLC): the transport layer and the
 -- hand-off to Whip's own driver sign-up, for any signed-in member (owner, 2026-10-15). Rides are
 -- not live; Whip's own checks (license, insurance, background check) decide who drives.
 ('whip_transport_partner', 'Whip Equipped transport: sign-up hand-off', array['globe_layer:whip_transport','partner_eligibility:whip_driver_application'], 'signed_in',
   null, null, '{}', false, true, false)
on conflict (rule_key) do nothing;

-- The only starter mission that exists today. Skipped if it is absent.
insert into public.action_ladder_mission_kinds(mission_id, kind)
select m.id, 'help_person' from public.action_missions m
where m.id = '51000000-0000-4000-8000-000000000003'::uuid
on conflict (mission_id) do nothing;

alter table public.action_ladder_starter_kinds enable row level security;
alter table public.action_ladder_mission_kinds enable row level security;
alter table public.action_unlock_rules enable row level security;
revoke all on public.action_ladder_starter_kinds, public.action_ladder_mission_kinds, public.action_unlock_rules from public, anon, authenticated;
grant all on public.action_ladder_starter_kinds, public.action_ladder_mission_kinds, public.action_unlock_rules to service_role;
-- The ladder is public by design: it tells anyone what the next step is.
grant select on public.action_ladder_starter_kinds, public.action_ladder_mission_kinds, public.action_unlock_rules to anon, authenticated;
grant insert, update, delete on public.action_ladder_starter_kinds, public.action_ladder_mission_kinds, public.action_unlock_rules to authenticated; -- desk only, by policy
drop policy if exists "public reads ladder kinds" on public.action_ladder_starter_kinds;
create policy "public reads ladder kinds" on public.action_ladder_starter_kinds for select to anon, authenticated using (true);
drop policy if exists "public reads ladder mission kinds" on public.action_ladder_mission_kinds;
create policy "public reads ladder mission kinds" on public.action_ladder_mission_kinds for select to anon, authenticated using (true);
drop policy if exists "public reads unlock rules" on public.action_unlock_rules;
create policy "public reads unlock rules" on public.action_unlock_rules for select to anon, authenticated using (true);
drop policy if exists "desk manages ladder kinds" on public.action_ladder_starter_kinds;
create policy "desk manages ladder kinds" on public.action_ladder_starter_kinds for all to authenticated using ((select public.eu_is_admin())) with check ((select public.eu_is_admin()));
drop policy if exists "desk manages ladder mission kinds" on public.action_ladder_mission_kinds;
create policy "desk manages ladder mission kinds" on public.action_ladder_mission_kinds for all to authenticated using ((select public.eu_is_admin())) with check ((select public.eu_is_admin()));
drop policy if exists "desk manages unlock rules" on public.action_unlock_rules;
create policy "desk manages unlock rules" on public.action_unlock_rules for all to authenticated using ((select public.eu_is_admin())) with check ((select public.eu_is_admin()));

-- ---------------------------------------------------------------------------
-- 2. STATE COHORTS AND POLICY TEAMS ARE COHORTS
-- ---------------------------------------------------------------------------
alter table public.action_cohorts
 add column if not exists program text check (program in ('policy_fellowship','policy_team')),
 add column if not exists region_key text references public.action_globe_regions(region_key),
 add column if not exists parent_cohort_id uuid references public.action_cohorts(id) on delete set null;
do $c$ begin
 alter table public.action_cohorts add constraint action_cohorts_policy_region_check
  check (program is distinct from 'policy_fellowship' or region_key is not null);
exception when duplicate_object then null; end $c$;
create index if not exists action_cohorts_program_region_idx on public.action_cohorts(program, region_key) where program is not null;

-- Is this user eligible under the active policy_fellowship rule?
create or replace function public.policy_ladder_eligible(p_user uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
 if p_user is null then return false; end if;
 return coalesce((public.action_unlock_progress(p_user, 'policy_fellowship')->>'met')::boolean, false);
end;
$$;
revoke all on function public.policy_ladder_eligible(uuid) from public, anon, authenticated;
grant execute on function public.policy_ladder_eligible(uuid) to service_role;

-- Strict verification for people who join through a referral link (owner,
-- 2026-10-15): location consent at signup, identity/face verification by a
-- THIRD-PARTY vendor, a signed consent/attestation. STATUS ONLY: this table
-- never holds a face image, a biometric template, an ID document, a document
-- number or a date of birth. The vendor holds those under its own retention;
-- we keep the vendor's reference and the dates. Written only by the server
-- (the vendor webhook, service role); a member reads their own row.
create table if not exists public.action_member_verifications (
 user_id uuid primary key references auth.users(id) on delete cascade,
 purpose text not null default 'referral_signup' check (purpose in ('referral_signup')),
 status text not null default 'pending' check (status in ('pending','verified','rejected','revoked','expired')),
 provider text check (provider is null or provider ~ '^[a-z][a-z0-9_]{1,40}$'),
 provider_reference text check (provider_reference is null or char_length(provider_reference) <= 200),
 location_consent_at timestamptz,
 location_precision text check (location_precision in ('region','precise')),
 attestation_version text,
 attestation_signed_at timestamptz,
 biometric_consent_version text,
 biometric_consent_at timestamptz,
 verified_at timestamptz,
 expires_at timestamptz,
 -- when the vendor must have deleted its biometric data (retention schedule; counsel sets it)
 vendor_data_delete_by timestamptz,
 updated_at timestamptz not null default now(),
 check (status <> 'verified' or (provider is not null and provider_reference is not null and verified_at is not null
   and location_consent_at is not null and attestation_signed_at is not null and biometric_consent_at is not null))
);
alter table public.action_member_verifications enable row level security;
alter table public.action_member_verifications force row level security;
revoke all on public.action_member_verifications from public, anon, authenticated;
grant all on public.action_member_verifications to service_role;
grant select on public.action_member_verifications to authenticated;
drop policy if exists "members read own verification" on public.action_member_verifications;
create policy "members read own verification" on public.action_member_verifications for select to authenticated
 using (user_id = (select auth.uid()) or (select public.eu_is_admin()));

-- How far is this user on one rule? {met, have, need, reason}. A disabled
-- rule is never met; neither is a rule awaiting counsel.
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
   -- distinct people who joined through one of MY referral codes and passed strict verification
   select count(distinct p.user_id) into v_have
   from public.action_participants p
   join public.action_member_verifications v on v.user_id = p.user_id
   where p.referred_by in (select mine.referral_code from public.action_participants mine where mine.user_id = p_user)
     and p.user_id <> p_user
     and v.status = 'verified' and (v.expires_at is null or v.expires_at > now());
   v_met := v_have >= v_need;
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

-- Everything the World can unlock, and where I stand on each. Anyone may
-- ask; a signed-out caller gets only the public answers.
create or replace function public.action_unlock_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
 select coalesce(jsonb_agg(jsonb_build_object(
   'rule_key', r.rule_key, 'label', r.label, 'unlock_keys', to_jsonb(r.unlock_keys),
   'requirement_kind', r.requirement_kind, 'enabled', r.enabled,
   'requires_counsel_signoff', r.requires_counsel_signoff and r.counsel_signoff_at is null)
   || public.action_unlock_progress((select auth.uid()), r.rule_key) order by r.rule_key), '[]'::jsonb)
 from public.action_unlock_rules r
$$;
revoke all on function public.action_unlock_status() from public;
grant execute on function public.action_unlock_status() to anon, authenticated, service_role;

-- admit_fellow_to_cohort, as applied (20261005054040), plus: a policy cohort
-- seat needs the ladder, and a policy team seat needs a seat in its parent.
create or replace function public.admit_fellow_to_cohort(
 p_application_id uuid,
 p_cohort_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_app public.action_fellowship_applications%rowtype;
 v_cohort public.action_cohorts%rowtype;
 v_added boolean;
begin
 if (select auth.uid()) is null or not (select public.eu_is_admin()) then raise exception 'not authorized'; end if;
 select * into v_app from public.action_fellowship_applications where id = p_application_id;
 if not found then raise exception 'application not found'; end if;
 if v_app.status <> 'accepted' then raise exception 'only an accepted fellow can be admitted to a cohort'; end if;
 if v_app.user_id = (select auth.uid()) then raise exception 'you cannot admit yourself'; end if;
 select * into v_cohort from public.action_cohorts where id = p_cohort_id;
 if not found then raise exception 'cohort not found'; end if;
 if v_cohort.status <> 'active' then raise exception 'that cohort is not admitting (it is %)', v_cohort.status; end if;
 if v_cohort.program = 'policy_fellowship' and not public.policy_ladder_eligible(v_app.user_id) then
   raise exception 'this fellow has not completed the starter missions for the policy fellowship';
 end if;
 if v_cohort.program = 'policy_team' and v_cohort.parent_cohort_id is not null and not exists (
   select 1 from public.action_cohort_members cm where cm.cohort_id = v_cohort.parent_cohort_id and cm.m_uid = v_app.m_uid
 ) then
   raise exception 'a policy team seat needs a seat in its state cohort first';
 end if;

 insert into public.action_cohort_members(cohort_id, m_uid)
 values (v_cohort.id, v_app.m_uid)
 on conflict (cohort_id, m_uid) do nothing;
 v_added := found;

 return jsonb_build_object('cohort_id', v_cohort.id, 'cohort', v_cohort.name,
   'application_id', v_app.id, 'admitted', true, 'idempotent', not v_added);
end;
$$;
revoke all on function public.admit_fellow_to_cohort(uuid, uuid) from public, anon;
grant execute on function public.admit_fellow_to_cohort(uuid, uuid) to authenticated, service_role;

-- What is my next step? Missions done/remaining, eligibility, seats.
create or replace function public.policy_ladder_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_m_uid uuid := public.current_m_uid();
 v_rule public.action_unlock_rules%rowtype;
 v_steps jsonb;
 v_done integer;
 v_need integer;
 v_eligible boolean;
 v_app jsonb;
 v_seats jsonb;
 v_next text;
begin
 select * into v_rule from public.action_unlock_rules where rule_key = 'policy_fellowship' and enabled;
 if not found then
   return jsonb_build_object('signed_in', v_user is not null, 'rule', null, 'eligible', false, 'next_step', 'ladder_closed');
 end if;
 v_need := coalesce(v_rule.min_count, cardinality(v_rule.required_kinds));
 select coalesce(jsonb_agg(jsonb_build_object(
   'kind', k.kind, 'label', k.label, 'description', k.description,
   'done', v_user is not null and exists (
     select 1 from public.action_mission_assignments a
     join public.action_ladder_mission_kinds mk on mk.mission_id = a.mission_id
     where a.user_id = v_user and a.status = 'verified' and mk.kind = k.kind),
   'missions', coalesce((
     select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title,
       'my_status', (select a.status from public.action_mission_assignments a where a.mission_id = m.id and a.user_id = v_user))
       order by m.title)
     from public.action_ladder_mission_kinds mk join public.action_missions m on m.id = mk.mission_id
     where mk.kind = k.kind and m.status = 'open'), '[]'::jsonb)
 ) order by k.sort, k.kind), '[]'::jsonb)
 into v_steps
 from public.action_ladder_starter_kinds k where k.kind = any(v_rule.required_kinds);

 if v_user is null then
   return jsonb_build_object('signed_in', false,
     'rule', jsonb_build_object('key', v_rule.rule_key, 'label', v_rule.label, 'required_kinds', to_jsonb(v_rule.required_kinds), 'min_count', v_rule.min_count, 'creator_exclusive', v_rule.creator_exclusive),
     'steps', v_steps, 'completed', 0, 'needed', v_need, 'eligible', false, 'next_step', 'sign_in');
 end if;

 select count(*) into v_done from jsonb_array_elements(v_steps) s where (s->>'done')::boolean;
 v_eligible := public.policy_ladder_eligible(v_user);
 select to_jsonb(x) into v_app from (
   select f.id, f.status, f.review_note, f.created_at, f.reviewed_at
   from public.action_fellowship_applications f where f.user_id = v_user
   order by f.created_at desc limit 1) x;
 select coalesce(jsonb_agg(jsonb_build_object('cohort_id', c.id, 'name', c.name, 'program', c.program,
   'region_key', c.region_key, 'parent_cohort_id', c.parent_cohort_id) order by c.created_at), '[]'::jsonb)
 into v_seats
 from public.action_cohort_members cm join public.action_cohorts c on c.id = cm.cohort_id
 where cm.m_uid = v_m_uid and c.program is not null and c.status = 'active';

 v_next := case
   when jsonb_array_length(v_seats) > 0 then 'write_memo'
   when not v_eligible then 'complete_starter_missions'
   when v_app->>'status' = 'accepted' then 'await_policy_cohort_seat'
   when v_app->>'status' = 'submitted' then 'await_fellowship_review'
   else 'apply_for_fellowship' end;

 return jsonb_build_object('signed_in', true,
   'rule', jsonb_build_object('key', v_rule.rule_key, 'label', v_rule.label, 'required_kinds', to_jsonb(v_rule.required_kinds), 'min_count', v_rule.min_count, 'creator_exclusive', v_rule.creator_exclusive),
   'steps', v_steps, 'completed', v_done, 'needed', v_need, 'eligible', v_eligible,
   'fellowship_application', v_app, 'policy_seats', v_seats, 'next_step', v_next);
end;
$$;
revoke all on function public.policy_ladder_status() from public;
grant execute on function public.policy_ladder_status() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. MEMOS, IMMUTABLE VERSIONS, THE REVIEW LOG, THE RESEARCH COLLECTION
-- ---------------------------------------------------------------------------
create table if not exists public.action_policy_memos (
 id uuid primary key default gen_random_uuid(),
 author_uid uuid not null references auth.users(id) on delete cascade,
 author_m_uid uuid not null references public.m_people(id) on delete cascade,
 cohort_id uuid not null references public.action_cohorts(id),
 region_key text references public.action_globe_regions(region_key),
 official_profile_id uuid references public.action_policy_official_profiles(id),
 bill_id uuid references public.action_policy_bills(id),
 status text not null default 'draft' check (status in ('draft','submitted','in_review','approved','declined','changes_requested','owner_edited','withdrawn')),
 draft_title text not null check (char_length(draft_title) between 3 and 200),
 draft_body text not null default '' check (char_length(draft_body) <= 60000),
 current_version_id uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 submitted_at timestamptz,
 decided_at timestamptz
);
create index if not exists action_policy_memos_author_idx on public.action_policy_memos(author_uid, updated_at desc);
create index if not exists action_policy_memos_queue_idx on public.action_policy_memos(status, submitted_at);
create index if not exists action_policy_memos_cohort_idx on public.action_policy_memos(cohort_id);

create table if not exists public.action_policy_memo_versions (
 id uuid primary key default gen_random_uuid(),
 memo_id uuid not null references public.action_policy_memos(id) on delete cascade,
 version_no integer not null check (version_no >= 1),
 author_role text not null check (author_role in ('fellow','owner')),
 author_uid uuid not null,
 title text not null,
 body text not null check (char_length(body) between 1 and 60000),
 body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
 parent_version_id uuid references public.action_policy_memo_versions(id),
 diff_from_parent jsonb,
 note text,
 created_at timestamptz not null default now(),
 unique (memo_id, version_no),
 check (author_role <> 'owner' or (parent_version_id is not null and diff_from_parent is not null and char_length(btrim(coalesce(note,''))) >= 3))
);
alter table public.action_policy_memos drop constraint if exists action_policy_memos_current_version_fk;
alter table public.action_policy_memos add constraint action_policy_memos_current_version_fk
 foreign key (current_version_id) references public.action_policy_memo_versions(id) deferrable initially deferred;

create table if not exists public.action_policy_memo_reviews (
 id uuid primary key default gen_random_uuid(),
 memo_id uuid not null references public.action_policy_memos(id) on delete cascade,
 actor_uid uuid not null,
 actor_role text not null check (actor_role in ('fellow','owner')),
 action text not null check (action in ('submit','resubmit','withdraw','start_review','approve','decline','request_changes','owner_edit')),
 from_status text not null,
 to_status text not null,
 version_id uuid references public.action_policy_memo_versions(id) on delete cascade,
 note text,
 created_at timestamptz not null default now()
);
create index if not exists action_policy_memo_reviews_memo_idx on public.action_policy_memo_reviews(memo_id, created_at);
create index if not exists action_policy_memo_versions_memo_idx on public.action_policy_memo_versions(memo_id, version_no);

create table if not exists public.action_policy_memo_research_items (
 id uuid primary key default gen_random_uuid(),
 memo_id uuid not null references public.action_policy_memos(id) on delete cascade,
 added_by uuid not null,
 kind text not null check (kind in ('news','scholarly','public_data','legislation','halo_intel','manual_citation')),
 provider text not null check (provider in ('openalex','crossref','semantic_scholar','core','arxiv','pubmed','gdelt','openstates','legiscan','congress_gov','official','halo','manual')),
 provider_id text check (provider_id is null or char_length(provider_id) <= 300),
 title text not null check (char_length(title) between 1 and 500),
 url text check (url is null or (url ~* '^https://' and char_length(url) <= 2000)),
 publisher text check (publisher is null or char_length(publisher) <= 300),
 retrieved_at timestamptz,
 license_note text check (license_note is null or char_length(license_note) <= 500),
 content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
 note text check (note is null or char_length(note) <= 2000),
 -- A search result is a LEAD, never verified evidence. Only the canonical
 -- evidence/claim review can verify; this column widens when that lands.
 evidence_status text not null default 'unverified_lead' check (evidence_status in ('unverified_lead')),
 -- PENDING RECONCILIATION with the evidence canon (PR #438,
 -- supabase/pending/20261015210000_intel_mission_canon_v1.sql, also unapplied):
 -- canon_evidence_id -> intel_evidence.id, canon_source_record_id ->
 -- ops_ingest_records.id. Verification lives ONLY on the canon row
 -- (intel_evidence.review_status); this table never copies it. No FK until
 -- the canon is applied: the follow-up adds (id, org_id) FKs with the
 -- fellowship's org id. Purpose on the canon side: public_interest_research.
 canon_evidence_id uuid,
 canon_source_record_id uuid,
 created_at timestamptz not null default now(),
 check (provider = 'manual' or url is not null),
 check (provider = 'manual' or retrieved_at is not null)
);
create index if not exists action_policy_memo_research_memo_idx on public.action_policy_memo_research_items(memo_id, created_at);
create unique index if not exists action_policy_memo_research_one_url on public.action_policy_memo_research_items(memo_id, lower(url)) where url is not null;

-- Versions and reviews never change. A delete is allowed only as a cascade
-- from deleting the memo itself (service role, erasure path).
create or replace function public.action_policy_memo_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
 raise exception '% rows are immutable', tg_table_name;
end;
$$;
revoke all on function public.action_policy_memo_immutable() from public, anon, authenticated;
drop trigger if exists action_policy_memo_versions_immutable on public.action_policy_memo_versions;
create trigger action_policy_memo_versions_immutable before update or delete on public.action_policy_memo_versions
 for each row execute function public.action_policy_memo_immutable();
drop trigger if exists action_policy_memo_reviews_immutable on public.action_policy_memo_reviews;
create trigger action_policy_memo_reviews_immutable before update or delete on public.action_policy_memo_reviews
 for each row execute function public.action_policy_memo_immutable();

alter table public.action_policy_memos enable row level security;
alter table public.action_policy_memo_versions enable row level security;
alter table public.action_policy_memo_reviews enable row level security;
alter table public.action_policy_memo_research_items enable row level security;
revoke all on public.action_policy_memos, public.action_policy_memo_versions, public.action_policy_memo_reviews, public.action_policy_memo_research_items from public, anon, authenticated;
grant all on public.action_policy_memos, public.action_policy_memo_versions, public.action_policy_memo_reviews, public.action_policy_memo_research_items to service_role;
grant select on public.action_policy_memos, public.action_policy_memo_versions, public.action_policy_memo_reviews, public.action_policy_memo_research_items to authenticated;
drop policy if exists "fellow reads own memos" on public.action_policy_memos;
create policy "fellow reads own memos" on public.action_policy_memos for select to authenticated
 using (author_uid = (select auth.uid()) or (select public.eu_is_admin()));
drop policy if exists "fellow reads own memo versions" on public.action_policy_memo_versions;
create policy "fellow reads own memo versions" on public.action_policy_memo_versions for select to authenticated
 using ((select public.eu_is_admin()) or exists (select 1 from public.action_policy_memos m where m.id = memo_id and m.author_uid = (select auth.uid())));
drop policy if exists "fellow reads own memo reviews" on public.action_policy_memo_reviews;
create policy "fellow reads own memo reviews" on public.action_policy_memo_reviews for select to authenticated
 using ((select public.eu_is_admin()) or exists (select 1 from public.action_policy_memos m where m.id = memo_id and m.author_uid = (select auth.uid())));
drop policy if exists "fellow reads own memo research" on public.action_policy_memo_research_items;
create policy "fellow reads own memo research" on public.action_policy_memo_research_items for select to authenticated
 using ((select public.eu_is_admin()) or exists (select 1 from public.action_policy_memos m where m.id = memo_id and m.author_uid = (select auth.uid())));

-- The state machine. Kept in step with js/policy-fellowship-ladder.js
-- (TRANSITIONS); scripts/test/policy-fellowship-ladder.test.mjs compares them.
create or replace function public.action_policy_memo_next_status(p_from text, p_action text, p_actor text)
returns text language sql immutable set search_path = '' as $$
 select t.to_status from (values
  -- transitions:begin
  ('draft','submit','fellow','submitted'),
  ('changes_requested','resubmit','fellow','submitted'),
  ('owner_edited','resubmit','fellow','submitted'),
  ('draft','withdraw','fellow','withdrawn'),
  ('submitted','withdraw','fellow','withdrawn'),
  ('changes_requested','withdraw','fellow','withdrawn'),
  ('owner_edited','withdraw','fellow','withdrawn'),
  ('submitted','start_review','owner','in_review'),
  ('in_review','approve','owner','approved'),
  ('owner_edited','approve','owner','approved'),
  ('in_review','decline','owner','declined'),
  ('in_review','request_changes','owner','changes_requested'),
  ('in_review','owner_edit','owner','owner_edited'),
  ('owner_edited','owner_edit','owner','owner_edited')
  -- transitions:end
 ) as t(from_status, action, actor, to_status)
 where t.from_status = p_from and t.action = p_action and t.actor = p_actor
$$;
grant execute on function public.action_policy_memo_next_status(text, text, text) to anon, authenticated, service_role;

-- Line diff (LCS). Same walk and tie-break as lineDiff() in the JS module.
create or replace function public.action_policy_memo_line_diff(p_old text, p_new text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
 a text[] := string_to_array(coalesce(p_old, ''), E'\n');
 b text[] := string_to_array(coalesce(p_new, ''), E'\n');
 n integer; m integer; w integer; l integer[];
 i integer; j integer; ops jsonb := '[]'::jsonb; added integer := 0; removed integer := 0;
begin
 -- string_to_array('') is an empty array; JS ''.split('\n') is [''].
 if coalesce(array_length(a, 1), 0) = 0 then a := array['']; end if;
 if coalesce(array_length(b, 1), 0) = 0 then b := array['']; end if;
 n := array_length(a, 1); m := array_length(b, 1); w := m + 1;
 if (n + 1)::bigint * (m + 1) > 1000000 then
   return jsonb_build_object('format', 'summary', 'too_large', true, 'old_lines', n, 'new_lines', m);
 end if;
 l := array_fill(0, array[(n + 1) * w]);
 -- l[(i)*w + j + 1] holds LCS of a[i+1..n], b[j+1..m] (0-based i, j)
 for i in reverse n - 1 .. 0 loop
   for j in reverse m - 1 .. 0 loop
     if a[i + 1] = b[j + 1] then
       l[i * w + j + 1] := l[(i + 1) * w + j + 2] + 1;
     else
       l[i * w + j + 1] := greatest(l[(i + 1) * w + j + 1], l[i * w + j + 2]);
     end if;
   end loop;
 end loop;
 i := 0; j := 0;
 while i < n and j < m loop
   if a[i + 1] = b[j + 1] then
     ops := ops || jsonb_build_array(jsonb_build_object('op', '=', 't', a[i + 1])); i := i + 1; j := j + 1;
   elsif l[(i + 1) * w + j + 1] >= l[i * w + j + 2] then
     ops := ops || jsonb_build_array(jsonb_build_object('op', '-', 't', a[i + 1])); removed := removed + 1; i := i + 1;
   else
     ops := ops || jsonb_build_array(jsonb_build_object('op', '+', 't', b[j + 1])); added := added + 1; j := j + 1;
   end if;
 end loop;
 while i < n loop ops := ops || jsonb_build_array(jsonb_build_object('op', '-', 't', a[i + 1])); removed := removed + 1; i := i + 1; end loop;
 while j < m loop ops := ops || jsonb_build_array(jsonb_build_object('op', '+', 't', b[j + 1])); added := added + 1; j := j + 1; end loop;
 return jsonb_build_object('format', 'lines', 'added', added, 'removed', removed, 'ops', ops);
end;
$$;
grant execute on function public.action_policy_memo_line_diff(text, text) to authenticated, service_role;

-- A fellow with a seat in a policy cohort opens a memo.
create or replace function public.create_policy_memo(
 p_cohort_id uuid,
 p_title text,
 p_region_key text default null,
 p_official_profile_id uuid default null,
 p_bill_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_m_uid uuid := public.current_m_uid();
 v_cohort public.action_cohorts%rowtype;
 v_title text := btrim(coalesce(p_title, ''));
 v_id uuid;
begin
 if v_user is null then raise exception 'sign in first'; end if;
 if v_m_uid is null then raise exception 'your Action identity is not ready yet'; end if;
 if char_length(v_title) < 3 or char_length(v_title) > 200 then raise exception 'a memo title is 3 to 200 characters'; end if;
 select * into v_cohort from public.action_cohorts where id = p_cohort_id;
 if not found or v_cohort.program is null then raise exception 'policy cohort not found'; end if;
 if v_cohort.status <> 'active' then raise exception 'that cohort is not active'; end if;
 if not exists (select 1 from public.action_cohort_members cm where cm.cohort_id = v_cohort.id and cm.m_uid = v_m_uid) then
   raise exception 'you need a seat in this policy cohort to write for it';
 end if;
 if (select count(*) from public.action_policy_memos where author_uid = v_user and status in ('draft','changes_requested','owner_edited')) >= 20 then
   raise exception 'finish or withdraw some drafts first (20 open at most)';
 end if;
 insert into public.action_policy_memos(author_uid, author_m_uid, cohort_id, region_key, official_profile_id, bill_id, draft_title)
 values (v_user, v_m_uid, v_cohort.id, coalesce(p_region_key, v_cohort.region_key), p_official_profile_id, p_bill_id, v_title)
 returning id into v_id;
 return jsonb_build_object('memo_id', v_id, 'status', 'draft');
end;
$$;

create or replace function public.save_policy_memo_draft(p_memo_id uuid, p_title text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_memo public.action_policy_memos%rowtype;
 v_title text := btrim(coalesce(p_title, ''));
begin
 if v_user is null then raise exception 'sign in first'; end if;
 select * into v_memo from public.action_policy_memos where id = p_memo_id for update;
 if not found or v_memo.author_uid <> v_user then raise exception 'memo not found'; end if;
 if v_memo.status not in ('draft','changes_requested','owner_edited') then raise exception 'this memo is % and cannot be edited now', v_memo.status; end if;
 if char_length(v_title) < 3 or char_length(v_title) > 200 then raise exception 'a memo title is 3 to 200 characters'; end if;
 if char_length(coalesce(p_body, '')) > 60000 then raise exception 'keep the memo under 60,000 characters'; end if;
 update public.action_policy_memos set draft_title = v_title, draft_body = coalesce(p_body, ''), updated_at = now() where id = v_memo.id;
 return jsonb_build_object('memo_id', v_memo.id, 'status', v_memo.status, 'saved', true);
end;
$$;

-- Internal: write an immutable version of a memo.
create or replace function public.action_policy_memo_write_version(
 p_memo public.action_policy_memos, p_role text, p_actor uuid, p_title text, p_body text, p_note text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_parent public.action_policy_memo_versions%rowtype;
 v_no integer;
 v_id uuid;
begin
 select * into v_parent from public.action_policy_memo_versions where id = p_memo.current_version_id;
 select coalesce(max(version_no), 0) + 1 into v_no from public.action_policy_memo_versions where memo_id = p_memo.id;
 insert into public.action_policy_memo_versions(memo_id, version_no, author_role, author_uid, title, body, body_sha256, parent_version_id, diff_from_parent, note)
 values (p_memo.id, v_no, p_role, p_actor, p_title, p_body,
   encode(sha256(convert_to(p_body, 'UTF8')), 'hex'),
   v_parent.id,
   case when v_parent.id is null then null else public.action_policy_memo_line_diff(v_parent.body, p_body) end,
   nullif(btrim(coalesce(p_note, '')), ''))
 returning id into v_id;
 return v_id;
end;
$$;
revoke all on function public.action_policy_memo_write_version(public.action_policy_memos, text, uuid, text, text, text) from public, anon, authenticated;

create or replace function public.submit_policy_memo(p_memo_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_memo public.action_policy_memos%rowtype;
 v_action text;
 v_to text;
 v_version uuid;
begin
 if v_user is null then raise exception 'sign in first'; end if;
 select * into v_memo from public.action_policy_memos where id = p_memo_id for update;
 if not found or v_memo.author_uid <> v_user then raise exception 'memo not found'; end if;
 v_action := case when v_memo.status = 'draft' then 'submit' else 'resubmit' end;
 v_to := public.action_policy_memo_next_status(v_memo.status, v_action, 'fellow');
 if v_to is null then raise exception 'illegal transition: % from %', v_action, v_memo.status; end if;
 if char_length(btrim(v_memo.draft_body)) < 1 then raise exception 'write the memo before submitting it'; end if;
 v_version := public.action_policy_memo_write_version(v_memo, 'fellow', v_user, v_memo.draft_title, v_memo.draft_body, p_note);
 update public.action_policy_memos set status = v_to, current_version_id = v_version, submitted_at = now(), decided_at = null, updated_at = now() where id = v_memo.id;
 insert into public.action_policy_memo_reviews(memo_id, actor_uid, actor_role, action, from_status, to_status, version_id, note)
 values (v_memo.id, v_user, 'fellow', v_action, v_memo.status, v_to, v_version, nullif(btrim(coalesce(p_note, '')), ''));
 return jsonb_build_object('memo_id', v_memo.id, 'status', v_to, 'version_id', v_version);
end;
$$;

create or replace function public.withdraw_policy_memo(p_memo_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_memo public.action_policy_memos%rowtype;
 v_to text;
begin
 if v_user is null then raise exception 'sign in first'; end if;
 select * into v_memo from public.action_policy_memos where id = p_memo_id for update;
 if not found or v_memo.author_uid <> v_user then raise exception 'memo not found'; end if;
 v_to := public.action_policy_memo_next_status(v_memo.status, 'withdraw', 'fellow');
 if v_to is null then raise exception 'illegal transition: withdraw from %', v_memo.status; end if;
 update public.action_policy_memos set status = v_to, decided_at = now(), updated_at = now() where id = v_memo.id;
 insert into public.action_policy_memo_reviews(memo_id, actor_uid, actor_role, action, from_status, to_status, version_id, note)
 values (v_memo.id, v_user, 'fellow', 'withdraw', v_memo.status, v_to, v_memo.current_version_id, nullif(btrim(coalesce(p_note, '')), ''));
 return jsonb_build_object('memo_id', v_memo.id, 'status', v_to);
end;
$$;

-- The desk's decision. approve / decline ("pass") / request_changes /
-- owner_edit (the edited text + a required note) / start_review.
create or replace function public.review_policy_memo(
 p_memo_id uuid,
 p_action text,
 p_note text default null,
 p_title text default null,
 p_body text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_memo public.action_policy_memos%rowtype;
 v_current public.action_policy_memo_versions%rowtype;
 v_note text := nullif(btrim(coalesce(p_note, '')), '');
 v_to text;
 v_version uuid;
 v_title text;
begin
 if v_user is null or not (select public.eu_is_admin()) then raise exception 'not authorized'; end if;
 select * into v_memo from public.action_policy_memos where id = p_memo_id for update;
 if not found then raise exception 'memo not found'; end if;
 if v_memo.author_uid = v_user then raise exception 'you cannot review your own memo'; end if;
 v_to := public.action_policy_memo_next_status(v_memo.status, p_action, 'owner');
 if v_to is null then raise exception 'illegal transition: % from %', p_action, v_memo.status; end if;
 if p_action in ('decline','request_changes','owner_edit') and char_length(coalesce(v_note, '')) < 3 then
   raise exception '% needs a note to the fellow', p_action;
 end if;
 v_version := v_memo.current_version_id;
 if p_action = 'owner_edit' then
   select * into v_current from public.action_policy_memo_versions where id = v_memo.current_version_id;
   if coalesce(btrim(p_body), '') = '' then raise exception 'owner_edit needs the edited text'; end if;
   if char_length(p_body) > 60000 then raise exception 'keep the memo under 60,000 characters'; end if;
   if p_body = v_current.body then raise exception 'owner_edit must change the text'; end if;
   v_title := coalesce(nullif(btrim(coalesce(p_title, '')), ''), v_current.title);
   v_version := public.action_policy_memo_write_version(v_memo, 'owner', v_user, v_title, p_body, v_note);
   -- the fellow continues from the owner's text
   update public.action_policy_memos set current_version_id = v_version, draft_title = v_title, draft_body = p_body where id = v_memo.id;
 end if;
 update public.action_policy_memos
    set status = v_to, updated_at = now(),
        decided_at = case when v_to in ('approved','declined') then now() else decided_at end
  where id = v_memo.id;
 insert into public.action_policy_memo_reviews(memo_id, actor_uid, actor_role, action, from_status, to_status, version_id, note)
 values (v_memo.id, v_user, 'owner', p_action, v_memo.status, v_to, v_version, v_note);

 insert into public.network_notifications(recipient_m_uid, actor_m_uid, type, object_type, object_id, body, metadata)
 values (v_memo.author_m_uid, null, 'action_policy_memo_review', 'action_policy_memo', v_memo.id::text,
   case p_action
     when 'approve' then 'Your policy memo was approved: '
     when 'decline' then 'Your policy memo was passed on: '
     when 'request_changes' then 'Your policy memo needs changes: '
     when 'owner_edit' then 'Your policy memo was edited by the desk: '
     else 'Your policy memo is in review: ' end || v_memo.draft_title,
   jsonb_strip_nulls(jsonb_build_object('memo_id', v_memo.id, 'action', p_action, 'status', v_to, 'version_id', v_version, 'note', v_note)));

 return jsonb_build_object('memo_id', v_memo.id, 'status', v_to, 'version_id', v_version);
end;
$$;

create or replace function public.policy_memo_history(p_memo_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_memo public.action_policy_memos%rowtype;
begin
 if v_user is null then raise exception 'sign in first'; end if;
 select * into v_memo from public.action_policy_memos where id = p_memo_id;
 if not found or (v_memo.author_uid <> v_user and not (select public.eu_is_admin())) then raise exception 'memo not found'; end if;
 return jsonb_build_object(
   'memo', to_jsonb(v_memo) - 'author_uid',
   'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version_no', v.version_no, 'author_role', v.author_role,
       'title', v.title, 'body', v.body, 'body_sha256', v.body_sha256, 'parent_version_id', v.parent_version_id,
       'diff_from_parent', v.diff_from_parent, 'note', v.note, 'created_at', v.created_at) order by v.version_no)
     from public.action_policy_memo_versions v where v.memo_id = v_memo.id), '[]'::jsonb),
   'reviews', coalesce((select jsonb_agg(jsonb_build_object('action', r.action, 'actor_role', r.actor_role, 'from_status', r.from_status,
       'to_status', r.to_status, 'version_id', r.version_id, 'note', r.note, 'created_at', r.created_at) order by r.created_at, r.id)
     from public.action_policy_memo_reviews r where r.memo_id = v_memo.id), '[]'::jsonb),
   'research', coalesce((select jsonb_agg(to_jsonb(x) - 'added_by' order by x.created_at)
     from public.action_policy_memo_research_items x where x.memo_id = v_memo.id), '[]'::jsonb));
end;
$$;

create or replace function public.add_policy_memo_research_item(
 p_memo_id uuid, p_kind text, p_provider text, p_title text,
 p_url text default null, p_publisher text default null, p_provider_id text default null,
 p_retrieved_at timestamptz default null, p_license_note text default null,
 p_content_sha256 text default null, p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_memo public.action_policy_memos%rowtype;
 v_id uuid;
begin
 if v_user is null then raise exception 'sign in first'; end if;
 select * into v_memo from public.action_policy_memos where id = p_memo_id;
 if not found or (v_memo.author_uid <> v_user and not (select public.eu_is_admin())) then raise exception 'memo not found'; end if;
 if v_memo.status in ('approved','declined','withdrawn') then raise exception 'this memo is closed'; end if;
 if (select count(*) from public.action_policy_memo_research_items where memo_id = v_memo.id) >= 200 then raise exception 'a memo holds 200 research items at most'; end if;
 insert into public.action_policy_memo_research_items(memo_id, added_by, kind, provider, provider_id, title, url, publisher, retrieved_at, license_note, content_sha256, note)
 values (v_memo.id, v_user, p_kind, p_provider, nullif(btrim(coalesce(p_provider_id, '')), ''), btrim(coalesce(p_title, '')),
   nullif(btrim(coalesce(p_url, '')), ''), nullif(btrim(coalesce(p_publisher, '')), ''),
   case when p_provider = 'manual' then p_retrieved_at else coalesce(p_retrieved_at, now()) end,
   nullif(btrim(coalesce(p_license_note, '')), ''), nullif(lower(btrim(coalesce(p_content_sha256, ''))), ''), nullif(btrim(coalesce(p_note, '')), ''))
 returning id into v_id;
 return jsonb_build_object('item_id', v_id, 'evidence_status', 'unverified_lead');
end;
$$;

create or replace function public.remove_policy_memo_research_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
 v_user uuid := (select auth.uid());
 v_item public.action_policy_memo_research_items%rowtype;
 v_memo public.action_policy_memos%rowtype;
begin
 if v_user is null then raise exception 'sign in first'; end if;
 select * into v_item from public.action_policy_memo_research_items where id = p_item_id;
 if not found then raise exception 'item not found'; end if;
 select * into v_memo from public.action_policy_memos where id = v_item.memo_id;
 if v_memo.author_uid <> v_user and not (select public.eu_is_admin()) then raise exception 'item not found'; end if;
 if v_memo.status in ('approved','declined','withdrawn') then raise exception 'this memo is closed'; end if;
 delete from public.action_policy_memo_research_items where id = v_item.id;
 return jsonb_build_object('item_id', v_item.id, 'removed', true);
end;
$$;

revoke all on function public.create_policy_memo(uuid, text, text, uuid, uuid) from public, anon;
revoke all on function public.save_policy_memo_draft(uuid, text, text) from public, anon;
revoke all on function public.submit_policy_memo(uuid, text) from public, anon;
revoke all on function public.withdraw_policy_memo(uuid, text) from public, anon;
revoke all on function public.review_policy_memo(uuid, text, text, text, text) from public, anon;
revoke all on function public.policy_memo_history(uuid) from public, anon;
revoke all on function public.add_policy_memo_research_item(uuid, text, text, text, text, text, text, timestamptz, text, text, text) from public, anon;
revoke all on function public.remove_policy_memo_research_item(uuid) from public, anon;
grant execute on function public.create_policy_memo(uuid, text, text, uuid, uuid) to authenticated, service_role;
grant execute on function public.save_policy_memo_draft(uuid, text, text) to authenticated, service_role;
grant execute on function public.submit_policy_memo(uuid, text) to authenticated, service_role;
grant execute on function public.withdraw_policy_memo(uuid, text) to authenticated, service_role;
grant execute on function public.review_policy_memo(uuid, text, text, text, text) to authenticated, service_role;
grant execute on function public.policy_memo_history(uuid) to authenticated, service_role;
grant execute on function public.add_policy_memo_research_item(uuid, text, text, text, text, text, text, timestamptz, text, text, text) to authenticated, service_role;
grant execute on function public.remove_policy_memo_research_item(uuid) to authenticated, service_role;
