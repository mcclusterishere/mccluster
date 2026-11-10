-- Emergency suspension, not destructive downgrade. Pending; authorized use only.
-- Do not restore the previous three-argument reservation implementation: that
-- would forget rejected/expired request tombstones and permit identity replay.
-- Keep every active guard, immutable payload and audit receipt for reconciliation.
-- Roll back the worker/UI at the same time: billing fails closed until reviewed.
begin;
revoke execute on function public.reserve_creator_checkout(uuid,text,text,jsonb),
 public.mark_creator_checkout_outcome(uuid,text,text,jsonb),
 public.audit_creator_checkout_recovery(uuid,text,uuid,text,jsonb),
 public.bind_creator_checkout(uuid,text,text),
 public.release_expired_creator_checkout(uuid,text) from service_role;
revoke insert,update,delete,truncate on public.creator_checkout_reservations,
 public.creator_checkout_attempts,public.creator_checkout_recovery_audit from service_role;
revoke usage on sequence public.creator_checkout_recovery_audit_id_seq from service_role;
commit;
-- Restoration: reapply the forward file transactionally after review. It is
-- idempotent and preserves all receipts; do not truncate/drop tables or triggers.
