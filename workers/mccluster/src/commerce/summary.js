/* What the Stripe reconciler recorded, counted the one way Control and
   Analytics both use.

   - Verified only: a payment counts when Stripe verified it
     (verification = provider_verified), never because someone typed it in.
   - Net of refunds: refunded_cents is Stripe's amount_refunded (reconciler
     v3). On a database still at v1/v2 a full refund is the whole amount and a
     partial one is not known yet, so it is counted as unrefunded.
   - Test mode apart: livemode = false is reported on its own and never
     added to a live figure.
   - US dollars: the catalogue is priced in USD; anything else is counted
     separately, never converted. */

export function refundedOf(payment) {
  const amount = Number(payment?.amount_cents) || 0;
  const refunded = Number(payment?.refunded_cents);
  if (Number.isFinite(refunded) && refunded > 0) return Math.min(refunded, amount);
  return payment?.state === 'refunded' ? amount : 0;
}

const isVerifiedStripe = (p) => p?.provider === 'stripe' && p?.verification === 'provider_verified' &&
  (p?.state === 'paid' || p?.state === 'refunded');
const isUsd = (p) => String(p?.currency || 'usd').toLowerCase() === 'usd';

function money(rows) {
  const gross = rows.reduce((n, p) => n + (Number(p.amount_cents) || 0), 0);
  const refunded = rows.reduce((n, p) => n + refundedOf(p), 0);
  return {
    payments: rows.length,
    renewal_payments: rows.filter((p) => p.renewal_id).length,
    gross_cents: gross,
    refunded_cents: refunded,
    net_cents: gross - refunded
  };
}

function bookingCounts(rows) {
  return {
    total: rows.length,
    proposed: rows.filter((b) => b.state === 'proposed').length,
    confirmed: rows.filter((b) => b.state === 'confirmed').length,
    completed: rows.filter((b) => b.state === 'completed').length
  };
}

/* rows: { payments, orders, bookings } as the Worker reads them.
   windowSpec: { since, until } ISO strings, or null for all time. */
export function commerceSummary({ payments = [], orders = [], bookings = [] } = {}, windowSpec = null) {
  const since = windowSpec ? Date.parse(windowSpec.since) : null;
  const until = windowSpec ? Date.parse(windowSpec.until) : null;
  const inWindow = (at) => {
    const t = Date.parse(at || '');
    return Number.isFinite(t) && t >= since && t < until;
  };

  const verified = payments.filter(isVerifiedStripe);
  const live = verified.filter((p) => p.livemode !== false && isUsd(p));
  const test = verified.filter((p) => p.livemode === false);
  const stripeOrders = orders.filter((o) => o.source_table === undefined || o.source_table === 'stripe_checkout');
  const liveOrders = stripeOrders.filter((o) => o.livemode !== false);
  const testOrderIds = new Set(stripeOrders.filter((o) => o.livemode === false).map((o) => o.id));
  /* bookings the owner made, and those a live deposit opened; a test
     checkout opens none, and one linked to a test order is never counted */
  const liveBookings = bookings.filter((b) => !b.order_id || !testOrderIds.has(b.order_id));

  const out = {
    source: 'stripe_reconciler',
    verified_only: true,
    currency: 'usd',
    live: { ...money(live), orders: liveOrders.length, bookings: bookingCounts(liveBookings) },
    live_in_window: null,
    test: { ...money(test), orders: stripeOrders.length - liveOrders.length },
    other_currency_payments: verified.filter((p) => p.livemode !== false && !isUsd(p)).length
  };
  if (windowSpec) {
    out.live_in_window = {
      ...money(live.filter((p) => inWindow(p.paid_at))),
      orders: liveOrders.filter((o) => inWindow(o.placed_at)).length,
      bookings: bookingCounts(liveBookings.filter((b) => inWindow(b.created_at)))
    };
  }
  return out;
}

/* rows(path) returns PostgREST rows read with the service role. The house
   org only: a connected seller's sales are that seller's revenue. */
export async function loadCommerceSummary(rows, windowSpec = null) {
  const house = (await rows('orgs?slug=eq.mccluster&select=id&limit=1'))?.[0]?.id;
  if (!house) return { available: false, reason: 'house org not found' };
  const org = encodeURIComponent(house);
  const [payments, orders, bookings] = await Promise.all([
    // select=* so refunded_cents is read when reconciler v3 has added it
    rows(`work_payments?org_id=eq.${org}&provider=eq.stripe&verification=eq.provider_verified&select=*`),
    rows(`work_orders?org_id=eq.${org}&source_table=eq.stripe_checkout&select=id,state,livemode,placed_at,source_table`),
    rows(`work_bookings?org_id=eq.${org}&select=id,state,order_id,created_at`)
  ]);
  return { available: true, ...commerceSummary({ payments, orders, bookings }, windowSpec) };
}
