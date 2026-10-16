-- ROLLBACK for supabase/pending/live_missions_v1.sql
-- Run only after the Worker's LIVE_MISSIONS_ENABLED is "false" again and every
-- Stream live input it created has been deleted (the Worker's sweep does that;
-- or list them: GET /accounts/{CF_ACCOUNT_ID}/stream/live_inputs, meta.name
-- starting "live-mission ").
--
-- Proofs filed by live runs stay (they are ordinary pending/verified proofs);
-- only their metadata->live_session_id stops pointing anywhere. Recording
-- chunks in the private bucket 'live-mission-recordings' are NOT deleted by
-- this file: empty the bucket from the Storage API first if that is intended.
begin;
drop trigger if exists action_live_required_proof_guard on public.action_proofs;
drop trigger if exists action_live_claim_guard on public.action_bounty_claims;
drop trigger if exists action_live_bounty_open_guard on public.action_bounties;
drop trigger if exists action_live_default_policy on public.action_missions;

drop function if exists public.action_live_required_proof_guard();
drop function if exists public.action_live_claim_guard();
drop function if exists public.action_live_bounty_open_guard();
drop function if exists public.action_live_default_policy();
drop function if exists public.action_live_now_public();
drop function if exists public.action_live_event_log(timestamptz, timestamptz);
drop function if exists public.action_live_sweep(timestamptz);
drop function if exists public.action_live_set_recording(uuid, text, text);
drop function if exists public.action_live_record_chunk(uuid, integer, text, integer, text);
drop function if exists public.action_live_set_publishing_consent(uuid, text, text, jsonb);
drop function if exists public.action_live_report(uuid, text, text);
drop function if exists public.action_live_kill(uuid, text);
drop function if exists public.action_live_mark_third_party(uuid, text);
drop function if exists public.action_live_abandon(uuid);
drop function if exists public.action_live_complete(uuid, text);
drop function if exists public.action_live_observe(uuid, text, timestamptz, text, text);
drop function if exists public.action_live_attach(uuid, text, text, text, text, text, numeric, numeric);
drop function if exists public.action_live_open(uuid, text, jsonb, text, text, uuid);
drop function if exists public.action_live_window_covered(uuid, timestamptz, timestamptz, integer, integer, integer, integer);
drop function if exists public.action_live_eval(uuid, timestamptz);

drop table if exists public.action_live_publishing_consents;
drop table if exists public.action_live_reports;
drop table if exists public.action_live_recording_chunks;
drop table if exists public.action_live_webhook_events;
drop table if exists public.action_live_segments;
drop table if exists public.action_live_sessions;
drop table if exists public.action_bounty_live_coverage;
drop table if exists public.action_live_controls;
drop table if exists public.action_mission_live_policies;
commit;
-- The bucket row itself (only if empty):
--   delete from storage.buckets where id = 'live-mission-recordings';
