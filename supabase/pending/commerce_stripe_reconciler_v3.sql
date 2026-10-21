-- Commerce reconciler v3: concurrent Stripe deliveries serialise, a payment
-- the owner typed in is promoted instead of shadowed, and a partial refund is
-- money, not only a note.
--
-- 1. Deferral vs. replay (review of #376, P1). v2 kept a refund, renewal
--    invoice or cancellation that arrived before its checkout, and the
--    checkout applied it. But the checkout locked only its session, and the
--    dependent functions took no lock: a refund could look for its payment
--    before the checkout inserted it, while the checkout looked for deferred
--    events before the refund committed its row. The refund was then
--    deferred after the replay had run, marked processed in stripe_events,
--    and never applied. Every function now takes the same transaction
--    advisory locks in one order (subscription, then payment reference), so
--    a deferral and its replay can only happen one after the other.
--
-- 2. Owner-recorded collision (review of #376, P2). If the owner had already
--    entered the same Stripe PaymentIntent in Control, the insert conflicted
--    and the checkout silently reused that row: still owner_recorded, with
--    the typed amount and state, and not linked to the new order. A matching
--    owner_recorded row is now promoted to provider_verified with Stripe's
--    amount, currency, state and date, linked to the verified order; what the
--    owner typed is kept in its note and audited. A row Stripe already
--    verified is left alone (a repeated delivery).
--
-- 3. Partial refunds. v2 noted "Partly refunded: x of y cents" and kept the
--    full amount as paid, so revenue overstated every partial refund, and a
--    repeated delivery appended the note again. work_payments.refunded_cents
--    now holds Stripe's amount_refunded (it only grows); net received is
--    amount_cents - refunded_cents, and the note changes only when the amount
--    refunded does. A refund that arrives before its renewal invoice is
--    applied by that invoice.
--
-- The RPC names and arguments the stripe-webhook function calls are
-- unchanged, so the deployed function works before and after this applies.
-- Service role only, like v1 and v2.

set local lock_timeout = '5s';

alter table public.work_payments add column if not exists refunded_cents integer not null default 0;
alter table public.work_payments drop constraint if exists work_payments_refunded_cents_check;
alter table public.work_payments add constraint work_payments_refunded_cents_check check (refunded_cents >= 0);
comment on column public.work_payments.refunded_cents is
  'Refunded at the provider (Stripe charge.amount_refunded; only grows). Net received = amount_cents - refunded_cents.';

-- What v1/v2 already recorded: a full refund is the whole amount; a partial
-- one is the largest amount its notes name.
update public.work_payments w
   set refunded_cents = case
         when w.state = 'refunded' then w.amount_cents
         else coalesce((select max((m[1])::integer) from regexp_matches(w.note, 'Partly refunded: ([0-9]+) of', 'g') m), 0)
       end
 where w.provider = 'stripe' and w.verification = 'provider_verified' and w.refunded_cents = 0
   and (w.state = 'refunded' or w.note ~ 'Partly refunded: ');

/* The one lock order every Stripe reconciler function follows: the
   subscription first, then the payment reference. Advisory transaction locks
   are re-entrant, so a checkout that replays a deferred invoice or refund
   (which take the same locks again) does not wait on itself. */
create or replace function public.commerce_stripe_lock(p_subscription text, p_reference text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if nullif(p_subscription, '') is not null then
    perform pg_advisory_xact_lock(hashtext('commerce:stripe_subscription:' || p_subscription));
  end if;
  if nullif(p_reference, '') is not null then
    perform pg_advisory_xact_lock(hashtext('commerce:stripe_reference:' || p_reference));
  end if;
end;
$$;

/* Record one Stripe-verified payment. p: title, amount_cents, currency,
   reference, lead_id, order_id, renewal_id, paid_at, livemode, note.
   Returns payment_id, created, promoted. A row the owner recorded for the
   same PaymentIntent is promoted to provider_verified with Stripe's facts. */
create or replace function public.commerce_upsert_stripe_payment(p_org uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref     text := nullif(p->>'reference', '');
  v_amount  integer := (p->>'amount_cents')::integer;
  v_cur     text := lower(coalesce(nullif(p->>'currency', ''), 'usd'));
  v_paid_at timestamptz := coalesce(nullif(p->>'paid_at', '')::timestamptz, now());
  v_live    boolean := coalesce((p->>'livemode')::boolean, true);
  v_id      uuid;
  v_old     record;
begin
  if v_ref is null then raise exception 'a Stripe payment needs its reference'; end if;
  insert into public.work_payments (org_id, title, state, amount_cents, currency, provider, provider_reference,
                                    verification, lead_id, order_id, renewal_id, paid_at, livemode, note)
  values (p_org, left(p->>'title', 300), 'paid', v_amount, v_cur, 'stripe', v_ref,
          'provider_verified', nullif(p->>'lead_id', '')::uuid, nullif(p->>'order_id', '')::uuid,
          nullif(p->>'renewal_id', '')::uuid, v_paid_at, v_live, left(p->>'note', 4000))
  on conflict (org_id, provider, provider_reference) where provider_reference is not null do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('payment_id', v_id, 'created', true, 'promoted', false);
  end if;

  select id, verification, state, amount_cents, currency, paid_at, note, order_id, lead_id, renewal_id, livemode
    into v_old
    from public.work_payments
   where org_id = p_org and provider = 'stripe' and provider_reference = v_ref
   for update;
  if v_old.verification = 'provider_verified' then
    return jsonb_build_object('payment_id', v_old.id, 'created', false, 'promoted', false);
  end if;

  update public.work_payments
     set verification = 'provider_verified',
         state = 'paid',
         amount_cents = v_amount,
         currency = v_cur,
         paid_at = v_paid_at,
         livemode = v_live,
         title = left(p->>'title', 300),
         order_id = coalesce(nullif(p->>'order_id', '')::uuid, v_old.order_id),
         lead_id = coalesce(nullif(p->>'lead_id', '')::uuid, v_old.lead_id),
         renewal_id = coalesce(nullif(p->>'renewal_id', '')::uuid, v_old.renewal_id),
         note = left(concat_ws(' · ', v_old.note,
                  'Verified by Stripe; the owner had recorded ' || v_old.amount_cents || ' ' || v_old.currency
                  || ' (' || v_old.state || ')'
                  || case when v_old.order_id is not null and v_old.order_id is distinct from nullif(p->>'order_id', '')::uuid
                          then ' on order ' || v_old.order_id else '' end), 4000)
   where id = v_old.id;
  insert into public.control_audit (org_id, actor_kind, event, resource_type, resource_id, detail)
  values (p_org, 'system', 'commerce.stripe.payment_promoted', 'work_payment', v_old.id::text,
          jsonb_strip_nulls(jsonb_build_object(
            'reference', v_ref,
            'owner_recorded', jsonb_build_object('amount_cents', v_old.amount_cents, 'currency', v_old.currency,
                                                 'state', v_old.state, 'paid_at', v_old.paid_at, 'order_id', v_old.order_id),
            'provider', jsonb_build_object('amount_cents', v_amount, 'currency', v_cur, 'paid_at', v_paid_at,
                                           'order_id', nullif(p->>'order_id', '')::uuid, 'livemode', v_live))));
  return jsonb_build_object('payment_id', v_old.id, 'created', false, 'promoted', true);
end;
$$;

/* A completed, paid checkout session (see v1/v2 for p). v3: takes the
   subscription and payment-reference locks before the session lock, and
   records its payment through commerce_upsert_stripe_payment. */
create or replace function public.commerce_record_stripe_checkout(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session   text := nullif(p->>'session_id', '');
  v_email     text := lower(nullif(btrim(p->>'email'), ''));
  v_name      text := nullif(btrim(p->>'name'), '');
  v_amount    integer := (p->>'amount_cents')::integer;
  v_currency  text := lower(coalesce(nullif(p->>'currency', ''), 'usd'));
  v_live      boolean := coalesce((p->>'livemode')::boolean, true);
  v_paid_at   timestamptz := coalesce(nullif(p->>'paid_at', '')::timestamptz, now());
  v_reference text := coalesce(nullif(p->>'payment_intent', ''), nullif(p->>'invoice', ''), nullif(p->>'session_id', ''));
  v_sub       text := nullif(p->>'subscription', '');
  v_kind      text := nullif(p->>'kind', '');
  v_org       uuid;
  v_off       record;
  v_label     text;
  v_who       text;
  v_title     text;
  v_lead      uuid;
  v_order     uuid;
  v_payment   uuid;
  v_paid      jsonb;
  v_booking   uuid;
  v_renewal   uuid;
  v_task      uuid;
  v_created   boolean := false;
  v_ship      jsonb := case when jsonb_typeof(p->'shipping') = 'object' then p->'shipping' else null end;
  v_address   text;
  v_pending   record;
  v_applied   jsonb := '[]'::jsonb;
begin
  if v_session is null or v_session !~ '^cs_(test|live)_[A-Za-z0-9]{8,200}$' then
    raise exception 'invalid checkout session id';
  end if;
  if v_amount is null or v_amount < 0 then raise exception 'invalid amount'; end if;
  if v_currency !~ '^[a-z]{3}$' then raise exception 'invalid currency'; end if;
  if v_email is not null and v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then v_email := null; end if;

  v_org := public.commerce_resolve_org(p->>'org_id');
  -- the shared order first (a refund, invoice or ending of this sale waits
  -- here or is waited for), then one delivery at a time per session
  perform public.commerce_stripe_lock(v_sub, v_reference);
  perform pg_advisory_xact_lock(hashtext('commerce:stripe_checkout:' || v_session));

  select slug, title, revenue_type, fulfillment_type, billing_interval into v_off
    from public.offerings where slug = nullif(p->>'offering', '');
  v_label := coalesce(
    v_off.title,
    case when v_kind = 'music_license_sale' then 'Music license' end,
    nullif(p->>'offering', ''),
    'Stripe checkout'
  );
  v_who := coalesce(v_name, v_email, 'a customer');
  v_title := left((case when v_live then '' else 'TEST · ' end) || v_label || ' · ' || v_who, 300);

  select id, lead_id into v_order, v_lead
    from public.work_orders
   where org_id = v_org and source_table = 'stripe_checkout' and source_id = v_session;

  if v_order is null then
    v_created := true;

    -- a test buyer is not a lead: nobody should be contacted about a test
    if v_live and v_email is not null then
      select id into v_lead from public.leads
       where org_id = v_org and lower(email) = v_email
       order by at desc limit 1;
      if v_lead is null then
        insert into public.leads (name, email, want, note, page, source, status, org_id)
        values (left(coalesce(v_name, split_part(v_email, '@', 1)), 200), v_email, left(v_label, 500),
                'Paid via Stripe checkout', 'pay.html', 'stripe_checkout', 'confirmed', v_org)
        returning id into v_lead;
      else
        -- a paying buyer is confirmed; later pipeline states are left alone
        update public.leads set status = 'confirmed'
         where id = v_lead and status in ('new', 'needs-reply', 'replied', 'qualified');
      end if;
    end if;

    insert into public.work_orders (org_id, lead_id, title, state, amount_cents, currency, items,
                                    source_table, source_id, placed_at, livemode)
    values (v_org, v_lead, v_title, 'paid', v_amount, v_currency,
            jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
              'offering', v_off.slug, 'kind', v_kind, 'title', v_label, 'quantity', 1,
              'revenue_type', v_off.revenue_type, 'fulfillment_type', v_off.fulfillment_type,
              'billing_interval', v_off.billing_interval, 'shipping', v_ship))),
            'stripe_checkout', v_session, v_paid_at, v_live)
    returning id into v_order;
  end if;

  v_paid := public.commerce_upsert_stripe_payment(v_org, jsonb_build_object(
    'title', v_title, 'amount_cents', v_amount, 'currency', v_currency, 'reference', v_reference,
    'lead_id', v_lead, 'order_id', v_order, 'paid_at', v_paid_at, 'livemode', v_live,
    'note', 'Stripe checkout ' || v_session));
  v_payment := (v_paid->>'payment_id')::uuid;

  -- what a live sale sets in motion, decided once, when the order is new
  if v_created and v_live then
    if v_sub is not null and v_off.billing_interval in ('month', 'year') then
      insert into public.work_renewals (org_id, title, state, cadence, order_id, amount_cents, currency,
                                        renews_at, last_renewed_at, source_table, source_id, livemode)
      values (v_org, v_title, 'upcoming',
              case v_off.billing_interval when 'month' then 'monthly' else 'annual' end,
              v_order, v_amount, v_currency, nullif(p->>'current_period_end', '')::timestamptz, v_paid_at,
              'stripe_subscription', v_sub, v_live)
      on conflict (org_id, source_table, source_id) where source_id is not null do nothing
      returning id into v_renewal;
    end if;

    if v_off.fulfillment_type = 'service_scheduling' then
      insert into public.work_bookings (org_id, lead_id, title, state, order_id, note)
      values (v_org, v_lead, v_title, 'proposed', v_order, 'Deposit paid. Agree a time with ' || v_who || '.')
      on conflict (order_id) where order_id is not null do nothing
      returning id into v_booking;
      if v_booking is not null then
        insert into public.work_tasks (org_id, title, detail, related_type, related_id)
        values (v_org, left('Schedule ' || v_who || ' · ' || v_label, 300),
                coalesce('Reach them at ' || v_email || '.', null), 'booking', v_booking)
        returning id into v_task;
      end if;
    elsif v_off.fulfillment_type = 'physical_shipping' then
      v_address := concat_ws(', ',
        nullif(v_ship->>'name', ''), nullif(v_ship->>'line1', ''), nullif(v_ship->>'line2', ''),
        nullif(v_ship->>'city', ''), nullif(v_ship->>'state', ''), nullif(v_ship->>'postal_code', ''),
        nullif(v_ship->>'country', ''));
      insert into public.work_tasks (org_id, title, detail, related_type, related_id)
      values (v_org, left('Ship ' || v_label || ' to ' || v_who, 300),
              left(coalesce('Ship to: ' || nullif(v_address, ''), 'No shipping address was collected.'), 4000),
              'order', v_order)
      returning id into v_task;
    elsif v_off.fulfillment_type = 'digital_delivery' then
      insert into public.work_tasks (org_id, title, detail, related_type, related_id)
      values (v_org, left('Deliver ' || v_label || ' to ' || coalesce(v_email, v_who), 300),
              'Paid. Send the file and mark this done.', 'order', v_order)
      returning id into v_task;
    elsif v_off.slug is not null then
      insert into public.work_tasks (org_id, title, detail, related_type, related_id)
      values (v_org, left('Follow up: ' || v_label || ' paid by ' || v_who, 300),
              'Paid in full. Start the work or match this payment to its invoice.', 'order', v_order)
      returning id into v_task;
    end if;
  end if;

  insert into public.control_audit (org_id, actor_kind, event, resource_type, resource_id, detail)
  values (v_org, 'system', 'commerce.stripe.checkout_paid', 'work_order', v_order::text,
          jsonb_strip_nulls(jsonb_build_object(
            'session', v_session, 'reference', v_reference, 'created', v_created, 'livemode', v_live,
            'amount_cents', v_amount, 'currency', v_currency, 'offering', v_off.slug, 'kind', v_kind,
            'lead_id', v_lead, 'payment_id', v_payment, 'payment_promoted', (v_paid->>'promoted')::boolean,
            'booking_id', v_booking, 'renewal_id', v_renewal, 'task_id', v_task)));

  -- events that arrived before this checkout: renewals first, then refunds and endings
  if v_live then
    for v_pending in
      select id, kind, payload from public.commerce_stripe_pending
       where org_id = v_org and applied_at is null
         and ((kind = 'refund' and reference = v_reference)
           or (kind = 'invoice' and payload->>'subscription' = v_sub)
           or (kind = 'subscription_ended' and reference = v_sub))
       order by case kind when 'invoice' then 0 when 'refund' then 1 else 2 end, received_at
       for update
    loop
      update public.commerce_stripe_pending set applied_at = now() where id = v_pending.id;
      if v_pending.kind = 'invoice' then
        perform public.commerce_record_stripe_invoice(v_pending.payload);
      elsif v_pending.kind = 'refund' then
        perform public.commerce_record_stripe_refund(v_pending.payload);
      else
        perform public.commerce_record_stripe_subscription_ended(v_pending.payload);
      end if;
      v_applied := v_applied || to_jsonb(v_pending.kind);
    end loop;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'created', v_created, 'org_id', v_org, 'order_id', v_order, 'payment_id', v_payment, 'lead_id', v_lead,
    'payment_promoted', case when (v_paid->>'promoted')::boolean then true end,
    'booking_id', v_booking, 'renewal_id', v_renewal, 'task_id', v_task,
    'applied_pending', case when jsonb_array_length(v_applied) > 0 then v_applied end));
end;
$$;

/* A Stripe refund (see v2 for p). v3: takes the payment-reference lock,
   keeps Stripe's amount_refunded in refunded_cents, and changes nothing when
   a delivery reports no more refunded than is already recorded (a repeat, or
   an older event arriving late). */
create or replace function public.commerce_record_stripe_refund(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref      text := nullif(p->>'payment_intent', '');
  v_amount   integer := coalesce((p->>'amount_cents')::integer, 0);
  v_refunded integer := coalesce((p->>'amount_refunded')::integer, 0);
  v_live     boolean := coalesce((p->>'livemode')::boolean, true);
  v_org      uuid;
  v_pay      record;
  v_full     boolean;
begin
  if v_ref is null or v_ref !~ '^pi_[A-Za-z0-9]{8,200}$' then raise exception 'invalid payment intent'; end if;
  if v_refunded < 0 or v_amount < 0 then raise exception 'invalid refund amount'; end if;
  v_org := public.commerce_resolve_org(p->>'org_id');
  perform public.commerce_stripe_lock(null, v_ref);
  select id, order_id, state, note, amount_cents, refunded_cents into v_pay from public.work_payments
   where org_id = v_org and provider = 'stripe' and provider_reference = v_ref
   for update;
  if v_pay.id is null then
    if v_live then
      perform public.commerce_defer_stripe_event(v_org, 'refund', v_ref, p);
      return jsonb_build_object('matched', false, 'deferred', true);
    end if;
    return jsonb_build_object('matched', false);
  end if;
  v_full := v_refunded > 0 and v_refunded >= coalesce(nullif(v_amount, 0), v_pay.amount_cents);
  if v_refunded <= v_pay.refunded_cents then
    return jsonb_build_object('matched', true, 'payment_id', v_pay.id, 'full', v_pay.state = 'refunded', 'changed', false);
  end if;
  update public.work_payments
     set refunded_cents = v_refunded,
         state = case when v_full then 'refunded' else state end,
         note = left(concat_ws(' · ', note,
                  case when v_full then 'Refunded in full' else 'Partly refunded: ' || v_refunded || ' of ' || v_amount || ' cents' end), 4000)
   where id = v_pay.id;
  if v_full and v_pay.order_id is not null then
    update public.work_orders set state = 'cancelled'
     where id = v_pay.order_id and state in ('open', 'paid', 'in_production');
  end if;
  insert into public.control_audit (org_id, actor_kind, event, resource_type, resource_id, detail)
  values (v_org, 'system', 'commerce.stripe.refund', 'work_payment', v_pay.id::text,
          jsonb_build_object('reference', v_ref, 'amount_cents', v_amount, 'amount_refunded', v_refunded, 'full', v_full,
                             'previous_state', v_pay.state, 'previous_refunded_cents', v_pay.refunded_cents));
  return jsonb_build_object('matched', true, 'payment_id', v_pay.id, 'full', v_full, 'changed', true);
end;
$$;

/* A paid subscription invoice after the first (see v2 for p). v3: takes the
   subscription and payment-reference locks, records through
   commerce_upsert_stripe_payment, and applies a refund of this renewal's own
   payment that arrived before the invoice did. */
create or replace function public.commerce_record_stripe_invoice(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice  text := nullif(p->>'invoice_id', '');
  v_sub      text := nullif(p->>'subscription', '');
  v_ref      text := coalesce(nullif(p->>'payment_intent', ''), nullif(p->>'invoice_id', ''));
  v_amount   integer := (p->>'amount_cents')::integer;
  v_currency text := lower(coalesce(nullif(p->>'currency', ''), 'usd'));
  v_paid_at  timestamptz := coalesce(nullif(p->>'paid_at', '')::timestamptz, now());
  v_live     boolean := coalesce((p->>'livemode')::boolean, true);
  v_org      uuid;
  v_ren      record;
  v_lead     uuid;
  v_paid     jsonb;
  v_payment  uuid;
  v_new      boolean;
  v_pending  record;
begin
  if v_invoice is null or v_invoice !~ '^in_[A-Za-z0-9]{8,200}$' then raise exception 'invalid invoice id'; end if;
  if coalesce(p->>'billing_reason', '') = 'subscription_create' then
    return jsonb_build_object('skipped', 'first invoice is recorded by its checkout');
  end if;
  if v_sub is null then return jsonb_build_object('skipped', 'not a subscription invoice'); end if;
  if v_amount is null or v_amount < 0 then raise exception 'invalid amount'; end if;
  v_org := public.commerce_resolve_org(p->>'org_id');
  perform public.commerce_stripe_lock(v_sub, v_ref);
  select id, title, order_id, state into v_ren from public.work_renewals
   where org_id = v_org and source_table = 'stripe_subscription' and source_id = v_sub
   for update;
  if v_ren.id is null then
    if v_live then
      -- keyed by invoice, so several early renewals of one subscription all wait
      perform public.commerce_defer_stripe_event(v_org, 'invoice', v_invoice, p);
      return jsonb_build_object('skipped', 'subscription not recorded yet', 'deferred', true);
    end if;
    return jsonb_build_object('skipped', 'subscription was not sold through an offering');
  end if;
  select lead_id into v_lead from public.work_orders where id = v_ren.order_id;

  v_paid := public.commerce_upsert_stripe_payment(v_org, jsonb_build_object(
    'title', v_ren.title || ' · renewal', 'amount_cents', v_amount, 'currency', v_currency, 'reference', v_ref,
    'lead_id', v_lead, 'order_id', v_ren.order_id, 'renewal_id', v_ren.id, 'paid_at', v_paid_at,
    'livemode', v_live, 'note', 'Stripe invoice ' || v_invoice));
  v_payment := (v_paid->>'payment_id')::uuid;
  v_new := (v_paid->>'created')::boolean or (v_paid->>'promoted')::boolean;

  if v_new then
    update public.work_renewals
       set state = case when state = 'cancelled' then state else 'upcoming' end,
           last_renewed_at = greatest(coalesce(last_renewed_at, v_paid_at), v_paid_at),
           renews_at = greatest(coalesce(renews_at, nullif(p->>'period_end', '')::timestamptz),
                                coalesce(nullif(p->>'period_end', '')::timestamptz, renews_at))
     where id = v_ren.id;
    insert into public.control_audit (org_id, actor_kind, event, resource_type, resource_id, detail)
    values (v_org, 'system', 'commerce.stripe.renewal_paid', 'work_renewal', v_ren.id::text,
            jsonb_build_object('invoice', v_invoice, 'reference', v_ref, 'amount_cents', v_amount, 'payment_id', v_payment,
                               'promoted', (v_paid->>'promoted')::boolean));
  end if;

  -- a refund of this renewal's payment that came first
  if v_live then
    for v_pending in
      select id, payload from public.commerce_stripe_pending
       where org_id = v_org and applied_at is null and kind = 'refund' and reference = v_ref
       for update
    loop
      update public.commerce_stripe_pending set applied_at = now() where id = v_pending.id;
      perform public.commerce_record_stripe_refund(v_pending.payload);
    end loop;
  end if;

  return jsonb_strip_nulls(jsonb_build_object('renewal_id', v_ren.id, 'payment_id', v_payment, 'created', v_new));
end;
$$;

/* A subscription that ended (see v2 for p). v3: takes the subscription lock. */
create or replace function public.commerce_record_stripe_subscription_ended(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub  text := nullif(p->>'subscription', '');
  v_live boolean := coalesce((p->>'livemode')::boolean, true);
  v_org  uuid;
  v_id   uuid;
  v_seen boolean;
begin
  if v_sub is null or v_sub !~ '^sub_[A-Za-z0-9]{8,200}$' then raise exception 'invalid subscription id'; end if;
  v_org := public.commerce_resolve_org(p->>'org_id');
  perform public.commerce_stripe_lock(v_sub, null);
  update public.work_renewals set state = 'cancelled'
   where org_id = v_org and source_table = 'stripe_subscription' and source_id = v_sub and state <> 'cancelled'
  returning id into v_id;
  if v_id is not null then
    insert into public.control_audit (org_id, actor_kind, event, resource_type, resource_id, detail)
    values (v_org, 'system', 'commerce.stripe.subscription_ended', 'work_renewal', v_id::text,
            jsonb_build_object('subscription', v_sub));
    return jsonb_build_object('renewal_id', v_id, 'matched', true);
  end if;
  select exists(select 1 from public.work_renewals
                 where org_id = v_org and source_table = 'stripe_subscription' and source_id = v_sub) into v_seen;
  if not v_seen and v_live then
    perform public.commerce_defer_stripe_event(v_org, 'subscription_ended', v_sub, p);
    return jsonb_build_object('renewal_id', null, 'matched', false, 'deferred', true);
  end if;
  return jsonb_build_object('renewal_id', null, 'matched', v_seen);
end;
$$;

revoke all on function public.commerce_stripe_lock(text, text) from public, anon, authenticated;
revoke all on function public.commerce_upsert_stripe_payment(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.commerce_record_stripe_checkout(jsonb) from public, anon, authenticated;
revoke all on function public.commerce_record_stripe_refund(jsonb) from public, anon, authenticated;
revoke all on function public.commerce_record_stripe_invoice(jsonb) from public, anon, authenticated;
revoke all on function public.commerce_record_stripe_subscription_ended(jsonb) from public, anon, authenticated;
grant execute on function public.commerce_stripe_lock(text, text) to service_role;
grant execute on function public.commerce_upsert_stripe_payment(uuid, jsonb) to service_role;
grant execute on function public.commerce_record_stripe_checkout(jsonb) to service_role;
grant execute on function public.commerce_record_stripe_refund(jsonb) to service_role;
grant execute on function public.commerce_record_stripe_invoice(jsonb) to service_role;
grant execute on function public.commerce_record_stripe_subscription_ended(jsonb) to service_role;
