-- Commerce reconciler v1: a paid Stripe checkout becomes the canonical
-- commercial record.
--
-- Before this, `checkout` and `music-checkout` took money but nothing wrote
-- it anywhere McCluster could see. The Stripe webhook settled music
-- entitlements and nothing else, so a paid print, file, hosting plan, booking
-- deposit or $875/month subscription left no order, no payment, no buyer and
-- no follow-up. The post-sale ledger (20261005075808) had
-- `verification = 'provider_verified'`, but nothing could ever set it.
--
-- These functions are called only by supabase/functions/stripe-webhook after
-- it has verified Stripe's signature. They are service_role only, idempotent
-- per Stripe object, and audited in control_audit. Every row they write
-- carries `livemode`, so test-mode checkouts can never pass for revenue.

-- Provenance for rows the reconciler writes.
alter table public.work_orders drop constraint if exists work_orders_source_table_check;
alter table public.work_orders add constraint work_orders_source_table_check
  check (source_table in ('print_orders', 'shake_orders', 'music_orders', 'l3_orders', 'stripe_checkout'));
alter table public.work_orders add column if not exists livemode boolean not null default true;
create unique index if not exists work_orders_source_uidx
  on public.work_orders (org_id, source_table, source_id) where source_id is not null;

alter table public.work_payments add column if not exists livemode boolean not null default true;

alter table public.work_renewals drop constraint if exists work_renewals_source_table_check;
alter table public.work_renewals add constraint work_renewals_source_table_check
  check (source_table in ('site_accounts', 'api_subscriptions', 'offerings', 'stripe_subscription'));
alter table public.work_renewals add column if not exists livemode boolean not null default true;
create unique index if not exists work_renewals_source_uidx
  on public.work_renewals (org_id, source_table, source_id) where source_id is not null;

-- A paid booking deposit opens exactly one booking.
alter table public.work_bookings add column if not exists order_id uuid references public.work_orders(id) on delete set null;
create unique index if not exists work_bookings_order_uidx
  on public.work_bookings (order_id) where order_id is not null;

-- Which org a Stripe object belongs to: the connected seller's org when the
-- checkout ran on a connected account, otherwise the house.
create or replace function public.commerce_resolve_org(p_org text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if nullif(p_org, '') is not null then
    select id into v_org from public.orgs where id = p_org::uuid;
    if v_org is null then raise exception 'unknown org %', p_org; end if;
    return v_org;
  end if;
  select id into v_org from public.orgs where slug = 'mccluster';
  if v_org is null then raise exception 'house org mccluster is missing'; end if;
  return v_org;
end;
$$;

/* A completed, paid checkout session. p carries:
     session_id, payment_intent, invoice, subscription, current_period_end,
     offering, kind, email, name, phone, shipping (object), amount_cents,
     currency, paid_at, livemode, org_id
   Creates (once per session): the buyer as a lead, a paid order, a
   provider-verified payment, and what the sale sets in motion: a renewal for
   a subscription, a booking for a deposit, a task to ship, deliver or
   follow up. A repeat call returns the same records with created=false. */
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

    if v_email is not null then
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

  -- what the sale sets in motion, decided once, when the order is new
  if v_created then
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

  return jsonb_strip_nulls(jsonb_build_object(
    'created', v_created, 'org_id', v_org, 'order_id', v_order, 'payment_id', v_payment, 'lead_id', v_lead,
    'booking_id', v_booking, 'renewal_id', v_renewal, 'task_id', v_task));
end;
$$;

/* A Stripe refund. p: payment_intent, amount_cents (the charge),
   amount_refunded, livemode, org_id. A full refund marks the payment
   refunded and cancels its order unless the order is already fulfilled. A
   partial refund keeps the payment paid and says so in its note. */
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
  v_org      uuid;
  v_pay      record;
  v_full     boolean;
begin
  if v_ref is null or v_ref !~ '^pi_[A-Za-z0-9]{8,200}$' then raise exception 'invalid payment intent'; end if;
  v_org := public.commerce_resolve_org(p->>'org_id');
  select id, order_id, state, note into v_pay from public.work_payments
   where org_id = v_org and provider = 'stripe' and provider_reference = v_ref;
  if v_pay.id is null then
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
   currency, paid_at, period_end, livemode, org_id. */
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
  select id, title, order_id into v_ren from public.work_renewals
   where org_id = v_org and source_table = 'stripe_subscription' and source_id = v_sub;
  if v_ren.id is null then return jsonb_build_object('skipped', 'subscription was not sold through an offering'); end if;
  select lead_id into v_lead from public.work_orders where id = v_ren.order_id;

  insert into public.work_payments (org_id, title, state, amount_cents, currency, provider, provider_reference,
                                    verification, lead_id, order_id, renewal_id, paid_at, livemode, note)
  values (v_org, left(v_ren.title || ' · renewal', 300), 'paid', v_amount, v_currency, 'stripe', v_ref,
          'provider_verified', v_lead, v_ren.order_id, v_ren.id, v_paid_at, v_live, 'Stripe invoice ' || v_invoice)
  on conflict (org_id, provider, provider_reference) where provider_reference is not null do nothing
  returning id into v_payment;

  if v_payment is not null then
    update public.work_renewals
       set state = 'upcoming', last_renewed_at = v_paid_at,
           renews_at = coalesce(nullif(p->>'period_end', '')::timestamptz, renews_at)
     where id = v_ren.id;
    insert into public.control_audit (org_id, actor_kind, event, resource_type, resource_id, detail)
    values (v_org, 'system', 'commerce.stripe.renewal_paid', 'work_renewal', v_ren.id::text,
            jsonb_build_object('invoice', v_invoice, 'reference', v_ref, 'amount_cents', v_amount, 'payment_id', v_payment));
  end if;
  return jsonb_strip_nulls(jsonb_build_object('renewal_id', v_ren.id, 'payment_id', v_payment, 'created', v_payment is not null));
end;
$$;

/* A subscription that ended. p: subscription, livemode, org_id. */
create or replace function public.commerce_record_stripe_subscription_ended(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub text := nullif(p->>'subscription', '');
  v_org uuid;
  v_id  uuid;
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
  end if;
  return jsonb_build_object('renewal_id', v_id, 'matched', v_id is not null);
end;
$$;

revoke all on function public.commerce_resolve_org(text) from public, anon, authenticated;
revoke all on function public.commerce_record_stripe_checkout(jsonb) from public, anon, authenticated;
revoke all on function public.commerce_record_stripe_refund(jsonb) from public, anon, authenticated;
revoke all on function public.commerce_record_stripe_invoice(jsonb) from public, anon, authenticated;
revoke all on function public.commerce_record_stripe_subscription_ended(jsonb) from public, anon, authenticated;
grant execute on function public.commerce_resolve_org(text) to service_role;
grant execute on function public.commerce_record_stripe_checkout(jsonb) to service_role;
grant execute on function public.commerce_record_stripe_refund(jsonb) to service_role;
grant execute on function public.commerce_record_stripe_invoice(jsonb) to service_role;
grant execute on function public.commerce_record_stripe_subscription_ended(jsonb) to service_role;

comment on function public.commerce_record_stripe_checkout(jsonb) is
  'Stripe webhook only: a paid checkout session becomes lead + order + provider-verified payment + follow-up. Idempotent per session.';
