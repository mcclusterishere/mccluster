-- Pending. Prerequisites: creator_store09300 and reviewed commerce reconciler v3.
-- No provider calls or data backfill. Missing v3 fails migration review rather
-- than silently losing partial refunds. Existing generic sales are untouched.
do $$ begin
 if to_regprocedure('public.commerce_upsert_stripe_payment(uuid,jsonb)') is null
 or to_regprocedure('public.commerce_stripe_lock(text,text)') is null then
  raise exception 'commerce reconciler v3 required before storefront adapter';
 end if;
end $$;
alter table public.creator_store_orders
 add column canonical_order_id uuid unique references public.work_orders(id),
 add column canonical_payment_id uuid unique references public.work_payments(id),
 add column canonical_task_id uuid unique references public.work_tasks(id);

-- The legacy webhook also receives connected-account events. Even when a
-- seller edits/removes Stripe metadata, it cannot bypass the immutable order
-- check by routing a known storefront payment through the generic reconciler.
-- Only this transaction's validated storefront trigger sets the local context.
alter function public.commerce_record_stripe_checkout(jsonb) rename to commerce_record_stripe_checkout_v3;
alter function public.commerce_record_stripe_refund(jsonb) rename to commerce_record_stripe_refund_v3;
create function public.commerce_record_stripe_checkout(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare store_id uuid;
begin
 select id into store_id from public.creator_store_orders where checkout_session_id=p->>'session_id';
 if store_id is not null and current_setting('mcc.creator_store_reconcile',true) is distinct from store_id::text then raise exception 'verified storefront handler required'; end if;
 return public.commerce_record_stripe_checkout_v3(p);
end $$;
create function public.commerce_record_stripe_refund(p jsonb) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare store_id uuid;
begin
 select id into store_id from public.creator_store_orders where payment_intent_id=p->>'payment_intent';
 if store_id is not null and current_setting('mcc.creator_store_reconcile',true) is distinct from store_id::text then raise exception 'verified storefront handler required'; end if;
 return public.commerce_record_stripe_refund_v3(p);
end $$;
revoke all on function public.commerce_record_stripe_checkout(jsonb),public.commerce_record_stripe_refund(jsonb) from public,anon,authenticated;
grant execute on function public.commerce_record_stripe_checkout(jsonb),public.commerce_record_stripe_refund(jsonb) to service_role;

create or replace function public.creator_store_sync_commerce() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare recorded jsonb;payment public.work_payments; canonical public.work_orders;shipping jsonb;fulfillment text;task uuid;previous_context text:=current_setting('mcc.creator_store_reconcile',true);
begin
 if current_user<>'service_role' then raise exception 'service role required'; end if;
 if new.status='pending' then return new; end if;
 if new.payment_intent_id is null or new.checkout_session_id is null or new.paid_at is null then raise exception 'verified storefront payment required'; end if;
 if new.org_id is distinct from old.org_id or new.stripe_account_id is distinct from old.stripe_account_id or new.livemode is distinct from old.livemode then raise exception 'immutable storefront merchant'; end if;
 -- The reserved connected account remains bound to the seller's org and mode.
 if not exists(select 1 from public.org_stripe_accounts where org_id=new.org_id and stripe_account_id=new.stripe_account_id and livemode=new.livemode) then raise exception 'storefront merchant binding unavailable'; end if;
 perform public.commerce_stripe_lock(null,new.payment_intent_id);
 -- Same provider identity used by #396 receipts and uniqueness constraints.
 shipping:=case when jsonb_typeof(new.shipping_details->'address')='object' then (new.shipping_details->'address')||jsonb_build_object('name',new.shipping_details->>'name') else new.shipping_details end;
 perform set_config('mcc.creator_store_reconcile',new.id::text,true);
 recorded:=public.commerce_record_stripe_checkout(jsonb_build_object(
  'session_id',new.checkout_session_id,'payment_intent',new.payment_intent_id,
  'kind','creator_store_sale','org_id',new.org_id,'amount_cents',new.amount_cents,
  'currency',new.currency,'email',new.buyer_email,'shipping',shipping,
  'paid_at',new.paid_at,'livemode',new.livemode));
 select * into canonical from public.work_orders where id=(recorded->>'order_id')::uuid;
 select * into payment from public.work_payments where id=(recorded->>'payment_id')::uuid for update;
 if canonical.org_id is distinct from new.org_id or canonical.source_table<>'stripe_checkout' or canonical.source_id is distinct from new.checkout_session_id
 or canonical.amount_cents is distinct from new.amount_cents or canonical.currency is distinct from new.currency or canonical.livemode is distinct from new.livemode
 or payment.org_id is distinct from new.org_id or payment.order_id is distinct from canonical.id
 or payment.provider_reference is distinct from new.payment_intent_id or payment.amount_cents is distinct from new.amount_cents
 or payment.currency is distinct from new.currency or payment.livemode is distinct from new.livemode or payment.verification<>'provider_verified' then
  raise exception 'canonical sale conflicts with immutable storefront payment';
 end if;
 if (old.canonical_order_id is not null and old.canonical_order_id<>canonical.id)
 or (old.canonical_payment_id is not null and old.canonical_payment_id<>payment.id) then raise exception 'canonical identity changed'; end if;
 new.canonical_order_id:=canonical.id;new.canonical_payment_id:=payment.id;
 fulfillment:=case new.kind when 'physical' then 'physical_shipping' else 'service_scheduling' end;
 update public.work_orders set title=left((case when new.livemode then '' else 'TEST · ' end)||new.title,300),items=jsonb_build_array(jsonb_build_object(
  'kind','creator_store_sale','creator_store_order_id',new.id,'product_id',new.product_id,'title',new.title,'quantity',1,
  'revenue_type',case new.kind when 'physical' then 'product_sale' else 'service_sale' end,'fulfillment_type',fulfillment,'shipping',shipping)) where id=canonical.id and org_id=new.org_id;
 -- Use the existing cumulative refund RPC; never create another financial ledger.
 new.refunded_cents:=greatest(new.refunded_cents,payment.refunded_cents);
 if new.refunded_cents>0 then
  perform public.commerce_record_stripe_refund(jsonb_build_object('org_id',new.org_id,'payment_intent',new.payment_intent_id,'amount_cents',new.amount_cents,'amount_refunded',new.refunded_cents,'livemode',new.livemode));
  new.status:=case when new.refunded_cents=new.amount_cents then 'refunded' else 'partially_refunded' end;
 end if;
 -- Live sales create one operator follow-up. Sandbox sales never create real
 -- leads/tasks/bookings (#396 contract). No automatic customer contact occurs.
 task:=old.canonical_task_id;
 if new.livemode and task is null and new.refunded_cents<new.amount_cents then
  select id into task from public.work_tasks where org_id=new.org_id and related_type='order' and related_id=canonical.id order by id limit 1;
 end if;
 if new.livemode and task is null and new.refunded_cents<new.amount_cents then
  insert into public.work_tasks(org_id,title,detail,related_type,related_id)
  values(new.org_id,left(case new.kind when 'physical' then 'Ship ' else 'Arrange service: ' end||new.title,300),
   'Paid storefront order. Review the seller order details and disputes before fulfillment.','order',canonical.id) returning id into task;
 end if;
 new.canonical_task_id:=task;
 if new.status='fulfilled' then
  update public.work_orders set state='fulfilled' where id=canonical.id and org_id=new.org_id and state in ('paid','in_production');
  if not found and canonical.state<>'fulfilled' then raise exception 'canonical order not fulfillable'; end if;
  if task is not null then update public.work_tasks set state='done',completed_at=coalesce(new.fulfilled_at,now()),detail=left(new.fulfillment_note,4000) where id=task and org_id=new.org_id; end if;
 elsif new.status='refunded' and task is not null then
  update public.work_tasks set state='done',completed_at=coalesce(completed_at,now()),detail='Cancelled: storefront payment refunded in full.' where id=task and org_id=new.org_id;
 end if;
 insert into public.control_audit(org_id,actor_kind,event,resource_type,resource_id,detail)
 values(new.org_id,'system','commerce.creator_store.synced','work_order',canonical.id::text,jsonb_build_object('creator_store_order_id',new.id,'state',new.status,'refunded_cents',new.refunded_cents,'livemode',new.livemode));
 perform set_config('mcc.creator_store_reconcile',coalesce(previous_context,''),true);
 return new;
end $$;
revoke all on function public.creator_store_sync_commerce() from public,anon,authenticated;
grant execute on function public.creator_store_sync_commerce() to service_role;
create trigger creator_store_canonical_sync before update of status,refunded_cents,fulfillment_note on public.creator_store_orders for each row execute function public.creator_store_sync_commerce();
