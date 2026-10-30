/* The merch marketplace's platform cut (owner, 2026-10-30: 15% per sale,
   server-controlled; sellers cannot change it).

   One number, held in two places on purpose and held equal by
   scripts/test/merch-marketplace.test.mjs: this constant, which the Worker
   uses to check every order before it asks Stripe for a checkout, and
   public.marketplace_platform_fee_bps() in
   supabase/pending/merch_marketplace_v1.sql, which prices the order and is
   enforced by the order guard. Same shape as the music commission
   (supabase/functions/_shared/music-commission.ts).

   The fee is on the item subtotal plus shipping. Sales tax is the seller's
   liability and passes through untouched: McCluster takes no cut of tax. */
export const MARKETPLACE_PLATFORM_FEE_BPS = 1500;

export function marketplaceFee(basisCents) {
  if (!Number.isSafeInteger(basisCents) || basisCents < 0) throw new RangeError('invalid_fee_basis');
  return Math.round(basisCents * MARKETPLACE_PLATFORM_FEE_BPS / 10000);
}

/* What one order costs, before tax. Every input comes from the database row,
   never from the browser. */
export function orderAmounts({ unitPriceCents, quantity, shippingCents }) {
  for (const n of [unitPriceCents, quantity, shippingCents]) {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('invalid_amount');
  }
  if (quantity < 1 || unitPriceCents < 1) throw new RangeError('invalid_amount');
  const subtotalCents = unitPriceCents * quantity;
  const feeBasisCents = subtotalCents + shippingCents;
  const platformFeeCents = marketplaceFee(feeBasisCents);
  return { subtotalCents, shippingCents, feeBasisCents, platformFeeCents, sellerNetBeforeStripeCents: feeBasisCents - platformFeeCents };
}

/* The database priced the order; the Worker refuses to charge if its own
   arithmetic disagrees, so a drifted constant fails closed, not silently. */
export function orderFeeMismatch(order) {
  try {
    const want = orderAmounts({
      unitPriceCents: Number(order.unit_price_cents),
      quantity: Number(order.quantity),
      shippingCents: Number(order.shipping_cents)
    });
    if (Number(order.platform_fee_bps) !== MARKETPLACE_PLATFORM_FEE_BPS) return 'fee_bps_mismatch';
    if (Number(order.subtotal_cents) !== want.subtotalCents) return 'subtotal_mismatch';
    if (Number(order.fee_basis_cents) !== want.feeBasisCents) return 'fee_basis_mismatch';
    if (Number(order.platform_fee_cents) !== want.platformFeeCents) return 'fee_mismatch';
    if (want.platformFeeCents >= want.feeBasisCents) return 'fee_exceeds_sale';
    return null;
  } catch {
    return 'invalid_order';
  }
}
