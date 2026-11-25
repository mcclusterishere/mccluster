// Music licence fulfilment: may this checkout session pay this music order?
//
// The order is found by the id in the session's metadata, and then everything
// else is checked against what the server stored on the order when
// music-checkout created the session (supabase/functions/music-checkout):
// music sales are charged on the PLATFORM account, so an event from a
// connected account never fulfils one; the session must be the one stored on
// the order; amount_total and currency must equal the order's; it must be
// paid; the offer and track it names must be the order's. Pure, so
// scripts/test/music-payment-integrity.test.mjs runs it under Node.
import { checkoutBindingFailure, type CheckoutSessionLike } from "../_shared/checkout-binding.ts";

export type MusicOrderRow = {
  id: string;
  offer_id: string;
  track_id: string;
  stripe_checkout_session_id: string | null;
  amount_cents: number;
  currency: string;
  status: string;
};
export type MusicSession = CheckoutSessionLike & { metadata?: Record<string, string> | null };

/** Order states a payment may still complete. A failed attempt can be retried inside the same session. */
export const MUSIC_PAYABLE = ["pending", "failed"];

export function musicFulfilmentRefusal(
  session: MusicSession,
  event: { account?: string | null },
  order: MusicOrderRow | null | undefined,
): string | null {
  if (!order) return "order_not_found";
  if (session?.metadata?.kind !== "music_license_sale") return "not_a_music_sale";
  if (session.metadata?.music_order_id !== order.id) return "order_mismatch";
  const binding = checkoutBindingFailure(session, {
    sessionId: order.stripe_checkout_session_id,
    amountCents: Number(order.amount_cents),
    currency: order.currency,
    account: null,
  }, typeof event?.account === "string" ? event.account : null);
  if (binding) return binding;
  if (session.metadata?.music_offer_id && session.metadata.music_offer_id !== order.offer_id) return "offer_mismatch";
  if (session.metadata?.music_track_id && session.metadata.music_track_id !== order.track_id) return "track_mismatch";
  if (order.status !== "paid" && !MUSIC_PAYABLE.includes(order.status)) return "order_not_payable";
  return null;
}
