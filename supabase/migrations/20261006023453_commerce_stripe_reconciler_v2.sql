-- Commerce reconciler v2: out-of-order Stripe events, and test mode that
-- sets nothing in motion.
--
-- Stripe does not guarantee delivery order. In v1 a refund, renewal invoice
-- or cancellation that arrived before its checkout found nothing to update,
-- answered matched=false, and the webhook still marked the event processed,
-- so the refund or cancellation was lost for good once the checkout landed.
-- Now an unmatched live event is kept in commerce_stripe_pending and applied
-- by the checkout that creates its payment or renewal.
--
-- A test-mode checkout used to open bookings and Ship/Deliver/Schedule tasks
-- (which carry no livemode) and create or promote a lead, putting a Stripe
-- test in the live operator queue. A test checkout now records only its
-- flagged order and payment.

create table if not exists public.commerce_stripe_pending (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  kind        text not null check (kind in ('refund', 'subscription_ended', 'invoice')),
  reference   text not null check (char_length(reference) between 1 and 255),
  payload     jsonb not null check (jsonb_typeof(payload) = 'object'),
  received_at timestamptz not null default now(),
  applied_at  timestamptz,
  unique (org_id, kind, reference)
);
create index if not exists commerce_stripe_pending_open_idx
  on public.commerce_stripe_pending (org_id, kind, reference) where applied_at is null;
alter table public.commerce_stripe_pending enable row level security;
alter table public.commerce_stripe_pending force row level security;
revoke all on public.commerce_stripe_pending from public, anon, authenticated;
grant all on public.commerce_stripe_pending to service_role;
comment on table public.commerce_stripe_pending is
  'Stripe refunds, renewal invoices and cancellations that arrived before their checkout; applied by commerce_record_stripe_checkout. Service role only.';

/* Keep an unmatched live event until its checkout is recorded. A later
   delivery of the same refund replaces the payload (amount_refunded only
   grows), so the newest state is what gets applied. */
create or replace function public.commerce_defer_stripe_event(p_org uuid, p_kind text, p_reference text, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.commerce_stripe_pending (org_id, kind, reference, payload)
  values (p_org, p_kind, p_reference, p)
  on conflict (org_id, kind, reference) do update
    set payload = case
          when p_kind = 'refund'
               and coalesce((excluded.payload->>'amount_refunded')::bigint, 0)
                   < coalesce((public.commerce_stripe_pending.payload->>'amount_refunded')::bigint, 0)
            then public.commerce_stripe_pending.payload
          else excluded.payload
        end,
        received_at = now()
    where public.commerce_stripe_pending.applied_at is null;
  insert into public.control_audit (org_id, actor_kind, event, resource_type, resource_id, detail)
  values (p_org, 'system', 'commerce.stripe.deferred', 'stripe_' || p_kind, p_reference,
          jsonb_build_object('kind', p_kind, 'reference', p_reference));
end;
$$;

/* A completed, paid checkout session. p carries:
     session_id, payment_intent, invoice, subscription, current_period_end,
     offering, kind, email, name, phone, shipping (object), amount_cents,
     currency, paid_at, livemode, org_id
   Creates (once per session): the buyer as a lead, a paid order, a
   provider-verified payment, and what the sale sets in motion: a renewal for
   a subscription, a booking for a deposit, a task to ship, deliver or
   follow up. Then applies any refund, renewal or cancellation that arrived
   first. A test-mode checkout records only its flagged order and payment.
   A repeat call returns the same records with created=false. */
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
  -- one webhook delivery at a time per session
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

  insert into public.work_payments (org_id, title, state, amount_cents, currency, provider, provider_reference,
                                    verification, lead_id, order_id, paid_at, livemode, note)
  values (v_org, v_title, 'paid', v_amount, v_currency, 'stripe', v_reference,
          'provider_verified', v_lead, v_order, v_paid_at, v_live, 'Stripe checkout ' || v_session)
  on conflict (org_id, provider, provider_reference) where provider_reference is not null do nothing
  returning id into v_payment;
  if v_payment is null then
    select id into v_payment from public.work_payments
     where org_id = v_org and provider = 'stripe' and provider_reference = v_reference;
  end if;

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
            'lead_id', v_lead, 'payment_id', v_payment, 'booking_id', v_booking,
            'renewal_id', v_renewal, 'task_id', v_task)));

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
    'booking_id', v_booking, 'renewal_id', v_renewal, 'task_id', v_task,
    'applied_pending', case when jsonb_array_length(v_applied) > 0 then v_applied end));
end;
$$;

/* A Stripe refund. p: payment_intent, amount_cents (the charge),
   amount_refunded, livemode, org_id. A full refund marks the payment
   refunded and cancels its order unless the order is already fulfilled. A
   partial refund keeps the payment paid and says so in its note. A live
   refund for a payment not yet recorded is kept until its checkout is. */
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
  v_org := public.commerce_resolve_org(p->>'org_id');
  select id, order_id, state, note into v_pay from public.work_payments
   where org_id = v_org and provider = 'stripe' and provider_reference = v_ref
   for update;
  if v_pay.id is null then
    if v_live then
      perform public.commerce_defer_stripe_event(v_org, 'refund', v_ref, p);
      return jsonb_build_object('matched', false, 'deferred', true);
    end if;
    return jsonb_build_object('matched', false);
  end if;
  v_full := v_refunded > 0 and v_refunded >= v_amount;
  update public.work_payments
     set state = case when v_full then 'refunded' else state end,
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
                             'previous_state', v_pay.state));
  return jsonb_build_object('matched', true, 'payment_id', v_pay.id, 'full', v_full);
end;
$$;

/* A paid subscription invoice after the first. The first invoice is the
   checkout itself (billing_reason subscription_create) and is skipped. p:
   invoice_id, payment_intent, subscription, billing_reason, amount_cents,
   currency, paid_at, period_end, livemode, org_id. A live renewal for a
   subscription whose checkout is not recorded yet is kept until it is. */
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
  v_payment  uuid;
begin
  if v_invoice is null or v_invoice !~ '^in_[A-Za-z0-9]{8,200}$' then raise exception 'invalid invoice id'; end if;
  if coalesce(p->>'billing_reason', '') = 'subscription_create' then
    return jsonb_build_object('skipped', 'first invoice is recorded by its checkout');
  end if;
  if v_sub is null then return jsonb_build_object('skipped', 'not a subscription invoice'); end if;
  if v_amount is null or v_amount < 0 then raise exception 'invalid amount'; end if;
  v_org := public.commerce_resolve_org(p->>'org_id');
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

  insert into public.work_payments (org_id, title, state, amount_cents, currency, provider, provider_reference,
                                    verification, lead_id, order_id, renewal_id, paid_at, livemode, note)
  values (v_org, left(v_ren.title || ' · renewal', 300), 'paid', v_amount, v_currency, 'stripe', v_ref,
          'provider_verified', v_lead, v_ren.order_id, v_ren.id, v_paid_at, v_live, 'Stripe invoice ' || v_invoice)
  on conflict (org_id, provider, provider_reference) where provider_reference is not null do nothing
  returning id into v_payment;

  if v_payment is not null then
    update public.work_renewals
       set state = case when state = 'cancelled' then state else 'upcoming' end,
           last_renewed_at = greatest(coalesce(last_renewed_at, v_paid_at), v_paid_at),
           renews_at = greatest(coalesce(renews_at, nullif(p->>'period_end', '')::timestamptz),
                                coalesce(nullif(p->>'period_end', '')::timestamptz, renews_at))
     where id = v_ren.id;
    insert into public.control_audit (org_id, actor_kind, event, resource_type, resource_id, detail)
    values (v_org, 'system', 'commerce.stripe.renewal_paid', 'work_renewal', v_ren.id::text,
            jsonb_build_object('invoice', v_invoice, 'reference', v_ref, 'amount_cents', v_amount, 'payment_id', v_payment));
  end if;
  return jsonb_strip_nulls(jsonb_build_object('renewal_id', v_ren.id, 'payment_id', v_payment, 'created', v_payment is not null));
end;
$$;

/* A subscription that ended. p: subscription, livemode, org_id. A live
   ending for a subscription whose checkout is not recorded yet is kept
   until it is. */
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

revoke all on function public.commerce_defer_stripe_event(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.commerce_record_stripe_checkout(jsonb) from public, anon, authenticated;
revoke all on function public.commerce_record_stripe_refund(jsonb) from public, anon, authenticated;
revoke all on function public.commerce_record_stripe_invoice(jsonb) from public, anon, authenticated;
revoke all on function public.commerce_record_stripe_subscription_ended(jsonb) from public, anon, authenticated;
grant execute on function public.commerce_defer_stripe_event(uuid, text, text, jsonb) to service_role;
grant execute on function public.commerce_record_stripe_checkout(jsonb) to service_role;
grant execute on function public.commerce_record_stripe_refund(jsonb) to service_role;
grant execute on function public.commerce_record_stripe_invoice(jsonb) to service_role;
grant execute on function public.commerce_record_stripe_subscription_ended(jsonb) to service_role;
