-- Equity Uprise shared-platform support-only: preserve Core scheduler fencing
-- terms and history; this rollback does not own any building capability.
-- Rollback for compute_scheduler_lease_v1. Drops only what that file created.
-- PENDING ONLY. Owner review and explicit approval are required before running
-- this against canonical Supabase. No ledger entry here.
-- Empty-install rollback only. Even a released/expired row preserves a fencing
-- term and transition history. Resetting it would make old authority reusable;
-- keep that state and use a reviewed forward repair after any scheduler use.
-- The lock, emptiness check and all drops are one atomic statement. An old
-- transaction snapshot is rejected so a writer committed during the lock wait
-- cannot be missed. The bounded lock timeout fails without dropping anything.
do $rollback$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'scheduler rollback requires READ COMMITTED; an old snapshot cannot prove the table is empty'
      using errcode = '55000';
  end if;
  perform set_config('lock_timeout', '5s', true);
  if to_regclass('public.ops_compute_scheduler_leases') is not null then
    lock table public.ops_compute_scheduler_leases in access exclusive mode;
    if exists (select 1 from public.ops_compute_scheduler_leases) then
      raise exception 'scheduler rollback refused: fencing terms or lease history exist; preserve them and prepare a reviewed forward repair'
        using errcode = '55000';
    end if;
  end if;
  drop function if exists public.compute_scheduler_acquire(uuid,text,text,integer);
  drop function if exists public.compute_scheduler_renew(uuid,text,bigint,integer);
  drop function if exists public.compute_scheduler_release(uuid,text,bigint);
  drop function if exists public.compute_scheduler_handover(uuid,text,bigint,text,integer);
  drop function if exists public.compute_scheduler_status(uuid);
  drop function if exists public.compute_scheduler_history_push(jsonb,timestamptz,text,text,text,bigint);
  drop table if exists public.ops_compute_scheduler_leases;
end
$rollback$;
