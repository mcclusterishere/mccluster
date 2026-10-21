#!/usr/bin/env bash
# Commerce reconciler: two Stripe deliveries for one sale, racing.
#
# Stripe can deliver a refund while the checkout it refunds is still being
# recorded. Before reconciler v3 the two transactions did not wait for each
# other: the refund looked for its payment before the checkout committed it,
# deferred itself, and committed that deferral after the checkout had already
# looked for deferred events. The refund was then never applied: refunded
# money stayed "paid". v3 makes every reconciler function take the same
# advisory locks (subscription, then payment reference), so one waits for the
# other. This script holds each side's transaction open while the other runs,
# in both orders, and checks the refund lands either way.
#
# usage: supabase/tests/commerce_stripe_concurrency.sh 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
# Commits real rows (a race needs two committed transactions) under ids unique
# to this run, then deletes them. Never point it at production.
set -euo pipefail
DB="${1:?database URL required}"
case "$DB" in *supabase.co*|*pooler.supabase.com*) echo "refusing to race against a hosted Supabase database" >&2; exit 2;; esac

RUN="$(date +%s)$$"
SLUG="race-print-$RUN"
q() { psql "$DB" -v ON_ERROR_STOP=1 -qAt "$@"; }

q -c "insert into public.offerings (slug, site_id, brand_id, legal_entity_id, offering_type, revenue_type, title, price, price_type, fulfillment_type, status)
      values ('$SLUG', 'here', 'mccluster', 'mccluster-corp', 'physical_product', 'product_sale', 'Race print', 40, 'fixed', 'physical_shipping', 'live')" >/dev/null

checkout() {  # $1 session suffix, $2 payment intent
  echo "select public.commerce_record_stripe_checkout(jsonb_build_object('session_id', 'cs_live_race$1', 'payment_intent', '$2',
        'offering', '$SLUG', 'email', 'race$1@example.com', 'amount_cents', 4000, 'livemode', true));"
}
refund() {  # $1 payment intent
  echo "select public.commerce_record_stripe_refund(jsonb_build_object('payment_intent', '$1', 'amount_cents', 4000,
        'amount_refunded', 4000, 'livemode', true));"
}

fail=0
check() {  # $1 label, $2 payment intent
  local state pending
  state="$(q -c "select state from public.work_payments where provider = 'stripe' and provider_reference = '$2'")"
  pending="$(q -c "select count(*) from public.commerce_stripe_pending where reference = '$2' and applied_at is null")"
  if [ "$state" = "refunded" ] && [ "$pending" = "0" ]; then
    echo "ok   $1: payment refunded, nothing left waiting"
  else
    echo "FAIL $1: payment state '$state', $pending refund(s) never applied"; fail=1
  fi
}

# 1. The refund defers itself and holds its transaction open; the checkout runs meanwhile.
PI1="pi_raceA${RUN}"
( { echo "begin;"; refund "$PI1"; echo "select pg_sleep(2); commit;"; } | q >/dev/null ) &
A=$!; sleep 0.7
checkout "A$RUN" "$PI1" | q >/dev/null
wait "$A"
check "refund first, checkout during it" "$PI1"

# 2. The checkout holds its transaction open; the refund runs meanwhile.
PI2="pi_raceB${RUN}"
( { echo "begin;"; checkout "B$RUN" "$PI2"; echo "select pg_sleep(2); commit;"; } | q >/dev/null ) &
B=$!; sleep 0.7
refund "$PI2" | q >/dev/null
wait "$B"
check "checkout first, refund during it" "$PI2"

# Clean up everything this run wrote.
q >/dev/null <<SQL
delete from public.work_tasks where related_id in (select id from public.work_orders where source_id like 'cs_live_race%${RUN}');
delete from public.work_payments where provider_reference in ('$PI1', '$PI2');
delete from public.commerce_stripe_pending where reference in ('$PI1', '$PI2');
delete from public.control_audit where detail->>'reference' in ('$PI1', '$PI2') or resource_id in ('$PI1', '$PI2')
   or resource_id in (select id::text from public.work_orders where source_id like 'cs_live_race%${RUN}');
delete from public.work_orders where source_id like 'cs_live_race%${RUN}';
delete from public.leads where email like 'race%${RUN}@example.com';
delete from public.offerings where slug = '$SLUG';
SQL

[ "$fail" = 0 ] && echo "commerce reconciler concurrency: both races end refunded" || exit 1
