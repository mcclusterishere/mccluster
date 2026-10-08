/* GET /v1/commerce/receipt?session=cs_… — what pay.html shows after Stripe
   sends the buyer back.

   Stripe's success URL carries the Checkout Session id. The page asks this
   route whether the webhook has recorded that sale yet, and what happens
   next (a time to agree, a parcel to ship, a file to send, a renewal). The
   session id is Stripe's long random identifier, known only to the buyer's
   browser and Stripe, so it is the key; the answer carries no name, email,
   address, phone or payment reference, only what the buyer already saw on
   Stripe's own page. A test-mode session says so, and so does its record. */
import { refundedOf } from './summary.js';

export const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{8,200}$/;
const NEXT = { service_scheduling: 'schedule', physical_shipping: 'ship', digital_delivery: 'deliver' };

export function receiptFromRecords(sessionId, order, payment, booking) {
  const test = sessionId.startsWith('cs_test_');
  if (!order) return { ok: true, recorded: false, test };
  const item = Array.isArray(order.items) && order.items[0] && typeof order.items[0] === 'object' ? order.items[0] : {};
  const refunded = payment ? refundedOf(payment) : 0;
  const amount = Number(order.amount_cents) || 0;
  let next = NEXT[item.fulfillment_type] || 'follow_up';
  if (item.billing_interval === 'month' || item.billing_interval === 'year') next = 'renews';
  if (order.state === 'cancelled' || (payment && payment.state === 'refunded')) next = 'refunded';
  return {
    ok: true,
    recorded: true,
    test: order.livemode === false || test,
    item: String(item.title || 'Your purchase').slice(0, 160),
    state: order.state,
    amount_cents: amount,
    currency: order.currency || 'usd',
    refunded_cents: refunded,
    next,
    billing_interval: item.billing_interval || null,
    booking: booking ? { state: booking.state, starts_at: booking.starts_at || null } : null,
    placed_at: order.placed_at || null
  };
}

export async function checkoutReceipt(env, sessionId, fetchImpl = fetch) {
  const id = String(sessionId || '');
  if (!SESSION_ID.test(id)) {
    throw Object.assign(new Error('a Stripe checkout session id is required'), { status: 400 });
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw Object.assign(new Error('receipts are not configured'), { status: 503 });
  }
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const rows = async (path) => {
    const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers });
    if (!res.ok) throw Object.assign(new Error('receipt lookup failed'), { status: 502 });
    const body = await res.json();
    return Array.isArray(body) ? body : [];
  };
  const [order] = await rows(`work_orders?source_table=eq.stripe_checkout&source_id=eq.${encodeURIComponent(id)}` +
    '&select=id,state,amount_cents,currency,livemode,items,placed_at&limit=1');
  if (!order) return receiptFromRecords(id, null, null, null);
  const oid = encodeURIComponent(order.id);
  const [payments, bookings] = await Promise.all([
    // select=* so refunded_cents is read when reconciler v3 has added it
    rows(`work_payments?order_id=eq.${oid}&provider=eq.stripe&renewal_id=is.null&select=*&limit=1`),
    rows(`work_bookings?order_id=eq.${oid}&select=state,starts_at&limit=1`)
  ]);
  return receiptFromRecords(id, order, payments[0] || null, bookings[0] || null);
}
