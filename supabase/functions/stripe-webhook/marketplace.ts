// Merch marketplace settlement: may this event change this marketplace order?
//
// Marketplace sales are DIRECT charges on the seller's connected account
// (workers/mccluster/src/merch/router.js), so their events arrive with
// event.account set. That proves only that SOME connected account sent
// SOMETHING: anyone who controls a connected account can write any metadata.
// So metadata is a pointer to the order and nothing more. The order is read
// from the database and everything is checked against what the server stored
// when it created the checkout: the connected account it charged on, the
// session id it stored, the mode, the currency and the amounts it priced (tax
// is Stripe's and sits on top). public.marketplace_order_mark_paid() checks
// the same again under a row lock (supabase/pending/merch_marketplace_v1.sql).
// Pure, so scripts/test/merch-marketplace.test.mjs runs it under Node.

type Obj = Record<string, any>;

export type MarketplaceOrderRow = {
  id: string;
  seller_org_id: string;
  stripe_account_id: string;
  checkout_session_id: string | null;
  livemode: boolean;
  currency: string;
  subtotal_cents: number;
  shipping_cents: number;
  fee_basis_cents: number;
  status: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const int = (v: unknown): number | null => (Number.isSafeInteger(v) ? (v as number) : null);

/** The order a marketplace event points at, or null when it is not a marketplace event. */
export function marketplaceOrderId(object: Obj | null | undefined): string | null {
  const m = object?.metadata || {};
  if (m.kind !== "marketplace_sale") return null;
  const id = str(m.marketplace_order_id);
  return id && UUID.test(id) ? id : null;
}

/** Null when the session is this order's payment, otherwise why not. */
export function marketplacePaymentRefusal(session: Obj, event: Obj, order: MarketplaceOrderRow | null | undefined): string | null {
  if (!order) return "order_not_found";
  if (!session || typeof session !== "object") return "no_session";
  if (session.object && session.object !== "checkout.session") return "not_a_checkout_session";
  if (session.mode && session.mode !== "payment") return "not_a_payment";
  if (marketplaceOrderId(session) !== order.id) return "order_mismatch";
  const account = str(event?.account);
  if (!account) return "platform_event";
  if (account !== order.stripe_account_id) return "account_mismatch";
  if (!order.checkout_session_id || session.id !== order.checkout_session_id) return "session_mismatch";
  if ((event?.livemode === true) !== (order.livemode === true)) return "mode_mismatch";
  if (session.metadata?.mccluster_org_id !== order.seller_org_id) return "org_mismatch";
  if (session.payment_status !== "paid") return "not_paid";
  if (String(session.currency || "").toLowerCase() !== String(order.currency || "").toLowerCase()) return "currency_mismatch";
  const totals = session.total_details || {};
  const tax = int(totals.amount_tax);
  if (int(session.amount_subtotal) !== order.subtotal_cents) return "amount_mismatch";
  if (int(totals.amount_shipping ?? 0) !== order.shipping_cents) return "amount_mismatch";
  if (int(totals.amount_discount ?? 0) !== 0) return "amount_mismatch";
  if (tax === null || tax < 0 || int(session.amount_total) !== order.fee_basis_cents + tax) return "amount_mismatch";
  /* pending is payable; a paid (or later) order makes this a replay, which the database answers unchanged */
  if (order.status === "canceled") return "order_not_payable";
  return null;
}

/** The payload for public.marketplace_order_mark_paid(), after the refusal check passed. */
export function marketplacePaidRecord(session: Obj, event: Obj, order: MarketplaceOrderRow): Obj {
  const shipping = session.shipping_details || session.collected_information?.shipping_details || null;
  const address = shipping?.address || null;
  const totals = session.total_details || {};
  return {
    order_id: order.id,
    session_id: str(session.id),
    account: str(event.account),
    livemode: event.livemode === true,
    currency: str(session.currency),
    payment_intent: str(session.payment_intent) || str(session.payment_intent?.id),
    amount_subtotal: int(session.amount_subtotal),
    amount_shipping: int(totals.amount_shipping ?? 0),
    amount_discount: int(totals.amount_discount ?? 0),
    amount_tax: int(totals.amount_tax),
    amount_total: int(session.amount_total),
    email: str(session.customer_details?.email) || str(session.customer_email),
    shipping: address ? {
      name: str(shipping.name), line1: str(address.line1), line2: str(address.line2), city: str(address.city),
      state: str(address.state), postal_code: str(address.postal_code), country: str(address.country),
    } : null,
  };
}

/** checkout.session.expired: release the unit, bound to the stored session and account. */
export function marketplaceExpiry(session: Obj, event: Obj): { order_id: string; session_id: string } | null {
  const orderId = marketplaceOrderId(session);
  if (!orderId || !str(event?.account) || !str(session?.id)) return null;
  return { order_id: orderId, session_id: session.id };
}

/** charge.refunded on the seller's account: the payload for public.marketplace_order_record_refund(). */
export function marketplaceRefund(charge: Obj, event: Obj): Obj | null {
  const orderId = marketplaceOrderId(charge);
  const account = str(event?.account);
  const paymentIntent = str(charge?.payment_intent) || str(charge?.payment_intent?.id);
  if (!orderId || !account || !paymentIntent) return null;
  return {
    order_id: orderId, account, payment_intent: paymentIntent, livemode: event.livemode === true,
    amount_refunded: int(charge.amount_refunded) ?? 0,
  };
}
