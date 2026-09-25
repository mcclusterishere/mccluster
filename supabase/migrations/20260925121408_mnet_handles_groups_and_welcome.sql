-- Production ledger reconciliation anchor.
--
-- REPLAY_ANCHOR_ONLY: production recorded the canonical
-- 20260925040000_mnet_handles_groups_and_welcome.sql a second time as
-- version 20260925121408 when the already-reviewed SQL was applied through
-- the remote migration tool. The live schema already contains that change.
-- Replaying the full migration here would perform the same data backfill and
-- welcome/group setup twice, so this version intentionally records history
-- without repeating the schema/data mutation.
select 1;
