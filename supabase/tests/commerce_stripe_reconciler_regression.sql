-- Commerce reconciler regression: a paid Stripe checkout becomes lead +
-- order + provider-verified payment + the follow-up it implies, exactly once.
-- Runs inside a transaction that is rolled back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

-- Offerings shaped like the live catalogue, under test-only slugs.
insert into public.offerings (slug, site_id, brand_id, legal_entity_id, offering_type, revenue_type, title, price, price_type,
                              fulfillment_type, status, billing_interval)
values
  ('regress-print', 'here', 'mccluster', 'mccluster-corp', 'physical_product', 'product_sale', 'Print 11x14', 40, 'fixed', 'physical_shipping', 'live', null),
  ('regress-file', 'here', 'mccluster', 'mccluster-corp', 'digital_download', 'digital_sale', 'Full-resolution file', 40, 'fixed', 'digital_delivery', 'live', null),
  ('regress-deposit', 'here', 'mccluster', 'mccluster-corp', 'booking', 'booking_deposit', 'Booking deposit', null, 'custom', 'service_scheduling', 'live', null),
  ('regress-hosting', 'here', 'mccluster', 'mccluster-corp', 'service', 'service_fee', 'Hosting, one year', 360, 'fixed', 'none', 'live', null),
  ('regress-monthly', 'here', 'mccluster', 'mccluster-corp', 'subscription', 'subscription', 'Anti-Social M', 875, 'fixed', 'none', 'live', 'month');

do $$
declare
  r jsonb; again jsonb; house uuid; n int; o record; pay record; ren record;
begin
  select id into house from public.orgs where slug = 'mccluster';

  -- 1. A shipped print: lead created, paid order, verified payment, a task carrying the address.
  r := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_regressPRINT0001', 'payment_intent', 'pi_regressPRINT0001', 'offering', 'regress-print',
    'email', 'Buyer.One@Example.com', 'name', 'Buyer One', 'amount_cents', 4000, 'currency', 'usd', 'livemode', true,
    'paid_at', '2026-10-06T12:00:00Z',
    'shipping', jsonb_build_object('name', 'Buyer One', 'line1', '1 Main St', 'city', 'Bridgeport', 'state', 'CT', 'postal_code', '06604', 'country', 'US')));
  assert (r->>'created')::boolean, 'first delivery creates the records';
  assert (r->>'org_id')::uuid = house, 'a platform checkout belongs to the house org';
  select * into o from public.work_orders where id = (r->>'order_id')::uuid;
  assert o.state = 'paid' and o.amount_cents = 4000 and o.source_table = 'stripe_checkout' and o.livemode, 'paid live order';
  assert o.items->0->>'offering' = 'regress-print' and o.items->0->'shipping'->>'city' = 'Bridgeport', 'order carries the line and shipping';
  select * into pay from public.work_payments where id = (r->>'payment_id')::uuid;
  assert pay.verification = 'provider_verified' and pay.provider = 'stripe' and pay.provider_reference = 'pi_regressPRINT0001'
         and pay.state = 'paid' and pay.order_id = o.id and pay.lead_id = o.lead_id, 'provider-verified payment tied to order and lead';
  assert (select email from public.leads where id = o.lead_id) = 'buyer.one@example.com', 'buyer stored as a lead, email normalised';
  assert (select status from public.leads where id = o.lead_id) = 'confirmed', 'a paying buyer is a confirmed lead';
  assert (select detail from public.work_tasks where id = (r->>'task_id')::uuid) like 'Ship to: Buyer One, 1 Main St, Bridgeport, CT, 06604, US',
         'ship task carries the address';
  assert (select count(*) from public.control_audit where event = 'commerce.stripe.checkout_paid' and resource_id = o.id::text) = 1, 'audited';

  -- 2. The same webhook delivered again changes nothing.
  again := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_regressPRINT0001', 'payment_intent', 'pi_regressPRINT0001', 'offering', 'regress-print',
    'email', 'buyer.one@example.com', 'amount_cents', 4000, 'currency', 'usd', 'livemode', true));
  assert not (again->>'created')::boolean, 'a repeat delivery is recognised';
  assert again->>'order_id' = r->>'order_id' and again->>'payment_id' = r->>'payment_id', 'same order and payment';
  select count(*) into n from public.work_orders where source_id = 'cs_live_regressPRINT0001';
  assert n = 1, 'one order';
  select count(*) into n from public.work_payments where provider_reference = 'pi_regressPRINT0001';
  assert n = 1, 'one payment';
  select count(*) into n from public.work_tasks where related_id = (r->>'order_id')::uuid;
  assert n = 1, 'one task';

  -- 3. A second purchase by the same person reuses their lead.
  r := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_regressFILE0001', 'payment_intent', 'pi_regressFILE0001', 'offering', 'regress-file',
    'email', 'buyer.one@example.com', 'amount_cents', 4000, 'livemode', true));
  assert (select lead_id from public.work_orders where id = (r->>'order_id')::uuid) = o.lead_id, 'same buyer, same lead';
  assert (select title from public.work_tasks where id = (r->>'task_id')::uuid) = 'Deliver Full-resolution file to buyer.one@example.com', 'delivery task';

  -- 4. A booking deposit opens one proposed booking and a scheduling task.
  r := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_regressDEPOSIT01', 'payment_intent', 'pi_regressDEPOSIT01', 'offering', 'regress-deposit',
    'email', 'host@example.org', 'name', 'Event Host', 'amount_cents', 15000, 'livemode', true));
  assert (select state from public.work_bookings where id = (r->>'booking_id')::uuid) = 'proposed', 'booking proposed';
  assert (select order_id from public.work_bookings where id = (r->>'booking_id')::uuid) = (r->>'order_id')::uuid, 'booking tied to its order';
  assert (select related_type || ':' || related_id from public.work_tasks where id = (r->>'task_id')::uuid) = 'booking:' || (r->>'booking_id'), 'task points at the booking';

  -- 5. A service with no shipping: a follow-up task.
  r := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_regressHOST0001', 'payment_intent', 'pi_regressHOST0001', 'offering', 'regress-hosting',
    'email', 'site@example.net', 'amount_cents', 36000, 'livemode', true));
  assert (select title from public.work_tasks where id = (r->>'task_id')::uuid) = 'Follow up: Hosting, one year paid by site@example.net', 'follow-up task';

  -- 6. A subscription: renewal opened, then renewed by a later invoice, then ended.
  r := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_live_regressSUB00001', 'payment_intent', 'pi_regressSUB00001', 'invoice', 'in_regressSUB00001',
    'subscription', 'sub_regressSUB00001', 'current_period_end', '2026-11-06T12:00:00Z', 'offering', 'regress-monthly',
    'email', 'client@example.com', 'name', 'Client Co', 'amount_cents', 87500, 'livemode', true, 'paid_at', '2026-10-06T12:00:00Z'));
  select * into ren from public.work_renewals where id = (r->>'renewal_id')::uuid;
  assert ren.cadence = 'monthly' and ren.state = 'upcoming' and ren.renews_at = '2026-11-06T12:00:00Z' and ren.order_id = (r->>'order_id')::uuid,
         'monthly renewal tied to the order';
  assert r ? 'task_id', 'a new subscriber gets a follow-up task';
  again := public.commerce_record_stripe_invoice(jsonb_build_object('invoice_id', 'in_regressSUB00001', 'subscription', 'sub_regressSUB00001',
    'billing_reason', 'subscription_create', 'amount_cents', 87500));
  assert again ? 'skipped', 'the first invoice is the checkout, not a renewal';
  again := public.commerce_record_stripe_invoice(jsonb_build_object('invoice_id', 'in_regressSUB00002', 'payment_intent', 'pi_regressSUB00002',
    'subscription', 'sub_regressSUB00001', 'billing_reason', 'subscription_cycle', 'amount_cents', 87500, 'paid_at', '2026-11-06T12:00:00Z',
    'period_end', '2026-12-06T12:00:00Z', 'livemode', true));
  assert (again->>'created')::boolean, 'renewal payment recorded';
  select * into ren from public.work_renewals where id = ren.id;
  assert ren.last_renewed_at = '2026-11-06T12:00:00Z' and ren.renews_at = '2026-12-06T12:00:00Z', 'renewal dates advance';
  assert (select renewal_id from public.work_payments where id = (again->>'payment_id')::uuid) = ren.id, 'renewal payment linked';
  again := public.commerce_record_stripe_invoice(jsonb_build_object('invoice_id', 'in_regressSUB00002', 'payment_intent', 'pi_regressSUB00002',
    'subscription', 'sub_regressSUB00001', 'billing_reason', 'subscription_cycle', 'amount_cents', 87500));
  assert not (again->>'created')::boolean, 'a repeated invoice event records nothing new';
  again := public.commerce_record_stripe_invoice(jsonb_build_object('invoice_id', 'in_regressOTHER001', 'subscription', 'sub_regressUNKNOWN1',
    'billing_reason', 'subscription_cycle', 'amount_cents', 100));
  assert again ? 'skipped', 'a subscription not sold through an offering is left alone';
  again := public.commerce_record_stripe_subscription_ended(jsonb_build_object('subscription', 'sub_regressSUB00001'));
  assert (again->>'matched')::boolean and (select state from public.work_renewals where id = ren.id) = 'cancelled', 'subscription end cancels the renewal';

  -- 7. Refunds: partial keeps the payment paid; full refunds it and cancels the order.
  again := public.commerce_record_stripe_refund(jsonb_build_object('payment_intent', 'pi_regressHOST0001', 'amount_cents', 36000, 'amount_refunded', 10000));
  assert (again->>'matched')::boolean and not (again->>'full')::boolean, 'partial refund matched';
  assert (select state from public.work_payments where provider_reference = 'pi_regressHOST0001') = 'paid', 'partial refund keeps it paid';
  again := public.commerce_record_stripe_refund(jsonb_build_object('payment_intent', 'pi_regressHOST0001', 'amount_cents', 36000, 'amount_refunded', 36000));
  assert (select state from public.work_payments where provider_reference = 'pi_regressHOST0001') = 'refunded', 'full refund';
  assert (select o2.state from public.work_orders o2 join public.work_payments p2 on p2.order_id = o2.id
          where p2.provider_reference = 'pi_regressHOST0001') = 'cancelled', 'refunded order cancelled';
  again := public.commerce_record_stripe_refund(jsonb_build_object('payment_intent', 'pi_regressNOMATCH01', 'amount_cents', 1, 'amount_refunded', 1));
  assert not (again->>'matched')::boolean, 'a refund for a payment we never recorded is reported, not invented';

  -- 8. Test mode is recorded but can never pass for revenue.
  r := public.commerce_record_stripe_checkout(jsonb_build_object(
    'session_id', 'cs_test_regressTEST0001', 'payment_intent', 'pi_regressTEST0001', 'offering', 'regress-print',
    'email', 'tester@example.com', 'amount_cents', 4000, 'livemode', false));
  assert not (select livemode from public.work_orders where id = (r->>'order_id')::uuid), 'test order flagged';
  assert not (select livemode from public.work_payments where id = (r->>'payment_id')::uuid), 'test payment flagged';
  assert (select title from public.work_orders where id = (r->>'order_id')::uuid) like 'TEST · %', 'test order titled as test';

  -- 9. Bad input is refused before anything is written.
  begin
    perform public.commerce_record_stripe_checkout(jsonb_build_object('session_id', 'not-a-session', 'amount_cents', 1));
    raise exception 'accepted a bad session id';
  exception when raise_exception then
    if sqlerrm = 'accepted a bad session id' then raise; end if;
  end;
  begin
    perform public.commerce_record_stripe_checkout(jsonb_build_object('session_id', 'cs_live_regressNEG00001', 'amount_cents', -1));
    raise exception 'accepted a negative amount';
  exception when raise_exception then
    if sqlerrm = 'accepted a negative amount' then raise; end if;
  end;
  select count(*) into n from public.work_orders where source_id = 'cs_live_regressNEG00001';
  assert n = 0, 'nothing written for refused input';

  -- 10. Only the server may call these.
  assert not has_function_privilege('anon', 'public.commerce_record_stripe_checkout(jsonb)', 'execute'), 'anon cannot record sales';
  assert not has_function_privilege('authenticated', 'public.commerce_record_stripe_checkout(jsonb)', 'execute'), 'members cannot record sales';
  assert not has_function_privilege('authenticated', 'public.commerce_record_stripe_refund(jsonb)', 'execute'), 'members cannot record refunds';
  assert has_function_privilege('service_role', 'public.commerce_record_stripe_checkout(jsonb)', 'execute'), 'the webhook can';

  raise notice 'commerce reconciler regression: all assertions passed';
end $$;

rollback;
