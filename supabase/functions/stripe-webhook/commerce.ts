// What a verified Stripe event means for the commercial ledger.
//
// Pure functions: Stripe objects in, the payload for one of the
// commerce_record_stripe_* database functions out (or null when the event is
// not commerce). index.ts verifies the signature, calls these, and sends the
// result to the database. Kept free of Deno and npm imports so the mapping is
// tested under Node (scripts/test/stripe-commerce-reconciler.test.mjs).

type Obj = Record<string, any>;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const idOf = (v: unknown): string | null => str(v) || (v && typeof v === "object" ? str((v as Obj).id) : null);
const isoFromUnix = (s: unknown): string | null =>
  typeof s === "number" && Number.isFinite(s) ? new Date(s * 1000).toISOString() : null;

/**
 * The McCluster org that owns a Stripe object. A platform event belongs to the
 * house (null). A connected-account event belongs to the org the checkout
 * named; without that name it belongs to nobody we can prove, so the caller
 * skips it rather than booking a client's sale as McCluster revenue.
 */
export function orgFor(event: Obj, metadata: Obj | null | undefined): { org_id: string | null } | null {
  if (!str(event.account)) return { org_id: null };
  const org = str(metadata?.mccluster_org_id);
  return org ? { org_id: org } : null;
}

/** checkout.session.completed / async_payment_succeeded for an offering or a music sale. */
export function checkoutRecord(session: Obj, event: Obj): Obj | null {
  const metadata = session.metadata || {};
  const offering = str(metadata.offering);
  const kind = str(metadata.kind);
  if (!offering && kind !== "music_license_sale") return null;
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return null;
  const owner = orgFor(event, metadata);
  if (!owner) return null;
  const details = session.customer_details || {};
  const shipping = session.shipping_details || session.collected_information?.shipping_details || null;
  const address = shipping?.address || null;
  return {
    session_id: str(session.id),
    payment_intent: idOf(session.payment_intent),
    invoice: idOf(session.invoice),
    subscription: idOf(session.subscription),
    offering,
    kind,
    email: str(details.email) || str(session.customer_email),
    name: str(details.name),
    phone: str(details.phone),
    shipping: address
      ? {
        name: str(shipping.name),
        line1: str(address.line1),
        line2: str(address.line2),
        city: str(address.city),
        state: str(address.state),
        postal_code: str(address.postal_code),
        country: str(address.country),
      }
      : null,
    amount_cents: typeof session.amount_total === "number" ? session.amount_total : null,
    currency: str(session.currency),
    paid_at: isoFromUnix(event.created),
    livemode: event.livemode === true,
    org_id: owner.org_id,
  };
}

/** charge.refunded: the payment the refund belongs to, and how much of it. */
export function refundRecord(charge: Obj, event: Obj): Obj | null {
  const paymentIntent = idOf(charge.payment_intent);
  if (!paymentIntent) return null;
  const owner = orgFor(event, charge.metadata);
  if (!owner) return null;
  return {
    payment_intent: paymentIntent,
    amount_cents: typeof charge.amount === "number" ? charge.amount : 0,
    amount_refunded: typeof charge.amount_refunded === "number" ? charge.amount_refunded : 0,
    livemode: event.livemode === true,
    org_id: owner.org_id,
  };
}

/** invoice.paid for a subscription: one renewal payment. */
export function invoiceRecord(invoice: Obj, event: Obj): Obj | null {
  const subscription = idOf(invoice.subscription) || idOf(invoice.parent?.subscription_details?.subscription);
  if (!subscription) return null;
  const metadata = invoice.subscription_details?.metadata || invoice.parent?.subscription_details?.metadata || invoice.metadata;
  const owner = orgFor(event, metadata);
  if (!owner) return null;
  const line = Array.isArray(invoice.lines?.data) ? invoice.lines.data[0] : null;
  return {
    invoice_id: str(invoice.id),
    payment_intent: idOf(invoice.payment_intent),
    subscription,
    billing_reason: str(invoice.billing_reason),
    amount_cents: typeof invoice.amount_paid === "number" ? invoice.amount_paid : null,
    currency: str(invoice.currency),
    paid_at: isoFromUnix(invoice.status_transitions?.paid_at) || isoFromUnix(event.created),
    period_end: isoFromUnix(line?.period?.end),
    livemode: event.livemode === true,
    org_id: owner.org_id,
  };
}

/** customer.subscription.deleted. */
export function subscriptionEndedRecord(subscription: Obj, event: Obj): Obj | null {
  const id = str(subscription.id);
  if (!id) return null;
  const owner = orgFor(event, subscription.metadata);
  if (!owner) return null;
  return { subscription: id, livemode: event.livemode === true, org_id: owner.org_id };
}
