-- Level 3 refund reservation ledger.
create table if not exists public.l3_refund_operations (
 id uuid primary key,
 order_id uuid not null references public.l3_orders(id),
 org_id uuid not null references public.orgs(id),
 actor_id uuid not null,
 amount_cents bigint not null check (amount_cents > 0),
 charge_id text not null,
 status text not null default 'reserved' check (status in ('reserved','reconciled','needs_reconciliation')),
 stripe_refund_id text unique,
 created_at timestamptz not null default now()
);
create unique index if not exists l3_refund_active_order_idx on public.l3_refund_operations(order_id) where status in ('reserved','needs_reconciliation');
alter table public.l3_refund_operations enable row level security;
revoke all on public.l3_refund_operations from public, anon, authenticated;
grant select, insert, update on public.l3_refund_operations to service_role;

-- Serialize reservation decisions on the order row, even across worker instances.
create or replace function public.l3_reserve_refund(
 p_id uuid, p_order uuid, p_org uuid, p_actor uuid, p_amount bigint, p_charge text
) returns public.l3_refund_operations
language plpgsql security invoker set search_path = public as $$
declare v_existing public.l3_refund_operations; v_result public.l3_refund_operations;
begin
 if current_user not in ('service_role','postgres') then raise exception 'forbidden'; end if;
 perform 1 from public.l3_orders where id=p_order and org_id=p_org for update;
 if not found then raise exception 'order_not_found'; end if;
 select * into v_existing from public.l3_refund_operations where id=p_id;
 if found then
  if v_existing.order_id<>p_order or v_existing.org_id<>p_org
   or v_existing.actor_id<>p_actor or v_existing.amount_cents<>p_amount
   or v_existing.charge_id<>p_charge then raise exception 'refund_request_conflict'; end if;
  return v_existing;
 end if;
 if exists(select 1 from public.l3_refund_operations
           where order_id=p_order and status in ('reserved','needs_reconciliation'))
 then raise exception 'refund_in_progress'; end if;
 insert into public.l3_refund_operations(id,order_id,org_id,actor_id,amount_cents,charge_id)
 values(p_id,p_order,p_org,p_actor,p_amount,p_charge) returning * into v_result;
 return v_result;
end $$;
revoke all on function public.l3_reserve_refund(uuid,uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.l3_reserve_refund(uuid,uuid,uuid,uuid,bigint,text) to service_role;

create or replace function public.l3_finish_refund(p_id uuid,p_refund text,p_complete boolean)
returns void language plpgsql security invoker set search_path=public as $$
declare v_op public.l3_refund_operations;
begin
 if current_user not in ('service_role','postgres') then raise exception 'forbidden'; end if;
 select * into v_op from public.l3_refund_operations where id=p_id for update;
 if not found then raise exception 'refund_operation_missing'; end if;
 if v_op.status='reconciled' then
  if v_op.stripe_refund_id<>p_refund then raise exception 'refund_id_mismatch'; end if;
  return;
 end if;
 update public.l3_orders set status=case when p_complete then 'refunded' else 'partially_refunded' end,
  refunded_at=now(),updated_at=now() where id=v_op.order_id and org_id=v_op.org_id;
 if p_complete then
  update public.l3_entitlements set revoked_at=coalesce(revoked_at,now()) where order_id=v_op.order_id;
 end if;
 update public.l3_refund_operations set status='reconciled',stripe_refund_id=p_refund
 where id=p_id;
end $$;
revoke all on function public.l3_finish_refund(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.l3_finish_refund(uuid,text,boolean) to service_role;
