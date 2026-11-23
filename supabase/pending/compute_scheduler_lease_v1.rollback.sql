-- Rollback for compute_scheduler_lease_v1. Drops only what that file created.
-- PENDING ONLY. Owner review and explicit approval are required before running
-- this against canonical Supabase. No ledger entry here.
drop function if exists public.compute_scheduler_acquire(uuid,text,text,integer);
drop function if exists public.compute_scheduler_renew(uuid,text,bigint,integer);
drop function if exists public.compute_scheduler_release(uuid,text,bigint);
drop function if exists public.compute_scheduler_handover(uuid,text,bigint,text,integer);
drop function if exists public.compute_scheduler_status(uuid);
drop function if exists public.compute_scheduler_history_push(jsonb,timestamptz,text,text,text,bigint);
drop table if exists public.ops_compute_scheduler_leases;
