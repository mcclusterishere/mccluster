-- ROLLBACK for supabase/pending/mission_admin_approval_v1.sql.
-- Run as the service role / postgres, in this order. Restores the
-- production behaviour of 2026-10-15 (the review RPCs still check the admin;
-- the database no longer refuses other writers).
--
-- The added history columns (source, level, nullable proof_id) and the
-- action_missions publish_approved_* columns are left in place: they are
-- harmless and dropping them would discard the Anti-Social review history
-- rows. To remove them anyway, first delete the rows with
-- source = 'antisocial_level', then drop the constraint and columns.

drop trigger if exists action_proof_verify_guard on public.action_proofs;
drop trigger if exists action_assignment_verify_guard on public.action_mission_assignments;
drop trigger if exists action_points_mint_guard on public.action_points_ledger;
drop trigger if exists action_mission_publish_guard on public.action_missions;
do $r$ begin
  if to_regclass('public.action_antisocial_levels') is not null then
    drop trigger if exists action_antisocial_level_review_guard on public.action_antisocial_levels;
    drop trigger if exists action_antisocial_review_archive on public.action_antisocial_levels;
  end if;
  if to_regclass('public.action_bounty_claims') is not null then
    drop trigger if exists action_bounty_claim_guard on public.action_bounty_claims;
  end if;
  if to_regclass('public.action_clip_submissions') is not null then
    drop trigger if exists action_clip_campaign_review_guard on public.action_clip_campaigns;
    drop trigger if exists action_clip_submission_review_guard on public.action_clip_submissions;
    drop trigger if exists action_clip_earning_release_guard on public.action_clip_earnings;
  end if;
end $r$;

drop function if exists public.action_proof_verify_guard(), public.action_assignment_verify_guard(),
  public.action_points_mint_guard(), public.action_mission_publish_guard(),
  public.action_antisocial_level_review_guard(), public.action_archive_antisocial_review(),
  public.action_bounty_claim_guard(), public.action_clip_campaign_review_guard(),
  public.action_clip_submission_review_guard(), public.action_clip_earning_release_guard(),
  public.approve_action_mission_publication(uuid), public.action_assignment_has_fresh_review(uuid);
-- action_member_verified_mission_count / action_member_has_verified_mission are read by
-- supabase/pending/gated_track_mission_identity_v1.sql: roll that back first, then:
drop function if exists public.action_member_has_verified_mission(uuid), public.action_member_verified_mission_count(uuid);
drop function if exists public.action_acting_admin();

-- clip_release_due() exactly as applied in 20261006170955 (production hash f9370119):
-- re-run that function's block from supabase/migrations/20261006170955_action_clipping_marketplace_v1.sql.
-- Note: campaigns switched from 'auto' to 'creator' and submissions switched from
-- 'not_required' to 'pending' by the forward file are NOT switched back (production
-- had 0 of each on 2026-10-15).
