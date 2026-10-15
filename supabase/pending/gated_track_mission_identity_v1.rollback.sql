-- ROLLBACK for supabase/pending/gated_track_mission_identity_v1.sql.
-- Roll the Worker back first (workers/mccluster/src/music/router.js GATES to
-- the any_of listen gate), then run this as the service role / postgres.
-- music_gated_plays rows written while the rule was live stay (they are the
-- record of granted full plays).

drop function if exists public.music_gate_claim_rule(uuid, text, text, text, integer), public.music_gate_rule_state(uuid, text, text);
delete from public.action_unlock_rules where rule_key = 'gated_track_niggy_nigg';
alter table public.action_unlock_rules drop constraint if exists action_unlock_rules_missions_identity_count_check;
alter table public.action_unlock_rules drop constraint if exists action_unlock_rules_requirement_kind_v2_check;
alter table public.action_unlock_rules add constraint action_unlock_rules_requirement_kind_check
  check (requirement_kind in ('none','signed_in','creator_account','fellow','starter_kinds','verified_referrals','registration_assists'));
-- Restore action_unlock_progress(uuid, text): re-run its block from
-- supabase/pending/policy_fellowship_ladder_v1.sql (section 1b).
drop function if exists public.member_identity_verified(uuid);
-- The two event_taxonomy rows (music_preview_play, music_full_play) are harmless; to remove:
-- delete from public.event_taxonomy where event_name in ('music_preview_play','music_full_play');
