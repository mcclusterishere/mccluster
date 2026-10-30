// Is this Stripe Checkout Session the payment for this order?
//
// A paid session proves only that SOMEONE paid SOMETHING. Before a function
// marks an order paid or hands over what was bought it must bind the session
// to the order it is about: the session the server created and stored on the
// order, on the Stripe account the server charged on, for the order's amount
// and currency, and actually paid. Metadata on the session is a pointer to
// the order, never proof: anyone who controls a Stripe account (a connected
// account included) can write any metadata.
//
// Returns null when the session is the order's payment, otherwise the reason.
export type CheckoutSessionLike = {
  id?: string | null;
  object?: string | null;
  mode?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
};
export type ExpectedCheckout = {
  /** the session id the server stored on the order when it created the session */
  sessionId: string | null | undefined;
  amountCents: number;
  currency: string;
  /** the connected account the server charged on; null/undefined = the platform account */
  account?: string | null;
};

export function checkoutBindingFailure(
  session: CheckoutSessionLike | null | undefined,
  expected: ExpectedCheckout,
  eventAccount?: string | null,
): string | null {
  if (!session || typeof session !== "object") return "no_session";
  if (session.object && session.object !== "checkout.session") return "not_a_checkout_session";
  if (session.mode && session.mode !== "payment") return "not_a_payment";
  const want = expected.account || null;
  const got = eventAccount || null;
  if (want !== got) return "account_mismatch";
  if (!expected.sessionId || session.id !== expected.sessionId) return "session_mismatch";
  if (session.payment_status !== "paid") return "not_paid";
  if (!Number.isSafeInteger(session.amount_total) || session.amount_total !== expected.amountCents) return "amount_mismatch";
  if (String(session.currency || "").toLowerCase() !== String(expected.currency || "").toLowerCase() || !expected.currency) {
    return "currency_mismatch";
  }
  return null;
}
