-- MISSION ADMIN APPROVAL v1 (PENDING: not applied in production).
--
-- Owner direction, 2026-10-15: EVERY mission completion must be approved by
-- an admin before it counts or posts as finished (anti-farming; missions
-- will be paid). Missions created from decisions stay draft until an admin
-- publishes them. "Completed mission" = action_mission_assignments.status =
-- 'verified', set only when an admin verifies the proof.
--
-- Audit (docs/control-plane/MISSION-ADMIN-APPROVAL.md has the full table):
-- the review RPCs already check eu_is_admin() and refuse self-review, but
-- nothing in the DATABASE stopped any other writer (a service-role key in a
-- Worker or Edge Function, a future trigger, a cron job, a copy-pasted RPC)
-- from setting a proof or an assignment to 'verified', minting points,
-- approving a bounty, or releasing clip money. And two real automatic paths
-- exist today:
--   * clip campaigns with approval_mode = 'auto' file submissions as
--     review_state = 'not_required', and clip_release_due() then makes their
--     earnings payable with no human review (production: 0 such campaigns);
--   * a clip earning with no submission (a conversion bonus) is released by
--     clip_release_due() without any approved clip behind it.
-- Anti-Social verifications never reached action_proof_review_history (that
-- table required a proof row; levels have none).
--
-- This file makes the rule a database invariant, in triggers that run for
-- every writer, including the service role:
--   1. action_proofs: a proof is born 'pending' (automation such as the
--      camera loop can only ever file a proof for review); it becomes
--      'verified' only under an admin's own token (auth.uid() + eu_is_admin()),
--      never the submitter's, and with the reviewer recorded.
--   2. action_proof_review_history also archives Anti-Social level reviews
--      (source = 'antisocial_level'), so EVERY verification writes it.
--   3. action_mission_assignments: 'verified' only under an admin token, not
--      the assignee's, and only when a 'verified' review-history row for that
--      assignment was written in the same transaction.
--   4. action_points_ledger: every award is minted under an admin token, never
--      to the reviewer's own identity, and an award tied to an assignment needs
--      that same-transaction verified review.
--   5. action_bounty_claims: 'approved' only once the assignment is verified;
--      'paid' only by an admin who is not the claimant.
--   6. Clips (when the clipping marketplace exists): no 'auto' approval mode,
--      no 'not_required' review state, a clip is approved only by the
--      campaign owner or an admin who is not the clipper, and an earning
--      becomes payable only behind an approved clip. clip_release_due() is
--      replaced with the same function minus 'not_required'.
--   7. action_missions: a mission becomes 'open' only after an admin approved
--      it for publication (publish_approved_at/by, stamped when an admin opens
--      it, or by approve_action_mission_publication() so a clip campaign's
--      owner can then take it live). Direct database sessions (migrations, the
--      owner's SQL editor) are exempt from this one rule only, because they
--      are not an API caller; they are never exempt from 1-6.
--
-- What is NOT changed: review_action_proof(), review_antisocial_level() and
-- the camera-loop submit_action_proof() keep their production bodies (hashes
-- f72e6483, 9871041b, b5d61ac8 matched the repo on 2026-10-15); the triggers
-- around them enforce the rule. Existing open/paused/closed missions are
-- recorded as approved for publication (they were published by the desk).
--
-- ROLLBACK: supabase/pending/mission_admin_approval_v1.rollback.sql (drops
-- every trigger and function this adds, restores clip_release_due(), and
-- leaves the extra history columns, which are harmless).

-- ---------------------------------------------------------------------------
-- 0. WHO IS ACTING. One helper so every guard says the same thing.
-- ---------------------------------------------------------------------------
-- The admin acting under their own token, or null. eu_is_admin() is the
-- existing role model: the house owner, plus anyone the owner designated as
-- eu_profiles.role = 'admin'. A service-role key has no auth.uid(), so it is
-- never an admin here.
create or replace function public.action_acting_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return null; end if;
  if not coalesce((select public.eu_is_admin()), false) then return null; end if;
  return v_uid;
end;
$$;
revoke all on function public.action_acting_admin() from public, anon, authenticated;
grant execute on function public.action_acting_admin() to service_role;

-- ---------------------------------------------------------------------------
-- 1. PROOFS: born pending; verified only by an admin who is not the submitter.
-- ---------------------------------------------------------------------------
create or replace function public.action_proof_verify_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'a proof is filed as pending and reviewed by an admin (got %)', new.status using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status = 'verified' and old.status is distinct from 'verified' then
    v_admin := public.action_acting_admin();
    if v_admin is null then
      raise exception 'only an admin can verify a mission proof' using errcode = '42501';
    end if;
    if new.user_id = v_admin then
      raise exception 'you cannot verify your own proof' using errcode = '42501';
    end if;
    if new.reviewer_uid is null or new.reviewed_at is null then
      raise exception 'a verified proof records its reviewer and review time' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.action_proof_verify_guard() from public, anon, authenticated;
drop trigger if exists action_proof_verify_guard on public.action_proofs;
create trigger action_proof_verify_guard before insert or update of status on public.action_proofs
  for each row execute function public.action_proof_verify_guard();

-- ---------------------------------------------------------------------------
-- 2. EVERY VERIFICATION IS IN THE REVIEW HISTORY, Anti-Social levels too.
-- ---------------------------------------------------------------------------
alter table public.action_proof_review_history
  alter column proof_id drop not null,
  add column if not exists source text not null default 'proof',
  add column if not exists level smallint;
do $c$ begin
  alter table public.action_proof_review_history add constraint action_proof_review_history_source_check
    check (source in ('proof', 'antisocial_level')
           and (source <> 'proof' or proof_id is not null)
           and (source <> 'antisocial_level' or level between 1 and 3));
exception when duplicate_object then null; end $c$;

do $levels$ begin
  if to_regclass('public.action_antisocial_levels') is null then return; end if;

  create or replace function public.action_antisocial_level_review_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  declare v_admin uuid;
  begin
    if tg_op = 'INSERT' then
      if new.status <> 'pending' then
        raise exception 'a level is filed as pending and reviewed by an admin' using errcode = '42501';
      end if;
      return new;
    end if;
    if new.status = 'verified' and old.status is distinct from 'verified' then
      v_admin := public.action_acting_admin();
      if v_admin is null then raise exception 'only an admin can verify a mission level' using errcode = '42501'; end if;
      if new.user_id = v_admin then raise exception 'you cannot verify your own work' using errcode = '42501'; end if;
    end if;
    return new;
  end;
  $fn$;
  revoke all on function public.action_antisocial_level_review_guard() from public, anon, authenticated;
  drop trigger if exists action_antisocial_level_review_guard on public.action_antisocial_levels;
  create trigger action_antisocial_level_review_guard before insert or update of status on public.action_antisocial_levels
    for each row execute function public.action_antisocial_level_review_guard();

  create or replace function public.action_archive_antisocial_review()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  begin
    insert into public.action_proof_review_history(
      proof_id, source, level, assignment_id, user_id, reviewer_uid, decision, review_note,
      proof_type, proof_url, statement, metadata, reviewed_at)
    values (
      null, 'antisocial_level', new.level, new.assignment_id, new.user_id, public.current_m_uid(), new.status,
      nullif(new.review_note, ''), 'artifact', new.proof_url, coalesce(new.statement, ''),
      jsonb_strip_nulls(jsonb_build_object('post_id', new.post_id, 'collaborator_m_uid', new.collaborator_m_uid,
                                           'media_asset_id', new.media_asset_id)),
      coalesce(new.reviewed_at, now()));
    return new;
  end;
  $fn$;
  revoke all on function public.action_archive_antisocial_review() from public, anon, authenticated;
  drop trigger if exists action_antisocial_review_archive on public.action_antisocial_levels;
  create trigger action_antisocial_review_archive after update of status on public.action_antisocial_levels
    for each row when (old.status = 'pending' and new.status in ('verified', 'rejected'))
    execute function public.action_archive_antisocial_review();
end $levels$;

-- ---------------------------------------------------------------------------
-- 3. AN ASSIGNMENT IS VERIFIED ONLY BY AN ADMIN'S RECORDED REVIEW.
-- ---------------------------------------------------------------------------
-- The same-transaction review: a 'verified' history row for this assignment
-- whose reviewed_at is not older than this transaction (now() is the
-- transaction's start time; review_action_proof and the level archive stamp
-- now()). An old review cannot be replayed to verify again later.
create or replace function public.action_assignment_has_fresh_review(p_assignment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.action_proof_review_history h
     where h.assignment_id = p_assignment and h.decision = 'verified' and h.reviewed_at >= now()
       and h.reviewer_uid is not null)
$$;
revoke all on function public.action_assignment_has_fresh_review(uuid) from public, anon, authenticated;
grant execute on function public.action_assignment_has_fresh_review(uuid) to service_role;

create or replace function public.action_assignment_verify_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid;
begin
  if new.status = 'verified' and (tg_op = 'INSERT' or old.status is distinct from 'verified') then
    if tg_op = 'INSERT' then
      raise exception 'an assignment starts as joined; only an admin review verifies it' using errcode = '42501';
    end if;
    v_admin := public.action_acting_admin();
    if v_admin is null then
      raise exception 'only an admin can mark a mission complete' using errcode = '42501';
    end if;
    if new.user_id = v_admin then
      raise exception 'you cannot verify your own mission' using errcode = '42501';
    end if;
    if not public.action_assignment_has_fresh_review(new.id) then
      raise exception 'a mission is complete only through a recorded admin review' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.action_assignment_verify_guard() from public, anon, authenticated;
drop trigger if exists action_assignment_verify_guard on public.action_mission_assignments;
create trigger action_assignment_verify_guard before insert or update of status on public.action_mission_assignments
  for each row execute function public.action_assignment_verify_guard();

-- ---------------------------------------------------------------------------
-- 4. POINTS ARE MINTED ONLY BY AN ADMIN, NEVER TO THEMSELVES.
-- ---------------------------------------------------------------------------
create or replace function public.action_points_mint_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid;
begin
  v_admin := public.action_acting_admin();
  if v_admin is null then
    raise exception 'only an admin review awards points' using errcode = '42501';
  end if;
  if new.m_uid is not distinct from public.current_m_uid() then
    raise exception 'you cannot award points to yourself' using errcode = '42501';
  end if;
  if new.assignment_id is not null and not public.action_assignment_has_fresh_review(new.assignment_id) then
    raise exception 'points for a mission need its recorded admin review' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.action_points_mint_guard() from public, anon, authenticated;
drop trigger if exists action_points_mint_guard on public.action_points_ledger;
create trigger action_points_mint_guard before insert on public.action_points_ledger
  for each row execute function public.action_points_mint_guard();

-- ---------------------------------------------------------------------------
-- 5. BOUNTIES: approved only behind a verified mission; paid only by an admin.
-- ---------------------------------------------------------------------------
do $bounty$ begin
  if to_regclass('public.action_bounty_claims') is null then return; end if;

  create or replace function public.action_bounty_claim_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  declare v_admin uuid;
  begin
    if tg_op = 'INSERT' and new.status in ('approved', 'paid') then
      raise exception 'a bounty claim starts reserved' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      if new.status = 'approved' and not exists (
        select 1 from public.action_mission_assignments a where a.id = new.assignment_id and a.status = 'verified') then
        raise exception 'a bounty is approved only after an admin verified the mission' using errcode = '42501';
      end if;
      if new.status = 'paid' then
        v_admin := public.action_acting_admin();
        if v_admin is null then raise exception 'only an admin records a bounty payout' using errcode = '42501'; end if;
        if new.user_id = v_admin then raise exception 'you cannot pay your own bounty' using errcode = '42501'; end if;
      end if;
    end if;
    return new;
  end;
  $fn$;
  revoke all on function public.action_bounty_claim_guard() from public, anon, authenticated;
  drop trigger if exists action_bounty_claim_guard on public.action_bounty_claims;
  create trigger action_bounty_claim_guard before insert or update of status on public.action_bounty_claims
    for each row execute function public.action_bounty_claim_guard();
end $bounty$;

-- ---------------------------------------------------------------------------
-- 6. CLIPS (paid missions): no automatic approval, no money without approval.
-- ---------------------------------------------------------------------------
do $clips$ begin
  if to_regclass('public.action_clip_submissions') is null then return; end if;

  update public.action_clip_campaigns set approval_mode = 'creator', updated_at = now() where approval_mode = 'auto';
  update public.action_clip_submissions set review_state = 'pending', updated_at = now() where review_state = 'not_required';

  create or replace function public.action_clip_campaign_review_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  begin
    -- every clip is reviewed by a person; 'auto' would file clips as not_required
    new.approval_mode := 'creator';
    return new;
  end;
  $fn$;
  revoke all on function public.action_clip_campaign_review_guard() from public, anon, authenticated;
  drop trigger if exists action_clip_campaign_review_guard on public.action_clip_campaigns;
  create trigger action_clip_campaign_review_guard before insert or update of approval_mode on public.action_clip_campaigns
    for each row execute function public.action_clip_campaign_review_guard();

  create or replace function public.action_clip_submission_review_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  declare v_uid uuid := (select auth.uid()); v_org uuid;
  begin
    if new.review_state = 'not_required' then new.review_state := 'pending'; end if;
    if new.review_state = 'approved' and (tg_op = 'INSERT' or old.review_state is distinct from 'approved') then
      if tg_op = 'INSERT' then raise exception 'a clip is filed for review' using errcode = '42501'; end if;
      select c.org_id into v_org from public.action_clip_campaigns c where c.mission_id = new.mission_id;
      if v_uid is null or not (coalesce((select public.eu_is_admin()), false) or coalesce(private.is_org_owner(v_org), false)) then
        raise exception 'only the campaign owner or an admin approves a clip' using errcode = '42501';
      end if;
      if new.user_id = v_uid then raise exception 'you cannot review your own clip' using errcode = '42501'; end if;
    end if;
    return new;
  end;
  $fn$;
  revoke all on function public.action_clip_submission_review_guard() from public, anon, authenticated;
  drop trigger if exists action_clip_submission_review_guard on public.action_clip_submissions;
  create trigger action_clip_submission_review_guard before insert or update of review_state on public.action_clip_submissions
    for each row execute function public.action_clip_submission_review_guard();

  create or replace function public.action_clip_earning_release_guard()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  begin
    if new.state = 'payable' and old.state is distinct from 'payable' then
      if new.submission_id is not null and not exists (
           select 1 from public.action_clip_submissions s where s.id = new.submission_id and s.review_state = 'approved') then
        raise exception 'clip money is released only behind an approved clip' using errcode = '42501';
      end if;
      if new.submission_id is null and not exists (
           select 1 from public.action_clip_submissions s where s.claim_id = new.claim_id and s.review_state = 'approved') then
        raise exception 'a bonus is released only once the clipper has an approved clip' using errcode = '42501';
      end if;
    end if;
    return new;
  end;
  $fn$;
  revoke all on function public.action_clip_earning_release_guard() from public, anon, authenticated;
  drop trigger if exists action_clip_earning_release_guard on public.action_clip_earnings;
  create trigger action_clip_earning_release_guard before update of state on public.action_clip_earnings
    for each row execute function public.action_clip_earning_release_guard();

  -- clip_release_due as applied (20261006170955, production hash f9370119),
  -- with 'not_required' removed and the bonus rule above, so the scheduled
  -- release never even tries to move unapproved money.
  create or replace function public.clip_release_due()
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  declare v_count integer;
  begin
    with ok as (
      select e.id from public.action_clip_earnings e
        join public.action_clip_claims k on k.id = e.claim_id and k.status = 'active'
        join public.action_clip_campaigns c on c.mission_id = e.mission_id
        left join public.action_clip_submissions s on s.id = e.submission_id
       where e.state = 'held' and e.hold_until <= now()
         and (case when e.submission_id is null
                then exists (select 1 from public.action_clip_submissions a
                              where a.claim_id = e.claim_id and a.review_state = 'approved')
                else s.status in ('tracking', 'closed')
                  and s.review_state = 'approved'
                  and s.live_checked_at >= s.posted_at + make_interval(days => c.keep_live_days)
              end)
       for update of e skip locked
    )
    update public.action_clip_earnings e set state = 'payable', released_at = now() from ok where e.id = ok.id;
    get diagnostics v_count = row_count;
    return jsonb_build_object('released', v_count);
  end;
  $fn$;
end $clips$;

-- ---------------------------------------------------------------------------
-- 7. A MISSION GOES LIVE ONLY AFTER AN ADMIN APPROVED IT.
-- ---------------------------------------------------------------------------
alter table public.action_missions
  add column if not exists publish_approved_at timestamptz,
  add column if not exists publish_approved_by uuid;
-- Missions already live were published by the desk under the old rules.
update public.action_missions
   set publish_approved_at = coalesce(publish_approved_at, updated_at, created_at)
 where status in ('open', 'paused', 'closed') and publish_approved_at is null;

create or replace function public.action_mission_publish_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid := public.action_acting_admin();
begin
  -- A direct database session (a migration, the owner's SQL editor) is not
  -- an API caller; PostgREST, Workers and Edge Functions always SET ROLE.
  if current_setting('role', true) in ('none', '') or current_setting('role', true) is null then
    if new.status = 'open' and new.publish_approved_at is null then new.publish_approved_at := now(); end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.publish_approved_at is distinct from old.publish_approved_at
                           or new.publish_approved_by is distinct from old.publish_approved_by) and v_admin is null then
    raise exception 'only an admin approves a mission for publication' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and (new.publish_approved_at is not null or new.publish_approved_by is not null) and v_admin is null then
    raise exception 'only an admin approves a mission for publication' using errcode = '42501';
  end if;
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    if v_admin is not null then
      new.publish_approved_at := coalesce(new.publish_approved_at, now());
      new.publish_approved_by := coalesce(new.publish_approved_by, v_admin);
    elsif new.publish_approved_at is null then
      raise exception 'this mission is a draft until an admin publishes it' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.action_mission_publish_guard() from public, anon, authenticated;
drop trigger if exists action_mission_publish_guard on public.action_missions;
create trigger action_mission_publish_guard before insert or update on public.action_missions
  for each row execute function public.action_mission_publish_guard();

-- The desk approves a draft (for example a clip campaign) so its owner can
-- take it live, without opening it themselves.
create or replace function public.approve_action_mission_publication(p_mission uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin uuid := public.action_acting_admin(); v_at timestamptz;
begin
  if v_admin is null then raise exception 'not authorized' using errcode = '42501'; end if;
  update public.action_missions
     set publish_approved_at = coalesce(publish_approved_at, now()),
         publish_approved_by = coalesce(publish_approved_by, v_admin), updated_at = now()
   where id = p_mission
  returning publish_approved_at into v_at;
  if v_at is null then raise exception 'mission not found'; end if;
  return jsonb_build_object('mission_id', p_mission, 'publish_approved_at', v_at);
end;
$$;
revoke all on function public.approve_action_mission_publication(uuid) from public, anon;
grant execute on function public.approve_action_mission_publication(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. ONE PREDICATE FOR "HAS COMPLETED A MISSION". The ladder, the World's
-- CCTV gate and the gated track read these, never their own copy.
-- ---------------------------------------------------------------------------
create or replace function public.action_member_verified_mission_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct a.mission_id)::integer
    from public.action_mission_assignments a
    join public.action_missions m on m.id = a.mission_id
   where p_user is not null and a.user_id = p_user and a.status = 'verified'
     and coalesce(m.kind, 'civic') <> 'clip'
$$;
create or replace function public.action_member_has_verified_mission(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.action_member_verified_mission_count(p_user) >= 1 $$;
revoke all on function public.action_member_verified_mission_count(uuid), public.action_member_has_verified_mission(uuid)
  from public, anon, authenticated;
grant execute on function public.action_member_verified_mission_count(uuid), public.action_member_has_verified_mission(uuid)
  to service_role;
