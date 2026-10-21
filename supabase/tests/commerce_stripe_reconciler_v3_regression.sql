-- Commerce reconciler v3 regression (supabase/pending/commerce_stripe_reconciler_v3.sql).
-- Runs after v3 is applied, inside a transaction that is rolled back.
-- The concurrent half of the deferral fix (two sessions racing) is in
-- supabase/tests/commerce_stripe_concurrency.sh.
\set ON_ERROR_STOP on
begin;

insert into public.offerings (slug, site_id, brand_id, legal_entity_id, offering_type, revenue_type, title, price, price_type,
                              fulfillment_type, status, billing_interval)
values
  ('v3-print', 'here', 'mccluster', 'mccluster-corp', 'physical_product', 'product_sale', 'Print 11x14', 40, 'fixed', 'physical_shipping', 'live', null),
  ('v3-deposit', 'here', 'mccluster', 'mccluster-corp', 'booking', 'booking_deposit', 'Booking deposit', null, 'custom', 'service_scheduling', 'live', null),
  ('v3-monthly', 'here', 'mccluster', 'mccluster-corp', 'subscription', 'subscription', 'Anti-Social M', 875, 'fixed', 'none', 'live', 'month');

do $$
declare
  r jsonb; again jsonb; house uuid; n int; pay record; owner_order uuid; owner_pay uuid; ren uuid;
begin
  select id into house from public.orgs where slug = 'mccluster';

  -- 12. The owner typed the payment in Control before the webhook landed: the
  --     row is promoted to Stripe's facts and linked to the verified order.
  insert into public.work_orders (org_id, title, state, amount_cents) values (house, 'Owner-made order', 'open', 3500)
  returning id into owner_order;
  insert into public.work_payments (org_id, title, state, amount_cents, currency, provider, provider_reference, verification, order_id, note)
  values (house, 'Typed by owner', 'due', 3500, 'usd', 'stripe', 'pi_v3OWNERTYPED01', 'owner_recorded', owner_order, 'Zelle? no, card')
  returning id into owner_pay;
  r := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_v3OWNERTYPED01', 'payment_intent', 'pi_v3OWNERTYPED01', 'offering', 'v3-print',
    'email', 'typed@example.com', 'amount_cents', 4000, 'livemode', true, 'paid_at', '2026-10-07T12:00:00Z'));
  assert (r->>'payment_id')::uuid = owner_pay, 'the typed row is reused, not shadowed';
  assert (r->>'payment_promoted')::boolean, 'the checkout reports the promotion';
  select * into pay from public.work_payments where id = owner_pay;
  assert pay.verification = 'provider_verified' and pay.state = 'paid' and pay.amount_cents = 4000
         and pay.paid_at = '2026-10-07T12:00:00Z' and pay.order_id = (r->>'order_id')::uuid, 'Stripe''s facts win and the verified order owns it';
  assert pay.note like 'Zelle? no, card · Verified by Stripe; the owner had recorded 3500 usd (due) on order %', 'what the owner typed is kept';
  assert (select count(*) from public.control_audit where event = 'commerce.stripe.payment_promoted' and resource_id = owner_pay::text) = 1, 'promotion audited';
  again := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_v3OWNERTYPED01', 'payment_intent', 'pi_v3OWNERTYPED01', 'offering', 'v3-print',
    'email', 'typed@example.com', 'amount_cents', 4000, 'livemode', true));
  assert not (again ? 'payment_promoted') and again->>'payment_id' = owner_pay::text, 'a repeated delivery promotes nothing twice';
  assert (select count(*) from public.control_audit where event = 'commerce.stripe.payment_promoted' and resource_id = owner_pay::text) = 1, 'still one promotion';

  -- 13. Partial refunds are money: refunded_cents holds Stripe's amount_refunded,
  --     repeats and late older events change nothing, the last refund completes it.
  r := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_v3PARTIAL0001', 'payment_intent', 'pi_v3PARTIAL0001', 'offering', 'v3-print',
    'email', 'partial@example.com', 'amount_cents', 10000, 'livemode', true));
  again := public.commerce_record_stripe_refund(jsonb_build_object('payment_intent', 'pi_v3PARTIAL0001', 'amount_cents', 10000, 'amount_refunded', 2500, 'livemode', true));
  assert (again->>'changed')::boolean and not (again->>'full')::boolean, 'first partial refund applied';
  select * into pay from public.work_payments where id = (r->>'payment_id')::uuid;
  assert pay.state = 'paid' and pay.refunded_cents = 2500, 'partly refunded money is counted';
  again := public.commerce_record_stripe_refund(jsonb_build_object('payment_intent', 'pi_v3PARTIAL0001', 'amount_cents', 10000, 'amount_refunded', 2500, 'livemode', true));
  assert not (again->>'changed')::boolean, 'the same refund delivered again changes nothing';
  again := public.commerce_record_stripe_refund(jsonb_build_object('payment_intent', 'pi_v3PARTIAL0001', 'amount_cents', 10000, 'amount_refunded', 1000, 'livemode', true));
  assert not (again->>'changed')::boolean, 'an older, smaller refund arriving late changes nothing';
  select * into pay from public.work_payments where id = (r->>'payment_id')::uuid;
  assert pay.refunded_cents = 2500 and (length(pay.note) - length(replace(pay.note, 'Partly refunded', ''))) / length('Partly refunded') = 1,
         'one note per real change';
  again := public.commerce_record_stripe_refund(jsonb_build_object('payment_intent', 'pi_v3PARTIAL0001', 'amount_cents', 10000, 'amount_refunded', 10000, 'livemode', true));
  select * into pay from public.work_payments where id = (r->>'payment_id')::uuid;
  assert pay.state = 'refunded' and pay.refunded_cents = 10000, 'the rest refunded: payment refunded';
  assert (select state from public.work_orders where id = (r->>'order_id')::uuid) = 'cancelled', 'its order cancelled';

  -- 14. A refund of a renewal payment that beats its invoice is applied by the invoice.
  r := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_v3SUBSCRIBE01', 'payment_intent', 'pi_v3SUBSCRIBE01', 'subscription', 'sub_v3SUBSCRIBE01',
    'current_period_end', '2026-11-07T12:00:00Z', 'offering', 'v3-monthly', 'email', 'sub@example.com',
    'amount_cents', 87500, 'livemode', true, 'paid_at', '2026-10-07T12:00:00Z'));
  ren := (r->>'renewal_id')::uuid;
  again := public.commerce_record_stripe_refund(jsonb_build_object('payment_intent', 'pi_v3RENEWAL00002', 'amount_cents', 87500, 'amount_refunded', 87500, 'livemode', true));
  assert (again->>'deferred')::boolean, 'renewal refund before its invoice waits';
  again := public.commerce_record_stripe_invoice(jsonb_build_object('invoice_id', 'in_v3RENEWAL00002', 'payment_intent', 'pi_v3RENEWAL00002',
    'subscription', 'sub_v3SUBSCRIBE01', 'billing_reason', 'subscription_cycle', 'amount_cents', 87500,
    'paid_at', '2026-11-07T12:00:00Z', 'period_end', '2026-12-07T12:00:00Z', 'livemode', true));
  assert (again->>'created')::boolean, 'renewal recorded';
  select * into pay from public.work_payments where id = (again->>'payment_id')::uuid;
  assert pay.renewal_id = ren and pay.state = 'refunded' and pay.refunded_cents = 87500, 'the early refund is applied to the renewal payment';
  assert (select applied_at is not null from public.commerce_stripe_pending where kind = 'refund' and reference = 'pi_v3RENEWAL00002'), 'applied once';

  -- 15. Every delivery order and repeat of one sale ends in the same ledger.
  --     refund → checkout → checkout again → refund again
  again := public.commerce_record_stripe_refund(jsonb_build_object('payment_intent', 'pi_v3SHUFFLE00001', 'amount_cents', 4000, 'amount_refunded', 1500, 'livemode', true));
  r := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_v3SHUFFLE00001', 'payment_intent', 'pi_v3SHUFFLE00001', 'offering', 'v3-print',
    'email', 'shuffle@example.com', 'amount_cents', 4000, 'livemode', true));
  again := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_v3SHUFFLE00001', 'payment_intent', 'pi_v3SHUFFLE00001', 'offering', 'v3-print',
    'email', 'shuffle@example.com', 'amount_cents', 4000, 'livemode', true));
  again := public.commerce_record_stripe_refund(jsonb_build_object('payment_intent', 'pi_v3SHUFFLE00001', 'amount_cents', 4000, 'amount_refunded', 1500, 'livemode', true));
  select count(*) into n from public.work_orders where source_id = 'cs_live_v3SHUFFLE00001';
  assert n = 1, 'one order whatever the order of delivery';
  select count(*) into n from public.work_payments where provider_reference = 'pi_v3SHUFFLE00001';
  assert n = 1, 'one payment';
  select * into pay from public.work_payments where provider_reference = 'pi_v3SHUFFLE00001';
  assert pay.state = 'paid' and pay.refunded_cents = 1500, 'early partial refund applied exactly once';
  select count(*) into n from public.work_tasks where related_id = (r->>'order_id')::uuid;
  assert n = 1, 'one follow-up task';

  --     ending → renewal invoice → checkout → invoice again → ending again
  again := public.commerce_record_stripe_subscription_ended(jsonb_build_object('subscription', 'sub_v3SHUFFLE00002', 'livemode', true));
  again := public.commerce_record_stripe_invoice(jsonb_build_object('invoice_id', 'in_v3SHUFFLE00002', 'payment_intent', 'pi_v3SHUFFLE0002B',
    'subscription', 'sub_v3SHUFFLE00002', 'billing_reason', 'subscription_cycle', 'amount_cents', 87500,
    'paid_at', '2026-11-07T12:00:00Z', 'period_end', '2026-12-07T12:00:00Z', 'livemode', true));
  r := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_v3SHUFFLE00002', 'payment_intent', 'pi_v3SHUFFLE0002A', 'subscription', 'sub_v3SHUFFLE00002',
    'current_period_end', '2026-11-07T12:00:00Z', 'offering', 'v3-monthly', 'email', 'shuffle2@example.com',
    'amount_cents', 87500, 'livemode', true, 'paid_at', '2026-10-07T12:00:00Z'));
  again := public.commerce_record_stripe_invoice(jsonb_build_object('invoice_id', 'in_v3SHUFFLE00002', 'payment_intent', 'pi_v3SHUFFLE0002B',
    'subscription', 'sub_v3SHUFFLE00002', 'billing_reason', 'subscription_cycle', 'amount_cents', 87500, 'livemode', true));
  again := public.commerce_record_stripe_subscription_ended(jsonb_build_object('subscription', 'sub_v3SHUFFLE00002', 'livemode', true));
  select count(*) into n from public.work_payments where renewal_id = (r->>'renewal_id')::uuid;
  assert n = 1, 'one renewal payment despite the repeat';
  assert (select state from public.work_renewals where id = (r->>'renewal_id')::uuid) = 'cancelled', 'ended';
  assert (select renews_at from public.work_renewals where id = (r->>'renewal_id')::uuid) = '2026-12-07T12:00:00Z', 'dates advanced by the renewal';
  select count(*) into n from public.commerce_stripe_pending where reference in ('sub_v3SHUFFLE00002', 'in_v3SHUFFLE00002') and applied_at is null;
  assert n = 0, 'nothing left waiting';

  -- 16. Test mode: flagged, refundable, and outside every live total.
  r := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_test_v3TESTONLY001', 'payment_intent', 'pi_v3TESTONLY001', 'offering', 'v3-deposit',
    'email', 'tester@example.com', 'amount_cents', 15000, 'livemode', false));
  again := public.commerce_record_stripe_refund(jsonb_build_object('payment_intent', 'pi_v3TESTONLY001', 'amount_cents', 15000, 'amount_refunded', 5000, 'livemode', false));
  select * into pay from public.work_payments where id = (r->>'payment_id')::uuid;
  assert not pay.livemode and pay.refunded_cents = 5000 and pay.title like 'TEST · %', 'a test payment is flagged and still reconciles';
  assert not (r ? 'booking_id') and not (r ? 'task_id') and not (r ? 'lead_id'), 'a test deposit books nobody and queues nothing';
  assert (select coalesce(sum(amount_cents - refunded_cents), 0) from public.work_payments
           where org_id = house and livemode and state = 'paid' and provider_reference like 'pi_v3TEST%') = 0,
         'live net revenue never includes a test payment';

  -- 17. Only the server may call the new helpers.
  assert not has_function_privilege('anon', 'public.commerce_upsert_stripe_payment(uuid, jsonb)', 'execute'), 'anon cannot write payments';
  assert not has_function_privilege('authenticated', 'public.commerce_upsert_stripe_payment(uuid, jsonb)', 'execute'), 'members cannot write payments';
  assert not has_function_privilege('authenticated', 'public.commerce_stripe_lock(text, text)', 'execute'), 'members cannot hold reconciler locks';
  assert has_function_privilege('service_role', 'public.commerce_upsert_stripe_payment(uuid, jsonb)', 'execute'), 'the webhook path can';

  raise notice 'commerce reconciler v3 regression: all assertions passed';
end $$;

rollback;
